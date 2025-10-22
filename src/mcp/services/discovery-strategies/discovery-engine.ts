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
 * 5. Applies semantic filtering to discovered symbols based on embedding similarity
 */

import { createComponentLogger } from '../../../utils/logger';
import { DatabaseService } from '../../../database/services';
import { getEmbeddingService, EmbeddingService } from '../../../services/embedding-service';
import {
  DiscoveryStrategy,
  DiscoveryContext,
  DiscoveryResult,
  DiscoveryEngineConfig,
  DiscoveryStats,
  StrategyStatistics,
} from './types';
import { CRITICAL_STRATEGY_PRIORITY } from './constants';

const logger = createComponentLogger('discovery-engine');

interface SemanticThresholdConfig {
  composable: number;
  function: number;
  component: number;
  unclassifiedVariable: number;
  unclassifiedFunction: number;
  unclassifiedMethod: number;
  unclassifiedOther: number;
  interface: number;
  type: number;
  property: number;
  variable: number;
  controller: number;
  service: number;
  interfaceTypeOffset: number;
  propertyVariableOffset: number;
  minInterfaceTypeThreshold: number;
}

export class DiscoveryEngine {
  private strategies: DiscoveryStrategy[] = [];
  private config: DiscoveryEngineConfig;
  private featureEmbedding: number[] | null = null;
  private embeddingService: EmbeddingService;

  private readonly thresholdConfig: SemanticThresholdConfig = {
    composable: 0.75,
    function: 0.75,
    component: 0.7,
    unclassifiedVariable: 0.7,
    unclassifiedFunction: 0.75,
    unclassifiedMethod: 0.7,
    unclassifiedOther: 0.68,
    interface: 0.0,
    type: 0.0,
    property: 0.0,
    variable: 0.0,
    controller: 0.7,
    service: 0.7,
    interfaceTypeOffset: -0.05,
    propertyVariableOffset: 0.05,
    minInterfaceTypeThreshold: 0.6,
  };

  constructor(
    private dbService: DatabaseService,
    config: Partial<DiscoveryEngineConfig> = {}
  ) {
    this.config = {
      maxIterations: config.maxIterations ?? 3,
      convergenceThreshold: config.convergenceThreshold ?? 1,
      debug: config.debug ?? false,
      semanticFiltering: {
        enabled: config.semanticFiltering?.enabled ?? true,
        similarityThreshold: config.semanticFiltering?.similarityThreshold ?? 0.7,
        applyToStrategies:
          config.semanticFiltering?.applyToStrategies ??
          new Set([
            'dependency-traversal',
            'naming-pattern',
            'forward-dependency',
            'reverse-caller',
          ]),
      },
    };
    this.embeddingService = getEmbeddingService();
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
   * Generate and cache embedding for feature name.
   * Uses embedding service to create 1024-dimensional vector representation.
   */
  private async getFeatureEmbedding(featureName: string): Promise<number[]> {
    if (!this.featureEmbedding) {
      try {
        await this.embeddingService.initialize();
        this.featureEmbedding = await this.embeddingService.generateEmbedding(featureName);

        if (this.config.debug) {
          logger.debug('Generated feature embedding', {
            featureName,
            embeddingDimensions: this.featureEmbedding.length,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to generate feature embedding', {
          featureName,
          error: errorMessage,
        });
        throw new Error(`Embedding generation failed: ${errorMessage}`);
      }
    }
    return this.featureEmbedding;
  }

  /**
   * Determine if semantic filtering should be applied to this strategy.
   */
  private shouldApplySemanticFilter(strategyName: string): boolean {
    if (!this.config.semanticFiltering.enabled) {
      return false;
    }
    return this.config.semanticFiltering.applyToStrategies.has(strategyName);
  }

  /**
   * Get the similarity threshold for a specific strategy.
   * Supports both global threshold (number) and strategy-specific thresholds (Map).
   *
   * @param strategyName - Name of the strategy
   * @returns Threshold value for this strategy
   */
  private getThresholdForStrategy(strategyName: string): number {
    const threshold = this.config.semanticFiltering.similarityThreshold;

    if (typeof threshold === 'number') {
      return threshold;
    }

    return threshold.get(strategyName) ?? 0.7;
  }

  /**
   * Apply semantic filtering to discovered symbols.
   * Calculates similarity between feature embedding and symbol embeddings,
   * filters symbols below threshold, and adjusts relevance scores.
   *
   * @param discovered - Map of symbol IDs to relevance scores from strategy
   * @param featureEmbedding - 1024-dimensional feature embedding
   * @param strategyName - Name of strategy (for logging)
   * @returns Filtered map with adjusted relevance scores and statistics
   */
  /**
   * Get entity-type-specific semantic threshold.
   * Stricter thresholds for generic/reusable entity types and unclassified symbols.
   */
  private getSemanticThreshold(
    symbol: { entity_type?: string | null; symbol_type: string } | null,
    strategyName: string
  ): number {
    const baseThreshold = this.getThresholdForStrategy(strategyName);

    if (!symbol) {
      return baseThreshold;
    }

    const entityType = symbol.entity_type;

    // Stricter threshold for generic/reusable entity types
    // These are harder to distinguish semantically due to shared patterns
    if (entityType === 'composable' || entityType === 'function') {
      return this.thresholdConfig.composable;
    }

    // Components need stricter threshold to filter out weakly-related UI components
    // Template parsing creates many component connections; semantic filtering prevents noise
    if (entityType === 'component') {
      return this.thresholdConfig.component;
    }

    // Unclassified symbols (null entity_type) are often generic helpers or framework code
    // Apply stricter threshold to filter out noise in related_symbols
    if (!entityType) {
      if (symbol.symbol_type === 'variable' || symbol.symbol_type === 'property') {
        return this.thresholdConfig.unclassifiedVariable;
      }
      if (symbol.symbol_type === 'function') {
        return this.thresholdConfig.unclassifiedFunction;
      }
      if (symbol.symbol_type === 'method') {
        return this.thresholdConfig.unclassifiedMethod;
      }
      return this.thresholdConfig.unclassifiedOther;
    }

    // Interfaces and types are structurally necessary - more lenient
    if (entityType === 'interface' || entityType === 'type') {
      return Math.max(
        baseThreshold + this.thresholdConfig.interfaceTypeOffset,
        this.thresholdConfig.minInterfaceTypeThreshold
      );
    }

    // Properties and variables can have weak semantic signals
    if (entityType === 'property' || entityType === 'variable') {
      return baseThreshold + this.thresholdConfig.propertyVariableOffset;
    }

    // Controllers and services from indirect strategies should be stricter
    // to avoid pulling in unrelated domain controllers
    if (
      (entityType === 'controller' || entityType === 'service') &&
      (strategyName === 'naming-pattern' || strategyName === 'forward-dependency')
    ) {
      return this.thresholdConfig.controller;
    }

    return baseThreshold;
  }

  private async applySemanticFilter(
    discovered: DiscoveryResult,
    featureEmbedding: number[],
    strategyName: string
  ): Promise<{
    filtered: DiscoveryResult;
    stats: { before: number; after: number; avgSimilarity: number };
  }> {
    const symbolIds = Array.from(discovered.keys());

    if (symbolIds.length === 0) {
      return {
        filtered: discovered,
        stats: { before: 0, after: 0, avgSimilarity: 0 },
      };
    }

    const similarities = await this.dbService.getSymbolSimilarities(symbolIds, featureEmbedding);

    // Fetch symbols in batch to get entity types for threshold calculation
    const symbolMap = await this.dbService.getSymbolsBatch(symbolIds);

    const filtered = new Map<number, number>();
    let totalSimilarity = 0;
    let validCount = 0;
    let entityTypeStats = new Map<string, { filtered: number; kept: number }>();

    for (const [symbolId, originalScore] of discovered) {
      const similarity = similarities.get(symbolId);

      if (similarity === undefined) {
        const symbol = symbolMap.get(symbolId);
        logger.warn('Symbol missing embedding - excluding from semantic filter', {
          symbolId,
          symbolName: symbol?.name || 'unknown',
          symbolType: symbol?.symbol_type || 'unknown',
          filePath: symbol ? `file_id:${symbol.file_id}` : 'unknown',
        });
        continue;
      }

      const symbol = symbolMap.get(symbolId);
      const threshold = this.getSemanticThreshold(symbol || null, strategyName);

      // Track stats per entity type
      const entityKey = symbol?.entity_type || 'unknown';
      if (!entityTypeStats.has(entityKey)) {
        entityTypeStats.set(entityKey, { filtered: 0, kept: 0 });
      }

      if (similarity >= threshold) {
        const adjustedScore = originalScore * similarity;
        filtered.set(symbolId, adjustedScore);
        totalSimilarity += similarity;
        validCount++;
        entityTypeStats.get(entityKey)!.kept++;
      } else {
        entityTypeStats.get(entityKey)!.filtered++;
      }
    }

    const avgSimilarity = validCount > 0 ? totalSimilarity / validCount : 0;

    if (this.config.debug) {
      logger.debug(`Semantic filtering for ${strategyName}`, {
        before: discovered.size,
        after: filtered.size,
        filtered: discovered.size - filtered.size,
        avgSimilarity: avgSimilarity.toFixed(3),
        entityTypeBreakdown: Object.fromEntries(entityTypeStats),
      });
    }

    return {
      filtered,
      stats: {
        before: discovered.size,
        after: filtered.size,
        avgSimilarity,
      },
    };
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

      // CONTROLLER METHOD EXPANSION:
      // When starting from a controller method, also include the parent controller class
      // This ensures we discover constructor-injected services, requests, and models
      // that are dependencies of the controller class, not the individual method
      await this.expandControllerMethodEntryPoint(symbolRelevance, entryPointId, repoId);

      const graphValidatedSymbols = new Set<number>(); // Track symbols discovered via direct graph edges
      const contextSymbols = new Set<number>(); // Track symbols for validation context only (not part of feature)
      const stats: DiscoveryStats = {
        iterations: 0,
        symbolsPerIteration: [],
        strategyStats: new Map(),
        totalTime: 0,
        converged: false,
        failedStrategies: [],
        semanticFiltering: {
          enabled: this.config.semanticFiltering.enabled,
          threshold: this.config.semanticFiltering.similarityThreshold,
          totalSymbolsBeforeFilter: 0,
          totalSymbolsAfterFilter: 0,
          strategiesFiltered: new Map(),
        },
      };

      const featureEmbedding = this.config.semanticFiltering.enabled
        ? await this.getFeatureEmbedding(featureName)
        : null;

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
        semanticFiltering: this.config.semanticFiltering.enabled,
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
          semanticFiltering: {
            enabled: this.config.semanticFiltering.enabled,
            threshold: this.config.semanticFiltering.similarityThreshold,
          },
          graphValidatedSymbols,
          contextSymbols,
        };

        for (const strategy of this.strategies) {
          if (strategy.shouldRun && !strategy.shouldRun(context)) {
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

          let filterStats = { before: discovered.size, after: discovered.size, avgSimilarity: 0 };
          if (this.shouldApplySemanticFilter(strategy.name) && featureEmbedding) {
            const result = await this.applySemanticFilter(
              discovered,
              featureEmbedding,
              strategy.name
            );
            discovered = result.filtered;
            filterStats = result.stats;

            stats.semanticFiltering.strategiesFiltered.set(strategy.name, filterStats);
            stats.semanticFiltering.totalSymbolsBeforeFilter += filterStats.before;
            stats.semanticFiltering.totalSymbolsAfterFilter += filterStats.after;
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

          // Track graph-validated symbols from cross-stack strategy
          // Controllers and requests discovered via API graph edges should bypass semantic validation
          if (strategy.name === 'cross-stack' && discovered.size > 0) {
            const discoveredIds = Array.from(discovered.keys());
            const symbols = await this.dbService.getSymbolsBatch(discoveredIds);

            let controllersAdded = 0;
            let requestsAdded = 0;

            for (const [id, symbol] of symbols.entries()) {
              if (symbol?.entity_type === 'controller') {
                graphValidatedSymbols.add(id);
                controllersAdded++;
              } else if (symbol?.entity_type === 'request') {
                graphValidatedSymbols.add(id);
                requestsAdded++;
              }
            }

            if (this.config.debug) {
              logger.debug('Graph-validated symbols from cross-stack', {
                controllers: controllersAdded,
                requests: requestsAdded,
                total: graphValidatedSymbols.size,
              });
            }
          }

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
        semanticFilteringReduction: stats.semanticFiltering.enabled
          ? stats.semanticFiltering.totalSymbolsBeforeFilter -
            stats.semanticFiltering.totalSymbolsAfterFilter
          : 0,
      });

      return { symbols: symbolRelevance, stats };
    } finally {
      // Always clear cached embedding to prevent memory leaks, even on error
      this.featureEmbedding = null;
    }
  }

  /**
   * Expand entry point when it's a controller method to include the parent controller class.
   *
   * Controller methods often don't have direct dependencies to services/models because
   * these are injected in the controller constructor.
   *
   * @param symbolRelevance - Map to add the controller class to
   * @param entryPointId - The method symbol ID
   * @param repoId - Repository ID
   */
  private async expandControllerMethodEntryPoint(
    symbolRelevance: Map<number, number>,
    entryPointId: number,
    repoId: number
  ): Promise<void> {
    const db = this.dbService.knex;

    // Get the entry point symbol
    const entryPoint = await db('symbols').where('id', entryPointId).first();

    // Only expand if it's a controller method
    if (entryPoint?.symbol_type !== 'method' || entryPoint?.entity_type !== 'method') {
      return;
    }

    // Find parent controller class in the same file
    const controllerClass = await db('symbols')
      .where('file_id', entryPoint.file_id)
      .where('symbol_type', 'class')
      .where('entity_type', 'controller')
      .first();

    if (controllerClass) {
      // Add controller class to initial discovery set
      symbolRelevance.set(controllerClass.id, 1.0);

      logger.info('Expanded controller method entry point', {
        methodId: entryPointId,
        methodName: entryPoint.name,
        controllerId: controllerClass.id,
        controllerName: controllerClass.name,
      });
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
