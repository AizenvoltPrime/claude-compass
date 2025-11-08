/**
 * Godot Feature Discovery Strategies
 *
 * Provides Godot-specific discovery strategies that understand:
 * - Godot nodes and scenes (scene hierarchy traversal)
 * - C# classes and methods (dependency graph traversal)
 * - Signal connections (event-driven communication)
 * - Autoloads (global singletons)
 *
 * Godot architecture mirrors backend layering:
 * - Nodes: Leaf entities (building blocks)
 * - Coordinators/Managers: Middleware (orchestrators)
 * - Handlers: Entry points (input/event processors)
 *
 * Usage:
 * ```typescript
 * const engine = createStandardGodotDiscoveryEngine(db);
 * const { symbols, stats } = await engine.discover(entryPointId, repoId, featureName, options);
 * ```
 */

import type { Knex } from 'knex';
import { DiscoveryEngine } from '../common/discovery-engine';
import { DiscoveryEngineConfig } from '../common/types';
import { SignalFlowStrategy } from './signal-flow-strategy';
import { SceneHierarchyStrategy } from './scene-hierarchy-strategy';
import { AutoloadStrategy } from './autoload-strategy';
import { GodotDependencyTraversalStrategy } from './godot-dependency-traversal-strategy';

/**
 * Factory function to create a standard Godot discovery engine.
 *
 * Registers 4 discovery strategies in priority order:
 * 1. Signal Flow (priority 7) - Follows signal-slot connections
 * 2. Scene Hierarchy (priority 8) - Discovers scenes and nodes
 * 3. Autoload (priority 9) - Finds global singletons
 * 4. Dependency Traversal (priority 10) - Follows C# call graph
 *
 * Supported Godot entity types:
 * - node: Scene tree nodes (Node, Node2D, Control, etc.)
 * - coordinator: Orchestrators between layers
 * - manager: System managers
 * - handler: Input/event handlers
 * - service: Shared services
 * - ui_component: UI elements
 * - resource: Data resources
 * - engine: Game engines/systems
 * - pool: Object pools
 */
export function createStandardGodotDiscoveryEngine(
  db: Knex,
  config?: Partial<DiscoveryEngineConfig>
): DiscoveryEngine {
  const engine = new DiscoveryEngine(db, config);

  engine.registerStrategies([
    new SignalFlowStrategy(db),
    new SceneHierarchyStrategy(db),
    new AutoloadStrategy(db),
    new GodotDependencyTraversalStrategy(db),
  ]);

  return engine;
}
