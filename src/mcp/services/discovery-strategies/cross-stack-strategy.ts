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
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';

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
    const { currentSymbols } = context;
    const discovered = new Map<number, number>();

    logger.debug('Starting cross-stack discovery', {
      currentSymbols: currentSymbols.length,
    });

    if (currentSymbols.length === 0) {
      return discovered;
    }

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

      logger.debug('Parent containers discovered', {
        parentCount: parentContainers.length,
        containsCount: containsParents.length,
        callsCount: callsParents.length,
      });
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

        // Query 1: Standard 'contains' relationships (composables)
        const containsCallerParents = await this.db('dependencies as d')
          .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
          .whereIn('d.to_symbol_id', callerIds)
          .where('d.dependency_type', 'contains')
          .whereIn('parent.entity_type', ['component', 'composable'])
          .select('parent.id', 'parent.entity_type');

        // Query 2: Vue components use 'calls' relationships
        const callsCallerParents = await this.db('dependencies as d')
          .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
          .whereIn('d.to_symbol_id', callerIds)
          .where('d.dependency_type', 'calls')
          .where('parent.entity_type', 'component')
          .select('parent.id', 'parent.entity_type');

        // Combine both results
        const callerParents = [...containsCallerParents, ...callsCallerParents];

        for (const row of callerParents) {
          if (!discovered.has(row.id)) {
            discovered.set(row.id, RELEVANCE_SCORE);
            if (row.entity_type === 'composable') {
              composableIds.push(row.id);
            }
          }
        }

        logger.debug('Forward frontend discovery', {
          storeCalls: storeCalls.length,
          callerParents: callerParents.length,
          containsParents: containsCallerParents.length,
          callsParents: callsCallerParents.length,
          composables: composableIds.length,
        });
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

        logger.debug('Composable references discovered', {
          totalRefs: composableRefs.length,
          components: referencedComponents.length,
        });
      }

      // BACKWARD COMPONENT DISCOVERY: Find components that call/reference these composables
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

      if (composableCallers.length > 0) {
        logger.debug('Composable callers discovered', {
          composables: composableIds.length,
          callerComponents: composableCallers.length,
        });
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
}
