/**
 * Discovery Strategies - Plugin-based Feature Discovery
 *
 * This module provides a clean, extensible architecture for discovering
 * feature-related symbols across a codebase using multiple strategies
 * that run iteratively until convergence.
 *
 * The strategies are organized by framework:
 * - common/: Framework-agnostic strategies (dependency traversal, engine, types)
 * - vue-laravel/: Vue-Laravel specific strategies (cross-stack, prop-driven, composable-driven)
 * - godot/: Godot-specific strategies (to be implemented)
 *
 * Usage:
 * ```typescript
 * // For Vue-Laravel projects
 * import { createStandardVueLaravelDiscoveryEngine } from './discovery-strategies';
 * const engine = createStandardVueLaravelDiscoveryEngine(db, { maxIterations: 3 });
 * const { symbols, stats } = await engine.discover(entryPointId, repoId, featureName, options);
 *
 * // For Godot projects
 * import { createStandardGodotDiscoveryEngine } from './discovery-strategies';
 * const engine = createStandardGodotDiscoveryEngine(db, { maxIterations: 3 });
 * const { symbols, stats } = await engine.discover(entryPointId, repoId, featureName, options);
 * ```
 */

// ============================================================================
// Common exports (framework-agnostic)
// ============================================================================

// Core types and interfaces
export * from './common/types';

// Discovery engine
export { DiscoveryEngine } from './common/discovery-engine';

// Constants
export * from './common/constants';

// ============================================================================
// Vue-Laravel exports
// ============================================================================

// Vue-Laravel specific strategies
export { CleanDependencyTraversalStrategy } from './vue-laravel/dependency-traversal-strategy';
export { CleanCrossStackStrategy } from './vue-laravel/cross-stack-strategy';
export { PropDrivenStrategy } from './vue-laravel/prop-driven-strategy';
export { ComposableDrivenStrategy } from './vue-laravel/composable-driven-strategy';

// Vue-Laravel symbol classification utilities (Vue/Laravel entity types)
export * from './vue-laravel/symbol-classifier';

// Vue-Laravel factory functions
export {
  createStandardVueLaravelDiscoveryEngine,
  createPropDrivenDiscoveryEngine,
  createComposableDrivenDiscoveryEngine,
} from './vue-laravel';

// ============================================================================
// Godot exports
// ============================================================================

// Godot factory functions
export { createStandardGodotDiscoveryEngine } from './godot';
