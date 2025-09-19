import { DatabaseService } from '../database/services';
import { DependencyType, DependencyWithSymbols, SymbolWithFile } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import { transitiveAnalyzer, TransitiveAnalysisOptions } from '../graph/transitive-analyzer';

const logger = createComponentLogger('mcp-tools');

// Input validation helpers
function validateGetFileArgs(args: any): GetFileArgs {
  if (!args.file_id && !args.file_path) {
    throw new Error('Either file_id or file_path must be provided');
  }
  if (args.file_id && typeof args.file_id !== 'number') {
    throw new Error('file_id must be a number');
  }
  if (args.file_path && typeof args.file_path !== 'string') {
    throw new Error('file_path must be a string');
  }
  if (args.include_symbols !== undefined && typeof args.include_symbols !== 'boolean') {
    throw new Error('include_symbols must be a boolean');
  }
  return args as GetFileArgs;
}

function validateGetSymbolArgs(args: any): GetSymbolArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.include_dependencies !== undefined && typeof args.include_dependencies !== 'boolean') {
    throw new Error('include_dependencies must be a boolean');
  }
  if (args.include_callers !== undefined && typeof args.include_callers !== 'boolean') {
    throw new Error('include_callers must be a boolean');
  }
  return args as GetSymbolArgs;
}

function validateSearchCodeArgs(args: any): SearchCodeArgs {
  if (!args.query || typeof args.query !== 'string') {
    throw new Error('query is required and must be a string');
  }
  if (args.repo_id !== undefined && typeof args.repo_id !== 'number') {
    throw new Error('repo_id must be a number');
  }
  if (args.symbol_type !== undefined && typeof args.symbol_type !== 'string') {
    throw new Error('symbol_type must be a string');
  }
  if (args.is_exported !== undefined && typeof args.is_exported !== 'boolean') {
    throw new Error('is_exported must be a boolean');
  }
  if (args.limit !== undefined) {
    const limit = Number(args.limit);
    if (isNaN(limit) || limit < 1 || limit > 200) {
      throw new Error('limit must be a number between 1 and 200');
    }
    args.limit = limit;
  }
  return args as SearchCodeArgs;
}

function validateWhoCallsArgs(args: any): WhoCallsArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.dependency_type !== undefined && typeof args.dependency_type !== 'string') {
    throw new Error('dependency_type must be a string');
  }
  if (args.include_indirect !== undefined && typeof args.include_indirect !== 'boolean') {
    throw new Error('include_indirect must be a boolean');
  }
  return args as WhoCallsArgs;
}

function validateListDependenciesArgs(args: any): ListDependenciesArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.dependency_type !== undefined && typeof args.dependency_type !== 'string') {
    throw new Error('dependency_type must be a string');
  }
  if (args.include_indirect !== undefined && typeof args.include_indirect !== 'boolean') {
    throw new Error('include_indirect must be a boolean');
  }
  return args as ListDependenciesArgs;
}

// Laravel-specific tool validation functions
function validateGetLaravelRoutesArgs(args: any): GetLaravelRoutesArgs {
  if (args.repo_id !== undefined && typeof args.repo_id !== 'number') {
    throw new Error('repo_id must be a number');
  }
  if (args.path !== undefined && typeof args.path !== 'string') {
    throw new Error('path must be a string');
  }
  if (args.method !== undefined && typeof args.method !== 'string') {
    throw new Error('method must be a string');
  }
  if (args.middleware !== undefined && typeof args.middleware !== 'string') {
    throw new Error('middleware must be a string');
  }
  if (args.controller !== undefined && typeof args.controller !== 'string') {
    throw new Error('controller must be a string');
  }
  return args as GetLaravelRoutesArgs;
}

function validateGetEloquentModelsArgs(args: any): GetEloquentModelsArgs {
  if (args.repo_id !== undefined && typeof args.repo_id !== 'number') {
    throw new Error('repo_id must be a number');
  }
  if (args.model_name !== undefined && typeof args.model_name !== 'string') {
    throw new Error('model_name must be a string');
  }
  if (args.table_name !== undefined && typeof args.table_name !== 'string') {
    throw new Error('table_name must be a string');
  }
  if (args.relationships !== undefined && !Array.isArray(args.relationships)) {
    throw new Error('relationships must be an array');
  }
  return args as GetEloquentModelsArgs;
}

function validateGetLaravelControllersArgs(args: any): GetLaravelControllersArgs {
  if (args.repo_id !== undefined && typeof args.repo_id !== 'number') {
    throw new Error('repo_id must be a number');
  }
  if (args.controller_name !== undefined && typeof args.controller_name !== 'string') {
    throw new Error('controller_name must be a string');
  }
  if (args.action !== undefined && typeof args.action !== 'string') {
    throw new Error('action must be a string');
  }
  if (args.middleware !== undefined && typeof args.middleware !== 'string') {
    throw new Error('middleware must be a string');
  }
  return args as GetLaravelControllersArgs;
}

function validateSearchLaravelEntitiesArgs(args: any): SearchLaravelEntitiesArgs {
  if (!args.query || typeof args.query !== 'string') {
    throw new Error('query is required and must be a string');
  }
  if (args.repo_id !== undefined && typeof args.repo_id !== 'number') {
    throw new Error('repo_id must be a number');
  }
  if (args.entity_types !== undefined && !Array.isArray(args.entity_types)) {
    throw new Error('entity_types must be an array');
  }
  if (args.metadata_filter !== undefined && typeof args.metadata_filter !== 'object') {
    throw new Error('metadata_filter must be an object');
  }
  if (args.limit !== undefined) {
    const limit = Number(args.limit);
    if (isNaN(limit) || limit < 1 || limit > 200) {
      throw new Error('limit must be a number between 1 and 200');
    }
    args.limit = limit;
  }
  return args as SearchLaravelEntitiesArgs;
}

export interface GetFileArgs {
  file_id?: number;
  file_path?: string;
  include_symbols?: boolean;
}

export interface GetSymbolArgs {
  symbol_id: number;
  include_dependencies?: boolean;
  include_callers?: boolean;
}

export interface SearchCodeArgs {
  query: string;
  repo_id?: number;
  symbol_type?: string;
  is_exported?: boolean;
  limit?: number;
}

export interface WhoCallsArgs {
  symbol_id: number;
  dependency_type?: string;
  include_indirect?: boolean;
}

export interface ListDependenciesArgs {
  symbol_id: number;
  dependency_type?: string;
  include_indirect?: boolean;
}

// Laravel-specific tool argument interfaces
export interface GetLaravelRoutesArgs {
  repo_id?: number;
  path?: string;
  method?: string;
  middleware?: string;
  controller?: string;
}

export interface GetEloquentModelsArgs {
  repo_id?: number;
  model_name?: string;
  table_name?: string;
  relationships?: string[];
}

export interface GetLaravelControllersArgs {
  repo_id?: number;
  controller_name?: string;
  action?: string;
  middleware?: string;
}

export interface SearchLaravelEntitiesArgs {
  query: string;
  repo_id?: number;
  entity_types?: string[];
  metadata_filter?: Record<string, any>;
  limit?: number;
}

export class McpTools {
  private dbService: DatabaseService;
  private logger: any;
  private sessionId?: string;

  constructor(dbService: DatabaseService, sessionId?: string) {
    this.dbService = dbService;
    this.sessionId = sessionId;
    this.logger = logger;
  }

  async getFile(args: any) {
    const validatedArgs = validateGetFileArgs(args);
    this.logger.debug('Getting file', validatedArgs);

    let file;

    if (validatedArgs.file_id) {
      file = await this.dbService.getFileWithRepository(validatedArgs.file_id);
    } else if (validatedArgs.file_path) {
      // Find file by path - this would need additional database method
      throw new Error('Finding file by path not yet implemented');
    }

    if (!file) {
      throw new Error('File not found');
    }

    let symbols = [];
    if (validatedArgs.include_symbols !== false) {
      symbols = await this.dbService.getSymbolsByFile(file.id);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            file: {
              id: file.id,
              path: file.path,
              language: file.language,
              size: file.size,
              last_modified: file.last_modified,
              is_test: file.is_test,
              is_generated: file.is_generated,
              repository: file.repository ? {
                name: file.repository.name,
                path: file.repository.path,
              } : null,
            },
            symbols: symbols.map(symbol => ({
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
              start_line: symbol.start_line,
              end_line: symbol.end_line,
              is_exported: symbol.is_exported,
              visibility: symbol.visibility,
              signature: symbol.signature,
            })),
            symbol_count: symbols.length,
          }, null, 2),
        },
      ],
    };
  }

  async getSymbol(args: any) {
    const validatedArgs = validateGetSymbolArgs(args);
    this.logger.debug('Getting symbol', validatedArgs);

    const symbol = await this.dbService.getSymbolWithFile(validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    let dependencies = [];
    let callers = [];

    if (validatedArgs.include_dependencies !== false) {
      dependencies = await this.dbService.getDependenciesFrom(validatedArgs.symbol_id);
    }

    if (validatedArgs.include_callers === true) {
      callers = await this.dbService.getDependenciesTo(validatedArgs.symbol_id);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            symbol: {
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
              start_line: symbol.start_line,
              end_line: symbol.end_line,
              is_exported: symbol.is_exported,
              visibility: symbol.visibility,
              signature: symbol.signature,
              file: symbol.file ? {
                id: symbol.file.id,
                path: symbol.file.path,
                language: symbol.file.language,
                repository: symbol.file.repository || null,
              } : null,
            },
            dependencies: dependencies.map(dep => ({
              id: dep.id,
              type: dep.dependency_type,
              line_number: dep.line_number,
              confidence: dep.confidence,
              to_symbol: dep.to_symbol ? {
                id: dep.to_symbol.id,
                name: dep.to_symbol.name,
                type: dep.to_symbol.symbol_type,
                file_path: dep.to_symbol.file?.path,
              } : null,
            })),
            callers: callers.map(caller => ({
              id: caller.id,
              type: caller.dependency_type,
              line_number: caller.line_number,
              confidence: caller.confidence,
              from_symbol: caller.from_symbol ? {
                id: caller.from_symbol.id,
                name: caller.from_symbol.name,
                type: caller.from_symbol.symbol_type,
                file_path: caller.from_symbol.file?.path,
              } : null,
            })),
          }, null, 2),
        },
      ],
    };
  }

  async searchCode(args: any) {
    const validatedArgs = validateSearchCodeArgs(args);
    this.logger.debug('Searching code', validatedArgs);

    const symbols = await this.dbService.searchSymbols(validatedArgs.query, validatedArgs.repo_id);

    // Apply additional filters
    let filteredSymbols = symbols;

    if (validatedArgs.symbol_type) {
      filteredSymbols = filteredSymbols.filter(s => s.symbol_type === validatedArgs.symbol_type);
    }

    if (validatedArgs.is_exported !== undefined) {
      filteredSymbols = filteredSymbols.filter(s => s.is_exported === validatedArgs.is_exported);
    }

    // Apply limit
    const limit = validatedArgs.limit || 50;
    filteredSymbols = filteredSymbols.slice(0, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: validatedArgs.query,
            results: filteredSymbols.map(symbol => ({
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
              start_line: symbol.start_line,
              end_line: symbol.end_line,
              is_exported: symbol.is_exported,
              visibility: symbol.visibility,
              signature: symbol.signature,
              file: symbol.file ? {
                id: symbol.file.id,
                path: symbol.file.path,
                language: symbol.file.language,
              } : null,
            })),
            total_results: filteredSymbols.length,
            query_filters: {
              symbol_type: validatedArgs.symbol_type,
              is_exported: validatedArgs.is_exported,
              repo_id: validatedArgs.repo_id,
            },
          }, null, 2),
        },
      ],
    };
  }

  async whoCalls(args: any) {
    const validatedArgs = validateWhoCallsArgs(args);
    this.logger.debug('Finding who calls symbol', validatedArgs);

    const symbol = await this.dbService.getSymbol(validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    let callers = await this.dbService.getDependenciesTo(validatedArgs.symbol_id);

    // Filter by dependency type if specified
    if (validatedArgs.dependency_type) {
      const depType = validatedArgs.dependency_type as DependencyType;
      callers = callers.filter(caller => caller.dependency_type === depType);
    }

    // Phase 3: Implement indirect callers (transitive dependencies)
    if (validatedArgs.include_indirect) {
      this.logger.debug('Performing manual transitive caller analysis', { symbol_id: validatedArgs.symbol_id });

      try {
        // Manual implementation: Find callers of direct callers (second-level callers)
        const directCallerIds = callers.map(c => c.from_symbol?.id).filter(Boolean) as number[];
        const transitiveCallers: DependencyWithSymbols[] = [];

        for (const callerId of directCallerIds) {
          // Find who calls each direct caller
          const secondLevelCallers = await this.dbService.getDependenciesTo(callerId);

          // Filter by dependency type if specified
          const filteredSecondLevel = validatedArgs.dependency_type
            ? secondLevelCallers.filter(dep => dep.dependency_type === validatedArgs.dependency_type as DependencyType)
            : secondLevelCallers;

          // Add second-level callers as transitive results
          transitiveCallers.push(...filteredSecondLevel);
        }

        // Remove duplicates and avoid including symbols that are already direct callers
        const directCallerIdsSet = new Set(directCallerIds);
        const uniqueTransitiveCallers = transitiveCallers.filter((caller, index, arr) => {
          // Remove duplicates by ID
          const isUnique = arr.findIndex(c => c.from_symbol?.id === caller.from_symbol?.id) === index;
          // Exclude if it's already a direct caller
          const isNotDirectCaller = !directCallerIdsSet.has(caller.from_symbol?.id || -1);
          return isUnique && isNotDirectCaller;
        });

        callers = [...callers, ...uniqueTransitiveCallers];

        this.logger.debug('Manual transitive caller analysis completed', {
          symbol_id: validatedArgs.symbol_id,
          direct_callers: directCallerIds.length,
          transitive_callers: uniqueTransitiveCallers.length,
          total_callers: callers.length
        });
      } catch (error) {
        this.logger.error('Manual transitive caller analysis failed', {
          symbol_id: validatedArgs.symbol_id,
          error: error.message
        });
        // Continue with direct callers only
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            symbol: {
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
            },
            callers: callers.map(caller => ({
              id: caller.id,
              dependency_type: caller.dependency_type,
              line_number: caller.line_number,
              confidence: caller.confidence,
              from_symbol: caller.from_symbol ? {
                id: caller.from_symbol.id,
                name: caller.from_symbol.name,
                type: caller.from_symbol.symbol_type,
                file_path: caller.from_symbol.file?.path,
              } : null,
            })),
            total_callers: callers.length,
            filters: {
              dependency_type: validatedArgs.dependency_type,
              include_indirect: validatedArgs.include_indirect,
            },
          }, null, 2),
        },
      ],
    };
  }

  async listDependencies(args: any) {
    const validatedArgs = validateListDependenciesArgs(args);
    this.logger.debug('Listing dependencies for symbol', validatedArgs);

    const symbol = await this.dbService.getSymbol(validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    let dependencies = await this.dbService.getDependenciesFrom(validatedArgs.symbol_id);

    // Filter by dependency type if specified
    if (validatedArgs.dependency_type) {
      const depType = validatedArgs.dependency_type as DependencyType;
      dependencies = dependencies.filter(dep => dep.dependency_type === depType);
    }

    // Phase 3: Implement indirect dependencies (transitive)
    if (validatedArgs.include_indirect) {
      this.logger.debug('Performing transitive dependency analysis', { symbol_id: validatedArgs.symbol_id });

      const transitiveOptions: TransitiveAnalysisOptions = {
        maxDepth: 10, // Reasonable default depth
        includeTypes: validatedArgs.dependency_type ? [validatedArgs.dependency_type as DependencyType] : undefined,
        confidenceThreshold: 0.1 // Filter out low-confidence relationships
      };

      try {
        const transitiveResult = await transitiveAnalyzer.getTransitiveDependencies(
          validatedArgs.symbol_id,
          transitiveOptions
        );

        // Debug the transitive result structure for dependencies
        this.logger.debug('Transitive dependency result structure', {
          resultCount: transitiveResult.results.length,
          sampleResult: transitiveResult.results[0] ? {
            symbolId: transitiveResult.results[0].symbolId,
            depth: transitiveResult.results[0].depth,
            dependenciesCount: transitiveResult.results[0].dependencies.length,
            firstDependency: transitiveResult.results[0].dependencies[0] ? {
              to_symbol_id: transitiveResult.results[0].dependencies[0].to_symbol_id,
              to_symbol_exists: !!transitiveResult.results[0].dependencies[0].to_symbol,
              to_symbol_name: transitiveResult.results[0].dependencies[0].to_symbol?.name
            } : null
          } : null
        });

        // Merge direct dependencies with transitive results - use already resolved data from transitive analyzer
        const transitiveDependencies = transitiveResult.results.map(result => {
          // Use the already-resolved symbol data from the transitive analyzer
          const toSymbol = result.dependencies[0]?.to_symbol;

          if (!toSymbol) {
            this.logger.warn('Transitive dependency result missing to_symbol', {
              symbolId: result.symbolId,
              dependenciesLength: result.dependencies.length
            });
            return null;
          }

          return {
            id: result.symbolId,
            from_symbol_id: validatedArgs.symbol_id,
            to_symbol_id: result.symbolId,
            dependency_type: DependencyType.CALLS,
            line_number: result.dependencies[0].line_number,
            confidence: result.totalConfidence,
            created_at: new Date(),
            updated_at: new Date(),
            from_symbol: undefined,
            to_symbol: toSymbol
          };
        }).filter(Boolean); // Remove null entries

        // Add transitive dependencies to the results
        dependencies = [...dependencies, ...transitiveDependencies];

        this.logger.debug('Transitive dependency analysis completed', {
          symbol_id: validatedArgs.symbol_id,
          direct_dependencies: dependencies.length - transitiveDependencies.length,
          transitive_dependencies: transitiveDependencies.length,
          max_depth_reached: transitiveResult.maxDepthReached,
          execution_time_ms: transitiveResult.executionTimeMs
        });
      } catch (error) {
        this.logger.error('Transitive dependency analysis failed', {
          symbol_id: validatedArgs.symbol_id,
          error: error.message
        });
        // Continue with direct dependencies only
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            symbol: {
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
            },
            dependencies: dependencies.map(dep => ({
              id: dep.id,
              dependency_type: dep.dependency_type,
              line_number: dep.line_number,
              confidence: dep.confidence,
              to_symbol: dep.to_symbol ? {
                id: dep.to_symbol.id,
                name: dep.to_symbol.name,
                type: dep.to_symbol.symbol_type,
                file_path: dep.to_symbol.file?.path,
              } : null,
            })),
            total_dependencies: dependencies.length,
            filters: {
              dependency_type: validatedArgs.dependency_type,
              include_indirect: validatedArgs.include_indirect,
            },
          }, null, 2),
        },
      ],
    };
  }

  // Laravel-specific MCP tools
  async getLaravelRoutes(args: any) {
    const validatedArgs = validateGetLaravelRoutesArgs(args);
    this.logger.debug('Getting Laravel routes', validatedArgs);

    // Get all Laravel routes from the repository
    let routes = [];
    if (validatedArgs.repo_id) {
      routes = await this.dbService.getRoutesByFramework(validatedArgs.repo_id, 'laravel');
    } else {
      // If no repo_id specified, get routes from all repositories
      const repositories = await this.dbService.getAllRepositories();
      for (const repo of repositories) {
        const repoRoutes = await this.dbService.getRoutesByFramework(repo.id, 'laravel');
        routes.push(...repoRoutes);
      }
    }

    // Apply filters
    let filteredRoutes = routes;

    if (validatedArgs.path) {
      filteredRoutes = filteredRoutes.filter(route =>
        route.path?.includes(validatedArgs.path!) || route.name?.includes(validatedArgs.path!)
      );
    }

    if (validatedArgs.method) {
      filteredRoutes = filteredRoutes.filter(route =>
        route.method?.toLowerCase() === validatedArgs.method!.toLowerCase()
      );
    }

    if (validatedArgs.middleware) {
      filteredRoutes = filteredRoutes.filter(route =>
        route.middleware?.some(m => m.includes(validatedArgs.middleware!))
      );
    }

    if (validatedArgs.controller) {
      filteredRoutes = filteredRoutes.filter(route =>
        route.controller?.includes(validatedArgs.controller!)
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            routes: filteredRoutes.map(route => ({
              id: route.id,
              path: route.path,
              method: route.method,
              name: route.name,
              controller: route.controller,
              action: route.action,
              middleware: route.middleware || [],
              framework_type: route.framework_type,
              dynamic_segments: route.dynamic_segments || [],
              file_id: route.file_id,
            })),
            total_routes: filteredRoutes.length,
            filters: {
              repo_id: validatedArgs.repo_id,
              path: validatedArgs.path,
              method: validatedArgs.method,
              middleware: validatedArgs.middleware,
              controller: validatedArgs.controller,
            },
          }, null, 2),
        },
      ],
    };
  }

  async getEloquentModels(args: any) {
    const validatedArgs = validateGetEloquentModelsArgs(args);
    this.logger.debug('Getting Eloquent models', validatedArgs);

    // Get Laravel framework metadata (contains models)
    let frameworkMetadata = [];
    if (validatedArgs.repo_id) {
      const metadata = await this.dbService.getFrameworkMetadata(validatedArgs.repo_id, 'laravel');
      if (metadata) {
        frameworkMetadata = [metadata];
      }
    } else {
      // Get from all repositories
      const repositories = await this.dbService.getAllRepositories();
      for (const repo of repositories) {
        const metadata = await this.dbService.getFrameworkMetadata(repo.id, 'laravel');
        if (metadata) {
          frameworkMetadata.push(metadata);
        }
      }
    }

    // Extract models from framework metadata
    let models = [];
    for (const metadata of frameworkMetadata) {
      if (metadata.metadata && metadata.metadata.models) {
        models.push(...metadata.metadata.models);
      }
    }

    // Apply filters
    let filteredModels = models;

    if (validatedArgs.model_name) {
      filteredModels = filteredModels.filter(model =>
        model.name?.toLowerCase().includes(validatedArgs.model_name!.toLowerCase())
      );
    }

    if (validatedArgs.table_name) {
      filteredModels = filteredModels.filter(model =>
        model.tableName?.toLowerCase().includes(validatedArgs.table_name!.toLowerCase())
      );
    }

    if (validatedArgs.relationships && validatedArgs.relationships.length > 0) {
      filteredModels = filteredModels.filter(model =>
        model.relationships?.some(rel =>
          validatedArgs.relationships!.some(filterRel => rel.type.includes(filterRel))
        )
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            models: filteredModels.map(model => ({
              name: model.name,
              type: model.type,
              tableName: model.tableName,
              fillable: model.fillable || [],
              relationships: model.relationships || [],
              file_path: model.file_path,
              start_line: model.start_line,
              end_line: model.end_line,
            })),
            total_models: filteredModels.length,
            filters: {
              repo_id: validatedArgs.repo_id,
              model_name: validatedArgs.model_name,
              table_name: validatedArgs.table_name,
              relationships: validatedArgs.relationships,
            },
          }, null, 2),
        },
      ],
    };
  }

  async getLaravelControllers(args: any) {
    const validatedArgs = validateGetLaravelControllersArgs(args);
    this.logger.debug('Getting Laravel controllers', validatedArgs);

    // Get Laravel framework metadata (contains controllers)
    let frameworkMetadata = [];
    if (validatedArgs.repo_id) {
      const metadata = await this.dbService.getFrameworkMetadata(validatedArgs.repo_id, 'laravel');
      if (metadata) {
        frameworkMetadata = [metadata];
      }
    } else {
      // Get from all repositories
      const repositories = await this.dbService.getAllRepositories();
      for (const repo of repositories) {
        const metadata = await this.dbService.getFrameworkMetadata(repo.id, 'laravel');
        if (metadata) {
          frameworkMetadata.push(metadata);
        }
      }
    }

    // Extract controllers from framework metadata
    let controllers = [];
    for (const metadata of frameworkMetadata) {
      if (metadata.metadata && metadata.metadata.controllers) {
        controllers.push(...metadata.metadata.controllers);
      }
    }

    // Apply filters
    let filteredControllers = controllers;

    if (validatedArgs.controller_name) {
      filteredControllers = filteredControllers.filter(controller =>
        controller.name?.toLowerCase().includes(validatedArgs.controller_name!.toLowerCase())
      );
    }

    if (validatedArgs.action) {
      filteredControllers = filteredControllers.filter(controller =>
        controller.actions?.some(action => action.includes(validatedArgs.action!))
      );
    }

    if (validatedArgs.middleware) {
      filteredControllers = filteredControllers.filter(controller =>
        controller.middleware?.some(m => m.includes(validatedArgs.middleware!))
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            controllers: filteredControllers.map(controller => ({
              name: controller.name,
              type: controller.type,
              actions: controller.actions || [],
              middleware: controller.middleware || [],
              resourceController: controller.resourceController || false,
              file_path: controller.file_path,
              start_line: controller.start_line,
              end_line: controller.end_line,
            })),
            total_controllers: filteredControllers.length,
            filters: {
              repo_id: validatedArgs.repo_id,
              controller_name: validatedArgs.controller_name,
              action: validatedArgs.action,
              middleware: validatedArgs.middleware,
            },
          }, null, 2),
        },
      ],
    };
  }

  async searchLaravelEntities(args: any) {
    const validatedArgs = validateSearchLaravelEntitiesArgs(args);
    this.logger.debug('Searching Laravel entities', validatedArgs);

    const results = [];

    // Define entity types to search
    const entityTypes = validatedArgs.entity_types || ['route', 'model', 'controller', 'middleware', 'job', 'service_provider', 'command'];

    // Search routes if included
    if (entityTypes.includes('route')) {
      let routes = [];
      if (validatedArgs.repo_id) {
        routes = await this.dbService.getRoutesByFramework(validatedArgs.repo_id, 'laravel');
      } else {
        const repositories = await this.dbService.getAllRepositories();
        for (const repo of repositories) {
          const repoRoutes = await this.dbService.getRoutesByFramework(repo.id, 'laravel');
          routes.push(...repoRoutes);
        }
      }

      const matchingRoutes = routes.filter(route =>
        route.path?.toLowerCase().includes(validatedArgs.query.toLowerCase()) ||
        route.name?.toLowerCase().includes(validatedArgs.query.toLowerCase()) ||
        route.controller?.toLowerCase().includes(validatedArgs.query.toLowerCase()) ||
        route.action?.toLowerCase().includes(validatedArgs.query.toLowerCase())
      );

      results.push(...matchingRoutes.map(route => ({
        entity_type: 'route',
        entity_id: route.id,
        name: route.name || route.path,
        type: 'route',
        path: route.path,
        method: route.method,
        controller: route.controller,
        action: route.action,
        middleware: route.middleware,
        file_id: route.file_id,
      })));
    }

    // Search framework metadata entities (models, controllers, etc.)
    if (entityTypes.some(type => ['model', 'controller', 'middleware', 'job', 'service_provider', 'command'].includes(type))) {
      let frameworkMetadata = [];
      if (validatedArgs.repo_id) {
        const metadata = await this.dbService.getFrameworkMetadata(validatedArgs.repo_id, 'laravel');
        if (metadata) {
          frameworkMetadata = [metadata];
        }
      } else {
        const repositories = await this.dbService.getAllRepositories();
        for (const repo of repositories) {
          const metadata = await this.dbService.getFrameworkMetadata(repo.id, 'laravel');
          if (metadata) {
            frameworkMetadata.push(metadata);
          }
        }
      }

      for (const metadata of frameworkMetadata) {
        if (metadata.metadata) {
          // Search each entity type
          for (const entityType of entityTypes) {
            const entities = metadata.metadata[entityType + 's'] || metadata.metadata[entityType] || [];

            const matchingEntities = entities.filter(entity =>
              entity.name?.toLowerCase().includes(validatedArgs.query.toLowerCase()) ||
              (entity.type && entity.type.toLowerCase().includes(validatedArgs.query.toLowerCase()))
            );

            results.push(...matchingEntities.map(entity => ({
              entity_type: entityType,
              entity_id: entity.id || entity.name,
              name: entity.name,
              type: entity.type || entityType,
              ...entity
            })));
          }
        }
      }
    }

    // Apply metadata filter if provided
    let filteredResults = results;
    if (validatedArgs.metadata_filter) {
      filteredResults = results.filter(result => {
        for (const [key, value] of Object.entries(validatedArgs.metadata_filter!)) {
          if (result[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // Apply limit
    const limit = validatedArgs.limit || 50;
    filteredResults = filteredResults.slice(0, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: validatedArgs.query,
            results: filteredResults,
            total_results: filteredResults.length,
            filters: {
              repo_id: validatedArgs.repo_id,
              entity_types: validatedArgs.entity_types,
              metadata_filter: validatedArgs.metadata_filter,
              limit: validatedArgs.limit,
            },
          }, null, 2),
        },
      ],
    };
  }
}