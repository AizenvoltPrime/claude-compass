/**
 * Constants for feature discovery strategies.
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
 * Critical strategy priority threshold.
 * Strategies with priority <= this value must succeed.
 */
export const CRITICAL_STRATEGY_PRIORITY = 10;
