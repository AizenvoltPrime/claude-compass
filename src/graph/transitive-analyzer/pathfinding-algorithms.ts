import type { Knex } from 'knex';
import { getDatabaseConnection } from '../../database/connection';
import { createComponentLogger } from '../../utils/logger';
import { TransitiveAnalysisOptions } from './types';
import { getDirectCallers, getDirectDependencies, getCrossStackCallers } from './query-service';

const logger = createComponentLogger('pathfinding-algorithms');

export async function findShortestPath(
  startSymbolId: number,
  endSymbolId: number,
  options: TransitiveAnalysisOptions = {},
  db: Knex = getDatabaseConnection()
): Promise<{ path: number[]; distance: number } | null> {
  const startTime = Date.now();
  logger.info('Finding shortest path', {
    startSymbolId,
    endSymbolId,
    includeCrossStack: options.includeCrossStack,
  });

  const distances = new Map<number, number>();
  const previous = new Map<number, number | null>();
  const visited = new Set<number>();
  const unvisited: Array<{ symbolId: number; distance: number }> = [];

  distances.set(startSymbolId, 0);
  previous.set(startSymbolId, null);
  unvisited.push({ symbolId: startSymbolId, distance: 0 });

  while (unvisited.length > 0) {
    unvisited.sort((a, b) => a.distance - b.distance);
    const current = unvisited.shift()!;

    if (current.symbolId === endSymbolId) {
      const path = reconstructPath(previous, endSymbolId);
      logger.info('Shortest path found', {
        pathLength: path.length,
        distance: current.distance,
        executionTimeMs: Date.now() - startTime,
      });
      return { path, distance: current.distance };
    }

    if (visited.has(current.symbolId)) {
      continue;
    }

    visited.add(current.symbolId);

    const dependencies = await getDirectDependencies(current.symbolId, options, db);

    for (const dep of dependencies) {
      if (!dep.to_symbol) continue;

      const neighborId = dep.to_symbol.id;
      const newDistance = current.distance + 1;

      if (!distances.has(neighborId) || newDistance < distances.get(neighborId)!) {
        distances.set(neighborId, newDistance);
        previous.set(neighborId, current.symbolId);
        unvisited.push({ symbolId: neighborId, distance: newDistance });
      }
    }

    const callers = await getDirectCallers(current.symbolId, options, db);

    let crossStackCallers: typeof callers = [];
    if (options.includeCrossStack) {
      crossStackCallers = await getCrossStackCallers(current.symbolId, db);
    }

    const allCallers = [...callers, ...crossStackCallers];

    for (const caller of allCallers) {
      if (!caller.from_symbol) continue;

      const neighborId = caller.from_symbol.id;
      const newDistance = current.distance + 1;

      if (!distances.has(neighborId) || newDistance < distances.get(neighborId)!) {
        distances.set(neighborId, newDistance);
        previous.set(neighborId, current.symbolId);
        unvisited.push({ symbolId: neighborId, distance: newDistance });
      }
    }
  }

  logger.warn('No path found', { startSymbolId, endSymbolId });
  return null;
}

export async function findAllPaths(
  startSymbolId: number,
  endSymbolId: number,
  maxDepth: number = 10,
  options: TransitiveAnalysisOptions = {},
  db: Knex = getDatabaseConnection()
): Promise<number[][]> {
  const startTime = Date.now();
  logger.info('Finding all paths', {
    startSymbolId,
    endSymbolId,
    maxDepth,
    includeCrossStack: options.includeCrossStack,
  });

  const allPaths: number[][] = [];
  const visited = new Set<number>();

  await dfsAllPaths(
    startSymbolId,
    endSymbolId,
    [startSymbolId],
    visited,
    allPaths,
    maxDepth,
    options,
    db
  );

  logger.info('All paths found', {
    pathCount: allPaths.length,
    executionTimeMs: Date.now() - startTime,
  });

  return allPaths;
}

async function dfsAllPaths(
  current: number,
  target: number,
  currentPath: number[],
  visited: Set<number>,
  allPaths: number[][],
  remainingDepth: number,
  options: TransitiveAnalysisOptions = {},
  db: Knex
): Promise<void> {
  if (current === target) {
    allPaths.push([...currentPath]);
    return;
  }

  if (remainingDepth <= 0) {
    return;
  }

  if (visited.has(current)) {
    return;
  }

  visited.add(current);

  try {
    const dependencies = await getDirectDependencies(current, options, db);

    for (const dep of dependencies) {
      if (!dep.to_symbol) continue;

      const nextId = dep.to_symbol.id;
      await dfsAllPaths(
        nextId,
        target,
        [...currentPath, nextId],
        new Set(visited),
        allPaths,
        remainingDepth - 1,
        options,
        db
      );
    }
  } catch (error) {
    logger.error('Error in DFS all paths', {
      current,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    visited.delete(current);
  }
}

function reconstructPath(previous: Map<number, number | null>, endId: number): number[] {
  const path: number[] = [];
  let current: number | null = endId;

  while (current !== null) {
    path.unshift(current);
    current = previous.get(current) || null;
  }

  return path;
}
