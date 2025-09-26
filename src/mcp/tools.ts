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
      'use_vector parameter removed. Use search_mode instead: "semantic" for vector search, "exact" for lexical, "auto" for hybrid'
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
    const validModes = ['auto', 'exact', 'semantic', 'qualified'];
    if (typeof args.search_mode !== 'string' || !validModes.includes(args.search_mode)) {
      throw new Error('search_mode must be one of: auto, exact, semantic, qualified');
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
  if (args.analysis_type !== undefined) {
    const validTypes = ['quick', 'standard', 'comprehensive'];
    if (typeof args.analysis_type !== 'string' || !validTypes.includes(args.analysis_type)) {
      throw new Error('analysis_type must be one of: quick, standard, comprehensive');
    }
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
  if (args.include_cross_stack !== undefined && typeof args.include_cross_stack !== 'boolean') {
    throw new Error('include_cross_stack must be a boolean');
  }
  if (args.analysis_type !== undefined) {
    const validTypes = ['quick', 'standard', 'comprehensive'];
    if (typeof args.analysis_type !== 'string' || !validTypes.includes(args.analysis_type)) {
      throw new Error('analysis_type must be one of: quick, standard, comprehensive');
    }
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
  if (args.max_depth !== undefined) {
    const maxDepth = Number(args.max_depth);
    if (isNaN(maxDepth) || maxDepth < 1 || maxDepth > 20) {
      throw new Error('max_depth must be a number between 1 and 20');
    }
    args.max_depth = maxDepth;
  }
  if (args.show_call_chains !== undefined && typeof args.show_call_chains !== 'boolean') {
    throw new Error('show_call_chains must be a boolean');
  }
  if (args.analysis_type !== undefined) {
    const validTypes = ['quick', 'standard', 'comprehensive'];
    if (typeof args.analysis_type !== 'string' || !validTypes.includes(args.analysis_type)) {
      throw new Error('analysis_type must be one of: quick, standard, comprehensive');
    }
  }
  return args as ImpactOfArgs;
}

/**
 * Groups dependencies by call site (line number and method name) to reduce verbosity
 * while preserving all polymorphic relationship information
 */
function groupDependenciesByCallSite(dependencies: any[]): any {
  const groupedByLine = new Map<number, any>();

  for (const dep of dependencies) {
    const lineNumber = dep.line_number;
    const methodName = dep.to_symbol?.name;

    if (!methodName) continue;

    const lineKey = `line_${lineNumber}`;

    if (!groupedByLine.has(lineNumber)) {
      groupedByLine.set(lineNumber, {
        line_number: lineNumber,
        method_call: methodName,
        calls: [],
        references: [],
        relationship_count: 0,
        seenRelationships: new Set<string>(), // Track unique relationships
      });
    }

    const group = groupedByLine.get(lineNumber)!;

    // Classify relationship type based on file path and dependency type
    const relationType = classifyRelationshipType(dep);

    const relationshipInfo = {
      id: dep.id,
      type: relationType,
      target: dep.to_symbol.file_path
        ? `${getClassFromFilePath(dep.to_symbol.file_path)}.${methodName}`
        : methodName,
      file_path: dep.to_symbol.file_path,
    };

    // Create unique key for deduplication based on semantic equivalence
    const relationshipKey = `${relationshipInfo.id}:${relationType}:${relationshipInfo.target}:${relationshipInfo.file_path}`;

    // Skip if we've already seen this relationship
    if (group.seenRelationships.has(relationshipKey)) {
      continue;
    }
    group.seenRelationships.add(relationshipKey);

    // Group by dependency type
    if (dep.type === 'calls' || dep.dependency_type === 'calls') {
      group.calls.push(relationshipInfo);
    } else if (dep.type === 'references' || dep.dependency_type === 'references') {
      group.references.push(relationshipInfo);
    } else {
      // Default to calls for other types
      group.calls.push(relationshipInfo);
    }

    group.relationship_count++;
  }

  // Convert to object format
  const result: any = {};
  for (const [lineNumber, group] of groupedByLine) {
    const lineKey = `line_${lineNumber}`;

    // Remove internal tracking fields
    delete group.relationship_count;
    delete group.seenRelationships;

    result[lineKey] = group;
  }

  return result;
}

/**
 * Classifies the type of relationship based on file path and context
 */
function classifyRelationshipType(dependency: any): string {
  const filePath = dependency.to_symbol?.file_path || '';
  const fileName = filePath.split('/').pop() || '';

  // Interface detection
  if (fileName.startsWith('I') && fileName.includes('.cs')) {
    return 'interface';
  }

  // Abstract class detection
  if (fileName.toLowerCase().includes('abstract')) {
    return 'abstract';
  }

  // Implementation detection (concrete classes)
  if (fileName.includes('.cs') && !fileName.startsWith('I')) {
    return 'implementation';
  }

  // Self-reference detection could be added based on calling context
  // For now, default to implementation
  return 'implementation';
}

/**
 * Extracts class name from file path
 */
function getClassFromFilePath(filePath: string): string {
  const fileName = filePath.split('/').pop() || '';
  return fileName.replace(/\.(cs|ts|js|php)$/, '');
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
  search_mode?: 'auto' | 'exact' | 'semantic' | 'qualified';
}

export interface WhoCallsArgs {
  symbol_id: number;
  dependency_type?: string;
  include_cross_stack?: boolean;
  analysis_type?: 'quick' | 'standard' | 'comprehensive';
}

export interface ListDependenciesArgs {
  symbol_id: number;
  dependency_type?: string;
  include_cross_stack?: boolean;
  analysis_type?: 'quick' | 'standard' | 'comprehensive';
}

// Comprehensive impact analysis interface (Phase 6A)
export interface ImpactOfArgs {
  symbol_id: number;
  frameworks?: string[]; // Multi-framework impact: ['vue', 'laravel', 'react', 'node']
  max_depth?: number; // Transitive depth (default 5)
  show_call_chains?: boolean; // Include human-readable call chains
  analysis_type?: 'quick' | 'standard' | 'comprehensive';
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
  // Call chain visualization fields (Enhancement 1)
  call_chain?: string;
  depth?: number;
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

  // Helper method to get analysis settings based on analysis_type (per PARAMETER_REDUNDANCY_ANALYSIS)
  private getAnalysisSettings(analysisType: 'quick' | 'standard' | 'comprehensive') {
    switch (analysisType) {
      case 'quick':
        return {
          maxDepth: 2,
          includeIndirect: false, // quick analysis skips transitive
        };
      case 'comprehensive':
        return {
          maxDepth: 10,
          includeIndirect: true,
        };
      case 'standard':
      default:
        return {
          maxDepth: 5,
          includeIndirect: true,
        };
    }
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
   * Core Tool 2: getSymbol - Get details about a specific symbol including its dependencies
   * Always includes dependencies and callers (simplified interface)
   *
   * @param args.symbol_id - The ID of the symbol to retrieve
   * @returns Symbol details with dependencies and callers
   */
  async getSymbol(args: any) {
    const validatedArgs = validateGetSymbolArgs(args);

    const symbol = await this.dbService.getSymbolWithFile(validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    // Always include dependencies and callers (parameters removed per PARAMETER_REDUNDANCY_ANALYSIS)
    const dependencies = await this.dbService.getDependenciesFrom(validatedArgs.symbol_id);
    const callers = await this.dbService.getDependenciesTo(validatedArgs.symbol_id);

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
              // Always group results by default (group_results parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
              dependencies: groupDependenciesByCallSite(
                dependencies.map(dep => ({
                  id: dep.id,
                  type: dep.dependency_type,
                  dependency_type: dep.dependency_type,
                  line_number: dep.line_number,
                  to_symbol: dep.to_symbol
                    ? {
                        id: dep.to_symbol.id,
                        name: dep.to_symbol.name,
                        type: dep.to_symbol.symbol_type,
                        file_path: dep.to_symbol.file?.path,
                      }
                    : null,
                }))
              ),
              // Always group results by default (group_results parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
              callers: groupDependenciesByCallSite(
                callers.map(caller => ({
                  id: caller.id,
                  type: caller.dependency_type,
                  dependency_type: caller.dependency_type,
                  line_number: caller.line_number,
                  to_symbol: caller.from_symbol
                    ? {
                        id: caller.from_symbol.id,
                        name: caller.from_symbol.name,
                        type: caller.from_symbol.symbol_type,
                        file_path: caller.from_symbol.file?.path,
                      }
                    : null,
                }))
              ),
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Core Tool 3: searchCode - Enhanced search for code symbols with framework awareness
   * Supports multi-mode search: exact (lexical), semantic (vector), auto (hybrid), qualified (namespace-aware)
   *
   * @param args.query - The search query (symbol name or pattern)
   * @param args.entity_types - Framework-aware entity types: route, model, controller, component, job, function, class, interface
   * @param args.framework - Filter by framework type: laravel, vue, react, node
   * @param args.is_exported - Filter by exported symbols only
   * @param args.repo_ids - Repository IDs to search in
   * @param args.search_mode - Search mode: auto (hybrid), exact (lexical), semantic (vector), qualified (namespace-aware)
   * @returns List of matching symbols with framework context
   */
  async searchCode(args: any) {
    const validatedArgs = validateSearchCodeArgs(args);
    this.logger.debug('Enhanced search with framework awareness', validatedArgs);

    // Use repo_ids or default repo (repo_id parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
    const defaultRepoId = await this.getDefaultRepoId();
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
      limit: 100, // Fixed limit (limit parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
      symbolTypes: [],
      isExported: validatedArgs.is_exported,
      framework: detectedFramework, // Use detected framework
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
          default:
            return s.file?.path?.includes(frameworkPath);
        }
      });
    }

    // Apply default limit (limit parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
    const limit = 100;
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
                // Deprecated parameters removed per PARAMETER_REDUNDANCY_ANALYSIS: symbol_type, use_vector, include_qualified, class_context, namespace_context
              },
              search_options: {
                entity_types: validatedArgs.entity_types,
                framework: detectedFramework,
                is_exported: validatedArgs.is_exported,
                repo_ids: repoIds,
                search_mode: validatedArgs.search_mode,
                // Deprecated parameters removed per PARAMETER_REDUNDANCY_ANALYSIS: symbol_type, use_vector, include_qualified, class_context, namespace_context
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
   * @returns Simple dependency list with caller information
   */
  async whoCalls(args: any) {
    const validatedArgs = validateWhoCallsArgs(args);
    this.logger.debug('Finding who calls symbol with enhanced context', validatedArgs);

    const timeoutMs = 10000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('whoCalls operation timed out after 10 seconds')),
        timeoutMs
      );
    });

    try {
      const symbol = (await Promise.race([
        this.dbService.getSymbol(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      let callers = (await Promise.race([
        this.dbService.getDependenciesToWithContext(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;

      if (validatedArgs.dependency_type) {
        const depType = validatedArgs.dependency_type as DependencyType;
        callers = callers.filter(caller => caller.dependency_type === depType);
      }

      let transitiveResults: any[] = [];

      // Use analysis_type to determine smart defaults (replaces include_indirect parameter per PARAMETER_REDUNDANCY_ANALYSIS)
      const analysisType = validatedArgs.analysis_type || 'standard';
      const analysisSettings = this.getAnalysisSettings(analysisType);

      const skipTransitive =
        callers.length > 20 ||
        validatedArgs.include_cross_stack ||
        !analysisSettings.includeIndirect;

      // Include indirect callers based on analysis_type
      if (!skipTransitive && analysisSettings.includeIndirect) {
        try {
          const transitiveOptions: TransitiveAnalysisOptions = {
            maxDepth: analysisSettings.maxDepth,
            includeTypes: validatedArgs.dependency_type
              ? [validatedArgs.dependency_type as DependencyType]
              : undefined,
            includeCrossStack: false,
            showCallChains: true, // Always true (show_call_chains parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
          };

          const transitiveResult = await transitiveAnalyzer.getTransitiveCallers(
            validatedArgs.symbol_id,
            transitiveOptions
          );

          transitiveResults = transitiveResult.results;

          // Always include indirect dependencies (include_indirect parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
          if (true) {
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

            // Deduplicate before merging to prevent duplicate relationships
            const deduplicatedTransitive = this.deduplicateRelationships(
              transitiveDependencies,
              callers
            );
            callers = [...callers, ...deduplicatedTransitive];
          }
        } catch (error) {
          this.logger.error('Enhanced transitive caller analysis failed', {
            symbol_id: validatedArgs.symbol_id,
            error: (error as Error).message,
          });
        }
      }

      // Apply symbol consolidation to handle interface/implementation relationships
      callers = this.consolidateRelatedSymbols(callers);

      // Enhanced whoCalls with parameter analysis but mathematically accurate insights
      const parameterAnalysis = await this.getParameterContextAnalysis(validatedArgs.symbol_id);

      const result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                dependencies: callers.map(caller => ({
                  from: caller.from_symbol?.name || 'unknown',
                  to: symbol.name,
                  type: caller.dependency_type,
                  line_number: caller.line_number,
                  file_path: caller.from_symbol?.file?.path,
                })),
                total_count: callers.length,
                parameter_analysis: parameterAnalysis,
                query_info: {
                  symbol: symbol.name,
                  analysis_type: 'whoCalls',
                  timestamp: new Date().toISOString(),
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
   * @returns Simple dependency list with dependency information
   */
  async listDependencies(args: any) {
    const validatedArgs = validateListDependenciesArgs(args);
    this.logger.debug('Listing dependencies for symbol', validatedArgs);

    const timeoutMs = 10000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('listDependencies operation timed out after 10 seconds')),
        timeoutMs
      );
    });

    try {
      const symbol = (await Promise.race([
        this.dbService.getSymbol(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      let dependencies = (await Promise.race([
        this.dbService.getDependenciesFrom(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;

      // Filter by dependency type if specified
      if (validatedArgs.dependency_type) {
        const depType = validatedArgs.dependency_type as DependencyType;
        dependencies = dependencies.filter(dep => dep.dependency_type === depType);
      }

      let transitiveResults: any[] = [];

      // Use analysis_type to determine smart defaults (replaces include_indirect parameter per PARAMETER_REDUNDANCY_ANALYSIS)
      const analysisType = validatedArgs.analysis_type || 'standard';
      const analysisSettings = this.getAnalysisSettings(analysisType);

      const skipTransitive =
        dependencies.length > 20 ||
        validatedArgs.include_cross_stack ||
        !analysisSettings.includeIndirect;

      // Include indirect dependencies based on analysis_type
      if (!skipTransitive && analysisSettings.includeIndirect) {
        try {
          const transitiveOptions: TransitiveAnalysisOptions = {
            maxDepth: analysisSettings.maxDepth,
            includeTypes: validatedArgs.dependency_type
              ? [validatedArgs.dependency_type as DependencyType]
              : undefined,
            includeCrossStack: false,
            showCallChains: true, // Always true (show_call_chains parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
          };

          const transitiveResult = (await Promise.race([
            transitiveAnalyzer.getTransitiveDependencies(
              validatedArgs.symbol_id,
              transitiveOptions
            ),
            timeoutPromise,
          ])) as any;

          transitiveResults = transitiveResult.results;

          // If include_indirect is true, merge transitive results with direct dependencies
          // Always include indirect dependencies (include_indirect parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
          if (true) {
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

            // Deduplicate before merging to prevent duplicate relationships
            const deduplicatedTransitive = this.deduplicateRelationships(
              transitiveDependencies,
              dependencies
            );
            dependencies = [...dependencies, ...deduplicatedTransitive];
          }
        } catch (error) {
          this.logger.error('Enhanced transitive dependency analysis failed', {
            symbol_id: validatedArgs.symbol_id,
            error: (error as Error).message,
          });
        }
      }

      // Apply symbol consolidation to handle interface/implementation relationships
      dependencies = this.consolidateRelatedSymbols(dependencies);

      // Phase 4: Simple dependency list format
      const result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                dependencies: dependencies.map(dep => ({
                  from: symbol.name,
                  to: dep.to_symbol?.name || 'unknown',
                  type: dep.dependency_type,
                  line_number: dep.line_number,
                  file_path: dep.to_symbol?.file?.path,
                })),
                total_count: dependencies.length,
                query_info: {
                  symbol: symbol.name,
                  analysis_type: 'dependencies',
                  timestamp: new Date().toISOString(),
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
   * Returns simple dependency list format with transitive impact analysis
   *
   * @param args.symbol_id - The ID of the symbol to analyze impact for
   * @param args.frameworks - Multi-framework impact analysis (default: all detected frameworks)
   * @param args.max_depth - Transitive analysis depth (default: 5, min: 1, max: 20)
   * @param args.page_size - Number of results per page (default: 1000, max: 5000)
   * @param args.cursor - Pagination cursor for next page
   * @param args.detail_level - Response detail level: 'summary', 'standard', or 'full'
   * @returns Comprehensive impact analysis with simple dependency format
   */
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
            relationship_type: caller.dependency_type || 'unknown',
            relationship_context: this.getRelationshipContext(caller),
          });

          const framework = this.determineFramework(caller.from_symbol);
          if (framework) frameworksAffected.add(framework);
        }
      }

      // Deduplicate direct impact items after processing both dependencies and callers
      const deduplicatedDirectImpact = this.deduplicateImpactItems(directImpact);

      // Transitive impact analysis
      const maxDepth = validatedArgs.max_depth || 5;

      try {
        const transitiveOptions: TransitiveAnalysisOptions = {
          maxDepth,
          includeTypes: undefined,
          showCallChains: true, // Always true (show_call_chains parameter removed per PARAMETER_REDUNDANCY_ANALYSIS)
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

      // Always include route, job, and test impact analysis (parameters removed per PARAMETER_REDUNDANCY_ANALYSIS)
      try {
        const routes = await this.getImpactedRoutes(validatedArgs.symbol_id, frameworksAffected);
        routeImpact.push(...routes);
      } catch (error) {
        this.logger.warn('Route impact analysis failed', { error: (error as Error).message });
      }

      try {
        const jobs = await this.getImpactedJobs(validatedArgs.symbol_id);
        jobImpact.push(...jobs);
      } catch (error) {
        this.logger.warn('Job impact analysis failed', { error: (error as Error).message });
      }

      try {
        const tests = await this.getImpactedTests(validatedArgs.symbol_id);
        testImpact.push(...tests);
      } catch (error) {
        this.logger.warn('Test impact analysis failed', { error: (error as Error).message });
      }

      // Deduplicate transitive impact items, excluding those already in direct impact
      const deduplicatedTransitiveImpact = this.deduplicateImpactItems(
        transitiveImpact.filter(
          item => !deduplicatedDirectImpact.some(directItem => directItem.id === item.id)
        )
      );

      // Calculate overall impact score using deduplicated data
      const allImpactItems = [...deduplicatedDirectImpact, ...deduplicatedTransitiveImpact];

      // Phase 4: Simple dependency list format for impact analysis
      // Create dependency mappings with actual line numbers from original dependency records
      const directImpactDependencies = this.createImpactDependencies(
        deduplicatedDirectImpact,
        symbol.name,
        'impacts',
        [...directDependencies, ...directCallers]
      );

      const transitiveImpactDependencies = this.createImpactDependencies(
        deduplicatedTransitiveImpact,
        symbol.name,
        'impacts_indirect',
        []
      );

      const allImpactDependencies = [
        ...directImpactDependencies,
        ...transitiveImpactDependencies,
        ...routeImpact.map(route => ({
          from: route.path,
          to: symbol.name,
          type: 'route_impact' as const,
          line_number: 0,
          file_path: '',
        })),
        ...jobImpact.map(job => ({
          from: job.name,
          to: symbol.name,
          type: 'job_impact' as const,
          line_number: 0,
          file_path: '',
        })),
        ...testImpact.map(test => ({
          from: test.name,
          to: symbol.name,
          type: 'test_impact' as const,
          line_number: 0,
          file_path: test.file_path || '',
        })),
      ];

      // Final deduplication of impact dependencies to eliminate any remaining duplicates
      const deduplicatedImpactDependencies =
        this.deduplicateImpactDependencies(allImpactDependencies);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                dependencies: deduplicatedImpactDependencies,
                total_count: deduplicatedImpactDependencies.length,
                query_info: {
                  symbol: symbol.name,
                  analysis_type: 'impact',
                  timestamp: new Date().toISOString(),
                  frameworks_affected: Array.from(frameworksAffected),
                },
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
   * Prioritizes by impact type specificity
   */
  private shouldReplaceImpactItem(existing: ImpactItem, candidate: ImpactItem): boolean {
    // Priority: More specific impact type
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

  // mergeAndRankResults method removed (unused and contained deprecated parameters per PARAMETER_REDUNDANCY_ANALYSIS)

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
   * Deduplicate relationships to prevent duplicate entries in analysis results
   * Compares relationships based on semantic equivalence rather than just ID
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
   * Create a unique key for a relationship based on semantic equivalence
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
   * Deduplicate call chains to prevent identical entries in transitive analysis
   */
  private deduplicateCallChains(callChains: any[]): any[] {
    const uniqueChains = new Map<string, any>();

    for (const chain of callChains) {
      // Create key based on symbol_id and call_chain content
      const key = `${chain.symbol_id}:${chain.call_chain}:${chain.depth}`;

      if (!uniqueChains.has(key)) {
        uniqueChains.set(key, chain);
      }
    }

    return Array.from(uniqueChains.values());
  }

  /**
   * Consolidate symbols that represent the same logical entity (interface + implementations)
   */
  private consolidateRelatedSymbols(relationships: any[]): any[] {
    const symbolGroups = new Map<string, any[]>();

    // Group relationships by method name and signature
    for (const rel of relationships) {
      const symbolName = rel.to_symbol?.name || rel.from_symbol?.name;
      if (!symbolName) continue;

      const key = symbolName; // Could be enhanced to include signature matching
      if (!symbolGroups.has(key)) {
        symbolGroups.set(key, []);
      }
      symbolGroups.get(key)!.push(rel);
    }

    const consolidated: any[] = [];

    // For each group, keep the most representative relationship
    for (const [methodName, group] of symbolGroups) {
      if (group.length === 1) {
        consolidated.push(group[0]);
        continue;
      }

      // Prefer implementation over interface, public over private
      const representative = group.reduce((best, current) => {
        const currentSymbol = current.to_symbol || current.from_symbol;
        const bestSymbol = best.to_symbol || best.from_symbol;

        // Prefer public visibility
        if (currentSymbol?.visibility === 'public' && bestSymbol?.visibility !== 'public') {
          return current;
        }

        // Prefer implementation over interface (heuristic: non-interface file paths)
        const currentPath = currentSymbol?.file?.path || '';
        const bestPath = bestSymbol?.file?.path || '';

        if (!currentPath.includes('interface') && bestPath.includes('interface')) {
          return current;
        }

        return best;
      });

      consolidated.push(representative);
    }

    return consolidated;
  }

  /**
   * Get parameter context analysis for a symbol
   * Enhancement 2: Context-Specific Analysis
   */
  private async getParameterContextAnalysis(symbolId: number): Promise<any> {
    try {
      this.logger.debug('Getting parameter context analysis', { symbolId });
      const analysis = await this.dbService.groupCallsByParameterContext(symbolId);

      this.logger.debug('Parameter context analysis result', {
        symbolId,
        totalCalls: analysis.totalCalls,
        hasParameterVariations: analysis.parameterVariations?.length > 0,
        methodName: analysis.methodName,
      });

      if (analysis.totalCalls === 0) {
        this.logger.debug('No parameter context data found', { symbolId });
        return undefined; // No parameter context data available
      }

      return {
        method_name: analysis.methodName,
        total_calls: analysis.totalCalls,
        total_variations: analysis.parameterVariations.length,
        parameter_variations: analysis.parameterVariations.map(variation => ({
          parameters: variation.parameter_context,
          call_count: variation.call_count,
          usage_locations: variation.callers.map(caller => ({
            caller: caller.caller_name,
            file: caller.file_path,
            line: caller.line_number,
          })),
          call_instance_ids: variation.call_instance_ids,
        })),
        insights: this.generateParameterInsights(analysis.parameterVariations),
      };
    } catch (error) {
      this.logger.warn('Parameter context analysis failed', {
        symbolId,
        error: (error as Error).message,
      });
      return undefined;
    }
  }

  /**
   * Generate advanced insights about parameter usage patterns
   * Enhanced with pattern complexity analysis and risk assessment
   */
  private generateParameterInsights(variations: any[]): string[] {
    const insights: string[] = [];

    if (variations.length === 0) {
      insights.push('No parameter usage data available');
      return insights;
    }

    if (variations.length === 1) {
      const single = variations[0];
      insights.push(
        `Method consistently called with pattern: "${single.parameter_context}" (${single.call_count} calls)`
      );
    } else {
      insights.push(`Method called with ${variations.length} different parameter patterns`);
    }

    // Advanced null usage analysis
    const nullUsageVariations = variations.filter(v =>
      v.parameter_context.toLowerCase().includes('null')
    );
    if (nullUsageVariations.length > 0) {
      const nullCallCount = nullUsageVariations.reduce((sum, v) => sum + v.call_count, 0);
      const totalCalls = variations.reduce((sum, v) => sum + v.call_count, 0);
      const nullPercentage = Math.round((nullCallCount / totalCalls) * 100);
      insights.push(
        `${nullUsageVariations.length} pattern(s) use null parameters (${nullPercentage}% of all calls)`
      );
    }

    // Enhanced frequency analysis with statistical significance
    if (variations.length > 1) {
      const sortedByFrequency = [...variations].sort((a, b) => b.call_count - a.call_count);
      const mostCommon = sortedByFrequency[0];
      const secondMostCommon = sortedByFrequency[1];
      const totalCalls = variations.reduce((sum, v) => sum + v.call_count, 0);

      // Check if all patterns have exactly equal frequency
      const allEqual = variations.every(v => v.call_count === mostCommon.call_count);

      if (allEqual) {
        insights.push(`All parameter patterns used equally (${mostCommon.call_count} calls each)`);
      } else {
        // Only claim "most common" when there's a statistically significant difference (>20% more calls)
        const significanceThreshold = Math.max(1, Math.ceil(totalCalls * 0.2));

        if (mostCommon.call_count >= secondMostCommon.call_count + significanceThreshold) {
          const dominancePercentage = Math.round((mostCommon.call_count / totalCalls) * 100);
          insights.push(
            `Most common pattern: "${mostCommon.parameter_context}" (${mostCommon.call_count} calls, ${dominancePercentage}%)`
          );
        } else {
          // When frequencies are similar, report the distribution more accurately
          const freqGroups = new Map<number, string[]>();
          variations.forEach(v => {
            if (!freqGroups.has(v.call_count)) {
              freqGroups.set(v.call_count, []);
            }
            freqGroups.get(v.call_count)!.push(`"${v.parameter_context}"`);
          });

          const freqDescription = Array.from(freqGroups.entries())
            .sort(([a], [b]) => b - a)
            .map(([count, patterns]) => `${patterns.length} pattern(s) with ${count} calls`)
            .join(', ');

          insights.push(`Similar usage frequency: ${freqDescription}`);
        }
      }
    }

    // Pattern complexity analysis
    const complexPatterns = variations.filter(v => {
      const paramCount = v.parameter_context.split(',').length;
      return paramCount > 3 || v.parameter_context.length > 50;
    });
    if (complexPatterns.length > 0) {
      insights.push(
        `${complexPatterns.length} pattern(s) have high complexity (many parameters or long expressions)`
      );
    }

    // Parameter consistency assessment
    const uniqueParameterCounts = new Set(
      variations.map(v => v.parameter_context.split(',').length)
    );
    if (uniqueParameterCounts.size > 1) {
      const counts = Array.from(uniqueParameterCounts).sort((a, b) => a - b);
      insights.push(
        `Parameter count varies: ${counts.join(', ')} parameters across different calls`
      );
    }

    return insights;
  }

  /**
   * Perform search based on the new search_mode parameter
   * Replaces the old use_vector logic with improved search mode handling
   */
  private async performSearchByMode(
    query: string,
    repoId: number,
    searchOptions: any,
    searchMode: 'auto' | 'exact' | 'semantic' | 'qualified' = 'auto'
  ) {
    switch (searchMode) {
      case 'semantic':
        try {
          return await this.dbService.vectorSearchSymbols(query, repoId, {
            ...searchOptions,
            similarityThreshold: 0.7,
          });
        } catch (error) {
          this.logger.warn('Vector search failed, falling back to fulltext:', error);
          return await this.dbService.fulltextSearchSymbols(query, repoId, searchOptions);
        }

      case 'exact':
        return await this.dbService.lexicalSearchSymbols(query, repoId, searchOptions);

      case 'qualified':
        // Use enhanced search with qualified context
        try {
          return await this.dbService.searchQualifiedContext(query, undefined);
        } catch (error) {
          this.logger.warn('Qualified search failed, falling back to fulltext:', error);
          return await this.dbService.fulltextSearchSymbols(query, repoId, searchOptions);
        }

      case 'auto':
      default:
        // Intelligent auto mode: try semantic first, fallback to fulltext
        try {
          const vectorResults = await this.dbService.vectorSearchSymbols(query, repoId, {
            ...searchOptions,
            similarityThreshold: 0.6,
          });
          if (vectorResults.length > 0) {
            return vectorResults;
          }
        } catch (error) {
          this.logger.debug('Vector search not available, using fulltext:', error);
        }

        return await this.dbService.fulltextSearchSymbols(query, repoId, searchOptions);
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
      // Create composite key: id + file_path + relationship_type for precise deduplication
      const compositeKey = `${item.id}:${item.file_path}:${item.relationship_type || 'unknown'}`;

      if (!seen.has(compositeKey)) {
        seen.add(compositeKey);
        deduplicatedItems.push(item);
      }
    }

    this.logger.debug('Advanced impact deduplication completed', {
      originalCount: items.length,
      deduplicatedCount: deduplicatedItems.length,
      duplicatesRemoved: items.length - deduplicatedItems.length,
    });

    return deduplicatedItems;
  }

  /**
   * Deduplicate impact dependency objects using composite keys
   * This prevents identical dependencies from appearing multiple times in the final output
   */
  private deduplicateImpactDependencies(dependencies: any[]): any[] {
    const seen = new Set<string>();
    const deduplicatedDependencies: any[] = [];

    for (const dep of dependencies) {
      // Create composite key: from + to + type + line_number + file_path for precise deduplication
      const compositeKey = `${dep.from}:${dep.to}:${dep.type}:${dep.line_number}:${dep.file_path}`;

      if (!seen.has(compositeKey)) {
        seen.add(compositeKey);
        deduplicatedDependencies.push(dep);
      }
    }

    this.logger.debug('Impact dependency deduplication completed', {
      originalCount: dependencies.length,
      deduplicatedCount: deduplicatedDependencies.length,
      duplicatesRemoved: dependencies.length - deduplicatedDependencies.length,
    });

    return deduplicatedDependencies;
  }

  /**
   * Create impact dependency objects with actual line numbers from dependency records
   * Enhanced with better symbol resolution and context preservation
   */
  private createImpactDependencies(
    impactItems: ImpactItem[],
    targetSymbolName: string,
    impactType: string,
    originalDependencies: any[]
  ): any[] {
    return impactItems.map(item => {
      // Enhanced dependency lookup with multiple matching strategies
      const originalDep = originalDependencies.find(dep => {
        const symbolId = dep.to_symbol?.id || dep.from_symbol?.id;
        const symbolName = dep.to_symbol?.name || dep.from_symbol?.name;
        const filePath = dep.to_symbol?.file?.path || dep.from_symbol?.file?.path;

        // Multi-criteria matching for better accuracy
        return symbolId === item.id || (symbolName === item.name && filePath === item.file_path);
      });

      return {
        from: item.name,
        to: targetSymbolName,
        type: impactType,
        line_number: originalDep?.line_number || 0,
        file_path: item.file_path,
        // Preserve additional context for better analysis
        relationship_context: item.relationship_context,
      };
    });
  }
}
