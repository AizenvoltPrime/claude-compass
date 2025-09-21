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
    const validEntityTypes = [
      'route',
      'model',
      'controller',
      'component',
      'job',
      'function',
      'class',
      'interface',
      'scene',
      'node',
      'script',
      'autoload',
    ];
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

  if (args.include_qualified !== undefined && typeof args.include_qualified !== 'boolean') {
    throw new Error('include_qualified must be a boolean');
  }

  if (args.class_context !== undefined && typeof args.class_context !== 'string') {
    throw new Error('class_context must be a string');
  }

  if (args.namespace_context !== undefined && typeof args.namespace_context !== 'string') {
    throw new Error('namespace_context must be a string');
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
  if (args.include_cross_stack !== undefined && typeof args.include_cross_stack !== 'boolean') {
    throw new Error('include_cross_stack must be a boolean');
  }
  if (args.show_call_chains !== undefined && typeof args.show_call_chains !== 'boolean') {
    throw new Error('show_call_chains must be a boolean');
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
  if (args.include_cross_stack !== undefined && typeof args.include_cross_stack !== 'boolean') {
    throw new Error('include_cross_stack must be a boolean');
  }
  if (args.show_call_chains !== undefined && typeof args.show_call_chains !== 'boolean') {
    throw new Error('show_call_chains must be a boolean');
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
  if (args.show_call_chains !== undefined && typeof args.show_call_chains !== 'boolean') {
    throw new Error('show_call_chains must be a boolean');
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
  entity_types?: string[]; // route, model, controller, component, job, etc.
  framework?: string; // laravel, vue, react, node
  use_vector?: boolean; // enable vector search (future)
  repo_ids?: number[]; // multi-repository search
  include_qualified?: boolean; // search in qualified context
  class_context?: string; // filter by class context
  namespace_context?: string; // filter by namespace context
}

export interface WhoCallsArgs {
  symbol_id: number;
  dependency_type?: string;
  include_indirect?: boolean;
  include_cross_stack?: boolean;
  show_call_chains?: boolean;
}

export interface ListDependenciesArgs {
  symbol_id: number;
  dependency_type?: string;
  include_indirect?: boolean;
  include_cross_stack?: boolean;
  show_call_chains?: boolean;
}

// Comprehensive impact analysis interface (Phase 6A)
export interface ImpactOfArgs {
  symbol_id: number;
  frameworks?: string[]; // Multi-framework impact: ['vue', 'laravel', 'react', 'node']
  include_tests?: boolean; // Test coverage impact analysis
  include_routes?: boolean; // Route impact analysis
  include_jobs?: boolean; // Background job impact analysis
  max_depth?: number; // Transitive depth (default 5)
  confidence_threshold?: number; // Filter by confidence (default 0.7)
  show_call_chains?: boolean; // Include human-readable call chains
}

export interface ImpactItem {
  id: number;
  name: string;
  type: string;
  file_path: string;
  impact_type:
    | 'direct'
    | 'indirect'
    | 'cross_stack'
    | 'interface_contract'
    | 'implementation'
    | 'delegation';
  confidence: number;
  relationship_type?: string;
  relationship_context?: string;
  // Call chain visualization fields (Enhancement 1)
  call_chain?: string;
  depth?: number;
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

    // Build search options
    const searchOptions = {
      limit: validatedArgs.limit || 100,
      confidenceThreshold: 0.7,
      symbolTypes: [],
      isExported: validatedArgs.is_exported,
      framework: validatedArgs.framework,
      repoIds: repoIds.length > 0 ? repoIds : repoId ? [repoId] : [],
    };

    let symbols = [];

    // Enhanced framework-aware search (absorbs removed Laravel tools functionality)
    if (validatedArgs.entity_types) {
      for (const entityType of validatedArgs.entity_types) {
        switch (entityType) {
          case 'route':
            symbols.push(
              ...(await this.searchRoutes(validatedArgs.query, repoIds, validatedArgs.framework))
            );
            break;
          case 'model':
            symbols.push(
              ...(await this.searchModels(validatedArgs.query, repoIds, validatedArgs.framework))
            );
            break;
          case 'controller':
            symbols.push(
              ...(await this.searchControllers(
                validatedArgs.query,
                repoIds,
                validatedArgs.framework
              ))
            );
            break;
          case 'component':
            symbols.push(
              ...(await this.searchComponents(
                validatedArgs.query,
                repoIds,
                validatedArgs.framework
              ))
            );
            break;
          case 'job':
            symbols.push(
              ...(await this.searchJobs(validatedArgs.query, repoIds, validatedArgs.framework))
            );
            break;
          case 'scene':
            symbols.push(...(await this.searchGodotScenes(validatedArgs.query, repoIds)));
            break;
          case 'node':
            symbols.push(...(await this.searchGodotNodes(validatedArgs.query, repoIds)));
            break;
          case 'script':
            // For Godot framework, search Godot scripts, otherwise search generic scripts
            if (validatedArgs.framework === 'godot') {
              symbols.push(...(await this.searchGodotScripts(validatedArgs.query, repoIds)));
            } else {
              // Fall through to default case for non-Godot scripts
              const symbolType = this.mapEntityTypeToSymbolType(entityType);
              if (symbolType) {
                searchOptions.symbolTypes = [symbolType];
              }
              let standardSymbols;
              if (validatedArgs.use_vector === true) {
                standardSymbols = await this.dbService.vectorSearchSymbols(
                  validatedArgs.query,
                  repoId,
                  searchOptions
                );
              } else {
                standardSymbols = await this.dbService.searchSymbols(
                  validatedArgs.query,
                  repoId,
                  searchOptions
                );
              }
              symbols.push(...standardSymbols);
            }
            break;
          case 'autoload':
            symbols.push(...(await this.searchGodotAutoloads(validatedArgs.query, repoIds)));
            break;
          default:
            // Use enhanced search for standard symbol types
            const symbolType = this.mapEntityTypeToSymbolType(entityType);
            if (symbolType) {
              searchOptions.symbolTypes = [symbolType];

              // For C# projects, when searching for "function", also include "method"
              // since C# class methods are stored as "method" type, not "function" type
              if (entityType.toLowerCase() === 'function') {
                searchOptions.symbolTypes = [SymbolType.FUNCTION, SymbolType.METHOD];
              }
            }
            // Choose search method based on use_vector parameter
            let standardSymbols: SymbolWithFile[];
            if (validatedArgs.use_vector === true) {
              try {
                standardSymbols = await this.dbService.vectorSearchSymbols(
                  validatedArgs.query,
                  repoId,
                  { ...searchOptions, similarityThreshold: 0.7 }
                );
              } catch (error) {
                this.logger.warn('Vector search failed, falling back to fulltext:', error);
                standardSymbols = await this.dbService.fulltextSearchSymbols(
                  validatedArgs.query,
                  repoId,
                  searchOptions
                );
              }
            } else if (validatedArgs.use_vector === false) {
              standardSymbols = await this.dbService.lexicalSearchSymbols(
                validatedArgs.query,
                repoId,
                searchOptions
              );
            } else {
              // Default to fulltext search
              standardSymbols = await this.dbService.fulltextSearchSymbols(
                validatedArgs.query,
                repoId,
                searchOptions
              );
            }
            symbols.push(...standardSymbols);
        }
      }
    } else {
      // Enhanced search when no entity types specified - use full search capabilities
      if (validatedArgs.symbol_type) {
        const symbolType = this.mapStringToSymbolType(validatedArgs.symbol_type);
        if (symbolType) {
          searchOptions.symbolTypes = [symbolType];

          // For C# projects, when searching for "function", also include "method"
          // since C# class methods are stored as "method" type, not "function" type
          if (validatedArgs.symbol_type.toLowerCase() === 'function') {
            searchOptions.symbolTypes = [SymbolType.FUNCTION, SymbolType.METHOD];
          }
        }
      }

      // Choose search method based on use_vector parameter
      if (validatedArgs.use_vector === true) {
        try {
          symbols = await this.dbService.vectorSearchSymbols(validatedArgs.query, repoId, {
            ...searchOptions,
            similarityThreshold: 0.7,
          });
        } catch (error) {
          this.logger.warn('Vector search failed, falling back to fulltext:', error);
          symbols = await this.dbService.fulltextSearchSymbols(
            validatedArgs.query,
            repoId,
            searchOptions
          );
        }
      } else if (validatedArgs.use_vector === false) {
        symbols = await this.dbService.lexicalSearchSymbols(
          validatedArgs.query,
          repoId,
          searchOptions
        );
      } else {
        // Default to fulltext search
        symbols = await this.dbService.fulltextSearchSymbols(
          validatedArgs.query,
          repoId,
          searchOptions
        );
      }
    }

    if (
      validatedArgs.include_qualified === true ||
      validatedArgs.class_context ||
      validatedArgs.namespace_context
    ) {
      this.logger.debug('Performing enhanced search with qualified context', {
        include_qualified: validatedArgs.include_qualified,
        class_context: validatedArgs.class_context,
        namespace_context: validatedArgs.namespace_context,
      });

      try {
        // Search both unqualified names and qualified context in parallel
        const enhancedSearchPromises = [];

        // Add qualified context search
        if (validatedArgs.include_qualified === true) {
          enhancedSearchPromises.push(
            this.dbService.searchQualifiedContext(validatedArgs.query, validatedArgs.class_context)
          );
        }

        // Add method signature search
        if (validatedArgs.include_qualified === true) {
          enhancedSearchPromises.push(this.dbService.searchMethodSignatures(validatedArgs.query));
        }

        // Add namespace context search
        if (validatedArgs.namespace_context) {
          enhancedSearchPromises.push(
            this.dbService.searchNamespaceContext(
              validatedArgs.query,
              validatedArgs.namespace_context
            )
          );
        }

        // Execute enhanced searches in parallel
        const enhancedResults = await Promise.all(enhancedSearchPromises);

        // Merge and rank results
        const mergedEnhancedResults = this.mergeAndRankResults(enhancedResults, validatedArgs);

        // Combine with existing symbols, giving priority to enhanced results
        const enhancedSymbolIds = new Set(mergedEnhancedResults.map(s => s.id));
        const filteredExistingSymbols = symbols.filter(s => !enhancedSymbolIds.has(s.id));

        symbols = [...mergedEnhancedResults, ...filteredExistingSymbols];

        this.logger.debug('Enhanced search completed', {
          enhanced_results: mergedEnhancedResults.length,
          total_results: symbols.length,
        });
      } catch (error) {
        this.logger.warn(
          'Enhanced search with qualified context failed, continuing with standard results:',
          error
        );
      }
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
            return (
              fileLanguage === 'javascript' ||
              fileLanguage === 'typescript' ||
              s.file?.path?.includes('components/')
            );
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
                include_qualified: validatedArgs.include_qualified,
                class_context: validatedArgs.class_context,
                namespace_context: validatedArgs.namespace_context,
              },
              search_options: {
                entity_types: validatedArgs.entity_types,
                framework: validatedArgs.framework,
                symbol_type: validatedArgs.symbol_type,
                is_exported: validatedArgs.is_exported,
                repo_ids: repoIds,
                use_vector: validatedArgs.use_vector,
                include_qualified: validatedArgs.include_qualified,
                class_context: validatedArgs.class_context,
                namespace_context: validatedArgs.namespace_context,
              },
              search_mode: 'enhanced_framework_aware',
              absorbed_tools: [
                'getLaravelRoutes',
                'getEloquentModels',
                'getLaravelControllers',
                'searchLaravelEntities',
              ],
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Core Tool 4: whoCalls
  async whoCalls(args: any) {
    const validatedArgs = validateWhoCallsArgs(args);
    this.logger.debug('Finding who calls symbol with enhanced context', validatedArgs);

    const timeoutMs = 10000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('whoCalls operation timed out after 10 seconds')), timeoutMs);
    });

    try {
      const symbol = await Promise.race([
        this.dbService.getSymbol(validatedArgs.symbol_id),
        timeoutPromise
      ]) as any;
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      let callers = await Promise.race([
        this.dbService.getDependenciesToWithContext(validatedArgs.symbol_id),
        timeoutPromise
      ]) as any;

      if (validatedArgs.dependency_type) {
        const depType = validatedArgs.dependency_type as DependencyType;
        callers = callers.filter(caller => caller.dependency_type === depType);
      }

    let transitiveResults: any[] = [];
    const skipTransitive = callers.length > 20 || validatedArgs.include_cross_stack;

    if ((validatedArgs.include_indirect || validatedArgs.show_call_chains) && !skipTransitive) {

      try {
        const transitiveOptions: TransitiveAnalysisOptions = {
          maxDepth: 2,
          includeTypes: validatedArgs.dependency_type
            ? [validatedArgs.dependency_type as DependencyType]
            : undefined,
          confidenceThreshold: 0.5,
          includeCrossStack: false,
          showCallChains: validatedArgs.show_call_chains || false,
        };

        const transitiveResult = await transitiveAnalyzer.getTransitiveCallers(
          validatedArgs.symbol_id,
          transitiveOptions
        );

        transitiveResults = transitiveResult.results;

        if (validatedArgs.include_indirect) {
          const transitiveDependencies = transitiveResult.results
            .map(result => {
              const fromSymbol = result.dependencies[0]?.from_symbol;
              if (!fromSymbol) return null;

              return {
                id: result.symbolId,
                from_symbol_id: result.symbolId,
                to_symbol_id: validatedArgs.symbol_id,
                dependency_type: result.dependencies[0]?.dependency_type || DependencyType.CALLS,
                line_number: result.dependencies[0]?.line_number,
                confidence: result.totalConfidence,
                created_at: new Date(),
                updated_at: new Date(),
                from_symbol: fromSymbol,
                to_symbol: undefined,
                call_chain: result.call_chain,
                path: result.path,
                depth: result.depth,
              };
            })
            .filter(Boolean);

          callers = [...callers, ...transitiveDependencies];
        }
      } catch (error) {
        this.logger.error('Enhanced transitive caller analysis failed', {
          symbol_id: validatedArgs.symbol_id,
          error: (error as Error).message,
        });
      }
    }

    const result = {
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
                calling_object: caller.calling_object,
                resolved_class: caller.resolved_class,
                qualified_context: caller.qualified_context,
                method_signature: caller.method_signature,
                file_context: caller.file_context,
                namespace_context: caller.namespace_context,
                call_chain: caller.call_chain,
                path: caller.path,
                depth: caller.depth,
                call_pattern: this.analyzeCallPattern(caller),
                cross_file: this.isCrossFileCall(caller, symbol),
              })),
              transitive_analysis: validatedArgs.show_call_chains ? {
                total_paths: transitiveResults.length,
                call_chains: transitiveResults.map(result => ({
                  symbol_id: result.symbolId,
                  call_chain: result.call_chain,
                  depth: result.depth,
                  confidence: result.totalConfidence,
                }))
              } : undefined,
              parameter_analysis: callers.length < 50 ? await this.getParameterContextAnalysis(validatedArgs.symbol_id) : undefined,
              total_callers: callers.length,
              filters: {
                dependency_type: validatedArgs.dependency_type,
                include_indirect: validatedArgs.include_indirect,
                include_cross_stack: validatedArgs.include_cross_stack,
                show_call_chains: validatedArgs.show_call_chains,
              },
            },
            null,
            2
          ),
        },
      ],
    };

      return result;
    } catch (error) {
      this.logger.error('whoCalls operation failed', {
        error: (error as Error).message,
        symbolId: validatedArgs.symbol_id
      });

      // Return a minimal error response
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: (error as Error).message,
            symbol_id: validatedArgs.symbol_id
          }, null, 2)
        }]
      };
    }
  }

  // Core Tool 5: listDependencies (unchanged)
  async listDependencies(args: any) {
    const validatedArgs = validateListDependenciesArgs(args);
    this.logger.debug('Listing dependencies for symbol', validatedArgs);

    const timeoutMs = 10000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('listDependencies operation timed out after 10 seconds')), timeoutMs);
    });

    try {
      const symbol = await Promise.race([
        this.dbService.getSymbol(validatedArgs.symbol_id),
        timeoutPromise
      ]) as any;
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      let dependencies = await Promise.race([
        this.dbService.getDependenciesFrom(validatedArgs.symbol_id),
        timeoutPromise
      ]) as any;

    // Filter by dependency type if specified
    if (validatedArgs.dependency_type) {
      const depType = validatedArgs.dependency_type as DependencyType;
      dependencies = dependencies.filter(dep => dep.dependency_type === depType);
    }

    let transitiveResults: any[] = [];
    const skipTransitive = dependencies.length > 20 || validatedArgs.include_cross_stack;

    if ((validatedArgs.include_indirect || validatedArgs.show_call_chains) && !skipTransitive) {
      try {
        const transitiveOptions: TransitiveAnalysisOptions = {
          maxDepth: 2,
          includeTypes: validatedArgs.dependency_type
            ? [validatedArgs.dependency_type as DependencyType]
            : undefined,
          confidenceThreshold: 0.5,
          includeCrossStack: false,
          showCallChains: validatedArgs.show_call_chains || false,
        };

        const transitiveResult = await Promise.race([
          transitiveAnalyzer.getTransitiveDependencies(
            validatedArgs.symbol_id,
            transitiveOptions
          ),
          timeoutPromise
        ]) as any;

        transitiveResults = transitiveResult.results;

        // If include_indirect is true, merge transitive results with direct dependencies
        if (validatedArgs.include_indirect) {
          const transitiveDependencies = transitiveResult.results
            .map(result => {
              const toSymbol = result.dependencies[0]?.to_symbol;
              if (!toSymbol) return null;

              return {
                id: result.symbolId,
                from_symbol_id: validatedArgs.symbol_id,
                to_symbol_id: result.symbolId,
                dependency_type: result.dependencies[0]?.dependency_type || DependencyType.CALLS,
                line_number: result.dependencies[0]?.line_number,
                confidence: result.totalConfidence,
                created_at: new Date(),
                updated_at: new Date(),
                from_symbol: undefined,
                to_symbol: toSymbol,
                // Enhanced context from TransitiveAnalyzer
                call_chain: result.call_chain,
                path: result.path,
                depth: result.depth,
              };
            })
            .filter(Boolean);

          dependencies = [...dependencies, ...transitiveDependencies];
        }
      } catch (error) {
        this.logger.error('Enhanced transitive dependency analysis failed', {
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
                // New call chain visualization
                call_chain: dep.call_chain,
                path: dep.path,
                depth: dep.depth,
              })),
              // Enhanced transitive analysis results
              transitive_analysis: validatedArgs.show_call_chains ? {
                total_paths: transitiveResults.length,
                call_chains: transitiveResults.map(result => ({
                  symbol_id: result.symbolId,
                  call_chain: result.call_chain,
                  depth: result.depth,
                  confidence: result.totalConfidence,
                }))
              } : undefined,
              total_dependencies: dependencies.length,
              filters: {
                dependency_type: validatedArgs.dependency_type,
                include_indirect: validatedArgs.include_indirect,
                include_cross_stack: validatedArgs.include_cross_stack,
                show_call_chains: validatedArgs.show_call_chains,
              },
            },
            null,
            2
          ),
        },
      ],
    };
    } catch (error) {
      this.logger.error('listDependencies operation failed', {
        error: (error as Error).message,
        symbolId: validatedArgs.symbol_id
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: (error as Error).message,
            symbol_id: validatedArgs.symbol_id
          }, null, 2)
        }]
      };
    }
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
            impact_type: this.classifyRelationshipImpact(dep, 'dependency'),
            confidence: dep.confidence || 1.0,
            relationship_type: dep.dependency_type || 'unknown',
            relationship_context: this.getRelationshipContext(dep),
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
            impact_type: this.classifyRelationshipImpact(caller, 'caller'),
            confidence: caller.confidence || 1.0,
            relationship_type: caller.dependency_type || 'unknown',
            relationship_context: this.getRelationshipContext(caller),
          });

          const framework = this.determineFramework(caller.from_symbol);
          if (framework) frameworksAffected.add(framework);
        }
      }

      // Transitive impact analysis
      const maxDepth = validatedArgs.max_depth || 5;
      const confidenceThreshold = validatedArgs.confidence_threshold || 0.7;

      try {
        const transitiveOptions: TransitiveAnalysisOptions = {
          maxDepth,
          includeTypes: undefined,
          confidenceThreshold,
          showCallChains: validatedArgs.show_call_chains || false,
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
              call_chain: result.call_chain,
              depth: result.depth,
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

      // Deduplicate impact items to eliminate overlapping analysis results
      const deduplicatedDirectImpact = this.deduplicateImpactItems(directImpact);
      const deduplicatedTransitiveImpact = this.deduplicateImpactItems(
        transitiveImpact.filter(
          item => !deduplicatedDirectImpact.some(directItem => directItem.id === item.id)
        )
      );

      // Calculate overall confidence score using deduplicated data
      const allImpactItems = [...deduplicatedDirectImpact, ...deduplicatedTransitiveImpact];
      const avgConfidence =
        allImpactItems.length > 0
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
                  direct_impact: deduplicatedDirectImpact,
                  transitive_impact: deduplicatedTransitiveImpact,
                  test_impact: validatedArgs.include_tests !== false ? testImpact : undefined,
                  route_impact: validatedArgs.include_routes !== false ? routeImpact : undefined,
                  job_impact: validatedArgs.include_jobs !== false ? jobImpact : undefined,
                  confidence_score: avgConfidence,
                  impact_depth: maxDepth,
                  frameworks_affected: Array.from(frameworksAffected),
                },
                summary: {
                  total_direct_impact: deduplicatedDirectImpact.length,
                  total_transitive_impact: deduplicatedTransitiveImpact.length,
                  total_route_impact: routeImpact.length,
                  total_job_impact: jobImpact.length,
                  total_test_impact: testImpact.length,
                  frameworks_affected: Array.from(frameworksAffected),
                  confidence_score: avgConfidence,
                  risk_level: this.calculateRiskLevel(
                    directImpact,
                    transitiveImpact,
                    routeImpact,
                    jobImpact
                  ),
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
      this.logger.error('Comprehensive impact analysis failed', {
        error: (error as Error).message,
      });
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
  private async searchRoutes(
    query: string,
    repoIds?: number[],
    framework?: string
  ): Promise<any[]> {
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

      routes.push(
        ...matchingRoutes.map(route => ({
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
        }))
      );
    }

    return routes;
  }

  private async searchModels(
    query: string,
    repoIds?: number[],
    _framework?: string
  ): Promise<any[]> {
    const symbols = await this.dbService.searchSymbols(query, repoIds?.[0]);

    return symbols.filter(symbol => {
      const isClass = symbol.symbol_type === 'class';
      const path = symbol.file?.path || '';
      const signature = symbol.signature || '';
      const name = symbol.name || '';

      // Enhanced path matching that works with various directory structures
      const isInModelsDirectory =
        path.includes('/Models/') ||
        path.includes('\\Models\\') ||
        path.includes('/models/') ||
        path.includes('\\models\\') ||
        /[\/\\][Mm]odels[\/\\]/.test(path) ||
        // Additional patterns for edge cases
        path.endsWith('/Models') ||
        path.endsWith('\\Models') ||
        path.endsWith('/models') ||
        path.endsWith('\\models') ||
        /\/app\/[^\/]*Models\//i.test(path);

      // Enhanced signature matching for Laravel models
      const hasModelSignature =
        signature.includes('extends Model') ||
        signature.includes('extends Authenticatable') ||
        signature.includes('extends Illuminate\\Database\\Eloquent\\Model') ||
        signature.includes('extends \\Illuminate\\Database\\Eloquent\\Model') ||
        signature.includes('use Illuminate\\Database\\Eloquent\\Model') ||
        // Check for common Laravel model traits
        signature.includes('use Authenticatable') ||
        signature.includes('use SoftDeletes');

      // Name-based detection for models
      const hasModelName =
        name.endsWith('Model') || (isClass && /^[A-Z][a-zA-Z]*$/.test(name) && isInModelsDirectory);

      return isClass && (isInModelsDirectory || hasModelSignature || hasModelName);
    });
  }

  private async searchControllers(
    query: string,
    repoIds?: number[],
    _framework?: string
  ): Promise<any[]> {
    const symbols = await this.dbService.searchSymbols(query, repoIds?.[0]);

    return symbols.filter(symbol => {
      const isClass = symbol.symbol_type === 'class' || symbol.symbol_type === 'method';
      const path = symbol.file?.path || '';
      const signature = symbol.signature || '';
      const name = symbol.name || '';

      // Enhanced path matching for controllers
      const isInControllersDirectory =
        path.includes('/Controllers/') ||
        path.includes('\\Controllers\\') ||
        path.includes('/controllers/') ||
        path.includes('\\controllers\\') ||
        /[\/\\][Cc]ontrollers[\/\\]/.test(path) ||
        // Additional patterns for Laravel structure
        path.includes('/Http/Controllers/') ||
        path.includes('\\Http\\Controllers\\') ||
        /\/app\/Http\/Controllers\//i.test(path) ||
        path.endsWith('/Controllers') ||
        path.endsWith('\\Controllers') ||
        path.endsWith('/controllers') ||
        path.endsWith('\\controllers');

      // Enhanced signature matching for Laravel controllers
      const hasControllerSignature =
        signature.includes('extends Controller') ||
        signature.includes('extends BaseController') ||
        signature.includes('extends Illuminate\\Routing\\Controller') ||
        signature.includes('extends \\Illuminate\\Routing\\Controller') ||
        signature.includes('use Illuminate\\Routing\\Controller') ||
        signature.includes('use Controller') ||
        // Check for common Laravel controller patterns
        signature.includes('use AuthorizesRequests') ||
        signature.includes('use DispatchesJobs') ||
        signature.includes('use ValidatesRequests');

      // Name-based detection for controllers
      const hasControllerName =
        name.toLowerCase().includes('controller') ||
        name.endsWith('Controller') ||
        (isClass && /Controller$/.test(name));

      // For controller methods, check if the parent class is a controller
      const isControllerMethod = symbol.symbol_type === 'method' && isInControllersDirectory;

      return (
        (isClass && (isInControllersDirectory || hasControllerSignature || hasControllerName)) ||
        isControllerMethod
      );
    });
  }

  private async searchComponents(
    query: string,
    repoIds?: number[],
    framework?: string
  ): Promise<any[]> {
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
      const isClass = symbol.symbol_type === 'class';
      const path = symbol.file?.path || '';
      const signature = symbol.signature || '';
      const name = symbol.name || '';

      // Enhanced path matching for jobs
      const isInJobsDirectory =
        path.includes('/jobs/') ||
        path.includes('\\jobs\\') ||
        path.includes('/Jobs/') ||
        path.includes('\\Jobs\\') ||
        /[\/\\][Jj]obs[\/\\]/.test(path) ||
        // Additional patterns for Laravel job structure
        /\/app\/Jobs\//i.test(path) ||
        path.endsWith('/Jobs') ||
        path.endsWith('\\Jobs') ||
        path.endsWith('/jobs') ||
        path.endsWith('\\jobs');

      // Enhanced signature matching for Laravel jobs
      const hasJobSignature =
        signature.includes('implements ShouldQueue') ||
        signature.includes('implements \\ShouldQueue') ||
        signature.includes('implements Illuminate\\Contracts\\Queue\\ShouldQueue') ||
        signature.includes('use ShouldQueue') ||
        signature.includes('use Illuminate\\Contracts\\Queue\\ShouldQueue') ||
        signature.includes('use Dispatchable') ||
        signature.includes('use InteractsWithQueue') ||
        signature.includes('use Queueable') ||
        signature.includes('use SerializesModels');

      // Name-based detection for jobs
      const hasJobName =
        name.toLowerCase().includes('job') ||
        name.endsWith('Job') ||
        /Job$/.test(name) ||
        // Common job naming patterns
        /Process[A-Z]/.test(name) ||
        /Send[A-Z]/.test(name) ||
        /Handle[A-Z]/.test(name) ||
        /Execute[A-Z]/.test(name);

      return isClass && (isInJobsDirectory || hasJobSignature || hasJobName);
    });
  }

  // Godot-specific search methods
  private async searchGodotScenes(query: string, repoIds?: number[]): Promise<any[]> {
    try {
      const results = [];
      for (const repoId of repoIds || [await this.getDefaultRepoId()].filter(Boolean)) {
        const scenes = await this.dbService.getGodotScenesByRepository(repoId);
        const filteredScenes = scenes.filter(
          scene =>
            scene.scene_name.toLowerCase().includes(query.toLowerCase()) ||
            scene.scene_path.toLowerCase().includes(query.toLowerCase())
        );

        results.push(
          ...filteredScenes.map(scene => ({
            id: scene.id,
            name: scene.scene_name,
            file: { path: scene.scene_path },
            framework: 'godot',
            entity_type: 'scene',
            symbol_type: 'scene',
            metadata: {
              node_count: scene.node_count,
              has_script: scene.has_script,
              ...scene.metadata,
            },
          }))
        );
      }
      return results;
    } catch (error) {
      this.logger.error('Failed to search Godot scenes', { error: error.message });
      return [];
    }
  }

  private async searchGodotNodes(query: string, repoIds?: number[]): Promise<any[]> {
    try {
      const results = [];
      for (const repoId of repoIds || [await this.getDefaultRepoId()].filter(Boolean)) {
        const scenes = await this.dbService.getGodotScenesByRepository(repoId);
        for (const scene of scenes) {
          const nodes = await this.dbService.getGodotNodesByScene(scene.id);
          const filteredNodes = nodes.filter(
            node =>
              node.node_name.toLowerCase().includes(query.toLowerCase()) ||
              node.node_type.toLowerCase().includes(query.toLowerCase())
          );

          results.push(
            ...filteredNodes.map(node => ({
              id: node.id,
              name: node.node_name,
              file: { path: `scene:${node.scene_id}` }, // Reference to scene
              framework: 'godot',
              entity_type: 'node',
              symbol_type: 'node',
              metadata: {
                node_type: node.node_type,
                script_path: node.script_path,
                properties: node.properties,
              },
            }))
          );
        }
      }
      return results;
    } catch (error) {
      this.logger.error('Failed to search Godot nodes', { error: error.message });
      return [];
    }
  }

  private async searchGodotScripts(query: string, repoIds?: number[]): Promise<any[]> {
    try {
      const results = [];
      for (const repoId of repoIds || [await this.getDefaultRepoId()].filter(Boolean)) {
        const scripts = await this.dbService.getGodotScriptsByRepository(repoId);
        const filteredScripts = scripts.filter(
          script =>
            script.class_name.toLowerCase().includes(query.toLowerCase()) ||
            script.script_path.toLowerCase().includes(query.toLowerCase()) ||
            (script.base_class && script.base_class.toLowerCase().includes(query.toLowerCase()))
        );

        results.push(
          ...filteredScripts.map(script => ({
            id: script.id,
            name: script.class_name,
            file: { path: script.script_path },
            framework: 'godot',
            entity_type: 'script',
            symbol_type: 'class',
            metadata: {
              base_class: script.base_class,
              is_autoload: script.is_autoload,
              signals: script.signals,
              exports: script.exports,
              ...script.metadata,
            },
          }))
        );
      }
      return results;
    } catch (error) {
      this.logger.error('Failed to search Godot scripts', { error: error.message });
      return [];
    }
  }

  private async searchGodotAutoloads(query: string, repoIds?: number[]): Promise<any[]> {
    try {
      const results = [];
      for (const repoId of repoIds || [await this.getDefaultRepoId()].filter(Boolean)) {
        const autoloads = await this.dbService.getGodotAutoloadsByRepository(repoId);
        const filteredAutoloads = autoloads.filter(
          autoload =>
            autoload.autoload_name.toLowerCase().includes(query.toLowerCase()) ||
            autoload.script_path.toLowerCase().includes(query.toLowerCase())
        );

        results.push(
          ...filteredAutoloads.map(autoload => ({
            id: autoload.id,
            name: autoload.autoload_name,
            file: { path: autoload.script_path },
            framework: 'godot',
            entity_type: 'autoload',
            symbol_type: 'autoload',
            metadata: {
              script_path: autoload.script_path,
              script_id: autoload.script_id,
              ...autoload.metadata,
            },
          }))
        );
      }
      return results;
    } catch (error) {
      this.logger.error('Failed to search Godot autoloads', { error: error.message });
      return [];
    }
  }

  private getFrameworkPath(framework: string): string {
    switch (framework) {
      case 'laravel':
        return 'app/';
      case 'vue':
        return '.vue';
      case 'react':
        return 'components/';
      case 'node':
        return 'server/';
      case 'godot':
        return 'scenes/';
      default:
        return '';
    }
  }

  private determineEntityType(symbol: any): string {
    if (symbol.file?.path?.endsWith('.vue')) return 'component';
    if (symbol.symbol_type === 'function' && symbol.name?.match(/^[A-Z]/)) return 'component';
    if (symbol.symbol_type === 'class' && symbol.name?.includes('Job')) return 'job';
    return symbol.symbol_type || 'unknown';
  }

  private determineFramework(symbol: any): string {
    const filePath = symbol.file?.path || '';

    // Laravel detection
    if (filePath.includes('app/') || filePath.endsWith('.php')) return 'laravel';

    // Vue.js detection
    if (filePath.endsWith('.vue')) return 'vue';

    // React detection
    if (filePath.includes('components/') && filePath.endsWith('.tsx')) return 'react';

    // Node.js detection
    if (filePath.includes('server/') || filePath.includes('api/')) return 'node';

    // Enhanced Godot detection
    if (this.isGodotFile(filePath)) return 'godot';

    return 'unknown';
  }

  /**
   * Enhanced Godot framework detection
   * Recognizes various Godot project patterns and structures
   */
  private isGodotFile(filePath: string): boolean {
    // Direct Godot file types
    if (filePath.endsWith('.tscn') || filePath.endsWith('.godot') || filePath.endsWith('.tres')) {
      return true;
    }

    // GDScript files
    if (filePath.endsWith('.gd')) {
      return true;
    }

    // C# files in Godot project structures
    if (filePath.endsWith('.cs')) {
      // Common Godot C# directory patterns
      const godotDirectoryPatterns = [
        'scripts/', // Common Godot scripts directory
        'scenes/', // Godot scenes directory
        'addons/', // Godot addons directory
        'autoload/', // Autoload scripts
        'autoloads/', // Alternative autoload naming
        'core/', // Core game systems
        'gameplay/', // Gameplay-specific scripts
        'ui/', // UI components
        'managers/', // Game managers
        'controllers/', // Game controllers
        'services/', // Game services
        'components/', // Game components
        'systems/', // Game systems
        'entities/', // Game entities
        'data/', // Game data structures
        'events/', // Event systems
        'interfaces/', // Interfaces directory
        'coordinators/', // Coordinator pattern
        'phases/', // Game phases
        'handlers/', // Event/phase handlers
      ];

      // Check if the file path contains any Godot-specific directory patterns
      if (godotDirectoryPatterns.some(pattern => filePath.includes(pattern))) {
        return true;
      }

      // Check for Godot-specific C# class patterns in the file path or symbol name
      const godotClassPatterns = [
        'Node', // Godot Node base class
        'Node2D', // 2D Node
        'Node3D', // 3D Node
        'Control', // UI Control
        'RigidBody', // Physics body
        'CharacterBody', // Character controller
        'StaticBody', // Static physics body
        'Area', // Area/trigger
        'CollisionShape', // Collision shapes
        'MeshInstance', // 3D mesh
        'Sprite', // 2D sprite
        'AnimationPlayer', // Animation system
        'AudioStreamPlayer', // Audio system
        'Camera', // Camera nodes
        'SceneTree', // Scene tree
        'PackedScene', // Scene resources
        'Resource', // Godot resources
        'Singleton', // Autoload singletons
      ];

      // Check if the file path suggests Godot usage
      if (
        godotClassPatterns.some(pattern => filePath.toLowerCase().includes(pattern.toLowerCase()))
      ) {
        return true;
      }
    }

    // Check for project.godot in parent directories (indicates Godot project root)
    const pathParts = filePath.split('/');
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const currentPath = pathParts.slice(0, i).join('/');
      // This is a simple heuristic - in a real implementation, we might cache this check
      if (currentPath && (filePath.includes('project_card_game') || filePath.includes('godot'))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Deduplicate impact items by symbol ID, keeping the highest confidence score
   * This prevents the same symbol from being counted multiple times when it appears
   * in multiple analysis paths (e.g., both as direct dependency and direct caller)
   */
  private deduplicateImpactItems(items: ImpactItem[]): ImpactItem[] {
    const uniqueItems = new Map<number, ImpactItem>();

    for (const item of items) {
      const existingItem = uniqueItems.get(item.id);

      if (!existingItem) {
        // First occurrence of this symbol
        uniqueItems.set(item.id, item);
      } else {
        // Symbol already exists, keep the one with higher confidence
        // or if confidence is equal, prefer more specific impact types
        const shouldReplace = this.shouldReplaceImpactItem(existingItem, item);
        if (shouldReplace) {
          uniqueItems.set(item.id, item);
        }
      }
    }

    return Array.from(uniqueItems.values());
  }

  /**
   * Classify the impact type based on relationship type and context
   * Provides more granular classification than just cross_stack vs direct
   */
  private classifyRelationshipImpact(
    dependency: any,
    direction: 'dependency' | 'caller'
  ):
    | 'direct'
    | 'indirect'
    | 'cross_stack'
    | 'interface_contract'
    | 'implementation'
    | 'delegation' {
    const depType = dependency.dependency_type;

    // Check for cross-stack relationships first
    if (this.isCrossStackRelationship(dependency)) {
      return 'cross_stack';
    }

    // Classify based on dependency type
    switch (depType) {
      case 'implements':
        return 'interface_contract';

      case 'inherits':
        return 'implementation';

      case 'calls':
        // Check if this is a delegation pattern (calling through service/manager)
        if (this.isDelegationPattern(dependency)) {
          return 'delegation';
        }
        return 'direct';

      case 'references':
        // Property/field references are typically direct impact
        return 'direct';

      case 'imports':
        // Import dependencies are typically infrastructure
        return 'direct';

      default:
        return 'direct';
    }
  }

  /**
   * Get additional context about the relationship
   */
  private getRelationshipContext(dependency: any): string {
    const depType = dependency.dependency_type;
    const fromSymbol = dependency.from_symbol;
    const toSymbol = dependency.to_symbol;

    const contextParts: string[] = [];

    // Add direction context
    if (fromSymbol && toSymbol) {
      contextParts.push(`${fromSymbol.name} ${depType} ${toSymbol.name}`);
    }

    // Add file context if cross-file
    if (
      fromSymbol?.file?.path &&
      toSymbol?.file?.path &&
      fromSymbol.file.path !== toSymbol.file.path
    ) {
      contextParts.push('cross-file');
    }

    // Add specific patterns
    switch (depType) {
      case 'implements':
        contextParts.push('interface_implementation');
        break;
      case 'inherits':
        contextParts.push('class_inheritance');
        break;
      case 'calls':
        if (this.isDelegationPattern(dependency)) {
          contextParts.push('service_delegation');
        }
        break;
    }

    return contextParts.join(', ');
  }

  /**
   * Detect delegation patterns (e.g., service calls, manager patterns)
   */
  private isDelegationPattern(dependency: any): boolean {
    const fromSymbol = dependency.from_symbol;
    const toSymbol = dependency.to_symbol;

    if (!fromSymbol || !toSymbol) return false;

    // Check for common delegation patterns
    const delegationPatterns = [
      'Service',
      'Manager',
      'Handler',
      'Controller',
      'Repository',
      'Factory',
      'Provider',
      'Gateway',
      'Adapter',
      'Coordinator',
    ];

    const fromName = fromSymbol.name || '';
    const toName = toSymbol.name || '';
    const fromFile = fromSymbol.file?.path || '';
    const toFile = toSymbol.file?.path || '';

    // Check if calling from/to service-like classes
    const isFromService = delegationPatterns.some(
      pattern => fromName.includes(pattern) || fromFile.includes(pattern.toLowerCase())
    );

    const isToService = delegationPatterns.some(
      pattern => toName.includes(pattern) || toFile.includes(pattern.toLowerCase())
    );

    return isFromService || isToService;
  }

  /**
   * Determines whether to replace an existing impact item with a new one
   * Prioritizes by confidence score, then by impact type specificity
   */
  private shouldReplaceImpactItem(existing: ImpactItem, candidate: ImpactItem): boolean {
    // Priority 1: Higher confidence score
    if (candidate.confidence > existing.confidence) {
      return true;
    }

    if (candidate.confidence < existing.confidence) {
      return false;
    }

    // Priority 2: More specific impact type (when confidence is equal)
    // Priority order: direct > delegation > interface_contract > implementation > cross_stack > indirect
    const impactTypePriority = {
      direct: 6,
      delegation: 5,
      interface_contract: 4,
      implementation: 3,
      cross_stack: 2,
      indirect: 1,
    };

    const existingPriority =
      impactTypePriority[existing.impact_type as keyof typeof impactTypePriority] || 0;
    const candidatePriority =
      impactTypePriority[candidate.impact_type as keyof typeof impactTypePriority] || 0;

    return candidatePriority > existingPriority;
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
  private async getImpactedRoutes(
    symbolId: number,
    frameworks: Set<string>
  ): Promise<RouteImpactItem[]> {
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
      const filteredJobs = jobSymbols.filter(
        symbol =>
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
      const filteredTests = testSymbols.filter(
        symbol =>
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

      return (
        dependencies.some(dep => dep.to_symbol_id === symbolId) ||
        callers.some(caller => caller.from_symbol_id === symbolId)
      );
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

  private analyzeCallPattern(dependency: any): string {
    // Analyze the calling pattern based on enhanced context
    if (!dependency.calling_object && !dependency.qualified_context) {
      return 'direct_call';
    }

    if (dependency.calling_object) {
      if (dependency.calling_object.includes('this.') || dependency.calling_object === 'this') {
        return 'instance_method_call';
      }
      if (dependency.calling_object.startsWith('_') || dependency.calling_object.startsWith('m_')) {
        return 'private_field_call';
      }
      if (
        dependency.calling_object.includes('Service') ||
        dependency.calling_object.includes('Manager')
      ) {
        return 'service_injection_call';
      }
      return 'object_method_call';
    }

    if (dependency.qualified_context) {
      if (dependency.qualified_context.includes('.')) {
        return 'qualified_method_call';
      }
    }

    return 'unknown_pattern';
  }

  private isCrossFileCall(dependency: any, targetSymbol: any): boolean {
    // Check if the call crosses file boundaries
    if (!dependency.from_symbol?.file?.path || !targetSymbol?.file?.path) {
      return false;
    }

    return dependency.from_symbol.file.path !== targetSymbol.file.path;
  }

  private mergeAndRankResults(searchResults: any[][], validatedArgs: SearchCodeArgs): any[] {
    // Flatten all results
    const allResults: any[] = [];
    const seenIds = new Set<number>();

    for (const resultSet of searchResults) {
      for (const result of resultSet) {
        if (!seenIds.has(result.id)) {
          seenIds.add(result.id);
          allResults.push(result);
        }
      }
    }

    // Rank results by relevance
    return allResults
      .sort((a, b) => {
        // Prioritize exact name matches
        const aExactMatch = a.name?.toLowerCase() === validatedArgs.query.toLowerCase();
        const bExactMatch = b.name?.toLowerCase() === validatedArgs.query.toLowerCase();

        if (aExactMatch && !bExactMatch) return -1;
        if (!aExactMatch && bExactMatch) return 1;

        // Prioritize symbols with qualified context (enhanced results)
        const aHasQualified = !!(a.qualified_context || a.method_signature);
        const bHasQualified = !!(b.qualified_context || b.method_signature);

        if (aHasQualified && !bHasQualified) return -1;
        if (!aHasQualified && bHasQualified) return 1;

        // If class context is specified, prioritize matches
        if (validatedArgs.class_context) {
          const aClassMatch = a.resolved_class
            ?.toLowerCase()
            .includes(validatedArgs.class_context.toLowerCase());
          const bClassMatch = b.resolved_class
            ?.toLowerCase()
            .includes(validatedArgs.class_context.toLowerCase());

          if (aClassMatch && !bClassMatch) return -1;
          if (!aClassMatch && bClassMatch) return 1;
        }

        // Sort by name as fallback
        return (a.name || '').localeCompare(b.name || '');
      })
      .slice(0, validatedArgs.limit || 100);
  }

  private calculateRiskLevel(
    directImpact: ImpactItem[],
    transitiveImpact: ImpactItem[],
    routeImpact: RouteImpactItem[],
    jobImpact: JobImpactItem[]
  ): string {
    const totalImpact =
      directImpact.length + transitiveImpact.length + routeImpact.length + jobImpact.length;

    if (totalImpact > 20) return 'critical';
    if (totalImpact > 10) return 'high';
    if (totalImpact > 5) return 'medium';
    return 'low';
  }

  /**
   * Get parameter context analysis for a symbol
   * Enhancement 2: Context-Specific Analysis
   */
  private async getParameterContextAnalysis(symbolId: number): Promise<any> {
    try {
      const analysis = await this.dbService.groupCallsByParameterContext(symbolId);

      if (analysis.totalCalls === 0) {
        return undefined; // No parameter context data available
      }

      return {
        method_name: analysis.methodName,
        total_calls: analysis.totalCalls,
        total_variations: analysis.parameterVariations.length,
        parameter_variations: analysis.parameterVariations.map(variation => ({
          parameters: variation.parameter_context,
          call_count: variation.call_count,
          average_confidence: variation.confidence_avg,
          usage_locations: variation.callers.map(caller => ({
            caller: caller.caller_name,
            file: caller.file_path,
            line: caller.line_number
          })),
          call_instance_ids: variation.call_instance_ids
        })),
        insights: this.generateParameterInsights(analysis.parameterVariations)
      };
    } catch (error) {
      this.logger.warn('Parameter context analysis failed', {
        symbolId,
        error: (error as Error).message
      });
      return undefined;
    }
  }

  /**
   * Generate intelligent insights about parameter usage patterns
   */
  private generateParameterInsights(variations: any[]): string[] {
    const insights: string[] = [];

    if (variations.length > 1) {
      insights.push(`Method called with ${variations.length} different parameter patterns`);
    }

    // Analyze null usage patterns
    const nullUsageVariations = variations.filter(v =>
      v.parameter_context.includes('null')
    );
    if (nullUsageVariations.length > 0) {
      insights.push(`${nullUsageVariations.length} call pattern(s) use null parameters`);
    }

    // Find most common usage pattern
    const mostCommon = variations.reduce((prev, current) =>
      prev.call_count > current.call_count ? prev : current
    );
    if (variations.length > 1) {
      insights.push(`Most common pattern: "${mostCommon.parameter_context}" (${mostCommon.call_count} calls)`);
    }

    // Analyze confidence levels
    const lowConfidenceCalls = variations.filter(v => v.confidence_avg < 0.7);
    if (lowConfidenceCalls.length > 0) {
      insights.push(`${lowConfidenceCalls.length} parameter pattern(s) have low confidence scores`);
    }

    return insights;
  }

}
