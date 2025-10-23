/**
 * Cross-Stack Strategy
 *
 * Discovers backend endpoints that are called by frontend code,
 * bridging the Vue/React → Laravel/Express API boundary.
 *
 * Uses the api_calls table which tracks API endpoint relationships
 * extracted during parsing.
 */

import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';

const logger = createComponentLogger('cross-stack-strategy');

const BACKEND_SYMBOL_RELEVANCE = 0.8;
const FRONTEND_PARENT_RELEVANCE = 0.9;

export class CrossStackStrategy implements DiscoveryStrategy {
  readonly name = 'cross-stack';
  readonly description = 'Discover backend endpoints called by frontend';
  readonly priority = 5; // Run BEFORE dependency-traversal to mark graph-validated controllers

  private frontendLanguagesCache = new Map<number, string[]>();

  constructor(private dbService: DatabaseService) {}

  /**
   * Run every iteration to catch new frontend → backend connections.
   */
  shouldRun(context: DiscoveryContext): boolean {
    return true;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { currentSymbols, repoId } = context;
    const db = this.dbService.knex;

    logger.debug('Starting cross-stack discovery', {
      currentSymbolsCount: currentSymbols.length,
    });

    // Auto-detect frontend and backend languages
    const frontendLanguages = await this.detectFrontendLanguages(repoId);
    const backendLanguages = await this.detectBackendLanguages(repoId);

    // Find frontend symbols using detected languages
    const frontendSymbols = await db('symbols')
      .whereIn('symbols.id', currentSymbols)
      .join('files', 'symbols.file_id', 'files.id')
      .whereIn('files.language', frontendLanguages)
      .select('symbols.id');

    let frontendIds = frontendSymbols.map((s: { id: number }) => s.id);

    // REVERSE DISCOVERY: When starting from backend, find frontend symbols that call backend endpoints
    // This discovers stores/components when starting discovery from controller methods
    if (frontendIds.length === 0 && backendLanguages.length > 0) {
      const backendSymbols = await db('symbols')
        .whereIn('symbols.id', currentSymbols)
        .join('files', 'symbols.file_id', 'files.id')
        .whereIn('files.language', backendLanguages)
        .select('symbols.id');

      const backendIds = backendSymbols.map((s: { id: number }) => s.id);

      if (backendIds.length > 0) {
        const result = await this.discoverFrontendCallers(backendIds);
        logger.info('Reverse cross-stack discovery complete (backend → frontend)', {
          backendSymbols: backendIds.length,
          frontendDiscovered: result.size,
        });
        return result;
      }

      logger.debug('No frontend or backend symbols found', {
        frontendLanguages,
        backendLanguages,
      });
      return new Map();
    }

    if (frontendIds.length === 0) {
      logger.debug('No frontend symbols found', {
        detectedLanguages: frontendLanguages,
      });
      return new Map();
    }

    // METHOD-LEVEL EXPANSION: Include only store/composable methods that are actually CALLED
    // This prevents discovering ALL methods in a store file
    // and instead only follows methods with proven call relationships
    const expandedIds = await this.expandWithStoreMethods(frontendIds);
    frontendIds = Array.from(new Set([...frontendIds, ...expandedIds]));

    logger.debug('Expanded frontend symbols with store methods (method-level tracking)', {
      original: frontendSymbols.length,
      withMethods: frontendIds.length,
      expandedMethods: expandedIds.length,
      approach: 'call-based (not name-based)',
    });

    // Find backend endpoints these frontend symbols call
    const apiCalls = await db('api_calls')
      .whereIn('caller_symbol_id', frontendIds)
      .select('endpoint_symbol_id');

    const backendEndpointIds = apiCalls
      .map((ac: { endpoint_symbol_id: number | null }) => ac.endpoint_symbol_id)
      .filter((id): id is number => id !== null);

    // Find parent controller classes, request classes, and service dependencies in parallel
    // This ensures transitive backend discovery (method → controller class + requests + services)
    // Parallelization saves ~200ms per 20 endpoints
    const [controllerIds, requestIds, serviceIds] = await Promise.all([
      this.findParentControllers(backendEndpointIds),
      this.findEndpointRequests(backendEndpointIds),
      this.findServiceDependencies(backendEndpointIds),
    ]);

    // Collect specific backend symbols to find related models
    // Exclude controller classes (too broad - they import models for all their methods)
    // Include: endpoint methods (specific) + services (feature-scoped)
    const backendIdsForModelDiscovery = [...backendEndpointIds, ...serviceIds];
    const relatedModelIds = await this.findRelatedModels(backendIdsForModelDiscovery);

    // Convert to relevance map (methods, controllers, requests, services, and related models)
    const result = new Map<number, number>();
    backendEndpointIds.forEach(id => result.set(id, BACKEND_SYMBOL_RELEVANCE));
    controllerIds.forEach(id => result.set(id, BACKEND_SYMBOL_RELEVANCE));
    requestIds.forEach(id => result.set(id, BACKEND_SYMBOL_RELEVANCE));
    serviceIds.forEach(id => result.set(id, BACKEND_SYMBOL_RELEVANCE));
    relatedModelIds.forEach(id => result.set(id, BACKEND_SYMBOL_RELEVANCE));

    logger.info('Cross-stack discovery complete', {
      frontendSymbols: frontendIds.length,
      frontendSymbolIds: frontendIds,
      backendEndpoints: backendEndpointIds.length,
      backendEndpointIds: backendEndpointIds,
      controllerClasses: controllerIds.length,
      controllerIds: controllerIds,
      requestClasses: requestIds.length,
      requestIds: requestIds,
      services: serviceIds.length,
      serviceIds: serviceIds,
      relatedModels: relatedModelIds.length,
      relatedModelIds: relatedModelIds,
      frontendLanguages,
      totalDiscovered: result.size,
    });

    return result;
  }

  /**
   * Auto-detect frontend languages from repository metadata.
   * Analyzes frameworks to determine which languages are frontend vs backend.
   */
  private async detectFrontendLanguages(repoId: number): Promise<string[]> {
    // Check cache first
    const cached = this.frontendLanguagesCache.get(repoId);
    if (cached !== undefined) {
      return cached;
    }

    const db = this.dbService.knex;

    // Get repository frameworks
    const repo = await db('repositories')
      .where('id', repoId)
      .select('framework_stack', 'language_primary')
      .first();

    if (!repo) {
      return [];
    }

    const frameworks: string[] = repo.framework_stack || [];
    const frontendLanguages = new Set<string>();

    // Map frameworks to their frontend languages
    const frameworkLanguageMap: Record<string, string[]> = {
      vue: ['vue', 'javascript', 'typescript'],
      react: ['jsx', 'tsx', 'javascript', 'typescript'],
      angular: ['typescript', 'javascript'],
      svelte: ['svelte', 'javascript', 'typescript'],
      ember: ['javascript', 'typescript'],
      nextjs: ['jsx', 'tsx', 'javascript', 'typescript'],
      nuxt: ['vue', 'javascript', 'typescript'],
    };

    // Add languages from detected frameworks
    for (const framework of frameworks) {
      const languages = frameworkLanguageMap[framework.toLowerCase()];
      if (languages) {
        languages.forEach(lang => frontendLanguages.add(lang));
      }
    }

    // If no frameworks detected, check files table for language patterns
    if (frontendLanguages.size === 0) {
      const languages: string[] = await db('files')
        .where('repo_id', repoId)
        .distinct('language')
        .pluck('language');

      // Classify languages as frontend based on common patterns
      const commonFrontendLanguages = ['vue', 'jsx', 'tsx', 'svelte', 'typescript', 'javascript'];

      for (const lang of languages) {
        if (commonFrontendLanguages.includes(lang)) {
          frontendLanguages.add(lang);
        }
      }
    }

    const result = Array.from(frontendLanguages);
    this.frontendLanguagesCache.set(repoId, result);

    logger.debug('Auto-detected frontend languages', {
      repoId,
      frameworks,
      languages: result,
    });

    return result;
  }

  /**
   * Find parent controller classes for endpoint methods.
   * When frontend code calls backend endpoints, we discover the endpoint methods.
   * This method finds the controller classes that contain those methods to ensure
   * complete backend discovery (method + controller class + routes + requests).
   */
  private async findParentControllers(endpointMethodIds: number[]): Promise<number[]> {
    if (endpointMethodIds.length === 0) return [];

    const db = this.dbService.knex;

    // Find controller classes in the same files as the endpoint methods
    const controllers = await db('symbols as method')
      .join('symbols as controller', 'method.file_id', 'controller.file_id')
      .whereIn('method.id', endpointMethodIds)
      .where('controller.entity_type', 'controller')
      .where('method.symbol_type', 'method')
      .distinct('controller.id')
      .select('controller.id');

    const controllerIds = controllers.map((c: { id: number }) => c.id);

    logger.debug('Found parent controllers for endpoints', {
      endpointMethods: endpointMethodIds.length,
      controllers: controllerIds.length,
    });

    return controllerIds;
  }

  /**
   * Find request classes used by endpoint methods.
   * Endpoint methods often have request parameters.
   * These requests should be discovered transitively via the API graph edge.
   */
  private async findEndpointRequests(endpointMethodIds: number[]): Promise<number[]> {
    if (endpointMethodIds.length === 0) return [];

    const db = this.dbService.knex;

    // Find request dependencies from endpoint methods
    const requests = await db('dependencies as d')
      .join('symbols as req', 'd.to_symbol_id', 'req.id')
      .whereIn('d.from_symbol_id', endpointMethodIds)
      .where('req.entity_type', 'request')
      .distinct('req.id')
      .select('req.id');

    const requestIds = requests.map((r: { id: number }) => r.id);

    logger.debug('Found requests from endpoint methods', {
      endpointMethods: endpointMethodIds.length,
      requests: requestIds.length,
    });

    return requestIds;
  }

  /**
   * Find service methods and classes called by controller methods.
   * When controller methods call service methods, we need to discover both:
   * 1. The service methods themselves
   * 2. The parent service classes containing those methods
   * This ensures complete backend discovery (controller → service → model chain).
   */
  private async findServiceDependencies(controllerMethodIds: number[]): Promise<number[]> {
    if (controllerMethodIds.length === 0) return [];

    const db = this.dbService.knex;

    // Find service methods called by controller methods
    const serviceMethods = await db('dependencies as d')
      .join('symbols as method', 'd.to_symbol_id', 'method.id')
      .join('files as f', 'method.file_id', 'f.id')
      .whereIn('d.from_symbol_id', controllerMethodIds)
      .where('d.dependency_type', 'calls')
      .where('method.symbol_type', 'method')
      .where('f.path', 'like', '%/Services/%')
      .distinct('method.id', 'method.file_id')
      .select('method.id', 'method.file_id');

    const serviceMethodIds = serviceMethods.map((m: { id: number }) => m.id);
    const serviceFileIds = [...new Set(serviceMethods.map((m: { file_id: number }) => m.file_id))];

    // Find parent service classes in the same files as the service methods
    const serviceClasses = await db('symbols')
      .whereIn('file_id', serviceFileIds)
      .where('entity_type', 'service')
      .where('symbol_type', 'class')
      .distinct('id')
      .select('id');

    const serviceClassIds = serviceClasses.map((s: { id: number }) => s.id);

    // Combine service methods + service classes
    const allServiceIds = [...serviceMethodIds, ...serviceClassIds];

    logger.debug('Found services from controller methods', {
      controllerMethods: controllerMethodIds.length,
      serviceMethods: serviceMethodIds.length,
      serviceClasses: serviceClassIds.length,
      totalServices: allServiceIds.length,
    });

    return allServiceIds;
  }

  /**
   * Find models imported/referenced by discovered backend symbols (endpoint methods + services).
   * This discovers model relationships between related entities.
   *
   * PRECISION: Only uses endpoint methods and services, NOT controller classes.
   * Controller classes import models for all their methods, causing over-discovery.
   */
  private async findRelatedModels(backendSymbolIds: number[]): Promise<number[]> {
    if (backendSymbolIds.length === 0) return [];

    const db = this.dbService.knex;

    // Find models that are imported/referenced by discovered backend symbols
    const relatedModels = await db('dependencies as d')
      .join('symbols as model', 'd.to_symbol_id', 'model.id')
      .whereIn('d.from_symbol_id', backendSymbolIds)
      .whereIn('d.dependency_type', ['imports', 'references'])
      .where('model.entity_type', 'model')
      .distinct('model.id')
      .select('model.id');

    const modelIds = relatedModels.map((m: { id: number }) => m.id);

    logger.debug('Found related models from backend symbols', {
      backendSymbols: backendSymbolIds.length,
      relatedModels: modelIds.length,
    });

    return modelIds;
  }

  /**
   * METHOD-LEVEL DISCOVERY: Expand ONLY store methods that are actually called.
   *
   * PRECISE FILTERING APPROACH:
   * 1. Filter stores to only those with "calls" dependencies from discovered symbols
   *    (excludes stores imported only for property access)
   * 2. Expand discovered symbols with their "contains" dependencies (inner functions)
   * 3. Find store methods that are CALLED by this expanded set AND make API calls
   *
   * This prevents discovering unrelated endpoints from the same store.
   */
  private async expandWithStoreMethods(
    frontendSymbolIds: number[]
  ): Promise<number[]> {
    if (frontendSymbolIds.length === 0) return [];

    const db = this.dbService.knex;

    // Find store/composable symbols from the discovered frontend symbols
    // FILTER: Only include stores that are CALLED (not just imported for property access)
    // This prevents discovering all auth endpoints when a component only uses usersStore.isDarkMode
    const storesAndComposables = await db('symbols as store')
      .join('dependencies as d', 'store.id', 'd.to_symbol_id')
      .whereIn('store.id', frontendSymbolIds)
      .whereIn('store.entity_type', ['store', 'composable'])
      .whereIn('d.from_symbol_id', frontendSymbolIds)
      .where('d.dependency_type', 'calls')  // Only stores that are actually called
      .distinct('store.id', 'store.file_id')
      .select('store.id', 'store.file_id');

    if (storesAndComposables.length === 0) {
      logger.debug('No called stores/composables in discovered symbols, skipping method expansion');
      return [];
    }

    const fileIds = storesAndComposables.map((s: { file_id: number }) => s.file_id);

    // STORE METHOD EXPANSION: Include ONLY store methods that are actually called
    // The challenge: Store method calls are often made from inner/contained functions
    // within composables, not directly from the composable itself.
    //
    // Solution: Expand discovered symbols to include their "contains" dependencies (inner functions),
    // then find store methods called by this expanded set.

    // Step 1: Expand discovered symbols with their contained functions
    const containedSymbols = await db('dependencies as d')
      .whereIn('d.from_symbol_id', frontendSymbolIds)
      .where('d.dependency_type', 'contains')
      .distinct('d.to_symbol_id')
      .pluck('d.to_symbol_id');

    const expandedCallers = [...frontendSymbolIds, ...containedSymbols];

    // Step 2: Find store methods that are CALLED by discovered symbols or their contained functions
    // AND make API calls (to ensure they're backend-connected)
    const methodsWithCallsAndApiCalls = await db('symbols as method')
      .join('api_calls as ac', 'method.id', 'ac.caller_symbol_id')
      .join('dependencies as d', 'method.id', 'd.to_symbol_id')
      .whereIn('method.file_id', fileIds)
      .whereIn('d.from_symbol_id', expandedCallers)  // Called from discovered symbols or their contained functions
      .where('d.dependency_type', 'calls')  // Actual call relationship
      .where('method.symbol_type', 'method')
      .distinct('method.id', 'method.name')
      .select('method.id', 'method.name');

    const methodIds = methodsWithCallsAndApiCalls.map((m: { id: number }) => m.id);

    logger.debug('METHOD-LEVEL store expansion (precise call tracking)', {
      calledStoresComposables: storesAndComposables.length,
      discoveredSymbols: frontendSymbolIds.length,
      containedFunctions: containedSymbols.length,
      expandedCallers: expandedCallers.length,
      actuallyCalledMethods: methodIds.length,
      approach: 'trace through contains → find actually called store methods with API calls',
    });

    return methodIds;
  }

  /**
   * Auto-detect backend languages from repository metadata.
   * Mirrors detectFrontendLanguages() but for backend technologies.
   */
  private async detectBackendLanguages(repoId: number): Promise<string[]> {
    const db = this.dbService.knex;

    // Get repository frameworks
    const repo = await db('repositories')
      .where('id', repoId)
      .select('framework_stack', 'language_primary')
      .first();

    if (!repo) {
      return [];
    }

    const frameworks: string[] = repo.framework_stack || [];
    const backendLanguages = new Set<string>();

    // Map frameworks to their backend languages
    const frameworkLanguageMap: Record<string, string[]> = {
      laravel: ['php'],
      symfony: ['php'],
      express: ['javascript', 'typescript'],
      nestjs: ['typescript'],
      fastapi: ['python'],
      django: ['python'],
      flask: ['python'],
      rails: ['ruby'],
      spring: ['java'],
      aspnet: ['csharp'],
    };

    // Add languages from detected frameworks
    for (const framework of frameworks) {
      const languages = frameworkLanguageMap[framework.toLowerCase()];
      if (languages) {
        languages.forEach(lang => backendLanguages.add(lang));
      }
    }

    // If no frameworks detected, check files table for language patterns
    if (backendLanguages.size === 0) {
      const languages: string[] = await db('files')
        .where('repo_id', repoId)
        .distinct('language')
        .pluck('language');

      // Classify languages as backend based on common patterns
      const commonBackendLanguages = ['php', 'python', 'java', 'csharp', 'ruby', 'go'];

      for (const lang of languages) {
        if (commonBackendLanguages.includes(lang)) {
          backendLanguages.add(lang);
        }
      }
    }

    const result = Array.from(backendLanguages);

    logger.debug('Auto-detected backend languages', {
      repoId,
      frameworks,
      languages: result,
    });

    return result;
  }

  /**
   * Reverse discovery: Find frontend symbols (stores/components) that call backend endpoints.
   *
   * When starting from backend controller methods, this discovers the frontend code that
   * uses those endpoints via API calls.
   */
  private async discoverFrontendCallers(
    backendSymbolIds: number[]
  ): Promise<Map<number, number>> {
    if (backendSymbolIds.length === 0) return new Map();

    const db = this.dbService.knex;
    const result = new Map<number, number>();

    // Find API calls TO these backend symbols
    const apiCalls = await db('api_calls')
      .whereIn('endpoint_symbol_id', backendSymbolIds)
      .select('caller_symbol_id', 'endpoint_symbol_id');

    const callerIds = apiCalls.map((ac: { caller_symbol_id: number }) => ac.caller_symbol_id);

    if (callerIds.length === 0) {
      logger.debug('No frontend callers found for backend symbols', {
        backendSymbols: backendSymbolIds.length,
      });
      return result;
    }

    // Get caller symbols (these are methods within stores/components)
    const callers = await db('symbols')
      .whereIn('id', callerIds)
      .select('id', 'file_id', 'symbol_type');

    // Find parent stores/components/composables in the same files
    const fileIds = [...new Set(callers.map((c: { file_id: number }) => c.file_id))];

    const parents = await db('symbols')
      .whereIn('file_id', fileIds)
      .whereIn('entity_type', ['store', 'component', 'composable'])
      .select('id', 'name', 'entity_type');

    // Add callers and their parents to result
    callerIds.forEach(id => result.set(id, BACKEND_SYMBOL_RELEVANCE));
    parents.forEach((p: { id: number }) => result.set(p.id, FRONTEND_PARENT_RELEVANCE));

    logger.info('Discovered frontend callers from backend endpoints', {
      backendSymbols: backendSymbolIds.length,
      callerMethods: callerIds.length,
      stores: parents.filter((p: { entity_type: string }) => p.entity_type === 'store').length,
      components: parents.filter((p: { entity_type: string }) => p.entity_type === 'component').length,
      composables: parents.filter((p: { entity_type: string }) => p.entity_type === 'composable').length,
      totalDiscovered: result.size,
    });

    return result;
  }

  /**
   * Reset internal caches to prevent memory leaks.
   */
  reset(): void {
    this.frontendLanguagesCache.clear();
  }
}
