/**
 * Reverse Caller Strategy
 *
 * Discovers symbols that CALL the already-discovered symbols.
 * This is the inverse of forward dependency traversal.
 *
 * Use case: If we discovered a store method "getCameraAlerts",
 * this strategy finds all components/composables that CALL that method.
 *
 * Optionally filters by feature name to avoid pulling in unrelated callers.
 */

import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';

const logger = createComponentLogger('reverse-caller-strategy');

export class ReverseCallerStrategy implements DiscoveryStrategy {
  readonly name = 'reverse-caller';
  readonly description = 'Find symbols that call discovered symbols';
  readonly priority = 50; // Run last

  private previouslyChecked = new Set<number>();

  constructor(private dbService: DatabaseService) {}

  /**
   * Only run if includeCallers is enabled.
   * Run every iteration to catch callers of newly discovered symbols.
   */
  shouldRun(context: DiscoveryContext): boolean {
    return context.options.includeCallers;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { currentSymbols, featureName, options } = context;

    // Find symbols we haven't checked for callers yet
    const uncheckedSymbols = currentSymbols.filter(
      id => !this.previouslyChecked.has(id)
    );

    if (uncheckedSymbols.length === 0) {
      logger.debug('No new symbols to find callers for');
      return new Map();
    }

    logger.debug('Finding reverse callers', {
      uncheckedCount: uncheckedSymbols.length,
      iteration: context.iteration,
    });

    // Build file-level context from currently discovered symbols
    const validatedFileIds = await this.getValidatedFileIds(currentSymbols);
    logger.debug('File-level context built', {
      discoveredSymbols: currentSymbols.length,
      validatedFiles: validatedFileIds.size,
    });

    const candidateCallers = new Map<number, number>();

    for (const symbolId of uncheckedSymbols) {
      this.previouslyChecked.add(symbolId);

      // Get all callers (symbols that depend on this one)
      const callers = await this.dbService.getDependenciesTo(symbolId);

      for (const dep of callers) {
        const callerId = dep.from_symbol_id;
        if (!callerId || currentSymbols.includes(callerId)) {
          continue;
        }

        // Filter by feature name to avoid unrelated callers
        if (!dep.from_symbol?.name) {
          continue;
        }

        if (this.matchesFeatureName(dep.from_symbol.name, featureName)) {
          const relevance = 0.75 - (context.iteration * 0.1);
          candidateCallers.set(callerId, Math.max(relevance, 0.3));
        }
      }
    }

    // Fetch entity_type for all candidate callers to filter out stores and components
    // These should only be discovered through actual code dependencies (dependency-traversal),
    // not through indirect caller relationships which can produce false positives
    // from shared utilities or naming pattern matches.
    const callerIds = Array.from(candidateCallers.keys());
    const related = new Map<number, number>();

    if (callerIds.length > 0) {
      const symbolMap = await this.dbService.getSymbolsBatch(callerIds);
      let excludedStores = 0;
      let excludedComponents = 0;
      let excludedServices = 0;
      let excludedModels = 0;
      let excludedControllers = 0;

      for (const [callerId, relevance] of candidateCallers) {
        const symbol = symbolMap.get(callerId);

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
            symbolId: callerId,
            symbolName: symbol.name,
            symbolType: symbol.symbol_type,
            fileId: symbol.file_id,
          });
          continue;
        }

        related.set(callerId, relevance);
      }

      logger.debug('Reverse caller discovery complete', {
        candidatesBeforeFilter: candidateCallers.size,
        discovered: related.size,
        excludedStores,
        excludedComponents,
        excludedServices,
        excludedModels,
        excludedControllers,
        checked: uncheckedSymbols.length,
      });
    } else {
      logger.debug('Reverse caller discovery complete', {
        discovered: 0,
        checked: uncheckedSymbols.length,
      });
    }

    return related;
  }

  /**
   * Check if caller name is related to feature name.
   * Uses loose matching to catch variations.
   */
  /**
   * Extract partial names from CamelCase (framework-agnostic).
   */
  private extractPartials(name: string): string[] {
    const words = name.split(/(?=[A-Z])/);
    const partials: string[] = [];

    for (let i = 1; i < words.length; i++) {
      partials.push(words.slice(i).join(''));
    }

    return partials;
  }

  private matchesFeatureName(callerName: string, featureName: string): boolean {
    // Always include if contains exact feature name
    if (callerName.toLowerCase().includes(featureName.toLowerCase())) {
      return true;
    }

    // Check partial matches using CamelCase parsing (framework-agnostic)
    // E.g., "VehicleCameraAlert" → ["CameraAlert", "Alert"]
    const partials = this.extractPartials(featureName);
    for (const partial of partials) {
      if (callerName.toLowerCase().includes(partial.toLowerCase())) {
        return true;
      }
    }

    // For very generic callers, be conservative
    const genericPatterns = ['index', 'main', 'app', 'routes', 'config'];
    if (genericPatterns.some(p => callerName.toLowerCase().includes(p))) {
      return false;
    }

    return true;
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
    this.previouslyChecked.clear();
  }
}
