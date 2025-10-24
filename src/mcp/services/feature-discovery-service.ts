import { DatabaseService } from '../../database/services';
import { validateDiscoverFeatureArgs } from '../validators';
import { createComponentLogger } from '../../utils/logger';
import { createStandardDiscoveryEngine } from './discovery-strategies';

const logger = createComponentLogger('feature-discovery-service');

interface FeatureSymbol {
  id: number;
  name: string;
  type: string;
  entity_type?: string;
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
  game_engine?: {
    nodes: FeatureSymbol[];
    ui_components: FeatureSymbol[];
    resources: FeatureSymbol[];
  };
  infrastructure?: {
    managers: FeatureSymbol[];
    handlers: FeatureSymbol[];
    coordinators: FeatureSymbol[];
    engines: FeatureSymbol[];
    pools: FeatureSymbol[];
  };
  data?: {
    repositories: FeatureSymbol[];
    factories: FeatureSymbol[];
    builders: FeatureSymbol[];
    validators: FeatureSymbol[];
    adapters: FeatureSymbol[];
  };
  middleware?: {
    middleware: FeatureSymbol[];
    notifications: FeatureSymbol[];
    commands: FeatureSymbol[];
    providers: FeatureSymbol[];
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
    total_nodes?: number;
    total_ui_components?: number;
    total_resources?: number;
    total_managers?: number;
    total_handlers?: number;
    total_coordinators?: number;
    total_engines?: number;
    total_pools?: number;
    total_repositories?: number;
    total_factories?: number;
    total_builders?: number;
    total_validators?: number;
    total_adapters?: number;
    total_middleware?: number;
    total_notifications?: number;
    total_commands?: number;
    total_providers?: number;
    total_related: number;
    total_routes: number;
    showing_sample: boolean;
    sample_size: number;
  };
}

export class FeatureDiscoveryService {
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
    // Default depth 5 ensures complete feature discovery regardless of entry point.
    // Well-architected features saturate early (depth 2-3), making extra traversal negligible.
    // Higher depth prevents missing components/callers when starting from middle-layer symbols.
    const maxDepth = validatedArgs.max_depth || 5;
    const maxSymbols = validatedArgs.max_symbols || 500;
    const minRelevanceScore = validatedArgs.min_relevance_score || 0;

    logger.info('Starting feature discovery (layer-based graph traversal)', {
      symbolId: validatedArgs.symbol_id,
      repoId,
      options: {
        includeComponents,
        includeRoutes,
        includeModels,
        maxDepth,
      },
    });

    const entrySymbol = await this.getSymbol(validatedArgs.symbol_id);
    if (!entrySymbol) {
      throw new Error(`Symbol with ID ${validatedArgs.symbol_id} not found`);
    }

    const featureName = this.extractFeatureName(entrySymbol.name);

    const engine = createStandardDiscoveryEngine(this.dbService, {
      maxIterations: 3,
      convergenceThreshold: 1,
      debug: false,
    });

    const { symbols: symbolRelevance, stats } = await engine.discover(
      validatedArgs.symbol_id,
      repoId,
      featureName,
      {
        maxDepth,
        includeComponents,
        includeRoutes,
        includeModels,
        includeTests,
        maxSymbols,
        minRelevanceScore,
      }
    );

    logger.info('Discovery engine complete', {
      totalSymbols: symbolRelevance.size,
      iterations: stats.iterations,
      converged: stats.converged,
      time: stats.totalTime,
    });

    // Filter by relevance and apply limits
    let filteredSymbolIds = Array.from(symbolRelevance.entries())
      .filter(([_, relevance]) => relevance >= minRelevanceScore)
      .sort((a, b) => b[1] - a[1])
      .map(([id, _]) => id);

    if (filteredSymbolIds.length > maxSymbols) {
      filteredSymbolIds = filteredSymbolIds.slice(0, maxSymbols);
    }

    // Fetch full symbol details
    let allSymbols = await this.fetchSymbols(filteredSymbolIds);

    // Filter tests if requested
    if (!includeTests) {
      allSymbols = allSymbols.filter(
        s => !this.isTestFile(s.file_path) && !this.isTestSymbol(s.name)
      );
    }

    // Fetch routes (graph-based discovery using discovered controller methods)
    // Semantic filtering applied at query boundary to filter CRUD methods
    const routes = includeRoutes ? await this.fetchRelatedRoutes(allSymbols, repoId, featureName) : [];

    // Build manifest
    const manifest = this.buildFeatureManifest(
      featureName,
      entrySymbol,
      allSymbols,
      routes,
      {
        includeComponents,
        includeRoutes,
        includeModels,
      },
      stats
    );

    logger.info('Feature discovery complete', {
      featureName,
      totalSymbols: manifest.total_symbols,
      strategyStats: Array.from(stats.strategyStats.entries()).map(([name, stat]) => ({
        strategy: name,
        discovered: stat.symbolsDiscovered,
      })),
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
    return (
      filePath.includes('/tests/') ||
      filePath.includes('/test/') ||
      filePath.includes('/__tests__/') ||
      filePath.includes('.test.') ||
      filePath.includes('.spec.')
    );
  }

  private isTestSymbol(symbolName: string): boolean {
    return (
      symbolName.startsWith('test_') ||
      symbolName.startsWith('test') ||
      symbolName.endsWith('Test') ||
      symbolName.endsWith('Spec') ||
      symbolName.includes('TestCase')
    );
  }

  private async getSymbol(symbolId: number): Promise<FeatureSymbol | null> {
    const symbol = await this.dbService.getSymbolWithFile(symbolId);
    if (!symbol) return null;

    return {
      id: symbol.id,
      name: symbol.name,
      type: symbol.symbol_type,
      entity_type: symbol.entity_type,
      file_path: symbol.file?.path || '',
      start_line: symbol.start_line,
      end_line: symbol.end_line,
      signature: symbol.signature,
      base_class: symbol.base_class,
    };
  }


  private async fetchSymbols(symbolIds: number[]): Promise<FeatureSymbol[]> {
    if (symbolIds.length === 0) return [];

    const symbols = await this.dbService
      .knex('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .whereIn('symbols.id', symbolIds)
      .select(
        'symbols.id',
        'symbols.name',
        'symbols.symbol_type as type',
        'symbols.entity_type',
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
          entity_type: s.entity_type,
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


  private async fetchRelatedRoutes(
    discoveredSymbols: FeatureSymbol[],
    repoId: number,
    featureName: string
  ): Promise<FeatureRoute[]> {
    const db = this.dbService.knex;

    // Extract controller method IDs from discovered symbols
    // Routes are connected to controller methods via handler_symbol_id
    const allMethodSymbols = discoveredSymbols.filter(s => s.entity_type === 'method');

    if (allMethodSymbols.length === 0) {
      logger.debug('No controller methods discovered, skipping route discovery');
      return [];
    }

    // SEMANTIC FILTERING: Only include methods semantically related to feature
    // This prevents CRUD noise (getVehicles, createVehicle) from appearing in camera alert feature
    const filteredMethods = allMethodSymbols.filter(method =>
      this.isSymbolSemanticMatch(method.name, featureName)
    );

    const controllerMethodIds = filteredMethods.map(s => s.id);

    if (controllerMethodIds.length === 0) {
      logger.debug('No feature-relevant controller methods after semantic filtering', {
        totalMethods: allMethodSymbols.length,
        featureName,
      });
      return [];
    }

    // Query routes by handler_symbol_id (graph-based discovery)
    // This discovers routes through proven dependency graph edges:
    // Frontend → API call → Controller method → Route (handler_symbol_id)
    const routes = await db('routes')
      .where('repo_id', repoId)
      .whereIn('handler_symbol_id', controllerMethodIds)
      .select(
        'method',
        'path',
        'controller_class',
        'controller_method',
        'action',
        'handler_symbol_id'
      );

    logger.debug('Graph-based route discovery with semantic filtering', {
      totalMethods: allMethodSymbols.length,
      filteredMethods: filteredMethods.length,
      filteredOut: allMethodSymbols.length - filteredMethods.length,
      routesFound: routes.length,
      featureName,
    });

    return routes.map(r => ({
      method: r.method,
      path: r.path,
      handler:
        r.controller_class && r.controller_method
          ? `${r.controller_class}@${r.controller_method}`
          : r.action || 'unknown',
      controller_symbol_id: r.handler_symbol_id,
    }));
  }

  private isStore(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'store';
  }

  private isComponent(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'component';
  }

  private isComposable(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'composable';
  }

  private isController(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'controller';
  }

  private isService(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'service';
  }

  private isRequest(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'request';
  }

  private isModel(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'model';
  }

  private isJob(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'job';
  }

  private isNode(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'node';
  }

  private isUiComponent(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'ui_component';
  }

  private isResource(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'resource';
  }

  private isManager(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'manager';
  }

  private isHandler(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'handler';
  }

  private isCoordinator(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'coordinator';
  }

  private isEngine(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'engine';
  }

  private isPool(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'pool';
  }

  private isRepository(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'repository';
  }

  private isFactory(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'factory';
  }

  private isBuilder(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'builder';
  }

  private isValidator(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'validator';
  }

  private isAdapter(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'adapter';
  }

  private isMiddleware(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'middleware';
  }

  private isNotification(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'notification';
  }

  private isCommand(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'command';
  }

  private isProvider(symbol: FeatureSymbol): boolean {
    return symbol.entity_type === 'provider';
  }

  /**
   * Check if a symbol name is semantically related to the feature name.
   * Uses token-based matching: extracts camelCase tokens from both names
   * and requires at least 50% of feature tokens to match.
   *
   * Examples:
   * - "StoreCameraAlertRequest" matches "VehicleCameraAlert" (2/3 tokens: camera, alert) ✅
   * - "CreateVehicleRequest" does NOT match "VehicleCameraAlert" (1/3 tokens: vehicle) ❌
   * - "getVehicleCameraAlerts" matches "VehicleCameraAlert" (3/3 tokens) ✅
   * - "getVehicles" does NOT match "VehicleCameraAlert" (1/3 tokens) ❌
   */
  private isSymbolSemanticMatch(symbolName: string, featureName: string): boolean {
    // Extract feature tokens (filter out short words like "get", "set")
    const featureTokens = featureName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 3);

    if (featureTokens.length === 0) return true; // No filtering if no tokens

    const symbolNameLower = symbolName.toLowerCase();
    const matchingTokens = featureTokens.filter(token => symbolNameLower.includes(token));

    // Require at least 50% of feature tokens to match (minimum 1)
    const minTokens = Math.max(1, Math.ceil(featureTokens.length * 0.5));
    return matchingTokens.length >= minTokens;
  }

  /**
   * Deduplicate symbols with the same name
   * Preference: entity_type match > shortest path (definition over usage)
   */
  private deduplicateByName<
    T extends {
      name: string;
      entity_type?: string;
      type: string;
      file_path: string;
    },
  >(symbols: T[]): T[] {
    const byName = new Map<string, T[]>();

    for (const symbol of symbols) {
      const existing = byName.get(symbol.name) || [];
      existing.push(symbol);
      byName.set(symbol.name, existing);
    }

    return Array.from(byName.values()).map(duplicates => {
      if (duplicates.length === 1) {
        return duplicates[0];
      }

      const withEntityType = duplicates.find(d => d.entity_type && d.entity_type !== d.type);
      if (withEntityType) {
        return withEntityType;
      }

      return duplicates.sort((a, b) => a.file_path.length - b.file_path.length)[0];
    });
  }

  private buildFeatureManifest(
    featureName: string,
    entryPoint: FeatureSymbol,
    allSymbols: FeatureSymbol[],
    routes: FeatureRoute[],
    options: { includeComponents: boolean; includeRoutes: boolean; includeModels: boolean },
    stats: { strategyStats: Map<string, any> }
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
      nodes: [] as FeatureSymbol[],
      ui_components: [] as FeatureSymbol[],
      resources: [] as FeatureSymbol[],
      managers: [] as FeatureSymbol[],
      handlers: [] as FeatureSymbol[],
      coordinators: [] as FeatureSymbol[],
      engines: [] as FeatureSymbol[],
      pools: [] as FeatureSymbol[],
      repositories: [] as FeatureSymbol[],
      factories: [] as FeatureSymbol[],
      builders: [] as FeatureSymbol[],
      validators: [] as FeatureSymbol[],
      adapters: [] as FeatureSymbol[],
      middleware: [] as FeatureSymbol[],
      notifications: [] as FeatureSymbol[],
      commands: [] as FeatureSymbol[],
      providers: [] as FeatureSymbol[],
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
        // SEMANTIC FILTERING: Only include requests semantically related to feature
        // This prevents CRUD requests (CreateVehicleRequest, UpdateVehicleRequest)
        // from appearing when feature is camera alerts
        if (this.isSymbolSemanticMatch(symbol.name, featureName)) {
          categorized.requests.push(symbol);
        }
      } else if (this.isModel(symbol)) {
        if (options.includeModels) categorized.models.push(symbol);
      } else if (this.isJob(symbol)) {
        categorized.jobs.push(symbol);
      } else if (this.isNode(symbol)) {
        categorized.nodes.push(symbol);
      } else if (this.isUiComponent(symbol)) {
        categorized.ui_components.push(symbol);
      } else if (this.isResource(symbol)) {
        categorized.resources.push(symbol);
      } else if (this.isManager(symbol)) {
        categorized.managers.push(symbol);
      } else if (this.isHandler(symbol)) {
        categorized.handlers.push(symbol);
      } else if (this.isCoordinator(symbol)) {
        categorized.coordinators.push(symbol);
      } else if (this.isEngine(symbol)) {
        categorized.engines.push(symbol);
      } else if (this.isPool(symbol)) {
        categorized.pools.push(symbol);
      } else if (this.isRepository(symbol)) {
        categorized.repositories.push(symbol);
      } else if (this.isFactory(symbol)) {
        categorized.factories.push(symbol);
      } else if (this.isBuilder(symbol)) {
        categorized.builders.push(symbol);
      } else if (this.isValidator(symbol)) {
        categorized.validators.push(symbol);
      } else if (this.isAdapter(symbol)) {
        categorized.adapters.push(symbol);
      } else if (this.isMiddleware(symbol)) {
        categorized.middleware.push(symbol);
      } else if (this.isNotification(symbol)) {
        categorized.notifications.push(symbol);
      } else if (this.isCommand(symbol)) {
        categorized.commands.push(symbol);
      } else if (this.isProvider(symbol)) {
        categorized.providers.push(symbol);
      } else {
        // SEMANTIC FILTERING: Only include methods semantically related to feature
        // Methods go to related_symbols, filter to exclude CRUD methods
        // (getVehicles, createVehicle, etc.) when feature is camera alerts
        if (symbol.entity_type === 'method') {
          if (this.isSymbolSemanticMatch(symbol.name, featureName)) {
            categorized.related.push(symbol);
          }
        } else {
          // Non-method symbols go through without filtering
          categorized.related.push(symbol);
        }
      }
    }

    categorized.components = this.deduplicateByName(categorized.components);

    const sampled = {
      stores: categorized.stores.slice(0, SAMPLE_SIZE),
      components: categorized.components.slice(0, SAMPLE_SIZE),
      composables: categorized.composables.slice(0, SAMPLE_SIZE),
      controllers: categorized.controllers.slice(0, SAMPLE_SIZE),
      services: categorized.services.slice(0, SAMPLE_SIZE),
      requests: categorized.requests.slice(0, SAMPLE_SIZE),
      models: categorized.models.slice(0, SAMPLE_SIZE),
      jobs: categorized.jobs.slice(0, SAMPLE_SIZE),
      nodes: categorized.nodes.slice(0, SAMPLE_SIZE),
      ui_components: categorized.ui_components.slice(0, SAMPLE_SIZE),
      resources: categorized.resources.slice(0, SAMPLE_SIZE),
      managers: categorized.managers.slice(0, SAMPLE_SIZE),
      handlers: categorized.handlers.slice(0, SAMPLE_SIZE),
      coordinators: categorized.coordinators.slice(0, SAMPLE_SIZE),
      engines: categorized.engines.slice(0, SAMPLE_SIZE),
      pools: categorized.pools.slice(0, SAMPLE_SIZE),
      repositories: categorized.repositories.slice(0, SAMPLE_SIZE),
      factories: categorized.factories.slice(0, SAMPLE_SIZE),
      builders: categorized.builders.slice(0, SAMPLE_SIZE),
      validators: categorized.validators.slice(0, SAMPLE_SIZE),
      adapters: categorized.adapters.slice(0, SAMPLE_SIZE),
      middleware: categorized.middleware.slice(0, SAMPLE_SIZE),
      notifications: categorized.notifications.slice(0, SAMPLE_SIZE),
      commands: categorized.commands.slice(0, SAMPLE_SIZE),
      providers: categorized.providers.slice(0, SAMPLE_SIZE),
      related: categorized.related.slice(0, SAMPLE_SIZE),
    };

    const hasFrontendSymbols =
      categorized.stores.length > 0 ||
      categorized.components.length > 0 ||
      categorized.composables.length > 0;
    const hasBackendSymbols =
      categorized.controllers.length > 0 ||
      categorized.services.length > 0 ||
      categorized.requests.length > 0 ||
      categorized.models.length > 0 ||
      categorized.jobs.length > 0;
    const hasGameEngineSymbols =
      categorized.nodes.length > 0 ||
      categorized.ui_components.length > 0 ||
      categorized.resources.length > 0;
    const hasInfrastructureSymbols =
      categorized.managers.length > 0 ||
      categorized.handlers.length > 0 ||
      categorized.coordinators.length > 0 ||
      categorized.engines.length > 0 ||
      categorized.pools.length > 0;
    const hasDataSymbols =
      categorized.repositories.length > 0 ||
      categorized.factories.length > 0 ||
      categorized.builders.length > 0 ||
      categorized.validators.length > 0 ||
      categorized.adapters.length > 0;
    const hasMiddlewareSymbols =
      categorized.middleware.length > 0 ||
      categorized.notifications.length > 0 ||
      categorized.commands.length > 0 ||
      categorized.providers.length > 0;

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
      ...(hasGameEngineSymbols && {
        game_engine: {
          nodes: sampled.nodes,
          ui_components: sampled.ui_components,
          resources: sampled.resources,
        },
      }),
      ...(hasInfrastructureSymbols && {
        infrastructure: {
          managers: sampled.managers,
          handlers: sampled.handlers,
          coordinators: sampled.coordinators,
          engines: sampled.engines,
          pools: sampled.pools,
        },
      }),
      ...(hasDataSymbols && {
        data: {
          repositories: sampled.repositories,
          factories: sampled.factories,
          builders: sampled.builders,
          validators: sampled.validators,
          adapters: sampled.adapters,
        },
      }),
      ...(hasMiddlewareSymbols && {
        middleware: {
          middleware: sampled.middleware,
          notifications: sampled.notifications,
          commands: sampled.commands,
          providers: sampled.providers,
        },
      }),
      related_symbols: sampled.related,
      total_symbols: allSymbols.length,
      discovery_strategy: Array.from(stats.strategyStats.keys()).join(' + '),
      summary: {
        ...(hasFrontendSymbols && {
          total_stores: categorized.stores.length,
          total_components: categorized.components.length,
          total_composables: categorized.composables.length,
        }),
        ...(hasBackendSymbols && {
          total_controllers: categorized.controllers.length,
          total_services: categorized.services.length,
          total_requests: categorized.requests.length,
          total_models: categorized.models.length,
          total_jobs: categorized.jobs.length,
        }),
        ...(hasGameEngineSymbols && {
          total_nodes: categorized.nodes.length,
          total_ui_components: categorized.ui_components.length,
          total_resources: categorized.resources.length,
        }),
        ...(hasInfrastructureSymbols && {
          total_managers: categorized.managers.length,
          total_handlers: categorized.handlers.length,
          total_coordinators: categorized.coordinators.length,
          total_engines: categorized.engines.length,
          total_pools: categorized.pools.length,
        }),
        ...(hasDataSymbols && {
          total_repositories: categorized.repositories.length,
          total_factories: categorized.factories.length,
          total_builders: categorized.builders.length,
          total_validators: categorized.validators.length,
          total_adapters: categorized.adapters.length,
        }),
        ...(hasMiddlewareSymbols && {
          total_middleware: categorized.middleware.length,
          total_notifications: categorized.notifications.length,
          total_commands: categorized.commands.length,
          total_providers: categorized.providers.length,
        }),
        total_related: categorized.related.length,
        ...(routes.length > 0 && {
          total_routes: routes.length,
        }),
        showing_sample: true,
        sample_size: SAMPLE_SIZE,
      },
    };
  }
}
