import type { Knex } from 'knex';
import { getDatabaseConnection, closeDatabaseConnection } from './connection';
import { PaginationParams, PaginatedResponse, createPaginatedQuery } from './pagination';
import { withCache, cacheable, queryCache } from './cache';
import {
  Repository,
  File,
  Symbol,
  Dependency,
  CreateRepository,
  CreateFile,
  CreateSymbol,
  CreateDependency,
  SymbolType,
  CreateFileDependency,
  FileDependency,
  FileWithRepository,
  SymbolWithFile,
  SymbolWithFileAndRepository,
  DependencyWithSymbols,
  EnhancedDependencyWithSymbols,
  // Framework-specific imports
  Route,
  Component,
  Composable,
  FrameworkMetadata,
  CreateRoute,
  CreateComponent,
  CreateComposable,
  CreateFrameworkMetadata,
  RouteWithSymbol,
  ComponentWithSymbol,
  ComposableWithSymbol,
  ComponentTree,
  RouteSearchOptions,
  ComponentSearchOptions,
  ComposableSearchOptions,
  RouteImpactRecord,
  JobImpactRecord,
  TestImpactRecord,
  // Phase 6 imports - Enhanced Search
  SymbolSearchOptions,
  VectorSearchOptions,
  HybridSearchOptions,
  SearchResult,
  // Phase 3 imports - Background Jobs
  JobQueue,
  JobDefinition,
  WorkerThread,
  CreateJobQueue,
  CreateJobDefinition,
  CreateWorkerThread,
  JobQueueType,
  WorkerType,
  // Phase 3 imports - ORM Entities
  ORMEntity,
  ORMRepository,
  CreateORMEntity,
  CreateORMRepository,
  ORMType,
  ORMRepositoryType,
  // Phase 3 imports - Workspace Projects
  WorkspaceProject,
  CreateWorkspaceProject,
  PackageManagerType,
  WorkspaceType,
  // Phase 5 imports - Cross-Stack Tracking
  ApiCall,
  DataContract,
  CreateApiCall,
  CreateDataContract,
  // Phase 7B imports - Godot Framework Entities
  GodotScene,
  GodotNode,
  GodotScript,
  GodotAutoload,
  GodotRelationship,
  CreateGodotScene,
  CreateGodotNode,
  CreateGodotScript,
  CreateGodotAutoload,
  CreateGodotRelationship,
  GodotRelationshipType,
  GodotEntityType,
  GodotSceneWithNodes,
  GodotNodeWithScript,
  GodotScriptWithScenes,
  GodotRelationshipWithEntities,
  GodotSceneSearchOptions,
  GodotNodeSearchOptions,
  GodotScriptSearchOptions,
  GodotRelationshipSearchOptions,
} from './models';
import { createComponentLogger } from '../utils/logger';
import { getEmbeddingService, EmbeddingService } from '../services/embedding-service';

const logger = createComponentLogger('database-services');

export class DatabaseService {
  private db: Knex;
  private embeddingService: EmbeddingService;
  private embeddingCache = new Map<string, number[]>();

  constructor() {
    this.db = getDatabaseConnection();
    this.embeddingService = getEmbeddingService();
  }

  // Getter for knex instance
  get knex(): Knex {
    return this.db;
  }

  /**
   * Safely parse parameter_types field from database
   * Handles both JSON arrays and legacy comma-separated strings
   */
  private safeParseParameterTypes(parameterTypes: any): string[] | undefined {
    if (!parameterTypes) return undefined;

    // If it's already an array, return it directly
    if (Array.isArray(parameterTypes)) {
      return parameterTypes;
    }

    // If it's a string, try to parse it
    if (typeof parameterTypes === 'string') {
      try {
        // Try parsing as JSON array first
        const parsed = JSON.parse(parameterTypes);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        // If not an array, fall back to string splitting
        return parameterTypes.split(',').map(s => s.trim());
      } catch (error) {
        // Fall back to comma-separated string parsing
        logger.warn('Failed to parse parameter_types as JSON', {
          error: error instanceof Error ? error.message : String(error),
        });
        return parameterTypes.split(',').map(s => s.trim());
      }
    }

    // If it's neither array nor string, return undefined
    logger.warn('Unexpected parameter_types type', { parameterTypes, type: typeof parameterTypes });
    return undefined;
  }

  // Repository operations
  async createRepository(data: CreateRepository): Promise<Repository> {
    // Convert framework_stack array to JSON for database storage
    const insertData = {
      ...data,
      framework_stack: JSON.stringify(data.framework_stack || []),
    };

    const [repository] = await this.db('repositories').insert(insertData).returning('*');

    // Parse JSON back to array for the returned object
    const result = repository as Repository;
    if (result.framework_stack && typeof result.framework_stack === 'string') {
      result.framework_stack = JSON.parse(result.framework_stack as string);
    }

    return result;
  }

  async getRepository(id: number): Promise<Repository | null> {
    const repository = await this.db('repositories').where({ id }).first();

    if (
      repository &&
      repository.framework_stack &&
      typeof repository.framework_stack === 'string'
    ) {
      repository.framework_stack = JSON.parse(repository.framework_stack);
    }

    return (repository as Repository) || null;
  }

  async getRepositoryByPath(path: string): Promise<Repository | null> {
    const repository = await this.db('repositories').where({ path }).first();

    if (
      repository &&
      repository.framework_stack &&
      typeof repository.framework_stack === 'string'
    ) {
      repository.framework_stack = JSON.parse(repository.framework_stack);
    }

    return (repository as Repository) || null;
  }

  async getRepositoryByName(name: string): Promise<Repository | null> {
    const repository = await this.db('repositories').where({ name }).first();

    if (!repository) {
      return null;
    }

    // Parse framework_stack JSON if it's a string
    if (repository.framework_stack && typeof repository.framework_stack === 'string') {
      repository.framework_stack = JSON.parse(repository.framework_stack);
    }

    return repository as Repository;
  }

  async getAllRepositories(): Promise<Repository[]> {
    const repositories = await this.db('repositories').select('*').orderBy('name');

    // Parse framework_stack JSON for all repositories
    return repositories.map(repo => {
      if (repo.framework_stack && typeof repo.framework_stack === 'string') {
        repo.framework_stack = JSON.parse(repo.framework_stack);
      }
      return repo as Repository;
    });
  }

  async updateRepository(id: number, data: Partial<CreateRepository>): Promise<Repository | null> {
    const [repository] = await this.db('repositories')
      .where({ id })
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return (repository as Repository) || null;
  }

  async deleteRepository(id: number): Promise<boolean> {
    const deletedCount = await this.db('repositories').where({ id }).del();
    return deletedCount > 0;
  }

  // Change detection queries for incremental updates
  async getRepositoryLastIndexed(repositoryId: number): Promise<Date | null> {
    const repo = await this.db('repositories')
      .select('last_indexed')
      .where('id', repositoryId)
      .first();
    return repo?.last_indexed || null;
  }

  async findModifiedFilesSince(repositoryId: number, since: Date): Promise<File[]> {
    const files = await this.db('files')
      .where('repo_id', repositoryId)
      .where('last_modified', '>', since)
      .select('*');
    return files as File[];
  }

  async findFilesNotInDatabase(
    repositoryId: number,
    currentFilePaths: string[]
  ): Promise<string[]> {
    if (currentFilePaths.length === 0) {
      return [];
    }

    const existingFiles = await this.db('files')
      .where('repo_id', repositoryId)
      .whereIn('path', currentFilePaths)
      .select('path');

    const existingPaths = existingFiles.map(f => f.path);
    return currentFilePaths.filter(path => !existingPaths.includes(path));
  }

  async findOrphanedFiles(repositoryId: number, currentFilePaths: string[]): Promise<File[]> {
    if (currentFilePaths.length === 0) {
      // If no current files, all existing files are orphaned
      return (await this.db('files').where('repo_id', repositoryId).select('*')) as File[];
    }

    const orphanedFiles = await this.db('files')
      .where('repo_id', repositoryId)
      .whereNotIn('path', currentFilePaths)
      .select('*');

    return orphanedFiles as File[];
  }

  // File operations
  async createFile(data: CreateFile): Promise<File> {
    // Try to find existing file first
    const existingFile = await this.db('files')
      .where({ repo_id: data.repo_id, path: data.path })
      .first();

    if (existingFile) {
      // Update existing file
      const [file] = await this.db('files')
        .where({ id: existingFile.id })
        .update({ ...data, updated_at: new Date() })
        .returning('*');
      return file as File;
    } else {
      // Insert new file
      const [file] = await this.db('files').insert(data).returning('*');
      return file as File;
    }
  }

  async createFilesBatch(files: CreateFile[]): Promise<File[]> {
    return await this.db.transaction(async trx => {
      const results: File[] = [];

      for (const data of files) {
        const existingFile = await trx('files')
          .where({ repo_id: data.repo_id, path: data.path })
          .first();

        if (existingFile) {
          const [file] = await trx('files')
            .where({ id: existingFile.id })
            .update({ ...data, updated_at: new Date() })
            .returning('*');
          results.push(file as File);
        } else {
          const [file] = await trx('files').insert(data).returning('*');
          results.push(file as File);
        }
      }

      return results;
    });
  }

  async getFile(id: number): Promise<File | null> {
    const file = await this.db('files').where({ id }).first();
    return (file as File) || null;
  }

  async getFileWithRepository(id: number): Promise<FileWithRepository | null> {
    const result = await this.db('files')
      .leftJoin('repositories', 'files.repo_id', 'repositories.id')
      .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
      .where('files.id', id)
      .first();

    if (!result) return null;

    return {
      ...result,
      repository: {
        id: result.repo_id,
        name: result.repo_name,
        path: result.repo_path,
      } as Repository,
    } as FileWithRepository;
  }

  async getFileByPath(path: string): Promise<FileWithRepository | null> {
    // Try exact path match first
    let result = await this.db('files')
      .leftJoin('repositories', 'files.repo_id', 'repositories.id')
      .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
      .where('files.path', path)
      .first();

    if (result) {
      return {
        ...result,
        repository: {
          id: result.repo_id,
          name: result.repo_name,
          path: result.repo_path,
        } as Repository,
      } as FileWithRepository;
    }

    // If no exact match, try filename match (just the basename)
    const basename = require('path').basename(path);
    const filenameResults = await this.db('files')
      .leftJoin('repositories', 'files.repo_id', 'repositories.id')
      .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
      .whereRaw('files.path LIKE ?', [`%/${basename}`])
      .limit(1);

    if (filenameResults.length > 0) {
      const result = filenameResults[0];
      return {
        ...result,
        repository: {
          id: result.repo_id,
          name: result.repo_name,
          path: result.repo_path,
        } as Repository,
      } as FileWithRepository;
    }

    // If still no match, try relative path matching (ends with the given path)
    if (!path.startsWith('/')) {
      const relativeResults = await this.db('files')
        .leftJoin('repositories', 'files.repo_id', 'repositories.id')
        .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
        .whereRaw('files.path LIKE ?', [`%/${path}`])
        .limit(1);

      if (relativeResults.length > 0) {
        const result = relativeResults[0];
        return {
          ...result,
          repository: {
            id: result.repo_id,
            name: result.repo_name,
            path: result.repo_path,
          } as Repository,
        } as FileWithRepository;
      }
    }

    return null;
  }

  async getFilesByRepository(repoId: number): Promise<File[]> {
    const files = await this.db('files').where({ repo_id: repoId }).orderBy('path');
    return files as File[];
  }

  async updateFile(id: number, data: Partial<CreateFile>): Promise<File | null> {
    const [file] = await this.db('files')
      .where({ id })
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return (file as File) || null;
  }

  async deleteFile(id: number): Promise<boolean> {
    const deletedCount = await this.db('files').where({ id }).del();
    return deletedCount > 0;
  }

  // Symbol operations
  async getSymbolsByRepository(repoId: number): Promise<Symbol[]> {
    const symbols = await this.db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .select('symbols.*')
      .orderBy('symbols.name');
    return symbols as Symbol[];
  }

  async getSymbolsForEmbedding(
    repoId: number,
    limit: number,
    afterId: number = 0
  ): Promise<Symbol[]> {
    const symbols = await this.db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .where('symbols.id', '>', afterId)
      .whereNull('symbols.combined_embedding')
      .select('symbols.*')
      .orderBy('symbols.id')
      .limit(limit);
    return symbols as Symbol[];
  }

  async countSymbolsNeedingEmbeddings(repoId: number): Promise<number> {
    const result = await this.db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .whereNull('symbols.combined_embedding')
      .count('* as count')
      .first();
    return Number(result?.count || 0);
  }

  async createSymbol(data: CreateSymbol): Promise<Symbol> {
    const [symbol] = await this.db('symbols').insert(data).returning('*');

    // Check if search_vector was populated by the PostgreSQL trigger
    // If not, manually populate it (important for test environments)
    try {
      const symbolWithVector = await this.db('symbols')
        .where('id', symbol.id)
        .whereNotNull('search_vector')
        .first();

      if (!symbolWithVector) {
        // Manually create tsvector like the trigger would
        const searchText = [data.name || '', data.signature || ''].join(' ').trim();

        await this.db('symbols')
          .where('id', symbol.id)
          .update({
            search_vector: this.db.raw("to_tsvector('english', ?)", [searchText]),
          });
      }
    } catch (error) {
      // If manual search_vector creation fails, log but don't fail the symbol creation
      logger.warn('Failed to manually populate search_vector', { error: (error as Error).message });
    }

    return symbol as Symbol;
  }

  /**
   * Create symbol with embeddings synchronously
   */
  async createSymbolWithEmbeddings(data: CreateSymbol): Promise<Symbol> {
    const [symbol] = await this.db('symbols').insert(data).returning('*');

    // Generate embeddings synchronously
    await this.generateSymbolEmbeddings(symbol.id, symbol.name, symbol.description);

    return symbol as Symbol;
  }

  async createSymbols(symbols: CreateSymbol[]): Promise<Symbol[]> {
    if (symbols.length === 0) return [];

    // Break into smaller batches for better memory management and transaction performance
    const BATCH_SIZE = 50;
    const results: Symbol[] = [];

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      const batchResults = await this.db('symbols').insert(batch).returning('*');
      results.push(...(batchResults as Symbol[]));
    }

    return results;
  }

  /**
   * Create symbols with embeddings and progress feedback
   */
  async createSymbolsWithEmbeddings(
    symbols: CreateSymbol[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<Symbol[]> {
    if (symbols.length === 0) return [];

    const BATCH_SIZE = 50;
    const results: Symbol[] = [];

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      const batchResults = await this.db('symbols').insert(batch).returning('*');
      results.push(...(batchResults as Symbol[]));

      // Generate embeddings for batch synchronously with progress
      await this.batchGenerateEmbeddings(batchResults as Symbol[]);

      if (onProgress) {
        onProgress(Math.min(i + BATCH_SIZE, symbols.length), symbols.length);
      }
    }

    return results;
  }

  /**
   * Validate that search infrastructure is working properly
   * Creates a test symbol, verifies it can be found, then cleans up
   * Useful for test environments to ensure search is functional
   */
  async validateSearchInfrastructure(repoId: number): Promise<boolean> {
    const testSymbolName = 'TestSearchValidationSymbol_' + Date.now();
    let testFileId: number | null = null;
    let testSymbolId: number | null = null;

    try {
      // Create a temporary test file
      const testFile = await this.createFile({
        repo_id: repoId,
        path: `/test/validation/${testSymbolName}.php`,
        language: 'php',
        is_generated: false,
        is_test: true,
      });
      testFileId = testFile.id;

      // Create a test symbol
      const testSymbol = await this.createSymbol({
        file_id: testFileId,
        name: testSymbolName,
        symbol_type: SymbolType.CLASS,
        is_exported: true,
        signature: `class ${testSymbolName} extends TestModel`,
      });
      testSymbolId = testSymbol.id;

      // Wait a moment for any async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to search for the test symbol using different search methods
      const searchResults = await this.searchSymbols(testSymbolName, repoId, { limit: 10 });
      const lexicalResults = await this.lexicalSearchSymbols(testSymbolName, repoId, { limit: 10 });

      // Check if the symbol was found
      const foundInSearch = searchResults.some(s => s.id === testSymbolId);
      const foundInLexical = lexicalResults.some(s => s.id === testSymbolId);

      return foundInSearch || foundInLexical;
    } catch (error) {
      logger.warn('Search infrastructure validation failed', {
        error: (error as Error).message,
        testSymbolName,
      });
      return false;
    } finally {
      // Clean up test data
      try {
        if (testSymbolId) {
          await this.db('symbols').where('id', testSymbolId).del();
        }
        if (testFileId) {
          await this.db('files').where('id', testFileId).del();
        }
      } catch (cleanupError) {
        logger.warn('Failed to clean up test data', {
          error: (cleanupError as Error).message,
          testSymbolId,
          testFileId,
        });
      }
    }
  }

  async getSymbol(id: number): Promise<Symbol | null> {
    const symbol = await this.db('symbols').where({ id }).first();
    return (symbol as Symbol) || null;
  }

  async getSymbolWithFile(id: number): Promise<SymbolWithFileAndRepository | null> {
    const result = await this.db('symbols')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .leftJoin('repositories', 'files.repo_id', 'repositories.id')
      .select(
        'symbols.*',
        'files.path as file_path',
        'files.language as file_language',
        'repositories.name as repo_name',
        'repositories.path as repo_path'
      )
      .where('symbols.id', id)
      .first();

    if (!result) return null;

    return {
      ...result,
      file: {
        id: result.file_id,
        path: result.file_path,
        language: result.file_language,
        repository: {
          name: result.repo_name,
          path: result.repo_path,
        },
      },
    } as SymbolWithFileAndRepository;
  }

  async getSymbolsByFile(fileId: number): Promise<Symbol[]> {
    const symbols = await this.db('symbols')
      .where({ file_id: fileId })
      .orderBy(['start_line', 'name']);
    return symbols as Symbol[];
  }

  /**
   * Search symbols with explicit search mode selection
   */
  async searchSymbols(
    query: string,
    repoId?: number,
    options: SymbolSearchOptions = {}
  ): Promise<SymbolWithFile[]> {
    const { limit = 100, symbolTypes = [], isExported, framework, repoIds = [] } = options;

    // Determine which repositories to search
    const effectiveRepoIds = repoIds.length > 0 ? repoIds : repoId ? [repoId] : [];

    if (effectiveRepoIds.length === 0) {
      logger.warn('No repositories specified for search');
      return [];
    }

    // Default to fulltext search for backwards compatibility
    return this.fullTextSearch(query, effectiveRepoIds, options);
  }

  /**
   * Lexical search (exact name matches)
   */
  async lexicalSearchSymbols(
    query: string,
    repoId?: number,
    options: SymbolSearchOptions = {}
  ): Promise<SymbolWithFile[]> {
    const repoIds = options.repoIds?.length ? options.repoIds : repoId ? [repoId] : [];
    return this.lexicalSearch(query, repoIds, options);
  }

  /**
   * Vector search (embedding-based similarity)
   */
  async vectorSearchSymbols(
    query: string,
    repoId?: number,
    options: VectorSearchOptions = {}
  ): Promise<SymbolWithFile[]> {
    const repoIds = options.repoIds?.length ? options.repoIds : repoId ? [repoId] : [];
    return this.vectorSearch(query, repoIds, options);
  }

  /**
   * Fulltext search (PostgreSQL FTS)
   */
  async fulltextSearchSymbols(
    query: string,
    repoId?: number,
    options: SymbolSearchOptions = {}
  ): Promise<SymbolWithFile[]> {
    const repoIds = options.repoIds?.length ? options.repoIds : repoId ? [repoId] : [];
    return this.fullTextSearch(query, repoIds, options);
  }

  /**
   * Hybrid search (combines all search methods)
   */
  async hybridSearchSymbols(
    query: string,
    repoId?: number,
    options: HybridSearchOptions = {}
  ): Promise<SymbolWithFile[]> {
    const repoIds = options.repoIds?.length ? options.repoIds : repoId ? [repoId] : [];
    return this.hybridSearch(query, repoIds, options);
  }

  /**
   * Enhanced lexical search with fuzzy matching and better ranking
   */
  private async lexicalSearch(
    query: string,
    repoIds: number[],
    options: SymbolSearchOptions
  ): Promise<SymbolWithFile[]> {
    const { limit = 30, symbolTypes = [], isExported, framework } = options;

    // Tokenize multi-word queries and search for any token
    const tokens = query
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);
    const fuzzyTokens = tokens.map(t => t.replace(/[%_]/g, '\\$&'));

    // Build token match score - count how many query tokens match each result
    const tokenMatchCases = fuzzyTokens
      .map(
        token =>
          `CASE WHEN (symbols.name ILIKE '%${token}%' OR symbols.signature ILIKE '%${token}%' OR (symbols.description IS NOT NULL AND symbols.description ILIKE '%${token}%')) THEN 1 ELSE 0 END`
      )
      .join(' + ');

    // Build exact match boost for first token (primary term)
    const primaryToken = fuzzyTokens[0] || '';
    const exactMatchBoost = `
      CASE
        WHEN symbols.name ILIKE '${primaryToken}' THEN 1000
        WHEN symbols.name ILIKE '${primaryToken}%' THEN 100
        WHEN symbols.name ILIKE '%${primaryToken}%' THEN 10
        ELSE 0
      END
    `;

    let queryBuilder = this.db('symbols')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .select(
        'symbols.*',
        'files.path as file_path',
        'files.language as file_language',
        this.db.raw(`(${tokenMatchCases}) as token_match_score`),
        this.db.raw(`(${exactMatchBoost}) as exact_match_boost`)
      );

    // WHERE clause: match at least one token
    queryBuilder = queryBuilder.where(function () {
      fuzzyTokens.forEach(token => {
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

    return this.formatSymbolResults(results);
  }

  /**
   * Full-text search using PostgreSQL tsvector with fallback to lexical search
   */
  private async fullTextSearch(
    query: string,
    repoIds: number[],
    options: SymbolSearchOptions
  ): Promise<SymbolWithFile[]> {
    const { limit = 100, symbolTypes = [], isExported, framework } = options;

    // Sanitize query for ts_query
    const sanitizedQuery = query
      .replace(/[^\w\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(word => word.length > 0)
      .join(' & ');

    if (!sanitizedQuery) {
      return this.lexicalSearch(query, repoIds, options);
    }

    try {
      // Try PostgreSQL full-text search first
      let queryBuilder = this.db('symbols')
        .leftJoin('files', 'symbols.file_id', 'files.id')
        .select(
          'symbols.*',
          'files.path as file_path',
          'files.language as file_language',
          this.db.raw('ts_rank_cd(symbols.search_vector, to_tsquery(?)) as rank', [sanitizedQuery])
        )
        .where(this.db.raw('symbols.search_vector @@ to_tsquery(?)', [sanitizedQuery]));

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

      const formattedResults = this.formatSymbolResults(results);

      // If PostgreSQL FTS returns empty results, fall back to lexical search
      // This handles cases where search_vector is NULL (e.g., trigger not working in tests)
      if (formattedResults.length === 0) {
        return this.lexicalSearch(query, repoIds, options);
      }

      return formattedResults;
    } catch (error) {
      // Fallback to lexical search if PostgreSQL FTS fails (e.g., in mocked tests)
      return this.lexicalSearch(query, repoIds, options);
    }
  }

  /**
   * Check if vector search is available
   */
  private async isVectorSearchReady(): Promise<boolean> {
    try {
      const result = await this.db('symbols').whereNotNull('combined_embedding').first();
      return !!result;
    } catch (error) {
      return false;
    }
  }

  /**
   * Vector similarity search using pgvector embeddings - FAIL FAST
   */
  async vectorSearch(
    query: string,
    repoIds: number[],
    options: VectorSearchOptions = {}
  ): Promise<SymbolWithFile[]> {
    logger.info(`[VECTOR SEARCH DB] Starting vector search for query: "${query}"`);
    logger.info(`[VECTOR SEARCH DB] Repo IDs: ${JSON.stringify(repoIds)}`);

    // Fail fast if vector search isn't ready
    const isReady = await this.isVectorSearchReady();
    logger.info(`[VECTOR SEARCH DB] Vector search ready: ${isReady}`);
    if (!isReady) {
      throw new Error(
        'Vector search unavailable: No embeddings found in database. Run embedding population first.'
      );
    }

    const isInitialized = await this.embeddingService.initialized;
    logger.info(`[VECTOR SEARCH DB] Embedding service initialized: ${isInitialized}`);
    if (!isInitialized) {
      logger.info('[VECTOR SEARCH DB] Initializing embedding service...');
      await this.embeddingService.initialize();
    }

    // Generate embedding for the query (with caching)
    logger.info('[VECTOR SEARCH DB] Generating query embedding...');
    const queryEmbedding = await this.getCachedEmbedding(query);

    if (!queryEmbedding || queryEmbedding.length !== 1024) {
      logger.error(`[VECTOR SEARCH DB] Invalid query embedding: length=${queryEmbedding?.length}`);
      throw new Error('Failed to generate valid query embedding');
    }
    logger.info('[VECTOR SEARCH DB] Query embedding generated successfully');

    const { limit = 100, symbolTypes, isExported, similarityThreshold = 0.5 } = options;
    logger.info(
      `[VECTOR SEARCH DB] Search parameters: limit=${limit}, threshold=${similarityThreshold}`
    );

    // Build the base query using combined_embedding (2x faster than double similarity)
    const baseQuery = this.db('symbols as s')
      .select([
        's.*',
        'f.path as file_path',
        'f.language as file_language',
        'r.name as repo_name',
        // Use combined embedding for optimal speed and quality
        this.db.raw('(1 - (s.combined_embedding <=> ?)) as vector_score', [
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
      .orderByRaw('(1 - (s.combined_embedding <=> ?)) DESC', [JSON.stringify(queryEmbedding)])
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

    const formattedResults = this.formatSymbolResults(results);
    return formattedResults.map((result: any) => ({
      ...result,
      match_type: 'vector' as const,
      search_rank: result.vector_score,
    }));
  }

  /**
   * Hybrid search combining multiple search strategies with explicit weights
   */
  async hybridSearch(
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
    const lexicalPromise = this.lexicalSearch(query, repoIds, {
      ...options,
      limit: Math.ceil(limit * 0.7),
    });
    const vectorPromise = this.vectorSearch(query, repoIds, {
      ...options,
      limit: Math.ceil(limit * 0.7),
    }).catch(error => {
      return [];
    });
    const fullTextPromise = this.fullTextSearch(query, repoIds, {
      ...options,
      limit: Math.ceil(limit * 0.7),
    });

    const [lexicalResults, vectorResults, fullTextResults] = await Promise.all([
      lexicalPromise,
      vectorPromise,
      fullTextPromise,
    ]);

    // Merge and rank results with explicit weights
    return this.rankAndMergeResults(lexicalResults, vectorResults, fullTextResults, searchWeights, {
      limit,
    });
  }

  /**
   * Merge and rank results from different search strategies with explicit weights
   */
  private rankAndMergeResults(
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
  private formatSymbolResults(results: any[]): SymbolWithFile[] {
    return results.map(result => ({
      ...result,
      file: {
        id: result.file_id,
        path: result.file_path,
        language: result.file_language,
      },
    })) as SymbolWithFile[];
  }

  // Dependency operations
  async createDependency(data: CreateDependency): Promise<Dependency> {
    // Convert parameter_types array to JSON string for database storage
    const insertData = {
      ...data,
      parameter_types: data.parameter_types ? JSON.stringify(data.parameter_types) : null,
    };

    const [dependency] = await this.db('dependencies').insert(insertData).returning('*');
    return dependency as Dependency;
  }

  async createDependencies(dependencies: CreateDependency[]): Promise<Dependency[]> {
    if (dependencies.length === 0) return [];

    // Process in chunks to avoid PostgreSQL parameter limits
    const BATCH_SIZE = 1000;
    const results: Dependency[] = [];

    for (let i = 0; i < dependencies.length; i += BATCH_SIZE) {
      const chunk = dependencies.slice(i, i + BATCH_SIZE);

      // Convert parameter_types arrays to JSON strings for database storage
      const processedChunk = chunk.map(dep => ({
        ...dep,
        parameter_types: dep.parameter_types ? JSON.stringify(dep.parameter_types) : null,
      }));

      // Use upsert logic to handle duplicates - PostgreSQL ON CONFLICT
      const chunkResults = await this.db('dependencies')
        .insert(processedChunk)
        .onConflict(['from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number'])
        .merge([
          'line_number',
          'updated_at',
          'parameter_context',
          'call_instance_id',
          'parameter_types',
        ])
        .returning('*');

      results.push(...(chunkResults as Dependency[]));
    }

    return results;
  }

  // File dependency operations

  /**
   * Deduplicate file dependencies by keeping the first entry
   * for each unique combination of from_file_id, to_file_id, dependency_type
   */
  private deduplicateFileDependencies(
    dependencies: CreateFileDependency[]
  ): CreateFileDependency[] {
    const uniqueMap = new Map<string, CreateFileDependency>();

    for (const dep of dependencies) {
      const key = `${dep.from_file_id}-${dep.to_file_id}-${dep.dependency_type}`;
      const existing = uniqueMap.get(key);

      // Keep the first entry
      if (!existing) {
        uniqueMap.set(key, dep);
      }
    }

    return Array.from(uniqueMap.values());
  }

  async createFileDependencies(dependencies: CreateFileDependency[]): Promise<FileDependency[]> {
    if (dependencies.length === 0) return [];

    // Deduplicate before processing to prevent constraint violations
    const uniqueDependencies = this.deduplicateFileDependencies(dependencies);

    if (uniqueDependencies.length !== dependencies.length) {
      logger.warn('Removed duplicate file dependencies', {
        original: dependencies.length,
        unique: uniqueDependencies.length,
        duplicatesRemoved: dependencies.length - uniqueDependencies.length,
      });
    }

    // Process in chunks to handle large datasets efficiently
    const BATCH_SIZE = 1000;
    const results: FileDependency[] = [];

    for (let i = 0; i < uniqueDependencies.length; i += BATCH_SIZE) {
      const chunk = uniqueDependencies.slice(i, i + BATCH_SIZE);

      // Use upsert logic to handle duplicates - PostgreSQL ON CONFLICT
      const chunkResults = await this.db('file_dependencies')
        .insert(chunk)
        .onConflict(['from_file_id', 'to_file_id', 'dependency_type'])
        .merge(['line_number', 'updated_at'])
        .returning('*');

      results.push(...(chunkResults as FileDependency[]));
    }

    return results;
  }

  async getFileDependenciesByRepository(repoId: number): Promise<FileDependency[]> {
    const dependencies = await this.db('file_dependencies')
      .join('files as from_files', 'file_dependencies.from_file_id', 'from_files.id')
      .join('files as to_files', 'file_dependencies.to_file_id', 'to_files.id')
      .where('from_files.repo_id', repoId)
      .select('file_dependencies.*');
    return dependencies as FileDependency[];
  }

  async countFileDependenciesByRepository(repoId: number): Promise<number> {
    const result = await this.db('file_dependencies')
      .join('files as from_files', 'file_dependencies.from_file_id', 'from_files.id')
      .where('from_files.repo_id', repoId)
      .count('* as count')
      .first();
    return result ? Number(result.count) : 0;
  }

  async countSymbolDependenciesByRepository(repoId: number): Promise<number> {
    const result = await this.db('dependencies')
      .join('symbols', 'dependencies.from_symbol_id', 'symbols.id')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .count('* as count')
      .first();
    return result ? Number(result.count) : 0;
  }

  async getDependenciesFrom(symbolId: number): Promise<DependencyWithSymbols[]> {
    const results = await this.db('dependencies')
      .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
      .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .select(
        'dependencies.*',
        'to_symbols.name as to_symbol_name',
        'to_symbols.symbol_type as to_symbol_type',
        'to_files.path as to_file_path',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path'
      )
      .where('dependencies.from_symbol_id', symbolId)
      .distinct('dependencies.id');

    return results.map(result => ({
      ...result,
      from_symbol: {
        id: result.from_symbol_id,
        name: result.from_symbol_name,
        symbol_type: result.from_symbol_type,
        file: {
          id: result.from_file_id,
          path: result.from_file_path,
        },
      },
      to_symbol: {
        id: result.to_symbol_id,
        name: result.to_symbol_name,
        symbol_type: result.to_symbol_type,
        file: {
          id: result.to_file_id,
          path: result.to_file_path,
        },
      },
    })) as DependencyWithSymbols[];
  }

  async getDependenciesTo(symbolId: number): Promise<DependencyWithSymbols[]> {
    const results = await this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .select(
        'dependencies.*',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path'
      )
      .where('dependencies.to_symbol_id', symbolId)
      .distinct('dependencies.id');

    return results.map(result => ({
      ...result,
      from_symbol: {
        id: result.from_symbol_id,
        name: result.from_symbol_name,
        symbol_type: result.from_symbol_type,
        file: {
          id: result.from_file_id,
          path: result.from_file_path,
        },
      },
    })) as DependencyWithSymbols[];
  }

  // Cleanup methods for re-analysis
  async cleanupRepositoryData(repositoryId: number): Promise<void> {
    logger.info('Cleaning up repository data for re-analysis', { repositoryId });

    // Delete in correct order to respect foreign key constraints
    // 1. Delete dependencies first (they reference symbols)
    await this.db.transaction(async trx => {
      // Delete framework entities (they reference symbols)
      const deletedRoutes = await trx('routes').where('repo_id', repositoryId).del();
      const deletedApiCalls = await trx('api_calls').where('repo_id', repositoryId).del();
      const deletedComponents = await trx('components').where('repo_id', repositoryId).del();
      const deletedFrameworkMetadata = await trx('framework_metadata')
        .where('repo_id', repositoryId)
        .del();

      // Delete dependencies related to symbols in this repository
      const deletedDependencies = await trx('dependencies')
        .whereIn(
          'from_symbol_id',
          trx('symbols')
            .select('id')
            .whereIn('file_id', trx('files').select('id').where('repo_id', repositoryId))
        )
        .orWhereIn(
          'to_symbol_id',
          trx('symbols')
            .select('id')
            .whereIn('file_id', trx('files').select('id').where('repo_id', repositoryId))
        )
        .del();

      // Delete symbols in files belonging to this repository
      const deletedSymbols = await trx('symbols')
        .whereIn('file_id', trx('files').select('id').where('repo_id', repositoryId))
        .del();

      // Delete files belonging to this repository
      const deletedFiles = await trx('files').where('repo_id', repositoryId).del();

      logger.info('Repository cleanup completed', {
        repositoryId,
        deletedRoutes,
        deletedApiCalls,
        deletedComponents,
        deletedFrameworkMetadata,
        deletedDependencies,
        deletedSymbols,
        deletedFiles,
      });
    });
  }

  async cleanupFileData(fileIds: number[]): Promise<void> {
    if (fileIds.length === 0) return;

    logger.info('Cleaning up file data for incremental re-analysis', {
      fileIds,
      count: fileIds.length,
    });

    await this.db.transaction(async trx => {
      const symbolIds = await trx('symbols').whereIn('file_id', fileIds).pluck('id');

      logger.info('Found symbols to clean up', { symbolCount: symbolIds.length });

      const deletionResults: Record<string, number> = {};

      if (symbolIds.length > 0) {
        // Only delete dependencies FROM changed files, not TO them
        // Dependencies TO changed symbols use qualified names and will be re-resolved
        deletionResults.dependencies = await trx('dependencies')
          .whereIn('from_symbol_id', symbolIds)
          .del();

        const hasRoutes = await trx.schema.hasTable('routes');
        if (hasRoutes) {
          deletionResults.routes = await trx('routes')
            .whereIn('handler_symbol_id', symbolIds)
            .del();
        }

        const hasComponents = await trx.schema.hasTable('components');
        if (hasComponents) {
          deletionResults.components = await trx('components')
            .whereIn('symbol_id', symbolIds)
            .del();
        }

        const hasComposables = await trx.schema.hasTable('composables');
        if (hasComposables) {
          deletionResults.composables = await trx('composables')
            .whereIn('symbol_id', symbolIds)
            .del();
        }

        const hasOrmEntities = await trx.schema.hasTable('orm_entities');
        if (hasOrmEntities) {
          deletionResults.ormEntities = await trx('orm_entities')
            .whereIn('symbol_id', symbolIds)
            .del();
        }

        const hasJobQueues = await trx.schema.hasTable('job_queues');
        if (hasJobQueues) {
          deletionResults.jobQueues = await trx('job_queues').whereIn('symbol_id', symbolIds).del();
        }
      }

      deletionResults.fileDependencies = await trx('file_dependencies')
        .whereIn('from_file_id', fileIds)
        .orWhereIn('to_file_id', fileIds)
        .del();

      const hasTestSuites = await trx.schema.hasTable('test_suites');
      if (hasTestSuites) {
        deletionResults.testSuites = await trx('test_suites').whereIn('file_id', fileIds).del();
      }

      const hasGodotScenes = await trx.schema.hasTable('godot_scenes');
      if (hasGodotScenes) {
        const filePaths = await trx('files').whereIn('id', fileIds).pluck('path');

        const scenePaths = await trx('godot_scenes').whereIn('scene_path', filePaths).pluck('id');

        if (scenePaths.length > 0) {
          const hasGodotNodes = await trx.schema.hasTable('godot_nodes');
          if (hasGodotNodes) {
            deletionResults.godotNodes = await trx('godot_nodes')
              .whereIn('scene_id', scenePaths)
              .del();
          }

          const hasGodotRelationships = await trx.schema.hasTable('godot_relationships');
          if (hasGodotRelationships) {
            deletionResults.godotRelationships = await trx('godot_relationships')
              .where(function () {
                this.where('from_entity_type', 'scene')
                  .whereIn('from_entity_id', scenePaths)
                  .orWhere('to_entity_type', 'scene')
                  .whereIn('to_entity_id', scenePaths);
              })
              .del();
          }

          deletionResults.godotScenes = await trx('godot_scenes').whereIn('id', scenePaths).del();
        }
      }

      const hasGodotScripts = await trx.schema.hasTable('godot_scripts');
      if (hasGodotScripts) {
        const scriptPaths = await trx('files')
          .whereIn('id', fileIds)
          .where('language', 'csharp')
          .pluck('path');

        if (scriptPaths.length > 0) {
          const scriptIds = await trx('godot_scripts')
            .whereIn('script_path', scriptPaths)
            .pluck('id');

          if (scriptIds.length > 0) {
            const hasGodotAutoloads = await trx.schema.hasTable('godot_autoloads');
            if (hasGodotAutoloads) {
              deletionResults.godotAutoloads = await trx('godot_autoloads')
                .whereIn('script_id', scriptIds)
                .del();
            }

            const hasGodotRelationships = await trx.schema.hasTable('godot_relationships');
            if (hasGodotRelationships) {
              deletionResults.godotScriptRelationships = await trx('godot_relationships')
                .where(function () {
                  this.where('from_entity_type', 'script')
                    .whereIn('from_entity_id', scriptIds)
                    .orWhere('to_entity_type', 'script')
                    .whereIn('to_entity_id', scriptIds);
                })
                .del();
            }

            deletionResults.godotScripts = await trx('godot_scripts')
              .whereIn('id', scriptIds)
              .del();
          }
        }
      }

      if (symbolIds.length > 0) {
        deletionResults.symbols = await trx('symbols').whereIn('id', symbolIds).del();
      }

      logger.info('File cleanup completed', {
        fileCount: fileIds.length,
        ...deletionResults,
      });
    });
  }

  async resolveQualifiedNameDependencies(repositoryId: number): Promise<number> {
    logger.info('Re-resolving dependencies by qualified name after incremental update', {
      repositoryId,
    });

    const result = await this.db.raw(
      `
      UPDATE dependencies
      SET to_symbol_id = symbols.id,
          updated_at = NOW()
      FROM symbols
      JOIN files ON symbols.file_id = files.id
      WHERE files.repo_id = ?
        AND dependencies.to_qualified_name = symbols.qualified_name
        AND dependencies.to_qualified_name IS NOT NULL
        AND (dependencies.to_symbol_id IS NULL
             OR dependencies.to_symbol_id != symbols.id)
    `,
      [repositoryId]
    );

    const updatedCount = result.rowCount || 0;
    logger.info('Resolved dependencies by qualified name', { updatedCount });
    return updatedCount;
  }

  async deleteRepositoryCompletely(repositoryId: number): Promise<boolean> {
    logger.info('Completely deleting repository and all related data', { repositoryId });

    try {
      return await this.db.transaction(async trx => {
        // Delete dependencies related to symbols in this repository
        const deletedDependencies = await trx('dependencies')
          .whereIn(
            'from_symbol_id',
            trx('symbols')
              .select('id')
              .whereIn('file_id', trx('files').select('id').where('repo_id', repositoryId))
          )
          .orWhereIn(
            'to_symbol_id',
            trx('symbols')
              .select('id')
              .whereIn('file_id', trx('files').select('id').where('repo_id', repositoryId))
          )
          .del();

        // Delete symbols in files belonging to this repository
        const deletedSymbols = await trx('symbols')
          .whereIn('file_id', trx('files').select('id').where('repo_id', repositoryId))
          .del();

        // Delete files belonging to this repository
        const deletedFiles = await trx('files').where('repo_id', repositoryId).del();

        // Then delete the repository itself
        const deletedRepo = await trx('repositories').where('id', repositoryId).del();

        logger.info('Repository completely deleted', {
          repositoryId,
          deletedDependencies,
          deletedSymbols,
          deletedFiles,
          deletedRepo,
        });

        return deletedRepo > 0;
      });
    } catch (error) {
      logger.error('Failed to delete repository completely', { repositoryId, error });
      throw error;
    }
  }

  async deleteRepositoryByName(name: string): Promise<boolean> {
    logger.info('Deleting repository by name', { name });

    const repository = await this.getRepositoryByName(name);
    if (!repository) {
      logger.warn('Repository not found', { name });
      return false;
    }

    logger.info('Repository found, proceeding with deletion', {
      name,
      repositoryId: repository.id,
      path: repository.path,
    });

    return await this.deleteRepositoryCompletely(repository.id);
  }

  // Utility methods
  async runMigrations(): Promise<void> {
    logger.info('Running database migrations');
    await this.db.migrate.latest();
    logger.info('Database migrations completed');
  }

  async rollbackMigrations(): Promise<void> {
    logger.info('Rolling back database migrations');
    await this.db.migrate.rollback();
    logger.info('Database migrations rolled back');
  }

  async close(): Promise<void> {
    logger.info('Closing database connection');
    await closeDatabaseConnection();
    logger.info('Database connection closed');
  }

  // Framework-specific operations

  // Route operations
  async createRoute(data: CreateRoute): Promise<Route> {
    // Convert array fields to JSON strings for JSONB columns
    const insertData = {
      ...data,
      middleware: data.middleware ? JSON.stringify(data.middleware) : '[]',
      dynamic_segments: data.dynamic_segments ? JSON.stringify(data.dynamic_segments) : '[]',
    };

    const [route] = await this.db('routes').insert(insertData).returning('*');

    return route as Route;
  }

  async getRoute(id: number): Promise<Route | null> {
    const route = await this.db('routes').where({ id }).first();
    return (route as Route) || null;
  }

  async getRouteWithSymbol(id: number): Promise<RouteWithSymbol | null> {
    const result = await this.db('routes')
      .leftJoin('symbols', 'routes.handler_symbol_id', 'symbols.id')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .leftJoin('repositories', 'routes.repo_id', 'repositories.id')
      .select(
        'routes.*',
        'symbols.id as symbol_id',
        'symbols.name as symbol_name',
        'symbols.signature as symbol_signature',
        'symbols.start_line as symbol_start_line',
        'files.path as file_path',
        'files.language as file_language',
        'repositories.name as repo_name',
        'repositories.path as repo_path'
      )
      .where('routes.id', id)
      .first();

    if (!result) return null;

    const route = {
      id: result.id,
      repo_id: result.repo_id,
      path: result.path,
      method: result.method,
      handler_symbol_id: result.handler_symbol_id,
      framework_type: result.framework_type,
      middleware: result.middleware,
      dynamic_segments: result.dynamic_segments,
      auth_required: result.auth_required,
      created_at: result.created_at,
      updated_at: result.updated_at,
    } as RouteWithSymbol;

    if (result.symbol_id) {
      route.handler_symbol = {
        id: result.symbol_id,
        file_id: result.file_id,
        name: result.symbol_name,
        signature: result.symbol_signature,
        start_line: result.symbol_start_line,
        file: {
          id: result.file_id,
          path: result.file_path,
          language: result.file_language,
        },
      } as SymbolWithFile;
    }

    if (result.repo_name) {
      route.repository = {
        id: result.repo_id,
        name: result.repo_name,
        path: result.repo_path,
      } as Repository;
    }

    return route;
  }

  async getRoutesByFramework(repoId: number, framework: string): Promise<Route[]> {
    const routes = await this.db('routes')
      .where({ repo_id: repoId, framework_type: framework })
      .orderBy('path');
    return routes as Route[];
  }

  async getRoutesByRepository(repoId: number): Promise<Route[]> {
    const routes = await this.db('routes')
      .where({ repo_id: repoId })
      .orderBy(['framework_type', 'path']);
    return routes as Route[];
  }

  async getAllRoutes(repoId?: number): Promise<Route[]> {
    let query = this.db('routes').orderBy(['repo_id', 'framework_type', 'path']);

    if (repoId) {
      query = query.where({ repo_id: repoId });
    }

    const routes = await query;
    return routes as Route[];
  }

  async findRouteByPath(repoId: number, path: string, method: string): Promise<Route | null> {
    const route = await this.db('routes').where({ repo_id: repoId, path, method }).first();
    return (route as Route) || null;
  }

  async findMethodByQualifiedName(repoId: number, qualifiedName: string): Promise<Symbol | null> {
    const result = await this.db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .where('symbols.qualified_name', qualifiedName)
      .where('symbols.symbol_type', 'method')
      .first();

    return result || null;
  }

  async findMethodInController(
    repoId: number,
    controllerClass: string,
    methodName: string
  ): Promise<Symbol | null> {
    const qualifiedPatterns = [
      `${controllerClass}::${methodName}`,
      `App\\Http\\Controllers\\${controllerClass}::${methodName}`,
    ];

    for (const pattern of qualifiedPatterns) {
      const result = await this.db('symbols')
        .select('symbols.*')
        .join('files', 'symbols.file_id', 'files.id')
        .where('files.repo_id', repoId)
        .where('files.language', 'php')
        .where('symbols.qualified_name', pattern)
        .where('symbols.symbol_type', 'method')
        .first();

      if (result) {
        logger.info('Found method via qualified pattern', {
          controllerClass,
          methodName,
          pattern,
          symbolId: result.id,
        });
        return result as Symbol;
      }
    }

    const controllerSymbol = await this.db('symbols')
      .select('symbols.*')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .where('files.language', 'php')
      .where('symbols.symbol_type', 'class')
      .where(function () {
        this.where('symbols.name', controllerClass).orWhere(
          'symbols.qualified_name',
          'like',
          `%${controllerClass}`
        );
      })
      .first();

    if (!controllerSymbol) {
      logger.warn('Controller class not found', {
        controllerClass,
        methodName,
        repoId,
      });
      return null;
    }

    const methodSymbol = await this.db('symbols')
      .where('parent_symbol_id', controllerSymbol.id)
      .where('name', methodName)
      .where('symbol_type', 'method')
      .first();

    if (methodSymbol) {
      logger.info('Found method via fallback query', {
        controllerClass,
        methodName,
        controllerSymbolId: controllerSymbol.id,
        methodSymbolId: methodSymbol.id,
      });
    } else {
      logger.warn('Method not found in controller', {
        controllerClass,
        methodName,
        controllerSymbolId: controllerSymbol.id,
      });
    }

    return (methodSymbol as Symbol) || null;
  }

  async updateRouteHandlerSymbolId(routeId: number, handlerSymbolId: number): Promise<void> {
    await this.db('routes').where({ id: routeId }).update({ handler_symbol_id: handlerSymbolId });
  }

  async updateSymbolParent(symbolId: number, parentSymbolId: number): Promise<void> {
    await this.db('symbols').where({ id: symbolId }).update({ parent_symbol_id: parentSymbolId });
  }

  async searchRoutes(options: RouteSearchOptions): Promise<Route[]> {
    let query = this.db('routes').select('*');

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

  // Component operations
  async createComponent(data: CreateComponent): Promise<Component> {
    const [component] = await this.db('components').insert(data).returning('*');

    return component as Component;
  }

  async getComponent(id: number): Promise<Component | null> {
    const component = await this.db('components').where({ id }).first();
    return (component as Component) || null;
  }

  async getComponentWithSymbol(id: number): Promise<ComponentWithSymbol | null> {
    const result = await this.db('components')
      .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .leftJoin('repositories', 'components.repo_id', 'repositories.id')
      .select(
        'components.*',
        'symbols.id as symbol_id',
        'symbols.name as symbol_name',
        'symbols.signature as symbol_signature',
        'symbols.start_line as symbol_start_line',
        'files.path as file_path',
        'files.language as file_language',
        'repositories.name as repo_name',
        'repositories.path as repo_path'
      )
      .where('components.id', id)
      .first();

    if (!result) return null;

    const component = { ...result } as ComponentWithSymbol;

    if (result.symbol_id) {
      component.symbol = {
        id: result.symbol_id,
        name: result.symbol_name,
        signature: result.symbol_signature,
        start_line: result.symbol_start_line,
        file: {
          path: result.file_path,
          language: result.file_language,
        },
      } as SymbolWithFile;
    }

    if (result.repo_name) {
      component.repository = {
        id: result.repo_id,
        name: result.repo_name,
        path: result.repo_path,
      } as Repository;
    }

    return component;
  }

  async getComponentsByType(repoId: number, type: string): Promise<Component[]> {
    const components = await this.db('components')
      .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .select('components.*', 'files.path as file_path', 'symbols.name as symbol_name')
      .where({ 'components.repo_id': repoId, 'components.component_type': type })
      .orderBy('components.id');
    return components as Component[];
  }

  async getComponentsByRepository(repoId: number): Promise<Component[]> {
    const components = await this.db('components')
      .where({ repo_id: repoId })
      .orderBy(['component_type', 'id']);
    return components as Component[];
  }

  async getComponentHierarchy(componentId: number): Promise<ComponentTree | null> {
    const component = await this.getComponent(componentId);
    if (!component) return null;

    // Get children components
    const children = await this.db('components').where({ parent_component_id: componentId });

    // Get parent component
    let parent = null;
    if (component.parent_component_id) {
      parent = await this.getComponent(component.parent_component_id);
    }

    return {
      ...component,
      children: await Promise.all(children.map(child => this.getComponentHierarchy(child.id))),
      parent,
    } as ComponentTree;
  }

  async findComponentByName(repoId: number, name: string): Promise<Component | null> {
    const component = await this.db('components')
      .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
      .where({
        'components.repo_id': repoId,
        'symbols.name': name,
      })
      .select('components.*')
      .first();

    return (component as Component) || null;
  }

  async searchComponents(options: ComponentSearchOptions): Promise<Component[]> {
    let query = this.db('components')
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

    return components as Component[];
  }

  // Composable operations
  async createComposable(data: CreateComposable): Promise<Composable> {
    const [composable] = await this.db('composables').insert(data).returning('*');

    return composable as Composable;
  }

  async getComposable(id: number): Promise<Composable | null> {
    const composable = await this.db('composables').where({ id }).first();
    return (composable as Composable) || null;
  }

  async getComposablesByType(repoId: number, type: string): Promise<Composable[]> {
    const composables = await this.db('composables')
      .where({ repo_id: repoId, composable_type: type })
      .orderBy('id');
    return composables as Composable[];
  }

  async getComposablesByRepository(repoId: number): Promise<Composable[]> {
    const composables = await this.db('composables')
      .where({ repo_id: repoId })
      .orderBy(['composable_type', 'id']);
    return composables as Composable[];
  }

  async searchComposables(options: ComposableSearchOptions): Promise<Composable[]> {
    let query = this.db('composables')
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

  // Framework metadata operations
  async storeFrameworkMetadata(data: CreateFrameworkMetadata): Promise<FrameworkMetadata> {
    // Try to find existing metadata first
    const existingMetadata = await this.db('framework_metadata')
      .where({ repo_id: data.repo_id, framework_type: data.framework_type })
      .first();

    if (existingMetadata) {
      // Update existing metadata
      const [metadata] = await this.db('framework_metadata')
        .where({ id: existingMetadata.id })
        .update({ ...data, updated_at: new Date() })
        .returning('*');
      return metadata as FrameworkMetadata;
    } else {
      // Insert new metadata
      const [metadata] = await this.db('framework_metadata').insert(data).returning('*');
      return metadata as FrameworkMetadata;
    }
  }

  async getFrameworkStack(repoId: number): Promise<FrameworkMetadata[]> {
    const metadata = await this.db('framework_metadata')
      .where({ repo_id: repoId })
      .orderBy('framework_type');
    return metadata as FrameworkMetadata[];
  }

  async getFrameworkMetadata(
    repoId: number,
    frameworkType: string
  ): Promise<FrameworkMetadata | null> {
    const metadata = await this.db('framework_metadata')
      .where({ repo_id: repoId, framework_type: frameworkType })
      .first();
    return (metadata as FrameworkMetadata) || null;
  }

  // Enhanced symbol search with framework context
  async findSymbolByName(repoId: number, name: string): Promise<SymbolWithFile | null> {
    const result = await this.db('symbols')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .select('symbols.*', 'files.path as file_path', 'files.language as file_language')
      .where('files.repo_id', repoId)
      .where('symbols.name', name)
      .first();

    if (!result) return null;

    return {
      ...result,
      file: {
        id: result.file_id,
        path: result.file_path,
        language: result.file_language,
      },
    } as SymbolWithFile;
  }

  // ===== Phase 7B: Godot Framework Entity Operations =====
  // Implementation of Solution 1: Enhanced Framework Relationships

  // Godot Scene operations
  async storeGodotScene(data: CreateGodotScene): Promise<GodotScene> {
    try {
      // Check if scene already exists
      const existingScene = await this.db('godot_scenes')
        .where({ repo_id: data.repo_id, scene_path: data.scene_path })
        .first();

      if (existingScene) {
        // Update existing scene
        const [scene] = await this.db('godot_scenes')
          .where({ id: existingScene.id })
          .update({ ...data, updated_at: new Date() })
          .returning('*');
        return scene as GodotScene;
      } else {
        // Insert new scene
        const [scene] = await this.db('godot_scenes').insert(data).returning('*');
        return scene as GodotScene;
      }
    } catch (error) {
      logger.error('Failed to store Godot scene', {
        scene_path: data.scene_path,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getGodotScene(id: number): Promise<GodotScene | null> {
    const scene = await this.db('godot_scenes').where({ id }).first();
    return (scene as GodotScene) || null;
  }

  async getGodotSceneWithNodes(id: number): Promise<GodotSceneWithNodes | null> {
    const scene = await this.getGodotScene(id);
    if (!scene) return null;

    const nodes = await this.db('godot_nodes').where({ scene_id: id }).orderBy('node_name');

    const rootNode = nodes.find(node => node.id === scene.root_node_id);

    return {
      ...scene,
      nodes: nodes as GodotNode[],
      root_node: rootNode as GodotNode,
    };
  }

  async getGodotScenesByRepository(repoId: number): Promise<GodotScene[]> {
    const scenes = await this.db('godot_scenes').where({ repo_id: repoId }).orderBy('scene_path');
    return scenes as GodotScene[];
  }

  async findGodotSceneByPath(repoId: number, scenePath: string): Promise<GodotScene | null> {
    const scene = await this.db('godot_scenes')
      .where({ repo_id: repoId, scene_path: scenePath })
      .first();
    return (scene as GodotScene) || null;
  }

  // Godot Node operations
  async storeGodotNode(data: CreateGodotNode): Promise<GodotNode> {
    try {
      // Check if node already exists in this scene
      const existingNode = await this.db('godot_nodes')
        .where({ scene_id: data.scene_id, node_name: data.node_name })
        .first();

      if (existingNode) {
        // Update existing node
        const [node] = await this.db('godot_nodes')
          .where({ id: existingNode.id })
          .update({ ...data, updated_at: new Date() })
          .returning('*');
        return node as GodotNode;
      } else {
        // Insert new node
        const [node] = await this.db('godot_nodes').insert(data).returning('*');
        return node as GodotNode;
      }
    } catch (error) {
      logger.error('Failed to store Godot node', {
        node_name: data.node_name,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getGodotNode(id: number): Promise<GodotNode | null> {
    const node = await this.db('godot_nodes').where({ id }).first();
    return (node as GodotNode) || null;
  }

  async getGodotNodeWithScript(id: number): Promise<GodotNodeWithScript | null> {
    const node = await this.getGodotNode(id);
    if (!node) return null;

    const script = node.script_path
      ? await this.findGodotScriptByPath(node.repo_id, node.script_path)
      : null;

    const scene = await this.getGodotScene(node.scene_id);
    const parent = node.parent_node_id ? await this.getGodotNode(node.parent_node_id) : null;

    const children = await this.db('godot_nodes')
      .where({ parent_node_id: id })
      .orderBy('node_name');

    return {
      ...node,
      script: script || undefined,
      scene: scene || undefined,
      parent: parent || undefined,
      children: children as GodotNode[],
    };
  }

  async getGodotNodesByScene(sceneId: number): Promise<GodotNode[]> {
    const nodes = await this.db('godot_nodes').where({ scene_id: sceneId }).orderBy('node_name');
    return nodes as GodotNode[];
  }

  // Godot Script operations
  async storeGodotScript(data: CreateGodotScript): Promise<GodotScript> {
    try {
      // Check if script already exists
      const existingScript = await this.db('godot_scripts')
        .where({ repo_id: data.repo_id, script_path: data.script_path })
        .first();

      if (existingScript) {
        // Update existing script
        const [script] = await this.db('godot_scripts')
          .where({ id: existingScript.id })
          .update({
            ...data,
            signals: JSON.stringify(data.signals || []),
            exports: JSON.stringify(data.exports || []),
            updated_at: new Date(),
          })
          .returning('*');

        // Parse JSON fields back
        const parsedScript = {
          ...script,
          signals: JSON.parse(script.signals),
          exports: JSON.parse(script.exports),
        };
        return parsedScript as GodotScript;
      } else {
        // Insert new script
        const insertData = {
          ...data,
          signals: JSON.stringify(data.signals || []),
          exports: JSON.stringify(data.exports || []),
        };

        const [script] = await this.db('godot_scripts').insert(insertData).returning('*');

        // Parse JSON fields back
        const parsedScript = {
          ...script,
          signals: JSON.parse(script.signals),
          exports: JSON.parse(script.exports),
        };
        return parsedScript as GodotScript;
      }
    } catch (error) {
      logger.error('Failed to store Godot script', {
        script_path: data.script_path,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getGodotScript(id: number): Promise<GodotScript | null> {
    const script = await this.db('godot_scripts').where({ id }).first();

    if (!script) return null;

    // Parse JSON fields
    return {
      ...script,
      signals: JSON.parse(script.signals),
      exports: JSON.parse(script.exports),
    } as GodotScript;
  }

  async getGodotScriptsByRepository(repoId: number): Promise<GodotScript[]> {
    const scripts = await this.db('godot_scripts')
      .where({ repo_id: repoId })
      .orderBy('script_path');

    // Parse JSON fields for all scripts
    return scripts.map(script => ({
      ...script,
      signals: JSON.parse(script.signals),
      exports: JSON.parse(script.exports),
    })) as GodotScript[];
  }

  async findGodotScriptByPath(repoId: number, scriptPath: string): Promise<GodotScript | null> {
    const script = await this.db('godot_scripts')
      .where({ repo_id: repoId, script_path: scriptPath })
      .first();

    if (!script) return null;

    return {
      ...script,
      signals: JSON.parse(script.signals),
      exports: JSON.parse(script.exports),
    } as GodotScript;
  }

  // Godot Autoload operations
  async storeGodotAutoload(data: CreateGodotAutoload): Promise<GodotAutoload> {
    try {
      // Check if autoload already exists
      const existingAutoload = await this.db('godot_autoloads')
        .where({ repo_id: data.repo_id, autoload_name: data.autoload_name })
        .first();

      if (existingAutoload) {
        // Update existing autoload
        const [autoload] = await this.db('godot_autoloads')
          .where({ id: existingAutoload.id })
          .update({ ...data, updated_at: new Date() })
          .returning('*');
        return autoload as GodotAutoload;
      } else {
        // Insert new autoload
        const [autoload] = await this.db('godot_autoloads').insert(data).returning('*');
        return autoload as GodotAutoload;
      }
    } catch (error) {
      logger.error('Failed to store Godot autoload', {
        autoload_name: data.autoload_name,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getGodotAutoloadsByRepository(repoId: number): Promise<GodotAutoload[]> {
    const autoloads = await this.db('godot_autoloads')
      .where({ repo_id: repoId })
      .orderBy('autoload_name');
    return autoloads as GodotAutoload[];
  }

  // Godot Relationship operations (Core of Solution 1)
  async createGodotRelationship(data: CreateGodotRelationship): Promise<GodotRelationship> {
    try {
      // Check if relationship already exists
      const existingRelationship = await this.db('godot_relationships')
        .where({
          repo_id: data.repo_id,
          relationship_type: data.relationship_type,
          from_entity_type: data.from_entity_type,
          from_entity_id: data.from_entity_id,
          to_entity_type: data.to_entity_type,
          to_entity_id: data.to_entity_id,
        })
        .first();

      if (existingRelationship) {
        return existingRelationship as GodotRelationship;
      }

      const [relationship] = await this.db('godot_relationships').insert(data).returning('*');

      return relationship as GodotRelationship;
    } catch (error) {
      logger.error('Failed to create Godot relationship', {
        type: data.relationship_type,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getGodotRelationshipsByEntity(
    entityType: GodotEntityType,
    entityId: number,
    direction: 'from' | 'to' | 'both' = 'both'
  ): Promise<GodotRelationship[]> {
    let query = this.db('godot_relationships');

    if (direction === 'from') {
      query = query.where({ from_entity_type: entityType, from_entity_id: entityId });
    } else if (direction === 'to') {
      query = query.where({ to_entity_type: entityType, to_entity_id: entityId });
    } else {
      query = query.where(function () {
        this.where({ from_entity_type: entityType, from_entity_id: entityId }).orWhere({
          to_entity_type: entityType,
          to_entity_id: entityId,
        });
      });
    }

    const relationships = await query.orderBy('relationship_type');
    return relationships as GodotRelationship[];
  }

  async getGodotRelationshipsByType(
    repoId: number,
    relationshipType: GodotRelationshipType
  ): Promise<GodotRelationship[]> {
    const relationships = await this.db('godot_relationships')
      .where({ repo_id: repoId, relationship_type: relationshipType })
      .orderBy(['from_entity_type', 'from_entity_id']);
    return relationships as GodotRelationship[];
  }

  async getGodotRelationshipsByRepository(repoId: number): Promise<GodotRelationship[]> {
    const relationships = await this.db('godot_relationships')
      .where({ repo_id: repoId })
      .orderBy(['relationship_type', 'from_entity_type', 'from_entity_id']);
    return relationships as GodotRelationship[];
  }

  // Search operations for Godot entities
  async searchGodotScenes(options: GodotSceneSearchOptions): Promise<GodotScene[]> {
    let query = this.db('godot_scenes').select('*');

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

  async searchGodotNodes(options: GodotNodeSearchOptions): Promise<GodotNode[]> {
    let query = this.db('godot_nodes').select('*');

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

  async searchGodotScripts(options: GodotScriptSearchOptions): Promise<GodotScript[]> {
    let query = this.db('godot_scripts').select('*');

    if (options.repo_id) {
      query = query.where('repo_id', options.repo_id);
    }

    if (options.base_class) {
      query = query.where('base_class', options.base_class);
    }

    if (options.is_autoload !== undefined) {
      query = query.where('is_autoload', options.is_autoload);
    }

    if (options.query) {
      query = query.where(function () {
        this.where('class_name', 'ilike', `%${options.query}%`).orWhere(
          'script_path',
          'ilike',
          `%${options.query}%`
        );
      });
    }

    const scripts = await query.orderBy('script_path').limit(options.limit || 50);

    // Parse JSON fields for all scripts
    return scripts.map(script => ({
      ...script,
      signals: JSON.parse(script.signals),
      exports: JSON.parse(script.exports),
    })) as GodotScript[];
  }

  // ===== Phase 3 Service Methods =====

  // Background Job Queue operations
  async createJobQueue(data: CreateJobQueue): Promise<JobQueue> {
    const [jobQueue] = await this.db('job_queues').insert(data).returning('*');
    return jobQueue as JobQueue;
  }

  async getJobQueue(id: number): Promise<JobQueue | null> {
    const jobQueue = await this.db('job_queues').where({ id }).first();
    return (jobQueue as JobQueue) || null;
  }

  async getJobQueuesByRepository(repoId: number): Promise<JobQueue[]> {
    const jobQueues = await this.db('job_queues').where({ repo_id: repoId }).orderBy('name');
    return jobQueues as JobQueue[];
  }

  async getJobQueuesByType(repoId: number, queueType: JobQueueType): Promise<JobQueue[]> {
    const jobQueues = await this.db('job_queues')
      .where({ repo_id: repoId, queue_type: queueType })
      .orderBy('name');
    return jobQueues as JobQueue[];
  }

  // Job Definition operations
  async createJobDefinition(data: CreateJobDefinition): Promise<JobDefinition> {
    const [jobDefinition] = await this.db('job_definitions').insert(data).returning('*');
    return jobDefinition as JobDefinition;
  }

  async getJobDefinition(id: number): Promise<JobDefinition | null> {
    const jobDefinition = await this.db('job_definitions').where({ id }).first();
    return (jobDefinition as JobDefinition) || null;
  }

  async getJobDefinitionsByQueue(queueId: number): Promise<JobDefinition[]> {
    const jobDefinitions = await this.db('job_definitions')
      .where({ queue_id: queueId })
      .orderBy('job_name');
    return jobDefinitions as JobDefinition[];
  }

  async getJobDefinitionsByRepository(repoId: number): Promise<JobDefinition[]> {
    const jobDefinitions = await this.db('job_definitions')
      .where({ repo_id: repoId })
      .orderBy('job_name');
    return jobDefinitions as JobDefinition[];
  }

  // Worker Thread operations
  async createWorkerThread(data: CreateWorkerThread): Promise<WorkerThread> {
    const [workerThread] = await this.db('worker_threads').insert(data).returning('*');
    return workerThread as WorkerThread;
  }

  async getWorkerThread(id: number): Promise<WorkerThread | null> {
    const workerThread = await this.db('worker_threads').where({ id }).first();
    return (workerThread as WorkerThread) || null;
  }

  async getWorkerThreadsByRepository(repoId: number): Promise<WorkerThread[]> {
    const workerThreads = await this.db('worker_threads')
      .where({ repo_id: repoId })
      .orderBy('worker_type');
    return workerThreads as WorkerThread[];
  }

  // ORM Entity operations
  async createORMEntity(data: CreateORMEntity): Promise<ORMEntity> {
    const [ormEntity] = await this.db('orm_entities').insert(data).returning('*');
    return ormEntity as ORMEntity;
  }

  async getORMEntity(id: number): Promise<ORMEntity | null> {
    const ormEntity = await this.db('orm_entities').where({ id }).first();
    return (ormEntity as ORMEntity) || null;
  }

  async getORMEntitiesByRepository(repoId: number): Promise<ORMEntity[]> {
    const ormEntities = await this.db('orm_entities')
      .where({ repo_id: repoId })
      .orderBy('entity_name');
    return ormEntities as ORMEntity[];
  }

  async getORMEntitiesByType(repoId: number, ormType: ORMType): Promise<ORMEntity[]> {
    const ormEntities = await this.db('orm_entities')
      .where({ repo_id: repoId, orm_type: ormType })
      .orderBy('entity_name');
    return ormEntities as ORMEntity[];
  }

  async findORMEntityByName(repoId: number, entityName: string): Promise<ORMEntity | null> {
    const ormEntity = await this.db('orm_entities')
      .where({ repo_id: repoId, entity_name: entityName })
      .first();
    return (ormEntity as ORMEntity) || null;
  }

  // ORM Repository operations
  async createORMRepository(data: CreateORMRepository): Promise<ORMRepository> {
    const [ormRepository] = await this.db('orm_repositories').insert(data).returning('*');
    return ormRepository as ORMRepository;
  }

  async getORMRepository(id: number): Promise<ORMRepository | null> {
    const ormRepository = await this.db('orm_repositories').where({ id }).first();
    return (ormRepository as ORMRepository) || null;
  }

  async getORMRepositoriesByEntity(entityId: number): Promise<ORMRepository[]> {
    const ormRepositories = await this.db('orm_repositories')
      .where({ entity_id: entityId })
      .orderBy('repository_type');
    return ormRepositories as ORMRepository[];
  }

  // Workspace Project operations
  async createWorkspaceProject(data: CreateWorkspaceProject): Promise<WorkspaceProject> {
    const [workspaceProject] = await this.db('workspace_projects').insert(data).returning('*');
    return workspaceProject as WorkspaceProject;
  }

  async getWorkspaceProject(id: number): Promise<WorkspaceProject | null> {
    const workspaceProject = await this.db('workspace_projects').where({ id }).first();
    return (workspaceProject as WorkspaceProject) || null;
  }

  async getWorkspaceProjectsByRepository(repoId: number): Promise<WorkspaceProject[]> {
    const workspaceProjects = await this.db('workspace_projects')
      .where({ repo_id: repoId })
      .orderBy('project_name');
    return workspaceProjects as WorkspaceProject[];
  }

  async getWorkspaceProjectsByType(
    repoId: number,
    workspaceType: WorkspaceType
  ): Promise<WorkspaceProject[]> {
    const workspaceProjects = await this.db('workspace_projects')
      .where({ repo_id: repoId, workspace_type: workspaceType })
      .orderBy('project_name');
    return workspaceProjects as WorkspaceProject[];
  }

  async getRootWorkspaceProjects(repoId: number): Promise<WorkspaceProject[]> {
    const workspaceProjects = await this.db('workspace_projects')
      .where({ repo_id: repoId })
      .whereNull('parent_project_id')
      .orderBy('project_name');
    return workspaceProjects as WorkspaceProject[];
  }

  async getChildWorkspaceProjects(parentProjectId: number): Promise<WorkspaceProject[]> {
    const workspaceProjects = await this.db('workspace_projects')
      .where({ parent_project_id: parentProjectId })
      .orderBy('project_name');
    return workspaceProjects as WorkspaceProject[];
  }

  async findWorkspaceProjectByPath(
    repoId: number,
    projectPath: string
  ): Promise<WorkspaceProject | null> {
    const workspaceProject = await this.db('workspace_projects')
      .where({ repo_id: repoId, project_path: projectPath })
      .first();
    return (workspaceProject as WorkspaceProject) || null;
  }

  // ===== Phase 5 Service Methods - Cross-Stack Tracking =====

  /**
   * Get all cross-stack dependencies for a repository
   */
  async getCrossStackDependencies(
    repoId: number
  ): Promise<{ apiCalls: ApiCall[]; dataContracts: DataContract[] }> {
    // Get API calls
    const apiCalls = await this.db('api_calls')
      .where({ repo_id: repoId })
      .orderBy('created_at', 'desc');

    // Get data contracts
    const dataContracts = await this.db('data_contracts')
      .where({ repo_id: repoId })
      .orderBy('created_at', 'desc');

    return {
      apiCalls: apiCalls as ApiCall[],
      dataContracts: dataContracts as DataContract[],
    };
  }

  /**
   * Get API calls by endpoint path and HTTP method
   */
  async getApiCallsByEndpoint(
    repoId: number,
    endpointPath: string,
    httpMethod: string
  ): Promise<ApiCall[]> {
    const apiCalls = await this.db('api_calls')
      .where({
        repo_id: repoId,
        endpoint_path: endpointPath,
        http_method: httpMethod,
      })
      .orderBy('created_at', 'desc');

    return apiCalls as ApiCall[];
  }

  /**
   * Get a framework entity by ID (routes, components, etc.)
   */
  async getFrameworkEntityById(id: number): Promise<Route | Component | Composable | null> {
    // Try routes first
    const route = await this.db('routes').where({ id }).first();

    if (route) {
      return route as Route;
    }

    // Try components
    const component = await this.db('components').where({ id }).first();

    if (component) {
      return component as Component;
    }

    // Try composables
    const composable = await this.db('composables').where({ id }).first();

    if (composable) {
      return composable as Composable;
    }

    return null;
  }

  /**
   * Create API call records in batch
   */
  async createApiCalls(data: CreateApiCall[]): Promise<ApiCall[]> {
    if (data.length === 0) return [];

    const BATCH_SIZE = 100;
    const results: ApiCall[] = [];
    let totalSkipped = 0;

    try {
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);

        const batchResults = await this.db('api_calls')
          .insert(batch)
          .onConflict([
            'caller_symbol_id',
            'endpoint_symbol_id',
            'line_number',
            'http_method',
            'endpoint_path',
          ])
          .ignore()
          .returning('*');

        const skipped = batch.length - batchResults.length;
        totalSkipped += skipped;

        if (skipped > 0) {
          // Find duplicates by counting occurrences of each key in the batch
          const keyCounts = new Map<string, { count: number; item: CreateApiCall }>();

          for (const item of batch) {
            const key = `${item.caller_symbol_id}|${item.endpoint_symbol_id}|${item.line_number}|${item.http_method}|${item.endpoint_path}`;
            const existing = keyCounts.get(key);
            if (existing) {
              existing.count++;
            } else {
              keyCounts.set(key, { count: 1, item });
            }
          }

          // Find keys that appear more than once (duplicates within batch)
          const duplicateKeys = Array.from(keyCounts.entries())
            .filter(([_, value]) => value.count > 1)
            .map(([key, value]) => ({
              key,
              count: value.count,
              sample: {
                caller_symbol_id: value.item.caller_symbol_id,
                endpoint_symbol_id: value.item.endpoint_symbol_id,
                line_number: value.item.line_number,
                http_method: value.item.http_method,
                endpoint_path: value.item.endpoint_path,
              },
            }));

          logger.warn('Duplicate API calls skipped by UNIQUE constraint', {
            batchNumber: Math.floor(i / BATCH_SIZE) + 1,
            batchSize: batch.length,
            inserted: batchResults.length,
            skipped,
            skipRate: `${((skipped / batch.length) * 100).toFixed(1)}%`,
            duplicatesFoundInBatch: duplicateKeys.length,
            duplicateDetails: duplicateKeys,
          });
        }

        results.push(...(batchResults as ApiCall[]));
      }

      if (totalSkipped > 0) {
        const overallSkipRate = ((totalSkipped / data.length) * 100).toFixed(1);
        logger.info('API call insertion complete with duplicates skipped', {
          totalAttempted: data.length,
          totalInserted: results.length,
          totalSkipped,
          overallSkipRate: `${overallSkipRate}%`,
        });

        if (totalSkipped / data.length > 0.1) {
          logger.warn(
            'High duplicate rate detected - investigate if analysis is running multiple times',
            {
              skipRate: `${overallSkipRate}%`,
              threshold: '10%',
            }
          );
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to create API calls', {
        error: error.message,
        stack: error.stack,
        count: data.length,
        sampleData: data.slice(0, 2),
      });
      throw error;
    }
  }

  /**
   * Create data contract records in batch
   */
  async createDataContracts(data: CreateDataContract[]): Promise<DataContract[]> {
    if (data.length === 0) return [];

    const BATCH_SIZE = 100;
    const results: DataContract[] = [];

    try {
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);

        const batchResults = await this.db('data_contracts')
          .insert(batch)
          .onConflict(['frontend_type_id', 'backend_type_id', 'name'])
          .merge(['schema_definition', 'drift_detected', 'updated_at'])
          .returning('*');

        results.push(...(batchResults as DataContract[]));
      }

      return results;
    } catch (error) {
      logger.error('Failed to create data contracts', {
        error: error.message,
        stack: error.stack,
        count: data.length,
        sampleData: data.slice(0, 2),
      });
      throw error;
    }
  }

  /**
   * Get API calls by component ID
   */
  async getApiCallsByComponent(componentId: number): Promise<ApiCall[]> {
    const apiCalls = await this.db('api_calls')
      .where({ caller_symbol_id: componentId })
      .orderBy('created_at', 'desc');

    return apiCalls as ApiCall[];
  }

  /**
   * Get data contracts by schema name
   */
  async getDataContractsBySchema(schemaName: string): Promise<DataContract[]> {
    const dataContracts = await this.db('data_contracts')
      .where({ name: schemaName })
      .orderBy('created_at', 'desc');

    return dataContracts as DataContract[];
  }

  /**
   * Get frameworks used in a repository
   */
  async getRepositoryFrameworks(repoId: number): Promise<string[]> {
    const metadata = await this.db('framework_metadata')
      .where({ repo_id: repoId })
      .select('framework_type')
      .distinct();

    return metadata.map(m => m.framework_type);
  }

  /**
   * Stream cross-stack data for large datasets
   */
  async streamCrossStackData(
    repoId: number
  ): Promise<AsyncIterable<{ type: 'apiCall' | 'dataContract'; data: any }>> {
    const stream = async function* (db: any) {
      // Stream API calls
      const apiCalls = await db('api_calls')
        .where({ repo_id: repoId })
        .orderBy('created_at', 'desc');

      for (const apiCall of apiCalls) {
        yield { type: 'apiCall' as const, data: apiCall };
      }

      // Stream data contracts
      const dataContracts = await db('data_contracts')
        .where({ repo_id: repoId })
        .orderBy('created_at', 'desc');

      for (const dataContract of dataContracts) {
        yield { type: 'dataContract' as const, data: dataContract };
      }
    };

    return stream(this.db);
  }

  // Caching methods for performance optimization
  private cacheStore: Map<string, any> = new Map();

  /**
   * Get cached pattern match result
   */
  async getCachedPatternMatch(key: string): Promise<any | null> {
    return this.cacheStore.get(`pattern:${key}`) || null;
  }

  /**
   * Cache pattern match result
   */
  async cachePatternMatch(key: string, value: any): Promise<void> {
    this.cacheStore.set(`pattern:${key}`, value);
  }

  /**
   * Get cached schema compatibility result
   */
  async getCachedSchemaCompatibility(key: string): Promise<any | null> {
    return this.cacheStore.get(`schema:${key}`) || null;
  }

  /**
   * Cache schema compatibility result
   */
  async cacheSchemaCompatibility(key: string, value: any): Promise<void> {
    this.cacheStore.set(`schema:${key}`, value);
  }

  /**
   * Perform cross-stack health check for a repository
   */
  async performCrossStackHealthCheck(repoId: number): Promise<{
    status: 'pass' | 'fail';
    healthy: boolean;
    issues: string[];
    recommendations: string[];
    checks: Array<{
      name: string;
      status: 'pass' | 'fail';
      message: string;
    }>;
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    const checks: Array<{ name: string; status: 'pass' | 'fail'; message: string }> = [];

    try {
      const crossStackData = await this.getCrossStackDependencies(repoId);

      // Check for orphaned API calls
      const orphanedApiCalls = crossStackData.apiCalls.filter(
        call => !call.caller_symbol_id || !call.endpoint_symbol_id
      );

      if (orphanedApiCalls.length > 0) {
        issues.push(`Found ${orphanedApiCalls.length} orphaned API calls with missing references`);
        recommendations.push(
          'Review and clean up API calls with missing frontend or backend references'
        );
        checks.push({
          name: 'API Call References',
          status: 'fail',
          message: `${orphanedApiCalls.length} orphaned API calls found`,
        });
      } else {
        checks.push({
          name: 'API Call References',
          status: 'pass',
          message: 'All API calls have valid references',
        });
      }

      // Check for drift in data contracts
      const driftedContracts = crossStackData.dataContracts.filter(
        contract => contract.drift_detected
      );

      if (driftedContracts.length > 0) {
        issues.push(`Found ${driftedContracts.length} data contracts with detected schema drift`);
        recommendations.push('Review and update data contracts to resolve schema drift');
        checks.push({
          name: 'Schema Drift Detection',
          status: 'fail',
          message: `${driftedContracts.length} contracts with schema drift`,
        });
      } else {
        checks.push({
          name: 'Schema Drift Detection',
          status: 'pass',
          message: 'No schema drift detected in data contracts',
        });
      }

      const healthy = issues.length === 0;

      return {
        status: healthy ? 'pass' : 'fail',
        healthy,
        issues,
        recommendations,
        checks,
      };
    } catch (error) {
      logger.error('Cross-stack health check failed', { repoId, error });
      return {
        status: 'fail',
        healthy: false,
        issues: ['Health check failed due to database error'],
        recommendations: ['Check database connectivity and table structure'],
        checks: [
          {
            name: 'Database Connectivity',
            status: 'fail',
            message: 'Failed to connect to database or execute queries',
          },
        ],
      };
    }
  }

  /**
   * Get cross-stack analysis health status
   */
  async getCrossStackHealth(repoId: number): Promise<{
    status: 'healthy' | 'warning' | 'error';
    lastChecked: Date;
    summary: {
      totalApiCalls: number;
      totalDataContracts: number;
      driftDetected: number;
    };
  }> {
    try {
      const crossStackData = await this.getCrossStackDependencies(repoId);

      const totalApiCalls = crossStackData.apiCalls.length;
      const totalDataContracts = crossStackData.dataContracts.length;

      const driftDetected = crossStackData.dataContracts.filter(
        contract => contract.drift_detected
      ).length;

      let status: 'healthy' | 'warning' | 'error' = 'healthy';

      if (driftDetected > 0) {
        status = 'error';
      }

      return {
        status,
        lastChecked: new Date(),
        summary: {
          totalApiCalls,
          totalDataContracts,
          driftDetected,
        },
      };
    } catch (error) {
      logger.error('Failed to get cross-stack health status', { repoId, error });
      return {
        status: 'error',
        lastChecked: new Date(),
        summary: {
          totalApiCalls: 0,
          totalDataContracts: 0,
          driftDetected: 0,
        },
      };
    }
  }

  // Method name aliases and framework entity queries

  /**
   * Get framework entities by type (includes routes, components, composables, ORM entities)
   * This is a more general method than getORMEntitiesByType
   */
  async getFrameworkEntitiesByType(
    repoId: number,
    entityType: string
  ): Promise<(Route | Component | Composable | ORMEntity)[]> {
    const results: (Route | Component | Composable | ORMEntity)[] = [];

    // Check routes
    if (entityType === 'route' || entityType === 'all') {
      const routes = await this.getRoutesByRepository(repoId);
      results.push(...routes);
    }

    // Check components
    if (entityType === 'component' || entityType === 'all') {
      const components = await this.getComponentsByRepository(repoId);
      results.push(...components);
    }

    // Check composables
    if (entityType === 'composable' || entityType === 'all') {
      const composables = await this.getComposablesByRepository(repoId);
      results.push(...composables);
    }

    // Check ORM entities
    if (entityType === 'orm_entity' || entityType === 'all') {
      const ormEntities = await this.getORMEntitiesByRepository(repoId);
      results.push(...ormEntities);
    }

    return results;
  }

  /**
   * Get symbols by type for a repository
   */
  async getSymbolsByType(repoId: number, symbolType: string): Promise<Symbol[]> {
    const symbols = await this.db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .where('symbols.symbol_type', symbolType)
      .select('symbols.*')
      .orderBy('symbols.name');

    return symbols as Symbol[];
  }

  /**
   * Get files by language for a repository
   */
  async getFilesByLanguage(repoId: number, language: string): Promise<File[]> {
    const files = await this.db('files').where({ repo_id: repoId, language }).orderBy('path');

    return files as File[];
  }

  /**
   * Get cached embedding or generate new one
   * @param text Text to embed
   * @returns Cached or newly generated embedding
   */
  private async getCachedEmbedding(text: string): Promise<number[]> {
    // Check cache first
    if (this.embeddingCache.has(text)) {
      return this.embeddingCache.get(text)!;
    }

    // Generate new embedding
    const embedding = await this.embeddingService.generateEmbedding(text);

    // Cache with LRU management
    this.embeddingCache.set(text, embedding);

    // LRU cache management - remove oldest if over limit
    if (this.embeddingCache.size > 1000) {
      const firstKey = this.embeddingCache.keys().next().value;
      this.embeddingCache.delete(firstKey);
    }

    return embedding;
  }

  /**
   * Generate embeddings for a single symbol
   * @param symbolId Symbol ID
   * @param name Symbol name
   * @param description Optional symbol description
   */
  private async generateSymbolEmbeddings(
    symbolId: number,
    name: string,
    description?: string
  ): Promise<void> {
    try {
      // Generate combined embedding (name + description)
      const combinedText = description ? `${name} ${description}` : name;
      const combinedEmbedding = await this.embeddingService.generateEmbedding(combinedText);

      await this.db('symbols')
        .where('id', symbolId)
        .update({
          combined_embedding: JSON.stringify(combinedEmbedding),
          embeddings_updated_at: new Date(),
          embedding_model: 'bge-m3',
        });
    } catch (error) {
      logger.warn(`Failed to generate embeddings for symbol ${symbolId}:`, error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple symbols in batch
   * @param symbols Array of symbols to process
   */
  private async batchGenerateEmbeddings(symbols: Symbol[]): Promise<void> {
    if (symbols.length === 0) return;

    try {
      // Process each symbol individually for better error handling
      for (const symbol of symbols) {
        try {
          await this.generateSymbolEmbeddings(symbol.id, symbol.name, symbol.description);
        } catch (error) {
          // Log error but continue with other symbols
          logger.warn(
            `Failed to generate embedding for symbol ${symbol.id} (${symbol.name}):`,
            error
          );
        }
      }
    } catch (error) {
      logger.error('Batch embedding generation failed:', error);
      throw error;
    }
  }

  async updateSymbolEmbeddings(
    symbolId: number,
    combinedEmbedding: number[],
    modelName: string
  ): Promise<void> {
    await this.db('symbols')
      .where({ id: symbolId })
      .update({
        combined_embedding: JSON.stringify(combinedEmbedding),
        embeddings_updated_at: new Date(),
        embedding_model: modelName,
      });
  }

  async batchUpdateSymbolEmbeddings(
    updates: Array<{
      id: number;
      combinedEmbedding: number[];
      embeddingModel: string;
    }>
  ): Promise<void> {
    // Reduce batch size to minimize JSON string memory pressure
    // Each symbol: 1 embedding × 1024 numbers → ~6KB JSON strings
    const BATCH_SIZE = 50;

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);

      await this.db.transaction(async trx => {
        // Process serially to avoid holding all JSON strings in memory
        for (const update of batch) {
          const combinedEmbStr = JSON.stringify(update.combinedEmbedding);

          await trx('symbols').where('id', update.id).update({
            combined_embedding: combinedEmbStr,
            embeddings_updated_at: new Date(),
            embedding_model: update.embeddingModel,
          });

          // String goes out of scope here and can be freed
        }
      });
    }
  }

  /**
   * Get dependencies with enhanced context information
   */
  async getDependenciesFromWithContext(symbolId: number): Promise<EnhancedDependencyWithSymbols[]> {
    const results = await this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
      .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
      .select(
        'dependencies.*',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path',
        'to_symbols.name as to_symbol_name',
        'to_symbols.symbol_type as to_symbol_type',
        'to_files.path as to_file_path'
      )
      .where('dependencies.from_symbol_id', symbolId)
      .distinct('dependencies.id');

    return results.map(result => ({
      ...result,
      from_symbol: {
        id: result.from_symbol_id,
        name: result.from_symbol_name,
        symbol_type: result.from_symbol_type,
        file: {
          id: result.from_file_id,
          path: result.from_file_path,
        },
      },
      to_symbol: {
        id: result.to_symbol_id,
        name: result.to_symbol_name,
        symbol_type: result.to_symbol_type,
        file: {
          id: result.to_file_id,
          path: result.to_file_path,
        },
      },
      // Enhanced context fields (available due to spread operator)
      calling_object: result.calling_object,
      resolved_class: result.resolved_class,
      qualified_context: result.qualified_context,
      method_signature: result.method_signature,
      file_context: result.file_context,
      namespace_context: result.namespace_context,
      // Parameter context fields (Enhancement 2)
      parameter_context: result.parameter_context,
      call_instance_id: result.call_instance_id,
      parameter_types: result.parameter_types
        ? this.safeParseParameterTypes(result.parameter_types)
        : undefined,
    })) as EnhancedDependencyWithSymbols[];
  }

  /**
   * Get callers with enhanced context information
   */
  async getDependenciesToWithContext(symbolId: number): Promise<EnhancedDependencyWithSymbols[]> {
    const results = await this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .select(
        'dependencies.*',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path'
      )
      .where('dependencies.to_symbol_id', symbolId)
      .whereRaw('dependencies.from_symbol_id != dependencies.to_symbol_id')
      .distinct(
        'dependencies.from_symbol_id',
        'dependencies.to_symbol_id',
        'dependencies.dependency_type',
        'dependencies.line_number'
      );

    return results.map(result => ({
      ...result,
      from_symbol: {
        id: result.from_symbol_id,
        name: result.from_symbol_name,
        symbol_type: result.from_symbol_type,
        file: {
          id: result.from_file_id,
          path: result.from_file_path,
        },
      },
      // Enhanced context fields (available due to spread operator)
      calling_object: result.calling_object,
      resolved_class: result.resolved_class,
      qualified_context: result.qualified_context,
      method_signature: result.method_signature,
      file_context: result.file_context,
      namespace_context: result.namespace_context,
      // Parameter context fields (Enhancement 2)
      parameter_context: result.parameter_context,
      call_instance_id: result.call_instance_id,
      parameter_types: result.parameter_types
        ? this.safeParseParameterTypes(result.parameter_types)
        : undefined,
    })) as EnhancedDependencyWithSymbols[];
  }

  /**
   * Get cross-stack API callers for a backend endpoint symbol
   * Returns frontend symbols that make API calls to this backend endpoint
   */
  async getCrossStackApiCallers(symbolId: number): Promise<EnhancedDependencyWithSymbols[]> {
    const results = await this.db('api_calls')
      .join('symbols as endpoint_symbol', 'api_calls.endpoint_symbol_id', 'endpoint_symbol.id')
      .join('symbols as caller_symbol', 'api_calls.caller_symbol_id', 'caller_symbol.id')
      .leftJoin('files as caller_files', 'caller_symbol.file_id', 'caller_files.id')
      .where('api_calls.endpoint_symbol_id', symbolId)
      .select(
        'api_calls.id as dependency_id',
        'api_calls.caller_symbol_id as from_symbol_id',
        'api_calls.endpoint_symbol_id as to_symbol_id',
        'api_calls.http_method',
        'api_calls.endpoint_path',
        'api_calls.line_number',
        'caller_symbol.name as from_symbol_name',
        'caller_symbol.symbol_type as from_symbol_type',
        'caller_files.path as from_file_path',
        'caller_files.id as from_file_id'
      )
      .distinct();

    return results.map(result => ({
      id: result.dependency_id,
      from_symbol_id: result.from_symbol_id,
      to_symbol_id: result.to_symbol_id,
      dependency_type: 'api_call' as any,
      line_number: result.line_number,
      created_at: new Date(),
      updated_at: new Date(),
      from_symbol: {
        id: result.from_symbol_id,
        name: result.from_symbol_name,
        symbol_type: result.from_symbol_type,
        file: {
          id: result.from_file_id,
          path: result.from_file_path,
        },
      },
      http_method: result.http_method,
      endpoint_path: result.endpoint_path,
      is_cross_stack: true,
    })) as any;
  }

  /**
   * Get cross-stack API dependencies for a frontend symbol
   * Returns backend endpoint symbols that this frontend symbol calls
   */
  async getCrossStackApiDependencies(symbolId: number): Promise<EnhancedDependencyWithSymbols[]> {
    const results = await this.db('api_calls')
      .join('symbols as caller_symbol', 'api_calls.caller_symbol_id', 'caller_symbol.id')
      .join('symbols as endpoint_symbol', 'api_calls.endpoint_symbol_id', 'endpoint_symbol.id')
      .leftJoin('files as caller_files', 'caller_symbol.file_id', 'caller_files.id')
      .leftJoin('files as endpoint_files', 'endpoint_symbol.file_id', 'endpoint_files.id')
      .where('api_calls.caller_symbol_id', symbolId)
      .select(
        'api_calls.id as dependency_id',
        'api_calls.caller_symbol_id as from_symbol_id',
        'api_calls.endpoint_symbol_id as to_symbol_id',
        'api_calls.http_method',
        'api_calls.endpoint_path',
        'api_calls.line_number',
        'caller_symbol.name as from_symbol_name',
        'caller_symbol.symbol_type as from_symbol_type',
        'caller_files.path as from_file_path',
        'caller_files.id as from_file_id',
        'endpoint_symbol.name as to_symbol_name',
        'endpoint_symbol.symbol_type as to_symbol_type',
        'endpoint_files.path as to_file_path',
        'endpoint_files.id as to_file_id'
      )
      .distinct();

    return results.map(result => ({
      id: result.dependency_id,
      from_symbol_id: result.from_symbol_id,
      to_symbol_id: result.to_symbol_id,
      dependency_type: 'api_call' as any,
      line_number: result.line_number,
      created_at: new Date(),
      updated_at: new Date(),
      from_symbol: {
        id: result.from_symbol_id,
        name: result.from_symbol_name,
        symbol_type: result.from_symbol_type,
        file: {
          id: result.from_file_id,
          path: result.from_file_path,
        },
      },
      to_symbol: {
        id: result.to_symbol_id,
        name: result.to_symbol_name,
        symbol_type: result.to_symbol_type,
        file: {
          id: result.to_file_id,
          path: result.to_file_path,
        },
      },
      http_method: result.http_method,
      endpoint_path: result.endpoint_path,
      is_cross_stack: true,
    })) as any;
  }

  /**
   * Group calls by parameter context to show parameter variations
   * Enhancement 2: Context-Specific Analysis
   */
  async groupCallsByParameterContext(symbolId: number): Promise<{
    methodName: string;
    totalCalls: number;
    parameterVariations: Array<{
      parameter_context: string;
      call_instance_ids: string[];
      call_count: number;
      line_numbers: number[];
      callers: Array<{
        caller_name: string;
        file_path: string;
        line_number: number;
      }>;
      parameter_types?: string[];
    }>;
  }> {
    // Get the target symbol information
    const targetSymbol = await this.getSymbolWithFile(symbolId);
    if (!targetSymbol) {
      throw new Error('Symbol not found');
    }

    // Get all calls to this symbol with parameter context
    const calls = await this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .where('dependencies.to_symbol_id', symbolId)
      .whereNotNull('dependencies.parameter_context')
      .select(
        'dependencies.*',
        'from_symbols.name as caller_name',
        'from_files.path as caller_file_path'
      );

    // Group calls by parameter context
    const parameterGroups = new Map<string, any>();

    for (const call of calls) {
      const paramContext = call.parameter_context || 'no-parameters';

      if (!parameterGroups.has(paramContext)) {
        parameterGroups.set(paramContext, {
          parameter_context: paramContext,
          call_instance_ids: [],
          call_count: 0,
          line_numbers: [],
          callers: [],
          parameter_types: call.parameter_types
            ? this.safeParseParameterTypes(call.parameter_types)
            : undefined,
        });
      }

      const group = parameterGroups.get(paramContext);
      group.call_instance_ids.push(call.call_instance_id);
      group.call_count++;
      group.line_numbers.push(call.line_number);
      group.callers.push({
        caller_name: call.caller_name,
        file_path: call.caller_file_path,
        line_number: call.line_number,
      });
    }

    // Convert to array and calculate averages
    const parameterVariations = Array.from(parameterGroups.values()).map(group => ({
      ...group,
    }));

    return {
      methodName: targetSymbol.name,
      totalCalls: calls.length,
      parameterVariations,
    };
  }

  /**
   * Search symbols by qualified context
   */
  async searchQualifiedContext(query: string, classContext?: string): Promise<SymbolWithFile[]> {
    let queryBuilder = this.db('dependencies')
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
  async searchMethodSignatures(query: string): Promise<SymbolWithFile[]> {
    const results = await this.db('dependencies')
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
  async searchNamespaceContext(
    query: string,
    namespaceContext?: string
  ): Promise<SymbolWithFile[]> {
    let queryBuilder = this.db('dependencies')
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

  // ===== PHASE 1: PAGINATED QUERY METHODS =====
  // These methods provide pagination support for large result sets
  // Phase 1: Paginated query methods for performance

  /**
   * Get dependencies TO a symbol with pagination support (callers)
   * Phase 1: Pagination support for large result sets
   */
  async getDependenciesToWithContextPaginated(
    symbolId: number,
    paginationParams: PaginationParams = {}
  ): Promise<PaginatedResponse<EnhancedDependencyWithSymbols>> {
    // Use a subquery to get distinct dependencies first, then join with additional info
    const distinctSubquery = this.db('dependencies')
      .select(
        this.db.raw('MIN(id) as id'),
        'from_symbol_id',
        'to_symbol_id',
        'dependency_type',
        'line_number'
      )
      .where('to_symbol_id', symbolId)
      .whereRaw('from_symbol_id != to_symbol_id')
      .groupBy('from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number');

    const baseQuery = this.db('dependencies')
      .join(
        this.db.raw(`(${distinctSubquery.toString()}) as distinct_deps`),
        'dependencies.id',
        'distinct_deps.id'
      )
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .select(
        'dependencies.*',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path'
      )
      .orderBy('dependencies.id', 'asc');

    // Count query for total results (using distinct count)
    const countQuery = this.db('dependencies')
      .countDistinct(['from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number'])
      .where('dependencies.to_symbol_id', symbolId)
      .whereRaw('dependencies.from_symbol_id != dependencies.to_symbol_id');

    const result = await createPaginatedQuery<any>(
      baseQuery,
      paginationParams,
      countQuery,
      'dependencies.id'
    );

    // Transform results to match EnhancedDependencyWithSymbols interface
    result.data = result.data.map(row => ({
      ...row,
      from_symbol: {
        id: row.from_symbol_id,
        name: row.from_symbol_name,
        symbol_type: row.from_symbol_type,
        file: {
          id: row.from_file_id,
          path: row.from_file_path,
        },
      },
      calling_object: row.calling_object,
      resolved_class: row.resolved_class,
      qualified_context: row.qualified_context,
      method_signature: row.method_signature,
      file_context: row.file_context,
      namespace_context: row.namespace_context,
      parameter_context: row.parameter_context,
      call_instance_id: row.call_instance_id,
      parameter_types: row.parameter_types
        ? this.safeParseParameterTypes(row.parameter_types)
        : undefined,
    })) as EnhancedDependencyWithSymbols[];

    return result;
  }

  /**
   * Get dependencies FROM a symbol with pagination support (dependencies)
   * Phase 1: Pagination support for large result sets
   * Fixed: Now includes from_files join to get the correct file path where the call happens
   */
  async getDependenciesFromWithContextPaginated(
    symbolId: number,
    paginationParams: PaginationParams = {}
  ): Promise<PaginatedResponse<EnhancedDependencyWithSymbols>> {
    const baseQuery = this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
      .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
      .select(
        'dependencies.*',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path',
        'to_symbols.name as to_symbol_name',
        'to_symbols.symbol_type as to_symbol_type',
        'to_files.path as to_file_path'
      )
      .where('dependencies.from_symbol_id', symbolId)
      .orderBy('dependencies.id', 'asc');

    // Count query for total results
    const countQuery = this.db('dependencies')
      .count('* as count')
      .where('dependencies.from_symbol_id', symbolId);

    const result = await createPaginatedQuery<any>(
      baseQuery,
      paginationParams,
      countQuery,
      'dependencies.id'
    );

    // Transform results to match EnhancedDependencyWithSymbols interface
    result.data = result.data.map(row => ({
      ...row,
      from_symbol: {
        id: row.from_symbol_id,
        name: row.from_symbol_name,
        symbol_type: row.from_symbol_type,
        file: {
          id: row.from_file_id,
          path: row.from_file_path,
        },
      },
      to_symbol: {
        id: row.to_symbol_id,
        name: row.to_symbol_name,
        symbol_type: row.to_symbol_type,
        file: {
          id: row.to_file_id,
          path: row.to_file_path,
        },
      },
      calling_object: row.calling_object,
      resolved_class: row.resolved_class,
      qualified_context: row.qualified_context,
      method_signature: row.method_signature,
      file_context: row.file_context,
      namespace_context: row.namespace_context,
      parameter_context: row.parameter_context,
      call_instance_id: row.call_instance_id,
      parameter_types: row.parameter_types
        ? this.safeParseParameterTypes(row.parameter_types)
        : undefined,
    })) as EnhancedDependencyWithSymbols[];

    return result;
  }

  /**
   * Get symbol with caching support
   * Phase 1: Cached version of frequently accessed method
   */
  async getSymbolCached(symbolId: number): Promise<SymbolWithFile | null> {
    return withCache(
      'getSymbol',
      { symbolId },
      async () => {
        const result = await this.db('symbols')
          .leftJoin('files', 'symbols.file_id', 'files.id')
          .select('symbols.*', 'files.path as file_path', 'files.language as file_language')
          .where('symbols.id', symbolId)
          .first();

        if (!result) return null;

        return {
          ...result,
          file: {
            id: result.file_id,
            path: result.file_path,
            language: result.file_language,
          },
        } as SymbolWithFile;
      },
      300000 // 5 minute cache
    );
  }

  /**
   * Get dependencies with caching support
   * Phase 1: Cached version for frequently accessed dependency queries
   */
  async getDependenciesToCached(
    symbolId: number,
    dependencyTypes?: string[]
  ): Promise<EnhancedDependencyWithSymbols[]> {
    return withCache(
      'getDependenciesTo',
      { symbolId, dependencyTypes },
      async () => {
        let query = this.db('dependencies')
          .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
          .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
          .select(
            'dependencies.*',
            'from_symbols.name as from_symbol_name',
            'from_symbols.symbol_type as from_symbol_type',
            'from_files.path as from_file_path'
          )
          .where('dependencies.to_symbol_id', symbolId);

        if (dependencyTypes && dependencyTypes.length > 0) {
          query = query.whereIn('dependencies.dependency_type', dependencyTypes);
        }

        const results = await query;

        return results.map(result => ({
          ...result,
          from_symbol: {
            id: result.from_symbol_id,
            name: result.from_symbol_name,
            symbol_type: result.from_symbol_type,
            file: {
              id: result.from_file_id,
              path: result.from_file_path,
            },
          },
          calling_object: result.calling_object,
          resolved_class: result.resolved_class,
          qualified_context: result.qualified_context,
          method_signature: result.method_signature,
          file_context: result.file_context,
          namespace_context: result.namespace_context,
          parameter_context: result.parameter_context,
          call_instance_id: result.call_instance_id,
          parameter_types: result.parameter_types
            ? this.safeParseParameterTypes(result.parameter_types)
            : undefined,
        })) as EnhancedDependencyWithSymbols[];
      },
      180000 // 3 minute cache for dependency queries
    );
  }

  /**
   * Invalidates cache entries when data changes
   * Phase 1: Cache invalidation for data consistency
   */
  invalidateCacheForSymbol(symbolId: number): void {
    queryCache.invalidateByPattern(`getSymbol:${JSON.stringify({ symbolId })}`);
    queryCache.invalidateByPattern(`getDependenciesTo:${JSON.stringify({ symbolId })}`);
    queryCache.invalidateByPattern(`getDependenciesFrom:${JSON.stringify({ symbolId })}`);
  }

  /**
   * Invalidates all dependency-related cache entries
   * Phase 1: Bulk cache invalidation after data updates
   */
  invalidateDependencyCache(): void {
    queryCache.invalidateByPattern('getDependencies');
    queryCache.invalidateByPattern('whoCalls');
    queryCache.invalidateByPattern('impactOf');
  }

  /**
   * Gets cache statistics for monitoring
   * Phase 1: Performance monitoring support
   */
  getCacheStats() {
    return queryCache.getStats();
  }

  /**
   * Search symbols with pagination support
   * Phase 1: Pagination support for large search results
   */
  async searchSymbolsPaginated(
    options: SymbolSearchOptions & PaginationParams
  ): Promise<PaginatedResponse<SymbolWithFile>> {
    const { repoIds, symbolTypes, isExported, page_size, cursor, offset, ...searchOptions } =
      options;

    let queryBuilder = this.db('symbols')
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
    let countQuery = this.db('symbols')
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

  /**
   * Get routes impacted by the given symbol IDs (graph-based query)
   */
  async getRoutesForSymbols(symbolIds: number[]): Promise<RouteImpactRecord[]> {
    if (symbolIds.length === 0) return [];

    return await this.db('routes')
      .whereIn('handler_symbol_id', symbolIds)
      .select('id', 'path', 'method', 'framework_type', 'handler_symbol_id');
  }

  /**
   * Get jobs impacted by the given symbol IDs (graph-based query)
   *
   * Performance Note: LIKE queries on base_class and path may require table scans.
   * Consider adding indexes on these columns if this becomes a bottleneck.
   */
  async getJobsForSymbols(symbolIds: number[]): Promise<JobImpactRecord[]> {
    if (symbolIds.length === 0) return [];

    return await this.db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .whereIn('symbols.id', symbolIds)
      .where(function() {
        this.where('symbols.entity_type', 'job')
          .orWhere('symbols.base_class', 'like', '%Job%')
          .orWhere('files.path', 'like', '%/Jobs/%')
          .orWhere('files.path', 'like', '%/jobs/%');
      })
      .select('symbols.id', 'symbols.name', 'symbols.entity_type', 'files.path as file_path')
      .distinct();
  }

  /**
   * Get tests impacted by the given symbol IDs (graph-based query)
   *
   * Performance Note: LIKE queries on path may require table scans.
   * Consider adding indexes on the path column with trigram support for better performance.
   */
  async getTestsForSymbols(symbolIds: number[]): Promise<TestImpactRecord[]> {
    if (symbolIds.length === 0) return [];

    return await this.db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .whereIn('symbols.id', symbolIds)
      .where(function() {
        // Primary check: is_test flag (most efficient)
        this.where('files.is_test', true)
          // Fallback: common test file patterns (simplified to avoid redundancy)
          .orWhere('files.path', 'like', '%.test.%')  // Covers foo.test.js, foo.test.ts
          .orWhere('files.path', 'like', '%.spec.%')  // Covers foo.spec.js, foo.spec.ts
          .orWhere('files.path', 'like', '%Test.php'); // Covers FooTest.php (PHP convention)
      })
      .select('symbols.id', 'symbols.name', 'files.path as file_path', 'symbols.entity_type')
      .distinct();
  }
}

export const databaseService = new DatabaseService();
