/**
 * Depth Filter Policy
 *
 * Centralizes all depth-based filtering rules for traversal. Prevents pollution
 * from deep dependencies while allowing legitimate discovery chains.
 */

import type { TraversalDirection } from './symbol-classifier';

export interface DepthFilterConfig {
  entityType?: string;
  symbolType: string;
  depth: number;
  direction: TraversalDirection;
  entryPointEntityType?: string;
}

export class DepthFilterPolicy {
  private static readonly SHARED_ARCHITECTURAL_BOUNDARIES = [
    'store',
    'service',
    'controller',
    'repository',
    'request',
    'model',
  ];

  private static readonly ARCHITECTURAL_BOUNDARIES = [
    'store',
    'service',
    'controller',
    'repository',
  ];

  private static readonly DEEP_ENTITY_TYPES = [
    'model',
    'controller',
    'service',
    'request',
  ];

  shouldFilterSharedArchitecturalBoundary(config: DepthFilterConfig): boolean {
    if (config.depth === 0) {
      return false;
    }

    if (!config.entityType) {
      return false;
    }

    if (!DepthFilterPolicy.SHARED_ARCHITECTURAL_BOUNDARIES.includes(config.entityType)) {
      return false;
    }

    const threshold = this.getEntityDepthThreshold(config.entityType, config.direction);
    return config.depth >= threshold;
  }

  shouldFilterArchitecturalBoundary(config: DepthFilterConfig): boolean {
    if (!config.entityType) {
      return false;
    }

    if (!DepthFilterPolicy.ARCHITECTURAL_BOUNDARIES.includes(config.entityType)) {
      return false;
    }

    const threshold = config.direction === 'forward' ? 2 : 4;
    return config.depth >= threshold;
  }

  shouldFilterEntity(config: DepthFilterConfig): boolean {
    if (!config.entityType) {
      return false;
    }

    if (!DepthFilterPolicy.DEEP_ENTITY_TYPES.includes(config.entityType)) {
      return false;
    }

    const threshold = this.getEntityDepthThreshold(config.entityType, config.direction);
    return config.depth >= threshold;
  }

  shouldFilterMethod(config: DepthFilterConfig): boolean {
    if (config.symbolType !== 'method') {
      return false;
    }

    const threshold = config.direction === 'forward' ? 2 : 4;
    return config.depth >= threshold;
  }

  shouldAllowDeepModelQueuing(config: DepthFilterConfig): boolean {
    const isModelEntryContext = config.entryPointEntityType === 'model';
    const allowDeepModelQueuing = isModelEntryContext && config.depth <= 2;
    return config.depth < 1 || allowDeepModelQueuing;
  }

  getEntityDepthThreshold(entityType: string, direction: TraversalDirection): number {
    if (direction === 'forward') {
      return entityType === 'model' ? 3 : 2;
    }
    return 4;
  }
}
