/**
 * Cross-Stack Strategy
 *
 * Discovers backend endpoints that are called by frontend code,
 * bridging the Vue/React → Laravel/Express API boundary.
 *
 * Uses the api_calls table which tracks API endpoint relationships
 * extracted during parsing (e.g., axios.get('/api/vehicles/camera-alerts')).
 */

import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';

const logger = createComponentLogger('cross-stack-strategy');

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
        const result = await this.discoverFrontendCallers(backendIds, context.featureName, repoId);
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

    // Expand to include store/composable methods (they make the actual API calls)
    // Similar to controller method expansion - stores are discovered but their methods aren't
    // IMPORTANT: Only expand methods semantically related to feature to avoid false positives
    const expandedIds = await this.expandWithStoreMethods(frontendIds, context.featureName);
    frontendIds = Array.from(new Set([...frontendIds, ...expandedIds]));

    logger.debug('Expanded frontend symbols with store methods', {
      original: frontendSymbols.length,
      withMethods: frontendIds.length,
      featureName: context.featureName,
    });

    // Find backend endpoints these frontend symbols call
    const apiCalls = await db('api_calls')
      .whereIn('caller_symbol_id', frontendIds)
      .select('endpoint_symbol_id');

    const backendEndpointIds = apiCalls
      .map((ac: { endpoint_symbol_id: number | null }) => ac.endpoint_symbol_id)
      .filter((id): id is number => id !== null);

    // Find parent controller classes and request classes in parallel
    // This ensures transitive backend discovery (method → controller class + requests)
    // Parallelization saves ~200ms per 20 endpoints
    const [controllerIds, requestIds] = await Promise.all([
      this.findParentControllers(backendEndpointIds),
      this.findEndpointRequests(backendEndpointIds),
    ]);

    // Convert to relevance map (methods, controllers, and requests)
    const result = new Map<number, number>();
    backendEndpointIds.forEach(id => result.set(id, 0.8));
    controllerIds.forEach(id => result.set(id, 0.8));
    requestIds.forEach(id => result.set(id, 0.8));

    logger.info('Cross-stack discovery complete', {
      frontendSymbols: frontendIds.length,
      frontendSymbolIds: frontendIds,
      backendEndpoints: backendEndpointIds.length,
      backendEndpointIds: backendEndpointIds,
      controllerClasses: controllerIds.length,
      controllerIds: controllerIds,
      requestClasses: requestIds.length,
      requestIds: requestIds,
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
   * Expand frontend symbols to include methods from stores and composables.
   * Stores/composables are discovered as symbols, but their methods that make API calls aren't.
   * This is similar to how we expand controller methods in dependency-traversal.
   *
   * IMPORTANT: Only includes methods semantically related to the feature to prevent
   * discovering unrelated API calls.
   */
  private async expandWithStoreMethods(
    frontendSymbolIds: number[],
    featureName: string
  ): Promise<number[]> {
    if (frontendSymbolIds.length === 0) return [];

    const db = this.dbService.knex;

    // Get all methods from files containing discovered stores/composables
    const methods = await db('symbols as method')
      .join('symbols as parent', 'method.file_id', 'parent.file_id')
      .whereIn('parent.id', frontendSymbolIds)
      .whereIn('parent.entity_type', ['store', 'composable'])
      .where('method.symbol_type', 'method')
      .distinct('method.id', 'method.name')
      .select('method.id', 'method.name');

    // Filter methods by semantic relevance to feature name
    // Extract feature tokens
    const featureTokens = featureName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 3); // Ignore short tokens like "get", "set"

    const relevantMethods = methods.filter((m: { id: number; name: string }) => {
      const methodName = m.name.toLowerCase();

      // Method name contains at least one feature token
      return featureTokens.some(token => methodName.includes(token));
    });

    const methodIds = relevantMethods.map((m: { id: number }) => m.id);

    logger.debug('Expanded store/composable methods for API call detection', {
      storesComposables: frontendSymbolIds.length,
      totalMethods: methods.length,
      relevantMethods: methodIds.length,
      featureName,
      featureTokens,
      filteredOut: methods.length - methodIds.length,
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
    backendSymbolIds: number[],
    featureName: string,
    repoId: number
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
    callerIds.forEach(id => result.set(id, 0.8));
    parents.forEach((p: { id: number }) => result.set(p.id, 0.9)); // Higher relevance for parent symbols

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
