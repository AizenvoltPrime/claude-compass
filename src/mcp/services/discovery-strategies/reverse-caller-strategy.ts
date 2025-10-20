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

    const related = new Map<number, number>();
    const maxDepth = options.maxDepth;

    for (const symbolId of uncheckedSymbols) {
      this.previouslyChecked.add(symbolId);

      // Get all callers (symbols that depend on this one)
      const callers = await this.dbService.getDependenciesTo(symbolId);

      for (const dep of callers) {
        const callerId = dep.from_symbol_id;
        if (!callerId || currentSymbols.includes(callerId)) {
          continue;
        }

        // Optional: Filter by feature name to avoid unrelated callers
        // If caller name contains feature name fragments, include it
        // Skip if caller symbol data is missing
        if (!dep.from_symbol?.name) {
          continue;
        }

        if (this.matchesFeatureName(dep.from_symbol.name, featureName)) {
          const relevance = 0.75 - (context.iteration * 0.1);
          related.set(callerId, Math.max(relevance, 0.3));
        }
      }
    }

    logger.debug('Reverse caller discovery complete', {
      discovered: related.size,
      checked: uncheckedSymbols.length,
    });

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
   * Reset state (useful for testing).
   */
  reset(): void {
    this.previouslyChecked.clear();
  }
}
