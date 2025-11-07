/**
 * Symbol Graph Database Queries
 *
 * Centralizes all database queries for graph traversal. Provides clean
 * interface for retrieving parent containers, edges, and contained symbols.
 */

import type { Knex } from 'knex';
import type { SymbolInfo } from './symbol-classifier';
import { SymbolRole } from './symbol-classifier';
import { createComponentLogger } from '../../../../utils/logger';

const logger = createComponentLogger('symbol-graph-queries');

export class SymbolGraphQueries {
  constructor(private readonly db: Knex) {}

  async getParentContainer(symbolId: number): Promise<number | null> {
    const containsParent = await this.db('dependencies')
      .where('to_symbol_id', symbolId)
      .where('dependency_type', 'contains')
      .select('from_symbol_id')
      .first();

    if (containsParent) {
      return containsParent.from_symbol_id;
    }

    const callsParent = await this.db('dependencies as d')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .where('d.to_symbol_id', symbolId)
      .where('d.dependency_type', 'calls')
      .where('s.entity_type', 'component')
      .select('d.from_symbol_id')
      .first();

    return callsParent?.from_symbol_id || null;
  }

  async getParentEntityType(symbolId: number): Promise<string | null> {
    const containsParent = await this.db('dependencies as d')
      .select('s.entity_type')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .where('d.to_symbol_id', symbolId)
      .where('d.dependency_type', 'contains')
      .first();

    if (containsParent) {
      return containsParent.entity_type;
    }

    const callsParent = await this.db('dependencies as d')
      .select('s.entity_type')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .where('d.to_symbol_id', symbolId)
      .where('d.dependency_type', 'calls')
      .where('s.entity_type', 'component')
      .first();

    return callsParent?.entity_type || null;
  }

  async findMethodsReferencingSymbol(
    containerId: number,
    sourceSymbolId: number
  ): Promise<number[]> {
    const methods = await this.db('symbols as method')
      .join('dependencies as contains', 'method.id', 'contains.to_symbol_id')
      .where('contains.from_symbol_id', containerId)
      .where('contains.dependency_type', 'contains')
      .whereIn('method.symbol_type', ['method', 'function'])
      .pluck('method.id');

    if (methods.length === 0) {
      return [];
    }

    const referencingMethods = await this.db('dependencies')
      .where('to_symbol_id', sourceSymbolId)
      .whereIn('from_symbol_id', methods)
      .whereIn('dependency_type', ['calls', 'references', 'imports'])
      .pluck('from_symbol_id');

    return [...new Set(referencingMethods)];
  }

  private async shouldDiscoverModelsTransitively(symbolId: number): Promise<number | null> {
    try {
      const parentContainer = await this.db('dependencies')
        .select('from_symbol_id')
        .where({ to_symbol_id: symbolId, dependency_type: 'contains' })
        .first();

      if (!parentContainer) {
        return null;
      }

      const parent = await this.db('symbols')
        .select('id', 'entity_type')
        .where('id', parentContainer.from_symbol_id)
        .first();

      if (parent && (parent.entity_type === 'controller' || parent.entity_type === 'service')) {
        return parent.id;
      }

      return null;
    } catch (error) {
      logger.error(
        `Failed to check if symbol ${symbolId} should discover models transitively: ${error}`
      );
      return null;
    }
  }

  private async getDirectModelReferences(methodId: number): Promise<number[]> {
    try {
      const modelIds = await this.db('dependencies as d')
        .join('symbols as target', 'd.to_symbol_id', 'target.id')
        .where('d.from_symbol_id', methodId)
        .where('d.dependency_type', 'references')
        .where('target.entity_type', 'model')
        .pluck('target.id');

      return modelIds;
    } catch (error) {
      logger.error(`Failed to get direct model references for method ${methodId}: ${error}`);
      return [];
    }
  }

  private async getTransitiveModelReferences(methodId: number): Promise<number[]> {
    try {
      const serviceMethodCalls = await this.db('dependencies as call_dep')
        .join('symbols as service_method', 'call_dep.to_symbol_id', 'service_method.id')
        .join('dependencies as contains_dep', 'service_method.id', 'contains_dep.to_symbol_id')
        .join('symbols as service_class', 'contains_dep.from_symbol_id', 'service_class.id')
        .where('call_dep.from_symbol_id', methodId)
        .where('call_dep.dependency_type', 'calls')
        .where('service_method.symbol_type', 'method')
        .where('contains_dep.dependency_type', 'contains')
        .where('service_class.entity_type', 'service')
        .pluck('service_method.id');

      if (serviceMethodCalls.length === 0) {
        return [];
      }

      const transitiveModelRefs = await this.db('dependencies as d')
        .join('symbols as target', 'd.to_symbol_id', 'target.id')
        .whereIn('d.from_symbol_id', serviceMethodCalls)
        .where('d.dependency_type', 'references')
        .where('target.entity_type', 'model')
        .pluck('target.id');

      return transitiveModelRefs;
    } catch (error) {
      logger.error(`Failed to get transitive model references for method ${methodId}: ${error}`);
      return [];
    }
  }

  async getForwardEdges(
    symbolId: number,
    role: SymbolRole,
    symbol: SymbolInfo,
    depth: number
  ): Promise<number[]> {
    const edges: number[] = [];

    if (role === SymbolRole.EXECUTOR) {
      const deps = await this.db('dependencies')
        .where('from_symbol_id', symbolId)
        .whereIn('dependency_type', ['calls', 'api_call', 'contains'])
        .pluck('to_symbol_id');
      edges.push(...deps);

      // Follow references at shallow depths
      if (depth <= 2) {
        const referenceDeps = await this.db('dependencies')
          .where('from_symbol_id', symbolId)
          .where('dependency_type', 'references')
          .pluck('to_symbol_id');
        edges.push(...referenceDeps);
      }

      // Controllers/services discover models directly and transitively through service calls
      // Models are data entities fundamental to understanding features
      if (symbol.symbol_type === 'method') {
        const parentId = await this.shouldDiscoverModelsTransitively(symbolId);

        if (parentId) {
          const directModelRefs = await this.getDirectModelReferences(symbolId);
          edges.push(...directModelRefs);

          const transitiveModelRefs = await this.getTransitiveModelReferences(symbolId);
          edges.push(...transitiveModelRefs);
        }
      }
    } else if (role === SymbolRole.ENTITY) {
      const deps = await this.db('dependencies')
        .where('from_symbol_id', symbolId)
        .whereIn('dependency_type', ['calls', 'api_call'])
        .pluck('to_symbol_id');
      edges.push(...deps);

      if (symbol.entity_type !== 'component' && depth <= 2) {
        const referenceDeps = await this.db('dependencies')
          .where('from_symbol_id', symbolId)
          .where('dependency_type', 'references')
          .pluck('to_symbol_id');
        edges.push(...referenceDeps);
      }
    } else if (role === SymbolRole.CONTAINER) {
      const contained = await this.db('dependencies')
        .where('from_symbol_id', symbolId)
        .where('dependency_type', 'contains')
        .pluck('to_symbol_id');
      edges.push(...contained);
    }

    return [...new Set(edges)];
  }

  async getBackwardEdges(
    symbolId: number,
    role: SymbolRole,
    symbol: SymbolInfo
  ): Promise<number[]> {
    const edges: number[] = [];

    const executionCallers = await this.db('dependencies')
      .where('to_symbol_id', symbolId)
      .whereIn('dependency_type', ['calls', 'api_call'])
      .pluck('from_symbol_id');
    edges.push(...executionCallers);

    if (
      symbol.entity_type === 'composable' ||
      symbol.entity_type === 'model' ||
      (role === SymbolRole.EXECUTOR && symbol.symbol_type === 'function')
    ) {
      const referenceCallers = await this.db('dependencies')
        .where('to_symbol_id', symbolId)
        .where('dependency_type', 'references')
        .pluck('from_symbol_id');
      edges.push(...referenceCallers);
    }

    const parents = await this.db('dependencies')
      .where('to_symbol_id', symbolId)
      .where('dependency_type', 'contains')
      .pluck('from_symbol_id');
    edges.push(...parents);

    return [...new Set(edges)];
  }

  async getContainedExecutors(containerId: number): Promise<number[]> {
    const contained = await this.db('symbols as child')
      .join('dependencies as d', 'child.id', 'd.to_symbol_id')
      .where('d.from_symbol_id', containerId)
      .where('d.dependency_type', 'contains')
      .whereIn('child.symbol_type', ['method', 'function'])
      .pluck('child.id');

    return contained;
  }
}
