/**
 * Vue-Laravel Feature Discovery Strategies
 *
 * This module provides Vue-Laravel specific discovery strategies that understand:
 * - Vue components, composables, and stores
 * - Laravel controllers, models, and API routes
 * - Cross-stack API calls (Vue ↔ Laravel)
 *
 * Usage:
 * ```typescript
 * const engine = createStandardVueLaravelDiscoveryEngine(db);
 * const { symbols, stats } = await engine.discover(entryPointId, repoId, featureName, options);
 * ```
 */

import type { Knex } from 'knex';
import { DiscoveryEngine } from '../common/discovery-engine';
import { DiscoveryEngineConfig } from '../common/types';
import { CleanDependencyTraversalStrategy } from './dependency-traversal-strategy';
import { CleanCrossStackStrategy } from './cross-stack-strategy';
import { PropDrivenStrategy } from './prop-driven-strategy';
import { ComposableDrivenStrategy } from './composable-driven-strategy';

// Export Vue-Laravel specific strategies
export { CleanDependencyTraversalStrategy } from './dependency-traversal-strategy';
export { CleanCrossStackStrategy } from './cross-stack-strategy';
export { PropDrivenStrategy } from './prop-driven-strategy';
export { ComposableDrivenStrategy } from './composable-driven-strategy';

/**
 * Factory function to create a standard Vue-Laravel discovery engine.
 * Uses pure graph traversal following actual execution paths.
 *
 * Best used when starting from controllers, services, or other backend entry points.
 */
export function createStandardVueLaravelDiscoveryEngine(
  db: Knex,
  config?: Partial<DiscoveryEngineConfig>
): DiscoveryEngine {
  const engine = new DiscoveryEngine(db, config);

  // Register clean executor-centric strategies
  // Pure graph traversal following actual execution paths
  engine.registerStrategies([
    new CleanCrossStackStrategy(db),           // API bridging (priority 5)
    new CleanDependencyTraversalStrategy(db),  // Executor-centric BFS (priority 10)
  ]);

  return engine;
}

/**
 * Factory function to create a prop-driven discovery engine.
 * Uses data flow analysis through component props for precise feature discovery.
 *
 * Best used when starting from Vue components.
 */
export function createPropDrivenDiscoveryEngine(
  db: Knex,
  config?: Partial<DiscoveryEngineConfig>
): DiscoveryEngine {
  const engine = new DiscoveryEngine(db, config);

  // Register prop-driven strategy
  // Follows data flow through component props for precise discovery
  engine.registerStrategies([
    new PropDrivenStrategy(db),                // Prop-driven analysis (priority 3)
    new CleanCrossStackStrategy(db),           // API bridging (priority 5)
    new CleanDependencyTraversalStrategy(db),  // Executor-centric BFS (priority 10)
  ]);

  return engine;
}

/**
 * Factory function to create a composable-driven discovery engine.
 * Follows composable execution flow for precise feature discovery.
 *
 * Best used when starting from Vue composables.
 *
 * NOTE: Does NOT use dependency-traversal to avoid discovering all composables
 * from parent components. Composable-driven is comprehensive enough on its own.
 */
export function createComposableDrivenDiscoveryEngine(
  db: Knex,
  config?: Partial<DiscoveryEngineConfig>
): DiscoveryEngine {
  const engine = new DiscoveryEngine(db, config);

  // Register ONLY composable-driven and cross-stack strategies
  // Composable-driven explicitly discovers all needed symbols (composable, stores, components)
  // Cross-stack bridges frontend to backend via API calls
  // We intentionally OMIT dependency-traversal to prevent discovering all composables from parent components
  engine.registerStrategies([
    new ComposableDrivenStrategy(db),          // Composable-driven analysis (priority 3)
    new CleanCrossStackStrategy(db),           // API bridging (priority 5)
  ]);

  return engine;
}
