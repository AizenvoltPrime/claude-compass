import { DatabaseService } from '../../database/services';
import { SimplifiedDependency, ImpactAnalysisResponse } from '../../database/models';
import {
  transitiveAnalyzer,
  TransitiveAnalysisOptions,
  symbolImportanceRanker,
  SymbolForRanking,
} from '../../graph/transitive-analyzer';
import { DEFAULT_IMPACT_DEPTH } from '../constants';
import { ImpactOfArgs, ImpactItem, TestImpactItem, RouteImpactItem, JobImpactItem } from '../types';
import { validateImpactOfArgs } from '../validators';
import {
  getClassNameFromPath,
  determineTestType,
  classifyRelationshipImpact,
  getRelationshipContext,
  determineFramework,
  deduplicateImpactItems,
  convertImpactItemsToSimplifiedDeps,
} from '../utils';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('impact-service');

export class ImpactService {
  constructor(private dbService: DatabaseService) {}

  async impactOf(args: any) {
    const validatedArgs = validateImpactOfArgs(args);
    try {
      const symbol = await this.dbService.getSymbolWithFile(validatedArgs.symbol_id);
      if (!symbol) {
        throw new Error('Symbol not found');
      }

      const directImpact: ImpactItem[] = [];
      const transitiveImpact: ImpactItem[] = [];
      const testImpact: TestImpactItem[] = [];
      const routeImpact: RouteImpactItem[] = [];
      const jobImpact: JobImpactItem[] = [];
      const frameworksAffected = new Set<string>();

      const directDependencies = await this.dbService.getDependenciesFromWithContext(
        validatedArgs.symbol_id
      );
      const directCallers = await this.dbService.getDependenciesToWithContext(
        validatedArgs.symbol_id
      );

      const apiCallDependencies = await this.fetchApiCallDependencies(validatedArgs.symbol_id);
      const apiCallCallers = await this.fetchApiCallCallers(validatedArgs.symbol_id);

      for (const dep of directDependencies) {
        if (dep.to_symbol) {
          const framework = determineFramework(dep.to_symbol);
          directImpact.push({
            id: dep.to_symbol.id,
            name: dep.to_symbol.name,
            type: dep.to_symbol.symbol_type,
            file_path: dep.to_symbol.file?.path,
            impact_type: classifyRelationshipImpact(dep, 'dependency'),
            relationship_type: dep.dependency_type,
            relationship_context: getRelationshipContext(dep),
            direction: 'dependency',
            framework: framework,
            line_number: dep.line_number,
            to_qualified_name: dep.to_qualified_name,
          });

          if (framework) frameworksAffected.add(framework);
        }
      }

      for (const caller of directCallers) {
        if (caller.from_symbol) {
          const framework = determineFramework(caller.from_symbol);
          directImpact.push({
            id: caller.from_symbol.id,
            name: caller.from_symbol.name,
            type: caller.from_symbol.symbol_type,
            file_path: caller.from_symbol.file?.path,
            impact_type: classifyRelationshipImpact(caller, 'caller'),
            relationship_type: caller.dependency_type,
            relationship_context: getRelationshipContext(caller),
            direction: 'caller',
            framework: framework,
            line_number: caller.line_number,
          });

          if (framework) frameworksAffected.add(framework);
        }
      }

      for (const apiCall of apiCallDependencies) {
        if (apiCall.endpoint_symbol) {
          const framework = determineFramework(apiCall.endpoint_symbol);
          directImpact.push({
            id: apiCall.endpoint_symbol.id,
            name: apiCall.endpoint_symbol.name,
            type: apiCall.endpoint_symbol.symbol_type,
            file_path: apiCall.endpoint_symbol.file?.path,
            impact_type: 'cross_stack',
            relationship_type: 'api_call',
            relationship_context: `${apiCall.http_method} ${apiCall.endpoint_path}`,
            direction: 'dependency',
            framework: framework,
            line_number: apiCall.line_number,
          });

          if (framework) frameworksAffected.add(framework);
        }
      }

      for (const apiCall of apiCallCallers) {
        if (apiCall.caller_symbol) {
          const framework = determineFramework(apiCall.caller_symbol);
          directImpact.push({
            id: apiCall.caller_symbol.id,
            name: apiCall.caller_symbol.name,
            type: apiCall.caller_symbol.symbol_type,
            file_path: apiCall.caller_symbol.file?.path,
            impact_type: 'cross_stack',
            relationship_type: 'api_call',
            relationship_context: `${apiCall.http_method} ${apiCall.endpoint_path}`,
            direction: 'caller',
            framework: framework,
            line_number: apiCall.line_number,
          });

          if (framework) frameworksAffected.add(framework);
        }
      }

      const deduplicatedDirectImpact = deduplicateImpactItems(directImpact);

      let rankedDirectImpact = deduplicatedDirectImpact;
      try {
        const symbolsForRanking: SymbolForRanking[] = deduplicatedDirectImpact.map(item => ({
          id: item.id,
          name: item.name,
          symbol_type: item.type,
          file_path: item.file_path,
          depth: 1,
          qualified_name: item.to_qualified_name,
        }));

        if (symbolsForRanking.length > 0) {
          const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);
          const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

          rankedDirectImpact = deduplicatedDirectImpact.sort((a, b) => {
            const scoreA = scoreMap.get(a.id) || 0;
            const scoreB = scoreMap.get(b.id) || 0;
            return scoreB - scoreA;
          });

          logger.info('Ranked direct impact by importance', {
            totalSymbols: rankedDirectImpact.length,
            topSymbol: rankedDirectImpact[0]?.name,
            topScore: scoreMap.get(rankedDirectImpact[0]?.id),
            top3: rankedDirectImpact.slice(0, 3).map(item => ({
              name: item.name,
              score: scoreMap.get(item.id),
            })),
          });
        }
      } catch (error) {
        logger.warn('Direct impact ranking failed, using original order', {
          error: (error as Error).message,
        });
      }

      const maxDepth = validatedArgs.max_depth || DEFAULT_IMPACT_DEPTH;

      try {
        const transitiveOptions: TransitiveAnalysisOptions = {
          maxDepth,
          includeTypes: undefined,
          showCallChains: true,
          includeCrossStack: true,
        };

        const transitiveResult = await transitiveAnalyzer.getTransitiveDependencies(
          validatedArgs.symbol_id,
          transitiveOptions
        );

        for (const result of transitiveResult.results) {
          if (result.dependencies[0]?.to_symbol) {
            const toSymbol = result.dependencies[0].to_symbol;
            const framework = determineFramework(toSymbol);
            transitiveImpact.push({
              id: toSymbol.id,
              name: toSymbol.name,
              type: toSymbol.symbol_type,
              file_path: toSymbol.file?.path || '',
              impact_type: 'indirect',
              call_chain: result.call_chain,
              depth: result.depth,
              direction: 'dependency',
              framework: framework,
            });

            if (framework) frameworksAffected.add(framework);
          }
        }
      } catch (error) {
        logger.warn('Transitive analysis failed, continuing with direct impact only', {
          error: (error as Error).message,
        });
      }

      const allImpactedIds = new Set<number>([
        validatedArgs.symbol_id,
        ...rankedDirectImpact.map(item => item.id),
        ...transitiveImpact.map(item => item.id),
      ]);
      const impactedSymbolIds = Array.from(allImpactedIds);

      try {
        const routes = await this.getImpactedRoutes(impactedSymbolIds);
        routeImpact.push(...routes);
      } catch (error) {
        logger.warn('Route impact analysis failed', { error: (error as Error).message });
      }

      try {
        const jobs = await this.getImpactedJobs(impactedSymbolIds);
        jobImpact.push(...jobs);
      } catch (error) {
        logger.warn('Job impact analysis failed', { error: (error as Error).message });
      }

      try {
        const tests = await this.getImpactedTests(impactedSymbolIds);
        testImpact.push(...tests);
      } catch (error) {
        logger.warn('Test impact analysis failed', { error: (error as Error).message });
      }

      let rankedTransitiveImpact = transitiveImpact;
      try {
        const symbolsForRanking: SymbolForRanking[] = transitiveImpact.map(item => ({
          id: item.id,
          name: item.name,
          symbol_type: item.type,
          file_path: item.file_path,
          depth: item.depth,
          qualified_name: item.to_qualified_name,
        }));

        const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);
        const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

        rankedTransitiveImpact = transitiveImpact.sort((a, b) => {
          const scoreA = scoreMap.get(a.id) || 0;
          const scoreB = scoreMap.get(b.id) || 0;
          return scoreB - scoreA;
        });

        logger.info('Ranked transitive impact by importance', {
          totalSymbols: rankedTransitiveImpact.length,
          topSymbol: rankedTransitiveImpact[0]?.name,
          topScore: scoreMap.get(rankedTransitiveImpact[0]?.id),
        });
      } catch (error) {
        logger.warn('Importance ranking failed, using original order', {
          error: (error as Error).message,
        });
      }

      const deduplicatedTransitiveImpact = deduplicateImpactItems(
        rankedTransitiveImpact.filter(
          item => !rankedDirectImpact.some(directItem => directItem.id === item.id)
        )
      );

      const directImpactDeps: SimplifiedDependency[] = convertImpactItemsToSimplifiedDeps(
        rankedDirectImpact,
        symbol.name,
        symbol.file?.path,
        [...directDependencies, ...directCallers]
      );

      const indirectImpactDeps: SimplifiedDependency[] = convertImpactItemsToSimplifiedDeps(
        deduplicatedTransitiveImpact,
        symbol.name,
        symbol.file?.path,
        []
      );

      const maxDepthReached = Math.max(
        0,
        ...deduplicatedTransitiveImpact.map(item => item.depth || 0)
      );

      const response: ImpactAnalysisResponse = {
        direct_impact: directImpactDeps,
        indirect_impact: indirectImpactDeps,
        routes_affected: routeImpact.map(route => ({
          path: route.path,
          method: route.method,
          framework: route.framework,
        })),
        jobs_affected: jobImpact.map(job => ({
          name: job.name,
          type: job.type,
        })),
        tests_affected: testImpact.map(test => ({
          name: test.name,
          file_path: test.file_path,
        })),
        summary: {
          total_symbols: directImpactDeps.length + indirectImpactDeps.length,
          total_routes: routeImpact.length,
          total_jobs: jobImpact.length,
          total_tests: testImpact.length,
          max_depth: maxDepthReached,
          frameworks: Array.from(frameworksAffected),
        },
        query_info: {
          symbol: symbol.name,
          analysis_type: 'impact',
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
      logger.error('Comprehensive impact analysis failed', {
        error: (error as Error).message,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                symbol_id: validatedArgs.symbol_id,
                error: (error as Error).message,
                filters: validatedArgs,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  private async getImpactedRoutes(impactedSymbolIds: number[]): Promise<RouteImpactItem[]> {
    const routes: RouteImpactItem[] = [];

    try {
      const routeRecords = await this.dbService.getRoutesForSymbols(impactedSymbolIds);

      for (const route of routeRecords) {
        routes.push({
          id: route.id,
          path: route.path || '',
          method: route.method || 'GET',
          framework: route.framework_type || 'unknown',
        });
      }
    } catch (error) {
      logger.warn('Failed to analyze route impact', { error: (error as Error).message });
    }

    return routes;
  }

  private async getImpactedJobs(impactedSymbolIds: number[]): Promise<JobImpactItem[]> {
    const jobs: JobImpactItem[] = [];

    try {
      const jobRecords = await this.dbService.getJobsForSymbols(impactedSymbolIds);

      for (const job of jobRecords) {
        jobs.push({
          id: job.id,
          name: job.name,
          type: job.entity_type || 'background_job',
        });
      }
    } catch (error) {
      logger.warn('Failed to analyze job impact', { error: (error as Error).message });
    }

    return jobs;
  }

  private async getImpactedTests(impactedSymbolIds: number[]): Promise<TestImpactItem[]> {
    const tests: TestImpactItem[] = [];

    try {
      const testRecords = await this.dbService.getTestsForSymbols(impactedSymbolIds);

      for (const test of testRecords) {
        tests.push({
          id: test.id,
          name: test.name,
          file_path: test.file_path || '',
          test_type: determineTestType(test.file_path || ''),
        });
      }
    } catch (error) {
      logger.warn('Failed to analyze test impact', { error: (error as Error).message });
    }

    return tests;
  }

  private async fetchApiCallDependencies(symbolId: number): Promise<any[]> {
    const results = await this.dbService
      .knex('api_calls')
      .leftJoin('symbols as caller_symbols', 'api_calls.caller_symbol_id', 'caller_symbols.id')
      .leftJoin('files as caller_files', 'caller_symbols.file_id', 'caller_files.id')
      .leftJoin(
        'symbols as endpoint_symbols',
        'api_calls.endpoint_symbol_id',
        'endpoint_symbols.id'
      )
      .leftJoin('files as endpoint_files', 'endpoint_symbols.file_id', 'endpoint_files.id')
      .where('api_calls.caller_symbol_id', symbolId)
      .select(
        'api_calls.id',
        'api_calls.caller_symbol_id',
        'api_calls.endpoint_symbol_id',
        'api_calls.http_method',
        'api_calls.endpoint_path',
        'api_calls.line_number',
        'endpoint_symbols.id as endpoint_symbol_id',
        'endpoint_symbols.name as endpoint_symbol_name',
        'endpoint_symbols.symbol_type as endpoint_symbol_type',
        'endpoint_files.path as endpoint_file_path'
      );

    return results.map(row => ({
      http_method: row.http_method,
      endpoint_path: row.endpoint_path,
      line_number: row.line_number,
      endpoint_symbol: {
        id: row.endpoint_symbol_id,
        name: row.endpoint_symbol_name,
        symbol_type: row.endpoint_symbol_type,
        file: {
          path: row.endpoint_file_path,
        },
      },
    }));
  }

  private async fetchApiCallCallers(symbolId: number): Promise<any[]> {
    const results = await this.dbService
      .knex('api_calls')
      .leftJoin('symbols as caller_symbols', 'api_calls.caller_symbol_id', 'caller_symbols.id')
      .leftJoin('files as caller_files', 'caller_symbols.file_id', 'caller_files.id')
      .leftJoin(
        'symbols as endpoint_symbols',
        'api_calls.endpoint_symbol_id',
        'endpoint_symbols.id'
      )
      .leftJoin('files as endpoint_files', 'endpoint_symbols.file_id', 'endpoint_files.id')
      .where('api_calls.endpoint_symbol_id', symbolId)
      .select(
        'api_calls.id',
        'api_calls.caller_symbol_id',
        'api_calls.endpoint_symbol_id',
        'api_calls.http_method',
        'api_calls.endpoint_path',
        'api_calls.line_number',
        'caller_symbols.id as caller_symbol_id',
        'caller_symbols.name as caller_symbol_name',
        'caller_symbols.symbol_type as caller_symbol_type',
        'caller_files.path as caller_file_path'
      );

    return results.map(row => ({
      http_method: row.http_method,
      endpoint_path: row.endpoint_path,
      line_number: row.line_number,
      caller_symbol: {
        id: row.caller_symbol_id,
        name: row.caller_symbol_name,
        symbol_type: row.caller_symbol_type,
        file: {
          path: row.caller_file_path,
        },
      },
    }));
  }
}
