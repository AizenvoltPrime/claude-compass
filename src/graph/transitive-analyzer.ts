import type { Knex } from 'knex';
import { getDatabaseConnection } from '../database/connection';
import { DependencyType, DependencyWithSymbols } from '../database/models';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('transitive-analyzer');

export interface TransitiveAnalysisOptions {
  maxDepth?: number;
  includeTypes?: DependencyType[];
  excludeTypes?: DependencyType[];
  includeCrossStack?: boolean;
  showCallChains?: boolean;
}

export interface TransitiveResult {
  symbolId: number;
  path: number[]; // Array of symbol IDs representing the path from root
  depth: number;
  dependencies: DependencyWithSymbols[];
  call_chain?: string; // Human-readable call chain format (when requested)
}

export interface TransitiveAnalysisResult {
  results: TransitiveResult[];
  maxDepthReached: number;
  totalPaths: number;
  cyclesDetected: number;
  executionTimeMs: number;
}

export interface CrossStackOptions {
  maxDepth?: number;
  includeTransitive?: boolean;
}

export interface CrossStackImpactResult {
  symbolId: number;
  frontendImpact: TransitiveResult[];
  backendImpact: TransitiveResult[];
  crossStackRelationships: CrossStackRelationship[];
  totalImpactedSymbols: number;
  executionTimeMs: number;
}

export interface CrossStackRelationship {
  fromSymbol: { id: number; name: string; type: string; language: string };
  toSymbol: { id: number; name: string; type: string; language: string };
  relationshipType: DependencyType;
  path: number[];
}

/**
 * TransitiveAnalyzer provides efficient algorithms for analyzing transitive dependencies
 * and callers in the symbol dependency graph. It implements cycle detection,
 * traversal algorithms, and performance optimization for large codebases.
 */
export class TransitiveAnalyzer {
  private db: Knex;
  private cache: Map<string, TransitiveResult[]> = new Map();
  private readonly MAX_ABSOLUTE_DEPTH = 20; // Hard limit to prevent infinite recursion
  private readonly DEFAULT_MAX_DEPTH = 10;

  constructor() {
    this.db = getDatabaseConnection();
  }

  /**
   * Find all symbols that transitively call the given symbol
   */
  async getTransitiveCallers(
    symbolId: number,
    options: TransitiveAnalysisOptions = {}
  ): Promise<TransitiveAnalysisResult> {
    const startTime = Date.now();
    const maxDepth = Math.min(options.maxDepth || this.DEFAULT_MAX_DEPTH, this.MAX_ABSOLUTE_DEPTH);
    const includeCrossStack = options.includeCrossStack || false;

    if (includeCrossStack) {
      return this.traverseCallersWithCrossStack(symbolId, options);
    } else {
      return this.traverseCallersOriginal(symbolId, options);
    }
  }

  /**
   * Original caller traversal method without cross-stack support
   */
  private async traverseCallersOriginal(
    symbolId: number,
    options: TransitiveAnalysisOptions
  ): Promise<TransitiveAnalysisResult> {
    const startTime = Date.now();
    const maxDepth = Math.min(options.maxDepth || this.DEFAULT_MAX_DEPTH, this.MAX_ABSOLUTE_DEPTH);
    // Process all dependencies for comprehensive analysis

    const visited = new Set<number>();
    const cycles = new Set<string>();
    const results: TransitiveResult[] = [];
    let maxDepthReached = 0;

    await this.traverseCallers(symbolId, [], 0, maxDepth, visited, cycles, results, options);

    maxDepthReached = Math.max(...results.map(r => r.depth), 0);

    const enhancedResults = await this.enhanceResultsWithCallChains(
      results,
      options.showCallChains || false
    );

    return {
      results: enhancedResults,
      maxDepthReached,
      totalPaths: enhancedResults.length,
      cyclesDetected: cycles.size,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Cross-stack transitive caller analysis with cross-language traversal
   */
  private async traverseCallersWithCrossStack(
    symbolId: number,
    options: TransitiveAnalysisOptions
  ): Promise<TransitiveAnalysisResult> {
    const startTime = Date.now();
    const maxDepth = Math.min(options.maxDepth || this.DEFAULT_MAX_DEPTH, this.MAX_ABSOLUTE_DEPTH);

    const visited = new Set<number>();
    const cycles = new Set<string>();
    const results: TransitiveResult[] = [];
    let maxDepthReached = 0;

    const enhancedOptions: TransitiveAnalysisOptions = {
      ...options,
      includeTypes: options.includeTypes
        ? [
            ...options.includeTypes,
            DependencyType.API_CALL,
            DependencyType.SHARES_SCHEMA,
            DependencyType.FRONTEND_BACKEND,
          ]
        : undefined,
    };

    await this.traverseCallersWithCrossStackSupport(
      symbolId,
      [],
      0,
      maxDepth,
      visited,
      cycles,
      results,
      enhancedOptions
    );

    maxDepthReached = Math.max(...results.map(r => r.depth), 0);

    const enhancedResults = await this.enhanceResultsWithCallChains(
      results,
      options.showCallChains || false
    );

    return {
      results: enhancedResults,
      maxDepthReached,
      totalPaths: enhancedResults.length,
      cyclesDetected: cycles.size,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Cross-stack aware traversal method for analyzing dependencies across language boundaries
   */
  private async traverseCallersWithCrossStackSupport(
    symbolId: number,
    currentPath: number[],
    currentDepth: number,
    maxDepth: number,
    visited: Set<number>,
    cycles: Set<string>,
    results: TransitiveResult[],
    options: TransitiveAnalysisOptions
  ): Promise<void> {
    // Stop if we've reached max depth
    if (currentDepth >= maxDepth) {
      return;
    }

    // Process all dependencies for comprehensive analysis

    // Cycle detection
    if (visited.has(symbolId)) {
      const cycleKey = [...currentPath, symbolId].sort().join('-');
      cycles.add(cycleKey);
      return;
    }

    visited.add(symbolId);

    try {
      const regularCallers = await this.getDirectCallers(symbolId, options);
      const crossStackCallers = await this.getCrossStackCallers(symbolId);

      for (const caller of regularCallers) {
        if (!caller.from_symbol) continue;

        const fromSymbolId = caller.from_symbol.id;
        const newPath = [...currentPath, symbolId];

        results.push({
          symbolId: fromSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          dependencies: [caller],
        });

        const newVisited = new Set(visited);
        await this.traverseCallersWithCrossStackSupport(
          fromSymbolId,
          newPath,
          currentDepth + 1,
          maxDepth,
          newVisited,
          cycles,
          results,
          options
        );
      }

      for (const caller of crossStackCallers) {
        if (!caller.from_symbol) continue;

        const fromSymbolId = caller.from_symbol.id;
        const newPath = [...currentPath, symbolId];

        results.push({
          symbolId: fromSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          dependencies: [caller],
        });

        await this.traverseCallersWithCrossStackSupport(
          fromSymbolId,
          newPath,
          currentDepth + 1,
          maxDepth,
          visited,
          cycles,
          results,
          options
        );
      }
    } catch (error) {
      logger.error('Error traversing cross-stack callers', {
        symbolId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      visited.delete(symbolId);
    }
  }

  /**
   * Find all symbols that the given symbol transitively depends on
   */
  async getTransitiveDependencies(
    symbolId: number,
    options: TransitiveAnalysisOptions = {}
  ): Promise<TransitiveAnalysisResult> {
    const startTime = Date.now();
    const maxDepth = Math.min(options.maxDepth || this.DEFAULT_MAX_DEPTH, this.MAX_ABSOLUTE_DEPTH);
    // Process all dependencies for comprehensive analysis

    const visited = new Set<number>();
    const cycles = new Set<string>();
    const results: TransitiveResult[] = [];
    let maxDepthReached = 0;

    await this.traverseDependencies(symbolId, [], 0, maxDepth, visited, cycles, results, options);

    maxDepthReached = Math.max(...results.map(r => r.depth), 0);

    const enhancedResults = await this.enhanceResultsWithCallChains(
      results,
      options.showCallChains || false
    );

    return {
      results: enhancedResults,
      maxDepthReached,
      totalPaths: enhancedResults.length,
      cyclesDetected: cycles.size,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Recursively traverse callers (symbols that depend on this symbol)
   */
  private async traverseCallers(
    symbolId: number,
    currentPath: number[],
    currentDepth: number,
    maxDepth: number,
    visited: Set<number>,
    cycles: Set<string>,
    results: TransitiveResult[],
    options: TransitiveAnalysisOptions
  ): Promise<void> {
    // Stop if we've reached max depth
    if (currentDepth >= maxDepth) {
      return;
    }

    // Process all dependencies for comprehensive analysis

    // Cycle detection
    if (visited.has(symbolId)) {
      const cycleKey = [...currentPath, symbolId].sort().join('-');
      cycles.add(cycleKey);
      return;
    }

    visited.add(symbolId);

    try {
      const callers = await this.getDirectCallers(symbolId, options);

      for (const caller of callers) {
        if (!caller.from_symbol) continue;

        const fromSymbolId = caller.from_symbol.id;
        const newPath = [...currentPath, symbolId];

        results.push({
          symbolId: fromSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          dependencies: [caller],
        });

        const newVisited = new Set(visited);
        await this.traverseCallers(
          fromSymbolId,
          newPath,
          currentDepth + 1,
          maxDepth,
          newVisited,
          cycles,
          results,
          options
        );
      }
    } catch (error) {
      logger.error('Error traversing callers', {
        symbolId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      visited.delete(symbolId);
    }
  }

  /**
   * Recursively traverse dependencies (symbols this symbol depends on)
   */
  private async traverseDependencies(
    symbolId: number,
    currentPath: number[],
    currentDepth: number,
    maxDepth: number,
    visited: Set<number>,
    cycles: Set<string>,
    results: TransitiveResult[],
    options: TransitiveAnalysisOptions
  ): Promise<void> {
    // Stop if we've reached max depth
    if (currentDepth >= maxDepth) {
      return;
    }

    // Process all dependencies for comprehensive analysis

    // Cycle detection
    if (visited.has(symbolId)) {
      const cycleKey = [...currentPath, symbolId].sort().join('-');
      cycles.add(cycleKey);
      return;
    }

    visited.add(symbolId);

    try {
      const dependencies = await this.getDirectDependencies(symbolId, options);

      for (const dependency of dependencies) {
        if (!dependency.to_symbol) continue;

        const toSymbolId = dependency.to_symbol.id;
        const newPath = [...currentPath, symbolId];

        results.push({
          symbolId: toSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          dependencies: [dependency],
        });

        const newVisited = new Set(visited);
        await this.traverseDependencies(
          toSymbolId,
          newPath,
          currentDepth + 1,
          maxDepth,
          newVisited,
          cycles,
          results,
          options
        );
      }
    } catch (error) {
      logger.error('Error traversing dependencies', {
        symbolId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      visited.delete(symbolId);
    }
  }

  /**
   * Get cross-stack transitive impact analysis for a symbol
   */
  async getCrossStackTransitiveImpact(
    symbolId: number,
    options: CrossStackOptions = {}
  ): Promise<CrossStackImpactResult> {
    const startTime = Date.now();
    const maxDepth = Math.min(options.maxDepth || this.DEFAULT_MAX_DEPTH, this.MAX_ABSOLUTE_DEPTH);

    const frontendOptions: TransitiveAnalysisOptions = {
      maxDepth,
      includeCrossStack: true,
      includeTypes: [
        DependencyType.API_CALL,
        DependencyType.SHARES_SCHEMA,
        DependencyType.FRONTEND_BACKEND,
      ],
    };

    const frontendImpactResult = options.includeTransitive
      ? await this.getTransitiveCallers(symbolId, frontendOptions)
      : { results: [], maxDepthReached: 0, totalPaths: 0, cyclesDetected: 0, executionTimeMs: 0 };

    const backendOptions: TransitiveAnalysisOptions = {
      maxDepth,
      includeCrossStack: true,
      includeTypes: [
        DependencyType.API_CALL,
        DependencyType.SHARES_SCHEMA,
        DependencyType.FRONTEND_BACKEND,
      ],
    };

    const backendImpactResult = options.includeTransitive
      ? await this.getTransitiveDependencies(symbolId, backendOptions)
      : { results: [], maxDepthReached: 0, totalPaths: 0, cyclesDetected: 0, executionTimeMs: 0 };

    const crossStackRelationships = await this.getCrossStackRelationships(symbolId);

    const executionTime = Date.now() - startTime;

    return {
      symbolId,
      frontendImpact: frontendImpactResult.results,
      backendImpact: backendImpactResult.results,
      crossStackRelationships,
      totalImpactedSymbols:
        frontendImpactResult.results.length + backendImpactResult.results.length,
      executionTimeMs: executionTime,
    };
  }

  /**
   * Get cross-stack callers (symbols from different language stacks that call this symbol)
   */
  private async getCrossStackCallers(symbolId: number): Promise<DependencyWithSymbols[]> {
    const depsQuery = this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
      .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
      .where('dependencies.to_symbol_id', symbolId)
      .whereIn('dependencies.dependency_type', [
        DependencyType.API_CALL,
        DependencyType.SHARES_SCHEMA,
        DependencyType.FRONTEND_BACKEND,
      ])
      .select(
        'dependencies.*',
        'from_symbols.id as from_symbol_id',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path',
        'from_files.language as from_language',
        'to_symbols.id as to_symbol_id',
        'to_symbols.name as to_symbol_name',
        'to_symbols.symbol_type as to_symbol_type',
        'to_files.path as to_file_path',
        'to_files.language as to_language'
      )
      .orderBy('dependencies.id', 'desc');

    const apiCallsQuery = this.db('api_calls')
      .leftJoin('symbols as caller_symbols', 'api_calls.caller_symbol_id', 'caller_symbols.id')
      .leftJoin('files as caller_files', 'caller_symbols.file_id', 'caller_files.id')
      .leftJoin('symbols as endpoint_symbols', 'api_calls.endpoint_symbol_id', 'endpoint_symbols.id')
      .leftJoin('files as endpoint_files', 'endpoint_symbols.file_id', 'endpoint_files.id')
      .where('api_calls.endpoint_symbol_id', symbolId)
      .select(
        'api_calls.id',
        'api_calls.caller_symbol_id as from_symbol_id',
        'api_calls.endpoint_symbol_id as to_symbol_id',
        'api_calls.line_number',
        'api_calls.created_at',
        'api_calls.updated_at',
        'caller_symbols.name as from_symbol_name',
        'caller_symbols.symbol_type as from_symbol_type',
        'caller_files.path as from_file_path',
        'caller_files.language as from_language',
        'endpoint_symbols.name as to_symbol_name',
        'endpoint_symbols.symbol_type as to_symbol_type',
        'endpoint_files.path as to_file_path',
        'endpoint_files.language as to_language'
      );

    const [depsResults, apiCallsResults] = await Promise.all([depsQuery, apiCallsQuery]);

    const depsFormatted = depsResults.map(row => ({
      id: row.id,
      from_symbol_id: row.from_symbol_id,
      to_symbol_id: row.to_symbol_id,
      dependency_type: row.dependency_type,
      line_number: row.line_number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      from_symbol: row.from_symbol_id
        ? {
            id: row.from_symbol_id,
            name: row.from_symbol_name,
            symbol_type: row.from_symbol_type,
            file: row.from_file_path
              ? {
                  path: row.from_file_path,
                  language: row.from_language,
                }
              : undefined,
          }
        : undefined,
      to_symbol: row.to_symbol_id
        ? {
            id: row.to_symbol_id,
            name: row.to_symbol_name,
            symbol_type: row.to_symbol_type,
            file: row.to_file_path
              ? {
                  path: row.to_file_path,
                  language: row.to_language,
                }
              : undefined,
          }
        : undefined,
    }));

    // Transform api_calls table results
    const apiCallsFormatted = apiCallsResults.map(row => ({
      id: row.id,
      from_symbol_id: row.from_symbol_id,
      to_symbol_id: row.to_symbol_id,
      dependency_type: DependencyType.API_CALL,
      line_number: row.line_number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      from_symbol: row.from_symbol_id
        ? {
            id: row.from_symbol_id,
            name: row.from_symbol_name,
            symbol_type: row.from_symbol_type,
            file: row.from_file_path
              ? {
                  path: row.from_file_path,
                  language: row.from_language,
                }
              : undefined,
          }
        : undefined,
      to_symbol: row.to_symbol_id
        ? {
            id: row.to_symbol_id,
            name: row.to_symbol_name,
            symbol_type: row.to_symbol_type,
            file: row.to_file_path
              ? {
                  path: row.to_file_path,
                  language: row.to_language,
                }
              : undefined,
          }
        : undefined,
    }));

    // Combine both results
    return [...depsFormatted, ...apiCallsFormatted] as DependencyWithSymbols[];
  }

  /**
   * Get cross-stack relationships for a symbol
   */
  private async getCrossStackRelationships(symbolId: number): Promise<CrossStackRelationship[]> {
    const query = this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
      .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
      .where(function () {
        this.where('dependencies.from_symbol_id', symbolId).orWhere(
          'dependencies.to_symbol_id',
          symbolId
        );
      })
      .whereIn('dependencies.dependency_type', [
        DependencyType.API_CALL,
        DependencyType.SHARES_SCHEMA,
        DependencyType.FRONTEND_BACKEND,
      ])
      .select(
        'dependencies.*',
        'from_symbols.id as from_symbol_id',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path',
        'from_files.language as from_language',
        'to_symbols.id as to_symbol_id',
        'to_symbols.name as to_symbol_name',
        'to_symbols.symbol_type as to_symbol_type',
        'to_files.path as to_file_path',
        'to_files.language as to_language'
      );

    const results = await query;

    return results.map(row => ({
      fromSymbol: {
        id: row.from_symbol_id,
        name: row.from_symbol_name,
        type: row.from_symbol_type,
        language: row.from_language || 'unknown',
      },
      toSymbol: {
        id: row.to_symbol_id,
        name: row.to_symbol_name,
        type: row.to_symbol_type,
        language: row.to_language || 'unknown',
      },
      relationshipType: row.dependency_type,
      path: [], // Will be populated by traversal algorithms
    }));
  }

  /**
   * Get direct callers from database with filtering
   */
  private async getDirectCallers(
    symbolId: number,
    options: TransitiveAnalysisOptions
  ): Promise<DependencyWithSymbols[]> {
    let query = this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
      .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
      .where('dependencies.to_symbol_id', symbolId)
      .select(
        'dependencies.*',
        'from_symbols.id as from_symbol_id',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path',
        'to_symbols.id as to_symbol_id',
        'to_symbols.name as to_symbol_name',
        'to_symbols.symbol_type as to_symbol_type',
        'to_files.path as to_file_path'
      );

    // Apply dependency type filters
    if (options.includeTypes && options.includeTypes.length > 0) {
      query = query.whereIn('dependencies.dependency_type', options.includeTypes);
    }

    if (options.excludeTypes && options.excludeTypes.length > 0) {
      query = query.whereNotIn('dependencies.dependency_type', options.excludeTypes);
    }

    const results = await query;

    return results.map(row => ({
      id: row.id,
      from_symbol_id: row.from_symbol_id,
      to_symbol_id: row.to_symbol_id,
      dependency_type: row.dependency_type,
      line_number: row.line_number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      from_symbol: row.from_symbol_id
        ? {
            id: row.from_symbol_id,
            name: row.from_symbol_name,
            symbol_type: row.from_symbol_type,
            file: row.from_file_path
              ? {
                  path: row.from_file_path,
                }
              : undefined,
          }
        : undefined,
      to_symbol: row.to_symbol_id
        ? {
            id: row.to_symbol_id,
            name: row.to_symbol_name,
            symbol_type: row.to_symbol_type,
            file: row.to_file_path
              ? {
                  path: row.to_file_path,
                }
              : undefined,
          }
        : undefined,
    })) as DependencyWithSymbols[];
  }

  /**
   * Get direct dependencies from database with filtering
   */
  private async getDirectDependencies(
    symbolId: number,
    options: TransitiveAnalysisOptions
  ): Promise<DependencyWithSymbols[]> {
    let depsQuery = this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
      .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
      .where('dependencies.from_symbol_id', symbolId)
      .select(
        'dependencies.*',
        'from_symbols.id as from_symbol_id',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path',
        'to_symbols.id as to_symbol_id',
        'to_symbols.name as to_symbol_name',
        'to_symbols.symbol_type as to_symbol_type',
        'to_files.path as to_file_path'
      );

    // Apply dependency type filters
    if (options.includeTypes && options.includeTypes.length > 0) {
      depsQuery = depsQuery.whereIn('dependencies.dependency_type', options.includeTypes);
    }

    if (options.excludeTypes && options.excludeTypes.length > 0) {
      depsQuery = depsQuery.whereNotIn('dependencies.dependency_type', options.excludeTypes);
    }

    const shouldIncludeApiCalls =
      options.includeCrossStack ||
      (options.includeTypes && options.includeTypes.includes(DependencyType.API_CALL));

    let apiCallsResults: any[] = [];
    if (shouldIncludeApiCalls) {
      const apiCallsQuery = this.db('api_calls')
        .leftJoin('symbols as caller_symbols', 'api_calls.caller_symbol_id', 'caller_symbols.id')
        .leftJoin('files as caller_files', 'caller_symbols.file_id', 'caller_files.id')
        .leftJoin('symbols as endpoint_symbols', 'api_calls.endpoint_symbol_id', 'endpoint_symbols.id')
        .leftJoin('files as endpoint_files', 'endpoint_symbols.file_id', 'endpoint_files.id')
        .where('api_calls.caller_symbol_id', symbolId)
        .select(
          'api_calls.id',
          'api_calls.caller_symbol_id as from_symbol_id',
          'api_calls.endpoint_symbol_id as to_symbol_id',
          'api_calls.line_number',
          'api_calls.created_at',
          'api_calls.updated_at',
          'caller_symbols.name as from_symbol_name',
          'caller_symbols.symbol_type as from_symbol_type',
          'caller_files.path as from_file_path',
          'endpoint_symbols.name as to_symbol_name',
          'endpoint_symbols.symbol_type as to_symbol_type',
          'endpoint_files.path as to_file_path'
        );

      apiCallsResults = await apiCallsQuery;
    }

    const depsResults = await depsQuery;

    const depsFormatted = depsResults.map(row => ({
      id: row.id,
      from_symbol_id: row.from_symbol_id,
      to_symbol_id: row.to_symbol_id,
      dependency_type: row.dependency_type,
      line_number: row.line_number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      from_symbol: row.from_symbol_id
        ? {
            id: row.from_symbol_id,
            name: row.from_symbol_name,
            symbol_type: row.from_symbol_type,
            file: row.from_file_path
              ? {
                  path: row.from_file_path,
                }
              : undefined,
          }
        : undefined,
      to_symbol: row.to_symbol_id
        ? {
            id: row.to_symbol_id,
            name: row.to_symbol_name,
            symbol_type: row.to_symbol_type,
            file: row.to_file_path
              ? {
                  path: row.to_file_path,
                }
              : undefined,
          }
        : undefined,
    }));

    // Transform api_calls table results
    const apiCallsFormatted = apiCallsResults.map(row => ({
      id: row.id,
      from_symbol_id: row.from_symbol_id,
      to_symbol_id: row.to_symbol_id,
      dependency_type: DependencyType.API_CALL,
      line_number: row.line_number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      from_symbol: row.from_symbol_id
        ? {
            id: row.from_symbol_id,
            name: row.from_symbol_name,
            symbol_type: row.from_symbol_type,
            file: row.from_file_path
              ? {
                  path: row.from_file_path,
                }
              : undefined,
          }
        : undefined,
      to_symbol: row.to_symbol_id
        ? {
            id: row.to_symbol_id,
            name: row.to_symbol_name,
            symbol_type: row.to_symbol_type,
            file: row.to_file_path
              ? {
                  path: row.to_file_path,
                }
              : undefined,
          }
        : undefined,
    }));

    // Combine both results
    return [...depsFormatted, ...apiCallsFormatted] as DependencyWithSymbols[];
  }

  /**
   * Format a call chain from symbol ID path to human-readable format
   * Converts [123, 456, 789] to "DeckController._Ready() → InitializeServices() → CardManager.SetHandPositions()"
   */
  async formatCallChain(path: number[]): Promise<string> {
    if (path.length === 0) {
      return '';
    }

    try {
      const symbolNames = await this.resolveSymbolNames(path);
      const apiCallMetadata = await this.resolveApiCallMetadata(path);
      const edgeQualifiedNames = await this.resolveEdgeQualifiedNames(path);

      const chainParts: string[] = [];

      for (let i = 0; i < path.length; i++) {
        const symbolId = path[i];
        const symbolInfo = symbolNames.get(symbolId);

        if (!symbolInfo) {
          chainParts.push(`Symbol(${symbolId})`);
          continue;
        }

        let part = symbolInfo.name;

        if (i > 0) {
          const fromSymbolId = path[i - 1];
          const edgeKey = `${fromSymbolId}->${symbolId}`;
          const qualifiedName = edgeQualifiedNames.get(edgeKey);

          if (qualifiedName) {
            part = qualifiedName;
          } else if (symbolInfo.className && symbolInfo.className !== symbolInfo.name) {
            part = `${symbolInfo.className}.${symbolInfo.name}`;
          }
        } else {
          if (symbolInfo.className && symbolInfo.className !== symbolInfo.name) {
            part = `${symbolInfo.className}.${symbolInfo.name}`;
          }
        }

        if (symbolInfo.isCallable && !part.includes('(')) {
          part += '()';
        }

        if (i > 0 && symbolInfo.filePath !== symbolNames.get(path[i - 1])?.filePath) {
          part += ` (${this.getShortFilePath(symbolInfo.filePath)})`;
        }

        chainParts.push(part);

        if (i < path.length - 1) {
          const fromSymbolId = symbolId;
          const toSymbolId = path[i + 1];
          const edgeKey = `${fromSymbolId}->${toSymbolId}`;
          const apiCall = apiCallMetadata.get(edgeKey);

          if (apiCall) {
            chainParts.push(`[${apiCall.httpMethod} ${apiCall.endpointPath}]`);
          }
        }
      }

      return chainParts.join(' → ');
    } catch (error) {
      logger.warn('Failed to format call chain', {
        path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return `Call chain [${path.join(' → ')}]`;
    }
  }

  /**
   * Resolve API call metadata for edges in the path
   * Returns a map keyed by "fromSymbolId->toSymbolId" with HTTP method and endpoint path
   */
  private async resolveApiCallMetadata(path: number[]): Promise<
    Map<string, { httpMethod: string; endpointPath: string }>
  > {
    const metadataMap = new Map();

    if (path.length < 2) {
      return metadataMap;
    }

    const edges: Array<{ from: number; to: number }> = [];
    for (let i = 0; i < path.length - 1; i++) {
      edges.push({ from: path[i], to: path[i + 1] });
    }

    if (edges.length === 0) {
      return metadataMap;
    }

    let query = this.db('api_calls').select(
      'caller_symbol_id',
      'endpoint_symbol_id',
      'http_method',
      'endpoint_path'
    );

    query = query.where(function () {
      for (const edge of edges) {
        this.orWhere(function () {
          this.where('caller_symbol_id', edge.from).andWhere('endpoint_symbol_id', edge.to);
        });
      }
    });

    const results = await query;

    for (const row of results) {
      const edgeKey = `${row.caller_symbol_id}->${row.endpoint_symbol_id}`;
      metadataMap.set(edgeKey, {
        httpMethod: row.http_method,
        endpointPath: row.endpoint_path,
      });
    }

    return metadataMap;
  }

  /**
   * Resolve qualified names for edges in the path
   * Returns a map keyed by "fromSymbolId->toSymbolId" with the to_qualified_name
   */
  private async resolveEdgeQualifiedNames(path: number[]): Promise<Map<string, string>> {
    const qualifiedNameMap = new Map();

    if (path.length < 2) {
      return qualifiedNameMap;
    }

    const edges: Array<{ from: number; to: number }> = [];
    for (let i = 0; i < path.length - 1; i++) {
      edges.push({ from: path[i], to: path[i + 1] });
    }

    if (edges.length === 0) {
      return qualifiedNameMap;
    }

    let query = this.db('dependencies').select(
      'from_symbol_id',
      'to_symbol_id',
      'to_qualified_name'
    );

    query = query.where(function () {
      for (const edge of edges) {
        this.orWhere(function () {
          this.where('from_symbol_id', edge.from).andWhere('to_symbol_id', edge.to);
        });
      }
    });

    const results = await query;

    for (const row of results) {
      if (row.to_qualified_name) {
        const edgeKey = `${row.from_symbol_id}->${row.to_symbol_id}`;
        qualifiedNameMap.set(edgeKey, row.to_qualified_name);
      }
    }

    return qualifiedNameMap;
  }

  /**
   * Resolve symbol names from IDs efficiently using batch query
   */
  private async resolveSymbolNames(symbolIds: number[]): Promise<
    Map<
      number,
      {
        name: string;
        className?: string;
        isCallable: boolean;
        filePath: string;
      }
    >
  > {
    const symbolMap = new Map();

    if (symbolIds.length === 0) {
      return symbolMap;
    }

    const query = this.db('symbols')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .whereIn('symbols.id', symbolIds)
      .select(
        'symbols.id',
        'symbols.name',
        'symbols.symbol_type',
        'symbols.signature',
        'files.path as file_path'
      );

    const results = await query;

    for (const row of results) {
      const isCallable = ['function', 'method'].includes(row.symbol_type);

      let className: string | undefined;
      if (row.symbol_type === 'method' && row.signature) {
        const match = row.signature.match(/class\s+(\w+)/);
        if (match) {
          className = match[1];
        }
      }

      symbolMap.set(row.id, {
        name: row.name,
        className,
        isCallable,
        filePath: row.file_path || 'unknown',
      });
    }

    return symbolMap;
  }

  /**
   * Get short file path for display (last 2 directories + filename)
   */
  private getShortFilePath(fullPath: string): string {
    const parts = fullPath.split(/[/\\]/);
    return parts.length > 3 ? `.../${parts.slice(-2).join('/')}` : fullPath;
  }

  /**
   * Enhance transitive results with call chains when requested
   */
  private async enhanceResultsWithCallChains(
    results: TransitiveResult[],
    showCallChains: boolean
  ): Promise<TransitiveResult[]> {
    if (!showCallChains || results.length === 0) {
      return results;
    }

    const enhancedResults = await Promise.all(
      results.map(async result => {
        const fullPath = [...result.path, result.symbolId];
        const callChain = await this.formatCallChain(fullPath);

        return {
          ...result,
          call_chain: callChain,
        };
      })
    );

    return enhancedResults;
  }

  /**
   * Find the shortest path between two symbols using Dijkstra's algorithm
   * Returns the path as an array of symbol IDs and the total distance
   */
  async findShortestPath(
    startSymbolId: number,
    endSymbolId: number,
    options: TransitiveAnalysisOptions = {}
  ): Promise<{ path: number[]; distance: number } | null> {
    const startTime = Date.now();
    logger.info('Finding shortest path', { startSymbolId, endSymbolId, includeCrossStack: options.includeCrossStack });

    const distances = new Map<number, number>();
    const previous = new Map<number, number | null>();
    const visited = new Set<number>();
    const unvisited: Array<{ symbolId: number; distance: number }> = [];

    distances.set(startSymbolId, 0);
    previous.set(startSymbolId, null);
    unvisited.push({ symbolId: startSymbolId, distance: 0 });

    while (unvisited.length > 0) {
      unvisited.sort((a, b) => a.distance - b.distance);
      const current = unvisited.shift()!;

      if (current.symbolId === endSymbolId) {
        const path = this.reconstructPath(previous, endSymbolId);
        logger.info('Shortest path found', {
          pathLength: path.length,
          distance: current.distance,
          executionTimeMs: Date.now() - startTime,
        });
        return { path, distance: current.distance };
      }

      if (visited.has(current.symbolId)) {
        continue;
      }

      visited.add(current.symbolId);

      const dependencies = await this.getDirectDependencies(current.symbolId, options);

      for (const dep of dependencies) {
        if (!dep.to_symbol) continue;

        const neighborId = dep.to_symbol.id;
        const newDistance = current.distance + 1;

        if (!distances.has(neighborId) || newDistance < distances.get(neighborId)!) {
          distances.set(neighborId, newDistance);
          previous.set(neighborId, current.symbolId);
          unvisited.push({ symbolId: neighborId, distance: newDistance });
        }
      }

      const callers = await this.getDirectCallers(current.symbolId, options);

      let crossStackCallers: typeof callers = [];
      if (options.includeCrossStack) {
        crossStackCallers = await this.getCrossStackCallers(current.symbolId);
      }

      const allCallers = [...callers, ...crossStackCallers];

      for (const caller of allCallers) {
        if (!caller.from_symbol) continue;

        const neighborId = caller.from_symbol.id;
        const newDistance = current.distance + 1;

        if (!distances.has(neighborId) || newDistance < distances.get(neighborId)!) {
          distances.set(neighborId, newDistance);
          previous.set(neighborId, current.symbolId);
          unvisited.push({ symbolId: neighborId, distance: newDistance });
        }
      }
    }

    logger.warn('No path found', { startSymbolId, endSymbolId });
    return null;
  }

  /**
   * Find all paths between two symbols (up to maxDepth)
   * Useful for comprehensive impact analysis
   */
  async findAllPaths(
    startSymbolId: number,
    endSymbolId: number,
    maxDepth: number = 10,
    options: TransitiveAnalysisOptions = {}
  ): Promise<number[][]> {
    const startTime = Date.now();
    logger.info('Finding all paths', { startSymbolId, endSymbolId, maxDepth, includeCrossStack: options.includeCrossStack });

    const allPaths: number[][] = [];
    const visited = new Set<number>();

    await this.dfsAllPaths(
      startSymbolId,
      endSymbolId,
      [startSymbolId],
      visited,
      allPaths,
      maxDepth,
      options
    );

    logger.info('All paths found', {
      pathCount: allPaths.length,
      executionTimeMs: Date.now() - startTime,
    });

    return allPaths;
  }

  /**
   * DFS helper for finding all paths
   */
  private async dfsAllPaths(
    current: number,
    target: number,
    currentPath: number[],
    visited: Set<number>,
    allPaths: number[][],
    remainingDepth: number,
    options: TransitiveAnalysisOptions = {}
  ): Promise<void> {
    if (current === target) {
      allPaths.push([...currentPath]);
      return;
    }

    if (remainingDepth <= 0) {
      return;
    }

    if (visited.has(current)) {
      return;
    }

    visited.add(current);

    try {
      const dependencies = await this.getDirectDependencies(current, options);

      for (const dep of dependencies) {
        if (!dep.to_symbol) continue;

        const nextId = dep.to_symbol.id;
        await this.dfsAllPaths(
          nextId,
          target,
          [...currentPath, nextId],
          new Set(visited),
          allPaths,
          remainingDepth - 1,
          options
        );
      }
    } catch (error) {
      logger.error('Error in DFS all paths', {
        current,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      visited.delete(current);
    }
  }

  /**
   * Reconstruct path from previous pointers
   */
  private reconstructPath(previous: Map<number, number | null>, endId: number): number[] {
    const path: number[] = [];
    let current: number | null = endId;

    while (current !== null) {
      path.unshift(current);
      current = previous.get(current) || null;
    }

    return path;
  }

  /**
   * Clear the internal cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

/**
 * Configuration for importance ranking weights
 */
export interface ImportanceRankingConfig {
  betweennessWeight: number;
  degreeWeight: number;
  eigenvectorWeight: number;
  closenessWeight: number;
  semanticWeight: number;
}

/**
 * Default importance ranking configuration
 * Prioritizes betweenness (bridge functions) and semantic meaning
 */
export const DEFAULT_IMPORTANCE_CONFIG: ImportanceRankingConfig = {
  betweennessWeight: 0.3,
  degreeWeight: 0.2,
  eigenvectorWeight: 0.15,
  closenessWeight: 0.1,
  semanticWeight: 0.25,
};

/**
 * Symbol metadata for importance calculation
 */
export interface SymbolForRanking {
  id: number;
  name: string;
  symbol_type: string;
  file_path?: string;
  depth?: number;
  qualified_name?: string; // FQN like "App\Models\Personnel::create"
}

/**
 * SymbolImportanceRanker calculates importance scores for symbols using
 * graph centrality metrics combined with semantic analysis. This helps AI
 * agents prioritize critical code paths over noise (logging, error handling).
 *
 * The scoring methodology combines four centrality metrics with semantic analysis:
 * - **Betweenness Centrality**: Measures bridge symbols connecting different modules
 * - **Degree Centrality**: Counts direct dependencies (in-degree weighted 1.5x)
 * - **Eigenvector Centrality**: Considers importance of callers (PageRank-style)
 * - **Closeness Centrality**: Measures reachability within the dependency graph
 * - **Semantic Weight**: Boosts core business logic, penalizes utilities/logging
 *
 * Each metric is normalized to 0-1 and weighted according to the configuration.
 * The final score ranges from 0 (unimportant) to 1 (critical).
 *
 * @example
 * ```typescript
 * const ranker = new SymbolImportanceRanker({
 *   betweennessWeight: 0.3,
 *   degreeWeight: 0.25,
 *   eigenvectorWeight: 0.25,
 *   closenessWeight: 0.1,
 *   semanticWeight: 0.1
 * });
 *
 * const score = await ranker.calculateImportance({
 *   id: 123,
 *   name: 'processPayment',
 *   symbol_type: 'function'
 * });
 *
 * console.log(`Importance: ${(score * 100).toFixed(1)}%`);
 * ```
 */
export class SymbolImportanceRanker {
  private db: Knex;
  private config: ImportanceRankingConfig;
  private centralityCache: Map<string, number> = new Map();

  constructor(config: ImportanceRankingConfig = DEFAULT_IMPORTANCE_CONFIG) {
    this.db = getDatabaseConnection();
    this.config = config;
  }

  /**
   * Calculate composite importance score for a symbol.
   *
   * Combines multiple centrality metrics with semantic analysis to produce
   * a single importance score. Uses caching to avoid redundant calculations.
   *
   * @param symbol - Symbol metadata including ID, name, and type
   * @returns Importance score between 0 (unimportant) and 1 (critical)
   */
  async calculateImportance(symbol: SymbolForRanking): Promise<number> {
    // Calculate all metrics
    const semantic = this.calculateSemanticWeight(symbol);
    const betweenness = await this.calculateBetweennessCentrality(symbol.id);
    const degree = await this.calculateDegreeCentrality(symbol.id);
    const eigenvector = await this.calculateEigenvectorCentrality(symbol.id);
    const closeness = await this.calculateClosenessCentrality(symbol.id);

    // Base composite score with increased semantic weight
    let compositeScore =
      this.config.betweennessWeight * betweenness +
      this.config.degreeWeight * degree +
      this.config.eigenvectorWeight * eigenvector +
      this.config.closenessWeight * closeness +
      this.config.semanticWeight * semantic;

    const isDatabaseOp = this.isDatabaseOperation(symbol);
    if (isDatabaseOp) {
      compositeScore *= 2.5;

      const depthPenalty = (symbol.depth || 0) * 0.02;
      compositeScore = Math.max(compositeScore - depthPenalty, 0);
    }

    return Math.min(compositeScore, 1.0);
  }

  /**
   * Detect if a symbol represents a database operation (language-agnostic)
   * Checks for data persistence patterns across PHP, C#, TypeScript, GDScript
   */
  private isDatabaseOperation(symbol: SymbolForRanking): boolean {
    const name = symbol.name.toLowerCase();
    const filePath = symbol.file_path?.toLowerCase() || '';
    const qualifiedName = symbol.qualified_name || symbol.name;

    let language = this.detectLanguage(filePath);

    if (language === 'unknown' && qualifiedName !== symbol.name) {
      language = this.detectLanguageFromQualifiedName(qualifiedName);
    }

    const dbOperations = /\b(create|insert|update|save|persist|delete|remove|destroy|upsert)\b/i;

    if (!dbOperations.test(name)) {
      return false;
    }

    switch (language) {
      case 'php':
        return (
          /::(create|insert|update|save|delete|destroy|upsert)\b/i.test(qualifiedName) ||
          /\\models\\/i.test(qualifiedName) ||
          /\/models\//i.test(filePath) ||
          /\b(eloquent|repository)\b/i.test(filePath) ||
          name.includes('repository')
        );

      case 'csharp':
        return (
          /\b(savechanges|add|update|remove|delete|insert|executesql|execute)\b/i.test(name) ||
          /\b(repository|dbcontext|database|entity)\b/i.test(filePath) ||
          name.includes('repository') ||
          name.includes('db')
        );

      case 'typescript':
      case 'javascript':
        return (
          name.includes('repository') ||
          name.includes('prisma') ||
          name.includes('orm') ||
          /\b(model|schema|entity|collection)\b/i.test(filePath)
        );

      case 'gdscript':
        return (
          /(save|load)_(resource|scene|config|data|game)/i.test(name) ||
          /resource_?saver|config_?file/i.test(name)
        );

      default:
        return (
          name.includes('repository') ||
          name.includes('db') ||
          name.includes('database') ||
          name.includes('persist')
        );
    }
  }

  /**
   * Detect programming language from file path
   */
  private detectLanguage(filePath: string): string {
    if (/\.php$/i.test(filePath)) return 'php';
    if (/\.cs$/i.test(filePath)) return 'csharp';
    if (/\.ts$/i.test(filePath)) return 'typescript';
    if (/\.js$/i.test(filePath)) return 'javascript';
    if (/\.gd$/i.test(filePath)) return 'gdscript';
    return 'unknown';
  }

  private detectLanguageFromQualifiedName(qualifiedName: string): string {
    if (qualifiedName.includes('\\')) {
      return 'php';
    }

    if (/^[A-Z][a-zA-Z0-9]*(\.[A-Z][a-zA-Z0-9]*)+/.test(qualifiedName) && !qualifiedName.includes('::')) {
      return 'csharp';
    }

    if (/^[a-z]+(\.[a-z]+)+\.[A-Z]/.test(qualifiedName)) {
      return 'java';
    }

    if (qualifiedName.includes('@/') || qualifiedName.includes('../')) {
      return 'typescript';
    }

    return 'unknown';
  }

  /**
   * Rank a list of symbols by importance, highest first
   */
  async rankSymbols(symbols: SymbolForRanking[]): Promise<Array<SymbolForRanking & { importance_score: number }>> {
    const rankedSymbols = await Promise.all(
      symbols.map(async (symbol) => ({
        ...symbol,
        importance_score: await this.calculateImportance(symbol),
      }))
    );

    return rankedSymbols.sort((a, b) => b.importance_score - a.importance_score);
  }

  /**
   * Calculate betweenness centrality (approximation)
   * High score = bridge/bottleneck functions that connect many paths
   */
  private async calculateBetweennessCentrality(symbolId: number): Promise<number> {
    const cacheKey = `betweenness:${symbolId}`;
    const cached = this.centralityCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const [callersCount, depsCount] = await Promise.all([
        this.db('dependencies')
          .where('to_symbol_id', symbolId)
          .countDistinct('from_symbol_id as count')
          .first()
          .then((r) => Number(r?.count || 0)),
        this.db('dependencies')
          .where('from_symbol_id', symbolId)
          .countDistinct('to_symbol_id as count')
          .first()
          .then((r) => Number(r?.count || 0)),
      ]);

      const bridgeScore = Math.sqrt(callersCount * depsCount);
      const normalized = Math.min(bridgeScore / 10, 1.0);

      this.centralityCache.set(cacheKey, normalized);
      return normalized;
    } catch (error) {
      logger.warn('Failed to calculate betweenness centrality', {
        symbolId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Calculate degree centrality (in-degree + out-degree)
   * High score = widely used or highly connected functions
   */
  private async calculateDegreeCentrality(symbolId: number): Promise<number> {
    const cacheKey = `degree:${symbolId}`;
    const cached = this.centralityCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const [inDegree, outDegree] = await Promise.all([
        this.db('dependencies')
          .where('to_symbol_id', symbolId)
          .count('* as count')
          .first()
          .then((r) => Number(r?.count || 0)),
        this.db('dependencies')
          .where('from_symbol_id', symbolId)
          .count('* as count')
          .first()
          .then((r) => Number(r?.count || 0)),
      ]);

      const totalDegree = inDegree * 1.5 + outDegree;
      const normalized = Math.min(totalDegree / 20, 1.0);

      this.centralityCache.set(cacheKey, normalized);
      return normalized;
    } catch (error) {
      logger.warn('Failed to calculate degree centrality', {
        symbolId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Calculate eigenvector centrality (approximation)
   * High score = connected to other important nodes
   */
  private async calculateEigenvectorCentrality(symbolId: number): Promise<number> {
    const cacheKey = `eigenvector:${symbolId}`;
    const cached = this.centralityCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const callerImportance = await this.db('dependencies as d1')
        .where('d1.to_symbol_id', symbolId)
        .leftJoin('dependencies as d2', 'd1.from_symbol_id', 'd2.to_symbol_id')
        .count('d2.id as caller_degree')
        .first()
        .then((r) => Number(r?.caller_degree || 0));

      const normalized = Math.min(callerImportance / 50, 1.0);

      this.centralityCache.set(cacheKey, normalized);
      return normalized;
    } catch (error) {
      logger.warn('Failed to calculate eigenvector centrality', {
        symbolId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Calculate closeness centrality (approximation)
   * High score = can quickly reach or be reached by many symbols
   */
  private async calculateClosenessCentrality(symbolId: number): Promise<number> {
    const cacheKey = `closeness:${symbolId}`;
    const cached = this.centralityCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const reachableCount = await this.db.raw(
        `
        WITH RECURSIVE reachable AS (
          SELECT DISTINCT to_symbol_id as symbol_id, 1 as depth
          FROM dependencies
          WHERE from_symbol_id = ?

          UNION

          SELECT DISTINCT d.to_symbol_id, r.depth + 1
          FROM reachable r
          JOIN dependencies d ON r.symbol_id = d.from_symbol_id
          WHERE r.depth < 2
        )
        SELECT COUNT(DISTINCT symbol_id) as count FROM reachable
      `,
        [symbolId]
      );

      const count = Number(reachableCount.rows[0]?.count || 0);
      const normalized = Math.min(count / 30, 1.0);

      this.centralityCache.set(cacheKey, normalized);
      return normalized;
    } catch (error) {
      logger.warn('Failed to calculate closeness centrality', {
        symbolId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Calculate semantic importance based on symbol type and name
   * High score = database operations, business logic
   * Low score = logging, error handling, framework utilities
   */
  private calculateSemanticWeight(symbol: SymbolForRanking): number {
    let score = 0;

    const typeWeights: Record<string, number> = {
      method: 0.6,
      function: 0.6,
      class: 0.7,
      interface: 0.5,
      variable: 0.3,
      property: 0.3,
    };
    score += typeWeights[symbol.symbol_type] || 0.5;

    const name = symbol.name.toLowerCase();

    if (/\b(create|insert|update|save|persist|delete|remove|destroy|upsert)\b/.test(name)) {
      score += 0.4;
    }

    if (/\b(process|calculate|validate|transform|handle|execute|perform)\b/.test(name)) {
      score += 0.3;
    }

    if (symbol.file_path?.includes('/Service') || symbol.file_path?.includes('/Controller')) {
      score += 0.2;
    }

    if (/\b(log|logger|debug|trace|info|warn|error)\b/i.test(name)) {
      score -= 0.5;
    }

    if (/^(response|json|getMessage|getDetails|getResourceName|print|console)\b/i.test(name)) {
      score -= 0.3;
    }

    if (symbol.depth !== undefined) {
      score += Math.max(0, (1 - symbol.depth / 5) * 0.2);
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Clear centrality cache
   */
  clearCache(): void {
    this.centralityCache.clear();
  }

  /**
   * Update ranking configuration
   */
  updateConfig(config: Partial<ImportanceRankingConfig>): void {
    this.config = { ...this.config, ...config };
    this.centralityCache.clear();
  }
}

export const transitiveAnalyzer = new TransitiveAnalyzer();
export const symbolImportanceRanker = new SymbolImportanceRanker();
