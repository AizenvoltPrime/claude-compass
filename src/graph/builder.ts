import type { Knex } from 'knex';
import { Repository, File, Symbol } from '../database/models';
import * as RepositoryService from '../database/services/repository-service';
import * as DependencyService from '../database/services/dependency-service';
import * as CleanupService from '../database/services/cleanup-service';
import * as SymbolService from '../database/services/symbol-service';
import { ParseResult } from '../parsers';
import { FileGraphBuilder, FileGraphData } from './file-graph';
import { SymbolGraphBuilder, SymbolGraphData } from './symbol-graph';
import { CrossStackGraphBuilder } from './cross-stack-builder';
import { createComponentLogger } from '../utils/logger';

// Import all extracted modules
import {
  BuildOptions,
  BuildResult,
  BuildError,
  CrossStackGraphData,
  CrossStackGraphNode,
  CrossStackGraphEdge,
  CrossStackFeature,
  FileDiscoveryService,
  RepositoryManager,
  StorageOrchestrator,
  ChangeDetectionService,
  FileParsingOrchestrator,
  EmbeddingOrchestrator,
  GodotRelationshipBuilder,
  FrameworkEntityPersister,
  createImportsMap,
  createExportsMap,
  createDependenciesMap,
  createCrossFileFileDependencies,
  createExternalCallFileDependencies,
  createExternalImportFileDependencies,
} from './builder/';

// Re-export types for backward compatibility
export type {
  BuildOptions,
  BuildResult,
  BuildError,
  CrossStackGraphData,
  CrossStackGraphNode,
  CrossStackGraphEdge,
  CrossStackFeature,
};

const logger = createComponentLogger('graph-builder');

/**
 * GraphBuilder - Main Orchestrator
 *
 * Coordinates repository analysis by delegating to specialized services:
 * - FileDiscoveryService: File system traversal
 * - RepositoryManager: Repository lifecycle
 * - FileParsingOrchestrator: File parsing with size policies
 * - StorageOrchestrator: Database persistence
 * - EmbeddingOrchestrator: Embedding generation
 * - FrameworkEntityPersister: Framework entity storage
 * - ChangeDetectionService: Incremental analysis
 * - GodotRelationshipBuilder: Godot-specific relationships
 */
export class GraphBuilder {
  private db: Knex;
  private logger: any;
  private buildErrors: BuildError[] = [];

  // Graph builders
  private fileGraphBuilder: FileGraphBuilder;
  private symbolGraphBuilder: SymbolGraphBuilder;
  private crossStackGraphBuilder: CrossStackGraphBuilder;

  // Extracted services
  private fileDiscoveryService: FileDiscoveryService;
  private repositoryManager: RepositoryManager;
  private storageOrchestrator: StorageOrchestrator;
  private changeDetectionService: ChangeDetectionService;
  private fileParsingOrchestrator: FileParsingOrchestrator;
  private embeddingOrchestrator: EmbeddingOrchestrator;
  private godotRelationshipBuilder: GodotRelationshipBuilder;
  private frameworkEntityPersister: FrameworkEntityPersister;

  constructor(db: Knex) {
    this.db = db;
    this.logger = logger;

    // Initialize graph builders
    this.fileGraphBuilder = new FileGraphBuilder();
    this.symbolGraphBuilder = new SymbolGraphBuilder();
    this.crossStackGraphBuilder = new CrossStackGraphBuilder(db);

    // Initialize extracted services
    this.fileDiscoveryService = new FileDiscoveryService();
    this.repositoryManager = new RepositoryManager(db, this.fileDiscoveryService, logger);
    this.fileParsingOrchestrator = new FileParsingOrchestrator(db, logger);
    this.storageOrchestrator = new StorageOrchestrator(db, logger);
    this.embeddingOrchestrator = new EmbeddingOrchestrator(db, logger);
    this.frameworkEntityPersister = new FrameworkEntityPersister(db, logger);
    this.godotRelationshipBuilder = new GodotRelationshipBuilder(db, logger);

    // ChangeDetectionService depends on other services
    this.changeDetectionService = new ChangeDetectionService(
      db,
      this.fileDiscoveryService,
      this.repositoryManager,
      this.storageOrchestrator,
      this.fileParsingOrchestrator,
      this.embeddingOrchestrator,
      this.frameworkEntityPersister,
      this.godotRelationshipBuilder,
      this.fileGraphBuilder,
      this.symbolGraphBuilder,
      logger
    );
  }

  getBuildErrors(): BuildError[] {
    return this.buildErrors;
  }

  clearBuildErrors(): void {
    this.buildErrors = [];
  }

  async analyzeRepository(
    repositoryPath: string,
    options: BuildOptions = {}
  ): Promise<BuildResult> {
    const startTime = Date.now();
    this.buildErrors = [];

    this.logger.info('Starting repository analysis', {
      path: repositoryPath,
    });

    try {
      // Create or get repository record first to detect frameworks
      const repository = await this.repositoryManager.ensureRepository(repositoryPath);

      // Validate options with repository context for smart defaults
      const validatedOptions = this.repositoryManager.validateOptions(options, repository);

      // Automatically detect if incremental analysis is possible (unless forced full analysis)
      if (repository.last_indexed && !validatedOptions.forceFullAnalysis) {
        this.logger.info('Previous analysis detected, using incremental analysis mode');
        return await this.changeDetectionService.performIncrementalAnalysis(
          repositoryPath,
          repository,
          validatedOptions
        );
      } else {
        if (validatedOptions.forceFullAnalysis) {
          this.logger.info('Forcing full analysis mode');
        } else {
          this.logger.info('No previous analysis found, performing full analysis');
        }
      }

      // Full analysis path - clean up existing data for fresh analysis
      this.logger.info('Performing full analysis, cleaning up existing data', {
        repositoryId: repository.id,
      });
      await CleanupService.cleanupRepositoryData(this.db, repository.id);

      // Discover and process files
      const files = await this.fileDiscoveryService.discoverFiles(repositoryPath, validatedOptions);
      this.logger.info(`Discovered ${files.length} files`);

      // Parse files and extract symbols
      const parseResults = await this.fileParsingOrchestrator.parseFiles(files, validatedOptions);
      const errors = parseResults.flatMap(r =>
        r.errors.map(e => ({
          filePath: r.filePath,
          message: e.message,
        }))
      );

      // Store files and symbols in database
      const dbFiles = await this.storageOrchestrator.storeFiles(
        repository.id,
        files,
        parseResults
      );
      await this.storageOrchestrator.storeSymbols(dbFiles, parseResults);

      // Link symbol parent-child relationships
      await this.storageOrchestrator.linkSymbolHierarchy(repository.id);

      // Reload symbols from database to get updated parent_symbol_id values
      const symbols = await SymbolService.getSymbolsByRepository(this.db, repository.id);

      // Generate embeddings for symbols
      if (!validatedOptions.skipEmbeddings) {
        await this.embeddingOrchestrator.generateSymbolEmbeddings(repository.id);
      } else {
        this.logger.info('Skipping embedding generation (--skip-embeddings enabled)');
      }

      // Store framework entities
      await this.frameworkEntityPersister.storeFrameworkEntities(
        repository.id,
        symbols,
        parseResults
      );

      // Link route handlers to symbols
      await this.storageOrchestrator.linkRouteHandlers(repository.id);

      // Build graphs
      const importsMap = createImportsMap(dbFiles, parseResults);
      const exportsMap = createExportsMap(dbFiles, parseResults);
      const dependenciesMap = createDependenciesMap(symbols, parseResults, dbFiles);

      const [fileGraph, symbolGraph] = await Promise.all([
        this.fileGraphBuilder.buildFileGraph(repository, dbFiles, importsMap, exportsMap),
        this.symbolGraphBuilder.buildSymbolGraph(
          symbols,
          dependenciesMap,
          dbFiles,
          importsMap,
          exportsMap,
          repository.path
        ),
      ]);

      // Persist virtual framework symbols before creating dependencies
      await this.frameworkEntityPersister.persistVirtualFrameworkSymbols(
        repository,
        symbolGraph,
        symbols
      );

      // Store dependencies
      const fileDependencies = this.fileGraphBuilder.createFileDependencies(fileGraph, new Map());
      const symbolDependencies = this.symbolGraphBuilder.createSymbolDependencies(symbolGraph);

      const crossFileFileDependencies = createCrossFileFileDependencies(
        symbolDependencies,
        symbols,
        dbFiles
      );
      const externalCallFileDependencies = createExternalCallFileDependencies(
        parseResults,
        dbFiles,
        symbols
      );
      const externalImportFileDependencies = createExternalImportFileDependencies(
        parseResults,
        dbFiles
      );

      // Combine file dependencies
      const allFileDependencies = [
        ...fileDependencies,
        ...crossFileFileDependencies,
        ...externalCallFileDependencies,
        ...externalImportFileDependencies,
      ];

      // Store file dependencies in separate table
      if (allFileDependencies.length > 0) {
        await DependencyService.createFileDependencies(this.db, allFileDependencies);
      }

      // Store symbol dependencies
      if (symbolDependencies.length > 0) {
        await DependencyService.createDependencies(this.db, symbolDependencies);
      }

      // Build Godot-specific relationships (node-script, GetNode)
      await this.godotRelationshipBuilder.buildGodotRelationships(repository.id, parseResults);

      // Update repository with analysis results
      const gitHash = await this.repositoryManager.getGitHash(repositoryPath);
      await RepositoryService.updateRepository(this.db, repository.id, {
        last_indexed: new Date(),
        git_hash: gitHash,
      });

      // Phase 5 - Cross-stack analysis
      let crossStackGraph: CrossStackGraphData | undefined;
      if (validatedOptions.enableCrossStackAnalysis) {
        crossStackGraph = await this.performCrossStackAnalysis(repository.id);
      }

      // Query database for actual dependency counts after ALL storage operations (including cross-stack)
      const [fileDepsCount, symbolDepsCount] = await Promise.all([
        this.db('file_dependencies as fd')
          .join('files as f', 'fd.from_file_id', 'f.id')
          .where('f.repo_id', repository.id)
          .count('* as count')
          .first()
          .then(result => parseInt(result?.count as string) || 0),
        this.db('dependencies as d')
          .join('symbols as s', 'd.from_symbol_id', 's.id')
          .join('files as f', 's.file_id', 'f.id')
          .where('f.repo_id', repository.id)
          .count('* as count')
          .first()
          .then(result => parseInt(result?.count as string) || 0),
      ]);

      const totalDependenciesCreated = fileDepsCount + symbolDepsCount;

      const duration = Date.now() - startTime;
      this.logger.info('Repository analysis completed', {
        duration,
        filesProcessed: files.length,
        symbolsExtracted: symbols.length,
        dependenciesCreated: totalDependenciesCreated,
      });

      return {
        repository,
        filesProcessed: files.length,
        symbolsExtracted: symbols.length,
        dependenciesCreated: totalDependenciesCreated,
        fileGraph,
        symbolGraph,
        errors: [...errors, ...this.buildErrors],
        crossStackGraph,
        totalFiles: fileGraph.nodes.length,
        totalSymbols: symbolGraph.nodes.length,
      };
    } catch (error) {
      this.logger.error('Repository analysis failed', {
        path: repositoryPath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async performCrossStackAnalysis(repositoryId: number): Promise<CrossStackGraphData> {
    this.logger.info('Starting cross-stack analysis', { repositoryId });

    try {
      const fullStackGraph = await this.crossStackGraphBuilder.buildFullStackFeatureGraph(
        repositoryId
      );

      await this.crossStackGraphBuilder.storeCrossStackRelationships(
        fullStackGraph,
        repositoryId
      );

      // Query database for actual API call counts after all storage operations
      const apiCallStats: any = await this.db('api_calls as ac')
        .join('symbols as s', 'ac.caller_symbol_id', 's.id')
        .join('files as f', 's.file_id', 'f.id')
        .where('ac.repo_id', repositoryId)
        .select(
          this.db.raw("COUNT(*) FILTER (WHERE f.path LIKE '%.vue') as vue_calls"),
          this.db.raw("COUNT(*) FILTER (WHERE f.path LIKE '%.ts') as ts_calls"),
          this.db.raw('COUNT(*) as total_calls')
        )
        .first();

      const actualApiCallCount = parseInt(apiCallStats?.total_calls as string) || 0;
      const vueApiCallCount = parseInt(apiCallStats?.vue_calls as string) || 0;
      const tsApiCallCount = parseInt(apiCallStats?.ts_calls as string) || 0;

      // Query for backend API endpoint count
      const backendEndpointCount = await this.db('routes')
        .where('repo_id', repositoryId)
        .where('framework_type', 'laravel')
        .count('* as count')
        .first()
        .then(result => parseInt((result as any)?.count as string) || 0);

      // Update graph metadata with actual database counts
      if (fullStackGraph.apiCallGraph?.metadata) {
        fullStackGraph.apiCallGraph.metadata.apiCalls = actualApiCallCount;
        fullStackGraph.apiCallGraph.metadata.vueApiCalls = vueApiCallCount;
        fullStackGraph.apiCallGraph.metadata.typescriptApiCalls = tsApiCallCount;
        fullStackGraph.apiCallGraph.metadata.backendEndpoints = backendEndpointCount;
      }

      // Convert CrossStackGraphBuilder types to GraphBuilder types
      const convertGraph = (graph: any) => ({
        nodes: (graph?.nodes || []).map((node: any) => ({
          id: node.id,
          type: node.type,
          name: node.name,
          filePath: node.filePath,
          framework: node.framework,
          symbolId: node.metadata?.symbolId,
        })),
        edges: (graph?.edges || []).map((edge: any) => ({
          id: edge.id,
          from: edge.from,
          to: edge.to,
          type:
            edge.relationshipType === 'api_call'
              ? 'api_call'
              : edge.relationshipType === 'shares_schema'
                ? 'shares_schema'
                : 'frontend_backend',
          metadata: edge.metadata,
        })),
        metadata: graph?.metadata || {
          vueComponents: 0,
          laravelRoutes: 0,
          apiCalls: actualApiCallCount,
          vueApiCalls: vueApiCallCount,
          typescriptApiCalls: tsApiCallCount,
          backendEndpoints: backendEndpointCount,
          dataContracts: 0,
        },
      });

      const crossStackGraph: CrossStackGraphData = {
        apiCallGraph: convertGraph(fullStackGraph.apiCallGraph),
        dataContractGraph: convertGraph(fullStackGraph.dataContractGraph),
        features: (fullStackGraph.features || []).map((feature: any) => ({
          id: feature.id,
          name: feature.name,
          description: `Vue-Laravel feature: ${feature.name}`,
          components: [
            ...(feature.vueComponents || []).map((c: any) => ({
              id: c.id,
              type: c.type,
              name: c.name,
              filePath: c.filePath,
              framework: c.framework,
              symbolId: c.metadata?.symbolId,
            })),
            ...(feature.laravelRoutes || []).map((r: any) => ({
              id: r.id,
              type: r.type,
              name: r.name,
              filePath: r.filePath,
              framework: r.framework,
              symbolId: r.metadata?.symbolId,
            })),
          ],
          apiCalls: [],
          dataContracts: [],
        })),
        metadata: {
          totalApiCalls: actualApiCallCount,
          totalDataContracts: fullStackGraph.dataContractGraph?.metadata?.dataContracts || 0,
          analysisTimestamp: new Date(),
        },
      };

      this.logger.info('Cross-stack analysis completed', {
        apiCalls: actualApiCallCount,
        vueApiCalls: vueApiCallCount,
        tsApiCalls: tsApiCallCount,
        backendEndpoints: backendEndpointCount,
        features: crossStackGraph.features?.length || 0,
      });

      return crossStackGraph;
    } catch (error) {
      this.logger.error('Cross-stack analysis failed', {
        repositoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
