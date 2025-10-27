import type { Knex } from 'knex';
import type { RouteImpactRecord, JobImpactRecord, TestImpactRecord } from '../models';

export async function getRoutesForSymbols(
  db: Knex,
  symbolIds: number[]
): Promise<RouteImpactRecord[]> {
  if (symbolIds.length === 0) return [];

  return await db('routes')
    .whereIn('handler_symbol_id', symbolIds)
    .select('id', 'path', 'method', 'framework_type', 'handler_symbol_id');
}

export async function getJobsForSymbols(
  db: Knex,
  symbolIds: number[]
): Promise<JobImpactRecord[]> {
  if (symbolIds.length === 0) return [];

  return await db('symbols')
    .join('files', 'symbols.file_id', 'files.id')
    .whereIn('symbols.id', symbolIds)
    .where(function () {
      this.where('symbols.entity_type', 'job')
        .orWhere('symbols.base_class', 'like', '%Job%')
        .orWhere('files.path', 'like', '%/Jobs/%')
        .orWhere('files.path', 'like', '%/jobs/%');
    })
    .select('symbols.id', 'symbols.name', 'symbols.entity_type', 'files.path as file_path')
    .distinct();
}

export async function getTestsForSymbols(
  db: Knex,
  symbolIds: number[]
): Promise<TestImpactRecord[]> {
  if (symbolIds.length === 0) return [];

  return await db('symbols')
    .join('files', 'symbols.file_id', 'files.id')
    .whereIn('symbols.id', symbolIds)
    .where(function () {
      this.where('files.is_test', true)
        .orWhere('files.path', 'like', '%.test.%')
        .orWhere('files.path', 'like', '%.spec.%')
        .orWhere('files.path', 'like', '%Test.php');
    })
    .select('symbols.id', 'symbols.name', 'files.path as file_path', 'symbols.entity_type')
    .distinct();
}
