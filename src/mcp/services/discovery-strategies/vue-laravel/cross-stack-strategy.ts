/**
 * Clean Cross-Stack Strategy
 *
 * Bridges frontend and backend via API calls in the api_calls table.
 * Simple and focused: finds API connections and returns connected symbols.
 *
 * Forward: Frontend symbols → backend endpoints they call
 * Backward: Backend endpoints → frontend symbols that call them
 */

import type { Knex } from 'knex';
import { createComponentLogger } from '../../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from '../common/types';

const logger = createComponentLogger('cross-stack-clean');

const RELEVANCE_SCORE = 0.9;

export class CleanCrossStackStrategy implements DiscoveryStrategy {
  readonly name = 'cross-stack';
  readonly description = 'Bridge frontend-backend via API calls';
  readonly priority = 5;

  constructor(private db: Knex) {}

  shouldRun(_context: DiscoveryContext): boolean {
    return true; // Run every iteration to catch new connections
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { currentSymbols, entryPointId } = context;
    const discovered = new Map<number, number>();

    if (currentSymbols.length === 0) {
      return discovered;
    }

    const isBackendEntry = await this.isBackendEntryPoint(entryPointId);

    // Find API calls FROM current symbols (frontend → backend)
    const forwardCalls = await this.db('api_calls')
      .whereIn('caller_symbol_id', currentSymbols)
      .whereNotNull('endpoint_symbol_id')
      .select('endpoint_symbol_id');

    for (const row of forwardCalls) {
      discovered.set(row.endpoint_symbol_id, RELEVANCE_SCORE);
    }

    // Find API calls TO current symbols (backend → frontend)
    const backwardCalls = await this.db('api_calls')
      .whereIn('endpoint_symbol_id', currentSymbols)
      .whereNotNull('caller_symbol_id')
      .select('caller_symbol_id');

    const frontendCallerIds: number[] = [];
    for (const row of backwardCalls) {
      discovered.set(row.caller_symbol_id, RELEVANCE_SCORE);
      frontendCallerIds.push(row.caller_symbol_id);
    }

    // PARENT CONTAINER DISCOVERY: For frontend callers (store methods, component methods, composables),
    // discover their parent containers (stores, components, composables) for architectural context
    const parentContainerIds: number[] = [];
    if (frontendCallerIds.length > 0) {
      // Query 1: Standard 'contains' relationships (stores, composables)
      const containsParents = await this.db('dependencies as d')
        .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
        .whereIn('d.to_symbol_id', frontendCallerIds)
        .where('d.dependency_type', 'contains')
        .whereIn('parent.entity_type', ['store', 'component', 'composable'])
        .select('parent.id');

      // Query 2: Vue components use 'calls' relationships (component calls its functions)
      const callsParents = await this.db('dependencies as d')
        .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
        .whereIn('d.to_symbol_id', frontendCallerIds)
        .where('d.dependency_type', 'calls')
        .where('parent.entity_type', 'component')
        .select('parent.id');

      // Combine both results
      const parentContainers = [...containsParents, ...callsParents];

      for (const row of parentContainers) {
        if (!discovered.has(row.id)) {
          discovered.set(row.id, RELEVANCE_SCORE);
          parentContainerIds.push(row.id);
        }
      }
    }

    // FORWARD FRONTEND DISCOVERY: When we discover stores via backward API traversal,
    // continue forward to find components/composables that USE those stores
    // This completes the full feature discovery: Backend → API → Store → Components → Referenced Components
    const frontendSymbolsToExpand = [...frontendCallerIds, ...parentContainerIds];
    const composableIds: number[] = [];

    if (frontendSymbolsToExpand.length > 0) {
      // Find direct callers of store methods
      const storeCalls = await this.db('dependencies')
        .whereIn('to_symbol_id', frontendCallerIds)
        .where('dependency_type', 'calls')
        .select('from_symbol_id');

      for (const row of storeCalls) {
        if (!discovered.has(row.from_symbol_id)) {
          discovered.set(row.from_symbol_id, RELEVANCE_SCORE);
        }
      }

      // Find parent containers of those callers (components, composables)
      // When we discover a component/composable that calls stores, add it to the feature
      if (storeCalls.length > 0) {
        const callerIds = storeCalls.map(r => r.from_symbol_id);

        // Query 1: Direct parents - Standard 'contains' relationships (composables)
        const containsCallerParents = await this.db('dependencies as d')
          .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
          .whereIn('d.to_symbol_id', callerIds)
          .where('d.dependency_type', 'contains')
          .whereIn('parent.entity_type', ['component', 'composable'])
          .select('parent.id', 'parent.entity_type');

        // Query 2: Direct parents - Vue components use 'calls' relationships
        const callsCallerParents = await this.db('dependencies as d')
          .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
          .whereIn('d.to_symbol_id', callerIds)
          .where('d.dependency_type', 'calls')
          .where('parent.entity_type', 'component')
          .select('parent.id', 'parent.entity_type');

        // Query 3: Transitive parents for Vue inline functions (2-level nesting)
        // Example: Component.calls(submitForm) → submitForm.contains(arrow_function) → arrow_function.calls(storeMethod)
        // When we discover arrow_function via store call, this traverses backwards to find the Component:
        // callerIds (arrow_function) ←contains← intermediate (submitForm) ←calls← component (Component)
        // ONLY run for backend entry points (controller/service/model) to prevent over-discovery from frontend entries
        let transitiveParents: Array<{ id: number; entity_type: string }> = [];
        if (isBackendEntry) {
          transitiveParents = await this.db('dependencies as d1')
            .join('symbols as intermediate', 'd1.from_symbol_id', 'intermediate.id')
            .join('dependencies as d2', 'intermediate.id', 'd2.to_symbol_id')
            .join('symbols as component', 'd2.from_symbol_id', 'component.id')
            .whereIn('d1.to_symbol_id', callerIds)
            .where('d1.dependency_type', 'contains')
            .whereIn('intermediate.entity_type', ['function', 'variable'])
            .where('d2.dependency_type', 'calls')
            .where('component.entity_type', 'component')
            .select('component.id as id', 'component.entity_type');
        }

        // Combine all results
        const callerParents = [...containsCallerParents, ...callsCallerParents, ...transitiveParents];

        for (const row of callerParents) {
          if (!discovered.has(row.id)) {
            discovered.set(row.id, RELEVANCE_SCORE);
            if (row.entity_type === 'composable') {
              composableIds.push(row.id);
            }
          }
        }
      }
    }

    // COMPOSABLE REFERENCES: Composables often import/reference components they use
    // Follow references/imports from composables to discover related components
    // Example: createCameraAlertMarkers references CameraAlertInfoWindow component
    if (composableIds.length > 0) {
      const composableRefs = await this.db('dependencies')
        .whereIn('from_symbol_id', composableIds)
        .whereIn('dependency_type', ['references', 'imports'])
        .select('to_symbol_id');

      const referencedSymbolIds = composableRefs.map(r => r.to_symbol_id);

      if (referencedSymbolIds.length > 0) {
        // Get the referenced symbols and filter for components
        const referencedComponents = await this.db('symbols')
          .whereIn('id', referencedSymbolIds)
          .where('entity_type', 'component')
          .select('id');

        for (const row of referencedComponents) {
          if (!discovered.has(row.id)) {
            discovered.set(row.id, RELEVANCE_SCORE);
          }
        }
      }

      const composableCallers = await this.db('dependencies as d')
        .join('symbols as caller', 'd.from_symbol_id', 'caller.id')
        .whereIn('d.to_symbol_id', composableIds)
        .whereIn('d.dependency_type', ['calls', 'references'])
        .where('caller.entity_type', 'component')
        .select('caller.id');

      for (const row of composableCallers) {
        if (!discovered.has(row.id)) {
          discovered.set(row.id, RELEVANCE_SCORE);
        }
      }
    }

    logger.info('Cross-stack discovery complete', {
      forwardDiscovered: forwardCalls.length,
      backwardDiscovered: backwardCalls.length,
      parentContainers: parentContainerIds.length,
      frontendExpanded: frontendSymbolsToExpand.length > 0 ? 'checked' : 'skipped',
      totalDiscovered: discovered.size,
    });

    return discovered;
  }

  private async isBackendEntryPoint(entryPointId: number): Promise<boolean> {
    try {
      const entryPoint = await this.db('symbols')
        .where('id', entryPointId)
        .select('entity_type')
        .first();

      if (!entryPoint) {
        logger.warn('Entry point not found in database', { entryPointId });
        return false;
      }

      if (['controller', 'service', 'model'].includes(entryPoint.entity_type || '')) {
        return true;
      }

      if (entryPoint.entity_type === 'method') {
        const parentContainer = await this.db('dependencies as d')
          .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
          .where('d.to_symbol_id', entryPointId)
          .where('d.dependency_type', 'contains')
          .whereIn('parent.entity_type', ['controller', 'service'])
          .select('parent.entity_type')
          .first();

        return !!parentContainer;
      }

      return false;
    } catch (error) {
      logger.error('Failed to determine backend entry point', {
        entryPointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
