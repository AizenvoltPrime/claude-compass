/**
 * Godot Symbol Classifier
 *
 * Categorizes Godot symbols by their execution role in game architecture.
 * Godot's architecture mirrors backend layering:
 * - Nodes are leaf entities (building blocks)
 * - Coordinators/Managers are middleware (orchestrators)
 * - Handlers are entry points (input/event processors)
 */

export enum GodotSymbolRole {
  EXECUTOR = 'EXECUTOR',
  CONTAINER = 'CONTAINER',
  ENTITY = 'ENTITY',
  DATA = 'DATA',
}

export interface GodotSymbolInfo {
  id: number;
  name: string;
  symbol_type: string;
  entity_type?: string;
  file_id: number;
}

export type GodotTraversalDirection = 'forward' | 'backward' | 'both';

export class GodotSymbolClassifier {
  static readonly ARCHITECTURAL_ENTITY_TYPES = [
    'node',
    'ui_component',
    'resource',
    'manager',
    'handler',
    'coordinator',
    'engine',
    'pool',
    'service',
    'controller',
    'factory',
    'validator',
  ];

  static readonly DATA_SYMBOL_TYPES = [
    'interface',
    'type',
    'variable',
    'property',
    'enum',
    'constant',
  ];
}

/**
 * Classify a Godot symbol into its execution role.
 */
export function classifyGodotSymbol(symbol: GodotSymbolInfo): GodotSymbolRole {
  const { symbol_type, entity_type } = symbol;

  if (symbol_type === 'method' || symbol_type === 'function') {
    return GodotSymbolRole.EXECUTOR;
  }

  if (entity_type && GodotSymbolClassifier.ARCHITECTURAL_ENTITY_TYPES.includes(entity_type)) {
    if (symbol_type === 'class') {
      return GodotSymbolRole.CONTAINER;
    }
    if (symbol_type === 'method') {
      return GodotSymbolRole.EXECUTOR;
    }
    return GodotSymbolRole.ENTITY;
  }

  if (symbol_type === 'class') {
    return GodotSymbolRole.CONTAINER;
  }

  if (symbol_type === 'file') {
    return GodotSymbolRole.CONTAINER;
  }

  if (GodotSymbolClassifier.DATA_SYMBOL_TYPES.includes(symbol_type)) {
    return GodotSymbolRole.DATA;
  }

  return GodotSymbolRole.DATA;
}

/**
 * Determine traversal direction for Godot symbols.
 *
 * Conservative approach rules:
 * - Nodes (leaf entities): BACKWARD - discover who uses them
 * - Coordinators/Managers (middleware): BOTH - bridge between layers
 * - Handlers (entry points): FORWARD - discover what they call
 * - Service classes: BACKWARD - find their consumers
 * - Methods: FORWARD - discover execution flow
 */
export function getGodotTraversalDirection(symbol: GodotSymbolInfo, role: GodotSymbolRole): GodotTraversalDirection {
  const { entity_type, symbol_type } = symbol;

  // Godot nodes: leaf entities, traverse backward (like Laravel models)
  // Nodes are building blocks that higher-level systems coordinate
  if (entity_type === 'node' && symbol_type === 'class') {
    return 'backward';
  }

  // Godot coordinators/managers: middleware layer, bidirectional (like Laravel services)
  // These orchestrate between handlers and nodes/services
  if (entity_type === 'coordinator' || entity_type === 'manager') {
    return 'both';
  }

  // Godot handlers: entry points, forward only (like Laravel controllers)
  // Input handlers, event handlers - they initiate execution chains
  if (entity_type === 'handler') {
    return 'forward';
  }

  // Godot engines/pools: infrastructure layer, backward (discover consumers)
  if (entity_type === 'engine' || entity_type === 'pool') {
    return 'backward';
  }

  // Godot service classes: backward traversal to find coordinators/handlers
  // Services are consumed by higher-level coordinators
  if (entity_type === 'service' && symbol_type === 'class') {
    return 'backward';
  }

  // Godot UI components: forward (similar to Vue components)
  // UI components initiate actions downward
  if (entity_type === 'ui_component') {
    return 'forward';
  }

  // Godot resources: backward (data containers consumed by nodes)
  if (entity_type === 'resource') {
    return 'backward';
  }

  // Methods and executors: BOTH (execution chain traversal)
  if (role === GodotSymbolRole.EXECUTOR) {
    return 'both';
  }

  // Containers and other entities: bidirectional
  if (role === GodotSymbolRole.CONTAINER || role === GodotSymbolRole.ENTITY) {
    return 'both';
  }

  // Default: forward for data types
  return 'forward';
}
