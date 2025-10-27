import type { Knex } from 'knex';
import type {
  SymbolWithFile,
  SymbolSearchOptions,
  VectorSearchOptions,
  HybridSearchOptions,
  Route,
  RouteSearchOptions,
  Component,
  ComponentSearchOptions,
  Composable,
  ComposableSearchOptions,
  GodotScene,
  GodotSceneSearchOptions,
  GodotNode,
  GodotNodeSearchOptions,
} from '../models';
import type { PaginationParams, PaginatedResponse } from '../pagination';
import { createPaginatedQuery } from '../pagination';
import { createComponentLogger } from '../../utils/logger';
import { getCachedEmbedding } from './embedding-utils';

const logger = createComponentLogger('search-service');

/**
 * Default search combining fulltext and lexical fallback
 */
export async function searchSymbols(
  db: Knex,
  query: string,
  repoId?: number,
  options: SymbolSearchOptions = {}
): Promise<SymbolWithFile[]> {
  const { limit = 100, symbolTypes = [], isExported, framework, repoIds = [] } = options;

  const effectiveRepoIds = repoIds.length > 0 ? repoIds : repoId ? [repoId] : [];

  if (effectiveRepoIds.length === 0) {
    logger.warn('No repositories specified for search');
    return [];
  }

  const ftsResults = await fullTextSearch(db, query, effectiveRepoIds, options);

  if (ftsResults.length === 0) {
    return lexicalSearch(db, query, effectiveRepoIds, options);
  }

  return ftsResults;
}

/**
 * Lexical search (exact name matches)
 */
export async function lexicalSearchSymbols(
  db: Knex,
  query: string,
  repoId?: number,
  options: SymbolSearchOptions = {}
): Promise<SymbolWithFile[]> {
  const repoIds = options.repoIds?.length ? options.repoIds : repoId ? [repoId] : [];
  return lexicalSearch(db, query, repoIds, options);
}

/**
 * Vector search (embedding-based similarity)
 */
export async function vectorSearchSymbols(
  db: Knex,
  query: string,
  repoId?: number,
  options: VectorSearchOptions = {}
): Promise<SymbolWithFile[]> {
  const repoIds = options.repoIds?.length ? options.repoIds : repoId ? [repoId] : [];
  return vectorSearch(db, query, repoIds, options);
}

/**
 * Fulltext search (PostgreSQL FTS)
 */
export async function fulltextSearchSymbols(
  db: Knex,
  query: string,
  repoId?: number,
  options: SymbolSearchOptions = {}
): Promise<SymbolWithFile[]> {
  const repoIds = options.repoIds?.length ? options.repoIds : repoId ? [repoId] : [];
  return fullTextSearch(db, query, repoIds, options);
}

/**
 * Hybrid search (combines all search methods)
 */
export async function hybridSearchSymbols(
  db: Knex,
  query: string,
  repoId?: number,
  options: HybridSearchOptions = {}
): Promise<SymbolWithFile[]> {
  const repoIds = options.repoIds?.length ? options.repoIds : repoId ? [repoId] : [];
  return hybridSearch(db, query, repoIds, options);
}

/**
 * Enhanced lexical search with fuzzy matching and better ranking
 */
async function lexicalSearch(
  db: Knex,
  query: string,
  repoIds: number[],
  options: SymbolSearchOptions
): Promise<SymbolWithFile[]> {
  const { limit = 30, symbolTypes = [], isExported, framework } = options;

  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
  const sanitizedTokens = tokens.map(t => t.replace(/[%_]/g, '\\$&'));

  if (sanitizedTokens.length === 0) {
    return [];
  }

  const tokenMatchCases = sanitizedTokens
    .map(
      () =>
        'CASE WHEN (symbols.name ILIKE ? OR symbols.signature ILIKE ? OR (symbols.description IS NOT NULL AND symbols.description ILIKE ?)) THEN 1 ELSE 0 END'
    )
    .join(' + ');
  const tokenBindings = sanitizedTokens.flatMap(token => [`%${token}%`, `%${token}%`, `%${token}%`]);

  const primaryToken = sanitizedTokens[0];
  const exactMatchBoost = `
    CASE
      WHEN symbols.name ILIKE ? THEN 1000
      WHEN symbols.name ILIKE ? THEN 100
      WHEN symbols.name ILIKE ? THEN 10
      ELSE 0
    END
  `;
  const exactBindings = [primaryToken, `${primaryToken}%`, `%${primaryToken}%`];

  let queryBuilder = db('symbols')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .select(
      'symbols.*',
      'files.path as file_path',
      'files.language as file_language',
      db.raw(`(${tokenMatchCases}) as token_match_score`, tokenBindings),
      db.raw(`(${exactMatchBoost}) as exact_match_boost`, exactBindings)
    );

  // WHERE clause: match at least one token
  queryBuilder = queryBuilder.where(function () {
    sanitizedTokens.forEach(token => {
      this.orWhere(function () {
        this.where('symbols.name', 'ilike', `%${token}%`)
          .orWhere('symbols.signature', 'ilike', `%${token}%`)
          .orWhere(function () {
            this.whereNotNull('symbols.description').andWhere(
              'symbols.description',
              'ilike',
              `%${token}%`
            );
          });
      });
    });
  });

  // Apply filters
  if (repoIds.length > 0) {
    queryBuilder = queryBuilder.whereIn('files.repo_id', repoIds);
  }

  if (symbolTypes.length > 0) {
    queryBuilder = queryBuilder.whereIn('symbols.symbol_type', symbolTypes);
  }

  if (isExported !== undefined) {
    queryBuilder = queryBuilder.where('symbols.is_exported', isExported);
  }

  if (framework) {
    switch (framework.toLowerCase()) {
      case 'laravel':
        queryBuilder = queryBuilder.where(function () {
          this.where('files.language', 'php')
            .orWhere('files.path', 'ilike', '%/app/%')
            .orWhere('files.path', 'ilike', '%laravel%');
        });
        break;
      case 'vue':
        queryBuilder = queryBuilder.where(function () {
          this.where('files.language', 'vue').orWhere('files.path', 'ilike', '%.vue');
        });
        break;
      case 'react':
        queryBuilder = queryBuilder.where(function () {
          this.where('files.language', 'javascript')
            .orWhere('files.language', 'typescript')
            .orWhere('files.path', 'ilike', '%.jsx')
            .orWhere('files.path', 'ilike', '%.tsx');
        });
        break;
      case 'node':
        queryBuilder = queryBuilder.where(function () {
          this.where('files.language', 'javascript')
            .orWhere('files.language', 'typescript')
            .orWhere('files.path', 'ilike', '%server%')
            .orWhere('files.path', 'ilike', '%api%');
        });
        break;
      default:
        queryBuilder = queryBuilder.where('files.language', 'ilike', `%${framework}%`);
    }
  }

  // Order by: token match count DESC, exact match boost DESC, name
  const results = await queryBuilder
    .orderBy('token_match_score', 'desc')
    .orderBy('exact_match_boost', 'desc')
    .orderBy('symbols.name')
    .limit(limit);

  return formatSymbolResults(results);
}

/**
 * Check if full-text search infrastructure is available for specific repositories.
 * Returns false if no symbols have populated search_vector, indicating FTS triggers aren't working.
 */
async function isFullTextSearchReady(db: Knex, repoIds: number[]): Promise<boolean> {
  if (repoIds.length === 0) {
    return false;
  }
  try {
    const result = await db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .whereIn('files.repo_id', repoIds)
      .whereNotNull('symbols.search_vector')
      .whereRaw("symbols.search_vector != ''::tsvector")
      .first();
    return !!result;
  } catch (error) {
    logger.debug(`Full-text search readiness check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

/**
 * Full-text search using PostgreSQL tsvector with fallback to lexical search
 */
async function fullTextSearch(
  db: Knex,
  query: string,
  repoIds: number[],
  options: SymbolSearchOptions
): Promise<SymbolWithFile[]> {
  const { limit = 100, symbolTypes = [], isExported, framework } = options;

  const sanitizedQuery = query
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0)
    .join(' & ');

  if (!sanitizedQuery) {
    return lexicalSearch(db, query, repoIds, options);
  }

  const ftsReady = await isFullTextSearchReady(db, repoIds);
  if (!ftsReady) {
    return lexicalSearch(db, query, repoIds, options);
  }


  try {
    let queryBuilder = db('symbols')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .select(
        'symbols.*',
        'files.path as file_path',
        'files.language as file_language',
        db.raw('ts_rank_cd(symbols.search_vector, to_tsquery(?)) as rank', [sanitizedQuery])
      )
      .where(db.raw('symbols.search_vector @@ to_tsquery(?)', [sanitizedQuery]));

    // Apply filters
    if (repoIds.length > 0) {
      queryBuilder = queryBuilder.whereIn('files.repo_id', repoIds);
    }

    if (symbolTypes.length > 0) {
      queryBuilder = queryBuilder.whereIn('symbols.symbol_type', symbolTypes);
    }

    if (isExported !== undefined) {
      queryBuilder = queryBuilder.where('symbols.is_exported', isExported);
    }

    if (framework) {
      // Map framework to appropriate file language/path patterns
      switch (framework.toLowerCase()) {
        case 'laravel':
          queryBuilder = queryBuilder.where(function () {
            this.where('files.language', 'php')
              .orWhere('files.path', 'ilike', '%/app/%')
              .orWhere('files.path', 'ilike', '%laravel%');
          });
          break;
        case 'vue':
          queryBuilder = queryBuilder.where(function () {
            this.where('files.language', 'vue').orWhere('files.path', 'ilike', '%.vue');
          });
          break;
        case 'react':
          queryBuilder = queryBuilder.where(function () {
            this.where('files.language', 'javascript')
              .orWhere('files.language', 'typescript')
              .orWhere('files.path', 'ilike', '%.jsx')
              .orWhere('files.path', 'ilike', '%.tsx');
          });
          break;
        case 'node':
          queryBuilder = queryBuilder.where(function () {
            this.where('files.language', 'javascript')
              .orWhere('files.language', 'typescript')
              .orWhere('files.path', 'ilike', '%server%')
              .orWhere('files.path', 'ilike', '%api%');
          });
          break;
        default:
          // Fallback to the original behavior for unknown frameworks
          queryBuilder = queryBuilder.where('files.language', 'ilike', `%${framework}%`);
      }
    }

    const results = await queryBuilder
      .orderBy('rank', 'desc')
      .orderBy('symbols.name')
      .limit(limit);

    return formatSymbolResults(results);
  } catch (error) {
    logger.warn(`Full-text search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return lexicalSearch(db, query, repoIds, options);
  }
}

/**
 * Check if vector search is available for specific repositories
 */
async function isVectorSearchReady(db: Knex, repoIds: number[]): Promise<boolean> {
  if (repoIds.length === 0) {
    return false;
  }
  try {
    const result = await db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .whereIn('files.repo_id', repoIds)
      .whereNotNull('symbols.combined_embedding')
      .first();
    return !!result;
  } catch (error) {
    return false;
  }
}

/**
 * Vector similarity search using pgvector embeddings - FAIL FAST
 *
 * Optimizations:
 * - Uses combined_embedding for single-vector search (faster than dual similarity)
 * - Filters by repo_id first via files(repo_id, id) index
 * - Leverages symbols(file_id) INCLUDE index for covering index benefits
 * - Orders by distance ascending (smallest distance = most similar first)
 */
export async function vectorSearch(
  db: Knex,
  query: string,
  repoIds: number[],
  options: VectorSearchOptions = {}
): Promise<SymbolWithFile[]> {
  logger.info(`[VECTOR SEARCH DB] Starting vector search for query: "${query}"`);
  logger.info(`[VECTOR SEARCH DB] Repo IDs: ${JSON.stringify(repoIds)}`);

  const isReady = await isVectorSearchReady(db, repoIds);
  logger.info(`[VECTOR SEARCH DB] Vector search ready: ${isReady}`);
  if (!isReady) {
    throw new Error(
      'Vector search unavailable: No embeddings found in database. Run embedding population first.'
    );
  }

  // Generate embedding for the query (with caching)
  logger.info('[VECTOR SEARCH DB] Generating query embedding...');
  const queryEmbedding = await getCachedEmbedding(query);

  if (!queryEmbedding || queryEmbedding.length !== 1024) {
    logger.error(`[VECTOR SEARCH DB] Invalid query embedding: length=${queryEmbedding?.length}`);
    throw new Error('Failed to generate valid query embedding');
  }
  logger.info('[VECTOR SEARCH DB] Query embedding generated successfully');

  const { limit = 100, symbolTypes, isExported, similarityThreshold = 0.5 } = options;
  logger.info(
    `[VECTOR SEARCH DB] Search parameters: limit=${limit}, threshold=${similarityThreshold}`
  );

  const baseQuery = db('symbols as s')
    .select([
      's.*',
      'f.path as file_path',
      'f.language as file_language',
      'r.name as repo_name',
      db.raw('(1 - (s.combined_embedding <=> ?)) as vector_score', [
        JSON.stringify(queryEmbedding),
      ]),
    ])
    .join('files as f', 's.file_id', 'f.id')
    .join('repositories as r', 'f.repo_id', 'r.id')
    .whereIn('f.repo_id', repoIds)
    .whereNotNull('s.combined_embedding')
    .whereRaw('(1 - (s.combined_embedding <=> ?)) >= ?', [
      JSON.stringify(queryEmbedding),
      similarityThreshold,
    ])
    .orderByRaw('s.combined_embedding <=> ?', [JSON.stringify(queryEmbedding)])
    .limit(limit);

  // Apply additional filters
  if (symbolTypes?.length) {
    baseQuery.whereIn('s.symbol_type', symbolTypes);
  }

  if (isExported) {
    baseQuery.where('s.is_exported', true);
  }

  logger.info('[VECTOR SEARCH DB] Executing vector search query...');
  const results = await baseQuery;

  logger.info(`[VECTOR SEARCH DB] Query returned ${results.length} results`);
  if (results.length > 0) {
    const topScore = (results[0] as any)?.vector_score || 0;
    const bottomScore = (results[results.length - 1] as any)?.vector_score || 0;
    logger.info(
      `[VECTOR SEARCH DB] Score range: ${topScore.toFixed(3)} to ${bottomScore.toFixed(3)}`
    );
  }

  const formattedResults = formatSymbolResults(results);
  return formattedResults.map((result: any) => ({
    ...result,
    match_type: 'vector' as const,
    search_rank: result.vector_score,
  }));
}


/**
 * Hybrid search combining multiple search strategies with explicit weights
 */
export async function hybridSearch(
  db: Knex,
  query: string,
  repoIds: number[],
  options: HybridSearchOptions = {}
): Promise<SymbolWithFile[]> {
  const { limit = 100, weights } = options;

  // Use provided weights or defaults
  const searchWeights = weights || {
    lexical: 0.3,
    vector: 0.4,
    fulltext: 0.3,
  };

  // Run multiple search strategies in parallel with graceful fallback for vector search
  const lexicalPromise = lexicalSearch(db, query, repoIds, {
    ...options,
    limit: Math.ceil(limit * 0.7),
  });
  const vectorPromise = vectorSearch(db, query, repoIds, {
    ...options,
    limit: Math.ceil(limit * 0.7),
  }).catch(error => {
    return [];
  });
  const fullTextPromise = fullTextSearch(db, query, repoIds, {
    ...options,
    limit: Math.ceil(limit * 0.7),
  });

  const [lexicalResults, vectorResults, fullTextResults] = await Promise.all([
    lexicalPromise,
    vectorPromise,
    fullTextPromise,
  ]);

  // Merge and rank results with explicit weights
  return rankAndMergeResults(lexicalResults, vectorResults, fullTextResults, searchWeights, {
    limit,
  });
}

/**
 * Merge and rank results from different search strategies with explicit weights
 */
function rankAndMergeResults(
  lexicalResults: SymbolWithFile[],
  vectorResults: SymbolWithFile[],
  fullTextResults: SymbolWithFile[],
  weights: { lexical: number; vector: number; fulltext: number },
  options: { limit?: number }
): SymbolWithFile[] {
  const { limit = 100 } = options;
  const resultMap = new Map<
    number,
    { symbol: SymbolWithFile; scores: number[]; sources: string[] }
  >();

  // Process lexical results
  lexicalResults.forEach((symbol, index) => {
    const score = Math.max(0.1, 1 - index / lexicalResults.length);
    if (!resultMap.has(symbol.id)) {
      resultMap.set(symbol.id, { symbol, scores: [0, 0, 0], sources: [] });
    }
    const entry = resultMap.get(symbol.id)!;
    entry.scores[0] = score;
    entry.sources.push('lexical');
  });

  // Process vector results (placeholder)
  vectorResults.forEach((symbol, index) => {
    const score = Math.max(0.1, 1 - index / vectorResults.length);
    if (!resultMap.has(symbol.id)) {
      resultMap.set(symbol.id, { symbol, scores: [0, 0, 0], sources: [] });
    }
    const entry = resultMap.get(symbol.id)!;
    entry.scores[1] = score;
    entry.sources.push('vector');
  });

  // Process full-text results
  fullTextResults.forEach((symbol, index) => {
    const score = Math.max(0.1, 1 - index / fullTextResults.length);
    if (!resultMap.has(symbol.id)) {
      resultMap.set(symbol.id, { symbol, scores: [0, 0, 0], sources: [] });
    }
    const entry = resultMap.get(symbol.id)!;
    entry.scores[2] = score;
    entry.sources.push('fulltext');
  });

  // Calculate final scores
  const rankedResults = Array.from(resultMap.values())
    .map(entry => {
      const finalScore =
        entry.scores[0] * weights.lexical +
        entry.scores[1] * weights.vector +
        entry.scores[2] * weights.fulltext;

      return {
        symbol: entry.symbol,
        score: finalScore,
        sources: entry.sources,
      };
    })
    // Phase 4: Return all results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return rankedResults.map(result => result.symbol);
}

/**
 * Format symbol results to consistent SymbolWithFile format
 */
function formatSymbolResults(results: any[]): SymbolWithFile[] {
  return results.map(result => ({
    ...result,
    file: {
      id: result.file_id,
      path: result.file_path,
      language: result.file_language,
    },
  })) as SymbolWithFile[];
}

/**
 * Search routes by framework, method, or path pattern
 */
export async function searchRoutes(db: Knex, options: RouteSearchOptions): Promise<Route[]> {
  let query = db('routes').select('*');

  if (options.repo_id) {
    query = query.where('repo_id', options.repo_id);
  }

  if (options.framework) {
    query = query.where('framework_type', options.framework);
  }

  if (options.method) {
    query = query.where('method', options.method.toUpperCase());
  }

  if (options.query) {
    query = query.where(builder => {
      builder
        .where('path', 'ilike', `%${options.query}%`)
        .orWhereRaw('middleware::text ILIKE ?', [`%${options.query}%`]);
    });
  }

  const routes = await query.orderBy('path').limit(options.limit || 50);

  return routes as Route[];
}

/**
 * Search components by name or type
 */
export async function searchComponents(db: Knex, options: ComponentSearchOptions): Promise<Component[]> {
  let query = db('components')
    .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
    .select('components.*');

  if (options.repo_id) {
    query = query.where('components.repo_id', options.repo_id);
  }

  if (options.component_type) {
    query = query.where('components.component_type', options.component_type);
  }

  if (options.query) {
    query = query.where('symbols.name', 'ilike', `%${options.query}%`);
  }

  const components = await query.orderBy('symbols.name').limit(options.limit || 50);

  return components.map(c => deserializeComponentJsonFields(c));
}

/**
 * Deserialize JSON fields in Component
 */
function deserializeComponentJsonFields(component: any): Component {
  return {
    ...component,
    props: typeof component.props === 'string' ? JSON.parse(component.props) : component.props,
    emits: component.emits && typeof component.emits === 'string' ? JSON.parse(component.emits) : component.emits,
    slots: component.slots && typeof component.slots === 'string' ? JSON.parse(component.slots) : component.slots,
    hooks: component.hooks && typeof component.hooks === 'string' ? JSON.parse(component.hooks) : component.hooks,
    template_dependencies: typeof component.template_dependencies === 'string'
      ? JSON.parse(component.template_dependencies)
      : component.template_dependencies,
  } as Component;
}

/**
 * Search composables by name or type
 */
export async function searchComposables(db: Knex, options: ComposableSearchOptions): Promise<Composable[]> {
  let query = db('composables')
    .leftJoin('symbols', 'composables.symbol_id', 'symbols.id')
    .select('composables.*');

  if (options.repo_id) {
    query = query.where('composables.repo_id', options.repo_id);
  }

  if (options.composable_type) {
    query = query.where('composables.composable_type', options.composable_type);
  }

  if (options.query) {
    query = query.where('symbols.name', 'ilike', `%${options.query}%`);
  }

  const composables = await query.orderBy('symbols.name').limit(options.limit || 50);

  return composables as Composable[];
}

/**
 * Search Godot scenes by name or path
 */
export async function searchGodotScenes(db: Knex, options: GodotSceneSearchOptions): Promise<GodotScene[]> {
  let query = db('godot_scenes').select('*');

  if (options.repo_id) {
    query = query.where('repo_id', options.repo_id);
  }

  if (options.has_script !== undefined) {
    query = query.where('has_script', options.has_script);
  }

  if (options.query) {
    query = query.where(function () {
      this.where('scene_name', 'ilike', `%${options.query}%`).orWhere(
        'scene_path',
        'ilike',
        `%${options.query}%`
      );
    });
  }

  const scenes = await query.orderBy('scene_path').limit(options.limit || 50);
  return scenes as GodotScene[];
}

/**
 * Search Godot nodes by name or type
 */
export async function searchGodotNodes(db: Knex, options: GodotNodeSearchOptions): Promise<GodotNode[]> {
  let query = db('godot_nodes').select('*');

  if (options.repo_id) {
    query = query.where('repo_id', options.repo_id);
  }

  if (options.scene_id) {
    query = query.where('scene_id', options.scene_id);
  }

  if (options.node_type) {
    query = query.where('node_type', options.node_type);
  }

  if (options.has_script !== undefined) {
    if (options.has_script) {
      query = query.whereNotNull('script_path');
    } else {
      query = query.whereNull('script_path');
    }
  }

  if (options.query) {
    query = query.where(function () {
      this.where('node_name', 'ilike', `%${options.query}%`).orWhere(
        'node_type',
        'ilike',
        `%${options.query}%`
      );
    });
  }

  const nodes = await query.orderBy('node_name').limit(options.limit || 50);
  return nodes as GodotNode[];
}

/**
 * Search symbols by qualified context (class context)
 */
export async function searchQualifiedContext(db: Knex, query: string, classContext?: string): Promise<SymbolWithFile[]> {
  let queryBuilder = db('dependencies')
    .join('symbols', 'dependencies.to_symbol_id', 'symbols.id')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .select(
      'symbols.*',
      'files.path as file_path',
      'files.language as file_language',
      'dependencies.qualified_context',
      'dependencies.resolved_class',
      'dependencies.calling_object'
    )
    .whereNotNull('dependencies.qualified_context');

  // Search in qualified context
  if (query && query.trim()) {
    queryBuilder = queryBuilder.where('dependencies.qualified_context', 'ilike', `%${query}%`);
  }

  // Filter by class context if provided
  if (classContext && classContext.trim()) {
    queryBuilder = queryBuilder.where(
      'dependencies.resolved_class',
      'ilike',
      `%${classContext}%`
    );
  }

  const results = await queryBuilder
    .groupBy(
      'symbols.id',
      'files.path',
      'files.language',
      'dependencies.qualified_context',
      'dependencies.resolved_class',
      'dependencies.calling_object'
    )
    .limit(100);

  return results.map(result => ({
    ...result,
    file: {
      id: result.file_id,
      path: result.file_path,
      language: result.file_language,
    },
  })) as SymbolWithFile[];
}

/**
 * Search symbols by method signature
 */
export async function searchMethodSignatures(db: Knex, query: string): Promise<SymbolWithFile[]> {
  const results = await db('dependencies')
    .join('symbols', 'dependencies.to_symbol_id', 'symbols.id')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .select(
      'symbols.*',
      'files.path as file_path',
      'files.language as file_language',
      'dependencies.method_signature',
      'dependencies.qualified_context'
    )
    .whereNotNull('dependencies.method_signature')
    .where('dependencies.method_signature', 'ilike', `%${query}%`)
    .groupBy(
      'symbols.id',
      'files.path',
      'files.language',
      'dependencies.method_signature',
      'dependencies.qualified_context'
    )
    .limit(100);

  return results.map(result => ({
    ...result,
    file: {
      id: result.file_id,
      path: result.file_path,
      language: result.file_language,
    },
  })) as SymbolWithFile[];
}

/**
 * Search symbols by namespace context
 */
export async function searchNamespaceContext(
  db: Knex,
  query: string,
  namespaceContext?: string
): Promise<SymbolWithFile[]> {
  let queryBuilder = db('dependencies')
    .join('symbols', 'dependencies.to_symbol_id', 'symbols.id')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .select(
      'symbols.*',
      'files.path as file_path',
      'files.language as file_language',
      'dependencies.namespace_context',
      'dependencies.qualified_context'
    )
    .whereNotNull('dependencies.namespace_context');

  if (query && query.trim()) {
    queryBuilder = queryBuilder.where(builder => {
      builder
        .where('dependencies.namespace_context', 'ilike', `%${query}%`)
        .orWhere('symbols.name', 'ilike', `%${query}%`);
    });
  }

  if (namespaceContext && namespaceContext.trim()) {
    queryBuilder = queryBuilder.where(
      'dependencies.namespace_context',
      'ilike',
      `%${namespaceContext}%`
    );
  }

  const results = await queryBuilder
    .groupBy(
      'symbols.id',
      'files.path',
      'files.language',
      'dependencies.namespace_context',
      'dependencies.qualified_context'
    )
    .limit(100);

  return results.map(result => ({
    ...result,
    file: {
      id: result.file_id,
      path: result.file_path,
      language: result.file_language,
    },
  })) as SymbolWithFile[];
}

/**
 * Paginated symbol search
 */
export async function searchSymbolsPaginated(
  db: Knex,
  options: SymbolSearchOptions & PaginationParams
): Promise<PaginatedResponse<SymbolWithFile>> {
  const { repoIds, symbolTypes, isExported, page_size, cursor, offset, ...searchOptions } =
    options;

  let queryBuilder = db('symbols')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .select('symbols.*', 'files.path as file_path', 'files.language as file_language')
    .orderBy('symbols.id', 'asc');

  // Apply filters
  if (repoIds && repoIds.length > 0) {
    queryBuilder = queryBuilder.whereIn('files.repository_id', repoIds);
  }

  if (symbolTypes && symbolTypes.length > 0) {
    queryBuilder = queryBuilder.whereIn('symbols.symbol_type', symbolTypes);
  }

  if (isExported !== undefined) {
    queryBuilder = queryBuilder.where('symbols.is_exported', isExported);
  }

  // Count query for total results (with same filters)
  let countQuery = db('symbols')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .count('* as count');

  if (repoIds && repoIds.length > 0) {
    countQuery = countQuery.whereIn('files.repository_id', repoIds);
  }
  if (symbolTypes && symbolTypes.length > 0) {
    countQuery = countQuery.whereIn('symbols.symbol_type', symbolTypes);
  }
  if (isExported !== undefined) {
    countQuery = countQuery.where('symbols.is_exported', isExported);
  }

  const result = await createPaginatedQuery<any>(
    queryBuilder,
    { page_size, cursor, offset },
    countQuery,
    'symbols.id'
  );

  // Transform results to match SymbolWithFile interface
  result.data = result.data.map(row => ({
    ...row,
    file: {
      id: row.file_id,
      path: row.file_path,
      language: row.file_language,
    },
  })) as SymbolWithFile[];

  return result;
}
