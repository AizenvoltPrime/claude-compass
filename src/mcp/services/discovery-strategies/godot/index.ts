/**
 * Godot Feature Discovery Strategies
 *
 * This module provides Godot-specific discovery strategies that understand:
 * - Godot nodes and scenes
 * - GDScript classes and functions
 * - Signal connections and dependencies
 * - Resource files and autoloads
 *
 * TODO: Implement Godot-specific discovery strategies
 *
 * Planned strategies:
 * - Scene-driven: Discovers features by following scene hierarchy
 * - Signal-driven: Follows signal connections between nodes
 * - Node-driven: Traces node dependencies and child relationships
 *
 * Usage (when implemented):
 * ```typescript
 * const engine = createStandardGodotDiscoveryEngine(db);
 * const { symbols, stats } = await engine.discover(entryPointId, repoId, featureName, options);
 * ```
 */

import type { Knex } from 'knex';
import { DiscoveryEngine } from '../common/discovery-engine';
import { DiscoveryEngineConfig } from '../common/types';

/**
 * Factory function to create a standard Godot discovery engine.
 *
 * WARNING: Godot-specific discovery strategies are not yet implemented.
 * This returns an empty engine that will not discover any symbols.
 *
 * TODO: Implement Godot-specific strategies:
 * - Scene hierarchy traversal (discovers nodes in scene tree)
 * - Signal connection discovery (follows signal/callback connections)
 * - Node relationship analysis (parent/child node relationships)
 * - Autoload and resource discovery (singleton nodes, resources)
 * - GDScript class inheritance traversal
 *
 * Godot-specific entity types to support:
 * - node: Scene tree nodes (Node2D, Spatial, Control, etc.)
 * - scene: .tscn scene files
 * - script: .gd GDScript files
 * - resource: Resource files (.tres, .res)
 * - autoload: Singleton/autoload scripts
 */
export function createStandardGodotDiscoveryEngine(
  db: Knex,
  config?: Partial<DiscoveryEngineConfig>
): DiscoveryEngine {
  const engine = new DiscoveryEngine(db, config);

  // TODO: Add Godot-specific strategies when implemented
  // For now, return an empty engine
  // Note: The Vue-Laravel dependency traversal strategy cannot be used here
  // as it assumes Vue/Laravel entity types (component, store, controller, etc.)

  return engine;
}
