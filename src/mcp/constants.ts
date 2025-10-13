/**
 * Minimum depth for dependency traversal (direct relationships only)
 */
export const MIN_DEPTH = 1;

/**
 * Maximum depth to prevent exponential explosion in large codebases
 */
export const MAX_DEPTH = 20;

/**
 * Default depth for targeted dependency queries (whoCalls, listDependencies)
 * Optimized for "what does this call?" queries requiring immediate context
 */
export const DEFAULT_DEPENDENCY_DEPTH = 1;

/**
 * Default depth for impact analysis
 * Optimized for "what breaks if I change this?" requiring cascade effects
 */
export const DEFAULT_IMPACT_DEPTH = 5;

/**
 * Threshold where transitive analysis becomes too expensive
 * Skip transitive queries when direct results exceed this count
 */
export const TRANSITIVE_ANALYSIS_THRESHOLD = 20;
