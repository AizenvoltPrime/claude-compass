/**
 * Dependency Traversal Strategy
 *
 * Performs breadth-first search (BFS) from the entry point symbol,
 * following both forward dependencies (calls, imports) and backward
 * dependencies (callers, importers) within a configurable depth limit.
 *
 * This is typically the PRIMARY discovery mechanism as it follows
 * the actual code relationships in the graph.
 */

import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';
import { getEmbeddingService } from '../../../services/embedding-service';

const logger = createComponentLogger('dependency-traversal-strategy');

export class DependencyTraversalStrategy implements DiscoveryStrategy {
  readonly name = 'dependency-traversal';
  readonly description = 'BFS traversal of dependency graph from entry point';
  readonly priority = 10; // Run first - highest priority

  private static readonly MAX_VISITED_NODES = 50000;
  private static readonly MAX_QUEUE_SIZE = 10000;

  // Semantic Similarity Thresholds
  private static readonly SEMANTIC_SIMILARITY_THRESHOLD = 0.70; // Routes/API endpoints above this match feature
  private static readonly REQUEST_VALIDATION_THRESHOLD = 0.60; // Lower threshold for request validation (context-filtered)
  private static readonly CONTROLLER_SPECIFICITY_THRESHOLD = 0.5; // % of routes that must match
  private static readonly STRING_MATCH_SPECIFICITY_THRESHOLD = 0.6; // Fallback string matching

  // Hybrid Validation Thresholds (Models & Services)
  private static readonly MIN_DEPENDENCY_TYPES = 2; // e.g., import + reference
  private static readonly MIN_DEPENDENCY_REFS = 2; // Minimum usage count
  private static readonly MIN_NAMING_TOKENS = 2; // Matching tokens for strong naming

  // Embedding Cache Configuration
  private static readonly MAX_CACHE_SIZE = 1000; // Limit cache growth (~4MB max)
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (invalidates on model changes)

  // Embedding cache to avoid redundant API calls (with TTL and size limits)
  private featureEmbeddingCache: Map<string, { embedding: number[]; timestamp: number }> = new Map();

  constructor(private dbService: DatabaseService) {}

  /**
   * Proactively clean up expired cache entries to prevent unbounded growth.
   * Called at the start of each discovery run.
   */
  private cleanupCache(): void {
    const now = Date.now();
    const ttl = DependencyTraversalStrategy.CACHE_TTL_MS;
    let removedCount = 0;

    // Remove all expired entries
    for (const [key, value] of this.featureEmbeddingCache.entries()) {
      if (now - value.timestamp > ttl) {
        this.featureEmbeddingCache.delete(key);
        removedCount++;
      }
    }

    // Enforce size limit (should be rare after TTL cleanup, but adds safety)
    if (this.featureEmbeddingCache.size > DependencyTraversalStrategy.MAX_CACHE_SIZE) {
      const entries = Array.from(this.featureEmbeddingCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp); // Sort by timestamp (oldest first)

      const toRemove = entries.slice(
        0,
        this.featureEmbeddingCache.size - DependencyTraversalStrategy.MAX_CACHE_SIZE
      );

      toRemove.forEach(([key]) => this.featureEmbeddingCache.delete(key));
      removedCount += toRemove.length;
    }

    if (removedCount > 0) {
      logger.debug('Cache cleanup complete', {
        removedCount,
        remainingSize: this.featureEmbeddingCache.size,
        maxSize: DependencyTraversalStrategy.MAX_CACHE_SIZE,
      });
    }
  }

  /**
   * Only run on first iteration - subsequent discoveries handled by other strategies.
   */
  shouldRun(context: DiscoveryContext): boolean {
    return context.iteration === 0;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { entryPointId, options, featureName, repoId, currentSymbols } = context;
    const maxDepth = options.maxDepth;

    // Proactively clean up expired cache entries
    this.cleanupCache();

    logger.debug('Starting dependency traversal', {
      entryPoint: entryPointId,
      currentSymbols: currentSymbols.length,
      maxDepth,
      featureName,
    });

    const related = new Map<number, number>();

    // Initialize queue with ALL currently discovered symbols (including controller class expansion)
    // This ensures that when we start from a controller method and the discovery engine adds
    // the parent controller class, we traverse dependencies from both the method AND the class
    const queue = currentSymbols.map(id => ({ id, depth: 0 }));
    const visited = new Set<number>(currentSymbols);
    const discoveredSymbols = new Set<number>(currentSymbols); // Track all discovered symbols for context-aware filtering
    const validatedFileIds = new Set<number>(); // Track files containing validated entities for file-level filtering

    // Add all current symbol files to validated files
    const symbolsBatch = await this.dbService.getSymbolsBatch(currentSymbols);
    for (const [_id, symbol] of symbolsBatch) {
      if (symbol?.file_id) {
        validatedFileIds.add(symbol.file_id);
      }
    }

    // Initialize contextSymbols with methods from entry point controllers
    // When we start from a controller method and expand to include the controller class,
    // we need the controller's methods in contextSymbols so that request/model validation can see them.
    // Without this, requests used by controller methods won't pass validation because
    // validateRequests() checks if requests are used by methods in discoveredSymbols + contextSymbols.
    const entryPointControllerIds = currentSymbols.filter(id => {
      const symbol = symbolsBatch.get(id);
      return symbol?.entity_type === 'controller';
    });
    if (entryPointControllerIds.length > 0) {
      await this.expandContextWithControllerMethods(new Set(entryPointControllerIds), context.contextSymbols);
    }

    logger.debug('Initialized traversal queue', {
      queueSize: queue.length,
      visitedSize: visited.size,
      validatedFiles: validatedFileIds.size,
      entryPointControllers: entryPointControllerIds.length,
      contextSymbolsInitialized: context.contextSymbols.size,
    });

    while (queue.length > 0) {
      // Safety checks
      if (visited.size > DependencyTraversalStrategy.MAX_VISITED_NODES) {
        logger.warn('Hit max visited nodes limit, terminating traversal early', {
          visitedCount: visited.size,
          maxNodes: DependencyTraversalStrategy.MAX_VISITED_NODES,
        });
        break;
      }

      if (queue.length > DependencyTraversalStrategy.MAX_QUEUE_SIZE) {
        logger.warn('Queue size exceeded limit, pruning least relevant nodes', {
          queueSize: queue.length,
          maxQueueSize: DependencyTraversalStrategy.MAX_QUEUE_SIZE,
        });
        queue.sort((a, b) => a.depth - b.depth);
        queue.splice(DependencyTraversalStrategy.MAX_QUEUE_SIZE);
      }

      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      // Forward dependencies (calls, imports, references)
      const dependencies = await this.dbService.getDependenciesFrom(id);

      // Backward dependencies (callers, importers)
      const callers = await this.dbService.getDependenciesTo(id);

      const nextDepth = depth + 1;
      const candidateIds: number[] = [];

      for (const dep of dependencies) {
        const targetId = dep.to_symbol_id;
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          candidateIds.push(targetId);
        }
      }

      for (const dep of callers) {
        const targetId = dep.from_symbol_id;
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          candidateIds.push(targetId);
        }
      }

      // Smart filtering to prevent false positives while allowing valid connections
      if (candidateIds.length > 0) {
        const symbolMap = await this.dbService.getSymbolsBatch(candidateIds);

        // Batch validate controllers, stores, requests, and models to minimize database queries
        const controllerIds = candidateIds.filter(
          id => symbolMap.get(id)?.entity_type === 'controller'
        );
        const storeIds = candidateIds.filter(
          id => symbolMap.get(id)?.entity_type === 'store'
        );
        const requestIds = candidateIds.filter(
          id => symbolMap.get(id)?.entity_type === 'request'
        );
        const modelIds = candidateIds.filter(
          id => symbolMap.get(id)?.entity_type === 'model'
        );
        const serviceIds = candidateIds.filter(
          id => symbolMap.get(id)?.entity_type === 'service'
        );

        // Validate controllers at ALL depths to filter generic utility controllers
        // EXCEPT: Controllers discovered via graph edges (cross-stack API calls) bypass validation
        const graphValidatedControllers = controllerIds.filter(id =>
          context.graphValidatedSymbols.has(id)
        );
        const controllersNeedingValidation = controllerIds.filter(id =>
          !context.graphValidatedSymbols.has(id)
        );
        const semanticValidatedControllers = await this.validateControllers(
          controllersNeedingValidation,
          featureName,
          repoId
        );
        const validControllers = new Set([
          ...graphValidatedControllers,
          ...semanticValidatedControllers
        ]);

        if (graphValidatedControllers.length > 0) {
          logger.debug('Controllers bypassed validation via graph edges', {
            count: graphValidatedControllers.length,
            controllers: graphValidatedControllers,
          });
        }

        // Expand validation context to include methods from discovered controllers
        // This ensures request/model validation can see controller methods
        await this.expandContextWithControllerMethods(validControllers, context.contextSymbols);

        // Validate stores only at depth > 1
        const validStores = nextDepth > 1
          ? await this.validateStores(storeIds, featureName, repoId)
          : new Set(storeIds);

        // Validate requests at ALL depths to filter unrelated CRUD operations (context-aware)
        // EXCEPT: Requests discovered via graph edges (cross-stack API calls) bypass validation
        const graphValidatedRequests = requestIds.filter(id =>
          context.graphValidatedSymbols.has(id)
        );
        const requestsNeedingValidation = requestIds.filter(id =>
          !context.graphValidatedSymbols.has(id)
        );
        const semanticValidatedRequests = await this.validateRequests(
          requestsNeedingValidation,
          featureName,
          repoId,
          discoveredSymbols,
          context.contextSymbols
        );
        const validRequests = new Set([
          ...graphValidatedRequests,
          ...semanticValidatedRequests
        ]);

        if (graphValidatedRequests.length > 0) {
          logger.debug('Requests bypassed validation via graph edges', {
            count: graphValidatedRequests.length,
            requests: graphValidatedRequests,
          });
        }

        // Validate models at depth > 1 to allow related child models (context-aware)
        const validModels = nextDepth > 1
          ? await this.validateModels(modelIds, featureName, discoveredSymbols)
          : new Set(modelIds);

        // Validate services at depth > 1 to filter shared utility services (context-aware)
        const validServices = nextDepth > 1
          ? await this.validateServices(serviceIds, featureName, discoveredSymbols)
          : new Set(serviceIds);

        // Collect file IDs from all validated entities this iteration
        const currentIterationValidated = new Set([
          ...validControllers,
          ...validStores,
          ...validRequests,
          ...validModels,
          ...validServices
        ]);

        if (currentIterationValidated.size > 0) {
          await this.collectFileIds(currentIterationValidated, validatedFileIds);
        }

        for (const targetId of candidateIds) {
          const symbol = symbolMap.get(targetId);

          // Context-aware component filtering:
          // - Backend entry points: Exclude components at depth > 1 (UI elements less relevant)
          // - Frontend entry points: Allow deeper component discovery (UI is the feature)
          if (nextDepth > 1 && symbol?.entity_type === 'component' && !context.isFrontendEntryPoint) {
            continue;
          }

          // For controllers at ALL depths: only include if they pass specificity threshold
          if (symbol?.entity_type === 'controller' && !validControllers.has(targetId)) {
            continue;
          }

          // For stores at depth > 1: only include if they have cross-stack API connections
          if (nextDepth > 1 && symbol?.entity_type === 'store' && !validStores.has(targetId)) {
            continue;
          }

          // For requests at ALL depths: only include if used by feature-related methods
          if (symbol?.entity_type === 'request' && !validRequests.has(targetId)) {
            continue;
          }

          // For models at depth > 1: only include if semantically related to feature
          if (nextDepth > 1 && symbol?.entity_type === 'model' && !validModels.has(targetId)) {
            continue;
          }

          // For services at depth > 1: only include if semantically related to feature (context-aware)
          if (nextDepth > 1 && symbol?.entity_type === 'service' && !validServices.has(targetId)) {
            continue;
          }

          // FILE-LEVEL CONTEXT FILTERING at depth > 1
          // Only apply to generic symbols (methods, properties, variables, functions, interfaces)
          // Entity types (stores, services, models, controllers, components, requests, composables)
          // have their own validation logic and should not be filtered by file-level context
          const isEntityType = symbol?.entity_type && [
            'store', 'service', 'model', 'controller', 'component', 'request', 'composable'
          ].includes(symbol.entity_type);

          if (nextDepth > 1 && !isEntityType && symbol?.file_id && !validatedFileIds.has(symbol.file_id)) {
            logger.debug('Filtered by file-level context', {
              symbolId: targetId,
              symbolName: symbol.name,
              symbolType: symbol.symbol_type,
              fileId: symbol.file_id,
              depth: nextDepth,
            });
            continue;
          }

          const relevance = 1.0 - nextDepth / (maxDepth + 1);
          related.set(targetId, relevance);
          discoveredSymbols.add(targetId); // Add to discovered symbols for context-aware filtering
          queue.push({ id: targetId, depth: nextDepth });
        }
      }
    }

    logger.debug('Dependency traversal complete', {
      discovered: related.size,
      visited: visited.size,
    });

    return related;
  }

  /**
   * Get or generate cached embedding for feature name.
   * Caches embeddings to avoid redundant API calls during validation.
   *
   * Production-hardened with:
   * - TTL (24h) to handle embedding model updates
   * - Size limit (1000 entries) with LRU eviction
   * - Cache metrics logging
   */
  private async getFeatureEmbedding(featureName: string): Promise<number[]> {
    const now = Date.now();

    // Check cache with TTL validation
    const cached = this.featureEmbeddingCache.get(featureName);
    if (cached) {
      const age = now - cached.timestamp;
      const ttl = DependencyTraversalStrategy.CACHE_TTL_MS;

      if (age < ttl) {
        logger.debug('Cache HIT (valid)', {
          featureName,
          ageHours: (age / (1000 * 60 * 60)).toFixed(2),
          ttlHours: (ttl / (1000 * 60 * 60)).toFixed(0),
          cacheSize: this.featureEmbeddingCache.size,
        });
        return cached.embedding;
      } else {
        // TTL expired - remove stale entry
        this.featureEmbeddingCache.delete(featureName);
        logger.debug('Cache EXPIRED', {
          featureName,
          ageHours: (age / (1000 * 60 * 60)).toFixed(2),
        });
      }
    }

    // Cache miss or expired - check size limit before adding
    if (this.featureEmbeddingCache.size >= DependencyTraversalStrategy.MAX_CACHE_SIZE) {
      // LRU eviction: remove oldest entry (first in Map iteration order)
      const oldestKey = this.featureEmbeddingCache.keys().next().value;
      const oldestEntry = this.featureEmbeddingCache.get(oldestKey);
      this.featureEmbeddingCache.delete(oldestKey);

      logger.debug('Cache EVICTION (LRU)', {
        evictedFeature: oldestKey,
        evictedAgeHours: oldestEntry
          ? ((now - oldestEntry.timestamp) / (1000 * 60 * 60)).toFixed(2)
          : 'unknown',
        cacheSize: this.featureEmbeddingCache.size,
      });
    }

    // Generate fresh embedding
    const embeddingService = getEmbeddingService();
    await embeddingService.initialize();
    const embedding = await embeddingService.generateEmbedding(featureName);

    // Cache with timestamp
    this.featureEmbeddingCache.set(featureName, {
      embedding,
      timestamp: now,
    });

    logger.debug('Cache MISS (generated)', {
      featureName,
      cacheSize: this.featureEmbeddingCache.size,
      maxSize: DependencyTraversalStrategy.MAX_CACHE_SIZE,
    });

    return embedding;
  }

  /**
   * Validate controllers have feature-relevant routes using semantic similarity.
   * Uses embeddings to compare route paths with feature name for robust matching.
   */
  private async validateControllers(
    controllerIds: number[],
    featureName: string,
    repoId: number
  ): Promise<Set<number>> {
    if (controllerIds.length === 0) return new Set();

    const validControllers = new Set<number>();

    // Get or generate cached embedding for feature name
    let featureEmbedding: number[];
    try {
      featureEmbedding = await this.getFeatureEmbedding(featureName);
    } catch (error) {
      logger.warn('Failed to generate feature embedding, falling back to string matching', {
        featureName,
        error: (error as Error).message,
      });
      // Fallback to old string-based method if embeddings fail
      return this.validateControllersFallback(controllerIds, featureName, repoId);
    }

    // Query routes with embeddings for all controller methods
    const knex = this.dbService.knex;
    const routes = await knex('routes as r')
      .join('symbols as s', 'r.handler_symbol_id', 's.id')
      .join('files as f', 's.file_id', 'f.id')
      .join('symbols as c', function() {
        this.on('c.file_id', '=', 'f.id')
          .andOn('c.symbol_type', '=', knex.raw('?', ['class']))
          .andOn('c.entity_type', '=', knex.raw('?', ['controller']));
      })
      .whereIn('c.id', controllerIds)
      .where('r.repo_id', repoId)
      .whereNotNull('r.path_embedding')
      .select(
        'c.id as controller_id',
        'r.path',
        'r.method',
        'r.controller_method',
        knex.raw('(1 - (r.path_embedding <=> ?)) as similarity', [JSON.stringify(featureEmbedding)])
      );

    // Group routes by controller and calculate semantic specificity
    const controllerStats = new Map<number, { total: number; matchingCount: number }>();

    for (const route of routes) {
      const controllerId = route.controller_id;
      const similarity = parseFloat(route.similarity) || 0;

      if (!controllerStats.has(controllerId)) {
        controllerStats.set(controllerId, { total: 0, matchingCount: 0 });
      }

      const stats = controllerStats.get(controllerId)!;
      stats.total++;

      // Count routes with strong semantic similarity above threshold
      if (similarity >= DependencyTraversalStrategy.SEMANTIC_SIMILARITY_THRESHOLD) {
        stats.matchingCount++;
      }
    }

    // Filter controllers based on specificity
    // Controllers must have >=50% of routes strongly matching the feature

    for (const [controllerId, stats] of controllerStats.entries()) {
      if (stats.total === 0) continue;

      // Calculate percentage of routes that strongly match the feature
      const specificity = stats.matchingCount / stats.total;

      if (specificity >= DependencyTraversalStrategy.CONTROLLER_SPECIFICITY_THRESHOLD) {
        validControllers.add(controllerId);
      }
    }

    logger.debug('Controller validation complete (semantic)', {
      total: controllerIds.length,
      valid: validControllers.size,
      filtered: controllerIds.length - validControllers.size,
      similarityThreshold: DependencyTraversalStrategy.SEMANTIC_SIMILARITY_THRESHOLD,
      specificityThreshold: DependencyTraversalStrategy.CONTROLLER_SPECIFICITY_THRESHOLD,
    });

    return validControllers;
  }

  /**
   * Fallback string-based validation when embeddings are unavailable
   */
  private async validateControllersFallback(
    controllerIds: number[],
    featureName: string,
    repoId: number
  ): Promise<Set<number>> {
    const validControllers = new Set<number>();

    // Extract feature name patterns for matching
    const featureWords = featureName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3);

    const knex = this.dbService.knex;
    const routes = await knex('routes as r')
      .join('symbols as s', 'r.handler_symbol_id', 's.id')
      .join('files as f', 's.file_id', 'f.id')
      .join('symbols as c', function() {
        this.on('c.file_id', '=', 'f.id')
          .andOn('c.symbol_type', '=', knex.raw('?', ['class']))
          .andOn('c.entity_type', '=', knex.raw('?', ['controller']));
      })
      .whereIn('c.id', controllerIds)
      .where('r.repo_id', repoId)
      .select('c.id as controller_id', 'r.path', 'r.method', 'r.controller_method');

    const controllerStats = new Map<number, { total: number; matching: number }>();

    for (const route of routes) {
      const controllerId = route.controller_id;
      const routePath = route.path?.toLowerCase() || '';
      const controllerMethod = route.controller_method?.toLowerCase() || '';

      if (!controllerStats.has(controllerId)) {
        controllerStats.set(controllerId, { total: 0, matching: 0 });
      }

      const stats = controllerStats.get(controllerId)!;
      stats.total++;

      const hasMatch = featureWords.some(
        word => routePath.includes(word) || controllerMethod.includes(word)
      );

      if (hasMatch) {
        stats.matching++;
      }
    }

    for (const [controllerId, stats] of controllerStats.entries()) {
      const specificity = stats.matching / stats.total;
      if (specificity > DependencyTraversalStrategy.STRING_MATCH_SPECIFICITY_THRESHOLD) {
        validControllers.add(controllerId);
      }
    }

    return validControllers;
  }

  /**
   * Validate stores have cross-stack API connections using semantic similarity.
   * Uses embeddings to compare API endpoint paths with feature name for robust matching.
   */
  private async validateStores(
    storeIds: number[],
    featureName: string,
    repoId: number
  ): Promise<Set<number>> {
    if (storeIds.length === 0) return new Set();

    const validStores = new Set<number>();

    // Get or generate cached embedding for feature name
    let featureEmbedding: number[];
    try {
      featureEmbedding = await this.getFeatureEmbedding(featureName);
    } catch (error) {
      logger.warn('Failed to generate feature embedding, falling back to string matching', {
        featureName,
        error: (error as Error).message,
      });
      // Fallback to old string-based method if embeddings fail
      return this.validateStoresFallback(storeIds, featureName, repoId);
    }

    // Query API calls with embeddings where store methods are the caller
    const knex = this.dbService.knex;
    const apiCalls = await knex('api_calls as ac')
      .join('symbols as caller', 'ac.caller_symbol_id', 'caller.id')
      .join('files as f', 'caller.file_id', 'f.id')
      .join('symbols as store', function() {
        this.on('store.file_id', '=', 'f.id')
          .andOn('store.entity_type', '=', knex.raw('?', ['store']));
      })
      .whereIn('store.id', storeIds)
      .where('ac.repo_id', repoId)
      .whereNotNull('ac.endpoint_embedding')
      .select(
        'store.id as store_id',
        'ac.endpoint_path',
        'ac.http_method',
        knex.raw('(1 - (ac.endpoint_embedding <=> ?)) as similarity', [JSON.stringify(featureEmbedding)])
      );

    // Validate stores based on semantic similarity of their API calls
    for (const apiCall of apiCalls) {
      const similarity = parseFloat(apiCall.similarity) || 0;

      // If any API call from this store matches the feature semantically, include the store
      if (similarity >= DependencyTraversalStrategy.SEMANTIC_SIMILARITY_THRESHOLD) {
        validStores.add(apiCall.store_id);
      }
    }

    logger.debug('Store validation complete (semantic)', {
      total: storeIds.length,
      valid: validStores.size,
      filtered: storeIds.length - validStores.size,
      similarityThreshold: DependencyTraversalStrategy.SEMANTIC_SIMILARITY_THRESHOLD,
    });

    return validStores;
  }

  /**
   * Fallback string-based store validation when embeddings are unavailable
   */
  private async validateStoresFallback(
    storeIds: number[],
    featureName: string,
    repoId: number
  ): Promise<Set<number>> {
    const validStores = new Set<number>();

    const featureWords = featureName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3);

    const knex = this.dbService.knex;
    const apiCalls = await knex('api_calls as ac')
      .join('symbols as caller', 'ac.caller_symbol_id', 'caller.id')
      .join('files as f', 'caller.file_id', 'f.id')
      .join('symbols as store', function() {
        this.on('store.file_id', '=', 'f.id')
          .andOn('store.entity_type', '=', knex.raw('?', ['store']));
      })
      .whereIn('store.id', storeIds)
      .where('ac.repo_id', repoId)
      .select('store.id as store_id', 'ac.endpoint_path', 'ac.http_method');

    for (const apiCall of apiCalls) {
      const endpointPath = apiCall.endpoint_path?.toLowerCase() || '';
      const hasMatch = featureWords.some(word => endpointPath.includes(word));

      if (hasMatch) {
        validStores.add(apiCall.store_id);
      }
    }

    return validStores;
  }

  /**
   * Validate request classes by checking if they're used by feature-related controller methods.
   * Uses semantic similarity between the routes handled by those methods and the feature name.
   *
   * Context-aware: Checks routes from BOTH discovered controller methods (feature symbols)
   * AND context symbols (all methods from discovered controllers) to properly validate requests.
   */
  private async validateRequests(
    requestIds: number[],
    featureName: string,
    repoId: number,
    discoveredSymbols: Set<number>,
    contextSymbols: Set<number>
  ): Promise<Set<number>> {
    if (requestIds.length === 0) return new Set();

    const validRequests = new Set<number>();

    // Get or generate cached embedding for feature name
    let featureEmbedding: number[];
    try {
      featureEmbedding = await this.getFeatureEmbedding(featureName);
    } catch (error) {
      logger.warn('Failed to generate feature embedding for request validation, falling back to string matching', {
        featureName,
        error: (error as Error).message,
      });
      return this.validateRequestsFallback(requestIds, featureName, repoId, discoveredSymbols, contextSymbols);
    }

    // Query routes with embeddings for controller methods that use these requests
    // Request → Controller Method (via dependencies) → Route (via handler_symbol_id)
    // CONTEXT-AWARE: Checks routes from both feature symbols AND context symbols
    const knex = this.dbService.knex;
    const allMethodIds = Array.from(new Set([...discoveredSymbols, ...contextSymbols]));
    const routes = await knex('routes as r')
      .join('symbols as method', 'r.handler_symbol_id', 'method.id')
      .join('dependencies as d', 'd.from_symbol_id', 'method.id')
      .join('symbols as req', 'd.to_symbol_id', 'req.id')
      .whereIn('req.id', requestIds)
      .whereIn('method.id', allMethodIds) // CONTEXT FILTER: Discovered + context controller methods
      .where('r.repo_id', repoId)
      .where('req.entity_type', 'request')
      .whereNotNull('r.path_embedding')
      .select(
        'req.id as request_id',
        'r.path',
        'r.method',
        'method.name as controller_method',
        'method.id as method_id',
        knex.raw('(1 - (r.path_embedding <=> ?)) as similarity', [JSON.stringify(featureEmbedding)])
      );

    // Validate requests based on semantic similarity of routes that use them
    // Uses lower threshold than route discovery because:
    // 1. Already context-filtered (only routes from discovered controller methods)
    // 2. Request usage is a strong signal (controller explicitly imports/uses the request)
    // 3. Simple paths like "/api/personnel" score ~0.64 for "Personnel" feature
    for (const route of routes) {
      const similarity = parseFloat(route.similarity) || 0;

      // If ANY route using this request matches the feature semantically, include the request
      if (similarity >= DependencyTraversalStrategy.REQUEST_VALIDATION_THRESHOLD) {
        validRequests.add(route.request_id);
      }
    }

    logger.debug('Request validation complete (semantic, context-aware)', {
      total: requestIds.length,
      valid: validRequests.size,
      filtered: requestIds.length - validRequests.size,
      contextSize: discoveredSymbols.size,
      similarityThreshold: DependencyTraversalStrategy.REQUEST_VALIDATION_THRESHOLD,
    });

    return validRequests;
  }

  /**
   * Fallback string-based request validation when embeddings are unavailable
   * Context-aware: Checks routes from both discovered and context controller methods
   */
  private async validateRequestsFallback(
    requestIds: number[],
    featureName: string,
    repoId: number,
    discoveredSymbols: Set<number>,
    contextSymbols: Set<number>
  ): Promise<Set<number>> {
    const validRequests = new Set<number>();

    const featureWords = featureName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3);

    const knex = this.dbService.knex;
    const allMethodIds = Array.from(new Set([...discoveredSymbols, ...contextSymbols]));
    const routes = await knex('routes as r')
      .join('symbols as method', 'r.handler_symbol_id', 'method.id')
      .join('dependencies as d', 'd.from_symbol_id', 'method.id')
      .join('symbols as req', 'd.to_symbol_id', 'req.id')
      .whereIn('req.id', requestIds)
      .whereIn('method.id', allMethodIds) // CONTEXT FILTER: Discovered + context controller methods
      .where('r.repo_id', repoId)
      .where('req.entity_type', 'request')
      .select('req.id as request_id', 'r.path', 'r.method', 'method.name as controller_method');

    for (const route of routes) {
      const routePath = route.path?.toLowerCase() || '';
      const controllerMethod = route.controller_method?.toLowerCase() || '';

      const hasMatch = featureWords.some(
        word => routePath.includes(word) || controllerMethod.includes(word)
      );

      if (hasMatch) {
        validRequests.add(route.request_id);
      }
    }

    logger.debug('Request validation complete (fallback, context-aware)', {
      total: requestIds.length,
      valid: validRequests.size,
      filtered: requestIds.length - validRequests.size,
      contextSize: discoveredSymbols.size,
    });

    return validRequests;
  }

  /**
   * Validate models at depth > 1 using HYBRID approach:
   * 1. Strong dependency (multiple dependency types + high reference count)
   * 2. Strong naming similarity (≥2 matching tokens)
   *
   * Context-aware: Only counts dependencies from already-discovered feature symbols.
   * This prevents false negatives (blocking legitimate cross-domain models like User, Camera)
   * while filtering false positives from test files and unrelated code.
   */
  private async validateModels(
    modelIds: number[],
    featureName: string,
    discoveredSymbols: Set<number>
  ): Promise<Set<number>> {
    if (modelIds.length === 0) return new Set();

    const validModels = new Set<number>();

    // Extract feature name tokens
    const featureTokens = featureName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(t => t.length > 3)
      .map(t => t.toLowerCase());

    // Get dependency strength for each model (CONTEXT-AWARE)
    const dependencyStrength = await this.getModelDependencyStrength(modelIds, discoveredSymbols);

    // Get model names for naming similarity
    const models = await this.dbService.getSymbolsBatch(modelIds);

    for (const [modelId, model] of models.entries()) {
      if (!model?.name) continue;

      // Calculate naming similarity
      const modelTokens = model.name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/\s+/)
        .map(t => t.toLowerCase());

      const matchingTokens = featureTokens.filter(ft =>
        modelTokens.some(mt => mt.includes(ft) || ft.includes(mt))
      );

      const namingScore = matchingTokens.length;

      // Get dependency strength
      const strength = dependencyStrength.get(modelId) || { typeCount: 0, totalRefs: 0 };

      // Validation criteria (pass if EITHER is true):
      // 1. Strong dependency: multiple dependency types (import + reference) AND multiple uses
      const strongDependency =
        strength.typeCount >= DependencyTraversalStrategy.MIN_DEPENDENCY_TYPES &&
        strength.totalRefs >= DependencyTraversalStrategy.MIN_DEPENDENCY_REFS;

      // 2. Strong naming: at least 2 matching tokens
      const strongNaming = namingScore >= Math.min(DependencyTraversalStrategy.MIN_NAMING_TOKENS, featureTokens.length);

      if (strongDependency || strongNaming) {
        validModels.add(modelId);

        logger.debug('Model validated', {
          model: model.name,
          reason: strongDependency && strongNaming
            ? 'both'
            : strongDependency
            ? 'strong dependency'
            : 'strong naming',
          namingScore,
          dependencyTypes: strength.typeCount,
          totalRefs: strength.totalRefs,
        });
      } else {
        logger.debug('Model filtered', {
          model: model.name,
          namingScore,
          dependencyTypes: strength.typeCount,
          totalRefs: strength.totalRefs,
        });
      }
    }

    logger.info('Model validation complete (hybrid, context-aware)', {
      total: modelIds.length,
      valid: validModels.size,
      filtered: modelIds.length - validModels.size,
      contextSize: discoveredSymbols.size,
    });

    return validModels;
  }

  /**
   * Validate services at depth > 1 using HYBRID approach (same as models):
   * 1. Strong dependency (multiple dependency types + high reference count)
   * 2. Strong naming similarity (≥2 matching tokens)
   *
   * Context-aware: Only counts dependencies from already-discovered feature symbols.
   * This prevents false positives from shared utility services (email, logging, etc.)
   * while including feature-specific services like VehicleCameraAlertService.
   */
  private async validateServices(
    serviceIds: number[],
    featureName: string,
    discoveredSymbols: Set<number>
  ): Promise<Set<number>> {
    if (serviceIds.length === 0) return new Set();

    const validServices = new Set<number>();

    // Extract feature name tokens
    const featureTokens = featureName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(t => t.length > 3)
      .map(t => t.toLowerCase());

    // Get dependency strength for each service (CONTEXT-AWARE)
    const dependencyStrength = await this.getServiceDependencyStrength(serviceIds, discoveredSymbols);

    // Get service names for naming similarity
    const services = await this.dbService.getSymbolsBatch(serviceIds);

    for (const [serviceId, service] of services.entries()) {
      if (!service?.name) continue;

      // Calculate naming similarity
      const serviceTokens = service.name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/\s+/)
        .map(t => t.toLowerCase());

      const matchingTokens = featureTokens.filter(ft =>
        serviceTokens.some(st => st.includes(ft) || ft.includes(st))
      );

      const namingScore = matchingTokens.length;

      // Get dependency strength
      const strength = dependencyStrength.get(serviceId) || { typeCount: 0, totalRefs: 0 };

      // Validation criteria (pass if EITHER is true):
      // 1. Strong dependency: multiple dependency types (import + reference) AND multiple uses
      const strongDependency =
        strength.typeCount >= DependencyTraversalStrategy.MIN_DEPENDENCY_TYPES &&
        strength.totalRefs >= DependencyTraversalStrategy.MIN_DEPENDENCY_REFS;

      // 2. Strong naming: at least 2 matching tokens
      const strongNaming = namingScore >= Math.min(DependencyTraversalStrategy.MIN_NAMING_TOKENS, featureTokens.length);

      if (strongDependency || strongNaming) {
        validServices.add(serviceId);

        logger.debug('Service validated', {
          service: service.name,
          reason: strongDependency && strongNaming
            ? 'both'
            : strongDependency
            ? 'strong dependency'
            : 'strong naming',
          namingScore,
          dependencyTypes: strength.typeCount,
          totalRefs: strength.totalRefs,
        });
      } else {
        logger.debug('Service filtered', {
          service: service.name,
          namingScore,
          dependencyTypes: strength.typeCount,
          totalRefs: strength.totalRefs,
        });
      }
    }

    logger.info('Service validation complete (hybrid, context-aware)', {
      total: serviceIds.length,
      valid: validServices.size,
      filtered: serviceIds.length - validServices.size,
      contextSize: discoveredSymbols.size,
    });

    return validServices;
  }

  /**
   * Calculate dependency strength for models based on:
   * - Number of different dependency types (imports, references, etc.)
   * - Total number of references
   *
   * CONTEXT-AWARE: Only counts dependencies originating from discovered feature symbols.
   * METHOD-LEVEL: Excludes class-level dependencies (constructors, imports) to avoid
   * false positives from general setup code.
   */
  private async getModelDependencyStrength(
    modelIds: number[],
    discoveredSymbols: Set<number>
  ): Promise<Map<number, { typeCount: number; totalRefs: number }>> {
    if (modelIds.length === 0) return new Map();

    const knex = this.dbService.knex;
    const discoveredArray = Array.from(discoveredSymbols);

    // Query dependency counts grouped by model and type
    // CONTEXT FILTER: Only count dependencies FROM discovered symbols
    // METHOD-LEVEL FILTER: Exclude class-level dependencies (constructors, imports)
    const results = await knex('dependencies as d')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .select(
        'd.to_symbol_id as model_id',
        knex.raw('COUNT(DISTINCT d.dependency_type) as type_count'),
        knex.raw('COUNT(*) as total_refs')
      )
      .whereIn('d.to_symbol_id', modelIds)
      .whereIn('d.from_symbol_id', discoveredArray) // CONTEXT FILTER
      .whereNotIn('s.symbol_type', ['class', 'interface']) // EXCLUDE class-level dependencies
      .groupBy('d.to_symbol_id');

    const strengthMap = new Map<number, { typeCount: number; totalRefs: number }>();

    for (const row of results) {
      strengthMap.set(row.model_id, {
        typeCount: parseInt(row.type_count),
        totalRefs: parseInt(row.total_refs),
      });
    }

    return strengthMap;
  }

  /**
   * Calculate dependency strength for services based on:
   * - Number of different dependency types (imports, references, etc.)
   * - Total number of references
   *
   * CONTEXT-AWARE: Only counts dependencies originating from discovered feature symbols.
   * METHOD-LEVEL: Excludes class-level dependencies (constructors, imports) to avoid
   * false positives from general setup code.
   */
  private async getServiceDependencyStrength(
    serviceIds: number[],
    discoveredSymbols: Set<number>
  ): Promise<Map<number, { typeCount: number; totalRefs: number }>> {
    if (serviceIds.length === 0) return new Map();

    const knex = this.dbService.knex;
    const discoveredArray = Array.from(discoveredSymbols);

    // Query dependency counts grouped by service and type
    // CONTEXT FILTER: Only count dependencies FROM discovered symbols
    // METHOD-LEVEL FILTER: Exclude class-level dependencies (constructors, imports)
    const results = await knex('dependencies as d')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .select(
        'd.to_symbol_id as service_id',
        knex.raw('COUNT(DISTINCT d.dependency_type) as type_count'),
        knex.raw('COUNT(*) as total_refs')
      )
      .whereIn('d.to_symbol_id', serviceIds)
      .whereIn('d.from_symbol_id', discoveredArray) // CONTEXT FILTER
      .whereNotIn('s.symbol_type', ['class', 'interface']) // EXCLUDE class-level dependencies
      .groupBy('d.to_symbol_id');

    const strengthMap = new Map<number, { typeCount: number; totalRefs: number }>();

    for (const row of results) {
      strengthMap.set(row.service_id, {
        typeCount: parseInt(row.type_count),
        totalRefs: parseInt(row.total_refs),
      });
    }

    return strengthMap;
  }

  /**
   * Expand validation context to include all methods from discovered controllers.
   *
   * Controllers have a class→method hierarchy where methods aren't dependencies of the class.
   * When we discover a controller class during traversal, we need to explicitly include
   * its methods in the validation context so that request/model validation can see them.
   *
   * IMPORTANT: These methods are added to contextSymbols (NOT discoveredSymbols) because
   * they're for validation only. Only methods that are actually feature-relevant should
   * appear in discoveredSymbols and thus in the final feature manifest and route discovery.
   */
  private async expandContextWithControllerMethods(
    controllerIds: Set<number>,
    contextSymbols: Set<number>
  ): Promise<void> {
    if (controllerIds.size === 0) return;

    const knex = this.dbService.knex;

    // Get all methods from the discovered controller files
    const methods = await knex('symbols as method')
      .join('files as f', 'method.file_id', 'f.id')
      .join('symbols as controller', 'controller.file_id', 'f.id')
      .whereIn('controller.id', Array.from(controllerIds))
      .where('controller.entity_type', 'controller')
      .where('method.symbol_type', 'method')
      .select('method.id');

    // Add all controller methods to validation context (not feature symbols)
    for (const row of methods) {
      contextSymbols.add(row.id);
    }

    logger.debug('Expanded validation context with controller methods', {
      controllers: controllerIds.size,
      methodsAdded: methods.length,
      totalContextSymbols: contextSymbols.size,
    });
  }

  /**
   * Collect file IDs from a set of symbols.
   * Used to build the validated files context for file-level filtering at depth > 1.
   *
   * Only symbols from files containing validated entities (controllers, services, models, etc.)
   * will be included in related_symbols, filtering out methods from unrelated files.
   */
  private async collectFileIds(
    symbolIds: Set<number>,
    fileIds: Set<number>
  ): Promise<void> {
    if (symbolIds.size === 0) return;

    const symbols = await this.dbService.getSymbolsBatch(Array.from(symbolIds));

    let addedCount = 0;
    for (const [_, symbol] of symbols.entries()) {
      if (symbol?.file_id && !fileIds.has(symbol.file_id)) {
        fileIds.add(symbol.file_id);
        addedCount++;
      }
    }

    logger.debug('Collected file IDs from validated symbols', {
      symbolCount: symbolIds.size,
      newFiles: addedCount,
      totalValidatedFiles: fileIds.size,
    });
  }
}
