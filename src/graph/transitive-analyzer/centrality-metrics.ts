import type { Knex } from 'knex';
import { getDatabaseConnection } from '../../database/connection';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('centrality-metrics');

const centralityCache = new Map<string, number>();

export async function calculateBetweennessCentrality(
  symbolId: number,
  db: Knex = getDatabaseConnection()
): Promise<number> {
  const cacheKey = `betweenness:${symbolId}`;
  const cached = centralityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const [callersCount, depsCount] = await Promise.all([
      db('dependencies')
        .where('to_symbol_id', symbolId)
        .countDistinct('from_symbol_id as count')
        .first()
        .then(r => Number(r?.count || 0)),
      db('dependencies')
        .where('from_symbol_id', symbolId)
        .countDistinct('to_symbol_id as count')
        .first()
        .then(r => Number(r?.count || 0)),
    ]);

    const bridgeScore = Math.sqrt(callersCount * depsCount);
    const normalized = Math.min(bridgeScore / 10, 1.0);

    centralityCache.set(cacheKey, normalized);
    return normalized;
  } catch (error) {
    logger.warn('Failed to calculate betweenness centrality', {
      symbolId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function calculateDegreeCentrality(
  symbolId: number,
  db: Knex = getDatabaseConnection()
): Promise<number> {
  const cacheKey = `degree:${symbolId}`;
  const cached = centralityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const [inDegree, outDegree] = await Promise.all([
      db('dependencies')
        .where('to_symbol_id', symbolId)
        .count('* as count')
        .first()
        .then(r => Number(r?.count || 0)),
      db('dependencies')
        .where('from_symbol_id', symbolId)
        .count('* as count')
        .first()
        .then(r => Number(r?.count || 0)),
    ]);

    const totalDegree = inDegree * 1.5 + outDegree;
    const normalized = Math.min(totalDegree / 20, 1.0);

    centralityCache.set(cacheKey, normalized);
    return normalized;
  } catch (error) {
    logger.warn('Failed to calculate degree centrality', {
      symbolId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function calculateEigenvectorCentrality(
  symbolId: number,
  db: Knex = getDatabaseConnection()
): Promise<number> {
  const cacheKey = `eigenvector:${symbolId}`;
  const cached = centralityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const callerImportance = await db('dependencies as d1')
      .where('d1.to_symbol_id', symbolId)
      .leftJoin('dependencies as d2', 'd1.from_symbol_id', 'd2.to_symbol_id')
      .count('d2.id as caller_degree')
      .first()
      .then(r => Number(r?.caller_degree || 0));

    const normalized = Math.min(callerImportance / 50, 1.0);

    centralityCache.set(cacheKey, normalized);
    return normalized;
  } catch (error) {
    logger.warn('Failed to calculate eigenvector centrality', {
      symbolId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function calculateClosenessCentrality(
  symbolId: number,
  db: Knex = getDatabaseConnection()
): Promise<number> {
  const cacheKey = `closeness:${symbolId}`;
  const cached = centralityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const reachableCount = await db.raw(
      `
      WITH RECURSIVE reachable AS (
        SELECT DISTINCT to_symbol_id as symbol_id, 1 as depth
        FROM dependencies
        WHERE from_symbol_id = ?

        UNION

        SELECT DISTINCT d.to_symbol_id, r.depth + 1
        FROM reachable r
        JOIN dependencies d ON r.symbol_id = d.from_symbol_id
        WHERE r.depth < 2
      )
      SELECT COUNT(DISTINCT symbol_id) as count FROM reachable
    `,
      [symbolId]
    );

    const count = Number(reachableCount.rows[0]?.count || 0);
    const normalized = Math.min(count / 30, 1.0);

    centralityCache.set(cacheKey, normalized);
    return normalized;
  } catch (error) {
    logger.warn('Failed to calculate closeness centrality', {
      symbolId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export function clearCentralityCache(): void {
  centralityCache.clear();
}
