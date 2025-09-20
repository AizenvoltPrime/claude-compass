import { DatabaseService } from '../database/services';
import {
  DependencyType,
  DependencyWithSymbols,
  SymbolWithFile,
  ApiCall,
  DataContract,
} from '../database/models';
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

// Cross-stack tool validation functions
function validateGetApiCallsArgs(args: any): GetApiCallsArgs {
  if (args.component_id === undefined || args.component_id === null) {
    throw new Error('component_id is required');
  }
  if (typeof args.component_id !== 'number') {
    throw new Error('component_id must be a number');
  }
  if (args.component_id < 0) {
    throw new Error('component_id must be a positive number');
  }
  if (
    args.include_response_schemas !== undefined &&
    typeof args.include_response_schemas !== 'boolean'
  ) {
    throw new Error('include_response_schemas must be a boolean');
  }
  if (args.repository_id !== undefined && typeof args.repository_id !== 'number') {
    throw new Error('repository_id must be a number');
  }
  return args as GetApiCallsArgs;
}

function validateGetDataContractsArgs(args: any): GetDataContractsArgs {
  if (args.schema_name === undefined || args.schema_name === null) {
    throw new Error('schema_name is required');
  }
  if (typeof args.schema_name !== 'string') {
    throw new Error('schema_name must be a string');
  }
  if (args.schema_name === '' || args.schema_name.trim() === '') {
    throw new Error('schema_name cannot be empty');
  }
  if (args.repository_id !== undefined && typeof args.repository_id !== 'number') {
    throw new Error('repository_id must be a number');
  }
  if (
    args.include_drift_analysis !== undefined &&
    typeof args.include_drift_analysis !== 'boolean'
  ) {
    throw new Error('include_drift_analysis must be a boolean');
  }
  return args as GetDataContractsArgs;
}

function validateGetCrossStackImpactArgs(args: any): GetCrossStackImpactArgs {
  if (args.symbol_id === undefined || args.symbol_id === null) {
    throw new Error('symbol_id is required');
  }
  if (typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id must be a number');
  }
  if (args.symbol_id <= 0) {
    throw new Error('symbol_id must be a positive number');
  }
  if (args.include_transitive !== undefined && typeof args.include_transitive !== 'boolean') {
    throw new Error('include_transitive must be a boolean');
  }
  if (args.max_depth !== undefined) {
    const maxDepth = Number(args.max_depth);
    if (isNaN(maxDepth) || maxDepth < 1 || maxDepth > 20) {
      throw new Error('max_depth must be a number between 1 and 20');
    }
    args.max_depth = maxDepth;
  }
  return args as GetCrossStackImpactArgs;
}

function validateWhoCallsArgsWithCrossStack(args: any): WhoCallsArgsWithCrossStack {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.dependency_type !== undefined && typeof args.dependency_type !== 'string') {
    throw new Error('dependency_type must be a string');
  }
  if (args.include_indirect !== undefined && typeof args.include_indirect !== 'boolean') {
    throw new Error('include_indirect must be a boolean');
  }
  if (args.include_cross_stack !== undefined && typeof args.include_cross_stack !== 'boolean') {
    throw new Error('include_cross_stack must be a boolean');
  }
  if (args.cross_stack_confidence_threshold !== undefined) {
    const threshold = Number(args.cross_stack_confidence_threshold);
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      throw new Error('cross_stack_confidence_threshold must be a number between 0 and 1');
    }
    args.cross_stack_confidence_threshold = threshold;
  }
  return args as WhoCallsArgsWithCrossStack;
}

function validateListDependenciesArgsWithCrossStack(args: any): ListDependenciesArgsWithCrossStack {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.dependency_type !== undefined && typeof args.dependency_type !== 'string') {
    throw new Error('dependency_type must be a string');
  }
  if (args.include_indirect !== undefined && typeof args.include_indirect !== 'boolean') {
    throw new Error('include_indirect must be a boolean');
  }
  if (args.include_cross_stack !== undefined && typeof args.include_cross_stack !== 'boolean') {
    throw new Error('include_cross_stack must be a boolean');
  }
  return args as ListDependenciesArgsWithCrossStack;
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

// Cross-stack tool argument interfaces
export interface GetApiCallsArgs {
  component_id: number;
  include_response_schemas?: boolean;
  repository_id?: number;
}

export interface GetDataContractsArgs {
  schema_name: string;
  repository_id?: number;
  include_drift_analysis?: boolean;
}

export interface GetCrossStackImpactArgs {
  symbol_id: number;
  include_transitive?: boolean;
  max_depth?: number;
}

export interface WhoCallsArgsWithCrossStack extends WhoCallsArgs {
  include_cross_stack?: boolean;
  cross_stack_confidence_threshold?: number;
}

export interface ListDependenciesArgsWithCrossStack extends ListDependenciesArgs {
  include_cross_stack?: boolean;
}

export class McpTools {
  private dbService: DatabaseService;
  private logger: any;
  private sessionId?: string;
  private defaultRepoName?: string;
  private defaultRepoId?: number;

  constructor(dbService: DatabaseService, sessionId?: string) {
    this.dbService = dbService;
    this.sessionId = sessionId;
    this.logger = logger;
    this.defaultRepoName = process.env.DEFAULT_REPO_NAME;
  }

  private async getDefaultRepoId(): Promise<number | undefined> {
    if (!this.defaultRepoName) return undefined;

    if (!this.defaultRepoId) {
      // Cache the repo ID lookup
      try {
        const repo = await this.dbService.getRepositoryByName(this.defaultRepoName);
        this.defaultRepoId = repo?.id;
        if (this.defaultRepoId) {
          this.logger.debug('Using default repository', {
            name: this.defaultRepoName,
            id: this.defaultRepoId,
          });
        } else {
          this.logger.warn('Default repository not found', { name: this.defaultRepoName });
        }
      } catch (error) {
        this.logger.error('Failed to resolve default repository', {
          name: this.defaultRepoName,
          error: (error as Error).message,
        });
      }
    }

    return this.defaultRepoId;
  }

  async getFile(args: any) {
    const validatedArgs = validateGetFileArgs(args);

    let file;

    if (validatedArgs.file_id) {
      file = await this.dbService.getFileWithRepository(validatedArgs.file_id);
    } else if (validatedArgs.file_path) {
      file = await this.dbService.getFileByPath(validatedArgs.file_path);
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
          text: JSON.stringify(
            {
              file: {
                id: file.id,
                path: file.path,
                language: file.language,
                size: file.size,
                last_modified: file.last_modified,
                is_test: file.is_test,
                is_generated: file.is_generated,
                repository: file.repository
                  ? {
                      name: file.repository.name,
                      path: file.repository.path,
                    }
                  : null,
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
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async getSymbol(args: any) {
    const validatedArgs = validateGetSymbolArgs(args);

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
          text: JSON.stringify(
            {
              symbol: {
                id: symbol.id,
                name: symbol.name,
                type: symbol.symbol_type,
                start_line: symbol.start_line,
                end_line: symbol.end_line,
                is_exported: symbol.is_exported,
                visibility: symbol.visibility,
                signature: symbol.signature,
                file: symbol.file
                  ? {
                      id: symbol.file.id,
                      path: symbol.file.path,
                      language: symbol.file.language,
                      repository: symbol.file.repository || null,
                    }
                  : null,
              },
              dependencies: dependencies.map(dep => ({
                id: dep.id,
                type: dep.dependency_type,
                line_number: dep.line_number,
                confidence: dep.confidence,
                to_symbol: dep.to_symbol
                  ? {
                      id: dep.to_symbol.id,
                      name: dep.to_symbol.name,
                      type: dep.to_symbol.symbol_type,
                      file_path: dep.to_symbol.file?.path,
                    }
                  : null,
              })),
              callers: callers.map(caller => ({
                id: caller.id,
                type: caller.dependency_type,
                line_number: caller.line_number,
                confidence: caller.confidence,
                from_symbol: caller.from_symbol
                  ? {
                      id: caller.from_symbol.id,
                      name: caller.from_symbol.name,
                      type: caller.from_symbol.symbol_type,
                      file_path: caller.from_symbol.file?.path,
                    }
                  : null,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async searchCode(args: any) {
    const validatedArgs = validateSearchCodeArgs(args);

    // Use default repo if no repo_id specified
    const repoId = validatedArgs.repo_id ?? (await this.getDefaultRepoId());

    const symbols = await this.dbService.searchSymbols(validatedArgs.query, repoId);

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
          text: JSON.stringify(
            {
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
                file: symbol.file
                  ? {
                      id: symbol.file.id,
                      path: symbol.file.path,
                      language: symbol.file.language,
                    }
                  : null,
              })),
              total_results: filteredSymbols.length,
              query_filters: {
                symbol_type: validatedArgs.symbol_type,
                is_exported: validatedArgs.is_exported,
                repo_id: validatedArgs.repo_id,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async whoCalls(args: any) {
    // Check if cross-stack parameters are provided to use enhanced validation
    const validatedArgs =
      args.include_cross_stack !== undefined || args.cross_stack_confidence_threshold !== undefined
        ? validateWhoCallsArgsWithCrossStack(args)
        : validateWhoCallsArgs(args);

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
      this.logger.debug('Performing manual transitive caller analysis', {
        symbol_id: validatedArgs.symbol_id,
      });

      try {
        // Manual implementation: Find callers of direct callers (second-level callers)
        const directCallerIds = callers.map(c => c.from_symbol?.id).filter(Boolean) as number[];
        const transitiveCallers: DependencyWithSymbols[] = [];

        for (const callerId of directCallerIds) {
          // Find who calls each direct caller
          const secondLevelCallers = await this.dbService.getDependenciesTo(callerId);

          // Filter by dependency type if specified
          const filteredSecondLevel = validatedArgs.dependency_type
            ? secondLevelCallers.filter(
                dep => dep.dependency_type === (validatedArgs.dependency_type as DependencyType)
              )
            : secondLevelCallers;

          // Add second-level callers as transitive results
          transitiveCallers.push(...filteredSecondLevel);
        }

        // Remove duplicates and avoid including symbols that are already direct callers
        const directCallerIdsSet = new Set(directCallerIds);
        const uniqueTransitiveCallers = transitiveCallers.filter((caller, index, arr) => {
          // Remove duplicates by ID
          const isUnique =
            arr.findIndex(c => c.from_symbol?.id === caller.from_symbol?.id) === index;
          // Exclude if it's already a direct caller
          const isNotDirectCaller = !directCallerIdsSet.has(caller.from_symbol?.id || -1);
          return isUnique && isNotDirectCaller;
        });

        callers = [...callers, ...uniqueTransitiveCallers];

        this.logger.debug('Manual transitive caller analysis completed', {
          symbol_id: validatedArgs.symbol_id,
          direct_callers: directCallerIds.length,
          transitive_callers: uniqueTransitiveCallers.length,
          total_callers: callers.length,
        });
      } catch (error) {
        this.logger.error('Manual transitive caller analysis failed', {
          symbol_id: validatedArgs.symbol_id,
          error: error.message,
        });
        // Continue with direct callers only
      }
    }

    // Enhanced formatting includes cross-stack relationship indicators
    const enhancedCallers = callers.map(caller => ({
      id: caller.id,
      dependency_type: caller.dependency_type,
      line_number: caller.line_number,
      confidence: caller.confidence,
      from_symbol: caller.from_symbol
        ? {
            id: caller.from_symbol.id,
            name: caller.from_symbol.name,
            type: caller.from_symbol.symbol_type,
            file_path: caller.from_symbol.file?.path,
          }
        : null,
      // Add cross-stack indicators if cross-stack analysis is enabled
      ...('include_cross_stack' in validatedArgs
        ? {
            is_cross_stack: this.isCrossStackRelationship(caller),
            cross_stack_confidence: caller.confidence,
          }
        : {}),
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              symbol: {
                id: symbol.id,
                name: symbol.name,
                type: symbol.symbol_type,
              },
              callers: enhancedCallers,
              total_callers: callers.length,
              filters: {
                dependency_type: validatedArgs.dependency_type,
                include_indirect: validatedArgs.include_indirect,
                ...('include_cross_stack' in validatedArgs
                  ? {
                      include_cross_stack: (validatedArgs as WhoCallsArgsWithCrossStack)
                        .include_cross_stack,
                      cross_stack_confidence_threshold: (
                        validatedArgs as WhoCallsArgsWithCrossStack
                      ).cross_stack_confidence_threshold,
                    }
                  : {}),
              },
              cross_stack_enabled: 'include_cross_stack' in validatedArgs,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async listDependencies(args: any) {
    // Check if cross-stack parameters are provided to use enhanced validation
    const validatedArgs =
      args.include_cross_stack !== undefined
        ? validateListDependenciesArgsWithCrossStack(args)
        : validateListDependenciesArgs(args);

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
      this.logger.debug('Performing transitive dependency analysis', {
        symbol_id: validatedArgs.symbol_id,
      });

      const transitiveOptions: TransitiveAnalysisOptions = {
        maxDepth: 10, // Reasonable default depth
        includeTypes: validatedArgs.dependency_type
          ? [validatedArgs.dependency_type as DependencyType]
          : undefined,
        confidenceThreshold: 0.1, // Filter out low-confidence relationships
      };

      try {
        const transitiveResult = await transitiveAnalyzer.getTransitiveDependencies(
          validatedArgs.symbol_id,
          transitiveOptions
        );

        // Debug the transitive result structure for dependencies
        this.logger.debug('Transitive dependency result structure', {
          resultCount: transitiveResult.results.length,
          sampleResult: transitiveResult.results[0]
            ? {
                symbolId: transitiveResult.results[0].symbolId,
                depth: transitiveResult.results[0].depth,
                dependenciesCount: transitiveResult.results[0].dependencies.length,
                firstDependency: transitiveResult.results[0].dependencies[0]
                  ? {
                      to_symbol_id: transitiveResult.results[0].dependencies[0].to_symbol_id,
                      to_symbol_exists: !!transitiveResult.results[0].dependencies[0].to_symbol,
                      to_symbol_name: transitiveResult.results[0].dependencies[0].to_symbol?.name,
                    }
                  : null,
              }
            : null,
        });

        // Merge direct dependencies with transitive results - use already resolved data from transitive analyzer
        const transitiveDependencies = transitiveResult.results
          .map(result => {
            // Use the already-resolved symbol data from the transitive analyzer
            const toSymbol = result.dependencies[0]?.to_symbol;

            if (!toSymbol) {
              this.logger.warn('Transitive dependency result missing to_symbol', {
                symbolId: result.symbolId,
                dependenciesLength: result.dependencies.length,
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
              to_symbol: toSymbol,
            };
          })
          .filter(Boolean); // Remove null entries

        // Add transitive dependencies to the results
        dependencies = [...dependencies, ...transitiveDependencies];

        this.logger.debug('Transitive dependency analysis completed', {
          symbol_id: validatedArgs.symbol_id,
          direct_dependencies: dependencies.length - transitiveDependencies.length,
          transitive_dependencies: transitiveDependencies.length,
          max_depth_reached: transitiveResult.maxDepthReached,
          execution_time_ms: transitiveResult.executionTimeMs,
        });
      } catch (error) {
        this.logger.error('Transitive dependency analysis failed', {
          symbol_id: validatedArgs.symbol_id,
          error: error.message,
        });
        // Continue with direct dependencies only
      }
    }

    // Enhanced formatting includes cross-stack dependency types
    const enhancedDependencies = dependencies.map(dep => ({
      id: dep.id,
      dependency_type: dep.dependency_type,
      line_number: dep.line_number,
      confidence: dep.confidence,
      to_symbol: dep.to_symbol
        ? {
            id: dep.to_symbol.id,
            name: dep.to_symbol.name,
            type: dep.to_symbol.symbol_type,
            file_path: dep.to_symbol.file?.path,
          }
        : null,
      // Add cross-stack indicators if cross-stack analysis is enabled
      ...('include_cross_stack' in validatedArgs
        ? {
            is_cross_stack: this.isCrossStackRelationship(dep),
            cross_stack_confidence: dep.confidence,
          }
        : {}),
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              symbol: {
                id: symbol.id,
                name: symbol.name,
                type: symbol.symbol_type,
              },
              dependencies: enhancedDependencies,
              total_dependencies: dependencies.length,
              filters: {
                dependency_type: validatedArgs.dependency_type,
                include_indirect: validatedArgs.include_indirect,
                ...('include_cross_stack' in validatedArgs
                  ? {
                      include_cross_stack: (validatedArgs as ListDependenciesArgsWithCrossStack)
                        .include_cross_stack,
                    }
                  : {}),
              },
              cross_stack_enabled: 'include_cross_stack' in validatedArgs,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Cross-stack MCP tools
  async getApiCalls(args: any) {
    const validatedArgs = validateGetApiCallsArgs(args);
    this.logger.debug('Getting API calls for component', validatedArgs);

    // Validate that cross-stack analysis was performed
    const validation = await this.validateCrossStackAnalysis(validatedArgs.repository_id);
    if (!validation.isValid) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                component_id: validatedArgs.component_id,
                api_calls: [],
                total_calls: 0,
                error: 'Cross-stack analysis not performed',
                message: validation.message,
                help: 'This tool requires cross-stack analysis to function properly. Please re-run the analysis with cross-stack detection enabled.',
                filters: {
                  component_id: validatedArgs.component_id,
                  include_response_schemas: validatedArgs.include_response_schemas,
                  repository_id: validatedArgs.repository_id,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      const apiCalls = await this.dbService.getApiCallsByComponent(validatedArgs.component_id);

      // Enrich with schemas if requested
      const enrichedCalls = validatedArgs.include_response_schemas
        ? await this.enrichWithSchemas(apiCalls)
        : apiCalls;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                component_id: validatedArgs.component_id,
                api_calls: enrichedCalls.map(call => ({
                  id: call.id,
                  method: call.method,
                  url_pattern: call.url_pattern,
                  request_schema: call.request_schema,
                  response_schema: call.response_schema,
                  confidence: call.confidence,
                  backend_route_id: call.backend_route_id,
                  created_at: call.created_at,
                })),
                total_calls: enrichedCalls.length,
                filters: {
                  component_id: validatedArgs.component_id,
                  include_response_schemas: validatedArgs.include_response_schemas,
                  repository_id: validatedArgs.repository_id,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Failed to get API calls', { error: (error as Error).message });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                component_id: validatedArgs.component_id,
                api_calls: [],
                total_calls: 0,
                error: (error as Error).message,
                filters: {
                  component_id: validatedArgs.component_id,
                  include_response_schemas: validatedArgs.include_response_schemas,
                  repository_id: validatedArgs.repository_id,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async getDataContracts(args: any) {
    const validatedArgs = validateGetDataContractsArgs(args);
    this.logger.debug('Getting data contracts for schema', validatedArgs);

    // Validate that cross-stack analysis was performed
    const validation = await this.validateCrossStackAnalysis(validatedArgs.repository_id);
    if (!validation.isValid) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                schema_name: validatedArgs.schema_name,
                data_contracts: [],
                total_contracts: 0,
                error: 'Cross-stack analysis not performed',
                message: validation.message,
                help: 'This tool requires cross-stack analysis to function properly. Please re-run the analysis with cross-stack detection enabled.',
                filters: {
                  schema_name: validatedArgs.schema_name,
                  repository_id: validatedArgs.repository_id,
                  include_drift_analysis: validatedArgs.include_drift_analysis,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      // First, search for symbols with the given schema name
      const symbols = await this.dbService.searchSymbols(
        validatedArgs.schema_name,
        validatedArgs.repository_id
      );

      if (symbols.length === 0) {
        // No symbols found with this schema name
        const response: any = {
          schema_name: validatedArgs.schema_name,
          data_contracts: [],
          total_contracts: 0,
          error: `No symbols found matching schema name '${validatedArgs.schema_name}'`,
          filters: {
            schema_name: validatedArgs.schema_name,
            repository_id: validatedArgs.repository_id,
            include_drift_analysis: validatedArgs.include_drift_analysis,
          },
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      }

      // Get contracts by schema name
      let contracts: DataContract[] = [];
      let errorMessage: string | undefined;

      try {
        contracts = await this.dbService.getDataContractsBySchema(validatedArgs.schema_name);
      } catch (error) {
        this.logger.warn('Failed to find data contracts by schema name, returning empty result', {
          schema_name: validatedArgs.schema_name,
          error: (error as Error).message,
        });
        contracts = [];
        errorMessage = `Failed to search for schema: ${(error as Error).message}`;
      }

      // Analyze schema drift if requested
      const analysis = validatedArgs.include_drift_analysis
        ? await this.analyzeSchemaDrift(contracts)
        : null;

      const response: any = {
        schema_name: validatedArgs.schema_name,
        data_contracts: contracts.map(contract => ({
          id: contract.id,
          name: contract.name,
          frontend_type_id: contract.frontend_type_id,
          backend_type_id: contract.backend_type_id,
          schema_definition: contract.schema_definition,
          drift_detected: contract.drift_detected,
          last_verified: contract.last_verified,
        })),
        total_contracts: contracts.length,
        drift_analysis: analysis,
        filters: {
          schema_name: validatedArgs.schema_name,
          repository_id: validatedArgs.repository_id,
          include_drift_analysis: validatedArgs.include_drift_analysis,
        },
      };

      if (errorMessage) {
        response.error = errorMessage;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Failed to get data contracts', { error: (error as Error).message });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                schema_name: validatedArgs.schema_name,
                data_contracts: [],
                total_contracts: 0,
                error: (error as Error).message,
                filters: {
                  schema_name: validatedArgs.schema_name,
                  repository_id: validatedArgs.repository_id,
                  include_drift_analysis: validatedArgs.include_drift_analysis,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async getCrossStackImpact(args: any) {
    const validatedArgs = validateGetCrossStackImpactArgs(args);
    this.logger.debug('Getting cross-stack impact analysis', validatedArgs);

    // Validate that cross-stack analysis was performed
    // Note: For this tool, we don't have a repository_id in args, so we check all repositories
    const validation = await this.validateCrossStackAnalysis();
    if (!validation.isValid) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                symbol_id: validatedArgs.symbol_id,
                cross_stack_impact: {
                  affected_symbols: [],
                  impact_paths: [],
                  total_affected: 0,
                },
                analysis_depth: 'none',
                error: 'Cross-stack analysis not performed',
                message: validation.message,
                help: 'This tool requires cross-stack analysis to function properly. Please re-run the analysis with cross-stack detection enabled.',
                filters: {
                  symbol_id: validatedArgs.symbol_id,
                  include_transitive: validatedArgs.include_transitive,
                  max_depth: validatedArgs.max_depth,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      let impact;

      if (validatedArgs.include_transitive !== false) {
        // Use transitive analysis for cross-stack impact
        const options = {
          maxDepth: validatedArgs.max_depth || 10,
          includeTransitive: true,
          confidenceThreshold: 0.7,
        };

        try {
          impact = await this.getCrossStackTransitiveImpact(validatedArgs.symbol_id, options);
        } catch (error) {
          this.logger.warn(
            'Cross-stack transitive analysis not available, falling back to direct impact',
            {
              error: (error as Error).message,
            }
          );
          // Return error response for transitive analysis failures
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    symbol_id: validatedArgs.symbol_id,
                    cross_stack_impact: await this.getDirectCrossStackImpact(
                      validatedArgs.symbol_id
                    ),
                    analysis_depth: 'direct',
                    error: `Cross-stack transitive analysis failed: ${(error as Error).message}`,
                    filters: {
                      symbol_id: validatedArgs.symbol_id,
                      include_transitive: validatedArgs.include_transitive,
                      max_depth: validatedArgs.max_depth,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      } else {
        impact = await this.getDirectCrossStackImpact(validatedArgs.symbol_id);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                symbol_id: validatedArgs.symbol_id,
                cross_stack_impact: impact,
                analysis_depth:
                  validatedArgs.include_transitive !== false ? 'transitive' : 'direct',
                filters: {
                  symbol_id: validatedArgs.symbol_id,
                  include_transitive: validatedArgs.include_transitive,
                  max_depth: validatedArgs.max_depth,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Failed to get cross-stack impact', { error: (error as Error).message });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                symbol_id: validatedArgs.symbol_id,
                cross_stack_impact: null,
                analysis_depth:
                  validatedArgs.include_transitive !== false ? 'transitive' : 'direct',
                error: (error as Error).message,
                filters: {
                  symbol_id: validatedArgs.symbol_id,
                  include_transitive: validatedArgs.include_transitive,
                  max_depth: validatedArgs.max_depth,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // Helper methods for cross-stack tools
  private async enrichWithSchemas(apiCalls: ApiCall[]): Promise<ApiCall[]> {
    this.logger.debug('Enriching API calls with schemas', { count: apiCalls.length });

    const enrichedCalls: ApiCall[] = [];

    for (const apiCall of apiCalls) {
      const enrichedCall = { ...apiCall };

      try {
        // Enrich with frontend schema information (TypeScript interfaces)
        if (apiCall.frontend_symbol_id) {
          const frontendSchema = await this.extractFrontendSchema(
            apiCall.frontend_symbol_id,
            apiCall.url_pattern
          );
          if (frontendSchema) {
            enrichedCall.request_schema = {
              ...enrichedCall.request_schema,
              frontend_types: frontendSchema.requestTypes,
              frontend_interfaces: frontendSchema.interfaces,
            };
            enrichedCall.response_schema = {
              ...enrichedCall.response_schema,
              frontend_types: frontendSchema.responseTypes,
              expected_structure: frontendSchema.expectedResponse,
            };
          }
        }

        // Enrich with backend schema information (PHP DTOs/Response classes)
        if (apiCall.backend_route_id) {
          const backendSchema = await this.extractBackendSchema(apiCall.backend_route_id);
          if (backendSchema) {
            enrichedCall.request_schema = {
              ...enrichedCall.request_schema,
              backend_validation: backendSchema.validation,
              backend_dto: backendSchema.requestDto,
            };
            enrichedCall.response_schema = {
              ...enrichedCall.response_schema,
              backend_response_class: backendSchema.responseClass,
              backend_structure: backendSchema.responseStructure,
            };
          }
        }

        // Calculate schema completeness score
        (enrichedCall as any).schema_completeness = this.calculateSchemaCompleteness(enrichedCall);
      } catch (error) {
        this.logger.warn('Failed to enrich API call with schema', {
          api_call_id: apiCall.id,
          error: (error as Error).message,
        });
        // Keep original API call if enrichment fails
      }

      enrichedCalls.push(enrichedCall);
    }

    this.logger.debug('Schema enrichment completed', {
      total_calls: apiCalls.length,
      enriched_calls: enrichedCalls.filter(call => (call as any).schema_completeness > 0).length,
    });

    return enrichedCalls;
  }

  private async extractFrontendSchema(componentId: number, urlPattern: string): Promise<any> {
    try {
      // Get the Vue component symbol and its file
      const symbol = await this.dbService.getSymbol(componentId);
      if (!symbol) return null;

      const file = await this.dbService.getFile(symbol.file_id);
      if (!file) return null;

      // Look for TypeScript interfaces and types related to this API call
      const relatedSymbols = await this.dbService.getSymbolsByFile(file.id);

      const interfaces = relatedSymbols.filter(
        s => s.symbol_type === 'interface' || s.symbol_type === 'type_alias'
      );

      const requestTypes = interfaces.filter(
        i =>
          i.name.toLowerCase().includes('request') ||
          i.name.toLowerCase().includes('payload') ||
          i.name.toLowerCase().includes('params')
      );

      const responseTypes = interfaces.filter(
        i =>
          i.name.toLowerCase().includes('response') ||
          i.name.toLowerCase().includes('result') ||
          i.name.toLowerCase().includes('data')
      );

      return {
        interfaces: interfaces.map(i => ({
          name: i.name,
          type: i.symbol_type,
          file_path: file.path,
          line: i.start_line,
        })),
        requestTypes: requestTypes.map(t => ({
          name: t.name,
          definition: t.signature || 'No signature available',
        })),
        responseTypes: responseTypes.map(t => ({
          name: t.name,
          definition: t.signature || 'No signature available',
        })),
        expectedResponse: responseTypes.length > 0 ? responseTypes[0].signature : null,
      };
    } catch (error) {
      this.logger.warn('Failed to extract frontend schema', {
        componentId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async extractBackendSchema(routeId: number): Promise<any> {
    try {
      // Get Laravel route information
      const route = await this.dbService.getRoute(routeId);
      if (!route) return null;

      // Get controller and action information
      let controllerFile = null;
      if (route.handler_symbol_id) {
        const handlerSymbol = await this.dbService.getSymbol(route.handler_symbol_id);
        if (handlerSymbol) {
          controllerFile = await this.dbService.getFile(handlerSymbol.file_id);
        }
      }
      if (!controllerFile) return null;

      // Look for FormRequest classes, DTOs, and Response classes
      const symbols = await this.dbService.getSymbolsByFile(controllerFile.id);

      const requestClasses = symbols.filter(
        s =>
          s.symbol_type === 'class' &&
          (s.name.includes('Request') || s.name.includes('DTO') || s.name.includes('Validator'))
      );

      const responseClasses = symbols.filter(
        s =>
          s.symbol_type === 'class' &&
          (s.name.includes('Response') ||
            s.name.includes('Resource') ||
            s.name.includes('Collection'))
      );

      return {
        validation: requestClasses.map(rc => ({
          class_name: rc.name,
          file_path: controllerFile.path,
          line: rc.start_line,
        })),
        requestDto: requestClasses.length > 0 ? requestClasses[0].name : null,
        responseClass: responseClasses.length > 0 ? responseClasses[0].name : null,
        responseStructure: responseClasses.length > 0 ? responseClasses[0].signature : null,
      };
    } catch (error) {
      this.logger.warn('Failed to extract backend schema', {
        routeId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private calculateSchemaCompleteness(apiCall: any): number {
    let score = 0;
    let maxScore = 4;

    // Frontend schema completeness
    if (apiCall.request_schema?.frontend_types?.length > 0) score += 1;
    if (apiCall.response_schema?.frontend_types?.length > 0) score += 1;

    // Backend schema completeness
    if (apiCall.request_schema?.backend_validation?.length > 0) score += 1;
    if (apiCall.response_schema?.backend_response_class) score += 1;

    return score / maxScore;
  }

  private async analyzeSchemaDrift(contracts: DataContract[]): Promise<any> {
    this.logger.debug('Analyzing schema drift', { count: contracts.length });

    const driftAnalysis = {
      total_contracts: contracts.length,
      analyzed_contracts: 0,
      drift_detected_count: 0,
      drift_details: [],
      last_analysis: new Date().toISOString(),
      summary: {
        high_severity: 0,
        medium_severity: 0,
        low_severity: 0,
        no_drift: 0,
      },
    };

    for (const contract of contracts) {
      try {
        const analysis = await this.analyzeContractDrift(contract);
        driftAnalysis.analyzed_contracts++;

        if (analysis.drift_detected) {
          driftAnalysis.drift_detected_count++;
          driftAnalysis.drift_details.push({
            contract_id: contract.id,
            contract_name: contract.name,
            severity: analysis.severity,
            issues: analysis.issues,
            recommendations: analysis.recommendations,
          });

          // Update summary counters
          if (analysis.severity === 'high') {
            driftAnalysis.summary.high_severity++;
          } else if (analysis.severity === 'medium') {
            driftAnalysis.summary.medium_severity++;
          } else {
            driftAnalysis.summary.low_severity++;
          }
        } else {
          driftAnalysis.summary.no_drift++;
        }
      } catch (error) {
        this.logger.warn('Failed to analyze drift for contract', {
          contract_id: contract.id,
          error: (error as Error).message,
        });
      }
    }

    return driftAnalysis;
  }

  private async analyzeContractDrift(contract: DataContract): Promise<any> {
    try {
      // Get frontend and backend schema definitions
      const frontendSchema = await this.getFrontendSchemaDefinition(contract.frontend_type_id);
      const backendSchema = await this.getBackendSchemaDefinition(contract.backend_type_id);

      if (!frontendSchema || !backendSchema) {
        return {
          drift_detected: false,
          severity: 'unknown',
          issues: ['Missing schema definition'],
          recommendations: ['Ensure both frontend and backend schemas are available'],
        };
      }

      const issues = [];
      const recommendations = [];

      // Compare field names and types
      const frontendFields = this.extractFieldsFromSchema(frontendSchema);
      const backendFields = this.extractFieldsFromSchema(backendSchema);

      // Check for missing fields in frontend
      for (const backendField of backendFields) {
        const frontendField = frontendFields.find(f => f.name === backendField.name);
        if (!frontendField) {
          issues.push(`Missing field '${backendField.name}' in frontend schema`);
          recommendations.push(`Add '${backendField.name}' field to frontend interface`);
        } else if (frontendField.type !== backendField.type) {
          issues.push(
            `Type mismatch for field '${backendField.name}': frontend has '${frontendField.type}', backend has '${backendField.type}'`
          );
          recommendations.push(
            `Update frontend field '${backendField.name}' type to match backend`
          );
        }
      }

      // Check for extra fields in frontend
      for (const frontendField of frontendFields) {
        const backendField = backendFields.find(f => f.name === frontendField.name);
        if (!backendField) {
          issues.push(
            `Extra field '${frontendField.name}' in frontend schema not present in backend`
          );
          recommendations.push(
            `Remove unused field '${frontendField.name}' or add to backend schema`
          );
        }
      }

      // Determine severity
      let severity = 'low';
      if (issues.length > 5) {
        severity = 'high';
      } else if (issues.length > 2) {
        severity = 'medium';
      }

      return {
        drift_detected: issues.length > 0,
        severity,
        issues,
        recommendations,
        frontend_fields_count: frontendFields.length,
        backend_fields_count: backendFields.length,
        comparison_timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn('Error analyzing contract drift', {
        contract_id: contract.id,
        error: (error as Error).message,
      });

      return {
        drift_detected: false,
        severity: 'error',
        issues: [`Analysis failed: ${(error as Error).message}`],
        recommendations: ['Review schema definitions and try again'],
      };
    }
  }

  private async getFrontendSchemaDefinition(typeId: number): Promise<any> {
    try {
      const symbol = await this.dbService.getSymbol(typeId);
      return symbol?.signature || null;
    } catch (error) {
      return null;
    }
  }

  private async getBackendSchemaDefinition(typeId: number): Promise<any> {
    try {
      const symbol = await this.dbService.getSymbol(typeId);
      return symbol?.signature || null;
    } catch (error) {
      return null;
    }
  }

  private extractFieldsFromSchema(schemaDefinition: string): Array<{ name: string; type: string }> {
    if (!schemaDefinition) return [];

    try {
      // Simple field extraction - this could be enhanced with proper TypeScript/PHP parsing
      const fields = [];
      const lines = schemaDefinition.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Match TypeScript interface fields: "fieldName: type"
        const tsMatch = trimmed.match(/^(\w+)\s*:\s*([^;,]+)/);
        if (tsMatch) {
          fields.push({
            name: tsMatch[1],
            type: tsMatch[2].trim(),
          });
          continue;
        }

        // Match PHP property fields: "public $fieldName" or similar
        const phpMatch = trimmed.match(/(?:public|private|protected)\s+\$?(\w+)/);
        if (phpMatch) {
          fields.push({
            name: phpMatch[1],
            type: 'mixed', // PHP type inference would require more sophisticated parsing
          });
        }
      }

      return fields;
    } catch (error) {
      this.logger.warn('Failed to extract fields from schema', { error: (error as Error).message });
      return [];
    }
  }

  private async getCrossStackTransitiveImpact(symbolId: number, options: any): Promise<any> {
    this.logger.debug('Getting cross-stack transitive impact with enhanced analyzer', {
      symbolId,
      options,
    });

    try {
      // Import the transitive analyzer to use the new cross-stack capabilities
      const { transitiveAnalyzer } = await import('../graph/transitive-analyzer');

      // Use the new getCrossStackTransitiveImpact method
      const crossStackOptions = {
        maxDepth: options.maxDepth || 10,
        includeTransitive: true,
        confidenceThreshold: options.crossStackConfidenceThreshold || 0.7,
      };

      const result = await transitiveAnalyzer.getCrossStackTransitiveImpact(
        symbolId,
        crossStackOptions
      );

      this.logger.debug('Cross-stack transitive impact analysis completed', {
        symbolId,
        frontendImpact: result.frontendImpact.length,
        backendImpact: result.backendImpact.length,
        crossStackRelationships: result.crossStackRelationships.length,
        totalImpacted: result.totalImpactedSymbols,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to get cross-stack transitive impact', {
        error: (error as Error).message,
      });
      throw new Error(`Cross-stack transitive analysis failed: ${(error as Error).message}`);
    }
  }

  private async getDirectCrossStackImpact(symbolId: number): Promise<any> {
    // Placeholder implementation - would get direct cross-stack relationships
    this.logger.debug('Getting direct cross-stack impact', { symbolId });

    // Get dependencies with cross-stack types
    const dependencies = await this.dbService.getDependenciesFrom(symbolId);
    const crossStackDeps = dependencies.filter(
      dep =>
        dep.dependency_type === DependencyType.API_CALL ||
        dep.dependency_type === DependencyType.SHARES_SCHEMA ||
        dep.dependency_type === DependencyType.FRONTEND_BACKEND
    );

    // Get callers with cross-stack types
    const callers = await this.dbService.getDependenciesTo(symbolId);
    const crossStackCallers = callers.filter(
      caller =>
        caller.dependency_type === DependencyType.API_CALL ||
        caller.dependency_type === DependencyType.SHARES_SCHEMA ||
        caller.dependency_type === DependencyType.FRONTEND_BACKEND
    );

    return {
      directDependencies: crossStackDeps.map(dep => ({
        id: dep.id,
        type: dep.dependency_type,
        confidence: dep.confidence,
        to_symbol: dep.to_symbol
          ? {
              id: dep.to_symbol.id,
              name: dep.to_symbol.name,
              type: dep.to_symbol.symbol_type,
              file_path: dep.to_symbol.file?.path,
            }
          : null,
      })),
      directCallers: crossStackCallers.map(caller => ({
        id: caller.id,
        type: caller.dependency_type,
        confidence: caller.confidence,
        from_symbol: caller.from_symbol
          ? {
              id: caller.from_symbol.id,
              name: caller.from_symbol.name,
              type: caller.from_symbol.symbol_type,
              file_path: caller.from_symbol.file?.path,
            }
          : null,
      })),
      crossStackRelationships: [
        ...crossStackDeps.map(dep => ({
          fromSymbolId: dep.from_symbol_id,
          toSymbolId: dep.to_symbol_id,
          relationshipType: dep.dependency_type,
          confidence: dep.confidence,
        })),
        ...crossStackCallers.map(caller => ({
          fromSymbolId: caller.from_symbol_id,
          toSymbolId: caller.to_symbol_id,
          relationshipType: caller.dependency_type,
          confidence: caller.confidence,
        })),
      ],
      total_cross_stack_dependencies: crossStackDeps.length,
      total_cross_stack_callers: crossStackCallers.length,
    };
  }

  private isCrossStackRelationship(result: any): boolean {
    // Helper method to determine if a relationship is cross-stack
    if (!result.dependency_type) return false;

    return (
      result.dependency_type === DependencyType.API_CALL ||
      result.dependency_type === DependencyType.SHARES_SCHEMA ||
      result.dependency_type === DependencyType.FRONTEND_BACKEND
    );
  }

  private async validateCrossStackAnalysis(
    repositoryId?: number
  ): Promise<{ isValid: boolean; message?: string }> {
    // Check if cross-stack analysis was performed by looking for cross-stack data
    try {
      let hasApiCalls = false;
      let hasDataContracts = false;

      if (repositoryId) {
        // Check specific repository
        const crossStackData = await this.dbService.getCrossStackDependencies(repositoryId);
        hasApiCalls = crossStackData.apiCalls.length > 0;
        hasDataContracts = crossStackData.dataContracts.length > 0;
      } else {
        // Check all repositories
        const repositories = await this.dbService.getAllRepositories();
        for (const repo of repositories) {
          const crossStackData = await this.dbService.getCrossStackDependencies(repo.id);

          if (crossStackData.apiCalls.length > 0) hasApiCalls = true;
          if (crossStackData.dataContracts.length > 0) hasDataContracts = true;

          if (hasApiCalls && hasDataContracts) break;
        }
      }

      if (!hasApiCalls && !hasDataContracts) {
        return {
          isValid: false,
          message:
            `Cross-stack analysis has not been performed${repositoryId ? ` for repository ${repositoryId}` : ''}. ` +
            'To enable cross-stack features, re-run the analysis with cross-stack detection enabled. ' +
            'Example: ./dist/src/cli/index.js analyze /path/to/project --verbose --extensions .vue,.ts,.js,.php',
        };
      }

      return { isValid: true };
    } catch (error) {
      this.logger.warn('Failed to validate cross-stack analysis', {
        error: (error as Error).message,
      });
      return {
        isValid: false,
        message:
          'Could not verify cross-stack analysis status. Please ensure the analysis was run with cross-stack detection enabled.',
      };
    }
  }

  // Laravel-specific MCP tools
  async getLaravelRoutes(args: any) {
    const validatedArgs = validateGetLaravelRoutesArgs(args);
    this.logger.debug('Getting Laravel routes', validatedArgs);

    // Get all Laravel routes from the repository
    let routes = [];
    const repoId = validatedArgs.repo_id ?? (await this.getDefaultRepoId());

    if (repoId) {
      routes = await this.dbService.getRoutesByFramework(repoId, 'laravel');
    } else {
      // If no repo_id specified and no default, get routes from all repositories
      const repositories = await this.dbService.getAllRepositories();
      for (const repo of repositories) {
        const repoRoutes = await this.dbService.getRoutesByFramework(repo.id, 'laravel');
        routes.push(...repoRoutes);
      }
    }

    // Apply filters
    let filteredRoutes = routes;

    if (validatedArgs.path) {
      filteredRoutes = filteredRoutes.filter(
        route =>
          route.path?.includes(validatedArgs.path!) || route.name?.includes(validatedArgs.path!)
      );
    }

    if (validatedArgs.method) {
      filteredRoutes = filteredRoutes.filter(
        route => route.method?.toLowerCase() === validatedArgs.method!.toLowerCase()
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
          text: JSON.stringify(
            {
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
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async getEloquentModels(args: any) {
    const validatedArgs = validateGetEloquentModelsArgs(args);
    this.logger.debug('Getting Eloquent models', validatedArgs);

    // Get Laravel framework metadata (contains models)
    let frameworkMetadata = [];
    const repoId = validatedArgs.repo_id ?? (await this.getDefaultRepoId());

    if (repoId) {
      const metadata = await this.dbService.getFrameworkMetadata(repoId, 'laravel');
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
          text: JSON.stringify(
            {
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
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async getLaravelControllers(args: any) {
    const validatedArgs = validateGetLaravelControllersArgs(args);
    this.logger.debug('Getting Laravel controllers', validatedArgs);

    // Get Laravel framework metadata (contains controllers)
    let frameworkMetadata = [];
    const repoId = validatedArgs.repo_id ?? (await this.getDefaultRepoId());

    if (repoId) {
      const metadata = await this.dbService.getFrameworkMetadata(repoId, 'laravel');
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
          text: JSON.stringify(
            {
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
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async searchLaravelEntities(args: any) {
    const validatedArgs = validateSearchLaravelEntitiesArgs(args);
    this.logger.debug('Searching Laravel entities', validatedArgs);

    const results = [];

    // Define entity types to search
    const entityTypes = validatedArgs.entity_types || [
      'route',
      'model',
      'controller',
      'middleware',
      'job',
      'service_provider',
      'command',
    ];

    // Search routes if included
    if (entityTypes.includes('route')) {
      let routes = [];
      const repoId = validatedArgs.repo_id ?? (await this.getDefaultRepoId());

      if (repoId) {
        routes = await this.dbService.getRoutesByFramework(repoId, 'laravel');
      } else {
        const repositories = await this.dbService.getAllRepositories();
        for (const repo of repositories) {
          const repoRoutes = await this.dbService.getRoutesByFramework(repo.id, 'laravel');
          routes.push(...repoRoutes);
        }
      }

      const matchingRoutes = routes.filter(
        route =>
          route.path?.toLowerCase().includes(validatedArgs.query.toLowerCase()) ||
          route.name?.toLowerCase().includes(validatedArgs.query.toLowerCase()) ||
          route.controller?.toLowerCase().includes(validatedArgs.query.toLowerCase()) ||
          route.action?.toLowerCase().includes(validatedArgs.query.toLowerCase())
      );

      results.push(
        ...matchingRoutes.map(route => ({
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
        }))
      );
    }

    // Search framework metadata entities (models, controllers, etc.)
    if (
      entityTypes.some(type =>
        ['model', 'controller', 'middleware', 'job', 'service_provider', 'command'].includes(type)
      )
    ) {
      let frameworkMetadata = [];
      const repoId = validatedArgs.repo_id ?? (await this.getDefaultRepoId());

      if (repoId) {
        const metadata = await this.dbService.getFrameworkMetadata(repoId, 'laravel');
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
            const entities =
              metadata.metadata[entityType + 's'] || metadata.metadata[entityType] || [];

            const matchingEntities = entities.filter(
              entity =>
                entity.name?.toLowerCase().includes(validatedArgs.query.toLowerCase()) ||
                (entity.type &&
                  entity.type.toLowerCase().includes(validatedArgs.query.toLowerCase()))
            );

            results.push(
              ...matchingEntities.map(entity => ({
                entity_type: entityType,
                entity_id: entity.id || entity.name,
                name: entity.name,
                type: entity.type || entityType,
                ...entity,
              }))
            );
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
          text: JSON.stringify(
            {
              query: validatedArgs.query,
              results: filteredResults,
              total_results: filteredResults.length,
              filters: {
                repo_id: validatedArgs.repo_id,
                entity_types: validatedArgs.entity_types,
                metadata_filter: validatedArgs.metadata_filter,
                limit: validatedArgs.limit,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
