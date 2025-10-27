/**
 * Discovery Engine - Orchestrates plugin-based feature discovery.
 *
 * This engine runs multiple discovery strategies iteratively until convergence,
 * building a comprehensive map of feature-related symbols across the codebase.
 *
 * Architecture:
 * 1. Starts with entry point symbol
 * 2. Runs each strategy in priority order
 * 3. Collects newly discovered symbols
 * 4. Repeats until no new symbols found or max iterations reached
 */

import { createComponentLogger } from '../../../utils/logger';
import type { Knex } from 'knex';
import {
  DiscoveryStrategy,
  DiscoveryContext,
  DiscoveryResult,
  DiscoveryEngineConfig,
  DiscoveryStats,
} from './types';
import { CRITICAL_STRATEGY_PRIORITY } from './constants';

const logger = createComponentLogger('discovery-engine');

export class DiscoveryEngine {
  private strategies: DiscoveryStrategy[] = [];
  private config: DiscoveryEngineConfig;

  constructor(
    _db: Knex,
    config: Partial<DiscoveryEngineConfig> = {}
  ) {
    this.config = {
      maxIterations: config.maxIterations ?? 3,
      convergenceThreshold: config.convergenceThreshold ?? 1,
      debug: config.debug ?? false,
    };
  }

  /**
   * Register a discovery strategy.
   * Strategies are executed in priority order (lower priority first).
   */
  registerStrategy(strategy: DiscoveryStrategy): void {
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Register multiple strategies at once.
   */
  registerStrategies(strategies: DiscoveryStrategy[]): void {
    strategies.forEach(s => this.registerStrategy(s));
  }

  /**
   * Execute discovery process with iterative convergence.
   *
   * @param entryPointId - Symbol ID to start discovery from
   * @param repoId - Repository to analyze
   * @param featureName - Extracted feature name
   * @param options - Discovery configuration options
   * @returns Map of symbol IDs to relevance scores
   */
  async discover(
    entryPointId: number,
    repoId: number,
    featureName: string,
    options: DiscoveryContext['options']
  ): Promise<{ symbols: DiscoveryResult; stats: DiscoveryStats }> {
    try {
      const startTime = Date.now();
      const symbolRelevance = new Map<number, number>([[entryPointId, 1.0]]);

      const stats: DiscoveryStats = {
        iterations: 0,
        symbolsPerIteration: [],
        strategyStats: new Map(),
        totalTime: 0,
        converged: false,
        failedStrategies: [],
      };

      let previousSize = 0;
      let unchangedIterations = 0;

      this.strategies.forEach(strategy => {
        if (strategy.reset) {
          strategy.reset();
        }
      });

      logger.info('Starting discovery engine', {
        entryPointId,
        featureName,
        strategiesCount: this.strategies.length,
        maxIterations: this.config.maxIterations,
      });

      for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
        const iterationStartSize = symbolRelevance.size;
        stats.iterations = iteration + 1;

        if (this.config.debug) {
          logger.debug(`Iteration ${iteration + 1}`, {
            currentSymbols: symbolRelevance.size,
            strategies: this.strategies.map(s => s.name),
          });
        }

        const context: DiscoveryContext = {
          currentSymbols: Array.from(symbolRelevance.keys()),
          repoId,
          featureName,
          entryPointId,
          options,
          iteration,
        };

        for (const strategy of this.strategies) {
          if (strategy.shouldRun && !(await strategy.shouldRun(context))) {
            if (this.config.debug) {
              logger.debug(`Skipping strategy ${strategy.name}`, { iteration });
            }
            continue;
          }

          const strategyStart = Date.now();
          let discovered: DiscoveryResult;

          try {
            discovered = await strategy.discover(context);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Track failure in stats
            stats.failedStrategies.push({
              strategy: strategy.name,
              iteration,
              error: errorMessage,
            });

            // Critical strategies (priority <= CRITICAL_STRATEGY_PRIORITY) must succeed
            // These are foundational strategies like dependency-traversal
            if (strategy.priority <= CRITICAL_STRATEGY_PRIORITY) {
              logger.error(`Critical strategy ${strategy.name} failed - aborting discovery`, {
                error: errorMessage,
                iteration,
                priority: strategy.priority,
              });
              throw new Error(
                `Critical discovery strategy '${strategy.name}' failed: ${errorMessage}`
              );
            }

            // Non-critical strategies log error and continue
            logger.error(`Strategy ${strategy.name} failed - continuing with other strategies`, {
              error: errorMessage,
              iteration,
              priority: strategy.priority,
            });
            continue;
          }

          const strategyTime = Date.now() - strategyStart;
          const newSymbolsCount = Array.from(discovered.keys()).filter(
            id => !symbolRelevance.has(id)
          ).length;

          discovered.forEach((relevance, id) => {
            if (!symbolRelevance.has(id)) {
              symbolRelevance.set(id, relevance);
            }
          });

          // Update stats
          const stratStats = stats.strategyStats.get(strategy.name) || {
            executions: 0,
            symbolsDiscovered: 0,
            avgExecutionTime: 0,
          };
          stratStats.executions++;
          stratStats.symbolsDiscovered += newSymbolsCount;
          stratStats.avgExecutionTime =
            (stratStats.avgExecutionTime * (stratStats.executions - 1) + strategyTime) /
            stratStats.executions;
          stats.strategyStats.set(strategy.name, stratStats);

          if (this.config.debug) {
            logger.debug(`Strategy ${strategy.name} complete`, {
              discovered: discovered.size,
              newSymbols: newSymbolsCount,
              time: strategyTime,
            });
          }
        }

        const iterationNewSymbols = symbolRelevance.size - iterationStartSize;
        stats.symbolsPerIteration.push(iterationNewSymbols);

        logger.info(`Iteration ${iteration + 1} complete`, {
          totalSymbols: symbolRelevance.size,
          newSymbols: iterationNewSymbols,
        });

        // Check convergence
        if (symbolRelevance.size === previousSize) {
          unchangedIterations++;
          if (unchangedIterations >= this.config.convergenceThreshold) {
            logger.info('Discovery converged', {
              iterations: iteration + 1,
              totalSymbols: symbolRelevance.size,
            });
            stats.converged = true;
            break;
          }
        } else {
          unchangedIterations = 0;
        }

        previousSize = symbolRelevance.size;
      }

      stats.totalTime = Date.now() - startTime;

      logger.info('Discovery complete', {
        totalSymbols: symbolRelevance.size,
        iterations: stats.iterations,
        converged: stats.converged,
        time: stats.totalTime,
      });

      return { symbols: symbolRelevance, stats };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get registered strategies (for testing/debugging).
   */
  getStrategies(): DiscoveryStrategy[] {
    return [...this.strategies];
  }

  /**
   * Clear all registered strategies.
   */
  clearStrategies(): void {
    this.strategies = [];
  }
}
