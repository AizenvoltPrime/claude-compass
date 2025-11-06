/**
 * Clean Dependency Traversal Strategy
 *
 * Executor-centric BFS traversal following actual execution paths.
 * No semantic filtering, no file-level context, pure graph traversal.
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

const logger = createComponentLogger('dependency-traversal-clean');

interface QueueItem {
  id: number;
  depth: number;
  direction: TraversalDirection;
}

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

    const entrySymbol = await SymbolService.getSymbol(this.db,context.entryPointId);
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

    const discovered = new Map<number, number>();
    const visited = new Set<number>();
    const validatedFileIds = new Set<number>(); // Track files containing validated entities

    // Load entry point symbols
    const symbolsBatch = await SymbolService.getSymbolsBatch(this.db, currentSymbols);

    // Store entry point entity type for context-aware filtering
    const entrySymbol = await SymbolService.getSymbol(this.db, entryPointId);
    this.entryPointEntityType = entrySymbol?.entity_type;

    // Initialize validated files with entry point files
    for (const [_, symbol] of symbolsBatch) {
      if (symbol?.file_id) {
        validatedFileIds.add(symbol.file_id);
      }
    }

    // Expand containers to executors at start
    const startSymbols = await this.expandToExecutors(currentSymbols, symbolsBatch);

    // Fetch expanded executor symbols (critical: expanded symbols not in original batch)
    const expandedSymbolsBatch = await SymbolService.getSymbolsBatch(this.db, startSymbols);

    // Determine initial direction for each start symbol
    const queue: QueueItem[] = [];
    for (const symbolId of startSymbols) {
      const symbol = expandedSymbolsBatch.get(symbolId);
      if (!symbol) continue;

      const role = classifySymbol(symbol);
      let direction = getTraversalDirection(symbol, role);

      // PARENT-AWARE DIRECTION FOR ENTRY POINTS: Methods need parent context for accurate direction
      // Entry point service methods get 'both' direction to discover callers + models
      // Transitively discovered service methods use natural 'forward' direction from getTraversalDirection()
      // This prevents shared infrastructure (BaseService methods) from discovering all services
      if (role === SymbolRole.EXECUTOR && symbol.symbol_type === 'method') {
        const parentEntityType = await this.getParentContainerEntityType(symbolId);
        if (parentEntityType === 'service') {
          // Entry point service methods are bidirectional bridges between controllers and models
          direction = 'both';
        }
      }

      queue.push({ id: symbolId, depth: 0, direction });
      visited.add(symbolId);
      discovered.set(symbolId, 1.0);

      // Discover parent container for entry point executors (controller/service methods)
      // Ensures parent class is included when starting from a method
      if (role === SymbolRole.EXECUTOR) {
        const parentContainerId = await this.getParentContainer(symbolId);
        if (parentContainerId && !discovered.has(parentContainerId)) {
          const parentSymbol = await SymbolService.getSymbol(this.db, parentContainerId);
          if (parentSymbol) {
            discovered.set(parentContainerId, 1.0);
            visited.add(parentContainerId);
            // Validate parent file for method discovery
            if (parentSymbol.file_id) {
              validatedFileIds.add(parentSymbol.file_id);
            }

            // CRITICAL: If parent needs backward traversal (e.g., models discovering callers), queue it
            // This fixes the regression where models as entry points don't discover services/controllers
            const parentRole = classifySymbol(parentSymbol);
            const parentDirection = getTraversalDirection(parentSymbol, parentRole);
            if (parentRole === SymbolRole.CONTAINER && parentDirection === 'backward') {
              queue.push({ id: parentContainerId, depth: 0, direction: parentDirection });
            }
          }
        }
      }
    }

    // CRITICAL: Also queue original containers that need backward traversal
    // Models are containers but need to discover their callers (services/controllers)
    for (const symbolId of currentSymbols) {
      if (visited.has(symbolId)) continue; // Already added via expansion

      const symbol = symbolsBatch.get(symbolId);
      if (!symbol) continue;

      const role = classifySymbol(symbol);
      const direction = getTraversalDirection(symbol, role);

      // Only add containers that traverse backward (models, backend entities)
      if (role === SymbolRole.CONTAINER && direction === 'backward') {
        queue.push({ id: symbolId, depth: 0, direction });
        visited.add(symbolId);
        discovered.set(symbolId, 1.0);

        // MODELS: Expand to relationship methods to discover related models
        // This enables discovery of related models through relationship methods
        if (symbol.entity_type === 'model') {
          const relationshipMethods = await this.expandToExecutors(
            [symbolId],
            new Map([[symbolId, symbol]])
          );

          for (const methodId of relationshipMethods) {
            if (visited.has(methodId)) continue;

            visited.add(methodId);
            discovered.set(methodId, 1.0);
            // Relationship methods traverse forward to discover referenced models
            queue.push({ id: methodId, depth: 1, direction: 'forward' });
          }
        }
      }
    }

    logger.debug('Initialized traversal queue', {
      startSymbols: startSymbols.length,
      queueSize: queue.length,
    });

    // BFS traversal
    while (queue.length > 0) {
      // Safety checks
      if (visited.size > CleanDependencyTraversalStrategy.MAX_VISITED_NODES) {
        logger.warn('Hit max visited nodes limit', { visitedCount: visited.size });
        break;
      }

      if (queue.length > CleanDependencyTraversalStrategy.MAX_QUEUE_SIZE) {
        logger.warn('Queue size exceeded, pruning', { queueSize: queue.length });
        queue.sort((a, b) => a.depth - b.depth);
        queue.splice(CleanDependencyTraversalStrategy.MAX_QUEUE_SIZE);
      }

      const { id, depth, direction } = queue.shift()!;

      if (depth >= maxDepth) continue;

      const symbol = await SymbolService.getSymbol(this.db,id);
      if (!symbol) continue;

      const role = classifySymbol(symbol);

      // Get edges based on role, direction, and depth
      const edges = await this.getEdges(id, symbol, role, direction, depth);

      // Process each edge
      for (const targetId of edges) {
        if (visited.has(targetId)) continue;

        const targetSymbol = await SymbolService.getSymbol(this.db,targetId);
        if (!targetSymbol) continue;

        const targetRole = classifySymbol(targetSymbol);

        // CONTAINERS don't get added - expand them to executors instead
        if (targetRole === SymbolRole.CONTAINER) {
          // ARCHITECTURAL BOUNDARY CHECK: Shared stores/services/requests/models at depth > 0 shouldn't expand to methods
          // Services/controllers discover their architectural imports (requests, models)
          // Requests are leaf nodes (no interesting imports beyond FormRequest)
          // Models discovered as architectural entities (not expanded to methods like relationships/accessors)
          const sharedArchitecturalBoundaries = ['store', 'service', 'controller', 'repository', 'request', 'model'];
          if (depth > 0 && targetSymbol.entity_type && sharedArchitecturalBoundaries.includes(targetSymbol.entity_type)) {
            // DEPTH FILTERING FOR SHARED ARCHITECTURAL BOUNDARIES
            // Different thresholds for different entity types to prevent pollution
            // Models: Allow at depth 2 (discovery through service methods)
            // Services: Block at depth 2+ (prevent base class pollution)
            // Controllers/Others: Block at depth 2+ in forward (prevent deep chains)
            // Backward: Allow up to depth 3 for all types (full caller discovery)
            let entityDepthThreshold: number;
            if (direction === 'forward') {
              // Forward direction: models allowed deeper, services blocked earlier
              entityDepthThreshold = targetSymbol.entity_type === 'model' ? 3 : 2;
            } else {
              // Backward direction: uniform threshold
              entityDepthThreshold = 4;
            }

            if (depth >= entityDepthThreshold) {
              // Too deep for this direction - skip to prevent pollution
              continue;
            }

            // Discover the entity itself and queue for forward-only traversal to find imports
            // Don't expand to methods, don't traverse backward
            visited.add(targetId);
            const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
            discovered.set(targetId, relevance);

            // Add file to validated set
            if (targetSymbol.file_id) {
              validatedFileIds.add(targetSymbol.file_id);
            }

            // Queue for traversal to discover architectural imports and callers
            // REQUESTS: True leaf nodes - don't queue (prevents validation methods)
            // MODELS: Queue for backward traversal only (find callers like controllers/services)
            //         Don't queue forward (prevents relationship methods)
            // OTHERS: Queue forward to discover their imports
            if (targetSymbol.entity_type === 'request') {
              // Request is true leaf - don't queue at all
            } else if (targetSymbol.entity_type === 'model') {
              // Model: queue backward only to find controllers/services that use it
              // CONTEXT-AWARE DEPTH LIMIT:
              // depth=0: entry point model methods → queue model backward
              // depth<=2 + model entry: related models from relationships → queue backward
              // depth>=1 + non-model entry: models from forward execution → blocked
              const isModelEntryContext = this.entryPointEntityType === 'model';
              const allowDeepModelQueuing = isModelEntryContext && depth <= 2;
              if (depth < 1 || allowDeepModelQueuing) {
                queue.push({ id: targetId, depth: depth + 1, direction: 'backward' });
              }
            } else {
              // Service/controller/store: queue forward to discover imports
              const forwardDirection = await this.getNextDirection('forward', targetRole, targetSymbol, depth);
              queue.push({ id: targetId, depth: depth + 1, direction: forwardDirection });
            }
            continue;
          } else if (depth === 0 && direction === 'forward') {
            // Entry point forward: expand to all executors
            const executors = await this.expandToExecutors(
              [targetId],
              new Map([[targetId, targetSymbol]])
            );

            for (const executorId of executors) {
              if (visited.has(executorId)) continue;

              visited.add(executorId);
              const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
              discovered.set(executorId, relevance);
              queue.push({ id: executorId, depth: depth + 1, direction });
            }
            continue; // Don't fall through - we expanded to methods
          } else if (depth === 0 && direction === 'both' && targetSymbol.entity_type && ['model', 'request', 'controller', 'service', 'store', 'component'].includes(targetSymbol.entity_type)) {
            // DEPTH=0 + DIRECTION=BOTH: Architectural entities discovered by entry point
            // These are forward discoveries (entry point references model/request via dependencies)
            // Add them to discovered - don't process by backward logic which looks for methods
            // Example: Service method (both) → Model (references)
            //   Model should be discovered, not searched for methods referencing the service method
            visited.add(targetId);
            const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
            discovered.set(targetId, relevance);

            // Add file to validated set
            if (targetSymbol.file_id) {
              validatedFileIds.add(targetSymbol.file_id);
            }

            // Queue for traversal based on entity type
            if (targetSymbol.entity_type === 'request') {
              // Request is true leaf - don't queue
            } else if (targetSymbol.entity_type === 'model') {
              // Model: queue backward ONLY if entry point is a model
              // For service/controller entry points, models are leaf dependencies (don't traverse backward)
              // This prevents discovering all services that use the model (pollution)
              // Example: Service entry point → Model → DON'T discover all services using that model
              const isModelEntryContext = this.entryPointEntityType === 'model';
              if (isModelEntryContext) {
                queue.push({ id: targetId, depth: depth + 1, direction: 'backward' });
              }
              // If not model entry context, model is discovered but not queued (leaf dependency)
            } else {
              // Service/controller/store: queue forward to discover imports
              const forwardDirection = await this.getNextDirection('forward', targetRole, targetSymbol, depth);
              queue.push({ id: targetId, depth: depth + 1, direction: forwardDirection });
            }
            continue;
          } else if (direction === 'backward' || direction === 'both') {
            // Backward traversal: find which methods of this container reference the source
            // This prevents discovering entire controllers/services when only one method is relevant
            const relevantMethods = await this.findMethodsReferencingSymbol(targetId, id);

            if (relevantMethods.length > 0) {
              // Determine direction for methods based on container depth and entity type
              // Container is at depth + 1, methods are at depth + 2
              // Service container at depth 1 (from model@0): methods use 'both' to discover models + controllers
              // Service container at depth 2+: methods use 'forward' only to prevent pollution
              // Model methods at depth > 0: always 'forward' (models are shared architectural entities)
              let methodDirection: TraversalDirection = direction;

              if (targetSymbol.entity_type === 'service') {
                // Check container's actual depth (depth + 1), not parent's depth
                const containerDepth = depth + 1;
                if (containerDepth === 1) {
                  methodDirection = 'both'; // Bridge to controllers and discover models
                } else if (containerDepth > 1) {
                  methodDirection = 'forward'; // Prevent pollution
                }
              } else if (depth > 0 && targetSymbol.entity_type === 'model') {
                methodDirection = 'forward'; // Shared models always forward
              }

              for (const methodId of relevantMethods) {
                if (visited.has(methodId)) continue;

                visited.add(methodId);
                const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
                discovered.set(methodId, relevance);
                queue.push({ id: methodId, depth: depth + 1, direction: methodDirection });
              }
            } else {
              // No specific methods found, mark container as visited but don't discover it
              visited.add(targetId);
            }
            continue; // Don't fall through - we handled backward expansion
          } else {
            // Forward traversal beyond entry point: mark container as visited but don't expand to methods
            visited.add(targetId);
            discovered.set(targetId, 1.0 - (depth + 1) / (maxDepth + 1));
            continue; // Don't fall through
          }
        }

        // DATA symbols don't get traversed or added
        if (targetRole === SymbolRole.DATA) {
          continue;
        }

        // Execution boundary: Stop at architectural entities (stores, services, controllers)
        // These act as module boundaries - we discover them but don't traverse through them
        // NOTE: Models are NOT included - they need backward traversal to find services/controllers
        const architecturalBoundaries = ['store', 'service', 'controller', 'repository'];
        if (targetSymbol.entity_type && architecturalBoundaries.includes(targetSymbol.entity_type)) {
          // DEPTH FILTERING FOR ARCHITECTURAL BOUNDARIES
          // Apply direction-aware depth filtering before discovering the entity
          // This prevents pollution from deep backward references at depth 3+
          // Forward: depth >= 2 blocks targets at 3+ (prevents pollution)
          // Backward: depth >= 4 blocks targets at 4+ (allows legitimate caller discovery)
          const entityDepthThreshold = direction === 'forward' ? 2 : 4;
          if (depth >= entityDepthThreshold) {
            // Too deep for this direction - skip to prevent pollution
            continue;
          }

          // Add file to validated set (allows methods from this file)
          if (targetSymbol.file_id) {
            validatedFileIds.add(targetSymbol.file_id);
          }

          // Add to discovered but don't traverse further
          visited.add(targetId);
          const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
          discovered.set(targetId, relevance);
          continue;
        }

        // FILE-LEVEL CONTEXT FILTERING at depth > 1
        // Only include symbols from files containing validated entities
        // Entity types (stores, services, controllers, components, requests, composables)
        // have their own validation and are exempt from file-level filtering
        // Models are NOT auto-validated - they must be at shallow depth or relevant to the feature
        const validatedEntityTypes = ['store', 'service', 'controller', 'component', 'request', 'composable'];
        const isValidatedEntity = targetSymbol.entity_type && validatedEntityTypes.includes(targetSymbol.entity_type);

        // DIRECTION-AWARE ENTITY FILTERING: Asymmetric thresholds for forward vs backward
        // Forward: depth >= 2 blocks targets at 3+ (prevents pollution from execution chains)
        // Backward: depth >= 4 blocks targets at 4+ (allows full caller chain discovery)
        // This prevents pollution while allowing full backward caller discovery
        // Note: depth is parent's depth, target is at depth + 1
        const deepEntityTypes = ['model', 'controller', 'service', 'request'];
        const entityDepthThreshold = direction === 'forward' ? 2 : 4;
        if (targetSymbol.entity_type && deepEntityTypes.includes(targetSymbol.entity_type) && depth >= entityDepthThreshold) {
          continue;
        }

        // DIRECTION-AWARE METHOD FILTERING: Filter methods by parent container type
        // Methods have entity_type="method", so they bypass entity filtering above
        // Check parent container to filter controller/service methods at deep depths
        // Uses same asymmetric threshold: forward >= 2, backward >= 4
        if (targetSymbol.symbol_type === 'method' && depth >= entityDepthThreshold) {
          const parentContainerId = await this.getParentContainer(targetId);
          if (parentContainerId) {
            const parentContainer = await SymbolService.getSymbol(this.db, parentContainerId);
            if (parentContainer?.entity_type && ['controller', 'service'].includes(parentContainer.entity_type)) {
              // Deep controller/service method - skip to prevent pollution
              continue;
            }
          }
        }

        // ARCHITECTURAL PRE-VALIDATION: For methods, validate parent file BEFORE filtering
        // This solves chicken-and-egg: controller methods discovered before parent class
        // Only pre-validate architectural containers (controller, service, store) to avoid pollution
        // Policy/utility class methods still get filtered (prevents delete, toArray pollution)
        if (depth >= 1 && targetSymbol.symbol_type === 'method' && targetSymbol.file_id && !validatedFileIds.has(targetSymbol.file_id)) {
          const parentContainerId = await this.getParentContainer(targetId);
          if (parentContainerId) {
            const parentContainer = await SymbolService.getSymbol(this.db,parentContainerId);
            if (parentContainer?.entity_type && ['controller', 'service', 'store'].includes(parentContainer.entity_type)) {
              // Architectural method - validate parent file NOW before filtering
              if (parentContainer.file_id) {
                validatedFileIds.add(parentContainer.file_id);
              }
            } else {
              // Non-architectural method (policy, utility, model method) from unvalidated file - skip it
              continue;
            }
          } else {
            // No parent container found, from unvalidated file - skip it
            continue;
          }
        }

        if (depth > 1 && !isValidatedEntity && targetSymbol.file_id && !validatedFileIds.has(targetSymbol.file_id)) {
          // Symbol from unrelated file - skip it
          continue;
        }

        // Add file to validated set if this is a validated entity
        // Models are NOT added to validated files (prevents pollution from model methods/relationships)
        if (isValidatedEntity && targetSymbol.entity_type !== 'model' && targetSymbol.file_id) {
          validatedFileIds.add(targetSymbol.file_id);
        }

        // Add executor/entity to discovered
        visited.add(targetId);
        const relevance = 1.0 - (depth + 1) / (maxDepth + 1);
        discovered.set(targetId, relevance);

        // ALWAYS discover parent containers for executors (methods/functions)
        // This ensures controller/store classes are discovered even when methods have 'forward' direction
        // NOTE: We discover the parent class itself but DON'T queue it for traversal
        // This prevents pollution from constructor injections and unrelated class-level imports
        // The relevant methods discovered through backward traversal will discover their own imports
        // DEPTH-AWARE: Skip parent discovery for deeply nested controller/service methods (depth >= 3)
        if (targetRole === SymbolRole.EXECUTOR && depth < maxDepth) {
          const parentContainerId = await this.getParentContainer(targetId);
          // Check discovered (not visited) - parent might be visited but not discovered during backward container traversal
          if (parentContainerId && !discovered.has(parentContainerId)) {
            const parentContainer = await SymbolService.getSymbol(this.db,parentContainerId);

            // NO DEPTH FILTERING for parent containers
            // If a method passed all filters and was discovered, its parent class should be included for context
            // The method itself is already depth-filtered, so we don't need to filter its parent
            // Parent containers are NOT queued for traversal, so they can't cause pollution
            if (parentContainer?.entity_type && ['controller', 'store', 'service', 'component'].includes(parentContainer.entity_type)) {
              visited.add(parentContainerId);
              discovered.set(parentContainerId, 1.0 - (depth + 2) / (maxDepth + 1));
              // Add parent's file to validated set
              if (parentContainer.file_id) {
                validatedFileIds.add(parentContainer.file_id);
              }
              // DON'T queue parent for traversal - prevents discovering unrelated constructor injections
            }
          }
        }

        // Determine direction for next traversal (depth-aware to prevent explosion)
        const nextDirection = await this.getNextDirection(direction, targetRole, targetSymbol, depth);
        queue.push({ id: targetId, depth: depth + 1, direction: nextDirection });
      }
    }

    logger.info('Clean traversal complete', {
      discovered: discovered.size,
      visited: visited.size,
    });

    return discovered;
  }

  /**
   * Get edges to follow based on symbol role and traversal direction.
   *
   * Pure execution graph traversal - only follows actual execution relationships:
   * - calls: Direct function/method calls
   * - api_call: Cross-stack API requests (Vue → Laravel)
   * - contains: Parent-child containment (class → methods, file → functions)
   * - references: Model/entity references (e.g., static calls, component → composable)
   *
   * Key principles:
   * 1. EXECUTORS/ENTITIES follow references at depth <= 2 (discover immediate models/requests)
   * 2. Composables/functions/models follow references backward (discover who uses them)
   * 3. Services/controllers do NOT follow references backward (prevents shared infrastructure pollution)
   * 4. Components NEVER follow references forward (prevents shared component pollution)
   * 5. CONTAINERS never follow imports/references (prevents BaseService pollution)
   *
   * EXECUTORS forward: calls, api_call, contains, (references if depth <= 2)
   * EXECUTORS backward: calls, api_call, (references if composable/function)
   * ENTITIES forward: calls, api_call, (references if not component and depth <= 2)
   * ENTITIES backward: calls, api_call, (references if model)
   * CONTAINERS forward: contains (NO imports/references)
   * CONTAINERS backward: calls, contains
   */
  private async getEdges(
    symbolId: number,
    symbol: SymbolInfo,
    role: SymbolRole,
    direction: TraversalDirection,
    depth: number
  ): Promise<number[]> {
    const edges: number[] = [];
    const db = this.db;

    // Forward traversal - follow execution edges only
    if (direction === 'forward' || direction === 'both') {
      if (role === SymbolRole.EXECUTOR) {
        // Follow execution edges: method calls, API calls
        // Always follow calls/api_call (execution flow)
        const deps = await db('dependencies')
          .where('from_symbol_id', symbolId)
          .whereIn('dependency_type', ['calls', 'api_call', 'contains'])
          .pluck('to_symbol_id');
        edges.push(...deps);

        // DEPTH-LIMITED REFERENCES: Only follow references at shallow depths
        // Prevents pollution from deep utility functions discovering controllers
        // Depth 0: Entry point, Depth 1: Service methods, Depth 2: Models/requests
        // At depth > 2, executors shouldn't discover new architectural dependencies
        if (depth <= 2) {
          const referenceDeps = await db('dependencies')
            .where('from_symbol_id', symbolId)
            .where('dependency_type', 'references')
            .pluck('to_symbol_id');
          edges.push(...referenceDeps);
        }
      } else if (role === SymbolRole.ENTITY) {
        // Entities follow execution edges (calls, api_call)
        // Always follow calls/api_call for all entities
        const deps = await db('dependencies')
          .where('from_symbol_id', symbolId)
          .whereIn('dependency_type', ['calls', 'api_call'])
          .pluck('to_symbol_id');
        edges.push(...deps);

        // DEPTH-LIMITED REFERENCES for non-component entities
        // Components never follow references (prevents shared component pollution)
        // Composables/backend entities follow references only at shallow depths
        if (symbol.entity_type !== 'component' && depth <= 2) {
          const referenceDeps = await db('dependencies')
            .where('from_symbol_id', symbolId)
            .where('dependency_type', 'references')
            .pluck('to_symbol_id');
          edges.push(...referenceDeps);
        }
      } else if (role === SymbolRole.CONTAINER) {
        // Containers expand via contains relationship ONLY
        // Do NOT follow imports/references from containers (prevents BaseService pollution)
        const contained = await db('dependencies')
          .where('from_symbol_id', symbolId)
          .where('dependency_type', 'contains')
          .pluck('to_symbol_id');
        edges.push(...contained);
      }
    }

    // Backward traversal - who executes this symbol
    // SYMBOL-TYPE-AWARE BACKWARD TRAVERSAL for 'both' direction
    // Purely backward direction: always process backward edges (Test 2 needs Model→Service→Controller)
    // Both direction - type-aware thresholds:
    //   - Models/composables: allow backward at any depth (discover controllers/policies that use them)
    //   - Methods/functions: allow backward only at depth < 2 (prevents service method caller explosion)
    const isModelOrComposable = symbol.entity_type === 'model' || symbol.entity_type === 'composable';
    const shouldProcessBackward = direction === 'backward' ||
      (direction === 'both' && (isModelOrComposable || depth < 2));

    if (shouldProcessBackward) {
      // Follow execution relationships (calls, api_call)
      const executionCallers = await db('dependencies')
        .where('to_symbol_id', symbolId)
        .whereIn('dependency_type', ['calls', 'api_call'])
        .pluck('from_symbol_id');
      edges.push(...executionCallers);

      // Selectively follow references backward for:
      // - Composables/functions: enables component → composable discovery
      // - Models: enables model → service/controller discovery
      // Excludes services/controllers to prevent pollution from shared infrastructure
      if (
        symbol.entity_type === 'composable' ||
        symbol.entity_type === 'model' ||
        (role === SymbolRole.EXECUTOR && symbol.symbol_type === 'function')
      ) {
        const referenceCallers = await db('dependencies')
          .where('to_symbol_id', symbolId)
          .where('dependency_type', 'references')
          .pluck('from_symbol_id');
        edges.push(...referenceCallers);
      }

      // Include contains for finding parent containers (architectural context)
      const parents = await db('dependencies')
        .where('to_symbol_id', symbolId)
        .where('dependency_type', 'contains')
        .pluck('from_symbol_id');
      edges.push(...parents);
    }

    return [...new Set(edges)]; // Deduplicate
  }

  /**
   * Expand container symbols to their executor methods/functions.
   *
   * Store → methods that make API calls
   * Class → methods
   * File → top-level functions/composables
   */
  private async expandToExecutors(
    symbolIds: number[],
    symbolsBatch: Map<number, SymbolInfo>
  ): Promise<number[]> {
    const executors: number[] = [];
    const db = this.db;

    for (const symbolId of symbolIds) {
      const symbol = symbolsBatch.get(symbolId);
      if (!symbol) continue;

      const role = classifySymbol(symbol);

      // Already an executor - include it
      if (role === SymbolRole.EXECUTOR) {
        executors.push(symbolId);
        continue;
      }

      // Entity that's not a container - include it
      if (role === SymbolRole.ENTITY && symbol.symbol_type !== 'class') {
        executors.push(symbolId);
        continue;
      }

      // Container - expand to methods/functions
      if (role === SymbolRole.CONTAINER) {
        // Get methods/functions contained in this symbol
        const contained = await db('symbols as child')
          .join('dependencies as d', 'child.id', 'd.to_symbol_id')
          .where('d.from_symbol_id', symbolId)
          .where('d.dependency_type', 'contains')
          .whereIn('child.symbol_type', ['method', 'function'])
          .pluck('child.id');

        executors.push(...contained);

        // If no contained executors found, include the container itself
        // (e.g., composable functions that are both container and executor)
        if (contained.length === 0) {
          executors.push(symbolId);
        }
      }
    }

    logger.debug('Expanded containers to executors', {
      input: symbolIds.length,
      output: executors.length,
    });

    return [...new Set(executors)];
  }

  /**
   * Determine direction for next traversal step.
   *
   * Uses depth-aware logic to prevent transitive 'both' explosion.
   * Only entry point symbols (depth 0) can discover bidirectionally.
   */
  private async getNextDirection(
    currentDirection: TraversalDirection,
    targetRole: SymbolRole,
    targetSymbol: SymbolInfo,
    currentDepth: number
  ): Promise<TraversalDirection> {
    // Executors need context-aware traversal:
    // - Controller/store methods: respect backward traversal context to find API callers
    // - Service methods at depth 0-1: can use 'both' (bridge models to controllers)
    // - Service methods at depth 2+: only 'forward' (prevent transitive explosion)
    if (targetRole === SymbolRole.EXECUTOR) {
      // Check if parent container is an architectural boundary (controller, store)
      const parentEntityType = await this.getParentContainerEntityType(targetSymbol.id);

      if (parentEntityType === 'controller' || parentEntityType === 'store') {
        // DEPTH-AWARE BACKWARD TRAVERSAL: Allow backward at shallow depths (0-1)
        // This enables legitimate caller discovery chains:
        // - Service (depth 0) -> Controller (depth 1) -> Store/Route (depth 2)
        // - Model (depth 0) -> Service (depth 1) -> Controller (depth 2) -> Store (depth 3)
        // Deep discoveries (depth 2+) prevent pollution from unrelated callers
        if ((currentDirection === 'backward' || currentDirection === 'both') && currentDepth <= 1) {
          // Respect backward traversal context for shallow discoveries
          return currentDirection === 'backward' ? 'backward' : 'both';
        }
        // Deep discoveries or forward context: only traverse forward
        return 'forward';
      }

      // Service methods: NEVER upgrade to 'both' when discovered transitively
      // Entry point service methods already have 'both' from initialization code
      // Transitively discovered service methods (shared base service) MUST use 'forward' only
      // This prevents shared base service methods from discovering all child services
      if (parentEntityType === 'service') {
        // All transitively discovered service methods: forward only to prevent pollution
        // Entry points don't go through getNextDirection, they're initialized with 'both'
        return 'forward';
      }

      // Other executors (non-service methods): forward only to prevent pollution
      return 'forward';
    }

    // Entities/containers: only allow backward at depth 0 (entry point)
    // Shared models/components discovered transitively should only traverse forward
    // to prevent discovering all their unrelated callers
    if (targetRole === SymbolRole.ENTITY || targetRole === SymbolRole.CONTAINER) {
      const naturalDirection = getTraversalDirection(targetSymbol, targetRole);

      // If natural direction includes backward, only allow it at depth 0 (entry point)
      if ((naturalDirection === 'backward' || naturalDirection === 'both') && currentDepth > 0) {
        return 'forward'; // Transitive entities/containers: only forward
      }

      return naturalDirection;
    }

    // For other roles, use natural direction
    return getTraversalDirection(targetSymbol, targetRole);
  }

  /**
   * Get the entity_type of the parent container for a symbol (method/function).
   * Used to determine architectural boundaries (controller, store, service).
   */
  private async getParentContainerEntityType(symbolId: number): Promise<string | null> {
    const db = this.db;

    // First try 'contains' relationship (standard for classes/methods)
    const containsParent = await db('dependencies as d')
      .select('s.entity_type')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .where('d.to_symbol_id', symbolId)
      .where('d.dependency_type', 'contains')
      .first();

    if (containsParent) {
      return containsParent.entity_type;
    }

    // For Vue components, check 'calls' relationship (components call their functions)
    const callsParent = await db('dependencies as d')
      .select('s.entity_type')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .where('d.to_symbol_id', symbolId)
      .where('d.dependency_type', 'calls')
      .where('s.entity_type', 'component')
      .first();

    return callsParent?.entity_type || null;
  }

  /**
   * Get the parent container ID for a symbol (e.g., controller class for a controller method).
   */
  private async getParentContainer(symbolId: number): Promise<number | null> {
    const db = this.db;

    // First try 'contains' relationship (standard for classes/methods)
    const containsParent = await db('dependencies')
      .where('to_symbol_id', symbolId)
      .where('dependency_type', 'contains')
      .select('from_symbol_id')
      .first();

    if (containsParent) {
      return containsParent.from_symbol_id;
    }

    // For Vue components, check 'calls' relationship (components call their functions)
    const callsParent = await db('dependencies as d')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .where('d.to_symbol_id', symbolId)
      .where('d.dependency_type', 'calls')
      .where('s.entity_type', 'component')
      .select('d.from_symbol_id')
      .first();

    return callsParent?.from_symbol_id || null;
  }

  /**
   * Find which methods of a container reference a specific symbol.
   * Used to prevent discovering entire controllers/services when only one method is relevant.
   *
   * Example: VehicleCameraAlert model → SecureImageController → find only vehicleCameraAlert() method
   */
  private async findMethodsReferencingSymbol(
    containerId: number,
    sourceSymbolId: number
  ): Promise<number[]> {
    const db = this.db;

    // Get all methods in this container
    const methods = await db('symbols as method')
      .join('dependencies as contains', 'method.id', 'contains.to_symbol_id')
      .where('contains.from_symbol_id', containerId)
      .where('contains.dependency_type', 'contains')
      .whereIn('method.symbol_type', ['method', 'function'])
      .pluck('method.id');

    if (methods.length === 0) {
      return [];
    }

    // Find which methods reference the source symbol
    const referencingMethods = await db('dependencies')
      .where('to_symbol_id', sourceSymbolId)
      .whereIn('from_symbol_id', methods)
      .whereIn('dependency_type', ['calls', 'references', 'imports'])
      .pluck('from_symbol_id');

    return [...new Set(referencingMethods)];
  }
}
