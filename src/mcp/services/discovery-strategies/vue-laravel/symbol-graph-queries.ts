/**
 * Symbol Graph Database Queries
 *
 * Centralizes all database queries for graph traversal. Provides clean
 * interface for retrieving parent containers, edges, and contained symbols.
 */

import type { Knex } from 'knex';
import type { SymbolInfo } from './symbol-classifier';
import { SymbolRole } from './symbol-classifier';

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

      if (depth <= 2) {
        const referenceDeps = await this.db('dependencies')
          .where('from_symbol_id', symbolId)
          .where('dependency_type', 'references')
          .pluck('to_symbol_id');
        edges.push(...referenceDeps);
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
