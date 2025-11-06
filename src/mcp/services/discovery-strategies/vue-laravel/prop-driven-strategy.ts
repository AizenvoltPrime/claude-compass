/**
 * Prop-Driven Discovery Strategy
 *
 * Discovers features by following data flow through component props.
 * This is much more precise than pure graph traversal because it only
 * includes store methods that provide data actually consumed by the feature.
 *
 * Algorithm:
 * 1. Parse entry point (component) imports and direct store calls
 * 2. Find consumers (who renders this component)
 * 3. For each consumer, analyze what props are passed
 * 4. Trace where prop data comes from (store method calls)
 * 5. Follow store methods → API calls → backend
 * 6. Expand backend: controllers → models
 */

import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from '../common/types';
import type { Knex } from 'knex';
import * as SymbolService from '../../../../database/services/symbol-service';
import { createComponentLogger } from '../../../../utils/logger';

const logger = createComponentLogger('PropDrivenStrategy');

interface PropInfo {
  name: string;
  type?: string;
  required?: boolean;
}

interface PropBinding {
  propName: string;
  sourceExpression: string;
  resolvedStoreMethod?: number; // symbol_id of store method
}

interface ComponentAnalysis {
  symbolId: number;
  props: PropInfo[];
  storeCallsInSetup: number[]; // Direct store method calls in component setup
}

interface ConsumerAnalysis {
  symbolId: number;
  name: string;
  propBindings: PropBinding[];
  storeCallsInScope: number[]; // Store methods called in consumer that populate prop data
}

export class PropDrivenStrategy implements DiscoveryStrategy {
  readonly name = 'prop-driven';
  readonly description =
    'Discovers features by following data flow through component props';
  readonly priority = 3; // Run before general traversal but after cross-stack

  constructor(private db: Knex) {}

  /**
   * Only run in iteration 0 when we have the component entry point
   * In later iterations, let other strategies handle the discovered symbols
   */
  shouldRun(context: DiscoveryContext): boolean {
    return context.iteration === 0;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { currentSymbols } = context;
    const discovered = new Map<number, number>();

    logger.info('Starting prop-driven discovery', {
      currentSymbols: currentSymbols.length,
    });

    for (const symbolId of currentSymbols) {
      const symbol = await SymbolService.getSymbol(this.db, symbolId);
      if (!symbol) continue;

      // Only handle Vue components for now
      if (symbol.entity_type !== 'component') {
        logger.debug('Skipping non-component symbol', {
          symbolId,
          entityType: symbol.entity_type,
        });
        continue;
      }

      // Phase 1: Analyze entry point component
      const entryAnalysis = await this.analyzeComponent(symbolId);
      discovered.set(symbolId, 1.0);

      // Add direct store calls from component
      for (const storeMethodId of entryAnalysis.storeCallsInSetup) {
        discovered.set(storeMethodId, 0.95);
      }

      logger.info('Phase 1 complete: Entry point analyzed', {
        component: symbol.name,
        props: entryAnalysis.props.length,
        directStoreCalls: entryAnalysis.storeCallsInSetup.length,
      });

      // Phase 1.5: Discover child components used by entry point
      const childComponents = await this.findChildComponents(symbolId);
      for (const childId of childComponents) {
        discovered.set(childId, 0.95);
      }
      logger.info('Phase 1.5 complete: Found child components', {
        childComponents: childComponents.length,
      });

      // Phase 2: Find consumers (who renders this component)
      const consumers = await this.findConsumers(symbolId);
      logger.info('Phase 2 complete: Found consumers', {
        consumers: consumers.length,
      });

      // Phase 2.5: For each consumer (composable), find parent components that use it
      const parentComponents: number[] = [];
      for (const consumer of consumers) {
        const parents = await this.findParentComponents(consumer.symbolId);
        parentComponents.push(...parents);
      }
      for (const parentId of parentComponents) {
        discovered.set(parentId, 0.85);
        // NOTE: We don't discover ALL stores used by parent components here
        // because that causes pollution (parent uses many unrelated stores).
        // Phase 3 will discover stores that are actually used by the composable.
      }
      logger.info('Phase 2.5 complete: Found parent components', {
        parentComponents: parentComponents.length,
      });

      for (const consumer of consumers) {
        discovered.set(consumer.symbolId, 0.9);

        // Phase 3: Analyze props passed and trace data sources
        const relevantStoreMethods = await this.tracePropsToStoreMethods(consumer);

        logger.info('Phase 3 complete: Traced props to store methods', {
          consumer: consumer.name,
          relevantStoreMethods: relevantStoreMethods.length,
        });

        for (const storeMethodId of relevantStoreMethods) {
          discovered.set(storeMethodId, 0.9);

          // Also discover the parent store
          const parentStore = await this.findParentStore(storeMethodId);
          if (parentStore) {
            discovered.set(parentStore, 0.9);
          }

          // Phase 4: Store methods → API calls
          const apiCalls = await this.getApiCallsFromStoreMethod(storeMethodId);
          for (const apiCall of apiCalls) {
            if (apiCall.endpointSymbolId) {
              discovered.set(apiCall.endpointSymbolId, 0.85);

              // Phase 5: Backend expansion (controller method → models)
              const backendSymbols = await this.expandBackend(
                apiCall.endpointSymbolId
              );
              for (const backendId of backendSymbols) {
                discovered.set(backendId, 0.8);
              }
            }
          }
        }
      }
    }

    logger.info('Prop-driven discovery complete', {
      totalDiscovered: discovered.size,
    });

    return discovered;
  }

  /**
   * Phase 1: Analyze component to extract props and direct store calls
   */
  private async analyzeComponent(symbolId: number): Promise<ComponentAnalysis> {
    const db = this.db;
    const symbol = await SymbolService.getSymbol(this.db,symbolId);
    if (!symbol) {
      return { symbolId, props: [], storeCallsInSetup: [] };
    }

    // Get props from components table (populated during analysis)
    const component = await db('components')
      .where({ symbol_id: symbolId })
      .first();

    const props: PropInfo[] = component?.props || [];

    logger.debug('Retrieved props from components table', {
      symbolId,
      propsCount: props.length,
    });

    // Find direct store method calls in component
    const storeCallsInSetup = await this.findStoreMethodCalls(symbolId);

    return { symbolId, props, storeCallsInSetup };
  }

  /**
   * Helper: Find parent store of a store method
   */
  private async findParentStore(storeMethodId: number): Promise<number | null> {
    const db = this.db;

    // Find parent via 'contains' backwards
    const parentContainer = await db('dependencies')
      .select('from_symbol_id')
      .where({ to_symbol_id: storeMethodId, dependency_type: 'contains' })
      .first();

    if (!parentContainer) {
      return null;
    }

    const parent = await SymbolService.getSymbol(this.db,parentContainer.from_symbol_id);
    if (parent && parent.entity_type === 'store') {
      return parentContainer.from_symbol_id;
    }

    return null;
  }

  /**
   * Find direct store method calls from a symbol
   * Returns symbol IDs of store methods
   */
  private async findStoreMethodCalls(symbolId: number): Promise<number[]> {
    const db = this.db;

    // Find all calls from this symbol
    const calls = await db('dependencies')
      .select('to_symbol_id')
      .where({ from_symbol_id: symbolId, dependency_type: 'calls' });

    const storeMethodIds: number[] = [];

    for (const call of calls) {
      const targetSymbol = await SymbolService.getSymbol(this.db,call.to_symbol_id);
      if (!targetSymbol) continue;

      // Check if target is a method inside a store
      if (targetSymbol.symbol_type === 'method') {
        // Check if parent container is a store using entity_type
        const parentStore = await db('dependencies as d')
          .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
          .where('d.to_symbol_id', call.to_symbol_id)
          .where('d.dependency_type', 'contains')
          .where('parent.entity_type', 'store')
          .first();

        if (parentStore) {
          storeMethodIds.push(call.to_symbol_id);
        }
      }
    }

    return storeMethodIds;
  }

  /**
   * Phase 2: Find who renders/uses this component
   */
  private async findConsumers(componentId: number): Promise<ConsumerAnalysis[]> {
    const db = this.db;
    const consumers: ConsumerAnalysis[] = [];

    // Find symbols that reference this component
    const references = await db('dependencies')
      .select('from_symbol_id')
      .where({ to_symbol_id: componentId, dependency_type: 'references' });

    for (const ref of references) {
      const consumerSymbol = await SymbolService.getSymbol(this.db,ref.from_symbol_id);
      if (!consumerSymbol) continue;

      // Get source to analyze prop bindings
      const file = await db('files')
        .where({ id: consumerSymbol.file_id })
        .first();

      if (!file) continue;

      const propBindings = await this.parsePropBindings(
        file.path,
        componentId
      );

      const storeCallsInScope = await this.findStoreMethodCalls(ref.from_symbol_id);

      consumers.push({
        symbolId: ref.from_symbol_id,
        name: consumerSymbol.name,
        propBindings,
        storeCallsInScope,
      });
    }

    return consumers;
  }

  /**
   * Parse prop bindings from render location (template or h() call)
   * Reads from filesystem (source of truth for code)
   */
  private async parsePropBindings(
    filePath: string,
    componentId: number
  ): Promise<PropBinding[]> {
    const bindings: PropBinding[] = [];
    const componentSymbol = await SymbolService.getSymbol(this.db,componentId);
    if (!componentSymbol) return bindings;

    // Read source from filesystem
    const fs = await import('fs/promises');
    let source: string;
    try {
      source = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      logger.warn('Could not read file for prop binding analysis', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return bindings;
    }

    // Look for h(ComponentName, { prop: value, ... })
    const hCallRegex = new RegExp(
      `h\\(\\s*${componentSymbol.name}\\s*,\\s*\\{([^}]+)\\}`,
      'g'
    );

    let match: RegExpExecArray | null;
    while ((match = hCallRegex.exec(source)) !== null) {
      const propsBlock = match[1];
      const propLines = propsBlock.split(',');

      for (const line of propLines) {
        const propMatch = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
        if (propMatch) {
          bindings.push({
            propName: propMatch[1].trim(),
            sourceExpression: propMatch[2].trim(),
          });
        }
      }
    }

    logger.debug('Parsed prop bindings', {
      filePath,
      component: componentSymbol.name,
      bindingsCount: bindings.length,
    });

    return bindings;
  }

  /**
   * Phase 3: Get all store method calls from consumers
   * Simplified: Just get ALL store methods called by the consumer,
   * including from nested functions via 'contains' edges
   */
  private async tracePropsToStoreMethods(
    consumer: ConsumerAnalysis
  ): Promise<number[]> {
    const db = this.db;
    const relevantMethods = new Set<number>();

    // Add direct store calls from consumer
    for (const storeMethodId of consumer.storeCallsInScope) {
      relevantMethods.add(storeMethodId);
    }

    // CRITICAL: Follow 'contains' edges to find nested functions
    // e.g., createCameraAlertMarkers contains fetchCameraAlerts
    const nestedFunctions = await db('dependencies')
      .where({ from_symbol_id: consumer.symbolId, dependency_type: 'contains' })
      .pluck('to_symbol_id');

    // Get store calls from nested functions
    for (const nestedId of nestedFunctions) {
      const nestedStoreCalls = await this.findStoreMethodCalls(nestedId);
      for (const storeMethodId of nestedStoreCalls) {
        relevantMethods.add(storeMethodId);
      }
    }

    return Array.from(relevantMethods);
  }

  /**
   * Phase 4: Get API calls from store method
   */
  private async getApiCallsFromStoreMethod(
    storeMethodId: number
  ): Promise<Array<{ endpointSymbolId?: number; path: string }>> {
    const db = this.db;

    const apiCalls = await db('api_calls')
      .select('endpoint_symbol_id', 'endpoint_path')
      .where({ caller_symbol_id: storeMethodId });

    return apiCalls.map((call: any) => ({
      endpointSymbolId: call.endpoint_symbol_id,
      path: call.endpoint_path,
    }));
  }

  /**
   * Phase 5: Expand backend from controller method to parent controller and models/services
   */
  private async expandBackend(controllerMethodId: number): Promise<number[]> {
    const db = this.db;
    const backendSymbols: number[] = [];

    // CRITICAL: Find the parent controller class
    // Controller methods are contained by controller classes
    const parentController = await db('dependencies')
      .select('from_symbol_id')
      .where({ to_symbol_id: controllerMethodId, dependency_type: 'contains' })
      .first();

    if (parentController) {
      const controllerClass = await SymbolService.getSymbol(this.db,parentController.from_symbol_id);
      if (controllerClass && controllerClass.entity_type === 'controller') {
        backendSymbols.push(parentController.from_symbol_id);
      }
    }

    // Find what the controller method calls (services, models, methods)
    const calls = await db('dependencies')
      .select('to_symbol_id')
      .where({ from_symbol_id: controllerMethodId, dependency_type: 'calls' });

    for (const call of calls) {
      const symbol = await SymbolService.getSymbol(this.db,call.to_symbol_id);
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
          const parent = await SymbolService.getSymbol(this.db,parentClass.from_symbol_id);
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
    const db = this.db;
    const models: number[] = [];

    // Find all references from this service method
    const references = await db('dependencies')
      .select('to_symbol_id')
      .where({ from_symbol_id: serviceMethodId, dependency_type: 'references' });

    for (const ref of references) {
      const symbol = await SymbolService.getSymbol(this.db,ref.to_symbol_id);
      if (symbol && symbol.entity_type === 'model') {
        models.push(ref.to_symbol_id);
      }
    }

    return models;
  }

  /**
   * Phase 1.5: Find child components used by entry point component
   */
  private async findChildComponents(componentId: number): Promise<number[]> {
    const db = this.db;
    const childComponents: number[] = [];

    // Find all components referenced by this component
    const references = await db('dependencies')
      .select('to_symbol_id')
      .where({ from_symbol_id: componentId, dependency_type: 'references' });

    for (const ref of references) {
      const symbol = await SymbolService.getSymbol(this.db,ref.to_symbol_id);
      if (symbol && symbol.entity_type === 'component') {
        childComponents.push(ref.to_symbol_id);
      }
    }

    return childComponents;
  }

  /**
   * Phase 2.5: Find parent components that use a composable/function
   */
  private async findParentComponents(composableId: number): Promise<number[]> {
    const db = this.db;
    const parentComponents = new Set<number>();

    // Find who calls this composable
    const callers = await db('dependencies')
      .select('from_symbol_id')
      .where({ to_symbol_id: composableId, dependency_type: 'calls' });

    for (const caller of callers) {
      const symbol = await SymbolService.getSymbol(this.db,caller.from_symbol_id);
      if (!symbol) continue;

      // If the caller is a component, add it directly
      if (symbol.entity_type === 'component') {
        parentComponents.add(caller.from_symbol_id);
        continue;
      }

      // Otherwise, the caller might be a variable/function inside a component
      // Try 1: Find the component that contains this caller via 'contains' edge
      const container = await db('dependencies')
        .select('from_symbol_id')
        .where({ to_symbol_id: caller.from_symbol_id, dependency_type: 'contains' })
        .first();

      if (container) {
        const containerSymbol = await SymbolService.getSymbol(this.db,container.from_symbol_id);
        if (containerSymbol && containerSymbol.entity_type === 'component') {
          parentComponents.add(container.from_symbol_id);
          continue;
        }
      }

      // Try 2: File-based discovery - find components in the same file
      // This handles cases where variables don't have 'contains' edges
      if (symbol.file_id) {
        const componentsInFile = await db('symbols')
          .select('id')
          .where({ file_id: symbol.file_id, entity_type: 'component' });

        for (const comp of componentsInFile) {
          parentComponents.add(comp.id);
        }
      }
    }

    return Array.from(parentComponents);
  }
}
