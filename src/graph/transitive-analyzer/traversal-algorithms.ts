import type { Knex } from 'knex';
import { getDatabaseConnection } from '../../database/connection';
import { createComponentLogger } from '../../utils/logger';
import { TransitiveAnalysisOptions, TransitiveResult } from './types';
import { getDirectCallers, getDirectDependencies, getCrossStackCallers } from './query-service';

const logger = createComponentLogger('traversal-algorithms');

export async function traverseCallers(
  symbolId: number,
  currentPath: number[],
  currentDepth: number,
  maxDepth: number,
  visited: Set<number>,
  cycles: Set<string>,
  results: TransitiveResult[],
  options: TransitiveAnalysisOptions,
  db: Knex = getDatabaseConnection()
): Promise<void> {
  if (currentDepth >= maxDepth) {
    return;
  }

  if (visited.has(symbolId)) {
    const cycleKey = [...currentPath, symbolId].sort().join('-');
    cycles.add(cycleKey);
    return;
  }

  visited.add(symbolId);

  try {
    const callers = await getDirectCallers(symbolId, options, db);

    for (const caller of callers) {
      if (!caller.from_symbol) continue;

      const fromSymbolId = caller.from_symbol.id;
      const newPath = [...currentPath, symbolId];

      results.push({
        symbolId: fromSymbolId,
        path: newPath,
        depth: currentDepth + 1,
        dependencies: [caller],
      });

      const newVisited = new Set(visited);
      await traverseCallers(
        fromSymbolId,
        newPath,
        currentDepth + 1,
        maxDepth,
        newVisited,
        cycles,
        results,
        options,
        db
      );
    }
  } catch (error) {
    logger.error('Error traversing callers', {
      symbolId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    visited.delete(symbolId);
  }
}

export async function traverseCallersWithCrossStackSupport(
  symbolId: number,
  currentPath: number[],
  currentDepth: number,
  maxDepth: number,
  visited: Set<number>,
  cycles: Set<string>,
  results: TransitiveResult[],
  options: TransitiveAnalysisOptions,
  db: Knex = getDatabaseConnection()
): Promise<void> {
  if (currentDepth >= maxDepth) {
    return;
  }

  if (visited.has(symbolId)) {
    const cycleKey = [...currentPath, symbolId].sort().join('-');
    cycles.add(cycleKey);
    return;
  }

  visited.add(symbolId);

  try {
    const regularCallers = await getDirectCallers(symbolId, options, db);
    const crossStackCallers = await getCrossStackCallers(symbolId, db);

    for (const caller of regularCallers) {
      if (!caller.from_symbol) continue;

      const fromSymbolId = caller.from_symbol.id;
      const newPath = [...currentPath, symbolId];

      results.push({
        symbolId: fromSymbolId,
        path: newPath,
        depth: currentDepth + 1,
        dependencies: [caller],
      });

      const newVisited = new Set(visited);
      await traverseCallersWithCrossStackSupport(
        fromSymbolId,
        newPath,
        currentDepth + 1,
        maxDepth,
        newVisited,
        cycles,
        results,
        options,
        db
      );
    }

    for (const caller of crossStackCallers) {
      if (!caller.from_symbol) continue;

      const fromSymbolId = caller.from_symbol.id;
      const newPath = [...currentPath, symbolId];

      results.push({
        symbolId: fromSymbolId,
        path: newPath,
        depth: currentDepth + 1,
        dependencies: [caller],
      });

      await traverseCallersWithCrossStackSupport(
        fromSymbolId,
        newPath,
        currentDepth + 1,
        maxDepth,
        visited,
        cycles,
        results,
        options,
        db
      );
    }
  } catch (error) {
    logger.error('Error traversing cross-stack callers', {
      symbolId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    visited.delete(symbolId);
  }
}

export async function traverseDependencies(
  symbolId: number,
  currentPath: number[],
  currentDepth: number,
  maxDepth: number,
  visited: Set<number>,
  cycles: Set<string>,
  results: TransitiveResult[],
  options: TransitiveAnalysisOptions,
  db: Knex = getDatabaseConnection()
): Promise<void> {
  if (currentDepth >= maxDepth) {
    return;
  }

  if (visited.has(symbolId)) {
    const cycleKey = [...currentPath, symbolId].sort().join('-');
    cycles.add(cycleKey);
    return;
  }

  visited.add(symbolId);

  try {
    const dependencies = await getDirectDependencies(symbolId, options, db);

    for (const dependency of dependencies) {
      if (!dependency.to_symbol) continue;

      const toSymbolId = dependency.to_symbol.id;
      const newPath = [...currentPath, symbolId];

      results.push({
        symbolId: toSymbolId,
        path: newPath,
        depth: currentDepth + 1,
        dependencies: [dependency],
      });

      const newVisited = new Set(visited);
      await traverseDependencies(
        toSymbolId,
        newPath,
        currentDepth + 1,
        maxDepth,
        newVisited,
        cycles,
        results,
        options,
        db
      );
    }
  } catch (error) {
    logger.error('Error traversing dependencies', {
      symbolId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    visited.delete(symbolId);
  }
}
