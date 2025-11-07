/**
 * Shared Discovery Helper Utilities
 *
 * Common utilities used across multiple discovery strategies to eliminate
 * code duplication and improve performance.
 */

import type { Knex } from 'knex';
import * as SymbolService from '../../../../database/services/symbol-service';

export async function batchGetSymbols(db: Knex, symbolIds: number[]): Promise<Map<number, any>> {
  if (symbolIds.length === 0) return new Map();

  const symbols = await db('symbols')
    .whereIn('id', symbolIds)
    .select('*');

  return new Map(symbols.map(s => [s.id, s]));
}

export async function findParentStore(db: Knex, storeMethodId: number): Promise<number | null> {
  const parentContainer = await db('dependencies')
    .select('from_symbol_id')
    .where({ to_symbol_id: storeMethodId, dependency_type: 'contains' })
    .first();

  if (!parentContainer) {
    return null;
  }

  const parent = await SymbolService.getSymbol(db, parentContainer.from_symbol_id);
  if (parent && parent.entity_type === 'store') {
    return parentContainer.from_symbol_id;
  }

  return null;
}
