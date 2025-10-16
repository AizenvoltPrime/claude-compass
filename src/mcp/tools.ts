import { DatabaseService } from '../database/services';
import {
  DependencyType,
  SymbolType,
  SimplifiedDependency,
  SimplifiedDependencyResponse,
  ImpactAnalysisResponse,
  SimplifiedSymbolResponse,
} from '../database/models';
import { createComponentLogger } from '../utils/logger';
import {
  transitiveAnalyzer,
  TransitiveAnalysisOptions,
  symbolImportanceRanker,
  SymbolForRanking,
} from '../graph/transitive-analyzer';
import {
  MIN_DEPTH,
  MAX_DEPTH,
  DEFAULT_DEPENDENCY_DEPTH,
  DEFAULT_IMPACT_DEPTH,
  TRANSITIVE_ANALYSIS_THRESHOLD,
} from './constants';

const logger = createComponentLogger('mcp-tools');

// Input validation helpers
function validateMaxDepthParameter(value: any): void {
  if (value === undefined) return;

  if (typeof value !== 'number') {
    throw new Error('max_depth must be a number');
  }

  if (!Number.isInteger(value)) {
    throw new Error('max_depth must be an integer');
  }

  if (value < MIN_DEPTH || value > MAX_DEPTH) {
    throw new Error(`max_depth must be between ${MIN_DEPTH} and ${MAX_DEPTH}`);
  }
}
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
  return args as GetFileArgs;
}

function validateGetSymbolArgs(args: any): GetSymbolArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  return args as GetSymbolArgs;
}

function validateSearchCodeArgs(args: any): SearchCodeArgs {
  // Check for deprecated parameters per PARAMETER_REDUNDANCY_ANALYSIS
  if (args.repo_id !== undefined) {
    throw new Error('repo_id parameter removed. Use repo_ids array instead');
  }
  if (args.symbol_type !== undefined) {
    throw new Error('symbol_type parameter removed. Use entity_types array instead');
  }
  if (args.limit !== undefined) {
    throw new Error('limit parameter removed. Fixed limit of 100 is now used for all searches');
  }
  if (args.use_vector !== undefined) {
    throw new Error(
      'use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid'
    );
  }

  if (!args.query || typeof args.query !== 'string') {
    throw new Error('query is required and must be a string');
  }
  if (args.is_exported !== undefined && typeof args.is_exported !== 'boolean') {
    throw new Error('is_exported must be a boolean');
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

  if (args.search_mode !== undefined) {
    const validModes = ['auto', 'exact', 'vector', 'qualified'];
    if (typeof args.search_mode !== 'string' || !validModes.includes(args.search_mode)) {
      throw new Error('search_mode must be one of: auto, exact, vector, qualified');
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
  if (args.include_cross_stack !== undefined && typeof args.include_cross_stack !== 'boolean') {
    throw new Error('include_cross_stack must be a boolean');
  }
  validateMaxDepthParameter(args.max_depth);
  return args as WhoCallsArgs;
}

function validateListDependenciesArgs(args: any): ListDependenciesArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.dependency_type !== undefined && typeof args.dependency_type !== 'string') {
    throw new Error('dependency_type must be a string');
  }
  if (args.include_cross_stack !== undefined && typeof args.include_cross_stack !== 'boolean') {
    throw new Error('include_cross_stack must be a boolean');
  }
  validateMaxDepthParameter(args.max_depth);
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
  validateMaxDepthParameter(args.max_depth);
  return args as ImpactOfArgs;
}

export interface GetFileArgs {
  file_id?: number;
  file_path?: string;
}

export interface GetSymbolArgs {
  symbol_id: number;
}

export interface SearchCodeArgs {
  query: string;
  repo_ids?: number[];
  entity_types?: string[]; // route, model, controller, component, job, etc.
  framework?: string; // laravel, vue, react, node
  is_exported?: boolean;
  search_mode?: 'auto' | 'exact' | 'vector' | 'qualified';
}

export interface WhoCallsArgs {
  symbol_id: number;
  dependency_type?: string;
  include_cross_stack?: boolean;
  max_depth?: number; // Transitive depth (default 1, min 1, max 20)
}

export interface ListDependenciesArgs {
  symbol_id: number;
  dependency_type?: string;
  include_cross_stack?: boolean;
  max_depth?: number; // Transitive depth (default 1, min 1, max 20)
}

// Comprehensive impact analysis interface
export interface ImpactOfArgs {
  symbol_id: number;
  frameworks?: string[]; // Multi-framework impact: ['vue', 'laravel', 'react', 'node']
  max_depth?: number; // Transitive depth (default 5, min 1, max 20)
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
  relationship_type?: string;
  relationship_context?: string;
  // Direction of the relationship: 'dependency' means target calls this, 'caller' means this calls target
  direction?: 'dependency' | 'caller';
  // Framework information for external symbols
  framework?: string;
  // Call chain visualization fields (Enhancement 1)
  call_chain?: string;
  depth?: number;
  // Line number for precise deduplication
  line_number?: number;
  // Fully qualified name for resolved symbols (e.g., "App\Models\Personnel::create")
  to_qualified_name?: string;
}

export interface TestImpactItem {
  id: number;
  name: string;
  file_path: string;
  test_type: string;
}

export interface RouteImpactItem {
  id: number;
  path: string;
  method: string;
  framework: string;
}

export interface JobImpactItem {
  id: number;
  name: string;
  type: string;
}

export class McpTools {
  private dbService: DatabaseService;
  private logger: any;
  private sessionId?: string;
  private defaultRepoId?: number;

  constructor(dbService: DatabaseService, sessionId?: string) {
    this.dbService = dbService;
    this.sessionId = sessionId;
    this.logger = logger;
  }

  setDefaultRepoId(repoId: number): void {
    this.defaultRepoId = repoId;
  }

  private getDefaultRepoId(): number | undefined {
    return this.defaultRepoId;
  }

  /**
   * Core Tool 1: getFile - Get details about a specific file including its metadata and symbols
   * Always includes symbols (simplified interface)
   *
   * @param args.file_id - The ID of the file to retrieve (alternative to file_path)
   * @param args.file_path - The path of the file to retrieve (alternative to file_id)
   * @returns File details with metadata and symbol list
   */
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

    // Always include symbols (include_symbols parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
    const symbols = await this.dbService.getSymbolsByFile(file.id);

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

  /**
   * Core Tool 2: getSymbol - Get metadata about a specific symbol
   * Lightweight symbol inspection. Use who_calls or list_dependencies for relationships.
   *
   * @param args.symbol_id - The ID of the symbol to retrieve
   * @returns Symbol metadata with relationship counts
   */
  async getSymbol(args: any) {
    const validatedArgs = validateGetSymbolArgs(args);

    const symbol = await this.dbService.getSymbolWithFile(validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    // Get counts only (not full relationship data)
    const dependencies = await this.dbService.getDependenciesFrom(validatedArgs.symbol_id);
    const callers = await this.dbService.getDependenciesTo(validatedArgs.symbol_id);

    const response: SimplifiedSymbolResponse = {
      symbol: {
        id: symbol.id,
        name: symbol.name,
        type: symbol.symbol_type,
        start_line: symbol.start_line,
        end_line: symbol.end_line,
        is_exported: symbol.is_exported,
        visibility: symbol.visibility,
        signature: symbol.signature,
      },
      file_path: symbol.file?.path || '',
      repository_name: symbol.file?.repository?.name,
      dependencies_count: dependencies.length,
      callers_count: callers.length,
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

  /**
   * Core Tool 3: searchCode - Enhanced search for code symbols with framework awareness
   * Supports multi-mode search: exact (lexical), vector (embedding-based), auto (hybrid), qualified (namespace-aware)
   *
   * @param args.query - The search query (symbol name or pattern)
   * @param args.entity_types - Framework-aware entity types: route, model, controller, component, job, function, class, interface
   * @param args.framework - Filter by framework type: laravel, vue, react, node
   * @param args.is_exported - Filter by exported symbols only
   * @param args.repo_ids - Repository IDs to search in
   * @param args.search_mode - Search mode: auto (hybrid), exact (lexical), vector (embedding-based), qualified (namespace-aware)
   * @returns List of matching symbols with framework context
   */
  async searchCode(args: any) {
    const validatedArgs = validateSearchCodeArgs(args);

    // Use repo_ids or default repo (repo_id parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
    const defaultRepoId = this.getDefaultRepoId();
    const repoIds = validatedArgs.repo_ids || (defaultRepoId ? [defaultRepoId] : []);

    // Framework auto-detection based on entity_types (per PARAMETER_REDUNDANCY_ANALYSIS)
    let detectedFramework = validatedArgs.framework;
    let frameworkAutoDetected = false;

    if (!detectedFramework && validatedArgs.entity_types && repoIds.length > 0) {
      // Get repository framework stacks to validate auto-detection
      const repositories = await Promise.all(
        repoIds.map(repoId => this.dbService.getRepository(repoId))
      );
      const frameworkStacks = repositories
        .filter(repo => repo)
        .flatMap(repo => repo.framework_stack || []);

      const entityTypes = validatedArgs.entity_types;
      if (
        entityTypes.includes('route') ||
        entityTypes.includes('model') ||
        entityTypes.includes('controller')
      ) {
        if (
          entityTypes.length === 1 &&
          (entityTypes.includes('model') || entityTypes.includes('controller'))
        ) {
          // Only auto-detect Laravel if it's in the repository framework stack
          if (frameworkStacks.includes('laravel')) {
            detectedFramework = 'laravel';
            frameworkAutoDetected = true;
          }
        }
      }
      if (entityTypes.includes('component') && entityTypes.length === 1) {
        // Only auto-detect Vue if it's in the repository framework stack
        if (frameworkStacks.includes('vue')) {
          detectedFramework = 'vue';
          frameworkAutoDetected = true;
        }
      }
    }

    // Build search options with improved defaults
    const searchOptions = {
      limit: 30, // Fixed limit optimized for AI assistant cognitive load and response time
      symbolTypes: [],
      isExported: validatedArgs.is_exported,
      repoIds: repoIds,
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
              // Use new search_mode parameter instead of use_vector
              const standardSymbols = await this.performSearchByMode(
                validatedArgs.query,
                repoIds[0] || defaultRepoId,
                searchOptions,
                validatedArgs.search_mode || 'auto'
              );
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
            // Use new search_mode parameter for better search logic
            const standardSymbols = await this.performSearchByMode(
              validatedArgs.query,
              repoIds[0] || defaultRepoId,
              searchOptions,
              validatedArgs.search_mode || 'auto'
            );
            symbols.push(...standardSymbols);
        }
      }
    } else {
      // Enhanced search when no entity types specified - use search_mode for optimal results
      symbols = await this.performSearchByMode(
        validatedArgs.query,
        repoIds[0] || defaultRepoId,
        searchOptions,
        validatedArgs.search_mode || 'auto'
      );
    }

    // Qualified search parameters removed per PARAMETER_REDUNDANCY_ANALYSIS
    // The 'qualified' search_mode provides this functionality when needed

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
          case 'godot':
            return (
              s.file?.path?.endsWith('.tscn') ||
              s.file?.path?.endsWith('.cs') ||
              s.file?.path?.includes('scripts/') ||
              s.file?.path?.includes('scenes/')
            );
          default:
            return s.file?.path?.includes(frameworkPath);
        }
      });
    }

    // Rank search results by importance (database operations, business logic > logging, error handling)
    try {
      const symbolsForRanking: SymbolForRanking[] = filteredSymbols.map((symbol: any) => ({
        id: symbol.id,
        name: symbol.name,
        symbol_type: symbol.symbol_type,
        file_path: symbol.file?.path,
        depth: undefined, // Search results don't have depth
      }));

      if (symbolsForRanking.length > 0) {
        const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);
        const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

        filteredSymbols = filteredSymbols.sort((a: any, b: any) => {
          const scoreA = scoreMap.get(a.id) || 0;
          const scoreB = scoreMap.get(b.id) || 0;
          return scoreB - scoreA;
        });

        this.logger.debug('Ranked search results by importance', {
          totalResults: filteredSymbols.length,
          topResult: filteredSymbols[0]?.name,
          topScore: scoreMap.get(filteredSymbols[0]?.id),
        });
      }
    } catch (error) {
      this.logger.warn('Search result importance ranking failed, using original order', {
        error: (error as Error).message,
      });
    }

    // Apply default limit (optimized for AI assistant cognitive load and response time)
    const limit = 30;
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
                framework: detectedFramework,
                framework_auto_detected: frameworkAutoDetected,
                is_exported: validatedArgs.is_exported,
                repo_ids: repoIds,
                search_mode: validatedArgs.search_mode,
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

  /**
   * Core Tool 4: whoCalls - Find all symbols that call or reference a specific symbol
   * Returns simple dependency list format
   *
   * @param args.symbol_id - The ID of the symbol to find callers for
   * @param args.dependency_type - Optional type of dependency relationship to find
   * @param args.include_cross_stack - Include cross-stack callers (Vue ↔ Laravel)
   * @param args.max_depth - Transitive analysis depth (default: 1, min: 1, max: 20)
   * @returns Simple dependency list with caller information
   */
  async whoCalls(args: any) {
    const validatedArgs = validateWhoCallsArgs(args);

    const timeoutMs = 10000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('whoCalls operation timed out after 10 seconds')),
        timeoutMs
      );
    });

    try {
      const symbol = (await Promise.race([
        this.dbService.getSymbolWithFile(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      let callers = (await Promise.race([
        this.dbService.getDependenciesToWithContext(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;

      // Add cross-stack API callers if requested
      if (validatedArgs.include_cross_stack) {
        try {
          const crossStackCallers = await this.dbService.getCrossStackApiCallers(
            validatedArgs.symbol_id
          );
          if (crossStackCallers.length > 0) {
            callers = [...callers, ...crossStackCallers];
          }
        } catch (error) {
          this.logger.warn('Failed to fetch cross-stack callers', {
            error: (error as Error).message,
            symbolId: validatedArgs.symbol_id,
          });
        }
      }

      if (validatedArgs.dependency_type) {
        const depType = validatedArgs.dependency_type as DependencyType;
        callers = callers.filter(caller => caller.dependency_type === depType);
      }

      // Save direct callers before adding transitive ones
      const directCallers = [...callers];

      let transitiveResults: any[] = [];

      // Use explicit max_depth parameter
      const maxDepth =
        validatedArgs.max_depth !== undefined ? validatedArgs.max_depth : DEFAULT_DEPENDENCY_DEPTH;

      // Only perform transitive analysis if max_depth > 1
      const skipTransitive =
        maxDepth === 1 ||
        callers.length > TRANSITIVE_ANALYSIS_THRESHOLD ||
        validatedArgs.include_cross_stack ||
        validatedArgs.dependency_type; // Skip transitive when user requests specific dependency type

      // Include indirect callers if max_depth > 1
      if (!skipTransitive) {
        try {
          const transitiveOptions: TransitiveAnalysisOptions = {
            maxDepth: maxDepth,
            includeTypes: validatedArgs.dependency_type
              ? [validatedArgs.dependency_type as DependencyType]
              : undefined,
            includeCrossStack: false,
            showCallChains: true,
          };

          const transitiveResult = await transitiveAnalyzer.getTransitiveCallers(
            validatedArgs.symbol_id,
            transitiveOptions
          );

          transitiveResults = transitiveResult.results;

          // Include indirect dependencies
          const transitiveDependencies = transitiveResult.results
            .map(result => {
              const firstDep = result.dependencies[0];
              if (!firstDep?.from_symbol) return null;

              return {
                id: result.symbolId,
                from_symbol_id: result.symbolId,
                to_symbol_id: firstDep.to_symbol_id,
                dependency_type: firstDep.dependency_type,
                line_number: firstDep.line_number,
                created_at: new Date(),
                updated_at: new Date(),
                from_symbol: firstDep.from_symbol,
                to_symbol: firstDep.to_symbol,
                call_chain: result.call_chain,
                path: result.path,
                depth: result.depth,
              };
            })
            .filter(Boolean);

          // Deduplicate before merging to prevent duplicate relationships
          const deduplicatedTransitive = this.deduplicateRelationships(
            transitiveDependencies,
            callers
          );
          callers = [...callers, ...deduplicatedTransitive];
        } catch (error) {
          this.logger.error('Enhanced transitive caller analysis failed', {
            symbol_id: validatedArgs.symbol_id,
            error: (error as Error).message,
          });
        }
      }

      // Apply symbol consolidation to handle interface/implementation relationships
      callers = this.consolidateRelatedSymbols(callers);

      // Rank callers by importance (database operations, business logic > logging, error handling)
      try {
        const symbolsForRanking: SymbolForRanking[] = callers
          .filter(caller => caller.from_symbol)
          .map(caller => ({
            id: caller.from_symbol.id,
            name: caller.from_symbol.name,
            symbol_type: caller.from_symbol.symbol_type,
            file_path: caller.from_symbol.file?.path,
            depth: caller.depth,
          }));

        if (symbolsForRanking.length > 0) {
          const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);
          const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

          callers = callers.sort((a, b) => {
            if (!a.from_symbol || !b.from_symbol) return 0;
            const scoreA = scoreMap.get(a.from_symbol.id) || 0;
            const scoreB = scoreMap.get(b.from_symbol.id) || 0;
            return scoreB - scoreA;
          });

          this.logger.debug('Ranked callers by importance', {
            totalCallers: callers.length,
            topCaller: callers[0]?.from_symbol?.name,
            topScore: scoreMap.get(callers[0]?.from_symbol?.id),
          });
        }
      } catch (error) {
        this.logger.warn('Caller importance ranking failed, using original order', {
          error: (error as Error).message,
        });
      }

      // Build SimplifiedDependency array
      const dependencies: SimplifiedDependency[] = callers.map(caller => {
        const toName = symbol.name;
        const fromFile = caller.from_symbol?.file?.path;
        const toFile = symbol.file?.path;
        const fromName = caller.from_symbol?.name || 'unknown';

        // Always qualify both fields when file paths are available
        const qualifiedFromName =
          fromFile && fromName !== 'unknown'
            ? `${this.getClassNameFromPath(fromFile)}.${fromName}`
            : fromName;

        const qualifiedToName = caller.to_qualified_name
          ? caller.to_qualified_name
          : toFile
            ? `${this.getClassNameFromPath(toFile)}.${toName}`
            : toName;

        // Build SimplifiedDependency object
        const dep: SimplifiedDependency = {
          from: qualifiedFromName,
          to: qualifiedToName,
          type: caller.dependency_type,
          line_number: caller.line_number,
          file_path: fromFile,
          qualified_context: caller.qualified_context,
          parameter_types: caller.parameter_types,
          parameter_context: caller.parameter_context,
        };

        // Add transitive fields if present
        if (caller.call_chain) {
          dep.call_chain = caller.call_chain;
          dep.depth = caller.depth;
        }

        // Add cross-stack specific fields if this is an API call
        if (caller.is_cross_stack) {
          dep.is_cross_stack = true;
          dep.http_method = caller.http_method;
          dep.endpoint_path = caller.endpoint_path;
        }

        return dep;
      });

      const response: SimplifiedDependencyResponse = {
        dependencies,
        total_count: dependencies.length,
        query_info: {
          symbol: symbol.name,
          analysis_type: 'callers',
          timestamp: new Date().toISOString(),
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
    } catch (error) {
      this.logger.error('whoCalls operation failed', {
        error: (error as Error).message,
        symbolId: validatedArgs.symbol_id,
      });

      // Return a minimal error response
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: (error as Error).message,
                symbol_id: validatedArgs.symbol_id,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  /**
   * Core Tool 5: listDependencies - List all dependencies of a specific symbol
   * Returns simple dependency list format
   *
   * @param args.symbol_id - The ID of the symbol to list dependencies for
   * @param args.dependency_type - Optional type of dependency relationship to list
   * @param args.include_cross_stack - Include cross-stack dependencies (Vue ↔ Laravel)
   * @param args.max_depth - Transitive analysis depth (default: 1, min: 1, max: 20)
   * @returns Simple dependency list with dependency information
   */
  async listDependencies(args: any) {
    const validatedArgs = validateListDependenciesArgs(args);

    const timeoutMs = 10000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('listDependencies operation timed out after 10 seconds')),
        timeoutMs
      );
    });

    try {
      const symbol = (await Promise.race([
        this.dbService.getSymbolWithFile(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      let dependencies = (await Promise.race([
        this.dbService.getDependenciesFromWithContext(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;

      // Add cross-stack API dependencies if requested
      if (validatedArgs.include_cross_stack) {
        try {
          const crossStackDeps = await this.dbService.getCrossStackApiDependencies(
            validatedArgs.symbol_id
          );
          if (crossStackDeps.length > 0) {
            dependencies = [...dependencies, ...crossStackDeps];
          }
        } catch (error) {
          this.logger.warn('Failed to fetch cross-stack dependencies', {
            error: (error as Error).message,
            symbolId: validatedArgs.symbol_id,
          });
        }
      }

      // Filter by dependency type if specified
      if (validatedArgs.dependency_type) {
        const depType = validatedArgs.dependency_type as DependencyType;
        dependencies = dependencies.filter(dep => dep.dependency_type === depType);
      }

      let transitiveResults: any[] = [];

      // Use explicit max_depth parameter
      const maxDepth =
        validatedArgs.max_depth !== undefined ? validatedArgs.max_depth : DEFAULT_DEPENDENCY_DEPTH;

      // Only perform transitive analysis if max_depth > 1
      const skipTransitive =
        maxDepth === 1 ||
        dependencies.length > TRANSITIVE_ANALYSIS_THRESHOLD ||
        validatedArgs.include_cross_stack;

      // Include indirect dependencies if max_depth > 1
      if (!skipTransitive) {
        try {
          const transitiveOptions: TransitiveAnalysisOptions = {
            maxDepth: maxDepth,
            includeTypes: validatedArgs.dependency_type
              ? [validatedArgs.dependency_type as DependencyType]
              : undefined,
            includeCrossStack: false,
            showCallChains: true,
          };

          const transitiveResult = (await Promise.race([
            transitiveAnalyzer.getTransitiveDependencies(
              validatedArgs.symbol_id,
              transitiveOptions
            ),
            timeoutPromise,
          ])) as any;

          transitiveResults = transitiveResult.results;

          // Include indirect dependencies
          const transitiveDependencies = transitiveResult.results
            .map(result => {
              const firstDep = result.dependencies[0];
              if (!firstDep?.to_symbol) return null;

              return {
                id: result.symbolId,
                from_symbol_id: firstDep.from_symbol_id,
                to_symbol_id: result.symbolId,
                dependency_type: firstDep.dependency_type,
                line_number: firstDep.line_number,
                created_at: new Date(),
                updated_at: new Date(),
                from_symbol: firstDep.from_symbol,
                to_symbol: firstDep.to_symbol,
                call_chain: result.call_chain,
                path: result.path,
                depth: result.depth,
              };
            })
            .filter(Boolean);

          // Deduplicate before merging to prevent duplicate relationships
          const deduplicatedTransitive = this.deduplicateRelationships(
            transitiveDependencies,
            dependencies
          );
          dependencies = [...dependencies, ...deduplicatedTransitive];
        } catch (error) {
          this.logger.error('Enhanced transitive dependency analysis failed', {
            symbol_id: validatedArgs.symbol_id,
            error: (error as Error).message,
          });
        }
      }

      // Apply symbol consolidation to handle interface/implementation relationships
      dependencies = this.consolidateRelatedSymbols(dependencies);

      // Rank dependencies by importance (database operations, business logic > logging, error handling)
      try {
        const symbolsForRanking: SymbolForRanking[] = dependencies
          .filter((dep: any) => dep.to_symbol)
          .map((dep: any) => ({
            id: dep.to_symbol.id,
            name: dep.to_symbol.name,
            symbol_type: dep.to_symbol.symbol_type,
            file_path: dep.to_symbol.file?.path,
            depth: dep.depth,
          }));

        if (symbolsForRanking.length > 0) {
          const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);
          const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

          dependencies = dependencies.sort((a: any, b: any) => {
            if (!a.to_symbol || !b.to_symbol) return 0;
            const scoreA = scoreMap.get(a.to_symbol.id) || 0;
            const scoreB = scoreMap.get(b.to_symbol.id) || 0;
            return scoreB - scoreA;
          });

          this.logger.debug('Ranked dependencies by importance', {
            totalDeps: dependencies.length,
            topDep: dependencies[0]?.to_symbol?.name,
            topScore: scoreMap.get(dependencies[0]?.to_symbol?.id),
          });
        }
      } catch (error) {
        this.logger.warn('Dependency importance ranking failed, using original order', {
          error: (error as Error).message,
        });
      }

      // Build SimplifiedDependency array
      const simplifiedDeps: SimplifiedDependency[] = dependencies.map((dep: any) => {
        // Validate data quality - these should always exist from database query
        if (!dep.from_symbol?.file?.path) {
          this.logger.error('Missing from_symbol file path in dependency', {
            from_symbol_id: dep.from_symbol_id,
            to_symbol_id: dep.to_symbol_id,
            line_number: dep.line_number,
          });
        }
        if (!dep.to_symbol?.file?.path) {
          this.logger.error('Missing to_symbol file path in dependency', {
            from_symbol_id: dep.from_symbol_id,
            to_symbol_id: dep.to_symbol_id,
            line_number: dep.line_number,
          });
        }
        if (!dep.from_symbol?.name) {
          this.logger.error('Missing from_symbol name in dependency', {
            from_symbol_id: dep.from_symbol_id,
            to_symbol_id: dep.to_symbol_id,
            line_number: dep.line_number,
          });
        }

        const toName = dep.to_symbol?.name || 'unknown';
        const toFile = dep.to_symbol?.file?.path;
        const fromFile = dep.from_symbol?.file?.path;
        const fromName = dep.from_symbol?.name || 'unknown';

        // Always qualify both fields when file paths are available
        const qualifiedFromName =
          fromFile && fromName !== 'unknown'
            ? `${this.getClassNameFromPath(fromFile)}.${fromName}`
            : fromName;

        const qualifiedToName = dep.to_qualified_name
          ? dep.to_qualified_name
          : toFile && toName !== 'unknown'
            ? `${this.getClassNameFromPath(toFile)}.${toName}`
            : toName;

        // Build SimplifiedDependency object
        const simplifiedDep: SimplifiedDependency = {
          from: qualifiedFromName,
          to: qualifiedToName,
          type: dep.dependency_type,
          line_number: dep.line_number,
          file_path: fromFile,
          qualified_context: dep.qualified_context,
          parameter_types: dep.parameter_types,
          parameter_context: dep.parameter_context,
        };

        // Add transitive fields if present
        if (dep.call_chain) {
          simplifiedDep.call_chain = dep.call_chain;
          simplifiedDep.depth = dep.depth;
        }

        // Add cross-stack specific fields if this is an API call
        if (dep.is_cross_stack) {
          simplifiedDep.is_cross_stack = true;
          simplifiedDep.http_method = dep.http_method;
          simplifiedDep.endpoint_path = dep.endpoint_path;
        }

        return simplifiedDep;
      });

      const response: SimplifiedDependencyResponse = {
        dependencies: simplifiedDeps,
        total_count: simplifiedDeps.length,
        query_info: {
          symbol: symbol.name,
          analysis_type: 'dependencies',
          timestamp: new Date().toISOString(),
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
    } catch (error) {
      this.logger.error('listDependencies operation failed', {
        error: (error as Error).message,
        symbolId: validatedArgs.symbol_id,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: (error as Error).message,
                symbol_id: validatedArgs.symbol_id,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  /**
   * Core Tool 6: impactOf - Comprehensive impact analysis across all frameworks
   * Returns categorized impact with separate arrays for different types
   *
   * @param args.symbol_id - The ID of the symbol to analyze impact for
   * @param args.frameworks - Multi-framework impact analysis (default: all detected frameworks)
   * @param args.max_depth - Transitive analysis depth (default: 5, min: 1, max: 20)
   * @returns Structured impact analysis with direct/indirect symbols, routes, jobs, and tests
   */
  async impactOf(args: any) {
    const validatedArgs = validateImpactOfArgs(args);
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
      const directDependencies = await this.dbService.getDependenciesFromWithContext(
        validatedArgs.symbol_id
      );
      const directCallers = await this.dbService.getDependenciesToWithContext(
        validatedArgs.symbol_id
      );

      // Fetch cross-stack API call dependencies
      const apiCallDependencies = await this.fetchApiCallDependencies(validatedArgs.symbol_id);
      const apiCallCallers = await this.fetchApiCallCallers(validatedArgs.symbol_id);

      // Process direct dependencies and callers
      for (const dep of directDependencies) {
        if (dep.to_symbol) {
          const framework = this.determineFramework(dep.to_symbol);
          directImpact.push({
            id: dep.to_symbol.id,
            name: dep.to_symbol.name,
            type: dep.to_symbol.symbol_type,
            file_path: dep.to_symbol.file?.path,
            impact_type: this.classifyRelationshipImpact(dep, 'dependency'),
            relationship_type: dep.dependency_type,
            relationship_context: this.getRelationshipContext(dep),
            direction: 'dependency',
            framework: framework,
            line_number: dep.line_number,
            to_qualified_name: dep.to_qualified_name,
          });

          if (framework) frameworksAffected.add(framework);
        }
      }

      for (const caller of directCallers) {
        if (caller.from_symbol) {
          const framework = this.determineFramework(caller.from_symbol);
          directImpact.push({
            id: caller.from_symbol.id,
            name: caller.from_symbol.name,
            type: caller.from_symbol.symbol_type,
            file_path: caller.from_symbol.file?.path,
            impact_type: this.classifyRelationshipImpact(caller, 'caller'),
            relationship_type: caller.dependency_type,
            relationship_context: this.getRelationshipContext(caller),
            direction: 'caller',
            framework: framework,
            line_number: caller.line_number,
          });

          if (framework) frameworksAffected.add(framework);
        }
      }

      // Process cross-stack API call dependencies (outgoing API calls)
      for (const apiCall of apiCallDependencies) {
        if (apiCall.endpoint_symbol) {
          const framework = this.determineFramework(apiCall.endpoint_symbol);
          directImpact.push({
            id: apiCall.endpoint_symbol.id,
            name: apiCall.endpoint_symbol.name,
            type: apiCall.endpoint_symbol.symbol_type,
            file_path: apiCall.endpoint_symbol.file?.path,
            impact_type: 'cross_stack',
            relationship_type: 'api_call',
            relationship_context: `${apiCall.http_method} ${apiCall.endpoint_path}`,
            direction: 'dependency',
            framework: framework,
            line_number: apiCall.line_number,
          });

          if (framework) frameworksAffected.add(framework);
        }
      }

      // Process cross-stack API call callers (incoming API calls)
      for (const apiCall of apiCallCallers) {
        if (apiCall.caller_symbol) {
          const framework = this.determineFramework(apiCall.caller_symbol);
          directImpact.push({
            id: apiCall.caller_symbol.id,
            name: apiCall.caller_symbol.name,
            type: apiCall.caller_symbol.symbol_type,
            file_path: apiCall.caller_symbol.file?.path,
            impact_type: 'cross_stack',
            relationship_type: 'api_call',
            relationship_context: `${apiCall.http_method} ${apiCall.endpoint_path}`,
            direction: 'caller',
            framework: framework,
            line_number: apiCall.line_number,
          });

          if (framework) frameworksAffected.add(framework);
        }
      }

      // Deduplicate direct impact items after processing both dependencies and callers
      const deduplicatedDirectImpact = this.deduplicateImpactItems(directImpact);

      // Rank direct impact by importance (ensures critical operations like Personnel::create appear first)
      let rankedDirectImpact = deduplicatedDirectImpact;
      try {
        const symbolsForRanking: SymbolForRanking[] = deduplicatedDirectImpact.map(item => ({
          id: item.id,
          name: item.name,
          symbol_type: item.type,
          file_path: item.file_path,
          depth: 1, // Direct dependencies are depth 1
          qualified_name: item.to_qualified_name, // Pass FQN for better database operation detection
        }));

        if (symbolsForRanking.length > 0) {
          const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);
          const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

          // Sort direct impact by importance score (highest first)
          rankedDirectImpact = deduplicatedDirectImpact.sort((a, b) => {
            const scoreA = scoreMap.get(a.id) || 0;
            const scoreB = scoreMap.get(b.id) || 0;
            return scoreB - scoreA;
          });

          this.logger.info('Ranked direct impact by importance', {
            totalSymbols: rankedDirectImpact.length,
            topSymbol: rankedDirectImpact[0]?.name,
            topScore: scoreMap.get(rankedDirectImpact[0]?.id),
            top3: rankedDirectImpact.slice(0, 3).map(item => ({
              name: item.name,
              score: scoreMap.get(item.id),
            })),
          });
        }
      } catch (error) {
        this.logger.warn('Direct impact ranking failed, using original order', {
          error: (error as Error).message,
        });
      }

      // Transitive impact analysis
      const maxDepth = validatedArgs.max_depth || DEFAULT_IMPACT_DEPTH;

      try {
        const transitiveOptions: TransitiveAnalysisOptions = {
          maxDepth,
          includeTypes: undefined,
          showCallChains: true, // Always true (show_call_chains parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
          includeCrossStack: true, // Enable cross-stack traversal through API calls
        };

        const transitiveResult = await transitiveAnalyzer.getTransitiveDependencies(
          validatedArgs.symbol_id,
          transitiveOptions
        );

        for (const result of transitiveResult.results) {
          if (result.dependencies[0]?.to_symbol) {
            const toSymbol = result.dependencies[0].to_symbol;
            const framework = this.determineFramework(toSymbol);
            transitiveImpact.push({
              id: toSymbol.id,
              name: toSymbol.name,
              type: toSymbol.symbol_type,
              file_path: toSymbol.file?.path || '',
              impact_type: 'indirect',
              call_chain: result.call_chain,
              depth: result.depth,
              direction: 'dependency', // Transitive results are always dependencies (what the symbol calls)
              framework: framework,
            });

            if (framework) frameworksAffected.add(framework);
          }
        }
      } catch (error) {
        this.logger.warn('Transitive analysis failed, continuing with direct impact only', {
          error: (error as Error).message,
        });
      }

      // Collect all impacted symbol IDs for route/job/test analysis
      const allImpactedIds = new Set<number>([
        validatedArgs.symbol_id, // Include the original symbol
        ...rankedDirectImpact.map(item => item.id),
        ...transitiveImpact.map(item => item.id),
      ]);
      const impactedSymbolIds = Array.from(allImpactedIds);

      // Always include route, job, and test impact analysis (parameters removed per PARAMETER_REDUNDANCY_ANALYSIS)
      try {
        const routes = await this.getImpactedRoutes(impactedSymbolIds);
        routeImpact.push(...routes);
      } catch (error) {
        this.logger.warn('Route impact analysis failed', { error: (error as Error).message });
      }

      try {
        const jobs = await this.getImpactedJobs(impactedSymbolIds);
        jobImpact.push(...jobs);
      } catch (error) {
        this.logger.warn('Job impact analysis failed', { error: (error as Error).message });
      }

      try {
        const tests = await this.getImpactedTests(impactedSymbolIds);
        testImpact.push(...tests);
      } catch (error) {
        this.logger.warn('Test impact analysis failed', { error: (error as Error).message });
      }

      // Rank transitive impact by importance (graph centrality + semantic weights)
      // This ensures critical operations like Personnel::create appear before logging/error handlers
      let rankedTransitiveImpact = transitiveImpact;
      try {
        const symbolsForRanking: SymbolForRanking[] = transitiveImpact.map(item => ({
          id: item.id,
          name: item.name,
          symbol_type: item.type,
          file_path: item.file_path,
          depth: item.depth,
          qualified_name: item.to_qualified_name, // Pass FQN for better database operation detection
        }));

        const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);

        // Create a map of id -> importance_score for efficient lookup
        const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

        // Sort transitiveImpact by importance score (highest first)
        rankedTransitiveImpact = transitiveImpact.sort((a, b) => {
          const scoreA = scoreMap.get(a.id) || 0;
          const scoreB = scoreMap.get(b.id) || 0;
          return scoreB - scoreA;
        });

        this.logger.info('Ranked transitive impact by importance', {
          totalSymbols: rankedTransitiveImpact.length,
          topSymbol: rankedTransitiveImpact[0]?.name,
          topScore: scoreMap.get(rankedTransitiveImpact[0]?.id),
        });
      } catch (error) {
        this.logger.warn('Importance ranking failed, using original order', {
          error: (error as Error).message,
        });
      }

      // Deduplicate transitive impact items, excluding those already in direct impact
      const deduplicatedTransitiveImpact = this.deduplicateImpactItems(
        rankedTransitiveImpact.filter(
          item => !rankedDirectImpact.some(directItem => directItem.id === item.id)
        )
      );

      // Convert ImpactItems to SimplifiedDependencies
      const directImpactDeps: SimplifiedDependency[] = this.convertImpactItemsToSimplifiedDeps(
        rankedDirectImpact,
        symbol.name,
        symbol.file?.path,
        [...directDependencies, ...directCallers]
      );

      const indirectImpactDeps: SimplifiedDependency[] = this.convertImpactItemsToSimplifiedDeps(
        deduplicatedTransitiveImpact,
        symbol.name,
        symbol.file?.path,
        []
      );

      // Calculate max depth from transitive impact
      const maxDepthReached = Math.max(
        0,
        ...deduplicatedTransitiveImpact.map(item => item.depth || 0)
      );

      // Build structured response
      const response: ImpactAnalysisResponse = {
        direct_impact: directImpactDeps,
        indirect_impact: indirectImpactDeps,
        routes_affected: routeImpact.map(route => ({
          path: route.path,
          method: route.method,
          framework: route.framework,
        })),
        jobs_affected: jobImpact.map(job => ({
          name: job.name,
          type: job.type,
        })),
        tests_affected: testImpact.map(test => ({
          name: test.name,
          file_path: test.file_path,
        })),
        summary: {
          total_symbols: directImpactDeps.length + indirectImpactDeps.length,
          total_routes: routeImpact.length,
          total_jobs: jobImpact.length,
          total_tests: testImpact.length,
          max_depth: maxDepthReached,
          frameworks: Array.from(frameworksAffected),
        },
        query_info: {
          symbol: symbol.name,
          analysis_type: 'impact',
          timestamp: new Date().toISOString(),
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

  private determineEntityType(symbol: any): string | undefined {
    return symbol.entity_type;
  }

  private determineFramework(symbol: any): string | undefined {
    return symbol.framework;
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

  // Helper methods for impact analysis
  private async getImpactedRoutes(impactedSymbolIds: number[]): Promise<RouteImpactItem[]> {
    const routes: RouteImpactItem[] = [];

    try {
      // Graph-based query: find routes whose handlers are in the impact chain
      const routeRecords = await this.dbService.getRoutesForSymbols(impactedSymbolIds);

      for (const route of routeRecords) {
        routes.push({
          id: route.id,
          path: route.path || '',
          method: route.method || 'GET',
          framework: route.framework_type || 'unknown',
        });
      }
    } catch (error) {
      this.logger.warn('Failed to analyze route impact', { error: (error as Error).message });
    }

    return routes;
  }

  private async getImpactedJobs(impactedSymbolIds: number[]): Promise<JobImpactItem[]> {
    const jobs: JobImpactItem[] = [];

    try {
      // Graph-based query: find jobs that are in the impact chain
      const jobRecords = await this.dbService.getJobsForSymbols(impactedSymbolIds);

      for (const job of jobRecords) {
        jobs.push({
          id: job.id,
          name: job.name,
          type: job.entity_type || 'background_job',
        });
      }
    } catch (error) {
      this.logger.warn('Failed to analyze job impact', { error: (error as Error).message });
    }

    return jobs;
  }

  private async getImpactedTests(impactedSymbolIds: number[]): Promise<TestImpactItem[]> {
    const tests: TestImpactItem[] = [];

    try {
      // Graph-based query: find tests that are in the impact chain
      const testRecords = await this.dbService.getTestsForSymbols(impactedSymbolIds);

      for (const test of testRecords) {
        tests.push({
          id: test.id,
          name: test.name,
          file_path: test.file_path || '',
          test_type: this.determineTestType(test.file_path || ''),
        });
      }
    } catch (error) {
      this.logger.warn('Failed to analyze test impact', { error: (error as Error).message });
    }

    return tests;
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

  /**
   * Deduplicate relationships to prevent duplicate entries in analysis results
   * Compares relationships based on structural equivalence rather than just ID
   */
  private deduplicateRelationships(newRelationships: any[], existingRelationships: any[]): any[] {
    const existingKeys = new Set<string>();

    // Create keys for existing relationships
    for (const existing of existingRelationships) {
      const key = this.createRelationshipKey(existing);
      if (key) existingKeys.add(key);
    }

    // Filter out duplicates from new relationships
    return newRelationships.filter(newRel => {
      const key = this.createRelationshipKey(newRel);
      return key && !existingKeys.has(key);
    });
  }

  /**
   * Create a unique key for a relationship based on structural equivalence
   */
  private createRelationshipKey(relationship: any): string | null {
    // Handle different relationship formats (from different tools)
    const fromSymbolId = relationship.from_symbol_id || relationship.from_symbol?.id;
    const toSymbolId = relationship.to_symbol_id || relationship.to_symbol?.id;
    const depType = relationship.dependency_type || relationship.type;
    const lineNum = relationship.line_number || 0;

    if (!fromSymbolId || !toSymbolId || !depType) {
      return null;
    }

    return `${fromSymbolId}->${toSymbolId}:${depType}:${lineNum}`;
  }

  /**
   * Consolidate symbols that represent the same logical entity (interface + implementations)
   */
  private consolidateRelatedSymbols(relationships: any[]): any[] {
    // For who_calls analysis, we want to preserve ALL unique callers
    // Group by unique caller characteristics: (from_symbol_id, line_number, dependency_type)
    const uniqueRelationships = new Map<string, any>();

    for (const rel of relationships) {
      // Create a unique key that identifies distinct calling relationships
      const fromSymbolId = rel.from_symbol_id || rel.from_symbol?.id;
      const lineNumber = rel.line_number || 0;
      const depType = rel.dependency_type || rel.type;
      const toSymbolId = rel.to_symbol_id || rel.to_symbol?.id;

      // Key should uniquely identify each distinct call
      const key = `${fromSymbolId}->${toSymbolId}:${depType}:${lineNumber}`;

      if (!uniqueRelationships.has(key)) {
        uniqueRelationships.set(key, rel);
      }
    }

    return Array.from(uniqueRelationships.values());
  }

  /**
   * Perform search based on the new search_mode parameter
   * Replaces the old use_vector logic with improved search mode handling
   */
  private async performSearchByMode(
    query: string,
    repoId: number,
    searchOptions: any,
    searchMode: 'auto' | 'exact' | 'vector' | 'qualified' = 'auto'
  ) {
    switch (searchMode) {
      case 'vector':
        this.logger.info(`[VECTOR SEARCH] Attempting vector search for query: "${query}"`);
        try {
          const vectorResults = await this.dbService.vectorSearchSymbols(query, repoId, {
            ...searchOptions,
            similarityThreshold: 0.35,
          });
          this.logger.info(`[VECTOR SEARCH] Success: returned ${vectorResults.length} results`);
          return vectorResults;
        } catch (error) {
          this.logger.warn('[VECTOR SEARCH] Failed, falling back to lexical search:', error);
          return await this.dbService.lexicalSearchSymbols(query, repoId, searchOptions);
        }

      case 'exact':
        return await this.dbService.lexicalSearchSymbols(query, repoId, searchOptions);

      case 'qualified':
        // Use enhanced search with qualified context
        try {
          return await this.dbService.searchQualifiedContext(query, undefined);
        } catch (error) {
          this.logger.warn('Qualified search failed, falling back to lexical search:', error);
          return await this.dbService.lexicalSearchSymbols(query, repoId, searchOptions);
        }

      case 'auto':
      default:
        // Intelligent auto mode: try vector first, fallback to lexical with token-ranking
        this.logger.info(
          `[VECTOR SEARCH] Auto mode: attempting vector search for query: "${query}"`
        );
        try {
          const vectorResults = await this.dbService.vectorSearchSymbols(query, repoId, {
            ...searchOptions,
            similarityThreshold: 0.35,
          });
          if (vectorResults.length > 0) {
            this.logger.info(
              `[VECTOR SEARCH] Auto mode: vector search returned ${vectorResults.length} results`
            );
            return vectorResults;
          }
          this.logger.info(
            '[VECTOR SEARCH] Auto mode: vector search returned 0 results, falling back to lexical'
          );
        } catch (error) {
          this.logger.warn(
            '[VECTOR SEARCH] Auto mode: vector search failed, falling back to lexical:',
            error
          );
        }

        return await this.dbService.lexicalSearchSymbols(query, repoId, searchOptions);
    }
  }

  /**
   * Advanced deduplication for impact items using composite keys
   * Handles edge cases like same symbol in different contexts
   */
  private deduplicateImpactItems(items: ImpactItem[]): ImpactItem[] {
    const seen = new Set<string>();
    const deduplicatedItems: ImpactItem[] = [];

    for (const item of items) {
      // Create composite key: id + file_path + relationship_type + line_number for precise deduplication
      const compositeKey = `${item.id}:${item.file_path}:${item.relationship_type || 'unknown'}:${item.line_number || 'unknown'}`;

      if (!seen.has(compositeKey)) {
        seen.add(compositeKey);
        deduplicatedItems.push(item);
      }
    }

    return deduplicatedItems;
  }

  /**
   * Convert ImpactItems to SimplifiedDependencies for new impact response format
   * Fixed: Correctly handles direction (dependency vs caller) and uses consistent file paths
   */
  private convertImpactItemsToSimplifiedDeps(
    impactItems: ImpactItem[],
    targetSymbolName: string,
    targetSymbolFilePath: string | undefined,
    originalDependencies: any[]
  ): SimplifiedDependency[] {
    return impactItems.map(item => {
      // Validate that we have the necessary data
      if (!item.line_number) {
        this.logger.error('ImpactItem missing line_number', {
          item_id: item.id,
          item_name: item.name,
          direction: item.direction,
        });
      }
      if (!item.file_path) {
        this.logger.error('ImpactItem missing file_path', {
          item_id: item.id,
          item_name: item.name,
          direction: item.direction,
        });
      }
      if (!targetSymbolFilePath) {
        this.logger.error('Target symbol missing file path', {
          target_name: targetSymbolName,
        });
      }

      // Determine correct from/to based on direction
      // - 'dependency': target calls item (target -> item)
      //   - ImpactItem.file_path = item's file (to_symbol.file.path)
      //   - targetSymbolFilePath = target's file (from)
      // - 'caller': item calls target (item -> target)
      //   - ImpactItem.file_path = item's file (from_symbol.file.path)
      //   - targetSymbolFilePath = target's file (to)
      let from: string, to: string, filePath: string | undefined;
      if (item.direction === 'dependency') {
        from = targetSymbolFilePath
          ? `${this.getClassNameFromPath(targetSymbolFilePath)}.${targetSymbolName}`
          : targetSymbolName;

        // Use to_qualified_name if available, otherwise fall back to path-based extraction
        if (item.to_qualified_name) {
          to = item.to_qualified_name;
        } else {
          to = item.file_path
            ? `${this.getClassNameFromPath(item.file_path)}.${item.name}`
            : item.name;
        }
        filePath = targetSymbolFilePath; // Where the call happens (from side)
      } else if (item.direction === 'caller') {
        from = item.file_path
          ? `${this.getClassNameFromPath(item.file_path)}.${item.name}`
          : item.name;
        to = targetSymbolFilePath
          ? `${this.getClassNameFromPath(targetSymbolFilePath)}.${targetSymbolName}`
          : targetSymbolName;
        filePath = item.file_path; // Where the call happens (from side)
      } else {
        throw new Error(`Invalid direction field in ImpactItem: ${item.direction}`);
      }

      // Format framework symbols without file paths
      if (!filePath && item.framework) {
        const frameworkName = item.framework.charAt(0).toUpperCase() + item.framework.slice(1);
        filePath = `[${frameworkName} Framework]`;
      }

      const dep: SimplifiedDependency = {
        from,
        to,
        type: item.relationship_type as DependencyType,
        line_number: item.line_number,
        file_path: filePath,
      };

      // Add call chain if present (for indirect impact)
      if (item.call_chain) {
        dep.call_chain = item.call_chain;
        dep.depth = item.depth;
      }

      return dep;
    });
  }

  /**
   * Extract class name from file path for qualified naming
   */
  private getClassNameFromPath(filePath: string): string {
    const fileName = filePath.split('/').pop() || '';
    return fileName.replace(/\.(cs|js|ts|php|vue)$/, '');
  }

  /**
   * Core Tool 7: identifyModules - Discover architectural modules using community detection
   * Uses Louvain algorithm to find clusters of symbols that work closely together
   *
   * @param args.repo_id - Repository ID to analyze (optional if default repo is set)
   * @param args.min_module_size - Minimum number of symbols per module (default: 3)
   * @param args.resolution - Resolution parameter for community detection (default: 1.0)
   * @returns List of modules with their symbols, cohesion metrics, and metadata
   */
  async identifyModules(args: any) {
    try {
      const repoId = args.repo_id || this.getDefaultRepoId();
      if (!repoId) {
        throw new Error('repo_id is required when no default repository is set');
      }

      const minModuleSize = args.min_module_size || 3;
      const resolution = args.resolution || 1.0;

      const { communityDetector } = await import('../graph/community-detector');
      const result = await communityDetector.detectModules(repoId, {
        minModuleSize,
        resolution,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                modules: result.modules.map(module => ({
                  id: module.id,
                  name: module.name,
                  symbol_count: module.symbols.length,
                  symbols: module.symbols,
                  cohesion: {
                    internal_edges: module.internalEdges,
                    external_edges: module.externalEdges,
                    modularity: module.modularity,
                  },
                  files: module.files,
                  frameworks: module.frameworks,
                })),
                summary: {
                  total_modules: result.modules.length,
                  total_modularity: result.totalModularity,
                  execution_time_ms: result.executionTimeMs,
                },
                usage_guidance:
                  'Use module IDs to focus analysis on specific architectural boundaries. ' +
                  'High modularity (>0.7) indicates well-separated concerns. ' +
                  'Low external_edges suggest good encapsulation.',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('identifyModules failed', {
        error: (error as Error).message,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: (error as Error).message,
                args,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  /**
   * Fetch outgoing API call dependencies (frontend → backend)
   * Returns API calls where the given symbol is the caller
   */
  private async fetchApiCallDependencies(symbolId: number): Promise<any[]> {
    const results = await this.dbService
      .knex('api_calls')
      .leftJoin('symbols as caller_symbols', 'api_calls.caller_symbol_id', 'caller_symbols.id')
      .leftJoin('files as caller_files', 'caller_symbols.file_id', 'caller_files.id')
      .leftJoin(
        'symbols as endpoint_symbols',
        'api_calls.endpoint_symbol_id',
        'endpoint_symbols.id'
      )
      .leftJoin('files as endpoint_files', 'endpoint_symbols.file_id', 'endpoint_files.id')
      .where('api_calls.caller_symbol_id', symbolId)
      .select(
        'api_calls.id',
        'api_calls.caller_symbol_id',
        'api_calls.endpoint_symbol_id',
        'api_calls.http_method',
        'api_calls.endpoint_path',
        'api_calls.line_number',
        'endpoint_symbols.id as endpoint_symbol_id',
        'endpoint_symbols.name as endpoint_symbol_name',
        'endpoint_symbols.symbol_type as endpoint_symbol_type',
        'endpoint_files.path as endpoint_file_path'
      );

    return results.map(row => ({
      http_method: row.http_method,
      endpoint_path: row.endpoint_path,
      line_number: row.line_number,
      endpoint_symbol: {
        id: row.endpoint_symbol_id,
        name: row.endpoint_symbol_name,
        symbol_type: row.endpoint_symbol_type,
        file: {
          path: row.endpoint_file_path,
        },
      },
    }));
  }

  /**
   * Fetch incoming API call callers (backend ← frontend)
   * Returns API calls where the given symbol is the endpoint
   */
  private async fetchApiCallCallers(symbolId: number): Promise<any[]> {
    const results = await this.dbService
      .knex('api_calls')
      .leftJoin('symbols as caller_symbols', 'api_calls.caller_symbol_id', 'caller_symbols.id')
      .leftJoin('files as caller_files', 'caller_symbols.file_id', 'caller_files.id')
      .leftJoin(
        'symbols as endpoint_symbols',
        'api_calls.endpoint_symbol_id',
        'endpoint_symbols.id'
      )
      .leftJoin('files as endpoint_files', 'endpoint_symbols.file_id', 'endpoint_files.id')
      .where('api_calls.endpoint_symbol_id', symbolId)
      .select(
        'api_calls.id',
        'api_calls.caller_symbol_id',
        'api_calls.endpoint_symbol_id',
        'api_calls.http_method',
        'api_calls.endpoint_path',
        'api_calls.line_number',
        'caller_symbols.id as caller_symbol_id',
        'caller_symbols.name as caller_symbol_name',
        'caller_symbols.symbol_type as caller_symbol_type',
        'caller_files.path as caller_file_path'
      );

    return results.map(row => ({
      http_method: row.http_method,
      endpoint_path: row.endpoint_path,
      line_number: row.line_number,
      caller_symbol: {
        id: row.caller_symbol_id,
        name: row.caller_symbol_name,
        symbol_type: row.caller_symbol_type,
        file: {
          path: row.caller_file_path,
        },
      },
    }));
  }

  /**
   * Core Tool 8: traceFlow - Find execution paths between two symbols
   * Uses pathfinding algorithms to understand how code flows from point A to B
   *
   * @param args.start_symbol_id - Starting symbol ID
   * @param args.end_symbol_id - Ending symbol ID
   * @param args.find_all_paths - If true, finds all paths; if false, finds shortest path (default: false)
   * @param args.max_depth - Maximum path depth to search (default: 10)
   * @returns Paths with call chains and distance metrics
   */
  async traceFlow(args: any) {
    try {
      if (!args.start_symbol_id || typeof args.start_symbol_id !== 'number') {
        throw new Error('start_symbol_id is required and must be a number');
      }
      if (!args.end_symbol_id || typeof args.end_symbol_id !== 'number') {
        throw new Error('end_symbol_id is required and must be a number');
      }

      const findAllPaths = args.find_all_paths || false;
      const maxDepth = args.max_depth || 10;

      const { transitiveAnalyzer } = await import('../graph/transitive-analyzer');

      const startSymbol = await this.dbService.getSymbolWithFile(args.start_symbol_id);
      const endSymbol = await this.dbService.getSymbolWithFile(args.end_symbol_id);

      if (!startSymbol || !endSymbol) {
        throw new Error('Start or end symbol not found');
      }

      // Enable cross-stack traversal to find paths across frontend-backend boundaries
      const traversalOptions = {
        includeCrossStack: true,
        includeTypes: [
          DependencyType.CALLS,
          DependencyType.IMPORTS,
          DependencyType.API_CALL,
          DependencyType.SHARES_SCHEMA,
          DependencyType.FRONTEND_BACKEND,
        ],
      };

      if (findAllPaths) {
        const paths = await transitiveAnalyzer.findAllPaths(
          args.start_symbol_id,
          args.end_symbol_id,
          maxDepth,
          traversalOptions
        );

        const formattedPaths = await Promise.all(
          paths.map(async path => ({
            path_ids: path,
            distance: path.length - 1,
            call_chain: await transitiveAnalyzer.formatCallChain(path),
          }))
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  start_symbol: {
                    id: startSymbol.id,
                    name: startSymbol.name,
                    file_path: startSymbol.file?.path,
                  },
                  end_symbol: {
                    id: endSymbol.id,
                    name: endSymbol.name,
                    file_path: endSymbol.file?.path,
                  },
                  paths: formattedPaths,
                  total_paths: paths.length,
                  analysis_type: 'all_paths',
                  max_depth: maxDepth,
                },
                null,
                2
              ),
            },
          ],
        };
      } else {
        const result = await transitiveAnalyzer.findShortestPath(
          args.start_symbol_id,
          args.end_symbol_id,
          traversalOptions
        );

        if (!result) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    start_symbol: {
                      id: startSymbol.id,
                      name: startSymbol.name,
                      file_path: startSymbol.file?.path,
                    },
                    end_symbol: {
                      id: endSymbol.id,
                      name: endSymbol.name,
                      file_path: endSymbol.file?.path,
                    },
                    path: null,
                    message: 'No path found between symbols',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const callChain = await transitiveAnalyzer.formatCallChain(result.path);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  start_symbol: {
                    id: startSymbol.id,
                    name: startSymbol.name,
                    file_path: startSymbol.file?.path,
                  },
                  end_symbol: {
                    id: endSymbol.id,
                    name: endSymbol.name,
                    file_path: endSymbol.file?.path,
                  },
                  path: {
                    symbol_ids: result.path,
                    distance: result.distance,
                    call_chain: callChain,
                  },
                  analysis_type: 'shortest_path',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    } catch (error) {
      this.logger.error('traceFlow failed', {
        error: (error as Error).message,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: (error as Error).message,
                args,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
