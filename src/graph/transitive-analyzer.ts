import type { Knex } from 'knex';
import { getDatabaseConnection } from '../database/connection';
import { DependencyType, DependencyWithSymbols } from '../database/models';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('transitive-analyzer');

export interface TransitiveAnalysisOptions {
  maxDepth?: number;
  includeTypes?: DependencyType[];
  excludeTypes?: DependencyType[];
  confidenceThreshold?: number;
}

export interface TransitiveResult {
  symbolId: number;
  path: number[]; // Array of symbol IDs representing the path from root
  depth: number;
  totalConfidence: number; // Confidence score propagated through the path
  dependencies: DependencyWithSymbols[];
}

export interface TransitiveAnalysisResult {
  results: TransitiveResult[];
  maxDepthReached: number;
  totalPaths: number;
  cyclesDetected: number;
  executionTimeMs: number;
}

/**
 * TransitiveAnalyzer provides efficient algorithms for analyzing transitive dependencies
 * and callers in the symbol dependency graph. It implements cycle detection, confidence
 * scoring propagation, and performance optimization for large codebases.
 */
export class TransitiveAnalyzer {
  private db: Knex;
  private cache: Map<string, TransitiveResult[]> = new Map();
  private readonly MAX_ABSOLUTE_DEPTH = 20; // Hard limit to prevent infinite recursion
  private readonly DEFAULT_MAX_DEPTH = 10;
  private readonly DEFAULT_CONFIDENCE_THRESHOLD = 0.1;

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
    const confidenceThreshold = options.confidenceThreshold || this.DEFAULT_CONFIDENCE_THRESHOLD;

    logger.debug('Starting transitive caller analysis', {
      symbolId,
      maxDepth,
      confidenceThreshold,
      includeTypes: options.includeTypes,
      excludeTypes: options.excludeTypes
    });

    const visited = new Set<number>();
    const cycles = new Set<string>();
    const results: TransitiveResult[] = [];
    let maxDepthReached = 0;

    await this.traverseCallers(
      symbolId,
      [],
      0,
      maxDepth,
      1.0, // Start with full confidence
      visited,
      cycles,
      results,
      options,
      confidenceThreshold
    );

    maxDepthReached = Math.max(...results.map(r => r.depth), 0);

    const executionTime = Date.now() - startTime;

    logger.debug('Completed transitive caller analysis', {
      symbolId,
      totalResults: results.length,
      maxDepthReached,
      cyclesDetected: cycles.size,
      executionTimeMs: executionTime
    });

    return {
      results,
      maxDepthReached,
      totalPaths: results.length,
      cyclesDetected: cycles.size,
      executionTimeMs: executionTime
    };
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
    const confidenceThreshold = options.confidenceThreshold || this.DEFAULT_CONFIDENCE_THRESHOLD;

    logger.debug('Starting transitive dependency analysis', {
      symbolId,
      maxDepth,
      confidenceThreshold,
      includeTypes: options.includeTypes,
      excludeTypes: options.excludeTypes
    });

    const visited = new Set<number>();
    const cycles = new Set<string>();
    const results: TransitiveResult[] = [];
    let maxDepthReached = 0;

    await this.traverseDependencies(
      symbolId,
      [],
      0,
      maxDepth,
      1.0, // Start with full confidence
      visited,
      cycles,
      results,
      options,
      confidenceThreshold
    );

    maxDepthReached = Math.max(...results.map(r => r.depth), 0);

    const executionTime = Date.now() - startTime;

    logger.debug('Completed transitive dependency analysis', {
      symbolId,
      totalResults: results.length,
      maxDepthReached,
      cyclesDetected: cycles.size,
      executionTimeMs: executionTime
    });

    return {
      results,
      maxDepthReached,
      totalPaths: results.length,
      cyclesDetected: cycles.size,
      executionTimeMs: executionTime
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
    currentConfidence: number,
    visited: Set<number>,
    cycles: Set<string>,
    results: TransitiveResult[],
    options: TransitiveAnalysisOptions,
    confidenceThreshold: number
  ): Promise<void> {
    // Stop if we've reached max depth
    if (currentDepth >= maxDepth) {
      return;
    }

    // Stop if confidence has dropped too low
    if (currentConfidence < confidenceThreshold) {
      return;
    }

    // Cycle detection
    if (visited.has(symbolId)) {
      const cycleKey = [...currentPath, symbolId].sort().join('-');
      cycles.add(cycleKey);
      logger.debug('Cycle detected in caller traversal', { symbolId, path: currentPath });
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
        const newConfidence = currentConfidence * (caller.confidence || 1.0);

        // Add this result
        results.push({
          symbolId: fromSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          totalConfidence: newConfidence,
          dependencies: [caller]
        });

        // Recurse to find callers of this caller
        const newVisited = new Set(visited);
        await this.traverseCallers(
          fromSymbolId,
          newPath,
          currentDepth + 1,
          maxDepth,
          newConfidence,
          newVisited,
          cycles,
          results,
          options,
          confidenceThreshold
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
    currentConfidence: number,
    visited: Set<number>,
    cycles: Set<string>,
    results: TransitiveResult[],
    options: TransitiveAnalysisOptions,
    confidenceThreshold: number
  ): Promise<void> {
    // Stop if we've reached max depth
    if (currentDepth >= maxDepth) {
      return;
    }

    // Stop if confidence has dropped too low
    if (currentConfidence < confidenceThreshold) {
      return;
    }

    // Cycle detection
    if (visited.has(symbolId)) {
      const cycleKey = [...currentPath, symbolId].sort().join('-');
      cycles.add(cycleKey);
      logger.debug('Cycle detected in dependency traversal', { symbolId, path: currentPath });
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
        const newConfidence = currentConfidence * (dependency.confidence || 1.0);

        // Add this result
        results.push({
          symbolId: toSymbolId,
          path: newPath,
          depth: currentDepth + 1,
          totalConfidence: newConfidence,
          dependencies: [dependency]
        });

        // Recurse to find dependencies of this dependency
        const newVisited = new Set(visited);
        await this.traverseDependencies(
          toSymbolId,
          newPath,
          currentDepth + 1,
          maxDepth,
          newConfidence,
          newVisited,
          cycles,
          results,
          options,
          confidenceThreshold
        );
      }
    } catch (error) {
      logger.error('Error traversing dependencies', { symbolId, error: error.message });
    } finally {
      visited.delete(symbolId);
    }
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

    const results = await query.orderBy('dependencies.confidence', 'desc');

    // Transform results to match expected format
    return results.map(row => ({
      id: row.id,
      from_symbol_id: row.from_symbol_id,
      to_symbol_id: row.to_symbol_id,
      dependency_type: row.dependency_type,
      line_number: row.line_number,
      confidence: row.confidence,
      created_at: row.created_at,
      updated_at: row.updated_at,
      from_symbol: row.from_symbol_id ? {
        id: row.from_symbol_id,
        name: row.from_symbol_name,
        symbol_type: row.from_symbol_type,
        file: row.from_file_path ? {
          path: row.from_file_path
        } : undefined
      } : undefined,
      to_symbol: row.to_symbol_id ? {
        id: row.to_symbol_id,
        name: row.to_symbol_name,
        symbol_type: row.to_symbol_type,
        file: row.to_file_path ? {
          path: row.to_file_path
        } : undefined
      } : undefined
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

    const results = await query.orderBy('dependencies.confidence', 'desc');

    // Transform results to match expected format
    return results.map(row => ({
      id: row.id,
      from_symbol_id: row.from_symbol_id,
      to_symbol_id: row.to_symbol_id,
      dependency_type: row.dependency_type,
      line_number: row.line_number,
      confidence: row.confidence,
      created_at: row.created_at,
      updated_at: row.updated_at,
      from_symbol: row.from_symbol_id ? {
        id: row.from_symbol_id,
        name: row.from_symbol_name,
        symbol_type: row.from_symbol_type,
        file: row.from_file_path ? {
          path: row.from_file_path
        } : undefined
      } : undefined,
      to_symbol: row.to_symbol_id ? {
        id: row.to_symbol_id,
        name: row.to_symbol_name,
        symbol_type: row.to_symbol_type,
        file: row.to_file_path ? {
          path: row.to_file_path
        } : undefined
      } : undefined
    })) as DependencyWithSymbols[];
  }

  /**
   * Clear the internal cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Transitive analysis cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Export singleton instance
export const transitiveAnalyzer = new TransitiveAnalyzer();