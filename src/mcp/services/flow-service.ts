import type { Knex } from 'knex';
import * as SymbolService from '../../database/services/symbol-service';
import { DependencyType } from '../../database/models';
import { transitiveAnalyzer } from '../../graph/transitive-analyzer';
import { TraceFlowArgs } from '../types';
import { validateTraceFlowArgs } from '../validators';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('flow-service');

export class FlowService {
  constructor(private db: Knex) {}

  async traceFlow(args: any) {
    try {
      const validatedArgs = validateTraceFlowArgs(args);

      const findAllPaths = validatedArgs.find_all_paths || false;
      const maxDepth = validatedArgs.max_depth || 10;

      const startSymbol = await SymbolService.getSymbolWithFile(this.db,validatedArgs.start_symbol_id);
      const endSymbol = await SymbolService.getSymbolWithFile(this.db,validatedArgs.end_symbol_id);

      if (!startSymbol || !endSymbol) {
        throw new Error('Start or end symbol not found');
      }

      const traversalOptions = {
        includeCrossStack: true,
        includeTypes: [
          DependencyType.CALLS,
          DependencyType.IMPORTS,
          DependencyType.API_CALL,
          DependencyType.SHARES_SCHEMA,
          DependencyType.FRONTEND_BACKEND,
        ],
      };

      if (findAllPaths) {
        const paths = await transitiveAnalyzer.findAllPaths(
          validatedArgs.start_symbol_id,
          validatedArgs.end_symbol_id,
          maxDepth,
          traversalOptions
        );

        const formattedPaths = await Promise.all(
          paths.map(async path => ({
            path_ids: path,
            distance: path.length - 1,
            call_chain: await transitiveAnalyzer.formatCallChain(path),
          }))
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  start_symbol: {
                    id: startSymbol.id,
                    name: startSymbol.name,
                    file_path: startSymbol.file?.path,
                  },
                  end_symbol: {
                    id: endSymbol.id,
                    name: endSymbol.name,
                    file_path: endSymbol.file?.path,
                  },
                  paths: formattedPaths,
                  total_paths: paths.length,
                  analysis_type: 'all_paths',
                  max_depth: maxDepth,
                },
                null,
                2
              ),
            },
          ],
        };
      } else {
        const result = await transitiveAnalyzer.findShortestPath(
          validatedArgs.start_symbol_id,
          validatedArgs.end_symbol_id,
          traversalOptions
        );

        if (!result) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    start_symbol: {
                      id: startSymbol.id,
                      name: startSymbol.name,
                      file_path: startSymbol.file?.path,
                    },
                    end_symbol: {
                      id: endSymbol.id,
                      name: endSymbol.name,
                      file_path: endSymbol.file?.path,
                    },
                    path: null,
                    message: 'No path found between symbols',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const callChain = await transitiveAnalyzer.formatCallChain(result.path);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  start_symbol: {
                    id: startSymbol.id,
                    name: startSymbol.name,
                    file_path: startSymbol.file?.path,
                  },
                  end_symbol: {
                    id: endSymbol.id,
                    name: endSymbol.name,
                    file_path: endSymbol.file?.path,
                  },
                  path: {
                    symbol_ids: result.path,
                    distance: result.distance,
                    call_chain: callChain,
                  },
                  analysis_type: 'shortest_path',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    } catch (error) {
      logger.error('traceFlow failed', {
        error: (error as Error).message,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: (error as Error).message,
                args,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
