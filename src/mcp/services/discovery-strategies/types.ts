/**
 * Core types for the plugin-based feature discovery architecture.
 *
 * This module defines the contract for discovery strategies, allowing them to be
 * composed, tested independently, and executed iteratively until convergence.
 */

/**
 * Context provided to each discovery strategy during execution.
 * Contains all information needed for strategy to discover related symbols.
 */
export interface DiscoveryContext {
  /**
   * Symbol IDs already discovered in previous iterations.
   * Strategies should explore relationships from/to these symbols.
   */
  currentSymbols: number[];

  /**
   * The repository being analyzed.
   */
  repoId: number;

  /**
   * The feature name extracted from the entry point symbol.
   * Used for naming pattern matching and filtering.
   */
  featureName: string;

  /**
   * The entry point symbol ID that started the discovery.
   */
  entryPointId: number;

  /**
   * Configuration options for discovery.
   */
  options: {
    maxDepth: number;
    includeComponents: boolean;
    includeRoutes: boolean;
    includeModels: boolean;
    includeTests: boolean;
    maxSymbols: number;
    minRelevanceScore: number;
  };

  /**
   * Current iteration number (0-indexed).
   * Strategies can adjust behavior based on iteration depth.
   */
  iteration: number;

  /**
   * Symbol IDs that were discovered through direct graph edges (API calls, dependencies).
   * Populated by cross-stack strategy when discovering controllers via API graph.
   */
  graphValidatedSymbols: Set<number>;

  /**
   * Symbol IDs added to provide validation context but NOT part of the feature itself.
   *
   * Context symbols are used for validation logic (e.g., checking if a request is used
   * by discovered controller methods) but should NOT appear in the final feature manifest.
   *
   * This separation prevents route discovery from including unrelated CRUD endpoints
   * when starting from backend models.
   */
  contextSymbols: Set<number>;

  /**
   * Indicates if the entry point is frontend-focused (store, composable, or component).
   * Used to adjust depth filtering for components in dependency traversal:
   * - Frontend entry points: Allow deeper component discovery
   * - Backend entry points: Limit component depth to avoid UI noise
   */
  isFrontendEntryPoint: boolean;

  /**
   * Entry point layer classification for direction-aware discovery:
   * - 'frontend-leaf': Component → traverse forward only (what does it need)
   * - 'backend-leaf': Model/Service → traverse backward only (who uses it)
   * - 'middle-layer': Composable/Store/Endpoint → traverse both (who uses + what needs)
   */
  entryPointLayer: 'frontend-leaf' | 'backend-leaf' | 'middle-layer';
}

/**
 * Result of a discovery strategy execution.
 * Maps symbol IDs to relevance scores (0.0 to 1.0).
 */
export type DiscoveryResult = Map<number, number>;

/**
 * Base interface for all discovery strategies.
 *
 * Each strategy implements a different method of finding related symbols:
 * - Dependency traversal (forward/backward)
 * - Naming pattern matching
 * - Cross-stack API tracing
 * - Reverse caller analysis
 */
export interface DiscoveryStrategy {
  /**
   * Unique identifier for this strategy.
   * Used for logging and debugging.
   */
  readonly name: string;

  /**
   * Human-readable description of what this strategy discovers.
   */
  readonly description: string;

  /**
   * Priority order for execution (lower runs first).
   * Allows control over strategy execution sequence.
   */
  readonly priority: number;

  /**
   * Discover related symbols based on the provided context.
   *
   * @param context - Current discovery state and configuration
   * @returns Map of newly discovered symbol IDs to their relevance scores
   */
  discover(context: DiscoveryContext): Promise<DiscoveryResult>;

  /**
   * Optional: Check if this strategy should run in the current iteration.
   * Allows strategies to skip execution based on iteration depth or other factors.
   *
   * @param context - Current discovery state
   * @returns true if strategy should execute, false to skip
   */
  shouldRun?(context: DiscoveryContext): boolean;

  /**
   * Optional: Reset internal state (caches, visited sets, etc.).
   * Called before each discovery run to prevent memory leaks and ensure clean state.
   * Strategies that maintain internal state MUST implement this method.
   */
  reset?(): void;
}

/**
 * Configuration for the discovery engine.
 */
export interface DiscoveryEngineConfig {
  /**
   * Maximum iterations to run before terminating.
   * Prevents infinite loops if strategies don't converge.
   */
  maxIterations: number;

  /**
   * Stop if no new symbols discovered after this many iterations.
   * Default: 1 (stop as soon as convergence reached)
   */
  convergenceThreshold: number;

  /**
   * Enable detailed logging for debugging.
   */
  debug: boolean;
}

/**
 * Performance and discovery statistics for a single strategy.
 */
export interface StrategyStatistics {
  /**
   * Number of times this strategy was executed.
   */
  executions: number;

  /**
   * Total symbols discovered by this strategy across all executions.
   */
  symbolsDiscovered: number;

  /**
   * Average execution time per run in milliseconds.
   */
  avgExecutionTime: number;
}

/**
 * Statistics collected during discovery execution.
 */
export interface DiscoveryStats {
  /**
   * Total iterations executed.
   */
  iterations: number;

  /**
   * Symbols discovered per iteration.
   */
  symbolsPerIteration: number[];

  /**
   * Statistics per strategy.
   */
  strategyStats: Map<string, StrategyStatistics>;

  /**
   * Total execution time in milliseconds.
   */
  totalTime: number;

  /**
   * Whether convergence was reached.
   */
  converged: boolean;

  /**
   * Strategies that failed during execution.
   * Each entry contains strategy name, iteration, and error message.
   */
  failedStrategies: Array<{
    strategy: string;
    iteration: number;
    error: string;
  }>;
}
