/**
 * Symbol Classifier
 *
 * Categorizes symbols by their execution role in the codebase.
 * This forms the foundation for clean, executor-centric graph traversal.
 */

export enum SymbolRole {
  EXECUTOR = 'EXECUTOR',     // Can execute code: methods, functions, composables
  CONTAINER = 'CONTAINER',   // Holds executors: classes, stores, files
  ENTITY = 'ENTITY',         // Architectural significance: models, services, controllers, components
  DATA = 'DATA',             // Pure definitions: interfaces, types, variables, properties
}

export interface SymbolInfo {
  id: number;
  name: string;
  symbol_type: string;
  entity_type?: string;
  file_id: number;
}

/**
 * Classify a symbol into its execution role.
 *
 * Rules:
 * - EXECUTOR: Symbols that can run code (methods, functions, composables)
 * - CONTAINER: Symbols that hold executors but don't run (classes, stores)
 * - ENTITY: Architectural entities (models, services, controllers, components, requests, jobs)
 * - DATA: Pure definitions (interfaces, types, variables, properties)
 */
export function classifySymbol(symbol: SymbolInfo): SymbolRole {
  const { symbol_type, entity_type } = symbol;

  // EXECUTORS - Can run code
  if (symbol_type === 'method' || symbol_type === 'function') {
    // Exception: Composables are executors even though they're functions
    if (entity_type === 'composable') {
      return SymbolRole.EXECUTOR;
    }
    return SymbolRole.EXECUTOR;
  }

  // Special case: composables without explicit symbol_type
  if (entity_type === 'composable') {
    return SymbolRole.EXECUTOR;
  }

  // ENTITIES - Architectural significance
  const architecturalEntities = [
    'model',
    'service',
    'controller',
    'component',
    'request',
    'job',
    'middleware',
    'notification',
    'command',
    'provider',
    'node',
    'ui_component',
    'resource',
    'manager',
    'handler',
    'coordinator',
    'engine',
    'pool',
    'repository',
    'factory',
    'builder',
    'validator',
    'adapter',
  ];

  if (entity_type && architecturalEntities.includes(entity_type)) {
    // Check if it's a class-like entity (container) or method-like (executor)
    if (symbol_type === 'class') {
      return SymbolRole.CONTAINER;
    }
    // Entity methods are executors
    if (symbol_type === 'method') {
      return SymbolRole.EXECUTOR;
    }
    return SymbolRole.ENTITY;
  }

  // CONTAINERS - Hold executors
  if (symbol_type === 'class') {
    return SymbolRole.CONTAINER;
  }

  // Stores are architectural entities, NOT containers to expand
  // Prevents explosion when component calls store - store acts as execution boundary
  // Cross-stack strategy handles frontend-backend bridging via api_calls table
  if (entity_type === 'store') {
    return SymbolRole.ENTITY;
  }

  if (symbol_type === 'file') {
    return SymbolRole.CONTAINER;
  }

  // DATA - Pure definitions
  const dataTypes = ['interface', 'type', 'variable', 'property', 'enum', 'constant'];
  if (dataTypes.includes(symbol_type)) {
    return SymbolRole.DATA;
  }

  // Default: treat as data (don't traverse from it)
  return SymbolRole.DATA;
}

/**
 * Determine traversal direction based on symbol role and entity type.
 *
 * Rules:
 * - Backend entry points (controller methods): FORWARD (what they call)
 * - Backend leaf entities (models, service classes): BACKWARD (who uses them)
 * - Frontend entry points (components): FORWARD (what they call)
 * - Service methods: BOTH (bridge between controllers and models)
 * - Other executors: BOTH (execution chain)
 */
export type TraversalDirection = 'forward' | 'backward' | 'both';

export function getTraversalDirection(symbol: SymbolInfo, role: SymbolRole): TraversalDirection {
  const { entity_type, symbol_type } = symbol;

  // Backend entry points: controller methods forward only
  // Controllers are entry points and don't need to discover callers
  // This prevents backward explosion when controllers are discovered mid-traversal
  if (entity_type === 'controller' && symbol_type === 'method') {
    return 'forward';
  }

  // Service methods: bidirectional (middle layer between controllers and models)
  // MUST remain 'both' to allow backward traversal from models to reach controllers

  // Trait/utility methods: forward only (shared infrastructure)
  // Prevents backward explosion through shared infrastructure methods
  if (entity_type === 'method' && symbol_type === 'method') {
    return 'forward';
  }

  // Backend leaf entities: discover backward (who uses them)
  // Models search backward for services/controllers
  // Service classes (not methods) traverse backward to find controllers
  if (entity_type === 'model' || (entity_type === 'service' && symbol_type === 'class')) {
    return 'backward';
  }

  // Frontend entry points: components discover forward (what they call)
  if (entity_type === 'component' && symbol_type !== 'method') {
    return 'forward';
  }

  // Store methods and other executors: bidirectional (execution chain)
  // Bridges between frontend and backend
  if (role === SymbolRole.EXECUTOR) {
    return 'both';
  }

  // Containers and other entities: bidirectional
  if (role === SymbolRole.CONTAINER || role === SymbolRole.ENTITY) {
    return 'both';
  }

  // Data: don't traverse (but shouldn't reach here in practice)
  return 'forward';
}
