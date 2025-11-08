/**
 * Godot Depth Filter Policy
 *
 * Prevents pollution from deep transitive dependencies in Godot game architecture.
 * Tailored for C# game code with handlers, managers, coordinators, and services.
 *
 * Key differences from web frameworks:
 * - Game architecture has more orchestration layers (managers, coordinators)
 * - Nodes are leaf entities (like models in backend)
 * - No API routes - uses signals for event communication
 */

import type { GodotTraversalDirection } from './symbol-classifier';
import {
  SHARED_BOUNDARIES,
  ARCHITECTURAL_LAYERS,
  DEEP_TRAVERSAL_ENTITIES,
} from './godot-constants';

export interface GodotDepthFilterConfig {
  entityType?: string;
  symbolType: string;
  depth: number;
  direction: GodotTraversalDirection;
  entryPointEntityType?: string;
}

export class GodotDepthFilterPolicy {

  /**
   * Should filter shared architectural boundaries based on depth.
   * These are components that appear in many features (managers, services, etc.)
   */
  shouldFilterSharedBoundary(config: GodotDepthFilterConfig): boolean {
    if (config.depth === 0) {
      return false;
    }

    if (!config.entityType) {
      return false;
    }

    if (!SHARED_BOUNDARIES.includes(config.entityType)) {
      return false;
    }

    const threshold = this.getEntityDepthThreshold(config.entityType, config.direction);
    return config.depth >= threshold;
  }

  /**
   * Should filter architectural layer boundaries.
   * Prevents discovering all handlers/managers in the game.
   */
  shouldFilterArchitecturalLayer(config: GodotDepthFilterConfig): boolean {
    if (!config.entityType) {
      return false;
    }

    if (!ARCHITECTURAL_LAYERS.includes(config.entityType)) {
      return false;
    }

    const threshold = config.direction === 'forward' ? 2 : 4;
    return config.depth >= threshold;
  }

  /**
   * Should filter entity based on depth and type.
   * Main pollution prevention mechanism.
   */
  shouldFilterEntity(config: GodotDepthFilterConfig): boolean {
    if (!config.entityType) {
      return false;
    }

    if (!DEEP_TRAVERSAL_ENTITIES.includes(config.entityType)) {
      return false;
    }

    const threshold = this.getEntityDepthThreshold(config.entityType, config.direction);
    return config.depth >= threshold;
  }

  /**
   * Should filter methods based on depth.
   * Prevents utility method pollution from shared infrastructure.
   */
  shouldFilterMethod(config: GodotDepthFilterConfig): boolean {
    if (config.symbolType !== 'method') {
      return false;
    }

    // Methods at depth 0-1 are always allowed (direct feature methods)
    // Methods at depth 2+ need parent validation (checked elsewhere)
    const threshold = config.direction === 'forward' ? 2 : 4;
    return config.depth >= threshold;
  }

  /**
   * Allow deep node queuing for node-centric features.
   * Similar to model bypass in backend - nodes are data entities.
   */
  shouldAllowDeepNodeQueuing(config: GodotDepthFilterConfig): boolean {
    const isNodeEntryContext = config.entryPointEntityType === 'node';
    const allowDeepNodeQueuing = isNodeEntryContext && config.depth <= 2;
    return config.depth < 1 || allowDeepNodeQueuing;
  }

  /**
   * Get depth threshold for entity type and traversal direction.
   *
   * Forward traversal (what does this call?):
   * - Handlers/Controllers: 2 (entry points are focused)
   * - Managers/Services: 2 (global singletons - tight threshold to prevent pollution)
   * - Coordinators: 2 (orchestrators)
   * - Nodes: 3 (data entities can go deeper)
   *
   * Backward traversal (who calls this?):
   * - More permissive (4) to discover all entry points
   *
   * Key insight: Unlike Vue-Laravel where services are feature-scoped,
   * Godot has global singleton managers that span multiple features.
   * These must have TIGHT thresholds (2) to prevent pollution.
   */
  getEntityDepthThreshold(entityType: string, direction: GodotTraversalDirection): number {
    if (direction === 'forward') {
      switch (entityType) {
        case 'handler':
        case 'controller':
          return 2; // Entry points are focused
        case 'manager':
        case 'coordinator':
        case 'service':
          return 2; // Global infrastructure - tight threshold (was 3, now 2)
        case 'node':
        case 'resource':
        case 'data_model':
          return 3; // Data entities
        default:
          return 2;
      }
    }
    return 4; // Backward traversal is more permissive
  }
}
