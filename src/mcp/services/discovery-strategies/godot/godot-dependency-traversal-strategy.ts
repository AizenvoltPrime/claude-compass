/**
 * Godot Dependency Traversal Strategy (Refactored)
 *
 * Executor-centric BFS traversal with pollution prevention for Godot game architecture.
 * Follows C# dependency graph (calls, contains, references, signal_connection)
 * with depth filtering and file validation to prevent shared utility pollution.
 *
 * Key improvements over original:
 * - BFS queue-based traversal (not iteration-based)
 * - Depth-based filtering to prevent deep transitive pollution
 * - File validation to exclude utility classes and shared infrastructure
 * - Architectural pre-validation for methods
 */

import type { Knex } from 'knex';
import * as SymbolService from '../../../../database/services/symbol-service';
import { createComponentLogger } from '../../../../utils/logger';
import {
  DiscoveryStrategy,
  DiscoveryContext,
  DiscoveryResult,
} from '../common/types';
import {
  GodotSymbolInfo,
  GodotSymbolRole,
  GodotTraversalDirection,
  classifyGodotSymbol,
  getGodotTraversalDirection,
} from './symbol-classifier';
import { GodotTraversalState } from './traversal-state';
import { GodotTraversalQueue, GodotQueueItem } from './traversal-queue';
import { GodotSymbolGraphQueries } from './symbol-graph-queries';
import { GodotDepthFilterPolicy, GodotDepthFilterConfig } from './depth-filter-policy';
import { GodotFileValidationPolicy } from './file-validation-policy';

const logger = createComponentLogger('godot-dependency-traversal');

export class GodotDependencyTraversalStrategy implements DiscoveryStrategy {
  readonly name = 'godot-dependency-traversal';
  readonly description = 'Clean executor-centric BFS traversal with pollution prevention';
  readonly priority = 10;

  private static readonly MAX_VISITED_NODES = 50000;
  private static readonly MAX_QUEUE_SIZE = 10000;

  private entryPointEntityType?: string;

  constructor(private db: Knex) {}

  /**
   * Only run on first iteration (iteration 0).
   * This strategy does comprehensive BFS traversal.
   */
  async shouldRun(context: DiscoveryContext): Promise<boolean> {
    return context.iteration === 0;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { entryPointId, currentSymbols, options } = context;
    const maxDepth = options.maxDepth;

    logger.info('Starting Godot BFS traversal with pollution prevention', {
      entryPoint: entryPointId,
      maxDepth,
      currentSymbols: currentSymbols.length,
    });

    const state = new GodotTraversalState();
    const queue = new GodotTraversalQueue(
      GodotDependencyTraversalStrategy.MAX_QUEUE_SIZE,
      maxDepth
    );

    const queries = new GodotSymbolGraphQueries(this.db);
    const depthFilter = new GodotDepthFilterPolicy();
    const fileValidation = new GodotFileValidationPolicy(state);

    // Get entry point to determine traversal context
    const entrySymbol = await SymbolService.getSymbol(this.db, entryPointId);
    this.entryPointEntityType = entrySymbol?.entity_type;

    // Initialize queue with starting symbols
    const symbolsBatch = await SymbolService.getSymbolsBatch(this.db, currentSymbols);
    state.initializeFromSymbols(symbolsBatch);

    await this.initializeQueue(currentSymbols, symbolsBatch, queue, state, queries);

    // BFS traversal
    while (!queue.isEmpty()) {
      if (state.hasExceededLimits(GodotDependencyTraversalStrategy.MAX_VISITED_NODES)) {
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
        fileValidation
      );
    }

    logger.info('Godot traversal complete', state.getSize());
    return state.getResults();
  }

  /**
   * Initialize BFS queue with starting symbols.
   * Expands containers to executors, handles both directions.
   */
  private async initializeQueue(
    currentSymbols: number[],
    symbolsBatch: Map<number, GodotSymbolInfo>,
    queue: GodotTraversalQueue,
    state: GodotTraversalState,
    queries: GodotSymbolGraphQueries
  ): Promise<void> {
    // Expand containers to executors first
    const startSymbols = await this.expandContainersToExecutors(
      currentSymbols,
      symbolsBatch,
      queries
    );

    const expandedSymbolsBatch = await SymbolService.getSymbolsBatch(this.db, startSymbols);

    for (const symbolId of startSymbols) {
      const symbol = expandedSymbolsBatch.get(symbolId);
      if (!symbol) continue;

      const role = classifyGodotSymbol(symbol);
      const direction = getGodotTraversalDirection(symbol, role);

      queue.enqueue({ id: symbolId, depth: 0, direction });
      state.markVisited(symbolId);
      state.addDiscovered(symbolId, 1.0);

      // Add parent container for executors (to include the containing class)
      if (role === 'EXECUTOR') {
        await this.addParentContainerForEntry(symbolId, state, queries);
      }
    }

    // Handle backward containers (nodes, resources)
    for (const symbolId of currentSymbols) {
      if (state.isVisited(symbolId)) continue;

      const symbol = symbolsBatch.get(symbolId);
      if (!symbol) continue;

      const role = classifyGodotSymbol(symbol);
      const direction = getGodotTraversalDirection(symbol, role);

      if (role === 'CONTAINER' && direction === 'backward') {
        queue.enqueue({ id: symbolId, depth: 0, direction });
        state.markVisited(symbolId);
        state.addDiscovered(symbolId, 1.0);
      }
    }
  }

  /**
   * Expand containers to their executor methods.
   */
  private async expandContainersToExecutors(
    symbolIds: number[],
    symbolsBatch: Map<number, GodotSymbolInfo>,
    queries: GodotSymbolGraphQueries
  ): Promise<number[]> {
    const result: number[] = [];

    for (const symbolId of symbolIds) {
      const symbol = symbolsBatch.get(symbolId);
      if (!symbol) continue;

      const role = classifyGodotSymbol(symbol);
      if (role === 'EXECUTOR') {
        result.push(symbolId);
      } else if (role === 'CONTAINER') {
        const executors = await queries.expandToExecutors(symbolId);
        result.push(...executors);
        result.push(symbolId);
      }
    }

    return result;
  }

  /**
   * Add parent container for entry point executors.
   * This ensures we include the containing class in discovery.
   */
  private async addParentContainerForEntry(
    symbolId: number,
    state: GodotTraversalState,
    queries: GodotSymbolGraphQueries
  ): Promise<void> {
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
  }

  /**
   * Process a single queue item during BFS traversal.
   */
  private async processQueueItem(
    item: GodotQueueItem,
    maxDepth: number,
    state: GodotTraversalState,
    queue: GodotTraversalQueue,
    queries: GodotSymbolGraphQueries,
    depthFilter: GodotDepthFilterPolicy,
    fileValidation: GodotFileValidationPolicy
  ): Promise<void> {
    const { id, depth, direction } = item;

    const symbol = await SymbolService.getSymbol(this.db, id);
    if (!symbol) return;

    const role = classifyGodotSymbol(symbol);
    const edges = await this.getEdges(id, symbol, role, direction, depth, queries);

    for (const targetId of edges) {
      if (state.isVisited(targetId)) continue;

      const targetSymbol = await SymbolService.getSymbol(this.db, targetId);
      if (!targetSymbol) continue;

      const targetRole = classifyGodotSymbol(targetSymbol);

      const shouldProcess = await this.shouldProcessTarget(
        targetSymbol,
        targetRole,
        depth,
        direction,
        state,
        depthFilter,
        fileValidation,
        queries,
        symbol
      );

      if (!shouldProcess) continue;

      // Handle containers
      if (targetRole === 'CONTAINER') {
        logger.debug(`[CONTAINER DISCOVERY] ${targetSymbol.name} (id=${targetId}) at depth=${depth} via edge from ${symbol.name}`);
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
          depthFilter
        );
        continue;
      }

      // Skip data symbols
      if (targetRole === 'DATA') {
        continue;
      }

      // Add executor/entity to discovered
      state.markVisited(targetId);
      const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
      logger.debug(`[EXECUTOR DISCOVERY] ${targetSymbol.name} (id=${targetId}, role=${targetRole}) at depth=${depth} from ${symbol.name}, relevance=${relevance.toFixed(3)}`);
      state.addDiscovered(targetId, relevance);

      if (fileValidation.shouldAddToValidatedFiles(targetSymbol) && targetSymbol.file_id) {
        state.addValidatedFile(targetSymbol.file_id);
      }

      // Add parent container if needed
      await this.addParentForDiscoveredMethod(
        targetId,
        targetSymbol,
        targetRole,
        depth,
        maxDepth,
        state,
        queries
      );

      // Continue traversal
      const nextDirection = this.resolveNextDirection(direction, targetRole, targetSymbol, depth);
      queue.enqueue({ id: targetId, depth: depth + 1, direction: nextDirection });
    }
  }

  /**
   * Should process this target symbol?
   * Applies depth filtering and file validation.
   */
  private async shouldProcessTarget(
    targetSymbol: GodotSymbolInfo,
    targetRole: GodotSymbolRole,
    depth: number,
    direction: GodotTraversalDirection,
    state: GodotTraversalState,
    depthFilter: GodotDepthFilterPolicy,
    fileValidation: GodotFileValidationPolicy,
    queries: GodotSymbolGraphQueries,
    _sourceSymbol?: GodotSymbolInfo
  ): Promise<boolean> {
    const config: GodotDepthFilterConfig = {
      entityType: targetSymbol.entity_type,
      symbolType: targetSymbol.symbol_type,
      depth,
      direction,
      entryPointEntityType: this.entryPointEntityType,
    };

    // Apply depth filtering
    if (depthFilter.shouldFilterEntity(config)) {
      return false;
    }

    // Filter methods from non-architectural parents
    if (targetSymbol.symbol_type === 'method' && depthFilter.shouldFilterMethod(config)) {
      const parentContainerId = await queries.getParentContainer(targetSymbol.id);
      if (parentContainerId) {
        const parentEntityType = await queries.getParentEntityType(parentContainerId);
        if (
          parentEntityType &&
          ['node', 'handler', 'manager', 'coordinator', 'controller', 'service'].includes(
            parentEntityType
          )
        ) {
          return false;
        }
      }
    }

    // Architectural pre-validation for methods from unvalidated files
    if (
      depth >= 1 &&
      targetSymbol.symbol_type === 'method' &&
      targetSymbol.file_id &&
      !state.isFileValidated(targetSymbol.file_id)
    ) {
      const parentContainerId = await queries.getParentContainer(targetSymbol.id);
      if (!parentContainerId) {
        return false; // No parent = utility method
      }

      const parentContainer = await SymbolService.getSymbol(this.db, parentContainerId);
      if (!parentContainer) {
        return false;
      }

      // CRITICAL: Only feature-specific entities are architectural
      // Unlike Vue-Laravel where services are feature-scoped,
      // Godot has global singleton managers/services that span features.
      // These must be excluded to prevent pollution
      const isArchitecturalParent =
        parentContainer.entity_type &&
        ['handler', 'event_channel'].includes(parentContainer.entity_type);

      if (isArchitecturalParent) {
        // Validate parent file
        if (parentContainer.file_id) {
          state.addValidatedFile(parentContainer.file_id);
        }
      } else {
        // Non-architectural method (manager, service, utility) - skip it
        return false;
      }
    }

    // File validation
    if (!fileValidation.shouldValidateByFile(targetSymbol, depth)) {
      return false;
    }

    return true;
  }

  /**
   * Process container symbol.
   */
  private async processContainer(
    containerId: number,
    container: GodotSymbolInfo,
    _role: GodotSymbolRole,
    depth: number,
    direction: GodotTraversalDirection,
    maxDepth: number,
    state: GodotTraversalState,
    queue: GodotTraversalQueue,
    queries: GodotSymbolGraphQueries,
    depthFilter: GodotDepthFilterPolicy
  ): Promise<void> {
    const config: GodotDepthFilterConfig = {
      entityType: container.entity_type,
      symbolType: container.symbol_type,
      depth,
      direction,
      entryPointEntityType: this.entryPointEntityType,
    };

    // Check if it's a shared boundary (manager, service, controller, etc.)
    const isSharedBoundary =
      depth > 0 &&
      container.entity_type &&
      ['manager', 'coordinator', 'controller', 'service', 'node', 'resource'].includes(
        container.entity_type
      );

    if (isSharedBoundary && depthFilter.shouldFilterEntity(config)) {
      return; // Filter deep shared boundaries
    }

    state.markVisited(containerId);
    const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
    state.addDiscovered(containerId, relevance);

    if (container.file_id) {
      state.addValidatedFile(container.file_id);
    }

    // Queue for further traversal if not too deep
    if (
      isSharedBoundary &&
      container.entity_type !== 'resource' &&
      !depthFilter.shouldFilterEntity({ ...config, depth: depth + 1 })
    ) {
      const nextDirection = this.resolveNextDirection(direction, GodotSymbolRole.CONTAINER, container, depth);
      queue.enqueue({ id: containerId, depth: depth + 1, direction: nextDirection });
    }
  }

  /**
   * Add parent container for discovered method.
   */
  private async addParentForDiscoveredMethod(
    methodId: number,
    method: GodotSymbolInfo,
    role: GodotSymbolRole,
    depth: number,
    maxDepth: number,
    state: GodotTraversalState,
    queries: GodotSymbolGraphQueries
  ): Promise<void> {
    if (role !== 'EXECUTOR' || method.symbol_type !== 'method') {
      return;
    }

    const parentContainerId = await queries.getParentContainer(methodId);
    if (!parentContainerId || state.isDiscovered(parentContainerId)) {
      return;
    }

    const parentSymbol = await SymbolService.getSymbol(this.db, parentContainerId);
    if (!parentSymbol) return;

    const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
    state.addDiscovered(parentContainerId, relevance);
    state.markVisited(parentContainerId);

    if (parentSymbol.file_id) {
      state.addValidatedFile(parentSymbol.file_id);
    }
  }

  /**
   * Get edges for traversal.
   */
  private async getEdges(
    symbolId: number,
    symbol: GodotSymbolInfo,
    role: GodotSymbolRole,
    direction: GodotTraversalDirection,
    depth: number,
    queries: GodotSymbolGraphQueries
  ): Promise<number[]> {
    const edges: number[] = [];

    // Forward traversal
    if (direction === 'forward' || direction === 'both') {
      const forwardEdges = await queries.getForwardEdges(symbolId, role, symbol, depth);
      edges.push(...forwardEdges);
    }

    // Backward traversal
    if (direction === 'backward' || direction === 'both') {
      const backwardEdges = await queries.getBackwardEdges(symbolId, role, symbol);
      edges.push(...backwardEdges);
    }

    return [...new Set(edges)];
  }

  /**
   * Resolve next traversal direction.
   */
  private resolveNextDirection(
    currentDirection: GodotTraversalDirection,
    targetRole: GodotSymbolRole,
    targetSymbol: GodotSymbolInfo,
    depth: number
  ): GodotTraversalDirection {
    // Nodes/resources always go backward (discover callers)
    if (targetSymbol.entity_type === 'node' || targetSymbol.entity_type === 'resource') {
      return 'backward';
    }

    // Handlers/controllers go forward (discover callees)
    if (targetSymbol.entity_type === 'handler' || targetSymbol.entity_type === 'controller') {
      return 'forward';
    }

    // Services/managers/coordinators go both directions
    if (
      targetSymbol.entity_type === 'service' ||
      targetSymbol.entity_type === 'manager' ||
      targetSymbol.entity_type === 'coordinator'
    ) {
      return 'both';
    }

    // Default: inherit from current direction
    return currentDirection;
  }
}
