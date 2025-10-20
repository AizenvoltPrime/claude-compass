/**
 * Dependency Traversal Strategy
 *
 * Performs breadth-first search (BFS) from the entry point symbol,
 * following both forward dependencies (calls, imports) and backward
 * dependencies (callers, importers) within a configurable depth limit.
 *
 * This is typically the PRIMARY discovery mechanism as it follows
 * the actual code relationships in the graph.
 */

import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';

const logger = createComponentLogger('dependency-traversal-strategy');

export class DependencyTraversalStrategy implements DiscoveryStrategy {
  readonly name = 'dependency-traversal';
  readonly description = 'BFS traversal of dependency graph from entry point';
  readonly priority = 10; // Run first - highest priority

  private static readonly MAX_VISITED_NODES = 50000;
  private static readonly MAX_QUEUE_SIZE = 10000;

  constructor(private dbService: DatabaseService) {}

  /**
   * Only run on first iteration - subsequent discoveries handled by other strategies.
   */
  shouldRun(context: DiscoveryContext): boolean {
    return context.iteration === 0;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { entryPointId, options } = context;
    const maxDepth = options.maxDepth;

    logger.debug('Starting dependency traversal', {
      entryPoint: entryPointId,
      maxDepth,
    });

    const related = new Map<number, number>();
    const queue = [{ id: entryPointId, depth: 0 }];
    const visited = new Set<number>([entryPointId]);

    while (queue.length > 0) {
      // Safety checks
      if (visited.size > DependencyTraversalStrategy.MAX_VISITED_NODES) {
        logger.warn('Hit max visited nodes limit, terminating traversal early', {
          visitedCount: visited.size,
          maxNodes: DependencyTraversalStrategy.MAX_VISITED_NODES,
        });
        break;
      }

      if (queue.length > DependencyTraversalStrategy.MAX_QUEUE_SIZE) {
        logger.warn('Queue size exceeded limit, pruning least relevant nodes', {
          queueSize: queue.length,
          maxQueueSize: DependencyTraversalStrategy.MAX_QUEUE_SIZE,
        });
        queue.sort((a, b) => a.depth - b.depth);
        queue.splice(DependencyTraversalStrategy.MAX_QUEUE_SIZE);
      }

      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      // Forward dependencies (calls, imports, references)
      const dependencies = await this.dbService.getDependenciesFrom(id);

      // Backward dependencies (callers, importers)
      const callers = await this.dbService.getDependenciesTo(id);

      for (const dep of dependencies) {
        const targetId = dep.to_symbol_id;
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
          related.set(targetId, relevance);
          queue.push({ id: targetId, depth: depth + 1 });
        }
      }

      for (const dep of callers) {
        const targetId = dep.from_symbol_id;
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
          related.set(targetId, relevance);
          queue.push({ id: targetId, depth: depth + 1 });
        }
      }
    }

    logger.debug('Dependency traversal complete', {
      discovered: related.size,
      visited: visited.size,
    });

    return related;
  }
}
