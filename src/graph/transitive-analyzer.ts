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
      // Use existing traverseCallers implementation
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
    // Process all dependencies for comprehensive analysis

    const visited = new Set<number>();
    const cycles = new Set<string>();
    const results: TransitiveResult[] = [];
    let maxDepthReached = 0;

    // Include cross-stack dependency types in the traversal
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
      // Get both regular and cross-stack callers
      const regularCallers = await this.getDirectCallers(symbolId, options);
      const crossStackCallers = await this.getCrossStackCallers(symbolId);

      // Process regular callers
      for (const caller of regularCallers) {
        if (!caller.from_symbol) continue;

        const fromSymbolId = caller.from_symbol.id;
        const newPath = [...currentPath, symbolId];
        // Add this result
        results.push({
          symbolId: fromSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          dependencies: [caller],
        });

        // Recurse to find callers of this caller
        // Create new visited set copy for each recursive path to avoid cross-contamination
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

      // Process cross-stack callers
      for (const caller of crossStackCallers) {
        if (!caller.from_symbol) continue;

        const fromSymbolId = caller.from_symbol.id;
        const newPath = [...currentPath, symbolId];

        // Process all cross-stack relationships
        // Add this result
        results.push({
          symbolId: fromSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          dependencies: [caller],
        });

        // Recurse to find callers of this cross-stack caller
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
      logger.error('Error traversing cross-stack callers', { symbolId, error: error.message });
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
      // Get direct callers from database
      const callers = await this.getDirectCallers(symbolId, options);

      for (const caller of callers) {
        if (!caller.from_symbol) continue;

        const fromSymbolId = caller.from_symbol.id;
        const newPath = [...currentPath, symbolId];
        // Add this result
        results.push({
          symbolId: fromSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          dependencies: [caller],
        });

        // Recurse to find callers of this caller
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
      logger.error('Error traversing callers', { symbolId, error: error.message });
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
      // Get direct dependencies from database
      const dependencies = await this.getDirectDependencies(symbolId, options);

      for (const dependency of dependencies) {
        if (!dependency.to_symbol) continue;

        const toSymbolId = dependency.to_symbol.id;
        const newPath = [...currentPath, symbolId];
        // Add this result
        results.push({
          symbolId: toSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          dependencies: [dependency],
        });

        // Recurse to find dependencies of this dependency
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
      logger.error('Error traversing dependencies', { symbolId, error: error.message });
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

    // Get frontend impact (if this is a backend symbol)
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

    // Get backend impact (if this is a frontend symbol)
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

    // Get direct cross-stack relationships
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
    const query = this.db('dependencies')
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
    })) as DependencyWithSymbols[];
  }

  /**
   * Get cross-stack relationships for a symbol
   */
  private async getCrossStackRelationships(symbolId: number): Promise<CrossStackRelationship[]> {
    // Get relationships where this symbol is either source or target
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

    // Transform results to match expected format
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
    let query = this.db('dependencies')
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
      query = query.whereIn('dependencies.dependency_type', options.includeTypes);
    }

    if (options.excludeTypes && options.excludeTypes.length > 0) {
      query = query.whereNotIn('dependencies.dependency_type', options.excludeTypes);
    }

    const results = await query;

    // Transform results to match expected format
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
   * Format a call chain from symbol ID path to human-readable format
   * Converts [123, 456, 789] to "DeckController._Ready() → InitializeServices() → CardManager.SetHandPositions()"
   */
  async formatCallChain(path: number[]): Promise<string> {
    if (path.length === 0) {
      return '';
    }

    try {
      // Resolve symbol names efficiently in batch
      const symbolNames = await this.resolveSymbolNames(path);

      // Build the call chain string
      const chainParts: string[] = [];

      for (let i = 0; i < path.length; i++) {
        const symbolId = path[i];
        const symbolInfo = symbolNames.get(symbolId);

        if (!symbolInfo) {
          chainParts.push(`Symbol(${symbolId})`);
          continue;
        }

        let part = symbolInfo.name;

        // Add class context for methods
        if (symbolInfo.className && symbolInfo.className !== symbolInfo.name) {
          part = `${symbolInfo.className}.${symbolInfo.name}`;
        }

        // Add parentheses for functions/methods
        if (symbolInfo.isCallable) {
          part += '()';
        }

        // Add file context for cross-file calls
        if (i > 0 && symbolInfo.filePath !== symbolNames.get(path[i - 1])?.filePath) {
          part += ` (${this.getShortFilePath(symbolInfo.filePath)})`;
        }

        chainParts.push(part);
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

      // Extract class name from signature for methods
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

    // Call chain formatting with comprehensive data

    // Format call chains for all results
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

// Export singleton instance
export const transitiveAnalyzer = new TransitiveAnalyzer();
