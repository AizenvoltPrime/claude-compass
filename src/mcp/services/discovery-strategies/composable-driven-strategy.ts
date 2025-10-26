/**
 * Composable-Driven Discovery Strategy
 *
 * Discovers features by following composable execution flow.
 * Composables bridge components and stores, so we need precise traversal
 * to avoid discovering all composables in parent components.
 *
 * Algorithm:
 * 1. Analyze entry point composable and its nested functions
 * 2. Find parent components that call this composable (containers only)
 * 3. Find components that this composable references
 * 4. Follow composable → stores → store methods → API calls
 * 5. Expand backend: controller methods → controller classes → services → models
 */

import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';
import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('ComposableDrivenStrategy');

interface ApiCallRecord {
  endpoint_symbol_id?: number;
  endpoint_path: string;
}

export class ComposableDrivenStrategy implements DiscoveryStrategy {
  readonly name = 'composable-driven';
  readonly description =
    'Discovers features by following composable execution flow from entry point to components, stores, and backend';
  readonly priority = 3; // Run before general traversal but after cross-stack

  constructor(private dbService: DatabaseService) {}

  /**
   * Helper: Batch fetch symbols by IDs to avoid N+1 queries
   */
  private async batchGetSymbols(symbolIds: number[]): Promise<Map<number, any>> {
    if (symbolIds.length === 0) return new Map();

    const db = this.dbService.knex;
    const symbols = await db('symbols')
      .whereIn('id', symbolIds)
      .select('*');

    return new Map(symbols.map(s => [s.id, s]));
  }

  /**
   * Only run in iteration 0 when we have the composable entry point
   * In later iterations, let other strategies handle the discovered symbols
   */
  shouldRun(context: DiscoveryContext): boolean {
    return context.iteration === 0;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { currentSymbols } = context;
    const discovered = new Map<number, number>();

    logger.info('Starting composable-driven discovery', {
      currentSymbols: currentSymbols.length,
    });

    for (const symbolId of currentSymbols) {
      const symbol = await this.dbService.getSymbol(symbolId);
      if (!symbol) continue;

      // Only handle composables
      if (symbol.entity_type !== 'composable') {
        logger.debug('Skipping non-composable symbol', {
          symbolId,
          entityType: symbol.entity_type,
        });
        continue;
      }

      // Phase 1: Analyze entry point composable
      discovered.set(symbolId, 1.0);

      // Phase 1a: Find nested functions (e.g., fetchCameraAlerts inside createCameraAlertMarkers)
      const nestedFunctions = await this.findNestedFunctions(symbolId);
      for (const nestedId of nestedFunctions) {
        discovered.set(nestedId, 0.98);
      }

      // Phase 1b: Find direct store calls from composable and nested functions
      const allFunctions = [symbolId, ...nestedFunctions];
      const storeMethods: number[] = [];

      for (const funcId of allFunctions) {
        const storeMethodIds = await this.findStoreMethodCalls(funcId);
        storeMethods.push(...storeMethodIds);
      }

      logger.info('Phase 1 complete: Entry point analyzed', {
        composable: symbol.name,
        nestedFunctions: nestedFunctions.length,
        storeMethods: storeMethods.length,
      });

      // Phase 2: Find parent components (backward discovery)
      // CRITICAL: Only include component containers, not all their dependencies
      const parentComponents = await this.findParentComponents(symbolId);
      for (const parentId of parentComponents) {
        discovered.set(parentId, 0.95);
      }

      logger.info('Phase 2 complete: Found parent components', {
        parentComponents: parentComponents.length,
      });

      // Phase 3: Find referenced components (forward discovery)
      // These are components that the composable uses (e.g., CameraAlertInfoWindow)
      const referencedComponents = await this.findReferencedComponents(symbolId);
      for (const compId of referencedComponents) {
        discovered.set(compId, 0.95);
      }

      logger.info('Phase 3 complete: Found referenced components', {
        referencedComponents: referencedComponents.length,
      });

      // Phase 4: Follow store methods to API calls
      for (const storeMethodId of storeMethods) {
        discovered.set(storeMethodId, 0.9);

        // Find parent store
        const parentStore = await this.findParentStore(storeMethodId);
        if (parentStore) {
          discovered.set(parentStore, 0.9);
        }

        // Find API calls from store method
        const apiCalls = await this.getApiCallsFromStoreMethod(storeMethodId);
        for (const apiCall of apiCalls) {
          if (apiCall.endpointSymbolId) {
            discovered.set(apiCall.endpointSymbolId, 0.85);

            // Phase 5: Backend expansion
            const backendSymbols = await this.expandBackend(apiCall.endpointSymbolId);
            for (const backendId of backendSymbols) {
              discovered.set(backendId, 0.8);
            }
          }
        }
      }

      logger.info('Phase 4-5 complete: Followed stores to backend', {
        storeMethods: storeMethods.length,
      });
    }

    logger.info('Composable-driven discovery complete', {
      totalDiscovered: discovered.size,
    });

    return discovered;
  }

  /**
   * Phase 1a: Find nested functions contained by this composable
   */
  private async findNestedFunctions(composableId: number): Promise<number[]> {
    const db = this.dbService.knex;

    const nested = await db('dependencies')
      .select('to_symbol_id')
      .where({ from_symbol_id: composableId, dependency_type: 'contains' });

    if (nested.length === 0) return [];

    // Batch fetch all symbols to avoid N+1 queries
    const symbolIds = nested.map(edge => edge.to_symbol_id);
    const symbolsMap = await this.batchGetSymbols(symbolIds);

    const nestedIds: number[] = [];
    for (const edge of nested) {
      const symbol = symbolsMap.get(edge.to_symbol_id);
      if (symbol && (symbol.symbol_type === 'function' || symbol.symbol_type === 'method')) {
        nestedIds.push(edge.to_symbol_id);
      }
    }

    return nestedIds;
  }

  /**
   * Phase 1b: Find direct store method calls from a symbol
   */
  private async findStoreMethodCalls(symbolId: number): Promise<number[]> {
    const db = this.dbService.knex;

    // Optimized query: Find calls to methods that are contained by stores, all in one query
    const storeMethodCalls = await db('dependencies as call_edge')
      .join('symbols as target', 'call_edge.to_symbol_id', 'target.id')
      .join('dependencies as contains_edge', function() {
        this.on('contains_edge.to_symbol_id', '=', 'call_edge.to_symbol_id')
            .andOn('contains_edge.dependency_type', '=', db.raw('?', ['contains']));
      })
      .join('symbols as parent', 'contains_edge.from_symbol_id', 'parent.id')
      .where('call_edge.from_symbol_id', symbolId)
      .where('call_edge.dependency_type', 'calls')
      .where('target.symbol_type', 'method')
      .where('parent.entity_type', 'store')
      .select('call_edge.to_symbol_id')
      .distinct();

    return storeMethodCalls.map(row => row.to_symbol_id);
  }

  /**
   * Phase 2: Find parent components that call this composable
   * CRITICAL: Only return component containers, not their dependencies
   */
  private async findParentComponents(composableId: number): Promise<number[]> {
    const db = this.dbService.knex;
    const parentComponents = new Set<number>();

    // Find who calls or references this composable (both dependency types capture usage)
    const callers = await db('dependencies')
      .select('from_symbol_id')
      .where({ to_symbol_id: composableId })
      .whereIn('dependency_type', ['calls', 'references']);

    if (callers.length === 0) return [];

    // Batch fetch all caller symbols to avoid N+1 queries
    const callerIds = callers.map(c => c.from_symbol_id);
    const callerSymbolsMap = await this.batchGetSymbols(callerIds);

    // Find containers for callers that aren't components
    const nonComponentCallerIds: number[] = [];
    for (const caller of callers) {
      const symbol = callerSymbolsMap.get(caller.from_symbol_id);
      if (!symbol) continue;

      // If the caller is a component, add it directly
      if (symbol.entity_type === 'component') {
        parentComponents.add(caller.from_symbol_id);
      } else {
        nonComponentCallerIds.push(caller.from_symbol_id);
      }
    }

    // Batch fetch containers for non-component callers
    if (nonComponentCallerIds.length > 0) {
      const containers = await db('dependencies')
        .select('from_symbol_id', 'to_symbol_id')
        .whereIn('to_symbol_id', nonComponentCallerIds)
        .where('dependency_type', 'contains');

      if (containers.length > 0) {
        const containerIds = containers.map(c => c.from_symbol_id);
        const containerSymbolsMap = await this.batchGetSymbols(containerIds);

        for (const container of containers) {
          const containerSymbol = containerSymbolsMap.get(container.from_symbol_id);
          if (containerSymbol && containerSymbol.entity_type === 'component') {
            parentComponents.add(container.from_symbol_id);
          }
        }
      }
    }

    // If no parent containers found via dependency edges, the parser didn't create proper 'references' edges
    if (parentComponents.size === 0) {
      logger.debug('No parent components found for composable via dependency edges', {
        composableId,
      });
    }

    return Array.from(parentComponents);
  }

  /**
   * Phase 3: Find components that this composable references
   */
  private async findReferencedComponents(composableId: number): Promise<number[]> {
    const db = this.dbService.knex;
    const components: number[] = [];

    // Find all references from this composable
    const references = await db('dependencies')
      .select('to_symbol_id')
      .where({ from_symbol_id: composableId, dependency_type: 'references' });

    for (const ref of references) {
      const symbol = await this.dbService.getSymbol(ref.to_symbol_id);
      if (symbol && symbol.entity_type === 'component') {
        components.push(ref.to_symbol_id);
      }
    }

    return components;
  }

  /**
   * Helper: Find parent store of a store method
   */
  private async findParentStore(storeMethodId: number): Promise<number | null> {
    const db = this.dbService.knex;

    // Find parent via 'contains' backwards
    const parentContainer = await db('dependencies')
      .select('from_symbol_id')
      .where({ to_symbol_id: storeMethodId, dependency_type: 'contains' })
      .first();

    if (!parentContainer) {
      return null;
    }

    const parent = await this.dbService.getSymbol(parentContainer.from_symbol_id);
    if (parent && parent.entity_type === 'store') {
      return parentContainer.from_symbol_id;
    }

    return null;
  }

  /**
   * Phase 4: Get API calls from store method
   */
  private async getApiCallsFromStoreMethod(
    storeMethodId: number
  ): Promise<Array<{ endpointSymbolId?: number; path: string }>> {
    const db = this.dbService.knex;

    const apiCalls = await db('api_calls')
      .select('endpoint_symbol_id', 'endpoint_path')
      .where({ caller_symbol_id: storeMethodId });

    return apiCalls.map((call: ApiCallRecord) => ({
      endpointSymbolId: call.endpoint_symbol_id,
      path: call.endpoint_path,
    }));
  }

  /**
   * Phase 5: Expand backend from controller method to parent controller and models/services
   */
  private async expandBackend(controllerMethodId: number): Promise<number[]> {
    const db = this.dbService.knex;
    const backendSymbols: number[] = [];

    // CRITICAL: Find the parent controller class
    const parentController = await db('dependencies')
      .select('from_symbol_id')
      .where({ to_symbol_id: controllerMethodId, dependency_type: 'contains' })
      .first();

    if (parentController) {
      const controllerClass = await this.dbService.getSymbol(parentController.from_symbol_id);
      if (controllerClass && controllerClass.entity_type === 'controller') {
        backendSymbols.push(parentController.from_symbol_id);
      }
    }

    // Find what the controller method calls (services, models, methods)
    const calls = await db('dependencies')
      .select('to_symbol_id')
      .where({ from_symbol_id: controllerMethodId, dependency_type: 'calls' });

    for (const call of calls) {
      const symbol = await this.dbService.getSymbol(call.to_symbol_id);
      if (!symbol) continue;

      // Case 1: Called a service/model class directly
      if (
        symbol.entity_type === 'service' ||
        symbol.entity_type === 'model' ||
        (symbol.symbol_type === 'class' &&
          (symbol.entity_type === 'service' || symbol.entity_type === 'model'))
      ) {
        backendSymbols.push(call.to_symbol_id);

        // Also get its methods
        const methods = await db('dependencies')
          .select('to_symbol_id')
          .where({ from_symbol_id: call.to_symbol_id, dependency_type: 'contains' });

        for (const method of methods) {
          backendSymbols.push(method.to_symbol_id);
        }
      }
      // Case 2: Called a method - find its parent service/model class
      else if (symbol.symbol_type === 'method') {
        // Include the method itself
        backendSymbols.push(call.to_symbol_id);

        // Find parent class via 'contains' backwards
        const parentClass = await db('dependencies')
          .select('from_symbol_id')
          .where({ to_symbol_id: call.to_symbol_id, dependency_type: 'contains' })
          .first();

        if (parentClass) {
          const parent = await this.dbService.getSymbol(parentClass.from_symbol_id);
          if (
            parent &&
            (parent.entity_type === 'service' ||
              parent.entity_type === 'model' ||
              parent.symbol_type === 'class')
          ) {
            backendSymbols.push(parentClass.from_symbol_id);

            // If it's a service, also discover models it references
            if (parent.entity_type === 'service') {
              const serviceModels = await this.discoverModelsFromService(call.to_symbol_id);
              backendSymbols.push(...serviceModels);
            }
          }
        }
      }
    }

    return backendSymbols;
  }

  /**
   * Helper: Discover models referenced by a service method
   */
  private async discoverModelsFromService(serviceMethodId: number): Promise<number[]> {
    const db = this.dbService.knex;
    const models: number[] = [];

    // Find all references from this service method
    const references = await db('dependencies')
      .select('to_symbol_id')
      .where({ from_symbol_id: serviceMethodId, dependency_type: 'references' });

    for (const ref of references) {
      const symbol = await this.dbService.getSymbol(ref.to_symbol_id);
      if (symbol && symbol.entity_type === 'model') {
        models.push(ref.to_symbol_id);
      }
    }

    return models;
  }
}
