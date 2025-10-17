import { DatabaseService } from '../../database/services';
import { SymbolType } from '../../database/models';
import { DiscoverFeatureArgs } from '../types';
import { validateDiscoverFeatureArgs } from '../validators';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('feature-discovery-service');

interface FeatureSymbol {
  id: number;
  name: string;
  type: string;
  file_path: string;
  start_line: number;
  end_line: number;
  signature?: string;
  base_class?: string;
}

interface FeatureRoute {
  method: string;
  path: string;
  handler: string;
  controller_symbol_id?: number;
}

interface FeatureManifest {
  feature_name: string;
  entry_point: FeatureSymbol;
  frontend: {
    stores: FeatureSymbol[];
    components: FeatureSymbol[];
    composables: FeatureSymbol[];
  };
  api: {
    routes: FeatureRoute[];
  };
  backend: {
    controllers: FeatureSymbol[];
    services: FeatureSymbol[];
    requests: FeatureSymbol[];
    models: FeatureSymbol[];
    jobs: FeatureSymbol[];
  };
  related_symbols: FeatureSymbol[];
  total_symbols: number;
  discovery_strategy: string;
  summary: {
    total_stores: number;
    total_components: number;
    total_composables: number;
    total_controllers: number;
    total_services: number;
    total_requests: number;
    total_models: number;
    total_jobs: number;
    total_related: number;
    total_routes: number;
    showing_sample: boolean;
    sample_size: number;
  };
}

export class FeatureDiscoveryService {
  private static readonly MAX_QUEUE_SIZE = 10000;
  private static readonly MAX_VISITED_NODES = 50000;

  constructor(
    private dbService: DatabaseService,
    private getDefaultRepoId: () => number | undefined
  ) {}

  async discoverFeature(args: any) {
    const validatedArgs = validateDiscoverFeatureArgs(args);
    const repoId = this.getDefaultRepoId();

    if (!repoId) {
      throw new Error('repo_id is required when no default repository is set');
    }

    const includeComponents = validatedArgs.include_components !== false;
    const includeRoutes = validatedArgs.include_routes !== false;
    const includeModels = validatedArgs.include_models !== false;
    const includeTests = validatedArgs.include_tests || false;
    const includeCallers = validatedArgs.include_callers !== false;
    const namingDepth = validatedArgs.naming_depth || 2;
    const maxDepth = validatedArgs.max_depth || 3;
    const maxSymbols = validatedArgs.max_symbols || 500;
    const minRelevanceScore = validatedArgs.min_relevance_score || 0;

    logger.info('Starting feature discovery', {
      symbolId: validatedArgs.symbol_id,
      repoId,
      options: { includeComponents, includeRoutes, includeModels, namingDepth, maxDepth }
    });

    const entrySymbol = await this.getSymbol(validatedArgs.symbol_id);
    if (!entrySymbol) {
      throw new Error(`Symbol with ID ${validatedArgs.symbol_id} not found`);
    }

    const featureName = this.extractFeatureName(entrySymbol.name);
    const symbolRelevance = new Map<number, number>([[validatedArgs.symbol_id, 1.0]]);

    const relatedByDependency = await this.findDependencyRelated(
      validatedArgs.symbol_id,
      repoId,
      maxDepth
    );
    relatedByDependency.forEach((depth, id) => {
      symbolRelevance.set(id, 1.0 - (depth / (maxDepth + 1)));
    });

    const relatedByNaming = await this.findNamingRelated(
      featureName,
      repoId,
      namingDepth
    );
    relatedByNaming.forEach(id => {
      if (!symbolRelevance.has(id)) {
        symbolRelevance.set(id, 0.7);
      }
    });

    const relatedByCrossStack = await this.findCrossStackRelated(
      Array.from(symbolRelevance.keys()),
      repoId
    );
    relatedByCrossStack.forEach(id => {
      if (!symbolRelevance.has(id)) {
        symbolRelevance.set(id, 0.8);
      }
    });

    if (includeCallers) {
      const relatedByReverseDeps = await this.findReverseCallers(
        Array.from(symbolRelevance.keys()),
        repoId,
        featureName,
        maxDepth
      );
      relatedByReverseDeps.forEach((depth, id) => {
        if (!symbolRelevance.has(id)) {
          symbolRelevance.set(id, 0.75 - (depth * 0.1));
        }
      });
    }

    let filteredSymbolIds = Array.from(symbolRelevance.entries())
      .filter(([_, relevance]) => relevance >= minRelevanceScore)
      .sort((a, b) => b[1] - a[1])
      .map(([id, _]) => id);

    if (filteredSymbolIds.length > maxSymbols) {
      filteredSymbolIds = filteredSymbolIds.slice(0, maxSymbols);
    }

    let allSymbols = await this.fetchSymbols(filteredSymbolIds);

    if (!includeTests) {
      allSymbols = allSymbols.filter(s => !this.isTestFile(s.file_path) && !this.isTestSymbol(s.name));
    }

    const routes = includeRoutes ? await this.fetchRelatedRoutes(featureName, repoId) : [];

    const manifest = this.buildFeatureManifest(
      featureName,
      entrySymbol,
      allSymbols,
      routes,
      { includeComponents, includeRoutes, includeModels }
    );

    logger.info('Feature discovery complete', {
      featureName,
      totalSymbols: manifest.total_symbols,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(manifest, null, 2),
        },
      ],
    };
  }

  private extractFeatureName(symbolName: string): string {
    const cleaned = symbolName
      .replace(/^(create|update|delete|get|fetch|save|handle|process)/i, '')
      .replace(/(Controller|Service|Store|Request|Model|Job|Component|Composable)$/i, '')
      .trim();

    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  private isTestFile(filePath: string): boolean {
    return filePath.includes('/tests/') ||
           filePath.includes('/test/') ||
           filePath.includes('/__tests__/') ||
           filePath.includes('.test.') ||
           filePath.includes('.spec.');
  }

  private isTestSymbol(symbolName: string): boolean {
    return symbolName.startsWith('test_') ||
           symbolName.startsWith('test') ||
           symbolName.endsWith('Test') ||
           symbolName.endsWith('Spec') ||
           symbolName.includes('TestCase');
  }

  private async getSymbol(symbolId: number): Promise<FeatureSymbol | null> {
    const symbol = await this.dbService.getSymbolWithFile(symbolId);
    if (!symbol) return null;

    return {
      id: symbol.id,
      name: symbol.name,
      type: symbol.symbol_type,
      file_path: symbol.file?.path || '',
      start_line: symbol.start_line,
      end_line: symbol.end_line,
      signature: symbol.signature,
      base_class: symbol.base_class,
    };
  }

  private async findDependencyRelated(
    symbolId: number,
    repoId: number,
    maxDepth: number
  ): Promise<Map<number, number>> {
    const related = new Map<number, number>();
    const queue = [{ id: symbolId, depth: 0 }];
    const visited = new Set<number>([symbolId]);

    while (queue.length > 0) {
      if (visited.size > FeatureDiscoveryService.MAX_VISITED_NODES) {
        logger.warn('Hit max visited nodes limit, terminating traversal early', {
          visitedCount: visited.size,
          maxNodes: FeatureDiscoveryService.MAX_VISITED_NODES,
        });
        break;
      }

      if (queue.length > FeatureDiscoveryService.MAX_QUEUE_SIZE) {
        logger.warn('Queue size exceeded limit, pruning least relevant nodes', {
          queueSize: queue.length,
          maxQueueSize: FeatureDiscoveryService.MAX_QUEUE_SIZE,
        });
        queue.sort((a, b) => a.depth - b.depth);
        queue.splice(FeatureDiscoveryService.MAX_QUEUE_SIZE);
      }

      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const dependencies = await this.dbService.getDependenciesFrom(id);
      const callers = await this.dbService.getDependenciesTo(id);

      for (const dep of dependencies) {
        const targetId = dep.to_symbol_id;
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          related.set(targetId, depth + 1);
          queue.push({ id: targetId, depth: depth + 1 });
        }
      }

      for (const dep of callers) {
        const targetId = dep.from_symbol_id;
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          related.set(targetId, depth + 1);
          queue.push({ id: targetId, depth: depth + 1 });
        }
      }
    }

    return related;
  }

  private async findNamingRelated(
    featureName: string,
    repoId: number,
    depth: number
  ): Promise<number[]> {
    const patterns = this.generateNamingPatterns(featureName, depth);
    const related = new Set<number>();

    for (const pattern of patterns) {
      const symbols = await this.dbService.searchSymbols(pattern, repoId, {
        limit: 100,
        symbolTypes: [],
      });
      symbols.forEach(s => related.add(s.id));
    }

    return Array.from(related);
  }

  private generateNamingPatterns(featureName: string, depth: number): string[] {
    const patterns = [featureName];

    if (depth >= 1) {
      patterns.push(
        `${featureName}Controller`,
        `${featureName}Service`,
        `${featureName}Store`,
        `${featureName}Request`,
        `${featureName}Model`,
        `${featureName}Job`,
        `create${featureName}`,
        `update${featureName}`,
        `delete${featureName}`,
        `get${featureName}`,
      );
    }

    if (depth >= 2) {
      patterns.push(
        `${featureName}Component`,
        `${featureName}Composable`,
        `use${featureName}`,
        `${featureName}Form`,
        `${featureName}List`,
        `${featureName}Details`,
      );
    }

    return patterns;
  }

  private async findCrossStackRelated(
    symbolIds: number[],
    repoId: number
  ): Promise<number[]> {
    const db = this.dbService.knex;

    const frontendSymbols = await db('symbols')
      .whereIn('symbols.id', symbolIds)
      .join('files', 'symbols.file_id', 'files.id')
      .whereIn('files.language', ['typescript', 'vue', 'javascript'])
      .select('symbols.id');

    const frontendIds = frontendSymbols.map(s => s.id);
    if (frontendIds.length === 0) return [];

    const apiCalls = await db('api_calls')
      .whereIn('caller_symbol_id', frontendIds)
      .select('endpoint_symbol_id');

    return apiCalls.map(ac => ac.endpoint_symbol_id).filter(Boolean);
  }

  private async fetchSymbols(symbolIds: number[]): Promise<FeatureSymbol[]> {
    if (symbolIds.length === 0) return [];

    const symbols = await this.dbService.knex('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .whereIn('symbols.id', symbolIds)
      .select(
        'symbols.id',
        'symbols.name',
        'symbols.symbol_type as type',
        'files.path as file_path',
        'symbols.start_line',
        'symbols.end_line',
        'symbols.signature',
        'symbols.base_class'
      );

    const symbolMap = new Map(
      symbols.map(s => [
        s.id,
        {
          id: s.id,
          name: s.name,
          type: s.type,
          file_path: s.file_path,
          start_line: s.start_line,
          end_line: s.end_line,
          signature: s.signature,
          base_class: s.base_class,
        },
      ])
    );

    return symbolIds
      .map(id => symbolMap.get(id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
  }

  private async findReverseCallers(
    symbolIds: number[],
    repoId: number,
    featureName: string,
    maxDepth: number
  ): Promise<Map<number, number>> {
    const callers = new Map<number, number>();
    const queue = symbolIds.map(id => ({ id, depth: 0 }));
    const visited = new Set<number>(symbolIds);

    while (queue.length > 0) {
      if (visited.size > FeatureDiscoveryService.MAX_VISITED_NODES) {
        logger.warn('Hit max visited nodes limit in reverse caller search, terminating early', {
          visitedCount: visited.size,
          maxNodes: FeatureDiscoveryService.MAX_VISITED_NODES,
        });
        break;
      }

      if (queue.length > FeatureDiscoveryService.MAX_QUEUE_SIZE) {
        logger.warn('Queue size exceeded limit in reverse caller search, pruning least relevant nodes', {
          queueSize: queue.length,
          maxQueueSize: FeatureDiscoveryService.MAX_QUEUE_SIZE,
        });
        queue.sort((a, b) => a.depth - b.depth);
        queue.splice(FeatureDiscoveryService.MAX_QUEUE_SIZE);
      }

      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const symbol = await this.getSymbol(id);
      if (symbol && this.shouldSkipReverseDeps(symbol, featureName)) {
        continue;
      }

      const dependencies = await this.dbService.getDependenciesTo(id);

      for (const dep of dependencies) {
        const callerId = dep.from_symbol_id;
        if (callerId && !visited.has(callerId)) {
          visited.add(callerId);
          callers.set(callerId, depth + 1);
          queue.push({ id: callerId, depth: depth + 1 });
        }
      }
    }

    return callers;
  }

  private shouldSkipReverseDeps(symbol: FeatureSymbol, featureName: string): boolean {
    const frameworkSymbols = [
      'Vue', 'computed', 'ref', 'reactive', 'watch', 'onMounted', 'onUnmounted',
      'Illuminate', 'Model', 'Controller', 'Request', 'Response', 'Route',
      'Pinia', 'defineStore', 'storeToRefs',
      'axios', 'fetch', 'http', 'get', 'post', 'put', 'delete'
    ];

    if (frameworkSymbols.some(fw => symbol.name === fw || symbol.name.startsWith(fw + '.'))) {
      return true;
    }

    if (symbol.file_path.includes('node_modules') || symbol.file_path.includes('vendor')) {
      return true;
    }

    const utilityPatterns = [
      /^(format|parse|validate|sanitize|normalize)/i,
      /^(log|debug|info|warn|error)/i,
      /^(is|has|can|should)/i,
      /^(get|set)(Item|Value|Property|Attribute)/i,
    ];

    const isUtility = utilityPatterns.some(pattern => pattern.test(symbol.name));
    if (isUtility && !symbol.name.toLowerCase().includes(featureName.toLowerCase())) {
      return true;
    }

    return false;
  }

  private async fetchRelatedRoutes(
    featureName: string,
    repoId: number
  ): Promise<FeatureRoute[]> {
    const db = this.dbService.knex;

    const routes = await db('routes')
      .where('repo_id', repoId)
      .andWhere(function() {
        this.where('path', 'like', `%${featureName.toLowerCase()}%`)
          .orWhere('controller_class', 'like', `%${featureName}%`)
          .orWhere('controller_method', 'like', `%${featureName}%`)
          .orWhere('action', 'like', `%${featureName}%`);
      })
      .select('method', 'path', 'controller_class', 'controller_method', 'action', 'handler_symbol_id');

    return routes.map(r => ({
      method: r.method,
      path: r.path,
      handler: r.controller_class && r.controller_method
        ? `${r.controller_class}@${r.controller_method}`
        : r.action || 'unknown',
      controller_symbol_id: r.handler_symbol_id,
    }));
  }

  private isStore(symbol: FeatureSymbol): boolean {
    return (
      (symbol.name.endsWith('Store') || symbol.name.toLowerCase().includes('store')) &&
      (symbol.type === SymbolType.CLASS || symbol.type === SymbolType.VARIABLE || symbol.type === SymbolType.FUNCTION) &&
      (symbol.file_path.endsWith('.ts') || symbol.file_path.endsWith('.js'))
    );
  }

  private isComponent(symbol: FeatureSymbol): boolean {
    return symbol.type === SymbolType.COMPONENT;
  }

  private isComposable(symbol: FeatureSymbol): boolean {
    return (
      (symbol.name.startsWith('use') && symbol.type === SymbolType.FUNCTION) ||
      (symbol.name.startsWith('create') && symbol.name.includes('composable'))
    );
  }

  private isController(symbol: FeatureSymbol): boolean {
    return (
      symbol.name.endsWith('Controller') &&
      symbol.type === SymbolType.CLASS
    );
  }

  private isService(symbol: FeatureSymbol): boolean {
    return (
      symbol.name.endsWith('Service') &&
      symbol.type === SymbolType.CLASS
    );
  }

  private isRequest(symbol: FeatureSymbol): boolean {
    return (
      symbol.name.endsWith('Request') &&
      symbol.type === SymbolType.CLASS &&
      symbol.file_path.endsWith('.php')
    );
  }

  private isModel(symbol: FeatureSymbol): boolean {
    const hasModelSignature =
      symbol.signature?.includes('extends Model') ||
      symbol.signature?.includes('extends Authenticatable') ||
      symbol.signature?.includes('extends Pivot');

    const hasModelBaseClass =
      symbol.base_class === 'Model' ||
      symbol.base_class === 'Authenticatable' ||
      symbol.base_class === 'Pivot';

    return (
      symbol.type === SymbolType.CLASS &&
      symbol.file_path.endsWith('.php') &&
      !symbol.name.endsWith('Controller') &&
      !symbol.name.endsWith('Service') &&
      !symbol.name.endsWith('Request') &&
      !symbol.name.endsWith('Job') &&
      (hasModelSignature || hasModelBaseClass)
    );
  }

  private isJob(symbol: FeatureSymbol): boolean {
    return (
      symbol.name.endsWith('Job') &&
      symbol.type === SymbolType.CLASS
    );
  }

  private buildFeatureManifest(
    featureName: string,
    entryPoint: FeatureSymbol,
    allSymbols: FeatureSymbol[],
    routes: FeatureRoute[],
    options: { includeComponents: boolean; includeRoutes: boolean; includeModels: boolean }
  ): FeatureManifest {
    /**
     * Maximum number of symbols to return per category in the feature manifest.
     * Increased from 5 to 50 to provide more comprehensive feature discovery results
     * while still preventing overwhelming responses for large features.
     *
     * Rationale:
     * - 5 was too limiting for real-world features (most features have >5 related files)
     * - 50 provides good balance: comprehensive enough for most features, but capped for performance
     * - Full counts still available in summary.total_* fields
     * - Can be made configurable via parameters in future if needed
     */
    const SAMPLE_SIZE = 50;

    const categorized = {
      stores: [] as FeatureSymbol[],
      components: [] as FeatureSymbol[],
      composables: [] as FeatureSymbol[],
      controllers: [] as FeatureSymbol[],
      services: [] as FeatureSymbol[],
      requests: [] as FeatureSymbol[],
      models: [] as FeatureSymbol[],
      jobs: [] as FeatureSymbol[],
      related: [] as FeatureSymbol[],
    };

    for (const symbol of allSymbols) {
      if (this.isStore(symbol)) {
        categorized.stores.push(symbol);
      } else if (this.isComponent(symbol)) {
        if (options.includeComponents) categorized.components.push(symbol);
      } else if (this.isComposable(symbol)) {
        categorized.composables.push(symbol);
      } else if (this.isController(symbol)) {
        categorized.controllers.push(symbol);
      } else if (this.isService(symbol)) {
        categorized.services.push(symbol);
      } else if (this.isRequest(symbol)) {
        categorized.requests.push(symbol);
      } else if (this.isModel(symbol)) {
        if (options.includeModels) categorized.models.push(symbol);
      } else if (this.isJob(symbol)) {
        categorized.jobs.push(symbol);
      } else {
        categorized.related.push(symbol);
      }
    }

    const sampled = {
      stores: categorized.stores.slice(0, SAMPLE_SIZE),
      components: categorized.components.slice(0, SAMPLE_SIZE),
      composables: categorized.composables.slice(0, SAMPLE_SIZE),
      controllers: categorized.controllers.slice(0, SAMPLE_SIZE),
      services: categorized.services.slice(0, SAMPLE_SIZE),
      requests: categorized.requests.slice(0, SAMPLE_SIZE),
      models: categorized.models.slice(0, SAMPLE_SIZE),
      jobs: categorized.jobs.slice(0, SAMPLE_SIZE),
      related: categorized.related.slice(0, SAMPLE_SIZE),
    };

    return {
      feature_name: featureName,
      entry_point: entryPoint,
      frontend: {
        stores: sampled.stores,
        components: sampled.components,
        composables: sampled.composables,
      },
      api: {
        routes: options.includeRoutes ? routes.slice(0, SAMPLE_SIZE) : [],
      },
      backend: {
        controllers: sampled.controllers,
        services: sampled.services,
        requests: sampled.requests,
        models: sampled.models,
        jobs: sampled.jobs,
      },
      related_symbols: sampled.related,
      total_symbols: allSymbols.length,
      discovery_strategy: 'dependency_graph + naming_heuristics + cross_stack_api_tracing + reverse_callers',
      summary: {
        total_stores: categorized.stores.length,
        total_components: categorized.components.length,
        total_composables: categorized.composables.length,
        total_controllers: categorized.controllers.length,
        total_services: categorized.services.length,
        total_requests: categorized.requests.length,
        total_models: categorized.models.length,
        total_jobs: categorized.jobs.length,
        total_related: categorized.related.length,
        total_routes: routes.length,
        showing_sample: true,
        sample_size: SAMPLE_SIZE,
      },
    };
  }
}
