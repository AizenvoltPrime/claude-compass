/**
 * Query result caching system for database operations
 * Phase 1: Performance Infrastructure Implementation
 */

import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('query-cache');

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
  lastAccessed: number;
  size: number; // Approximate size in bytes
}

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  totalSize: number;
  maxSize: number;
}

export interface CacheConfig {
  maxEntries: number;
  ttlMs: number; // Time to live in milliseconds
  maxSizeBytes: number; // Maximum total cache size
  enableStats: boolean;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxEntries: 1000,
  ttlMs: 1000 * 60 * 5, // 5 minutes TTL
  maxSizeBytes: 50 * 1024 * 1024, // 50MB max cache size
  enableStats: true,
};

/**
 * LRU Cache implementation with TTL and size limits
 * Optimized for database query results with large payloads
 */
export class QueryCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private config: CacheConfig;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalSize: 0,
  };

  constructor(config: CacheConfig = DEFAULT_CACHE_CONFIG) {
    this.config = config;

    // Cleanup expired entries periodically
    if (config.ttlMs > 0) {
      setInterval(
        () => {
          this.cleanupExpiredEntries();
        },
        Math.min(config.ttlMs / 4, 60000)
      ); // Cleanup every quarter TTL or 1 minute max
    }

    logger.debug('Query cache initialized', {
      maxEntries: config.maxEntries,
      ttlMs: config.ttlMs,
      maxSizeBytes: config.maxSizeBytes,
    });
  }

  /**
   * Generates cache key from query parameters
   */
  private generateCacheKey(method: string, params: any): string {
    const sortedParams = this.sortObject(params);
    return `${method}:${JSON.stringify(sortedParams)}`;
  }

  /**
   * Recursively sorts object keys for consistent cache keys
   */
  private sortObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.sortObject(item));

    const sortedObj: any = {};
    Object.keys(obj)
      .sort()
      .forEach(key => {
        sortedObj[key] = this.sortObject(obj[key]);
      });
    return sortedObj;
  }

  /**
   * Estimates the approximate size of an object in bytes
   */
  private estimateSize(obj: any): number {
    const jsonString = JSON.stringify(obj);
    return Buffer.byteLength(jsonString, 'utf8');
  }

  /**
   * Removes expired entries from cache
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.ttlMs) {
        expiredKeys.push(key);
      }
    }

    if (expiredKeys.length > 0) {
      for (const key of expiredKeys) {
        const entry = this.cache.get(key);
        if (entry) {
          this.stats.totalSize -= entry.size;
          this.cache.delete(key);
        }
      }

      logger.debug('Cleaned up expired cache entries', {
        expiredCount: expiredKeys.length,
        remainingCount: this.cache.size,
      });
    }
  }

  /**
   * Evicts least recently used entries when cache is full
   */
  private evictLRUEntries(spaceNeeded: number): void {
    const entries = Array.from(this.cache.entries());

    // Sort by last accessed time (ascending = oldest first)
    entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    let freedSpace = 0;
    let evictedCount = 0;

    for (const [key, entry] of entries) {
      if (
        this.cache.size <= this.config.maxEntries / 2 &&
        this.stats.totalSize + spaceNeeded <= this.config.maxSizeBytes
      ) {
        break; // Evicted enough
      }

      this.cache.delete(key);
      this.stats.totalSize -= entry.size;
      freedSpace += entry.size;
      evictedCount++;
      this.stats.evictions++;
    }

    if (evictedCount > 0) {
      logger.debug('Evicted LRU cache entries', {
        evictedCount,
        freedSpaceBytes: freedSpace,
        remainingEntries: this.cache.size,
      });
    }
  }

  /**
   * Gets cached result for a query
   */
  get(method: string, params: any): T | null {
    const key = this.generateCacheKey(method, params);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    const now = Date.now();

    // Check if entry is expired
    if (now - entry.timestamp > this.config.ttlMs) {
      this.cache.delete(key);
      this.stats.totalSize -= entry.size;
      this.stats.misses++;
      return null;
    }

    // Update access statistics
    entry.hits++;
    entry.lastAccessed = now;
    this.stats.hits++;

    logger.debug('Cache hit', {
      method,
      key: key.substring(0, 100),
      hits: entry.hits,
      age: now - entry.timestamp,
    });

    return entry.data;
  }

  /**
   * Sets cached result for a query
   */
  set(method: string, params: any, data: T): void {
    const key = this.generateCacheKey(method, params);
    const size = this.estimateSize(data);
    const now = Date.now();

    // Don't cache if data is too large
    if (size > this.config.maxSizeBytes / 4) {
      logger.debug('Skipping cache - data too large', {
        method,
        sizeBytes: size,
        maxAllowed: this.config.maxSizeBytes / 4,
      });
      return;
    }

    // Evict entries if necessary
    if (
      this.cache.size >= this.config.maxEntries ||
      this.stats.totalSize + size > this.config.maxSizeBytes
    ) {
      this.evictLRUEntries(size);
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      hits: 0,
      lastAccessed: now,
      size,
    };

    // Remove existing entry if it exists
    const existingEntry = this.cache.get(key);
    if (existingEntry) {
      this.stats.totalSize -= existingEntry.size;
    }

    this.cache.set(key, entry);
    this.stats.totalSize += size;

    logger.debug('Cache set', {
      method,
      key: key.substring(0, 100),
      sizeBytes: size,
      totalEntries: this.cache.size,
      totalSizeBytes: this.stats.totalSize,
    });
  }

  /**
   * Clears all cached entries
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalSize: 0,
    };

    logger.info('Cache cleared');
  }

  /**
   * Gets cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;

    return {
      totalEntries: this.cache.size,
      hitRate: parseFloat(hitRate.toFixed(2)),
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses,
      totalSize: this.stats.totalSize,
      maxSize: this.config.maxSizeBytes,
    };
  }

  /**
   * Removes specific cache entry
   */
  invalidate(method: string, params: any): void {
    const key = this.generateCacheKey(method, params);
    const entry = this.cache.get(key);

    if (entry) {
      this.cache.delete(key);
      this.stats.totalSize -= entry.size;

      logger.debug('Cache invalidated', {
        method,
        key: key.substring(0, 100),
      });
    }
  }

  /**
   * Invalidates cache entries matching a pattern
   */
  invalidateByPattern(pattern: string): number {
    let invalidatedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        this.stats.totalSize -= entry.size;
        invalidatedCount++;
      }
    }

    if (invalidatedCount > 0) {
      logger.debug('Cache invalidated by pattern', {
        pattern,
        invalidatedCount,
      });
    }

    return invalidatedCount;
  }
}

/**
 * Global cache instance for database queries
 * Can be configured via environment variables
 */
export const queryCache = new QueryCache({
  maxEntries: parseInt(process.env.CACHE_MAX_ENTRIES || '1000', 10),
  ttlMs: parseInt(process.env.CACHE_TTL_MS || '300000', 10), // 5 minutes default
  maxSizeBytes: parseInt(process.env.CACHE_MAX_SIZE_MB || '50', 10) * 1024 * 1024,
  enableStats: process.env.CACHE_ENABLE_STATS !== 'false',
});

/**
 * Decorator function to add caching to database methods
 */
export function cacheable<T extends any[], R>(ttlMs: number = DEFAULT_CACHE_CONFIG.ttlMs) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: any, ...args: T): Promise<R> {
      const cacheKey = `${this.constructor.name}.${propertyKey}`;

      // Try to get from cache
      const cached = queryCache.get(cacheKey, args);
      if (cached !== null) {
        return cached as R;
      }

      // Execute original method
      const result = await originalMethod.apply(this, args);

      // Cache the result
      queryCache.set(cacheKey, args, result);

      return result;
    };

    return descriptor;
  };
}

/**
 * Utility function for manual caching in database service methods
 */
export async function withCache<T>(
  method: string,
  params: any,
  queryFunction: () => Promise<T>,
  ttlMs?: number
): Promise<T> {
  // Try cache first
  const cached = queryCache.get(method, params);
  if (cached !== null) {
    return cached as T;
  }

  // Execute query
  const result = await queryFunction();

  // Cache result
  queryCache.set(method, params, result);

  return result;
}
