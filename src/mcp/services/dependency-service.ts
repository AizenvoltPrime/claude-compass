import { DatabaseService } from '../../database/services';
import {
  DependencyType,
  SimplifiedDependency,
  SimplifiedDependencyResponse,
} from '../../database/models';
import {
  transitiveAnalyzer,
  TransitiveAnalysisOptions,
  symbolImportanceRanker,
  SymbolForRanking,
} from '../../graph/transitive-analyzer';
import {
  DEFAULT_DEPENDENCY_DEPTH,
  TRANSITIVE_ANALYSIS_THRESHOLD,
} from '../constants';
import { WhoCallsArgs, ListDependenciesArgs } from '../types';
import { validateWhoCallsArgs, validateListDependenciesArgs } from '../validators';
import {
  getClassNameFromPath,
  deduplicateRelationships,
  consolidateRelatedSymbols,
} from '../utils';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('dependency-service');

/**
 * Generates insights from parameter variations analysis
 */
function generateParameterInsights(parameterVariations: Array<{ parameters: string; call_count: number }>): string[] {
  const insights: string[] = [];

  if (parameterVariations.length > 0) {
    insights.push(`Method called with ${parameterVariations.length} different parameter pattern${parameterVariations.length === 1 ? '' : 's'}`);

    const nullPatterns = parameterVariations.filter(v =>
      v.parameters.toLowerCase().includes('null')
    );

    if (nullPatterns.length > 0) {
      insights.push(`${nullPatterns.length} call pattern(s) use null parameters`);
    }
  }

  return insights;
}

export class DependencyService {
  constructor(private dbService: DatabaseService) {}

  async whoCalls(args: any) {
    const validatedArgs = validateWhoCallsArgs(args);

    const timeoutMs = 10000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('whoCalls operation timed out after 10 seconds')),
        timeoutMs
      );
    });

    try {
      const symbol = (await Promise.race([
        this.dbService.getSymbolWithFile(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      let callers = (await Promise.race([
        this.dbService.getDependenciesToWithContext(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;

      if (validatedArgs.include_cross_stack) {
        try {
          const crossStackCallers = await this.dbService.getCrossStackApiCallers(
            validatedArgs.symbol_id
          );
          if (crossStackCallers.length > 0) {
            callers = [...callers, ...crossStackCallers];
          }
        } catch (error) {
          logger.warn('Failed to fetch cross-stack callers', {
            error: (error as Error).message,
            symbolId: validatedArgs.symbol_id,
          });
        }
      }

      if (validatedArgs.dependency_type) {
        const depType = validatedArgs.dependency_type as DependencyType;
        callers = callers.filter(caller => caller.dependency_type === depType);
      }

      const directCallers = [...callers];

      let transitiveResults: any[] = [];

      const maxDepth =
        validatedArgs.max_depth !== undefined ? validatedArgs.max_depth : DEFAULT_DEPENDENCY_DEPTH;

      const skipTransitive =
        maxDepth === 1 ||
        callers.length > TRANSITIVE_ANALYSIS_THRESHOLD ||
        validatedArgs.include_cross_stack ||
        validatedArgs.dependency_type;

      if (!skipTransitive) {
        try {
          const transitiveOptions: TransitiveAnalysisOptions = {
            maxDepth: maxDepth,
            includeTypes: validatedArgs.dependency_type
              ? [validatedArgs.dependency_type as DependencyType]
              : undefined,
            includeCrossStack: false,
            showCallChains: true,
          };

          const transitiveResult = await transitiveAnalyzer.getTransitiveCallers(
            validatedArgs.symbol_id,
            transitiveOptions
          );

          transitiveResults = transitiveResult.results;

          const transitiveDependencies = transitiveResult.results
            .map(result => {
              const firstDep = result.dependencies[0];
              if (!firstDep?.from_symbol) return null;

              return {
                id: result.symbolId,
                from_symbol_id: result.symbolId,
                to_symbol_id: firstDep.to_symbol_id,
                dependency_type: firstDep.dependency_type,
                line_number: firstDep.line_number,
                created_at: new Date(),
                updated_at: new Date(),
                from_symbol: firstDep.from_symbol,
                to_symbol: firstDep.to_symbol,
                call_chain: result.call_chain,
                path: result.path,
                depth: result.depth,
              };
            })
            .filter(Boolean);

          const deduplicatedTransitive = deduplicateRelationships(
            transitiveDependencies,
            callers
          );
          callers = [...callers, ...deduplicatedTransitive];
        } catch (error) {
          logger.error('Enhanced transitive caller analysis failed', {
            symbol_id: validatedArgs.symbol_id,
            error: (error as Error).message,
          });
        }
      }

      callers = consolidateRelatedSymbols(callers);

      try {
        const symbolsForRanking: SymbolForRanking[] = callers
          .filter(caller => caller.from_symbol)
          .map(caller => ({
            id: caller.from_symbol.id,
            name: caller.from_symbol.name,
            symbol_type: caller.from_symbol.symbol_type,
            file_path: caller.from_symbol.file?.path,
            depth: caller.depth,
          }));

        if (symbolsForRanking.length > 0) {
          const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);
          const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

          callers = callers.sort((a, b) => {
            if (!a.from_symbol || !b.from_symbol) return 0;
            const scoreA = scoreMap.get(a.from_symbol.id) || 0;
            const scoreB = scoreMap.get(b.from_symbol.id) || 0;
            return scoreB - scoreA;
          });

          logger.debug('Ranked callers by importance', {
            totalCallers: callers.length,
            topCaller: callers[0]?.from_symbol?.name,
            topScore: scoreMap.get(callers[0]?.from_symbol?.id),
          });
        }
      } catch (error) {
        logger.warn('Caller importance ranking failed, using original order', {
          error: (error as Error).message,
        });
      }

      const dependencies: SimplifiedDependency[] = callers.map(caller => {
        const toName = symbol.name;
        const fromFile = caller.from_symbol?.file?.path;
        const toFile = symbol.file?.path;
        const fromName = caller.from_symbol?.name || 'unknown';

        const qualifiedFromName =
          fromFile && fromName !== 'unknown'
            ? `${getClassNameFromPath(fromFile)}.${fromName}`
            : fromName;

        const qualifiedToName = caller.to_qualified_name
          ? caller.to_qualified_name
          : toFile
            ? `${getClassNameFromPath(toFile)}.${toName}`
            : toName;

        const dep: SimplifiedDependency = {
          from: qualifiedFromName,
          to: qualifiedToName,
          type: caller.dependency_type,
          line_number: caller.line_number,
          file_path: fromFile,
          qualified_context: caller.qualified_context,
          parameter_types: caller.parameter_types,
          parameter_context: caller.parameter_context,
        };

        if (caller.call_chain) {
          dep.call_chain = caller.call_chain;
          dep.depth = caller.depth;
        }

        if (caller.is_cross_stack) {
          dep.is_cross_stack = true;
          dep.http_method = caller.http_method;
          dep.endpoint_path = caller.endpoint_path;
        }

        return dep;
      });

      const response: SimplifiedDependencyResponse = {
        dependencies,
        total_count: dependencies.length,
        query_info: {
          symbol: symbol.name,
          analysis_type: 'callers',
          timestamp: new Date().toISOString(),
        },
      };

      const hasParameterContext = directCallers.some(c => c.parameter_context);
      if (hasParameterContext) {
        try {
          const paramAnalysis = await this.dbService.groupCallsByParameterContext(
            validatedArgs.symbol_id
          );

          const parameterVariationsFormatted = paramAnalysis.parameterVariations.map(v => ({
            parameters: v.parameter_context,
            call_count: v.call_count,
            call_instance_ids: v.call_instance_ids,
            line_numbers: v.line_numbers,
            parameter_types: v.parameter_types,
          }));

          response.parameter_analysis = {
            total_variations: parameterVariationsFormatted.length,
            parameter_variations: parameterVariationsFormatted,
            insights: generateParameterInsights(parameterVariationsFormatted),
          };
        } catch (error) {
          logger.warn('Failed to generate parameter analysis', {
            error: (error as Error).message,
            symbolId: validatedArgs.symbol_id,
          });
        }
      }

      if (transitiveResults.length > 0) {
        response.transitive_analysis = {
          max_depth: maxDepth,
          total_transitive_callers: transitiveResults.length,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('whoCalls operation failed', {
        error: (error as Error).message,
        symbolId: validatedArgs.symbol_id,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: (error as Error).message,
                symbol_id: validatedArgs.symbol_id,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async listDependencies(args: any) {
    const validatedArgs = validateListDependenciesArgs(args);

    const timeoutMs = 10000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('listDependencies operation timed out after 10 seconds')),
        timeoutMs
      );
    });

    try {
      const symbol = (await Promise.race([
        this.dbService.getSymbolWithFile(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      let dependencies = (await Promise.race([
        this.dbService.getDependenciesFromWithContext(validatedArgs.symbol_id),
        timeoutPromise,
      ])) as any;

      if (validatedArgs.include_cross_stack) {
        try {
          const crossStackDeps = await this.dbService.getCrossStackApiDependencies(
            validatedArgs.symbol_id
          );
          if (crossStackDeps.length > 0) {
            dependencies = [...dependencies, ...crossStackDeps];
          }
        } catch (error) {
          logger.warn('Failed to fetch cross-stack dependencies', {
            error: (error as Error).message,
            symbolId: validatedArgs.symbol_id,
          });
        }
      }

      if (validatedArgs.dependency_type) {
        const depType = validatedArgs.dependency_type as DependencyType;
        dependencies = dependencies.filter(dep => dep.dependency_type === depType);
      }

      let transitiveResults: any[] = [];

      const maxDepth =
        validatedArgs.max_depth !== undefined ? validatedArgs.max_depth : DEFAULT_DEPENDENCY_DEPTH;

      const skipTransitive =
        maxDepth === 1 ||
        dependencies.length > TRANSITIVE_ANALYSIS_THRESHOLD ||
        validatedArgs.include_cross_stack;

      if (!skipTransitive) {
        try {
          const transitiveOptions: TransitiveAnalysisOptions = {
            maxDepth: maxDepth,
            includeTypes: validatedArgs.dependency_type
              ? [validatedArgs.dependency_type as DependencyType]
              : undefined,
            includeCrossStack: false,
            showCallChains: true,
          };

          const transitiveResult = (await Promise.race([
            transitiveAnalyzer.getTransitiveDependencies(
              validatedArgs.symbol_id,
              transitiveOptions
            ),
            timeoutPromise,
          ])) as any;

          transitiveResults = transitiveResult.results;

          const transitiveDependencies = transitiveResult.results
            .map(result => {
              const firstDep = result.dependencies[0];
              if (!firstDep?.to_symbol) return null;

              return {
                id: result.symbolId,
                from_symbol_id: firstDep.from_symbol_id,
                to_symbol_id: result.symbolId,
                dependency_type: firstDep.dependency_type,
                line_number: firstDep.line_number,
                created_at: new Date(),
                updated_at: new Date(),
                from_symbol: firstDep.from_symbol,
                to_symbol: firstDep.to_symbol,
                call_chain: result.call_chain,
                path: result.path,
                depth: result.depth,
              };
            })
            .filter(Boolean);

          const deduplicatedTransitive = deduplicateRelationships(
            transitiveDependencies,
            dependencies
          );
          dependencies = [...dependencies, ...deduplicatedTransitive];
        } catch (error) {
          logger.error('Enhanced transitive dependency analysis failed', {
            symbol_id: validatedArgs.symbol_id,
            error: (error as Error).message,
          });
        }
      }

      dependencies = consolidateRelatedSymbols(dependencies);

      try {
        const symbolsForRanking: SymbolForRanking[] = dependencies
          .filter((dep: any) => dep.to_symbol)
          .map((dep: any) => ({
            id: dep.to_symbol.id,
            name: dep.to_symbol.name,
            symbol_type: dep.to_symbol.symbol_type,
            file_path: dep.to_symbol.file?.path,
            depth: dep.depth,
          }));

        if (symbolsForRanking.length > 0) {
          const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);
          const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

          dependencies = dependencies.sort((a: any, b: any) => {
            if (!a.to_symbol || !b.to_symbol) return 0;
            const scoreA = scoreMap.get(a.to_symbol.id) || 0;
            const scoreB = scoreMap.get(b.to_symbol.id) || 0;
            return scoreB - scoreA;
          });

          logger.debug('Ranked dependencies by importance', {
            totalDeps: dependencies.length,
            topDep: dependencies[0]?.to_symbol?.name,
            topScore: scoreMap.get(dependencies[0]?.to_symbol?.id),
          });
        }
      } catch (error) {
        logger.warn('Dependency importance ranking failed, using original order', {
          error: (error as Error).message,
        });
      }

      const simplifiedDeps: SimplifiedDependency[] = dependencies.map((dep: any) => {
        if (!dep.from_symbol?.file?.path) {
          logger.error('Missing from_symbol file path in dependency', {
            from_symbol_id: dep.from_symbol_id,
            to_symbol_id: dep.to_symbol_id,
            line_number: dep.line_number,
          });
        }
        if (!dep.to_symbol?.file?.path) {
          logger.error('Missing to_symbol file path in dependency', {
            from_symbol_id: dep.from_symbol_id,
            to_symbol_id: dep.to_symbol_id,
            line_number: dep.line_number,
          });
        }
        if (!dep.from_symbol?.name) {
          logger.error('Missing from_symbol name in dependency', {
            from_symbol_id: dep.from_symbol_id,
            to_symbol_id: dep.to_symbol_id,
            line_number: dep.line_number,
          });
        }

        const toName = dep.to_symbol?.name || 'unknown';
        const toFile = dep.to_symbol?.file?.path;
        const fromFile = dep.from_symbol?.file?.path;
        const fromName = dep.from_symbol?.name || 'unknown';

        const qualifiedFromName =
          fromFile && fromName !== 'unknown'
            ? `${getClassNameFromPath(fromFile)}.${fromName}`
            : fromName;

        const qualifiedToName = dep.to_qualified_name
          ? dep.to_qualified_name
          : toFile && toName !== 'unknown'
            ? `${getClassNameFromPath(toFile)}.${toName}`
            : toName;

        const simplifiedDep: SimplifiedDependency = {
          from: qualifiedFromName,
          to: qualifiedToName,
          type: dep.dependency_type,
          line_number: dep.line_number,
          file_path: fromFile,
          qualified_context: dep.qualified_context,
          parameter_types: dep.parameter_types,
          parameter_context: dep.parameter_context,
        };

        if (dep.call_chain) {
          simplifiedDep.call_chain = dep.call_chain;
          simplifiedDep.depth = dep.depth;
        }

        if (dep.is_cross_stack) {
          simplifiedDep.is_cross_stack = true;
          simplifiedDep.http_method = dep.http_method;
          simplifiedDep.endpoint_path = dep.endpoint_path;
        }

        return simplifiedDep;
      });

      const response: SimplifiedDependencyResponse = {
        dependencies: simplifiedDeps,
        total_count: simplifiedDeps.length,
        query_info: {
          symbol: symbol.name,
          analysis_type: 'dependencies',
          timestamp: new Date().toISOString(),
        },
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('listDependencies operation failed', {
        error: (error as Error).message,
        symbolId: validatedArgs.symbol_id,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: (error as Error).message,
                symbol_id: validatedArgs.symbol_id,
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
