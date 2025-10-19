import { DatabaseService } from '../database/services';
import { SymbolType } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import { symbolImportanceRanker, SymbolForRanking } from '../graph/transitive-analyzer';

import { validateSearchCodeArgs } from './validators';
import {
  FileService,
  SymbolService,
  DependencyService,
  ImpactService,
  FlowService,
  FeatureDiscoveryService,
} from './services';
import { LaravelSearch, VueSearch, GodotSearch } from './search';
import {
  getFrameworkPath,
  mapEntityTypeToSymbolType,
  performSearchByMode,
} from './utils';

const logger = createComponentLogger('mcp-tools');

export class McpTools {
  private dbService: DatabaseService;
  private logger: any;
  private sessionId?: string;
  private defaultRepoId?: number;

  private fileService: FileService;
  private symbolService: SymbolService;
  private dependencyService: DependencyService;
  private impactService: ImpactService;
  private flowService: FlowService;
  private featureDiscoveryService: FeatureDiscoveryService;
  private laravelSearch: LaravelSearch;
  private vueSearch: VueSearch;
  private godotSearch: GodotSearch;

  constructor(dbService: DatabaseService, sessionId?: string) {
    this.dbService = dbService;
    this.sessionId = sessionId;
    this.logger = logger;

    this.fileService = new FileService(dbService);
    this.symbolService = new SymbolService(dbService);
    this.dependencyService = new DependencyService(dbService);
    this.impactService = new ImpactService(dbService);
    this.flowService = new FlowService(dbService);
    this.featureDiscoveryService = new FeatureDiscoveryService(dbService, () => this.getDefaultRepoId());
    this.laravelSearch = new LaravelSearch(dbService);
    this.vueSearch = new VueSearch(dbService);
    this.godotSearch = new GodotSearch(dbService);
  }

  setDefaultRepoId(repoId: number): void {
    this.defaultRepoId = repoId;
  }

  private getDefaultRepoId(): number | undefined {
    return this.defaultRepoId;
  }

  async getFile(args: any) {
    return this.fileService.getFile(args);
  }

  async getSymbol(args: any) {
    return this.symbolService.getSymbol(args);
  }

  async searchCode(args: any) {
    const validatedArgs = validateSearchCodeArgs(args);
    const defaultRepoId = this.getDefaultRepoId();
    const repoIds = validatedArgs.repo_ids || (defaultRepoId ? [defaultRepoId] : []);

    let detectedFramework = validatedArgs.framework;
    let frameworkAutoDetected = false;

    if (!detectedFramework && validatedArgs.entity_types && repoIds.length > 0) {
      const repositories = await Promise.all(
        repoIds.map(repoId => this.dbService.getRepository(repoId))
      );
      const frameworkStacks = repositories
        .filter(repo => repo)
        .flatMap(repo => repo.framework_stack || []);

      const entityTypes = validatedArgs.entity_types;
      if (
        entityTypes.includes('route') ||
        entityTypes.includes('model') ||
        entityTypes.includes('controller')
      ) {
        if (
          entityTypes.length === 1 &&
          (entityTypes.includes('model') || entityTypes.includes('controller'))
        ) {
          if (frameworkStacks.includes('laravel')) {
            detectedFramework = 'laravel';
            frameworkAutoDetected = true;
          }
        }
      }
      if (entityTypes.includes('component') && entityTypes.length === 1) {
        if (frameworkStacks.includes('vue')) {
          detectedFramework = 'vue';
          frameworkAutoDetected = true;
        }
      }
    }

    const searchOptions = {
      limit: 30,
      symbolTypes: [],
      isExported: validatedArgs.is_exported,
      repoIds: repoIds,
    };

    let symbols = [];

    if (validatedArgs.entity_types) {
      for (const entityType of validatedArgs.entity_types) {
        switch (entityType) {
          case 'route':
            symbols.push(
              ...(await this.laravelSearch.searchRoutes(
                validatedArgs.query,
                repoIds,
                validatedArgs.framework
              ))
            );
            break;
          case 'model':
            symbols.push(...(await this.laravelSearch.searchModels(validatedArgs.query, repoIds)));
            break;
          case 'controller':
            symbols.push(
              ...(await this.laravelSearch.searchControllers(validatedArgs.query, repoIds))
            );
            break;
          case 'component':
            symbols.push(
              ...(await this.vueSearch.searchComponents(
                validatedArgs.query,
                repoIds,
                validatedArgs.framework
              ))
            );
            break;
          case 'job':
            symbols.push(...(await this.laravelSearch.searchJobs(validatedArgs.query, repoIds)));
            break;
          case 'scene':
            symbols.push(...(await this.godotSearch.searchScenes(validatedArgs.query, repoIds)));
            break;
          case 'node':
            symbols.push(...(await this.godotSearch.searchNodes(validatedArgs.query, repoIds)));
            break;
          case 'script': {
            const symbolType = mapEntityTypeToSymbolType(entityType);
            if (symbolType) {
              searchOptions.symbolTypes = [symbolType];
            }
            const standardSymbols = await performSearchByMode(
              this.dbService,
              validatedArgs.query,
              repoIds[0] || defaultRepoId,
              searchOptions,
              validatedArgs.search_mode || 'auto'
            );
            symbols.push(...standardSymbols);
            break;
          }
          default: {
            const symbolType = mapEntityTypeToSymbolType(entityType);
            if (symbolType) {
              searchOptions.symbolTypes = [symbolType];
              if (entityType.toLowerCase() === 'function') {
                searchOptions.symbolTypes = [SymbolType.FUNCTION, SymbolType.METHOD];
              }
            }
            const standardSymbols = await performSearchByMode(
              this.dbService,
              validatedArgs.query,
              repoIds[0] || defaultRepoId,
              searchOptions,
              validatedArgs.search_mode || 'auto'
            );
            symbols.push(...standardSymbols);
          }
        }
      }
    } else {
      symbols = await performSearchByMode(
        this.dbService,
        validatedArgs.query,
        repoIds[0] || defaultRepoId,
        searchOptions,
        validatedArgs.search_mode || 'auto'
      );
    }

    let filteredSymbols = symbols;

    if (validatedArgs.framework) {
      filteredSymbols = filteredSymbols.filter(s => {
        const frameworkPath = getFrameworkPath(validatedArgs.framework!);
        const fileLanguage = s.file?.language;

        switch (validatedArgs.framework) {
          case 'laravel':
            return fileLanguage === 'php' || s.file?.path?.includes(frameworkPath);
          case 'vue':
            return fileLanguage === 'vue' || s.file?.path?.endsWith('.vue');
          case 'react':
            return (
              fileLanguage === 'javascript' ||
              fileLanguage === 'typescript' ||
              s.file?.path?.includes('components/')
            );
          case 'node':
            return fileLanguage === 'javascript' || fileLanguage === 'typescript';
          case 'godot':
            return (
              s.file?.path?.endsWith('.tscn') ||
              s.file?.path?.endsWith('.cs') ||
              s.file?.path?.includes('scripts/') ||
              s.file?.path?.includes('scenes/')
            );
          default:
            return s.file?.path?.includes(frameworkPath);
        }
      });
    }

    try {
      const symbolsForRanking: SymbolForRanking[] = filteredSymbols.map((symbol: any) => ({
        id: symbol.id,
        name: symbol.name,
        symbol_type: symbol.symbol_type,
        file_path: symbol.file?.path,
        depth: undefined,
      }));

      if (symbolsForRanking.length > 0) {
        const ranked = await symbolImportanceRanker.rankSymbols(symbolsForRanking);
        const scoreMap = new Map(ranked.map(r => [r.id, r.importance_score]));

        filteredSymbols = filteredSymbols.sort((a: any, b: any) => {
          const scoreA = scoreMap.get(a.id) || 0;
          const scoreB = scoreMap.get(b.id) || 0;
          return scoreB - scoreA;
        });
      }
    } catch (error) {
      this.logger.warn('Search result importance ranking failed, using original order', {
        error: (error as Error).message,
      });
    }

    const limit = 30;
    if (filteredSymbols.length > limit) {
      filteredSymbols = filteredSymbols.slice(0, limit);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query: validatedArgs.query,
              results: filteredSymbols.map(symbol => ({
                id: symbol.id,
                name: symbol.name,
                type: symbol.symbol_type,
                start_line: symbol.start_line,
                end_line: symbol.end_line,
                is_exported: symbol.is_exported,
                visibility: symbol.visibility,
                signature: symbol.signature,
                file: symbol.file
                  ? {
                      id: symbol.file.id,
                      path: symbol.file.path,
                      language: symbol.file.language,
                    }
                  : null,
              })),
              total_results: filteredSymbols.length,
              search_options: {
                limit: searchOptions.limit,
                symbol_types: searchOptions.symbolTypes,
                is_exported: searchOptions.isExported,
                repo_ids: searchOptions.repoIds,
              },
              query_filters: {
                entity_types: validatedArgs.entity_types,
                framework: detectedFramework,
                framework_auto_detected: frameworkAutoDetected,
                is_exported: validatedArgs.is_exported,
                repo_ids: repoIds,
                search_mode: validatedArgs.search_mode,
              },
              search_mode: 'enhanced_framework_aware',
              absorbed_tools: [
                'getLaravelRoutes',
                'getEloquentModels',
                'getLaravelControllers',
                'searchLaravelEntities',
              ],
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async whoCalls(args: any) {
    return this.dependencyService.whoCalls(args);
  }

  async listDependencies(args: any) {
    return this.dependencyService.listDependencies(args);
  }

  async impactOf(args: any) {
    return this.impactService.impactOf(args);
  }

  async traceFlow(args: any) {
    return this.flowService.traceFlow(args);
  }

  async discoverFeature(args: any) {
    return this.featureDiscoveryService.discoverFeature(args);
  }
}
