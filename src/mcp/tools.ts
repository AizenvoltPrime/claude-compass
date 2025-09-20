import { DatabaseService } from '../database/services';
import {
  DependencyType,
  DependencyWithSymbols,
  SymbolWithFile,
  SymbolSearchOptions,
  SymbolType,
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

  // Phase 6A enhanced validation
  if (args.entity_types !== undefined) {
    if (!Array.isArray(args.entity_types)) {
      throw new Error('entity_types must be an array');
    }
    const validEntityTypes = ['route', 'model', 'controller', 'component', 'job', 'function', 'class', 'interface'];
    for (const entityType of args.entity_types) {
      if (typeof entityType !== 'string' || !validEntityTypes.includes(entityType)) {
        throw new Error(`entity_types must contain valid types: ${validEntityTypes.join(', ')}`);
      }
    }
  }

  if (args.framework !== undefined && typeof args.framework !== 'string') {
    throw new Error('framework must be a string');
  }

  if (args.use_vector !== undefined && typeof args.use_vector !== 'boolean') {
    throw new Error('use_vector must be a boolean');
  }

  if (args.repo_ids !== undefined) {
    if (!Array.isArray(args.repo_ids)) {
      throw new Error('repo_ids must be an array');
    }
    for (const repoId of args.repo_ids) {
      if (typeof repoId !== 'number') {
        throw new Error('repo_ids must contain only numbers');
      }
    }
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

function validateImpactOfArgs(args: any): ImpactOfArgs {
  if (args.symbol_id === undefined || args.symbol_id === null) {
    throw new Error('symbol_id is required');
  }
  if (typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id must be a number');
  }
  if (args.symbol_id <= 0) {
    throw new Error('symbol_id must be a positive number');
  }
  if (args.frameworks !== undefined && !Array.isArray(args.frameworks)) {
    throw new Error('frameworks must be an array');
  }
  if (args.include_tests !== undefined && typeof args.include_tests !== 'boolean') {
    throw new Error('include_tests must be a boolean');
  }
  if (args.include_routes !== undefined && typeof args.include_routes !== 'boolean') {
    throw new Error('include_routes must be a boolean');
  }
  if (args.include_jobs !== undefined && typeof args.include_jobs !== 'boolean') {
    throw new Error('include_jobs must be a boolean');
  }
  if (args.max_depth !== undefined) {
    const maxDepth = Number(args.max_depth);
    if (isNaN(maxDepth) || maxDepth < 1 || maxDepth > 20) {
      throw new Error('max_depth must be a number between 1 and 20');
    }
    args.max_depth = maxDepth;
  }
  if (args.confidence_threshold !== undefined) {
    const threshold = Number(args.confidence_threshold);
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      throw new Error('confidence_threshold must be a number between 0 and 1');
    }
    args.confidence_threshold = threshold;
  }
  return args as ImpactOfArgs;
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
  // Enhanced Phase 6A features
  entity_types?: string[];      // route, model, controller, component, job, etc.
  framework?: string;           // laravel, vue, react, node
  use_vector?: boolean;         // enable vector search (future)
  repo_ids?: number[];          // multi-repository search
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

// Comprehensive impact analysis interface (Phase 6A)
export interface ImpactOfArgs {
  symbol_id: number;
  frameworks?: string[];        // Multi-framework impact: ['vue', 'laravel', 'react', 'node']
  include_tests?: boolean;      // Test coverage impact analysis
  include_routes?: boolean;     // Route impact analysis
  include_jobs?: boolean;       // Background job impact analysis
  max_depth?: number;           // Transitive depth (default 5)
  confidence_threshold?: number; // Filter by confidence (default 0.7)
}

export interface ImpactItem {
  id: number;
  name: string;
  type: string;
  file_path: string;
  impact_type: 'direct' | 'indirect' | 'cross_stack';
  confidence: number;
}

export interface TestImpactItem {
  id: number;
  name: string;
  file_path: string;
  test_type: string;
  confidence: number;
}

export interface RouteImpactItem {
  id: number;
  path: string;
  method: string;
  framework: string;
  confidence: number;
}

export interface JobImpactItem {
  id: number;
  name: string;
  type: string;
  confidence: number;
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

  // Core Tool 1: getFile (unchanged)
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

  // Core Tool 2: getSymbol (unchanged)
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

  // Core Tool 3: Enhanced searchCode (Phase 6A - absorbs Laravel tool functionality)
  async searchCode(args: any) {
    const validatedArgs = validateSearchCodeArgs(args);
    this.logger.debug('Enhanced search with framework awareness', validatedArgs);

    // Use default repo if no repo_id specified
    const repoId = validatedArgs.repo_id ?? (await this.getDefaultRepoId());
    const repoIds = validatedArgs.repo_ids || (repoId ? [repoId] : []);

    // Build enhanced search options
    const searchOptions: SymbolSearchOptions = {
      useVector: validatedArgs.use_vector || false,
      limit: validatedArgs.limit || 100,
      confidenceThreshold: 0.7,
      searchMode: validatedArgs.use_vector ? 'hybrid' : 'fulltext',
      symbolTypes: [],
      isExported: validatedArgs.is_exported,
      framework: validatedArgs.framework,
      repoIds: repoIds.length > 0 ? repoIds : (repoId ? [repoId] : [])
    };

    let symbols = [];

    // Enhanced framework-aware search (absorbs removed Laravel tools functionality)
    if (validatedArgs.entity_types) {
      for (const entityType of validatedArgs.entity_types) {
        switch (entityType) {
          case 'route':
            symbols.push(...await this.searchRoutes(validatedArgs.query, repoIds, validatedArgs.framework));
            break;
          case 'model':
            symbols.push(...await this.searchModels(validatedArgs.query, repoIds, validatedArgs.framework));
            break;
          case 'controller':
            symbols.push(...await this.searchControllers(validatedArgs.query, repoIds, validatedArgs.framework));
            break;
          case 'component':
            symbols.push(...await this.searchComponents(validatedArgs.query, repoIds, validatedArgs.framework));
            break;
          case 'job':
            symbols.push(...await this.searchJobs(validatedArgs.query, repoIds, validatedArgs.framework));
            break;
          default:
            // Use enhanced search for standard symbol types
            const symbolType = this.mapEntityTypeToSymbolType(entityType);
            if (symbolType) {
              searchOptions.symbolTypes = [symbolType];
            }
            const standardSymbols = await this.dbService.searchSymbols(
              validatedArgs.query,
              repoId,
              searchOptions
            );
            symbols.push(...standardSymbols);
        }
      }
    } else {
      // Enhanced search when no entity types specified - use full search capabilities
      if (validatedArgs.symbol_type) {
        const symbolType = this.mapStringToSymbolType(validatedArgs.symbol_type);
        if (symbolType) {
          searchOptions.symbolTypes = [symbolType];
        }
      }

      symbols = await this.dbService.searchSymbols(
        validatedArgs.query,
        repoId,
        searchOptions
      );
    }

    // Apply any additional filtering not handled by enhanced search
    let filteredSymbols = symbols;

    // Apply framework filtering for all cases since DatabaseService doesn't handle it
    if (validatedArgs.framework) {
      filteredSymbols = filteredSymbols.filter(s => {
        const frameworkPath = this.getFrameworkPath(validatedArgs.framework!);
        const fileLanguage = s.file?.language;

        // Framework-specific filtering
        switch (validatedArgs.framework) {
          case 'laravel':
            return fileLanguage === 'php' || s.file?.path?.includes(frameworkPath);
          case 'vue':
            return fileLanguage === 'vue' || s.file?.path?.endsWith('.vue');
          case 'react':
            return fileLanguage === 'javascript' || fileLanguage === 'typescript' ||
                   s.file?.path?.includes('components/');
          case 'node':
            return fileLanguage === 'javascript' || fileLanguage === 'typescript';
          default:
            return s.file?.path?.includes(frameworkPath);
        }
      });
    }

    // The limit is already applied by the enhanced search, but ensure we don't exceed it
    const limit = validatedArgs.limit || 100;
    if (filteredSymbols.length > limit) {
      filteredSymbols = filteredSymbols.slice(0, limit);
    }

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
                entity_type: this.determineEntityType(symbol),
                framework: this.determineFramework(symbol),
              })),
              total_results: filteredSymbols.length,
              query_filters: {
                entity_types: validatedArgs.entity_types,
                framework: validatedArgs.framework,
                symbol_type: validatedArgs.symbol_type,
                is_exported: validatedArgs.is_exported,
                repo_ids: repoIds,
                use_vector: validatedArgs.use_vector,
              },
              search_options: {
                entity_types: validatedArgs.entity_types,
                framework: validatedArgs.framework,
                symbol_type: validatedArgs.symbol_type,
                is_exported: validatedArgs.is_exported,
                repo_ids: repoIds,
                use_vector: validatedArgs.use_vector,
              },
              search_mode: 'enhanced_framework_aware',
              absorbed_tools: ['getLaravelRoutes', 'getEloquentModels', 'getLaravelControllers', 'searchLaravelEntities'],
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Core Tool 4: whoCalls (unchanged)
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

    // Implement indirect callers (transitive dependencies)
    if (validatedArgs.include_indirect) {
      this.logger.debug('Performing transitive caller analysis', {
        symbol_id: validatedArgs.symbol_id,
      });

      try {
        const directCallerIds = callers.map(c => c.from_symbol?.id).filter(Boolean) as number[];
        const transitiveCallers: DependencyWithSymbols[] = [];

        for (const callerId of directCallerIds) {
          const secondLevelCallers = await this.dbService.getDependenciesTo(callerId);
          const filteredSecondLevel = validatedArgs.dependency_type
            ? secondLevelCallers.filter(
                dep => dep.dependency_type === (validatedArgs.dependency_type as DependencyType)
              )
            : secondLevelCallers;

          transitiveCallers.push(...filteredSecondLevel);
        }

        const directCallerIdsSet = new Set(directCallerIds);
        const uniqueTransitiveCallers = transitiveCallers.filter((caller, index, arr) => {
          const isUnique =
            arr.findIndex(c => c.from_symbol?.id === caller.from_symbol?.id) === index;
          const isNotDirectCaller = !directCallerIdsSet.has(caller.from_symbol?.id || -1);
          return isUnique && isNotDirectCaller;
        });

        callers = [...callers, ...uniqueTransitiveCallers];
      } catch (error) {
        this.logger.error('Transitive caller analysis failed', {
          symbol_id: validatedArgs.symbol_id,
          error: (error as Error).message,
        });
      }
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
              },
              callers: callers.map(caller => ({
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
              })),
              total_callers: callers.length,
              filters: {
                dependency_type: validatedArgs.dependency_type,
                include_indirect: validatedArgs.include_indirect,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Core Tool 5: listDependencies (unchanged)
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

    // Implement indirect dependencies (transitive)
    if (validatedArgs.include_indirect) {
      this.logger.debug('Performing transitive dependency analysis', {
        symbol_id: validatedArgs.symbol_id,
      });

      const transitiveOptions: TransitiveAnalysisOptions = {
        maxDepth: 10,
        includeTypes: validatedArgs.dependency_type
          ? [validatedArgs.dependency_type as DependencyType]
          : undefined,
        confidenceThreshold: 0.1,
      };

      try {
        const transitiveResult = await transitiveAnalyzer.getTransitiveDependencies(
          validatedArgs.symbol_id,
          transitiveOptions
        );

        const transitiveDependencies = transitiveResult.results
          .map(result => {
            const toSymbol = result.dependencies[0]?.to_symbol;
            if (!toSymbol) return null;

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
          .filter(Boolean);

        dependencies = [...dependencies, ...transitiveDependencies];
      } catch (error) {
        this.logger.error('Transitive dependency analysis failed', {
          symbol_id: validatedArgs.symbol_id,
          error: (error as Error).message,
        });
      }
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
              },
              dependencies: dependencies.map(dep => ({
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
              })),
              total_dependencies: dependencies.length,
              filters: {
                dependency_type: validatedArgs.dependency_type,
                include_indirect: validatedArgs.include_indirect,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Core Tool 6: impactOf (NEW - Phase 6A comprehensive impact analysis)
  async impactOf(args: any) {
    const validatedArgs = validateImpactOfArgs(args);
    this.logger.debug('Performing comprehensive impact analysis', validatedArgs);

    try {
      const symbol = await this.dbService.getSymbolWithFile(validatedArgs.symbol_id);
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      // Initialize impact analysis components
      const directImpact: ImpactItem[] = [];
      const transitiveImpact: ImpactItem[] = [];
      const testImpact: TestImpactItem[] = [];
      const routeImpact: RouteImpactItem[] = [];
      const jobImpact: JobImpactItem[] = [];
      const frameworksAffected = new Set<string>();

      // Direct impact analysis
      const directDependencies = await this.dbService.getDependenciesFrom(validatedArgs.symbol_id);
      const directCallers = await this.dbService.getDependenciesTo(validatedArgs.symbol_id);

      // Process direct dependencies and callers
      for (const dep of directDependencies) {
        if (dep.to_symbol) {
          directImpact.push({
            id: dep.to_symbol.id,
            name: dep.to_symbol.name,
            type: dep.to_symbol.symbol_type,
            file_path: dep.to_symbol.file?.path || '',
            impact_type: this.isCrossStackRelationship(dep) ? 'cross_stack' : 'direct',
            confidence: dep.confidence || 1.0,
          });

          const framework = this.determineFramework(dep.to_symbol);
          if (framework) frameworksAffected.add(framework);
        }
      }

      for (const caller of directCallers) {
        if (caller.from_symbol) {
          directImpact.push({
            id: caller.from_symbol.id,
            name: caller.from_symbol.name,
            type: caller.from_symbol.symbol_type,
            file_path: caller.from_symbol.file?.path || '',
            impact_type: this.isCrossStackRelationship(caller) ? 'cross_stack' : 'direct',
            confidence: caller.confidence || 1.0,
          });

          const framework = this.determineFramework(caller.from_symbol);
          if (framework) frameworksAffected.add(framework);
        }
      }

      // Transitive impact analysis
      const maxDepth = validatedArgs.max_depth || 5;
      const confidenceThreshold = validatedArgs.confidence_threshold || 0.7;

      try {
        const transitiveOptions = {
          maxDepth,
          includeTypes: undefined,
          confidenceThreshold,
        };

        const transitiveResult = await transitiveAnalyzer.getTransitiveDependencies(
          validatedArgs.symbol_id,
          transitiveOptions
        );

        for (const result of transitiveResult.results) {
          if (result.dependencies[0]?.to_symbol) {
            const toSymbol = result.dependencies[0].to_symbol;
            transitiveImpact.push({
              id: toSymbol.id,
              name: toSymbol.name,
              type: toSymbol.symbol_type,
              file_path: toSymbol.file?.path || '',
              impact_type: 'indirect',
              confidence: result.totalConfidence,
            });

            const framework = this.determineFramework(toSymbol);
            if (framework) frameworksAffected.add(framework);
          }
        }
      } catch (error) {
        this.logger.warn('Transitive analysis failed, continuing with direct impact only', {
          error: (error as Error).message,
        });
      }

      // Route, job, and test impact analysis
      if (validatedArgs.include_routes !== false) {
        try {
          const routes = await this.getImpactedRoutes(validatedArgs.symbol_id, frameworksAffected);
          routeImpact.push(...routes);
        } catch (error) {
          this.logger.warn('Route impact analysis failed', { error: (error as Error).message });
        }
      }

      if (validatedArgs.include_jobs !== false) {
        try {
          const jobs = await this.getImpactedJobs(validatedArgs.symbol_id);
          jobImpact.push(...jobs);
        } catch (error) {
          this.logger.warn('Job impact analysis failed', { error: (error as Error).message });
        }
      }

      if (validatedArgs.include_tests !== false) {
        try {
          const tests = await this.getImpactedTests(validatedArgs.symbol_id);
          testImpact.push(...tests);
        } catch (error) {
          this.logger.warn('Test impact analysis failed', { error: (error as Error).message });
        }
      }

      // Calculate overall confidence score
      const allImpactItems = [...directImpact, ...transitiveImpact];
      const avgConfidence = allImpactItems.length > 0
        ? allImpactItems.reduce((sum, item) => sum + item.confidence, 0) / allImpactItems.length
        : 1.0;

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
                  file_path: symbol.file?.path,
                },
                impact_analysis: {
                  direct_impact: directImpact,
                  transitive_impact: transitiveImpact,
                  test_impact: validatedArgs.include_tests !== false ? testImpact : undefined,
                  route_impact: validatedArgs.include_routes !== false ? routeImpact : undefined,
                  job_impact: validatedArgs.include_jobs !== false ? jobImpact : undefined,
                  confidence_score: avgConfidence,
                  impact_depth: maxDepth,
                  frameworks_affected: Array.from(frameworksAffected),
                },
                summary: {
                  total_direct_impact: directImpact.length,
                  total_transitive_impact: transitiveImpact.length,
                  total_route_impact: routeImpact.length,
                  total_job_impact: jobImpact.length,
                  total_test_impact: testImpact.length,
                  frameworks_affected: Array.from(frameworksAffected),
                  confidence_score: avgConfidence,
                  risk_level: this.calculateRiskLevel(directImpact, transitiveImpact, routeImpact, jobImpact),
                },
                filters: validatedArgs,
                analysis_mode: 'comprehensive',
                absorbed_tools: ['getCrossStackImpact', 'getApiCalls', 'getDataContracts'],
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Comprehensive impact analysis failed', { error: (error as Error).message });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                symbol_id: validatedArgs.symbol_id,
                error: (error as Error).message,
                filters: validatedArgs,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // Helper methods for enhanced search (absorb removed Laravel tools functionality)
  private async searchRoutes(query: string, repoIds?: number[], framework?: string): Promise<any[]> {
    const routes = [];
    const targetRepos = repoIds || [await this.getDefaultRepoId()].filter(Boolean);

    for (const repoId of targetRepos) {
      const frameworkType = framework || 'laravel';
      const repoRoutes = await this.dbService.getRoutesByFramework(repoId, frameworkType);

      const matchingRoutes = repoRoutes.filter(
        route =>
          route.path?.toLowerCase().includes(query.toLowerCase()) ||
          route.method?.toLowerCase().includes(query.toLowerCase())
      );

      routes.push(...matchingRoutes.map(route => ({
        id: route.id,
        name: route.path,
        symbol_type: 'route',
        start_line: 0,
        end_line: 0,
        is_exported: true,
        visibility: 'public',
        signature: `${route.method} ${route.path}`,
        file: {
          id: route.repo_id,
          path: route.path,
          language: route.framework_type === 'laravel' ? 'php' : 'javascript',
        },
      })));
    }

    return routes;
  }

  private async searchModels(query: string, repoIds?: number[], _framework?: string): Promise<any[]> {
    const symbols = await this.dbService.searchSymbols(query, repoIds?.[0]);

    return symbols.filter(symbol => {
      const isClass = symbol.symbol_type === 'class';
      const isInModelsDirectory = symbol.file?.path?.includes('/Models/') || symbol.file?.path?.includes('\\Models\\');
      const hasModelSignature = symbol.signature?.includes('extends Model') ||
                                symbol.signature?.includes('extends Authenticatable') ||
                                symbol.signature?.includes('extends Illuminate\\Database\\Eloquent\\Model');

      return isClass && (isInModelsDirectory || hasModelSignature);
    });
  }

  private async searchControllers(query: string, repoIds?: number[], _framework?: string): Promise<any[]> {
    const symbols = await this.dbService.searchSymbols(query, repoIds?.[0]);

    return symbols.filter(symbol => {
      const isClass = symbol.symbol_type === 'class';
      const isInControllersDirectory = symbol.file?.path?.includes('/Controllers/') || symbol.file?.path?.includes('\\Controllers\\');
      const hasControllerSignature = symbol.signature?.includes('extends Controller') ||
                                    symbol.signature?.includes('extends BaseController') ||
                                    symbol.signature?.includes('extends Illuminate\\Routing\\Controller');
      const hasControllerName = symbol.name?.toLowerCase().includes('controller');

      return isClass && (isInControllersDirectory || hasControllerSignature || hasControllerName);
    });
  }

  private async searchComponents(query: string, repoIds?: number[], framework?: string): Promise<any[]> {
    const symbols = await this.dbService.searchSymbols(query, repoIds?.[0]);

    return symbols.filter(symbol => {
      if (framework === 'vue') {
        return symbol.file?.path?.endsWith('.vue') || symbol.symbol_type === 'component';
      } else if (framework === 'react') {
        return symbol.symbol_type === 'function' && symbol.name.match(/^[A-Z]/);
      }
      return symbol.symbol_type === 'component';
    });
  }

  private async searchJobs(query: string, repoIds?: number[], _framework?: string): Promise<any[]> {
    const symbols = await this.dbService.searchSymbols(query, repoIds?.[0]);

    return symbols.filter(symbol => {
      return symbol.symbol_type === 'class' &&
             (symbol.name?.toLowerCase().includes('job') ||
              symbol.file?.path?.includes('jobs/') ||
              symbol.file?.path?.includes('Jobs/'));
    });
  }

  private getFrameworkPath(framework: string): string {
    switch (framework) {
      case 'laravel': return 'app/';
      case 'vue': return '.vue';
      case 'react': return 'components/';
      case 'node': return 'server/';
      default: return '';
    }
  }

  private determineEntityType(symbol: any): string {
    if (symbol.file?.path?.endsWith('.vue')) return 'component';
    if (symbol.symbol_type === 'function' && symbol.name?.match(/^[A-Z]/)) return 'component';
    if (symbol.symbol_type === 'class' && symbol.name?.includes('Job')) return 'job';
    return symbol.symbol_type || 'unknown';
  }

  private determineFramework(symbol: any): string {
    if (symbol.file?.path?.includes('app/') || symbol.file?.path?.endsWith('.php')) return 'laravel';
    if (symbol.file?.path?.endsWith('.vue')) return 'vue';
    if (symbol.file?.path?.includes('components/') && symbol.file?.path?.endsWith('.tsx')) return 'react';
    if (symbol.file?.path?.includes('server/') || symbol.file?.path?.includes('api/')) return 'node';
    return 'unknown';
  }

  // Helper methods for enhanced search
  private mapEntityTypeToSymbolType(entityType: string): SymbolType | null {
    switch (entityType) {
      case 'function':
        return SymbolType.FUNCTION;
      case 'class':
        return SymbolType.CLASS;
      case 'interface':
        return SymbolType.INTERFACE;
      case 'component':
        return SymbolType.COMPONENT;
      default:
        return null;
    }
  }

  private mapStringToSymbolType(symbolType: string): SymbolType | null {
    const upperCaseType = symbolType.toUpperCase() as keyof typeof SymbolType;
    return SymbolType[upperCaseType] || null;
  }

  // Helper methods for impact analysis
  private async getImpactedRoutes(symbolId: number, frameworks: Set<string>): Promise<RouteImpactItem[]> {
    const routes: RouteImpactItem[] = [];

    try {
      const repositories = await this.dbService.getAllRepositories();

      for (const repo of repositories) {
        for (const framework of frameworks) {
          if (framework === 'laravel' || framework === 'node') {
            const frameworkRoutes = await this.dbService.getRoutesByFramework(repo.id, framework);

            for (const route of frameworkRoutes) {
              if (route.handler_symbol_id) {
                const isRelated = await this.isSymbolRelated(symbolId, route.handler_symbol_id);
                if (isRelated) {
                  routes.push({
                    id: route.id,
                    path: route.path || '',
                    method: route.method || 'GET',
                    framework: route.framework_type || framework,
                    confidence: 0.8,
                  });
                }
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn('Failed to analyze route impact', { error: (error as Error).message });
    }

    return routes;
  }

  private async getImpactedJobs(symbolId: number): Promise<JobImpactItem[]> {
    const jobs: JobImpactItem[] = [];

    try {
      const jobSymbols = await this.dbService.searchSymbols('job', undefined);
      const filteredJobs = jobSymbols.filter(symbol =>
        symbol.symbol_type === 'class' &&
        (symbol.name?.toLowerCase().includes('job') ||
         symbol.file?.path?.includes('jobs/') ||
         symbol.file?.path?.includes('Jobs/'))
      );

      for (const jobSymbol of filteredJobs) {
        const isRelated = await this.isSymbolRelated(symbolId, jobSymbol.id);
        if (isRelated) {
          jobs.push({
            id: jobSymbol.id,
            name: jobSymbol.name,
            type: 'background_job',
            confidence: 0.7,
          });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to analyze job impact', { error: (error as Error).message });
    }

    return jobs;
  }

  private async getImpactedTests(symbolId: number): Promise<TestImpactItem[]> {
    const tests: TestImpactItem[] = [];

    try {
      const testSymbols = await this.dbService.searchSymbols('test', undefined);
      const filteredTests = testSymbols.filter(symbol =>
        symbol.file?.is_test ||
        symbol.file?.path?.includes('test') ||
        symbol.file?.path?.includes('Test') ||
        symbol.file?.path?.includes('spec') ||
        symbol.file?.path?.includes('.test.') ||
        symbol.file?.path?.includes('.spec.')
      );

      for (const testSymbol of filteredTests) {
        const isRelated = await this.isSymbolRelated(symbolId, testSymbol.id);
        if (isRelated) {
          tests.push({
            id: testSymbol.id,
            name: testSymbol.name,
            file_path: testSymbol.file?.path || '',
            test_type: this.determineTestType(testSymbol.file?.path || ''),
            confidence: 0.6,
          });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to analyze test impact', { error: (error as Error).message });
    }

    return tests;
  }

  private async isSymbolRelated(symbolId: number, targetSymbolId: number): Promise<boolean> {
    if (symbolId === targetSymbolId) return true;

    try {
      const dependencies = await this.dbService.getDependenciesFrom(targetSymbolId);
      const callers = await this.dbService.getDependenciesTo(targetSymbolId);

      return dependencies.some(dep => dep.to_symbol_id === symbolId) ||
             callers.some(caller => caller.from_symbol_id === symbolId);
    } catch (error) {
      return false;
    }
  }

  private determineTestType(filePath: string): string {
    if (filePath.includes('.test.') || filePath.includes('test/')) return 'unit';
    if (filePath.includes('.spec.') || filePath.includes('spec/')) return 'spec';
    if (filePath.includes('e2e') || filePath.includes('integration')) return 'integration';
    if (filePath.includes('cypress') || filePath.includes('playwright')) return 'e2e';
    return 'unknown';
  }

  private isCrossStackRelationship(result: any): boolean {
    if (!result.dependency_type) return false;

    return (
      result.dependency_type === DependencyType.API_CALL ||
      result.dependency_type === DependencyType.SHARES_SCHEMA ||
      result.dependency_type === DependencyType.FRONTEND_BACKEND
    );
  }

  private calculateRiskLevel(directImpact: ImpactItem[], transitiveImpact: ImpactItem[], routeImpact: RouteImpactItem[], jobImpact: JobImpactItem[]): string {
    const totalImpact = directImpact.length + transitiveImpact.length + routeImpact.length + jobImpact.length;

    if (totalImpact > 20) return 'critical';
    if (totalImpact > 10) return 'high';
    if (totalImpact > 5) return 'medium';
    return 'low';
  }

}