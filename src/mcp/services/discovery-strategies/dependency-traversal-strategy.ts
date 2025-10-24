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
    // Only run in iteration 0 to prevent redundant re-traversal
    // Direction-aware traversal ensures clean discovery within the iteration
    // Subsequent iterations handle new symbols discovered by other strategies
    return context.iteration === 0;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { entryPointId, options, featureName, repoId, currentSymbols } = context;
    const maxDepth = options.maxDepth;

    logger.debug('Starting dependency traversal', {
      entryPoint: entryPointId,
      currentSymbols: currentSymbols.length,
      maxDepth,
      featureName,
    });

    const related = new Map<number, number>();

    // Initialize queue with ALL currently discovered symbols (including controller class expansion)
    // This ensures that when we start from a controller method and the discovery engine adds
    // the parent controller class, we traverse dependencies from both the method AND the class
    // Direction-aware traversal handles component explosion naturally without special-case filtering
    const symbolsBatch = await this.dbService.getSymbolsBatch(currentSymbols);

    // Direction-aware traversal: Track how each symbol was discovered
    // - 'entry': Entry point (can traverse both directions)
    // - 'forward': Discovered via forward deps (only traverse forward from here)
    // - 'backward': Discovered via backward deps (only traverse backward from here)
    type DiscoveryDirection = 'entry' | 'forward' | 'backward';

    // Determine initial direction based on entry point layer
    // This implements layer-based discovery strategy:
    // - Frontend leaf (component): Forward only → "what does it need"
    // - Backend leaf (model/service): Backward only → "who uses it"
    // - Middle layer (composable/store/endpoint): Bidirectional → "who uses + what needs"
    const initialDirection: DiscoveryDirection =
      context.entryPointLayer === 'frontend-leaf'
        ? 'forward'
        : context.entryPointLayer === 'backend-leaf'
          ? 'backward'
          : 'entry';

    const queue = currentSymbols.map(id => ({ id, depth: 0, direction: initialDirection }));
    const visited = new Set<number>(currentSymbols);
    const discoveredSymbols = new Set<number>(currentSymbols); // Track all discovered symbols for context-aware filtering
    const validatedFileIds = new Set<number>(); // Track files containing validated entities for file-level filtering

    // Add all current symbol files to validated files
    for (const [_id, symbol] of symbolsBatch) {
      if (symbol?.file_id) {
        validatedFileIds.add(symbol.file_id);
      }
    }

    // Initialize contextSymbols with methods from entry point controllers
    // When we start from a controller method and expand to include the controller class,
    // we need the controller's methods in contextSymbols for complete context tracking.
    const entryPointControllerIds = currentSymbols.filter(id => {
      const symbol = symbolsBatch.get(id);
      return symbol?.entity_type === 'controller';
    });
    if (entryPointControllerIds.length > 0) {
      await this.expandContextWithControllerMethods(
        new Set(entryPointControllerIds),
        context.contextSymbols
      );
    }

    logger.debug('Initialized traversal queue', {
      queueSize: queue.length,
      visitedSize: visited.size,
      validatedFiles: validatedFileIds.size,
      entryPointControllers: entryPointControllerIds.length,
      contextSymbolsInitialized: context.contextSymbols.size,
    });

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

      const { id, depth, direction } = queue.shift()!;
      if (depth >= maxDepth) continue;

      // Check current symbol type for traversal decisions
      const currentSymbol = await this.dbService.getSymbol(id);
      const isStore = currentSymbol?.entity_type === 'store';
      const isExecutionIntermediary =
        currentSymbol?.entity_type === 'composable' || currentSymbol?.entity_type === 'method';

      // Direction-aware traversal with exception for execution intermediaries
      // Composables/methods discovered backward still need to traverse forward to find stores/services they use
      const shouldTraverseForward =
        direction === 'entry' ||
        direction === 'forward' ||
        (direction === 'backward' && isExecutionIntermediary);
      const shouldTraverseBackward = direction === 'entry' || direction === 'backward';

      // Get forward dependencies (filtered by type later based on depth)
      const dependencies = shouldTraverseForward
        ? await this.dbService.getDependenciesFrom(id)
        : [];

      // Get backward dependencies (filtered by type later)
      const callers = shouldTraverseBackward ? await this.dbService.getDependenciesTo(id) : [];

      const nextDepth = depth + 1;
      const candidateIds: number[] = [];
      const forwardCandidates = new Set<number>(); // Track which came from forward deps
      const backwardCandidates = new Set<number>(); // Track which came from backward deps
      const candidateDependencyTypes = new Map<number, string>(); // Track what dependency type discovered each candidate

      // DEPENDENCY TYPE FILTERING: Simple, clean rules based on depth and direction
      // Forward traversal:
      //   - Depth 0 (entry): Follow imports/references to discover what it uses
      //   - Depth 1: Allow selective 'contains' for composables (NOT stores)
      //   - Depth 2+: Execution paths only (calls, api_call)
      // Backward traversal:
      //   - All depths: Follow calls/references/contains (actual usage + structural parents)
      let allowedDependencyTypes: Set<string>;
      if (shouldTraverseForward && !shouldTraverseBackward) {
        // Forward-only traversal
        if (depth === 0) {
          allowedDependencyTypes = new Set(['imports', 'references', 'calls', 'api_call']);
        } else if (depth === 1 && !isStore) {
          allowedDependencyTypes = new Set(['calls', 'api_call', 'contains']);
        } else {
          allowedDependencyTypes = new Set(['calls', 'api_call']);
        }
      } else if (shouldTraverseBackward && !shouldTraverseForward) {
        // Backward-only traversal: all depths follow calls/references/contains
        // CONTAINS is needed to traverse from inner functions back to parent composables/functions
        allowedDependencyTypes = new Set(['calls', 'references', 'contains']);
      } else {
        // Entry point (both directions): depth 0 behavior
        allowedDependencyTypes = new Set(['imports', 'references', 'calls', 'api_call']);
      }

      // Collect 'contains' dependencies for batch validation
      const containsTargets: number[] = [];
      const nonContainsCandidates: number[] = [];

      for (const dep of dependencies) {
        const targetId = dep.to_symbol_id;

        if (!targetId || visited.has(targetId)) continue;

        if (!allowedDependencyTypes.has(dep.dependency_type)) {
          continue;
        }

        /**
         * EXECUTION-LEVEL FILTERING: Prevents class-level imports from polluting discovery.
         * Controller/Service classes import ALL models for ALL their methods (structural dependencies).
         * We only want models actually used by methods in the execution path (execution dependencies).
         * Solution: Classes cannot follow imports/references, only methods/functions can.
         */
        if (
          (dep.dependency_type === 'imports' || dep.dependency_type === 'references') &&
          currentSymbol?.symbol_type === 'class'
        ) {
          logger.debug('Filtered class-level import/reference', {
            class: currentSymbol.name,
            entity_type: currentSymbol.entity_type,
            dependency_type: dep.dependency_type,
            targetId,
            depth,
          });
          continue;
        }

        // Special handling for 'contains' at depth 1: only follow if target has execution deps
        if (dep.dependency_type === 'contains' && depth === 1) {
          containsTargets.push(targetId);
        } else {
          visited.add(targetId);
          nonContainsCandidates.push(targetId);
          candidateDependencyTypes.set(targetId, dep.dependency_type);
        }
      }

      // Batch check: which 'contains' targets have outgoing calls/api_call?
      if (containsTargets.length > 0) {
        const targetsWithExecutionDeps = await this.dbService
          .knex('dependencies')
          .whereIn('from_symbol_id', containsTargets)
          .whereIn('dependency_type', ['calls', 'api_call'])
          .distinct('from_symbol_id')
          .pluck('from_symbol_id');

        // Only traverse into symbols that actually DO something (make calls)
        for (const targetId of targetsWithExecutionDeps) {
          if (!visited.has(targetId)) {
            visited.add(targetId);
            candidateIds.push(targetId);
            forwardCandidates.add(targetId); // Mark as forward discovery
            candidateDependencyTypes.set(targetId, 'contains');
          }
        }

        logger.info('Selective contains filtering', {
          currentSymbolId: id,
          currentSymbolEntity: currentSymbol?.entity_type,
          currentDepth: depth,
          totalContainsTargets: containsTargets.length,
          withExecutionDeps: targetsWithExecutionDeps.length,
          filtered: containsTargets.length - targetsWithExecutionDeps.length,
          targetsWithExecutionDeps: targetsWithExecutionDeps,
        });
      }

      // Add non-contains candidates and mark as forward discovery
      candidateIds.push(...nonContainsCandidates);
      nonContainsCandidates.forEach(id => forwardCandidates.add(id));

      // Structural parents discovered via backward CONTAINS (stores containing methods, classes containing functions)
      // These are added for CONTEXT (categorization) but NOT queued for traversal (to prevent noise)
      const structuralParents: number[] = [];

      // For backward dependencies (callers), filter by allowed dependency types
      // Direction-aware traversal handles store explosion naturally:
      // - Stores discovered forward won't traverse backward (shouldTraverseBackward = false)
      for (const dep of callers) {
        const targetId = dep.from_symbol_id;

        // Skip if already visited
        if (!targetId || visited.has(targetId)) continue;

        // Special handling for CONTAINS: structural parents (stores, classes)
        // These provide context but shouldn't be traversed to prevent noise
        if (dep.dependency_type === 'contains' && !allowedDependencyTypes.has('contains')) {
          visited.add(targetId);
          structuralParents.push(targetId);
          continue;
        }

        // Filter by allowed dependency types
        if (!allowedDependencyTypes.has(dep.dependency_type)) {
          continue;
        }

        visited.add(targetId);
        candidateIds.push(targetId);
        backwardCandidates.add(targetId); // Mark as backward discovery
        candidateDependencyTypes.set(targetId, dep.dependency_type);
      }

      // Add structural parents to discovered symbols for categorization
      // but DON'T add to candidateIds (won't be queued for traversal)
      if (structuralParents.length > 0) {
        for (const parentId of structuralParents) {
          discoveredSymbols.add(parentId);
          related.set(parentId, 1.0); // High relevance - structural context
        }
        logger.debug('Discovered structural parents (context-only, no traversal)', {
          currentSymbol: id,
          parents: structuralParents,
          depth,
        });
      }

      // Smart filtering to prevent false positives while allowing valid connections
      if (candidateIds.length > 0) {
        const symbolMap = await this.dbService.getSymbolsBatch(candidateIds);

        // Batch validate controllers, stores, requests, and models to minimize database queries
        const controllerIds = candidateIds.filter(
          id => symbolMap.get(id)?.entity_type === 'controller'
        );
        const storeIds = candidateIds.filter(id => symbolMap.get(id)?.entity_type === 'store');
        const requestIds = candidateIds.filter(id => symbolMap.get(id)?.entity_type === 'request');
        const modelIds = candidateIds.filter(id => symbolMap.get(id)?.entity_type === 'model');
        const serviceIds = candidateIds.filter(id => symbolMap.get(id)?.entity_type === 'service');
        const composableIds = candidateIds.filter(
          id => symbolMap.get(id)?.entity_type === 'composable'
        );

        // Expand context to include methods from discovered controllers
        if (controllerIds.length > 0) {
          await this.expandContextWithControllerMethods(
            new Set(controllerIds),
            context.contextSymbols
          );
        }

        // Collect file IDs from all discovered entities this iteration
        const currentIterationDiscovered = new Set([
          ...controllerIds,
          ...storeIds,
          ...requestIds,
          ...modelIds,
          ...serviceIds,
          ...composableIds,
        ]);

        if (currentIterationDiscovered.size > 0) {
          await this.collectFileIds(currentIterationDiscovered, validatedFileIds);
        }

        for (const targetId of candidateIds) {
          const symbol = symbolMap.get(targetId);
          const depType = candidateDependencyTypes.get(targetId);

          // Layer-aware component filtering:
          // Backend-leaf entry points (model/service) exclude components at depth > 1
          // to prevent UI over-discovery when starting from backend entities
          const isBackendLeaf = context.entryPointLayer === 'backend-leaf';
          if (nextDepth > 1 && symbol?.entity_type === 'component' && isBackendLeaf) {
            continue;
          }

          // FILE-LEVEL CONTEXT FILTERING at depth > 1
          // Only apply to generic symbols (methods, properties, variables, functions, interfaces)
          // Entity types (stores, services, models, controllers, components, requests, composables)
          // have their own validation logic and should not be filtered by file-level context
          const isEntityType =
            symbol?.entity_type &&
            [
              'store',
              'service',
              'model',
              'controller',
              'component',
              'request',
              'composable',
            ].includes(symbol.entity_type);

          // EXCEPTION: Allow inner functions discovered backward via CONTAINS
          // These are execution intermediaries that bridge to parent composables/functions
          const isInnerFunctionInBackwardContains =
            symbol?.symbol_type === 'function' &&
            symbol?.entity_type === 'function' &&
            backwardCandidates.has(targetId) &&
            depth > 0;

          if (
            nextDepth > 1 &&
            !isEntityType &&
            !isInnerFunctionInBackwardContains &&
            symbol?.file_id &&
            !validatedFileIds.has(symbol.file_id)
          ) {
            logger.debug('Filtered by file-level context', {
              symbolId: targetId,
              symbolName: symbol.name,
              symbolType: symbol.symbol_type,
              fileId: symbol.file_id,
              depth: nextDepth,
            });
            continue;
          }

          // Assign direction based on how this symbol was discovered
          const candidateDirection: DiscoveryDirection = forwardCandidates.has(targetId)
            ? 'forward'
            : 'backward';

          // ARCHITECTURAL DECISION: CONTAINS relationships are depth-neutral in backward traversal
          // CONTAINS represents structural parent-child relationships (function contains inner function)
          // NOT execution flow - so it shouldn't consume depth levels
          // This prevents inner functions from blocking discovery of parent composables/components
          const isBackwardContains = candidateDirection === 'backward' && depType === 'contains';
          const effectiveDepth = isBackwardContains ? depth : nextDepth;

          const relevance = 1.0 - effectiveDepth / (maxDepth + 1);
          related.set(targetId, relevance);
          discoveredSymbols.add(targetId); // Add to discovered symbols for context-aware filtering

          queue.push({ id: targetId, depth: effectiveDepth, direction: candidateDirection });
        }
      }
    }

    logger.debug('Dependency traversal complete', {
      discovered: related.size,
      visited: visited.size,
    });

    return related;
  }

  /**
   * Expand context to include all methods from discovered controllers.
   *
   * Controllers have a class→method hierarchy where methods aren't dependencies of the class.
   * When we discover a controller class during traversal, we need to explicitly include
   * its methods in the context for complete tracking.
   *
   * These methods are added to contextSymbols (NOT discoveredSymbols) to maintain
   * separation between explicitly discovered symbols and contextual information.
   */
  private async expandContextWithControllerMethods(
    controllerIds: Set<number>,
    contextSymbols: Set<number>
  ): Promise<void> {
    if (controllerIds.size === 0) return;

    const knex = this.dbService.knex;

    // Get all methods from the discovered controller files
    const methods = await knex('symbols as method')
      .join('files as f', 'method.file_id', 'f.id')
      .join('symbols as controller', 'controller.file_id', 'f.id')
      .whereIn('controller.id', Array.from(controllerIds))
      .where('controller.entity_type', 'controller')
      .where('method.symbol_type', 'method')
      .select('method.id');

    // Add all controller methods to context (not feature symbols)
    for (const row of methods) {
      contextSymbols.add(row.id);
    }

    logger.debug('Expanded context with controller methods', {
      controllers: controllerIds.size,
      methodsAdded: methods.length,
      totalContextSymbols: contextSymbols.size,
    });
  }

  /**
   * Collect file IDs from a set of symbols.
   * Used to build the file context for file-level filtering at depth > 1.
   *
   * Only symbols from files containing discovered entities (controllers, services, models, etc.)
   * will be included in related_symbols, filtering out methods from unrelated files.
   */
  private async collectFileIds(symbolIds: Set<number>, fileIds: Set<number>): Promise<void> {
    if (symbolIds.size === 0) return;

    const symbols = await this.dbService.getSymbolsBatch(Array.from(symbolIds));

    let addedCount = 0;
    for (const [_, symbol] of symbols.entries()) {
      if (symbol?.file_id && !fileIds.has(symbol.file_id)) {
        fileIds.add(symbol.file_id);
        addedCount++;
      }
    }

    logger.debug('Collected file IDs from discovered symbols', {
      symbolCount: symbolIds.size,
      newFiles: addedCount,
      totalFiles: fileIds.size,
    });
  }
}
