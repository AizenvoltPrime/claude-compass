/**
 * Clean Dependency Traversal Strategy (Refactored)
 *
 * Executor-centric BFS traversal following actual execution paths.
 * Refactored for maintainability with focused helper classes.
 *
 * Core principles:
 * 1. Only EXECUTORS (methods/functions) follow execution edges (calls, api_call)
 * 2. CONTAINERS expand to their executors, then switch to executor rules
 * 3. Never follow imports/references from containers (structural, not execution)
 * 4. Direction-aware: forward/backward/both based on entry point
 */

import type { Knex } from 'knex';
import * as SymbolService from '../../../../database/services/symbol-service';
import { createComponentLogger } from '../../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from '../common/types';
import {
  classifySymbol,
  getTraversalDirection,
  SymbolRole,
  TraversalDirection,
  SymbolInfo,
} from './symbol-classifier';
import { TraversalState } from './traversal-state';
import { TraversalQueue, QueueItem } from './traversal-queue';
import { SymbolGraphQueries } from './symbol-graph-queries';
import { DepthFilterPolicy, DepthFilterConfig } from './depth-filter-policy';
import { FileValidationPolicy } from './file-validation-policy';
import { DirectionResolver } from './direction-resolver';
import { ParentDiscoveryHandler } from './parent-discovery-handler';
import { ContainerExpander } from './container-expander';

const logger = createComponentLogger('dependency-traversal-refactored');

export class CleanDependencyTraversalStrategy implements DiscoveryStrategy {
  readonly name = 'dependency-traversal';
  readonly description = 'Clean executor-centric BFS traversal';
  readonly priority = 10;

  private static readonly MAX_VISITED_NODES = 50000;
  private static readonly MAX_QUEUE_SIZE = 10000;

  private entryPointEntityType?: string;

  constructor(private db: Knex) {}

  async shouldRun(context: DiscoveryContext): Promise<boolean> {
    if (context.iteration !== 0) {
      return false;
    }

    const entrySymbol = await SymbolService.getSymbol(this.db, context.entryPointId);
    if (!entrySymbol) {
      return false;
    }

    if (entrySymbol.entity_type === 'component') {
      logger.info('Skipping dependency traversal for component entry point', {
        symbolId: context.entryPointId,
        symbolName: entrySymbol.name,
        reason: 'Components use prop-driven + cross-stack strategies for precise discovery',
      });
      return false;
    }

    return true;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { entryPointId, options, currentSymbols } = context;
    const maxDepth = options.maxDepth;

    logger.info('Starting clean dependency traversal', {
      entryPoint: entryPointId,
      maxDepth,
      currentSymbols: currentSymbols.length,
    });

    const state = new TraversalState();
    const queue = new TraversalQueue(CleanDependencyTraversalStrategy.MAX_QUEUE_SIZE, maxDepth);

    const queries = new SymbolGraphQueries(this.db);
    const depthFilter = new DepthFilterPolicy();
    const fileValidation = new FileValidationPolicy(state);
    const directionResolver = new DirectionResolver(queries, this.entryPointEntityType);
    const containerExpander = new ContainerExpander(queries);
    const parentDiscovery = new ParentDiscoveryHandler(this.db, queries);

    const entrySymbol = await SymbolService.getSymbol(this.db, entryPointId);
    this.entryPointEntityType = entrySymbol?.entity_type;

    const symbolsBatch = await SymbolService.getSymbolsBatch(this.db, currentSymbols);
    state.initializeFromSymbols(symbolsBatch);

    await this.initializeQueue(
      currentSymbols,
      symbolsBatch,
      queue,
      state,
      containerExpander,
      directionResolver
    );

    logger.debug('Initialized traversal queue', {
      queueSize: queue.size(),
    });

    while (!queue.isEmpty()) {
      if (state.hasExceededLimits(CleanDependencyTraversalStrategy.MAX_VISITED_NODES)) {
        logger.warn('Hit max visited nodes limit', state.getSize());
        break;
      }

      queue.pruneIfNeeded();

      const item = queue.getNextItem();
      if (!item) continue;

      await this.processQueueItem(
        item,
        maxDepth,
        state,
        queue,
        queries,
        depthFilter,
        fileValidation,
        directionResolver,
        containerExpander,
        parentDiscovery
      );
    }

    logger.info('Clean traversal complete', state.getSize());
    return state.getResults();
  }

  private async initializeQueue(
    currentSymbols: number[],
    symbolsBatch: Map<number, SymbolInfo>,
    queue: TraversalQueue,
    state: TraversalState,
    containerExpander: ContainerExpander,
    directionResolver: DirectionResolver
  ): Promise<void> {
    const startSymbols = await containerExpander.expandToExecutors(currentSymbols, symbolsBatch);

    const expandedSymbolsBatch = await SymbolService.getSymbolsBatch(this.db, startSymbols);

    for (const symbolId of startSymbols) {
      const symbol = expandedSymbolsBatch.get(symbolId);
      if (!symbol) continue;

      const role = classifySymbol(symbol);
      const direction = await directionResolver.resolveInitialDirection(symbol, role);

      queue.enqueue({ id: symbolId, depth: 0, direction });
      state.markVisited(symbolId);
      state.addDiscovered(symbolId, 1.0);

      if (role === SymbolRole.EXECUTOR) {
        await this.addParentContainerForEntry(
          symbolId,
          symbol,
          role,
          state,
          queue,
          directionResolver
        );
      }
    }

    for (const symbolId of currentSymbols) {
      if (state.isVisited(symbolId)) continue;

      const symbol = symbolsBatch.get(symbolId);
      if (!symbol) continue;

      const role = classifySymbol(symbol);
      const direction = getTraversalDirection(symbol, role);

      if (role === SymbolRole.CONTAINER && direction === 'backward') {
        queue.enqueue({ id: symbolId, depth: 0, direction });
        state.markVisited(symbolId);
        state.addDiscovered(symbolId, 1.0);

        if (symbol.entity_type === 'model') {
          await this.expandModelRelationships(symbolId, symbol, state, queue, containerExpander);
        }
      }
    }
  }

  private async addParentContainerForEntry(
    symbolId: number,
    symbol: SymbolInfo,
    role: SymbolRole,
    state: TraversalState,
    queue: TraversalQueue,
    directionResolver: DirectionResolver
  ): Promise<void> {
    const queries = new SymbolGraphQueries(this.db);
    const parentContainerId = await queries.getParentContainer(symbolId);
    if (!parentContainerId || state.isDiscovered(parentContainerId)) {
      return;
    }

    const parentSymbol = await SymbolService.getSymbol(this.db, parentContainerId);
    if (!parentSymbol) return;

    state.addDiscovered(parentContainerId, 1.0);
    state.markVisited(parentContainerId);

    if (parentSymbol.file_id) {
      state.addValidatedFile(parentSymbol.file_id);
    }

    const parentRole = classifySymbol(parentSymbol);
    const parentDirection = getTraversalDirection(parentSymbol, parentRole);

    if (parentRole === SymbolRole.CONTAINER && parentDirection === 'backward') {
      queue.enqueue({ id: parentContainerId, depth: 0, direction: parentDirection });
    }
  }

  private async expandModelRelationships(
    modelId: number,
    model: SymbolInfo,
    state: TraversalState,
    queue: TraversalQueue,
    containerExpander: ContainerExpander
  ): Promise<void> {
    const relationshipMethods = await containerExpander.expandToExecutors(
      [modelId],
      new Map([[modelId, model]])
    );

    for (const methodId of relationshipMethods) {
      if (state.isVisited(methodId)) continue;

      state.markVisited(methodId);
      state.addDiscovered(methodId, 1.0);
      queue.enqueue({ id: methodId, depth: 1, direction: 'forward' });
    }
  }

  private async processQueueItem(
    item: QueueItem,
    maxDepth: number,
    state: TraversalState,
    queue: TraversalQueue,
    queries: SymbolGraphQueries,
    depthFilter: DepthFilterPolicy,
    fileValidation: FileValidationPolicy,
    directionResolver: DirectionResolver,
    containerExpander: ContainerExpander,
    parentDiscovery: ParentDiscoveryHandler
  ): Promise<void> {
    const { id, depth, direction } = item;

    const symbol = await SymbolService.getSymbol(this.db, id);
    if (!symbol) return;

    const role = classifySymbol(symbol);
    const edges = await this.getEdges(id, symbol, role, direction, depth, queries);

    for (const targetId of edges) {
      if (state.isVisited(targetId)) continue;

      const targetSymbol = await SymbolService.getSymbol(this.db, targetId);
      if (!targetSymbol) continue;

      const targetRole = classifySymbol(targetSymbol);

      const shouldProcess = await this.shouldProcessTarget(
        targetSymbol,
        targetRole,
        depth,
        direction,
        state,
        depthFilter,
        fileValidation,
        queries
      );

      if (!shouldProcess) continue;

      if (targetRole === SymbolRole.CONTAINER) {
        await this.processContainer(
          targetId,
          targetSymbol,
          targetRole,
          depth,
          direction,
          maxDepth,
          state,
          queue,
          queries,
          depthFilter,
          directionResolver,
          containerExpander,
          id
        );
        continue;
      }

      if (targetRole === SymbolRole.DATA) {
        continue;
      }

      state.markVisited(targetId);
      const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
      state.addDiscovered(targetId, relevance);

      if (fileValidation.shouldAddToValidatedFiles(targetSymbol) && targetSymbol.file_id) {
        state.addValidatedFile(targetSymbol.file_id);
      }

      await parentDiscovery.discoverParentIfNeeded(
        targetId,
        targetSymbol,
        targetRole,
        depth,
        maxDepth,
        state
      );

      const nextDirection = await directionResolver.resolveNextDirection(
        direction,
        targetRole,
        targetSymbol,
        depth
      );

      queue.enqueue({ id: targetId, depth: depth + 1, direction: nextDirection });
    }
  }

  private async shouldProcessTarget(
    targetSymbol: SymbolInfo,
    targetRole: SymbolRole,
    depth: number,
    direction: TraversalDirection,
    state: TraversalState,
    depthFilter: DepthFilterPolicy,
    fileValidation: FileValidationPolicy,
    queries: SymbolGraphQueries
  ): Promise<boolean> {
    const config: DepthFilterConfig = {
      entityType: targetSymbol.entity_type,
      symbolType: targetSymbol.symbol_type,
      depth,
      direction,
      entryPointEntityType: this.entryPointEntityType,
    };

    if (depthFilter.shouldFilterEntity(config)) {
      return false;
    }

    if (targetSymbol.symbol_type === 'method' && depthFilter.shouldFilterMethod(config)) {
      const parentContainerId = await queries.getParentContainer(targetSymbol.id);
      if (parentContainerId) {
        const parentEntityType = await queries.getParentEntityType(parentContainerId);
        if (
          parentEntityType &&
          ['model', 'controller', 'service', 'request'].includes(parentEntityType)
        ) {
          return false;
        }
      }
    }

    // ARCHITECTURAL PRE-VALIDATION: For methods, check parent BEFORE file validation
    if (
      depth >= 1 &&
      targetSymbol.symbol_type === 'method' &&
      targetSymbol.file_id &&
      !state.isFileValidated(targetSymbol.file_id)
    ) {
      const parentContainerId = await queries.getParentContainer(targetSymbol.id);
      if (!parentContainerId) {
        // No parent container found, from unvalidated file - skip it
        return false;
      }

      const parentContainer = await SymbolService.getSymbol(this.db, parentContainerId);
      if (!parentContainer) {
        return false;
      }

      const isArchitecturalParent =
        parentContainer.entity_type &&
        ['controller', 'service', 'store'].includes(parentContainer.entity_type);

      if (isArchitecturalParent) {
        // Architectural method - validate parent file NOW before filtering
        if (parentContainer.file_id) {
          state.addValidatedFile(parentContainer.file_id);
        }
      } else {
        // Non-architectural method (policy, utility, model method) from unvalidated file - skip it
        return false;
      }
    }

    if (!fileValidation.shouldValidateByFile(targetSymbol, depth)) {
      return false;
    }

    return true;
  }

  private async processContainer(
    containerId: number,
    container: SymbolInfo,
    role: SymbolRole,
    depth: number,
    direction: TraversalDirection,
    maxDepth: number,
    state: TraversalState,
    queue: TraversalQueue,
    queries: SymbolGraphQueries,
    depthFilter: DepthFilterPolicy,
    directionResolver: DirectionResolver,
    containerExpander: ContainerExpander,
    sourceId: number
  ): Promise<void> {
    const config: DepthFilterConfig = {
      entityType: container.entity_type,
      symbolType: container.symbol_type,
      depth,
      direction,
      entryPointEntityType: this.entryPointEntityType,
    };

    const isSharedBoundary =
      depth > 0 &&
      container.entity_type &&
      ['store', 'service', 'controller', 'repository', 'request', 'model'].includes(
        container.entity_type
      );

    if (isSharedBoundary) {
      if (depthFilter.shouldFilterEntity(config)) {
        return;
      }

      await this.handleSharedArchitecturalBoundary(
        containerId,
        container,
        depth,
        direction,
        maxDepth,
        state,
        queue,
        depthFilter,
        directionResolver
      );
      return;
    }

    if (depth === 0 && direction === 'forward') {
      await this.expandContainerForward(
        containerId,
        container,
        depth,
        direction,
        maxDepth,
        state,
        queue,
        containerExpander
      );
      return;
    }

    if (
      depth === 0 &&
      direction === 'both' &&
      container.entity_type &&
      ['model', 'request', 'controller', 'service', 'store', 'component'].includes(
        container.entity_type
      )
    ) {
      await this.handleDepthZeroBothDirection(
        containerId,
        container,
        depth,
        direction,
        maxDepth,
        state,
        queue,
        depthFilter,
        directionResolver
      );
      return;
    }

    if (direction === 'backward' || direction === 'both') {
      await this.handleBackwardContainer(
        containerId,
        container,
        depth,
        direction,
        maxDepth,
        state,
        queue,
        queries,
        directionResolver,
        sourceId
      );
      return;
    }

    state.markVisited(containerId);
    const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
    state.addDiscovered(containerId, relevance);
  }

  private async handleSharedArchitecturalBoundary(
    containerId: number,
    container: SymbolInfo,
    depth: number,
    direction: TraversalDirection,
    maxDepth: number,
    state: TraversalState,
    queue: TraversalQueue,
    depthFilter: DepthFilterPolicy,
    directionResolver: DirectionResolver
  ): Promise<void> {
    state.markVisited(containerId);
    const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
    state.addDiscovered(containerId, relevance);

    if (container.file_id) {
      state.addValidatedFile(container.file_id);
    }

    if (container.entity_type === 'request') {
      return;
    }

    if (container.entity_type === 'model') {
      const config: DepthFilterConfig = {
        entityType: container.entity_type,
        symbolType: container.symbol_type,
        depth,
        direction,
        entryPointEntityType: this.entryPointEntityType,
      };

      if (depthFilter.shouldAllowDeepModelQueuing(config)) {
        queue.enqueue({ id: containerId, depth: depth + 1, direction: 'backward' });
      }
      return;
    }

    const nextDirection = await directionResolver.resolveNextDirection(
      direction,
      SymbolRole.CONTAINER,
      container,
      depth
    );
    queue.enqueue({ id: containerId, depth: depth + 1, direction: nextDirection });
  }

  private async expandContainerForward(
    containerId: number,
    container: SymbolInfo,
    depth: number,
    direction: TraversalDirection,
    maxDepth: number,
    state: TraversalState,
    queue: TraversalQueue,
    containerExpander: ContainerExpander
  ): Promise<void> {

    const executors = await containerExpander.expandToExecutors(
      [containerId],
      new Map([[containerId, container]])
    );

    for (const executorId of executors) {
      if (state.isVisited(executorId)) continue;

      state.markVisited(executorId);
      const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
      state.addDiscovered(executorId, relevance);
      queue.enqueue({ id: executorId, depth: depth + 1, direction });
    }
  }

  private async handleDepthZeroBothDirection(
    containerId: number,
    container: SymbolInfo,
    depth: number,
    direction: TraversalDirection,
    maxDepth: number,
    state: TraversalState,
    queue: TraversalQueue,
    depthFilter: DepthFilterPolicy,
    directionResolver: DirectionResolver
  ): Promise<void> {
    state.markVisited(containerId);
    const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
    state.addDiscovered(containerId, relevance);

    if (container.file_id) {
      state.addValidatedFile(container.file_id);
    }

    if (container.entity_type === 'request') {
      return;
    }

    if (container.entity_type === 'model') {
      const isModelEntryContext = this.entryPointEntityType === 'model';
      if (isModelEntryContext) {
        queue.enqueue({ id: containerId, depth: depth + 1, direction: 'backward' });
      }
      return;
    }

    const nextDirection = await directionResolver.resolveNextDirection(
      'forward',
      SymbolRole.CONTAINER,
      container,
      depth
    );
    queue.enqueue({ id: containerId, depth: depth + 1, direction: nextDirection });
  }

  private async handleBackwardContainer(
    containerId: number,
    container: SymbolInfo,
    depth: number,
    direction: TraversalDirection,
    maxDepth: number,
    state: TraversalState,
    queue: TraversalQueue,
    queries: SymbolGraphQueries,
    directionResolver: DirectionResolver,
    sourceId: number
  ): Promise<void> {
    const relevantMethods = await queries.findMethodsReferencingSymbol(containerId, sourceId);

    if (relevantMethods.length === 0) {
      state.markVisited(containerId);
      return;
    }

    const methodDirection = directionResolver.resolveMethodDirection(container, direction, depth);

    for (const methodId of relevantMethods) {
      if (state.isVisited(methodId)) continue;

      state.markVisited(methodId);
      const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
      state.addDiscovered(methodId, relevance);
      queue.enqueue({ id: methodId, depth: depth + 1, direction: methodDirection });
    }
  }

  private async getEdges(
    symbolId: number,
    symbol: SymbolInfo,
    role: SymbolRole,
    direction: TraversalDirection,
    depth: number,
    queries: SymbolGraphQueries
  ): Promise<number[]> {
    const edges: number[] = [];

    if (direction === 'forward' || direction === 'both') {
      const forwardEdges = await queries.getForwardEdges(symbolId, role, symbol, depth);
      edges.push(...forwardEdges);
    }

    // Backward traversal - who executes this symbol
    // SYMBOL-TYPE-AWARE BACKWARD TRAVERSAL for 'both' direction
    // Purely backward direction: always process backward edges
    // Both direction - type-aware thresholds:
    //   - Models/composables: allow backward at any depth (discover controllers/policies that use them)
    //   - Methods/functions: allow backward only at depth < 2 (prevents service method caller explosion)
    const isModelOrComposable =
      symbol.entity_type === 'model' || symbol.entity_type === 'composable';
    const shouldProcessBackward =
      direction === 'backward' || (direction === 'both' && (isModelOrComposable || depth < 2));

    if (shouldProcessBackward) {
      const backwardEdges = await queries.getBackwardEdges(symbolId, role, symbol);
      edges.push(...backwardEdges);
    }

    return [...new Set(edges)];
  }
}
