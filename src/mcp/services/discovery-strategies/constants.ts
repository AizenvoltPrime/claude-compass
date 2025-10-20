/**
 * Constants for feature discovery strategies.
 *
 * Extracted from individual strategies to maintain consistency
 * and make configuration easier.
 */

/**
 * Maximum number of nodes to visit during BFS traversal.
 * Prevents infinite loops and excessive memory usage.
 */
export const MAX_VISITED_NODES = 50000;

/**
 * Maximum size of the BFS queue.
 * Prevents memory exhaustion in large codebases.
 */
export const MAX_QUEUE_SIZE = 10000;

/**
 * Default limit for database queries.
 * Balances between completeness and performance.
 */
export const DEFAULT_SEARCH_LIMIT = 100;

/**
 * Maximum number of patterns to generate for naming strategy.
 * Prevents combinatorial explosion with complex feature names.
 */
export const MAX_NAMING_PATTERNS = 50;

/**
 * Number of top entity types to use for suffix detection.
 * Focuses on most common patterns without noise.
 */
export const MAX_ENTITY_TYPES_FOR_SUFFIX = 5;

/**
 * Number of function names to sample for verb detection.
 * Balances accuracy with query performance.
 */
export const FUNCTION_SAMPLE_SIZE_FOR_VERBS = 1000;

/**
 * Critical strategy priority threshold.
 * Strategies with priority <= this value must succeed.
 */
export const CRITICAL_STRATEGY_PRIORITY = 10;
