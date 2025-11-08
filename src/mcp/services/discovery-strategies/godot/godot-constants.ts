/**
 * Godot Architecture Constants
 *
 * Central definitions of entity type classifications for Godot game architecture.
 * Consolidates entity type definitions used across traversal strategy, depth filtering,
 * and file validation policies.
 *
 * Key Insight: Godot's global singleton architecture (managers, services) differs from
 * web frameworks where services are feature-scoped. These distinctions must be carefully
 * maintained to prevent pollution while discovering essential dependencies.
 */

/**
 * Feature-specific entities that define the boundaries of a feature.
 * These are always followed during graph traversal and validate their containing files.
 *
 * - handler: Phase handlers for game logic
 * - event_channel: Feature-specific event channels
 */
export const FEATURE_SCOPED_ENTITIES: readonly string[] = ['handler', 'event_channel'];

/**
 * Node-based entities that are part of the Godot scene tree.
 * These are data/state containers (like models in backend), not execution layers.
 *
 * - node: Scene tree nodes (inheriting from Node)
 * - resource: Resource objects (inheriting from Resource)
 */
export const NODE_ENTITIES: readonly string[] = ['node', 'resource'];

/**
 * Global singleton infrastructure that spans multiple features.
 * These must be handled carefully to prevent cross-feature pollution.
 *
 * - manager: Global state managers
 * - coordinator: Service registry singletons
 * - controller: Global game controllers
 * - service: Global services shared across features
 */
export const GLOBAL_INFRASTRUCTURE_ENTITIES: readonly string[] = [
  'manager',
  'coordinator',
  'controller',
  'service',
];

/**
 * All architectural entities that participate in feature discovery.
 * Combination of feature-scoped, node-based, and global infrastructure entities.
 */
export const ALL_ARCHITECTURAL_ENTITIES: readonly string[] = [
  ...FEATURE_SCOPED_ENTITIES,
  ...NODE_ENTITIES,
  ...GLOBAL_INFRASTRUCTURE_ENTITIES,
];

/**
 * Entities that should always be followed during graph traversal.
 * These define feature boundaries and are safe to traverse deeply.
 *
 * Includes:
 * - Feature-scoped entities (handlers, event channels)
 * - Node entities (scene tree data)
 */
export const ALWAYS_FOLLOW_ENTITIES: readonly string[] = [...FEATURE_SCOPED_ENTITIES, ...NODE_ENTITIES];

/**
 * Entities that validate their containing files for symbol inclusion at depth > 1.
 * Files containing these entities are considered "architectural files" and their
 * symbols can be included even at deeper traversal depths.
 *
 * Excludes nodes/resources because they're data containers, not architectural components.
 */
export const FILE_VALIDATING_ENTITIES: readonly string[] = [
  'handler',
  'manager',
  'coordinator',
  'controller',
  'service',
  'ui_component',
];

/**
 * Shared boundaries that appear across multiple features.
 * Used for depth-based filtering to prevent pollution.
 *
 * Includes all infrastructure plus nodes/resources that can be shared.
 */
export const SHARED_BOUNDARIES: readonly string[] = [
  ...GLOBAL_INFRASTRUCTURE_ENTITIES,
  ...NODE_ENTITIES,
  'handler',
];

/**
 * Core architectural layers that form the execution hierarchy.
 * These are the orchestration layers (not data layers).
 */
export const ARCHITECTURAL_LAYERS: readonly string[] = [
  'handler',
  'manager',
  'coordinator',
  'controller',
  'service',
];

/**
 * Entity types that can be traversed to greater depths.
 * Data structures (nodes, resources) are safer to traverse deeply than execution layers.
 */
export const DEEP_TRAVERSAL_ENTITIES: readonly string[] = [
  'node',
  'resource',
  'data_model',
  'handler',
  'controller',
];
