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

    // Build file-level context from currently discovered symbols
    const validatedFileIds = await this.getValidatedFileIds(currentSymbols);
    logger.debug('File-level context built', {
      discoveredSymbols: currentSymbols.length,
      validatedFiles: validatedFileIds.size,
    });

    const candidateDependencies = new Map<number, number>();
    const maxDepth = 1; // Shallow traversal - just immediate dependencies

    for (const symbolId of unexploredSymbols) {
      this.previouslyExplored.add(symbolId);

      // Get all forward dependencies (calls, imports, references, etc.)
      const dependencies = await this.dbService.getDependenciesFrom(symbolId);

      for (const dep of dependencies) {
        const targetId = dep.to_symbol_id;
        if (targetId && !currentSymbols.includes(targetId)) {
          const relevance = 0.65 - (context.iteration * 0.05);
          candidateDependencies.set(targetId, Math.max(relevance, 0.3));
        }
      }
    }

    // Fetch entity_type for all candidate dependencies to filter out stores and components
    // These should only be discovered through actual code dependencies (dependency-traversal),
    // not through indirect forward dependency chains which can produce false positives
    // from shared utilities or naming pattern matches.
    const dependencyIds = Array.from(candidateDependencies.keys());
    const related = new Map<number, number>();

    if (dependencyIds.length > 0) {
      const symbolMap = await this.dbService.getSymbolsBatch(dependencyIds);
      let excludedStores = 0;
      let excludedComponents = 0;
      let excludedServices = 0;
      let excludedModels = 0;
      let excludedControllers = 0;

      for (const [depId, relevance] of candidateDependencies) {
        const symbol = symbolMap.get(depId);

        // Exclude stores, components, services, models, controllers, composables, and requests - they should only be discovered via direct imports/routes
        if (symbol?.entity_type === 'store') {
          excludedStores++;
          continue;
        }
        if (symbol?.entity_type === 'component') {
          excludedComponents++;
          continue;
        }
        if (symbol?.entity_type === 'service') {
          excludedServices++;
          continue;
        }
        if (symbol?.entity_type === 'model') {
          excludedModels++;
          continue;
        }
        if (symbol?.entity_type === 'controller') {
          excludedControllers++;
          continue;
        }
        if (symbol?.entity_type === 'composable') {
          continue; // Exclude composables - discovered only via direct imports/calls
        }
        if (symbol?.entity_type === 'request') {
          continue; // Exclude requests - discovered only via validated dependency traversal
        }

        // FILE-LEVEL CONTEXT FILTERING
        // Only apply to generic symbols (methods, properties, variables, functions, interfaces)
        // Entity types have their own validation logic and should not be filtered by file-level context
        const isEntityType = symbol?.entity_type && [
          'store', 'service', 'model', 'controller', 'component', 'request', 'composable'
        ].includes(symbol.entity_type);

        if (!isEntityType && symbol?.file_id && !validatedFileIds.has(symbol.file_id)) {
          logger.debug('Filtered by file-level context', {
            symbolId: depId,
            symbolName: symbol.name,
            symbolType: symbol.symbol_type,
            fileId: symbol.file_id,
          });
          continue;
        }

        related.set(depId, relevance);
      }

      logger.debug('Forward dependency exploration complete', {
        candidatesBeforeFilter: candidateDependencies.size,
        discovered: related.size,
        excludedStores,
        excludedComponents,
        excludedServices,
        excludedModels,
        excludedControllers,
        explored: unexploredSymbols.length,
      });
    } else {
      logger.debug('Forward dependency exploration complete', {
        discovered: 0,
        explored: unexploredSymbols.length,
      });
    }

    return related;
  }

  /**
   * Get file IDs from a set of currently discovered symbols.
   * Used to build file-level context for filtering.
   */
  private async getValidatedFileIds(symbolIds: number[]): Promise<Set<number>> {
    if (symbolIds.length === 0) return new Set();

    const symbols = await this.dbService.getSymbolsBatch(symbolIds);
    const fileIds = new Set<number>();

    for (const [_, symbol] of symbols.entries()) {
      if (symbol?.file_id) {
        fileIds.add(symbol.file_id);
      }
    }

    return fileIds;
  }

  /**
   * Reset state (useful for testing).
   */
  reset(): void {
    this.previouslyExplored.clear();
  }
}
