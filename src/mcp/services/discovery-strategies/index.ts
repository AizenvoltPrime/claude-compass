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

// Individual strategies
export { DependencyTraversalStrategy } from './dependency-traversal-strategy';
export { CrossStackStrategy } from './cross-stack-strategy';

/**
 * Factory function to create a fully configured discovery engine
 * with all standard graph-based strategies registered.
 */
import { DatabaseService } from '../../../database/services';
import { DiscoveryEngine } from './discovery-engine';
import { DiscoveryEngineConfig } from './types';
import { DependencyTraversalStrategy } from './dependency-traversal-strategy';
import { CrossStackStrategy } from './cross-stack-strategy';

export function createStandardDiscoveryEngine(
  dbService: DatabaseService,
  config?: Partial<DiscoveryEngineConfig>
): DiscoveryEngine {
  const engine = new DiscoveryEngine(dbService, config);

  // Register graph-based discovery strategies
  // These strategies follow actual code relationships (imports, calls, API connections)
  engine.registerStrategies([
    new CrossStackStrategy(dbService),        // Frontend → Backend API connections
    new DependencyTraversalStrategy(dbService), // Layer-based BFS following actual dependencies
  ]);

  return engine;
}
