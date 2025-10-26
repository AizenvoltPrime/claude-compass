/**
 * Clean Cross-Stack Strategy
 *
 * Bridges frontend and backend via API calls in the api_calls table.
 * Simple and focused: finds API connections and returns connected symbols.
 *
 * Forward: Frontend symbols → backend endpoints they call
 * Backward: Backend endpoints → frontend symbols that call them
 */

import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';

const logger = createComponentLogger('cross-stack-clean');

const RELEVANCE_SCORE = 0.9;

export class CleanCrossStackStrategy implements DiscoveryStrategy {
  readonly name = 'cross-stack';
  readonly description = 'Bridge frontend-backend via API calls';
  readonly priority = 5;

  constructor(private dbService: DatabaseService) {}

  shouldRun(_context: DiscoveryContext): boolean {
    return true; // Run every iteration to catch new connections
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { currentSymbols } = context;
    const db = this.dbService.knex;
    const discovered = new Map<number, number>();

    logger.debug('Starting cross-stack discovery', {
      currentSymbols: currentSymbols.length,
    });

    if (currentSymbols.length === 0) {
      return discovered;
    }

    // Find API calls FROM current symbols (frontend → backend)
    const forwardCalls = await db('api_calls')
      .whereIn('caller_symbol_id', currentSymbols)
      .whereNotNull('endpoint_symbol_id')
      .select('endpoint_symbol_id');

    for (const row of forwardCalls) {
      discovered.set(row.endpoint_symbol_id, RELEVANCE_SCORE);
    }

    // Find API calls TO current symbols (backend → frontend)
    const backwardCalls = await db('api_calls')
      .whereIn('endpoint_symbol_id', currentSymbols)
      .whereNotNull('caller_symbol_id')
      .select('caller_symbol_id');

    const frontendCallerIds: number[] = [];
    for (const row of backwardCalls) {
      discovered.set(row.caller_symbol_id, RELEVANCE_SCORE);
      frontendCallerIds.push(row.caller_symbol_id);
    }

    // PARENT CONTAINER DISCOVERY: For frontend callers (store methods, component methods),
    // discover their parent containers (stores, components) for architectural context
    const parentContainerIds: number[] = [];
    if (frontendCallerIds.length > 0) {
      const parentContainers = await db('dependencies as d')
        .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
        .whereIn('d.to_symbol_id', frontendCallerIds)
        .where('d.dependency_type', 'contains')
        .whereIn('parent.entity_type', ['store', 'component'])
        .select('parent.id');

      for (const row of parentContainers) {
        if (!discovered.has(row.id)) {
          discovered.set(row.id, RELEVANCE_SCORE);
          parentContainerIds.push(row.id);
        }
      }

      logger.debug('Parent containers discovered', {
        parentCount: parentContainers.length,
      });
    }

    // FORWARD FRONTEND DISCOVERY: When we discover stores via backward API traversal,
    // continue forward to find components/composables that USE those stores
    // This completes the full feature discovery: Backend → API → Store → Components → Referenced Components
    const frontendSymbolsToExpand = [...frontendCallerIds, ...parentContainerIds];
    const composableIds: number[] = [];

    if (frontendSymbolsToExpand.length > 0) {
      // Find direct callers of store methods
      const storeCalls = await db('dependencies')
        .whereIn('to_symbol_id', frontendCallerIds)
        .where('dependency_type', 'calls')
        .select('from_symbol_id');

      for (const row of storeCalls) {
        if (!discovered.has(row.from_symbol_id)) {
          discovered.set(row.from_symbol_id, RELEVANCE_SCORE);
        }
      }

      // Find parent containers of those callers (components, composables)
      if (storeCalls.length > 0) {
        const callerIds = storeCalls.map(r => r.from_symbol_id);
        const callerParents = await db('dependencies as d')
          .join('symbols as parent', 'd.from_symbol_id', 'parent.id')
          .whereIn('d.to_symbol_id', callerIds)
          .where('d.dependency_type', 'contains')
          .whereIn('parent.entity_type', ['component', 'composable'])
          .select('parent.id', 'parent.entity_type');

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
          composables: composableIds.length,
        });
      }
    }

    // COMPOSABLE REFERENCES: Composables often import/reference components they use
    // Follow references/imports from composables to discover related components
    // Example: createCameraAlertMarkers references CameraAlertInfoWindow component
    if (composableIds.length > 0) {
      const composableRefs = await db('dependencies')
        .whereIn('from_symbol_id', composableIds)
        .whereIn('dependency_type', ['references', 'imports'])
        .select('to_symbol_id');

      const referencedSymbolIds = composableRefs.map(r => r.to_symbol_id);

      if (referencedSymbolIds.length > 0) {
        // Get the referenced symbols and filter for components
        const referencedComponents = await db('symbols')
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
