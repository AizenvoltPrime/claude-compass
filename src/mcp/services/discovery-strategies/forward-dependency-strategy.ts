/**
 * Forward Dependency Strategy
 *
 * THIS STRATEGY FIXES THE BUG IN THE ORIGINAL IMPLEMENTATION.
 *
 * Explores forward dependencies (calls, imports, references) from symbols
 * that were discovered by OTHER strategies (naming patterns, cross-stack, etc.).
 *
 * Problem it solves:
 * - Naming patterns find "createCameraAlertMarkers" composable
 * - That composable has a "references" dependency to "CameraAlertInfoWindow"
 * - Original code never explored dependencies from naming-discovered symbols
 * - Result: CameraAlertInfoWindow was never discovered
 *
 * This strategy runs in iterations after naming discovery, ensuring
 * ALL discovered symbols have their dependencies explored.
 */

import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';

const logger = createComponentLogger('forward-dependency-strategy');

export class ForwardDependencyStrategy implements DiscoveryStrategy {
  readonly name = 'forward-dependency';
  readonly description = 'Explore forward deps from all discovered symbols';
  readonly priority = 30; // Run after naming patterns

  private previouslyExplored = new Set<number>();

  constructor(private dbService: DatabaseService) {}

  /**
   * Run on iterations 1+ to explore deps from symbols found by other strategies.
   * Skip iteration 0 since DependencyTraversalStrategy already did this from entry point.
   */
  shouldRun(context: DiscoveryContext): boolean {
    return context.iteration > 0;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { currentSymbols, options } = context;

    // Find symbols that haven't had their dependencies explored yet
    const unexploredSymbols = currentSymbols.filter(
      id => !this.previouslyExplored.has(id)
    );

    if (unexploredSymbols.length === 0) {
      logger.debug('No new symbols to explore');
      return new Map();
    }

    logger.debug('Exploring forward dependencies', {
      unexploredCount: unexploredSymbols.length,
      iteration: context.iteration,
    });

    const related = new Map<number, number>();
    const maxDepth = 1; // Shallow traversal - just immediate dependencies

    for (const symbolId of unexploredSymbols) {
      this.previouslyExplored.add(symbolId);

      // Get all forward dependencies (calls, imports, references, etc.)
      const dependencies = await this.dbService.getDependenciesFrom(symbolId);

      for (const dep of dependencies) {
        const targetId = dep.to_symbol_id;
        if (targetId && !currentSymbols.includes(targetId)) {
          // Calculate relevance: slightly lower than direct discoveries
          // to reflect that these are one step removed
          const relevance = 0.65 - (context.iteration * 0.05);
          related.set(targetId, Math.max(relevance, 0.3));
        }
      }
    }

    logger.debug('Forward dependency exploration complete', {
      discovered: related.size,
      explored: unexploredSymbols.length,
    });

    return related;
  }

  /**
   * Reset state (useful for testing).
   */
  reset(): void {
    this.previouslyExplored.clear();
  }
}
