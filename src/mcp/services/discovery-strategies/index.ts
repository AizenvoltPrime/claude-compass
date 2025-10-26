/**
 * Discovery Strategies - Plugin-based Feature Discovery
 *
 * This module provides a clean, extensible architecture for discovering
 * feature-related symbols across a codebase using multiple strategies
 * that run iteratively until convergence.
 *
 * Usage:
 * ```typescript
 * const engine = new DiscoveryEngine({ maxIterations: 3 });
 * engine.registerStrategies([
 *   new DependencyTraversalStrategy(dbService),
 *   new NamingPatternStrategy(dbService),
 *   new ForwardDependencyStrategy(dbService),
 *   new CrossStackStrategy(dbService),
 *   new ReverseCallerStrategy(dbService),
 * ]);
 *
 * const { symbols, stats } = await engine.discover(
 *   entryPointId,
 *   repoId,
 *   featureName,
 *   options
 * );
 * ```
 */

// Core types and interfaces
export * from './types';

// Discovery engine
export { DiscoveryEngine } from './discovery-engine';

// Individual strategies (clean executor-centric versions)
export { CleanDependencyTraversalStrategy } from './dependency-traversal-strategy';
export { CleanCrossStackStrategy } from './cross-stack-strategy';
export { PropDrivenStrategy } from './prop-driven-strategy';

// Symbol classification utilities
export * from './symbol-classifier';

// Constants
export * from './constants';

/**
 * Factory function to create a fully configured discovery engine
 * with clean executor-centric strategies.
 */
import { DatabaseService } from '../../../database/services';
import { DiscoveryEngine } from './discovery-engine';
import { DiscoveryEngineConfig } from './types';
import { CleanDependencyTraversalStrategy } from './dependency-traversal-strategy';
import { CleanCrossStackStrategy } from './cross-stack-strategy';
import { PropDrivenStrategy } from './prop-driven-strategy';

export function createStandardDiscoveryEngine(
  dbService: DatabaseService,
  config?: Partial<DiscoveryEngineConfig>
): DiscoveryEngine {
  const engine = new DiscoveryEngine(dbService, config);

  // Register clean executor-centric strategies
  // Pure graph traversal following actual execution paths
  engine.registerStrategies([
    new CleanCrossStackStrategy(dbService),           // API bridging (priority 5)
    new CleanDependencyTraversalStrategy(dbService),  // Executor-centric BFS (priority 10)
  ]);

  return engine;
}

/**
 * Factory function to create a prop-driven discovery engine.
 * Uses data flow analysis through component props for precise feature discovery.
 * Best used when starting from Vue components.
 */
export function createPropDrivenDiscoveryEngine(
  dbService: DatabaseService,
  config?: Partial<DiscoveryEngineConfig>
): DiscoveryEngine {
  const engine = new DiscoveryEngine(dbService, config);

  // Register prop-driven strategy
  // Follows data flow through component props for precise discovery
  engine.registerStrategies([
    new PropDrivenStrategy(dbService),                // Prop-driven analysis (priority 3)
    new CleanCrossStackStrategy(dbService),           // API bridging (priority 5)
    new CleanDependencyTraversalStrategy(dbService),  // Executor-centric BFS (priority 10)
  ]);

  return engine;
}
