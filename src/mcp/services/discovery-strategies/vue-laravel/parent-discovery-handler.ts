/**
 * Parent Discovery Handler
 *
 * Handles discovery of parent containers for executor symbols (methods/functions).
 * Ensures controller/store/service classes are included when their methods are discovered.
 */

import * as SymbolService from '../../../../database/services/symbol-service';
import type { Knex } from 'knex';
import type { SymbolInfo } from './symbol-classifier';
import { SymbolRole } from './symbol-classifier';
import type { SymbolGraphQueries } from './symbol-graph-queries';
import type { TraversalState } from './traversal-state';

export class ParentDiscoveryHandler {
  private static readonly PARENT_ENTITY_TYPES = [
    'controller',
    'store',
    'service',
    'component',
  ];

  constructor(
    private readonly db: Knex,
    private readonly queries: SymbolGraphQueries
  ) {}

  async discoverParentIfNeeded(
    symbolId: number,
    symbol: SymbolInfo,
    role: SymbolRole,
    depth: number,
    maxDepth: number,
    state: TraversalState
  ): Promise<void> {
    if (!this.shouldDiscoverParent(role, depth, maxDepth)) {
      return;
    }

    const parentContainerId = await this.queries.getParentContainer(symbolId);
    if (!parentContainerId || state.isDiscovered(parentContainerId)) {
      return;
    }

    const parentSymbol = await SymbolService.getSymbol(this.db, parentContainerId);
    if (!parentSymbol) {
      return;
    }

    if (!this.isRelevantParentEntity(parentSymbol.entity_type)) {
      return;
    }

    const relevance = 1.0 - (depth + 2) / (maxDepth + 1);
    state.addDiscovered(parentContainerId, relevance);
    state.markVisited(parentContainerId);

    if (parentSymbol.file_id) {
      state.addValidatedFile(parentSymbol.file_id);
    }
  }

  private shouldDiscoverParent(
    role: SymbolRole,
    depth: number,
    maxDepth: number
  ): boolean {
    return role === SymbolRole.EXECUTOR && depth < maxDepth;
  }

  private isRelevantParentEntity(entityType: string | undefined): boolean {
    if (!entityType) {
      return false;
    }
    return ParentDiscoveryHandler.PARENT_ENTITY_TYPES.includes(entityType);
  }
}
