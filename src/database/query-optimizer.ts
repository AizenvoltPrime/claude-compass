import type { Knex } from 'knex';
import { getDatabaseConnection } from './connection';
import { DependencyType, DependencyWithSymbols } from './models';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('query-optimizer');

export interface QueryPerformanceMetrics {
  queryType: string;
  executionTimeMs: number;
  rowsReturned: number;
  cacheHit: boolean;
  timestamp: Date;
}

export interface OptimizedQueryOptions {
  useCache?: boolean;
  cacheTtlMs?: number;
  maxResults?: number;
  timeoutMs?: number;
  includeMetrics?: boolean;
}

export interface OptimizedQueryResult<T> {
  data: T;
  metrics?: QueryPerformanceMetrics;
  fromCache?: boolean;
  cacheKey?: string;
}

/**
 * QueryOptimizer provides performance-optimized database queries specifically
 * designed for Phase 3 transitive analysis operations. It includes caching,
 * query optimization, and performance monitoring.
 */
export class QueryOptimizer {
  private db: Knex;
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private metrics: QueryPerformanceMetrics[] = [];
  private readonly DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly DEFAULT_MAX_RESULTS = 1000;
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

  constructor() {
    this.db = getDatabaseConnection();
  }

  /**
   * Get optimized transitive callers using recursive CTEs for better performance
   */
  async getOptimizedTransitiveCallers(
    symbolId: number,
    maxDepth: number = 10,
    dependencyTypes?: DependencyType[],
    options: OptimizedQueryOptions = {}
  ): Promise<OptimizedQueryResult<DependencyWithSymbols[]>> {
    const startTime = Date.now();
    const cacheKey = `transitive-callers:${symbolId}:${maxDepth}:${dependencyTypes?.join(',')}`;

    // Check cache first
    if (options.useCache !== false) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return {
          data: cached,
          fromCache: true,
          cacheKey,
          metrics: this.createMetrics('transitive-callers-cached', startTime, cached.length, true)
        };
      }
    }

    logger.debug('Executing optimized transitive callers query', { symbolId, maxDepth, dependencyTypes });

    try {
      // Use recursive CTE for efficient transitive traversal
      const cteQuery = this.db.raw(`
        WITH RECURSIVE transitive_callers AS (
          -- Base case: direct callers
          SELECT
            d.id,
            d.from_symbol_id,
            d.to_symbol_id,
            d.dependency_type,
            d.line_number,
            d.created_at,
            d.updated_at,
            1 as depth,
            ARRAY[d.from_symbol_id] as path
          FROM dependencies d
          WHERE d.to_symbol_id = ?
            ${dependencyTypes ? `AND d.dependency_type = ANY(?)` : ''}

          UNION ALL

          -- Recursive case: callers of callers
          SELECT
            d.id,
            d.from_symbol_id,
            d.to_symbol_id,
            d.dependency_type,
            d.line_number,
            d.created_at,
            d.updated_at,
            tc.depth + 1,
            tc.path || d.from_symbol_id
          FROM dependencies d
          INNER JOIN transitive_callers tc ON d.to_symbol_id = tc.from_symbol_id
          WHERE tc.depth < ?
            AND NOT (d.from_symbol_id = ANY(tc.path)) -- Cycle detection
            ${dependencyTypes ? `AND d.dependency_type = ANY(?)` : ''}
        )
        SELECT
          tc.*,
          fs.id as from_symbol_id,
          fs.name as from_symbol_name,
          fs.symbol_type as from_symbol_type,
          ff.path as from_file_path,
          ts.id as to_symbol_id,
          ts.name as to_symbol_name,
          ts.symbol_type as to_symbol_type,
          tf.path as to_file_path
        FROM transitive_callers tc
        LEFT JOIN symbols fs ON tc.from_symbol_id = fs.id
        LEFT JOIN files ff ON fs.file_id = ff.id
        LEFT JOIN symbols ts ON tc.to_symbol_id = ts.id
        LEFT JOIN files tf ON ts.file_id = tf.id
        ORDER BY tc.depth, tc.id DESC
        LIMIT ?
      `, [
        symbolId,
        ...(dependencyTypes ? [dependencyTypes] : []),
        maxDepth,
        ...(dependencyTypes ? [dependencyTypes] : []),
        options.maxResults || this.DEFAULT_MAX_RESULTS
      ]);

      const results = await this.executeWithTimeout(cteQuery, options.timeoutMs);
      const transformedResults = this.transformToDependencyWithSymbols(results);

      // Cache the results
      if (options.useCache !== false) {
        this.setCache(cacheKey, transformedResults, options.cacheTtlMs);
      }

      const executionTime = Date.now() - startTime;
      const metrics = this.createMetrics('transitive-callers', startTime, transformedResults.length, false);

      logger.debug('Optimized transitive callers query completed', {
        symbolId,
        maxDepth,
        resultsCount: transformedResults.length,
        executionTimeMs: executionTime
      });

      return {
        data: transformedResults,
        fromCache: false,
        cacheKey,
        metrics: options.includeMetrics ? metrics : undefined
      };

    } catch (error) {
      logger.error('Optimized transitive callers query failed', { symbolId, error: error.message });
      throw error;
    }
  }

  /**
   * Get optimized transitive dependencies using recursive CTEs for better performance
   */
  async getOptimizedTransitiveDependencies(
    symbolId: number,
    maxDepth: number = 10,
    dependencyTypes?: DependencyType[],
    options: OptimizedQueryOptions = {}
  ): Promise<OptimizedQueryResult<DependencyWithSymbols[]>> {
    const startTime = Date.now();
    const cacheKey = `transitive-dependencies:${symbolId}:${maxDepth}:${dependencyTypes?.join(',')}`;

    // Check cache first
    if (options.useCache !== false) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return {
          data: cached,
          fromCache: true,
          cacheKey,
          metrics: this.createMetrics('transitive-dependencies-cached', startTime, cached.length, true)
        };
      }
    }

    logger.debug('Executing optimized transitive dependencies query', { symbolId, maxDepth, dependencyTypes });

    try {
      // Use recursive CTE for efficient transitive traversal
      const cteQuery = this.db.raw(`
        WITH RECURSIVE transitive_dependencies AS (
          -- Base case: direct dependencies
          SELECT
            d.id,
            d.from_symbol_id,
            d.to_symbol_id,
            d.dependency_type,
            d.line_number,
            d.created_at,
            d.updated_at,
            1 as depth,
            ARRAY[d.to_symbol_id] as path
          FROM dependencies d
          WHERE d.from_symbol_id = ?
            ${dependencyTypes ? `AND d.dependency_type = ANY(?)` : ''}

          UNION ALL

          -- Recursive case: dependencies of dependencies
          SELECT
            d.id,
            d.from_symbol_id,
            d.to_symbol_id,
            d.dependency_type,
            d.line_number,
            d.created_at,
            d.updated_at,
            td.depth + 1,
            td.path || d.to_symbol_id
          FROM dependencies d
          INNER JOIN transitive_dependencies td ON d.from_symbol_id = td.to_symbol_id
          WHERE td.depth < ?
            AND NOT (d.to_symbol_id = ANY(td.path)) -- Cycle detection
            ${dependencyTypes ? `AND d.dependency_type = ANY(?)` : ''}
        )
        SELECT
          td.*,
          fs.id as from_symbol_id,
          fs.name as from_symbol_name,
          fs.symbol_type as from_symbol_type,
          ff.path as from_file_path,
          ts.id as to_symbol_id,
          ts.name as to_symbol_name,
          ts.symbol_type as to_symbol_type,
          tf.path as to_file_path
        FROM transitive_dependencies td
        LEFT JOIN symbols fs ON td.from_symbol_id = fs.id
        LEFT JOIN files ff ON fs.file_id = ff.id
        LEFT JOIN symbols ts ON td.to_symbol_id = ts.id
        LEFT JOIN files tf ON ts.file_id = tf.id
        ORDER BY td.depth, td.id DESC
        LIMIT ?
      `, [
        symbolId,
        ...(dependencyTypes ? [dependencyTypes] : []),
        maxDepth,
        ...(dependencyTypes ? [dependencyTypes] : []),
        options.maxResults || this.DEFAULT_MAX_RESULTS
      ]);

      const results = await this.executeWithTimeout(cteQuery, options.timeoutMs);
      const transformedResults = this.transformToDependencyWithSymbols(results);

      // Cache the results
      if (options.useCache !== false) {
        this.setCache(cacheKey, transformedResults, options.cacheTtlMs);
      }

      const executionTime = Date.now() - startTime;
      const metrics = this.createMetrics('transitive-dependencies', startTime, transformedResults.length, false);

      logger.debug('Optimized transitive dependencies query completed', {
        symbolId,
        maxDepth,
        resultsCount: transformedResults.length,
        executionTimeMs: executionTime
      });

      return {
        data: transformedResults,
        fromCache: false,
        cacheKey,
        metrics: options.includeMetrics ? metrics : undefined
      };

    } catch (error) {
      logger.error('Optimized transitive dependencies query failed', { symbolId, error: error.message });
      throw error;
    }
  }

  /**
   * Get symbol relationships with optimized joins and filtering
   */
  async getOptimizedSymbolRelationships(
    symbolIds: number[],
    relationshipTypes?: string[],
    options: OptimizedQueryOptions = {}
  ): Promise<OptimizedQueryResult<any[]>> {
    const startTime = Date.now();
    const cacheKey = `symbol-relationships:${symbolIds.join(',')}:${relationshipTypes?.join(',')}`;

    // Check cache first
    if (options.useCache !== false && symbolIds.length <= 10) { // Only cache small requests
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return {
          data: cached,
          fromCache: true,
          cacheKey,
          metrics: this.createMetrics('symbol-relationships-cached', startTime, cached.length, true)
        };
      }
    }

    try {
      // Optimized query with proper indexes usage
      let query = this.db('dependencies as d')
        .leftJoin('symbols as fs', 'd.from_symbol_id', 'fs.id')
        .leftJoin('files as ff', 'fs.file_id', 'ff.id')
        .leftJoin('symbols as ts', 'd.to_symbol_id', 'ts.id')
        .leftJoin('files as tf', 'ts.file_id', 'tf.id')
        .whereIn('d.from_symbol_id', symbolIds)
        .orWhereIn('d.to_symbol_id', symbolIds)
        .select(
          'd.*',
          'fs.name as from_symbol_name',
          'fs.symbol_type as from_symbol_type',
          'ff.path as from_file_path',
          'ts.name as to_symbol_name',
          'ts.symbol_type as to_symbol_type',
          'tf.path as to_file_path'
        );

      if (relationshipTypes && relationshipTypes.length > 0) {
        query = query.whereIn('d.dependency_type', relationshipTypes);
      }

      query = query
        .orderBy('d.id', 'desc')
        .limit(options.maxResults || this.DEFAULT_MAX_RESULTS);

      const results = await this.executeWithTimeout(query, options.timeoutMs);

      // Cache the results for small requests
      if (options.useCache !== false && symbolIds.length <= 10) {
        this.setCache(cacheKey, results, options.cacheTtlMs);
      }

      const executionTime = Date.now() - startTime;
      const metrics = this.createMetrics('symbol-relationships', startTime, results.length, false);

      return {
        data: results,
        fromCache: false,
        cacheKey,
        metrics: options.includeMetrics ? metrics : undefined
      };

    } catch (error) {
      logger.error('Optimized symbol relationships query failed', { symbolIds, error: error.message });
      throw error;
    }
  }

  /**
   * Execute query with timeout protection
   */
  private async executeWithTimeout(query: any, timeoutMs?: number): Promise<any> {
    const timeout = timeoutMs || this.DEFAULT_TIMEOUT;

    return Promise.race([
      query,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Query timeout after ${timeout}ms`)), timeout)
      )
    ]);
  }

  /**
   * Transform raw query results to DependencyWithSymbols format
   */
  private transformToDependencyWithSymbols(results: any[]): DependencyWithSymbols[] {
    return results.map(row => ({
      id: row.id,
      from_symbol_id: row.from_symbol_id,
      to_symbol_id: row.to_symbol_id,
      dependency_type: row.dependency_type,
      line_number: row.line_number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      from_symbol: row.from_symbol_id ? {
        id: row.from_symbol_id,
        file_id: row.from_file_id || 0, // Default if not provided
        name: row.from_symbol_name,
        symbol_type: row.from_symbol_type,
        start_line: row.from_start_line,
        end_line: row.from_end_line,
        is_exported: row.from_is_exported || false,
        visibility: row.from_visibility,
        signature: row.from_signature,
        created_at: row.from_symbol_created_at || row.created_at,
        updated_at: row.from_symbol_updated_at || row.updated_at,
        file: row.from_file_path ? {
          id: row.from_file_id || 0,
          repo_id: row.repo_id || 0,
          path: row.from_file_path,
          language: row.from_file_language,
          size: row.from_file_size,
          last_modified: row.from_file_last_modified,
          git_hash: row.from_file_git_hash,
          is_generated: row.from_file_is_generated || false,
          is_test: row.from_file_is_test || false,
          created_at: row.from_file_created_at || row.created_at,
          updated_at: row.from_file_updated_at || row.updated_at
        } : undefined
      } : undefined,
      to_symbol: row.to_symbol_id ? {
        id: row.to_symbol_id,
        file_id: row.to_file_id || 0,
        name: row.to_symbol_name,
        symbol_type: row.to_symbol_type,
        start_line: row.to_start_line,
        end_line: row.to_end_line,
        is_exported: row.to_is_exported || false,
        visibility: row.to_visibility,
        signature: row.to_signature,
        created_at: row.to_symbol_created_at || row.created_at,
        updated_at: row.to_symbol_updated_at || row.updated_at,
        file: row.to_file_path ? {
          id: row.to_file_id || 0,
          repo_id: row.repo_id || 0,
          path: row.to_file_path,
          language: row.to_file_language,
          size: row.to_file_size,
          last_modified: row.to_file_last_modified,
          git_hash: row.to_file_git_hash,
          is_generated: row.to_file_is_generated || false,
          is_test: row.to_file_is_test || false,
          created_at: row.to_file_created_at || row.created_at,
          updated_at: row.to_file_updated_at || row.updated_at
        } : undefined
      } : undefined
    }));
  }

  /**
   * Cache management
   */
  private getFromCache(key: string): any {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(key); // Remove expired entry
    }
    return null;
  }

  private setCache(key: string, data: any, ttlMs?: number): void {
    const ttl = ttlMs || this.DEFAULT_CACHE_TTL;
    this.cache.set(key, {
      data,
      expires: Date.now() + ttl
    });
  }

  /**
   * Create performance metrics
   */
  private createMetrics(
    queryType: string,
    startTime: number,
    rowsReturned: number,
    cacheHit: boolean
  ): QueryPerformanceMetrics {
    const metrics: QueryPerformanceMetrics = {
      queryType,
      executionTimeMs: Date.now() - startTime,
      rowsReturned,
      cacheHit,
      timestamp: new Date()
    };

    // Store metrics for analysis
    this.metrics.push(metrics);

    // Keep only recent metrics (last 1000 entries)
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }

    return metrics;
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    totalQueries: number;
    averageExecutionTime: number;
    cacheHitRate: number;
    slowQueries: QueryPerformanceMetrics[];
    recentMetrics: QueryPerformanceMetrics[];
  } {
    const totalQueries = this.metrics.length;
    const totalExecutionTime = this.metrics.reduce((sum, m) => sum + m.executionTimeMs, 0);
    const cacheHits = this.metrics.filter(m => m.cacheHit).length;
    const slowQueries = this.metrics
      .filter(m => m.executionTimeMs > 1000)
      .sort((a, b) => b.executionTimeMs - a.executionTimeMs)
      .slice(0, 10);

    return {
      totalQueries,
      averageExecutionTime: totalQueries > 0 ? totalExecutionTime / totalQueries : 0,
      cacheHitRate: totalQueries > 0 ? cacheHits / totalQueries : 0,
      slowQueries,
      recentMetrics: this.metrics.slice(-50)
    };
  }

  /**
   * Clear cache and metrics
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Query optimizer cache cleared');
  }

  clearMetrics(): void {
    this.metrics = [];
    logger.debug('Query optimizer metrics cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[]; hitRate: number } {
    const totalQueries = this.metrics.length;
    const cacheHits = this.metrics.filter(m => m.cacheHit).length;

    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      hitRate: totalQueries > 0 ? cacheHits / totalQueries : 0
    };
  }
}

// Export singleton instance
export const queryOptimizer = new QueryOptimizer();