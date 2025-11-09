/**
 * Godot Symbol Graph Queries
 *
 * Database query layer for Godot BFS traversal.
 * Handles parent container lookup, entity type queries,
 * and edge traversal (forward/backward).
 */

import type { Knex } from 'knex';
import type { GodotSymbolInfo, GodotSymbolRole } from './symbol-classifier';
import { createComponentLogger } from '../../../../utils/logger';
import {
  ALWAYS_FOLLOW_ENTITIES,
  GLOBAL_INFRASTRUCTURE_ENTITIES,
} from './godot-constants';

const logger = createComponentLogger('godot-symbol-graph-queries');

export class GodotSymbolGraphQueries {
  constructor(private db: Knex) {}

  private parentContainerCache = new Map<number, number | null>();
  private parentEntityTypeCache = new Map<number, string | null>();

  /**
   * Get parent container for a symbol (via 'contains' dependency).
   * Cached to reduce N+1 database queries during traversal.
   */
  async getParentContainer(symbolId: number): Promise<number | null> {
    if (this.parentContainerCache.has(symbolId)) {
      return this.parentContainerCache.get(symbolId)!;
    }

    try {
      const result = await this.db('dependencies')
        .where('to_symbol_id', symbolId)
        .where('dependency_type', 'contains')
        .select('from_symbol_id')
        .first();

      const parentId = result?.from_symbol_id || null;
      this.parentContainerCache.set(symbolId, parentId);
      return parentId;
    } catch (error) {
      logger.error(`Failed to get parent container for symbol ${symbolId}:`, error);
      throw error;
    }
  }

  /**
   * Get entity type of a symbol.
   * Cached to reduce N+1 database queries during traversal.
   */
  async getParentEntityType(symbolId: number): Promise<string | null> {
    if (this.parentEntityTypeCache.has(symbolId)) {
      return this.parentEntityTypeCache.get(symbolId)!;
    }

    try {
      const result = await this.db('symbols')
        .where('id', symbolId)
        .select('entity_type')
        .first();

      const entityType = result?.entity_type || null;
      this.parentEntityTypeCache.set(symbolId, entityType);
      return entityType;
    } catch (error) {
      logger.error(`Failed to get entity type for symbol ${symbolId}:`, error);
      throw error;
    }
  }

  /**
   * Get architectural entity references (handler, event_channel, node, resource).
   * These are feature-specific entities that should always be followed.
   *
   * IMPORTANT: Excludes interfaces - they're shared contracts that connect
   * unrelated features and cause pollution.
   */
  private async getArchitecturalEntityReferences(
    symbolId: number
  ): Promise<Array<{ id: number; name: string; entity_type: string }>> {
    try {
      return await this.db('dependencies as d')
        .join('symbols as target', 'd.to_symbol_id', 'target.id')
        .where('d.from_symbol_id', symbolId)
        .whereIn('d.dependency_type', ['calls', 'references', 'signal_connection'])
        .whereIn('target.entity_type', [...ALWAYS_FOLLOW_ENTITIES])
        .whereNot('target.symbol_type', 'interface')
        .select('target.id', 'target.name', 'target.entity_type');
    } catch (error) {
      logger.error(`Failed to get architectural entity references for symbol ${symbolId}:`, error);
      throw error;
    }
  }

  /**
   * Get forward edges (what does this symbol call/reference?).
   *
   * For Godot game architecture:
   * - Always follow edges to architectural entities (handler, event_channel, node)
   * - Only follow calls to shared infrastructure (manager, controller, service) at depth 0
   * - Limit non-architectural references by depth
   *
   * Key insight: Handlers calling manager methods at depth 0 is fine.
   * But we DON'T want to traverse INTO managers and discover all internal methods.
   * This is controlled by only allowing non-architectural calls at depth 0.
   */
  async getForwardEdges(
    symbolId: number,
    role: GodotSymbolRole,
    symbol: GodotSymbolInfo,
    depth: number
  ): Promise<number[]> {
    if (role !== 'EXECUTOR') {
      return [];
    }

    logger.debug(`[getForwardEdges] symbol=${symbol.name} (id=${symbolId}), depth=${depth}, role=${role}`);

    try {
      // CRITICAL: Prevent forward traversal from methods belonging to global infrastructure
      // This prevents internal method leakage between global infrastructure components
      // Symmetric to backward edge prevention: we block backward FROM and forward FROM global infrastructure methods
      if (symbol.symbol_type === 'method') {
        const parentId = await this.getParentContainer(symbolId);
        if (parentId) {
          const parentEntityType = await this.getParentEntityType(parentId);
          if (parentEntityType && GLOBAL_INFRASTRUCTURE_ENTITIES.includes(parentEntityType)) {
            logger.debug(`  → Skipping forward traversal - method belongs to ${parentEntityType} parent`);
            return [];
          }
        }
      }

      const edges: number[] = [];

      // Always follow calls/signals to architectural entities (but not interfaces!)
      const architecturalCallsResults = await this.db('dependencies as d')
        .join('symbols as target', 'd.to_symbol_id', 'target.id')
        .where('d.from_symbol_id', symbolId)
        .whereIn('d.dependency_type', ['calls', 'signal_connection'])
        .whereIn('target.entity_type', [...ALWAYS_FOLLOW_ENTITIES])
        .whereNot('target.symbol_type', 'interface')
        .select('target.id', 'target.name', 'target.entity_type', 'target.symbol_type');

      const architecturalCalls = architecturalCallsResults.map(r => r.id);
      edges.push(...architecturalCalls);

      if (architecturalCallsResults.length > 0) {
        logger.debug(`  → Found ${architecturalCallsResults.length} architectural calls:`,
          architecturalCallsResults.map(r => `${r.name} (${r.entity_type}, ${r.symbol_type})`));
      }

      // Follow calls to non-architectural entities (manager, controller, etc.) ONLY at depth 0
      // This allows discovering the direct dependencies from global infrastructure
      // without traversing into them and discovering all their internal methods
      if (depth === 0) {
        const nonArchitecturalCallsResults = await this.db('dependencies as d')
          .join('symbols as target', 'd.to_symbol_id', 'target.id')
          .where('d.from_symbol_id', symbolId)
          .whereIn('d.dependency_type', ['calls', 'signal_connection'])
          .whereNot('target.symbol_type', 'interface')
          .select('target.id', 'target.name', 'target.entity_type', 'target.symbol_type');

        const nonArchitecturalCalls = nonArchitecturalCallsResults.map(r => r.id);
        edges.push(...nonArchitecturalCalls);

        if (nonArchitecturalCallsResults.length > 0) {
          logger.debug(`  → Found ${nonArchitecturalCallsResults.length} non-architectural calls (depth=0):`,
            nonArchitecturalCallsResults.map(r => `${r.name} (${r.entity_type || 'none'}, ${r.symbol_type})`));
        }
      }

      // Always follow references to architectural entities
      const architecturalRefs = await this.getArchitecturalEntityReferences(symbolId);
      edges.push(...architecturalRefs.map(r => r.id));

      if (architecturalRefs.length > 0) {
        logger.debug(`  → Found ${architecturalRefs.length} architectural references:`,
          architecturalRefs.map(r => `${r.name} (${r.entity_type})`));
      }

      // Only follow non-architectural references at depth ≤ 1
      // CRITICAL: Also exclude methods whose PARENT is global infrastructure,
      // even if the method itself has NULL entity_type
      if (depth <= 1) {
        const db = this.db;
        const otherRefsResults = await db('dependencies as d')
          .join('symbols as target', 'd.to_symbol_id', 'target.id')
          .leftJoin('dependencies as parent_dep', function() {
            this.on('parent_dep.to_symbol_id', '=', 'target.id')
              .andOn('parent_dep.dependency_type', '=', db.raw('?', ['contains']));
          })
          .leftJoin('symbols as parent', 'parent_dep.from_symbol_id', 'parent.id')
          .where('d.from_symbol_id', symbolId)
          .whereIn('d.dependency_type', ['calls', 'references'])
          .whereNotIn('target.entity_type', [
            ...ALWAYS_FOLLOW_ENTITIES,
            ...GLOBAL_INFRASTRUCTURE_ENTITIES,
          ])
          .whereNot('target.symbol_type', 'interface')
          // Also exclude if parent has global infrastructure entity_type
          .where(function() {
            this.whereNull('parent.entity_type')
              .orWhereNotIn('parent.entity_type', [...GLOBAL_INFRASTRUCTURE_ENTITIES]);
          })
          .select('target.id', 'target.name', 'target.entity_type', 'target.symbol_type');

        const otherRefs = otherRefsResults.map(r => r.id);
        edges.push(...otherRefs);

        if (otherRefsResults.length > 0) {
          logger.debug(`  → Found ${otherRefsResults.length} other references (depth≤1):`,
            otherRefsResults.map(r => `${r.name} (${r.entity_type || 'none'}, ${r.symbol_type})`));
        }
      }

      const uniqueEdges = [...new Set(edges)];
      logger.debug(`  → Total unique edges: ${uniqueEdges.length}`);

      return uniqueEdges;
    } catch (error) {
      logger.error(`Failed to get forward edges for symbol ${symbolId}:`, error);
      throw error;
    }
  }

  /**
   * Get backward edges (what calls/references this symbol?).
   *
   * CRITICAL: Skip backward traversal from shared contracts that cause pollution:
   * - Interfaces: Connect unrelated features
   * - Constants/Enums: Shared data used across features
   * - Type Aliases: Shared type definitions
   * - Singleton accessor PROPERTIES: Widely referenced singleton properties
   *
   * BUT ALLOW backward traversal from METHODS, even if they belong to global infrastructure.
   * This ensures we discover entry points that call into the feature.
   *
   * Example pollution paths we block:
   * - Enum constants referenced by all handlers
   * - Singleton instance properties with hundreds of references
   *
   * Example essential dependencies we allow:
   * - Feature handlers called by phase controllers
   */
  async getBackwardEdges(
    symbolId: number,
    _role: GodotSymbolRole,
    symbol: GodotSymbolInfo
  ): Promise<number[]> {
    logger.debug(`[getBackwardEdges] symbol=${symbol.name} (id=${symbolId}), symbol_type=${symbol.symbol_type}, entity_type=${symbol.entity_type || 'none'}`);

    try {
      // Skip backward traversal from shared contracts and data structures
      const sharedSymbolTypes = ['interface', 'constant', 'enum', 'enum_member', 'type_alias'];
      if (sharedSymbolTypes.includes(symbol.symbol_type)) {
        logger.debug(`  → Skipping backward traversal - symbol type ${symbol.symbol_type} is shared infrastructure`);
        return [];
      }

      // Skip backward traversal from members of global infrastructure
      // Properties, methods, and classes in manager/controller/service connect ALL features
      // Example: Shared utility methods in global controllers are called by multiple handlers
      // Check if symbol itself has global infrastructure entity_type
      if (symbol.entity_type && GLOBAL_INFRASTRUCTURE_ENTITIES.includes(symbol.entity_type)) {
        logger.debug(`  → Skipping backward traversal - symbol of global infrastructure (${symbol.entity_type})`);
        return [];
      }

      // For properties and methods, also check parent container's entity_type
      // This catches methods with no entity_type inside global infrastructure parents
      if (['property', 'method'].includes(symbol.symbol_type)) {
        const parentId = await this.getParentContainer(symbolId);
        if (parentId) {
          const parentEntityType = await this.getParentEntityType(parentId);
          if (parentEntityType && GLOBAL_INFRASTRUCTURE_ENTITIES.includes(parentEntityType)) {
            logger.debug(`  → Skipping backward traversal - ${symbol.symbol_type} belongs to ${parentEntityType} parent`);
            return [];
          }
        }
      }

      const results = await this.db('dependencies as d')
        .join('symbols as source', 'd.from_symbol_id', 'source.id')
        .where('d.to_symbol_id', symbolId)
        .whereIn('d.dependency_type', ['calls', 'references', 'signal_connection'])
        .select('source.id as from_symbol_id', 'source.name', 'source.entity_type', 'source.symbol_type', 'd.dependency_type');

      if (results.length > 0) {
        logger.debug(`  → Found ${results.length} backward edges:`,
          results.map(r => `${r.name} (${r.entity_type || 'none'}, ${r.symbol_type}) via ${r.dependency_type}`));
      }

      // CRITICAL: Filter OUT callers that are methods belonging to:
      // 1. Global infrastructure (prevents shared utility pollution)
      // 2. Sibling handlers (prevents strategy pattern pollution via shared interface methods)
      const filteredResults: number[] = [];
      for (const result of results) {
        // If the caller is a method, check if its parent is global infrastructure or a handler
        if (result.symbol_type === 'method') {
          const parentId = await this.getParentContainer(result.from_symbol_id);
          if (parentId) {
            const parentEntityType = await this.getParentEntityType(parentId);
            if (parentEntityType &&
                (GLOBAL_INFRASTRUCTURE_ENTITIES.includes(parentEntityType) ||
                 parentEntityType === 'handler')) {
              logger.debug(`  → Filtering out backward caller ${result.name} - belongs to ${parentEntityType} parent`);
              continue;
            }
          }
        }
        filteredResults.push(result.from_symbol_id);
      }

      if (filteredResults.length < results.length) {
        logger.debug(`  → Filtered from ${results.length} to ${filteredResults.length} backward edges`);
      }

      return filteredResults;
    } catch (error) {
      logger.error(`Failed to get backward edges for symbol ${symbolId}:`, error);
      throw error;
    }
  }

  /**
   * Find methods in a container that reference a target symbol.
   * Used for backward container traversal.
   */
  async findMethodsReferencingSymbol(
    containerId: number,
    targetSymbolId: number
  ): Promise<number[]> {
    try {
      const containerMethods = await this.db('dependencies')
        .where('from_symbol_id', containerId)
        .where('dependency_type', 'contains')
        .select('to_symbol_id');

      const methodIds = containerMethods.map(r => r.to_symbol_id);

      if (methodIds.length === 0) {
        return [];
      }

      const results = await this.db('dependencies')
        .whereIn('from_symbol_id', methodIds)
        .where('to_symbol_id', targetSymbolId)
        .whereIn('dependency_type', ['calls', 'references', 'signal_connection'])
        .select('from_symbol_id');

      return results.map(r => r.from_symbol_id);
    } catch (error) {
      logger.error(`Failed to find methods referencing symbol ${targetSymbolId} in container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Expand container to executor methods.
   */
  async expandToExecutors(containerId: number): Promise<number[]> {
    try {
      const results = await this.db('dependencies')
        .where('from_symbol_id', containerId)
        .where('dependency_type', 'contains')
        .join('symbols', 'dependencies.to_symbol_id', 'symbols.id')
        .whereIn('symbols.symbol_type', ['method', 'function'])
        .select('to_symbol_id');

      return results.map(r => r.to_symbol_id);
    } catch (error) {
      logger.error(`Failed to expand container ${containerId} to executors:`, error);
      throw error;
    }
  }
}
