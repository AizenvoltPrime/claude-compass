/**
 * Container Expander
 *
 * Expands container symbols (classes, stores, files) to their executor methods/functions.
 * Handles different container types and expansion strategies.
 */

import type { SymbolInfo } from './symbol-classifier';
import { classifySymbol, SymbolRole } from './symbol-classifier';
import type { SymbolGraphQueries } from './symbol-graph-queries';
import { createComponentLogger } from '../../../../utils/logger';

const logger = createComponentLogger('container-expander');

export class ContainerExpander {
  constructor(
    private readonly queries: SymbolGraphQueries
  ) {}

  async expandToExecutors(
    symbolIds: number[],
    symbolsBatch: Map<number, SymbolInfo>
  ): Promise<number[]> {
    const executors: number[] = [];

    for (const symbolId of symbolIds) {
      const symbol = symbolsBatch.get(symbolId);
      if (!symbol) continue;

      const role = classifySymbol(symbol);

      if (role === SymbolRole.EXECUTOR) {
        executors.push(symbolId);
        continue;
      }

      if (role === SymbolRole.ENTITY && symbol.symbol_type !== 'class') {
        executors.push(symbolId);
        continue;
      }

      if (role === SymbolRole.CONTAINER) {
        const contained = await this.queries.getContainedExecutors(symbolId);
        executors.push(...contained);

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
}
