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
export { NamingPatternStrategy } from './naming-pattern-strategy';
export { ForwardDependencyStrategy } from './forward-dependency-strategy';
export { CrossStackStrategy } from './cross-stack-strategy';
export { ReverseCallerStrategy } from './reverse-caller-strategy';

/**
 * Factory function to create a fully configured discovery engine
 * with all standard strategies registered.
 */
import { DatabaseService } from '../../../database/services';
import { DiscoveryEngine } from './discovery-engine';
import { DependencyTraversalStrategy } from './dependency-traversal-strategy';
import { NamingPatternStrategy } from './naming-pattern-strategy';
import { ForwardDependencyStrategy } from './forward-dependency-strategy';
import { CrossStackStrategy } from './cross-stack-strategy';
import { ReverseCallerStrategy } from './reverse-caller-strategy';

export function createStandardDiscoveryEngine(
  dbService: DatabaseService,
  config?: {
    maxIterations?: number;
    convergenceThreshold?: number;
    debug?: boolean;
  }
): DiscoveryEngine {
  const engine = new DiscoveryEngine(config);

  // Register all standard strategies in priority order
  engine.registerStrategies([
    new DependencyTraversalStrategy(dbService),
    new NamingPatternStrategy(dbService),
    new ForwardDependencyStrategy(dbService),  // ← This fixes the bug!
    new CrossStackStrategy(dbService),
    new ReverseCallerStrategy(dbService),
  ]);

  return engine;
}
