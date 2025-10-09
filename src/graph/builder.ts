import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import pLimit from 'p-limit';
import {
  Repository,
  File,
  Symbol,
  SymbolType,
  CreateFile,
  CreateSymbol,
  CreateFileDependency,
  DependencyType,
  ApiCall,
  DataContract,
} from '../database/models';
import { DatabaseService } from '../database/services';
import { getParserForFile, ParseResult, MultiParser } from '../parsers';
import {
  VueComponent,
  ReactComponent,
  VueComposable,
  ReactHook,
  NextJSRoute,
  ExpressRoute,
  FastifyRoute,
  VueRoute,
  ParsedDependency,
} from '../parsers/base';
import { LaravelRoute, LaravelController, EloquentModel } from '../parsers/laravel';
import { FileGraphBuilder, FileGraphData } from './file-graph';
import { SymbolGraphBuilder, SymbolGraphData } from './symbol-graph';
import { CrossStackGraphBuilder } from './cross-stack-builder';
import { GodotRelationshipBuilder } from './godot-relationship-builder';
import { createComponentLogger } from '../utils/logger';
import { FileSizeManager, FileSizePolicy, DEFAULT_POLICY } from '../config/file-size-policy';
import { EncodingConverter } from '../utils/encoding-converter';
import { CompassIgnore } from '../utils/compassignore';
import { getEmbeddingService } from '../services/embedding-service';
import { AdaptiveEmbeddingController } from '../utils/adaptive-embedding-controller';

const logger = createComponentLogger('graph-builder');

export interface BuildOptions {
  includeTestFiles?: boolean;
  includeNodeModules?: boolean;
  maxFiles?: number;
  fileExtensions?: string[];

  fileSizePolicy?: FileSizePolicy;
  chunkOverlapLines?: number;
  encodingFallback?: string;
  compassignorePath?: string;
  enableParallelParsing?: boolean;
  maxConcurrency?: number;
  skipEmbeddings?: boolean;
  forceFullAnalysis?: boolean;

  // Phase 5 - Cross-stack analysis options
  enableCrossStackAnalysis?: boolean;
  detectFrameworks?: boolean;
  verbose?: boolean;
}

export interface BuildResult {
  repository: Repository;
  filesProcessed: number;
  symbolsExtracted: number;
  dependenciesCreated: number;
  fileGraph: FileGraphData;
  symbolGraph: SymbolGraphData;
  errors: BuildError[];

  // Phase 5 - Cross-stack analysis results
  crossStackGraph?: CrossStackGraphData;
  totalFiles?: number;
  totalSymbols?: number;
}

export interface BuildError {
  filePath: string;
  message: string;
  stack?: string;
}

// Cross-stack graph data structure for Phase 5
export interface CrossStackGraphData {
  apiCallGraph?: {
    nodes: CrossStackGraphNode[];
    edges: CrossStackGraphEdge[];
  };
  dataContractGraph?: {
    nodes: CrossStackGraphNode[];
    edges: CrossStackGraphEdge[];
  };
  features?: CrossStackFeature[];
  metadata?: {
    totalApiCalls?: number;
    totalDataContracts?: number;
    analysisTimestamp?: Date;
  };
}

export interface CrossStackGraphNode {
  id: string;
  type:
    | 'vue_component'
    | 'laravel_route'
    | 'typescript_interface'
    | 'php_dto'
    | 'api_call'
    | 'data_contract';
  name: string;
  filePath: string;
  framework: 'vue' | 'laravel' | 'cross-stack';
  symbolId?: number;
}

export interface CrossStackGraphEdge {
  id: string;
  from: string;
  to: string;
  type: 'api_call' | 'shares_schema' | 'frontend_backend';
  metadata?: Record<string, any>;
}

export interface CrossStackFeature {
  id: string;
  name: string;
  description?: string;
  components: CrossStackGraphNode[];
  apiCalls: ApiCall[];
  dataContracts: DataContract[];
}

export class GraphBuilder {
  private dbService: DatabaseService;
  private fileGraphBuilder: FileGraphBuilder;
  private symbolGraphBuilder: SymbolGraphBuilder;
  private crossStackGraphBuilder: CrossStackGraphBuilder;
  private godotRelationshipBuilder: GodotRelationshipBuilder;
  private logger: any;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
    this.fileGraphBuilder = new FileGraphBuilder();
    this.symbolGraphBuilder = new SymbolGraphBuilder();
    this.crossStackGraphBuilder = new CrossStackGraphBuilder(dbService);
    this.godotRelationshipBuilder = new GodotRelationshipBuilder(dbService);
    this.logger = logger;
  }

  /**
   * Analyze a repository and build complete graphs
   */
  async analyzeRepository(
    repositoryPath: string,
    options: BuildOptions = {}
  ): Promise<BuildResult> {
    const startTime = Date.now();

    this.logger.info('Starting repository analysis', {
      path: repositoryPath,
    });

    const validatedOptions = this.validateOptions(options);

    try {
      // Create or get repository record
      const repository = await this.ensureRepository(repositoryPath);

      // Automatically detect if incremental analysis is possible (unless forced full analysis)
      if (repository.last_indexed && !validatedOptions.forceFullAnalysis) {
        this.logger.info('Previous analysis detected, using incremental analysis mode');
        return await this.performIncrementalAnalysis(repositoryPath, repository, validatedOptions);
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
      await this.dbService.cleanupRepositoryData(repository.id);

      // Discover and process files
      const files = await this.discoverFiles(repositoryPath, validatedOptions);
      this.logger.info(`Discovered ${files.length} files`);

      // Parse files and extract symbols
      const parseResults = await this.parseFiles(files, validatedOptions);
      const errors = parseResults.flatMap(r =>
        r.errors.map(e => ({
          filePath: r.filePath,
          message: e.message,
        }))
      );

      // Store files and symbols in database
      const dbFiles = await this.storeFiles(repository.id, files, parseResults);
      const symbols = await this.storeSymbols(dbFiles, parseResults);

      // Generate embeddings for symbols
      if (!validatedOptions.skipEmbeddings) {
        await this.generateSymbolEmbeddings(repository.id);
      } else {
        this.logger.info('Skipping embedding generation (--skip-embeddings enabled)');
      }

      // Store framework entities
      await this.storeFrameworkEntities(repository.id, symbols, parseResults);

      // Build graphs
      const importsMap = this.createImportsMap(dbFiles, parseResults);
      const exportsMap = this.createExportsMap(dbFiles, parseResults);
      const dependenciesMap = this.createDependenciesMap(symbols, parseResults, dbFiles);

      const [fileGraph, symbolGraph] = await Promise.all([
        this.fileGraphBuilder.buildFileGraph(repository, dbFiles, importsMap, exportsMap),
        this.symbolGraphBuilder.buildSymbolGraph(
          symbols,
          dependenciesMap,
          dbFiles,
          importsMap,
          exportsMap
        ),
      ]);

      // Persist virtual framework symbols before creating dependencies
      await this.persistVirtualFrameworkSymbols(repository, symbolGraph, symbols);

      // Store dependencies
      const fileDependencies = this.fileGraphBuilder.createFileDependencies(fileGraph, new Map());
      const symbolDependencies = this.symbolGraphBuilder.createSymbolDependencies(symbolGraph);

      const [
        crossFileFileDependencies,
        externalCallFileDependencies,
        externalImportFileDependencies,
      ] = await Promise.all([
        this.createCrossFileFileDependencies(symbolDependencies, symbols, dbFiles),
        this.createExternalCallFileDependencies(parseResults, dbFiles, symbols),
        this.createExternalImportFileDependencies(parseResults, dbFiles),
      ]);

      // Combine file dependencies
      const allFileDependencies = [
        ...fileDependencies,
        ...crossFileFileDependencies,
        ...externalCallFileDependencies,
        ...externalImportFileDependencies,
      ];

      // Store file dependencies in separate table
      if (allFileDependencies.length > 0) {
        await this.dbService.createFileDependencies(allFileDependencies);
      }

      // Store symbol dependencies
      if (symbolDependencies.length > 0) {
        await this.dbService.createDependencies(symbolDependencies);
      }

      // Update repository with analysis results
      await this.dbService.updateRepository(repository.id, {
        last_indexed: new Date(),
        git_hash: await this.getGitHash(repositoryPath),
      });

      const duration = Date.now() - startTime;
      this.logger.info('Repository analysis completed', {
        duration,
        filesProcessed: files.length,
        symbolsExtracted: symbols.length,
      });

      // Phase 5 - Cross-stack analysis
      let crossStackGraph: CrossStackGraphData | undefined;
      if (validatedOptions.enableCrossStackAnalysis) {
        this.logger.info('Starting cross-stack analysis', {
          repositoryId: repository.id,
        });
        try {
          const fullStackGraph = await this.crossStackGraphBuilder.buildFullStackFeatureGraph(
            repository.id
          );

          await this.crossStackGraphBuilder.storeCrossStackRelationships(
            fullStackGraph,
            repository.id
          );

          // Convert CrossStackGraphBuilder types to GraphBuilder types
          const convertGraph = (graph: any) => ({
            nodes: graph.nodes.map((node: any) => ({
              id: node.id,
              type: node.type,
              name: node.name,
              filePath: node.filePath,
              framework: node.framework,
              symbolId: node.metadata?.symbolId,
            })),
            edges: graph.edges.map((edge: any) => ({
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
          });

          crossStackGraph = {
            apiCallGraph: convertGraph(fullStackGraph.apiCallGraph),
            dataContractGraph: convertGraph(fullStackGraph.dataContractGraph),
            features: fullStackGraph.features.map((feature: any) => ({
              id: feature.id,
              name: feature.name,
              description: `Vue-Laravel feature: ${feature.name}`,
              components: [
                ...feature.vueComponents.map((c: any) => ({
                  id: c.id,
                  type: c.type,
                  name: c.name,
                  filePath: c.filePath,
                  framework: c.framework,
                  symbolId: c.metadata?.symbolId,
                })),
                ...feature.laravelRoutes.map((r: any) => ({
                  id: r.id,
                  type: r.type,
                  name: r.name,
                  filePath: r.filePath,
                  framework: r.framework,
                  symbolId: r.metadata?.symbolId,
                })),
              ],
              apiCalls: [], // Will be populated from database if needed
              dataContracts: [], // Will be populated from database if needed
            })),
            metadata: {
              totalApiCalls: fullStackGraph.apiCallGraph.edges.length,
              totalDataContracts: fullStackGraph.dataContractGraph.edges.length,
              analysisTimestamp: new Date(),
            },
          };
          this.logger.info('Cross-stack analysis completed', {
            apiCalls: crossStackGraph.metadata.totalApiCalls,
            dataContracts: crossStackGraph.metadata.totalDataContracts,
          });
        } catch (error) {
          this.logger.error('Cross-stack analysis failed', { error });
          // Continue without cross-stack graph
        }
      }

      return {
        repository,
        filesProcessed: files.length,
        symbolsExtracted: symbols.length,
        dependenciesCreated: fileDependencies.length + symbolDependencies.length,
        fileGraph,
        symbolGraph,
        errors,
        totalFiles: files.length,
        totalSymbols: symbols.length,
        crossStackGraph,
      };
    } catch (error) {
      this.logger.error('Repository analysis failed', { error });
      throw error;
    }
  }

  /**
   * Detect files that have changed since last analysis
   */
  private async detectChangedFiles(
    repositoryPath: string,
    repository: Repository,
    options: BuildOptions
  ): Promise<string[]> {
    const changedFiles: string[] = [];

    try {
      // Get last analysis timestamp from repository metadata
      const lastIndexed = repository.last_indexed;
      if (!lastIndexed) {
        // No previous analysis - all files are "changed"
        this.logger.info('No previous analysis found, treating all files as changed');
        const allFiles = await this.discoverFiles(repositoryPath, options);
        return allFiles.map(f => f.path);
      }

      this.logger.info('Detecting changes since last analysis', {
        lastIndexed: lastIndexed.toISOString(),
      });

      // Discover all current files
      const currentFiles = await this.discoverFiles(repositoryPath, options);

      // Check each file's modification time
      for (const fileInfo of currentFiles) {
        try {
          const stats = await fs.stat(fileInfo.path);
          if (stats.mtime > lastIndexed) {
            changedFiles.push(fileInfo.path);
          }
        } catch (error) {
          // File might have been deleted, skip it
          this.logger.warn('Error checking file modification time', {
            file: fileInfo.path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.logger.info('Change detection completed', {
        totalFiles: currentFiles.length,
        changedFiles: changedFiles.length,
      });

      return changedFiles;
    } catch (error) {
      this.logger.error('Error during change detection, falling back to full analysis', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback: return all files for full analysis
      const allFiles = await this.discoverFiles(repositoryPath, options);
      return allFiles.map(f => f.path);
    }
  }

  /**
   * Perform incremental analysis on a repository
   */
  private async performIncrementalAnalysis(
    repositoryPath: string,
    repository: Repository,
    options: BuildOptions
  ): Promise<BuildResult> {
    this.logger.info('Starting incremental analysis', {
      repositoryId: repository.id,
      repositoryPath,
    });

    // Detect changed files
    const changedFiles = await this.detectChangedFiles(repositoryPath, repository, options);

    if (changedFiles.length === 0) {
      this.logger.info('No changed files detected, skipping analysis');

      // Fetch current repository statistics from database
      const dbFiles = await this.dbService.getFilesByRepository(repository.id);
      const symbols = await this.dbService.getSymbolsByRepository(repository.id);
      const fileDependencyCount = await this.dbService.countFileDependenciesByRepository(
        repository.id
      );
      const symbolDependencyCount = await this.dbService.countSymbolDependenciesByRepository(
        repository.id
      );

      // Create lightweight graph data structures for statistics
      const fileGraph = {
        nodes: dbFiles.map(f => ({
          id: f.id,
          path: f.path,
          relativePath: path.relative(repository.path, f.path),
          language: f.language,
          isTest: f.is_test,
          isGenerated: f.is_generated,
        })),
        edges: Array(fileDependencyCount).fill(null),
      };

      const symbolGraph = {
        nodes: symbols.map(s => ({
          id: s.id,
          name: s.name,
          type: s.symbol_type,
          fileId: s.file_id,
          startLine: s.start_line || 0,
          endLine: s.end_line || 0,
          isExported: s.is_exported,
          visibility: s.visibility,
          signature: s.signature,
        })),
        edges: Array(symbolDependencyCount).fill(null),
      };

      return {
        repository,
        filesProcessed: 0,
        symbolsExtracted: 0,
        dependenciesCreated: 0,
        fileGraph,
        symbolGraph,
        errors: [],
        totalFiles: dbFiles.length,
        totalSymbols: symbols.length,
      };
    }

    this.logger.info(`Processing ${changedFiles.length} changed files`);

    // Re-analyze only changed files
    const partialResult = await this.reanalyzeFiles(repository.id, changedFiles, options);

    // Fetch current repository statistics from database
    const dbFiles = await this.dbService.getFilesByRepository(repository.id);
    const symbols = await this.dbService.getSymbolsByRepository(repository.id);
    const fileDependencyCount = await this.dbService.countFileDependenciesByRepository(
      repository.id
    );
    const symbolDependencyCount = await this.dbService.countSymbolDependenciesByRepository(
      repository.id
    );

    // Create lightweight graph data structures for statistics
    const fileGraph = {
      nodes: dbFiles.map(f => ({
        id: f.id,
        path: f.path,
        relativePath: path.relative(repository.path, f.path),
        language: f.language,
        isTest: f.is_test,
        isGenerated: f.is_generated,
      })),
      edges: Array(fileDependencyCount).fill(null),
    };

    const symbolGraph = {
      nodes: symbols.map(s => ({
        id: s.id,
        name: s.name,
        type: s.symbol_type,
        fileId: s.file_id,
        startLine: s.start_line || 0,
        endLine: s.end_line || 0,
        isExported: s.is_exported,
        visibility: s.visibility,
        signature: s.signature,
      })),
      edges: Array(symbolDependencyCount).fill(null),
    };

    // Update repository timestamp
    await this.dbService.updateRepository(repository.id, {
      last_indexed: new Date(),
    });

    this.logger.info('Incremental analysis completed', {
      filesProcessed: partialResult.filesProcessed || 0,
      symbolsExtracted: partialResult.symbolsExtracted || 0,
      dependenciesCreated: partialResult.dependenciesCreated || 0,
      errors: partialResult.errors?.length || 0,
    });

    return {
      repository,
      filesProcessed: partialResult.filesProcessed || 0,
      symbolsExtracted: partialResult.symbolsExtracted || 0,
      dependenciesCreated: partialResult.dependenciesCreated || 0,
      fileGraph,
      symbolGraph,
      errors: partialResult.errors || [],
      totalFiles: dbFiles.length,
      totalSymbols: symbols.length,
    };
  }

  /**
   * Re-analyze specific files (for incremental updates)
   */
  async reanalyzeFiles(
    repositoryId: number,
    filePaths: string[],
    options: BuildOptions = {}
  ): Promise<Partial<BuildResult>> {
    this.logger.info('Re-analyzing files', {
      repositoryId,
      fileCount: filePaths.length,
    });

    const validatedOptions = this.validateOptions(options);
    const files = filePaths.map(filePath => ({ path: filePath }));

    const parseResults = await this.parseFiles(files as any[], validatedOptions);
    const repository = await this.dbService.getRepository(repositoryId);

    if (!repository) {
      throw new Error(`Repository with id ${repositoryId} not found`);
    }

    const existingFiles = await this.dbService.getFilesByRepository(repositoryId);
    const fileIdsToCleanup = existingFiles.filter(f => filePaths.includes(f.path)).map(f => f.id);

    if (fileIdsToCleanup.length > 0) {
      this.logger.info('Cleaning up old data for changed files', {
        fileCount: fileIdsToCleanup.length,
      });
      await this.dbService.cleanupFileData(fileIdsToCleanup);
    }

    const dbFiles = await this.storeFiles(repositoryId, files as any[], parseResults);
    const symbols = await this.storeSymbols(dbFiles, parseResults);

    // Generate embeddings for symbols
    if (!validatedOptions.skipEmbeddings) {
      await this.generateSymbolEmbeddings(repositoryId);
    } else {
      this.logger.info('Skipping embedding generation (--skip-embeddings enabled)');
    }

    await this.storeFrameworkEntities(repositoryId, symbols, parseResults);

    const importsMap = this.createImportsMap(dbFiles, parseResults);
    const exportsMap = this.createExportsMap(dbFiles, parseResults);
    const dependenciesMap = this.createDependenciesMap(symbols, parseResults, dbFiles);

    const fileGraph = await this.fileGraphBuilder.buildFileGraph(
      repository,
      dbFiles,
      importsMap,
      exportsMap
    );

    const symbolGraph = await this.symbolGraphBuilder.buildSymbolGraph(
      symbols,
      dependenciesMap,
      dbFiles,
      importsMap,
      exportsMap
    );

    await this.persistVirtualFrameworkSymbols(repository, symbolGraph, symbols);

    const fileDependencies = this.fileGraphBuilder.createFileDependencies(fileGraph, new Map());
    const symbolDependencies = this.symbolGraphBuilder.createSymbolDependencies(symbolGraph);

    const crossFileFileDependencies = this.createCrossFileFileDependencies(
      symbolDependencies,
      symbols,
      dbFiles
    );

    const externalCallFileDependencies = this.createExternalCallFileDependencies(
      parseResults,
      dbFiles,
      symbols
    );

    const externalImportFileDependencies = this.createExternalImportFileDependencies(
      parseResults,
      dbFiles
    );

    const allFileDependencies = [
      ...fileDependencies,
      ...crossFileFileDependencies,
      ...externalCallFileDependencies,
      ...externalImportFileDependencies,
    ];

    if (allFileDependencies.length > 0) {
      await this.dbService.createFileDependencies(allFileDependencies);
    }

    if (symbolDependencies.length > 0) {
      await this.dbService.createDependencies(symbolDependencies);
    }

    // Re-resolve dependencies that reference changed symbols by qualified name
    const resolvedCount = await this.dbService.resolveQualifiedNameDependencies(repositoryId);
    this.logger.info('Re-resolved dependencies by qualified name', { resolvedCount });

    await this.buildGodotRelationships(repositoryId, parseResults);

    const totalDependencies = allFileDependencies.length + symbolDependencies.length;

    this.logger.info('File re-analysis completed', {
      filesProcessed: files.length,
      symbolsExtracted: symbols.length,
      dependenciesCreated: totalDependencies,
    });

    return {
      filesProcessed: files.length,
      symbolsExtracted: symbols.length,
      dependenciesCreated: totalDependencies,
      errors: parseResults.flatMap(r =>
        r.errors.map(e => ({
          filePath: r.filePath,
          message: e.message,
        }))
      ),
    };
  }

  private async ensureRepository(repositoryPath: string): Promise<Repository> {
    const absolutePath = path.resolve(repositoryPath);

    // Validate that the repository path exists and is a directory
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        throw new Error(`Repository path is not a directory: ${absolutePath}`);
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`Repository path does not exist: ${absolutePath}`);
      } else if (error.code === 'EACCES') {
        throw new Error(`Repository path is not accessible: ${absolutePath}`);
      } else {
        throw error; // Re-throw other unexpected errors
      }
    }

    // Additional check for read access
    try {
      await fs.access(absolutePath, fs.constants.R_OK);
    } catch (error) {
      throw new Error(`Repository path is not readable: ${absolutePath}`);
    }

    let repository = await this.dbService.getRepositoryByPath(absolutePath);

    if (!repository) {
      // Create new repository
      const name = path.basename(absolutePath);
      const primaryLanguage = await this.detectPrimaryLanguage(absolutePath);
      const frameworkStack = await this.detectFrameworks(absolutePath);

      repository = await this.dbService.createRepository({
        name,
        path: absolutePath,
        language_primary: primaryLanguage,
        framework_stack: frameworkStack,
      });

      this.logger.info('Created new repository', {
        name,
        path: absolutePath,
        id: repository.id,
      });
    }

    return repository;
  }

  private async discoverFiles(
    repositoryPath: string,
    options: BuildOptions
  ): Promise<Array<{ path: string; relativePath: string }>> {
    const files: Array<{ path: string; relativePath: string }> = [];
    const compassIgnore = await this.loadCompassIgnore(repositoryPath, options);

    this.logger.info('Starting file discovery', {
      repositoryPath,
      allowedExtensions: options.fileExtensions,
    });

    const traverse = async (currentPath: string): Promise<void> => {
      try {
        const lstats = await fs.lstat(currentPath);

        if (lstats.isSymbolicLink()) {
          try {
            await fs.stat(currentPath);
          } catch (symlinkError) {
            this.logger.debug('Skipping broken symlink', { path: currentPath });
            return;
          }
        }

        const stats = lstats.isSymbolicLink() ? await fs.stat(currentPath) : lstats;

        if (stats.isDirectory()) {
          const dirName = path.basename(currentPath);
          const relativePath = path.relative(repositoryPath, currentPath);

          // Check .compassignore patterns first
          if (compassIgnore.shouldIgnore(currentPath, relativePath)) {
            return;
          }

          // Then check built-in skip logic
          if (this.shouldSkipDirectory(dirName, options)) {
            return;
          }

          const entries = await fs.readdir(currentPath);

          await Promise.all(
            entries.map(async entry => {
              const entryPath = path.join(currentPath, entry);
              await traverse(entryPath);
            })
          );
        } else if (stats.isFile()) {
          const relativePath = path.relative(repositoryPath, currentPath);

          // Check .compassignore patterns first
          if (compassIgnore.shouldIgnore(currentPath, relativePath)) {
            return;
          }

          // Then check built-in include logic
          if (this.shouldIncludeFile(currentPath, relativePath, options)) {
            this.logger.info('Including file', { path: relativePath });
            files.push({
              path: currentPath,
              relativePath: relativePath,
            });
          } else {
          }
        }
      } catch (error) {
        this.logger.error('Error traversing path', { path: currentPath, error: error.message });
      }
    };

    await traverse(repositoryPath);

    // Generate file extension statistics
    const extensionStats: Record<string, number> = {};
    files.forEach(file => {
      const ext = path.extname(file.path);
      extensionStats[ext] = (extensionStats[ext] || 0) + 1;
    });

    this.logger.info('File discovery completed', {
      totalFiles: files.length,
      extensionStats,
      allowedExtensions: options.fileExtensions,
      patternsUsed: compassIgnore.getPatterns(),
    });

    // Limit the number of files if specified
    if (options.maxFiles && files.length > options.maxFiles) {
      this.logger.warn(`Limiting analysis to ${options.maxFiles} files`);
      return files.slice(0, options.maxFiles);
    }

    return files;
  }

  /**
   * Load CompassIgnore configuration from repository directory
   */
  private async loadCompassIgnore(
    repositoryPath: string,
    options: BuildOptions
  ): Promise<CompassIgnore> {
    if (options.compassignorePath) {
      // Use custom path if provided
      const customPath = path.isAbsolute(options.compassignorePath)
        ? options.compassignorePath
        : path.join(repositoryPath, options.compassignorePath);
      const compassIgnore = await CompassIgnore.fromFile(customPath);

      // Add default patterns if no custom .compassignore file exists
      if (!(await this.fileExists(customPath))) {
        compassIgnore.addPatterns(require('../utils/compassignore').DEFAULT_IGNORE_PATTERNS);
      }

      return compassIgnore;
    }

    // Use default .compassignore in repository root, with fallback to default patterns
    const compassIgnore = await CompassIgnore.fromDirectory(repositoryPath);
    const compassIgnorePath = path.join(repositoryPath, '.compassignore');

    // If no .compassignore file exists, add default patterns
    if (!(await this.fileExists(compassIgnorePath))) {
      compassIgnore.addPatterns(require('../utils/compassignore').DEFAULT_IGNORE_PATTERNS);
    }

    return compassIgnore;
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  private async parseFiles(
    files: Array<{ path: string; relativePath?: string }>,
    options: BuildOptions
  ): Promise<Array<ParseResult & { filePath: string }>> {
    const multiParser = new MultiParser();

    const concurrency = options.maxConcurrency || 10;
    const limit = pLimit(concurrency);

    const parsePromises = files.map(file =>
      limit(async () => {
        try {
          const content = await this.readFileWithEncodingRecovery(file.path, options);
          if (!content) {
            return null;
          }

          const parseResult = await this.processFileWithSizePolicyMultiParser(
            file,
            content,
            multiParser,
            options
          );
          if (!parseResult) {
            return null;
          }

          return {
            ...parseResult,
            filePath: file.path,
          };
        } catch (error) {
          this.logger.error('Failed to parse file', {
            path: file.path,
            error: (error as Error).message,
          });

          return {
            filePath: file.path,
            symbols: [],
            dependencies: [],
            imports: [],
            exports: [],
            errors: [
              {
                message: (error as Error).message,
                line: 0,
                column: 0,
                severity: 'error',
              },
            ],
            success: false,
          };
        }
      })
    );

    const parsedResults = await Promise.all(parsePromises);

    const results = parsedResults.filter(
      (result): result is ParseResult & { filePath: string } => result !== null
    );

    // Generate parsing statistics
    const parseStats = {
      totalFiles: files.length,
      successfulParses: results.filter(r => r.success !== false && r.errors.length === 0).length,
      failedParses: results.filter(r => r.success === false || r.errors.length > 0).length,
      totalSymbols: results.reduce((sum, r) => sum + r.symbols.length, 0),
      totalDependencies: results.reduce((sum, r) => sum + r.dependencies.length, 0),
      byExtension: {} as Record<string, { files: number; symbols: number; errors: number }>,
    };

    // Calculate per-extension statistics
    results.forEach(result => {
      const ext = path.extname(result.filePath);
      if (!parseStats.byExtension[ext]) {
        parseStats.byExtension[ext] = { files: 0, symbols: 0, errors: 0 };
      }
      parseStats.byExtension[ext].files++;
      parseStats.byExtension[ext].symbols += result.symbols.length;
      parseStats.byExtension[ext].errors += result.errors.length;
    });

    this.logger.info('File parsing completed', parseStats);

    // Log any significant parsing failures
    if (parseStats.failedParses > 0) {
      const failedFiles = results
        .filter(r => r.success === false || r.errors.length > 0)
        .map(r => ({ path: r.filePath, errors: r.errors.length }));

      this.logger.warn('Parsing failures detected', {
        failedCount: parseStats.failedParses,
        failedFiles: failedFiles.slice(0, 10), // Limit to first 10 for readability
      });
    }

    return results;
  }

  private async storeFiles(
    repositoryId: number,
    files: Array<{ path: string }>,
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<File[]> {
    const statsPromises = files.map((file, i) => {
      if (!parseResults[i]) return Promise.resolve(null);

      return fs.stat(file.path).catch(error => {
        this.logger.error('Failed to stat file', {
          path: file.path,
          error: (error as Error).message
        });
        return null;
      });
    });

    const allStats = await Promise.all(statsPromises);

    const createFiles: CreateFile[] = [];
    const validIndices: number[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const stats = allStats[i];
      const parseResult = parseResults[i];

      if (!parseResult || !stats) {
        continue;
      }

      const language = this.detectLanguageFromPath(file.path);

      createFiles.push({
        repo_id: repositoryId,
        path: file.path,
        language,
        size: stats.size,
        last_modified: stats.mtime,
        is_generated: this.isGeneratedFile(file.path),
        is_test: this.isTestFile(file.path),
      });

      validIndices.push(i);
    }

    const dbFiles = await this.dbService.createFilesBatch(createFiles);
    return dbFiles;
  }

  private async storeSymbols(
    files: File[],
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<Symbol[]> {
    const allSymbols: CreateSymbol[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const parseResult = parseResults.find(r => r.filePath === file.path);

      if (!parseResult) continue;

      for (const symbol of parseResult.symbols) {
        allSymbols.push({
          file_id: file.id,
          name: symbol.name,
          qualified_name: symbol.qualified_name,
          parent_symbol_id: symbol.parent_symbol_id,
          symbol_type: symbol.symbol_type,
          start_line: symbol.start_line,
          end_line: symbol.end_line,
          is_exported: symbol.is_exported,
          visibility: symbol.visibility as any,
          signature: symbol.signature,
        });
      }
    }

    return await this.dbService.createSymbols(allSymbols);
  }

  async generateSymbolEmbeddings(repositoryId: number): Promise<void> {
    // Count total symbols needing embeddings
    const totalSymbols = await this.dbService.countSymbolsNeedingEmbeddings(repositoryId);
    if (totalSymbols === 0) return;

    this.logger.info('Generating embeddings for symbols', {
      repositoryId,
      symbolCount: totalSymbols
    });

    const embeddingService = getEmbeddingService();
    await embeddingService.initialize();

    const isGPU = embeddingService.modelInfo.gpu;

    // Initialize adaptive controller with universal safe defaults
    // The adaptive system will automatically adjust based on runtime conditions:
    //   - Starts conservative (16 for GPU, 32 for CPU)
    //   - Increases if memory < 60% and performance is good
    //   - Decreases if memory > 80% or processing slows down
    const initialBatchSize = isGPU ? 16 : 32;
    const adaptiveController = new AdaptiveEmbeddingController(initialBatchSize, isGPU);

    this.logger.info('Starting adaptive embedding generation', {
      totalSymbols,
      isGPU,
      initialBatchSize,
      modelName: embeddingService.modelInfo.name,
      modelDimensions: embeddingService.modelInfo.dimensions,
      mode: 'adaptive (zero-config: adjusts batch size and session resets based on runtime conditions)',
    });

    // Stream from database in chunks with pre-fetching pipeline
    const CHUNK_SIZE = 1000; // Fetch 1000 symbols at a time
    let lastProcessedId = 0;
    let processed = 0;
    let chunkIndex = 0;
    let pendingAdjustment: Promise<any> | null = null;

    // Pre-fetch first chunk
    let currentChunk = await this.dbService.getSymbolsForEmbedding(
      repositoryId,
      CHUNK_SIZE,
      lastProcessedId
    );

    while (currentChunk.length > 0) {
      const symbols = currentChunk;

      // Start pre-fetching NEXT chunk while processing CURRENT chunk
      let nextChunkPromise: Promise<any[]> | null = null;
      if (symbols.length === CHUNK_SIZE) {
        const nextLastProcessedId = Math.max(...symbols.map(s => s.id!));
        nextChunkPromise = this.dbService.getSymbolsForEmbedding(
          repositoryId,
          CHUNK_SIZE,
          nextLastProcessedId
        );
      }

      this.logger.info(`Processing chunk ${chunkIndex + 1}`, {
        symbolsInChunk: symbols.length,
        processed,
        total: totalSymbols,
      });

      // Process chunk in adaptive batches
      let i = 0;
      while (i < symbols.length) {
        // Non-blocking adaptive adjustment check (every 10 batches)
        const batchNum = adaptiveController.getState().totalBatches;
        if (batchNum % 10 === 0 && !pendingAdjustment) {
          pendingAdjustment = adaptiveController.adjustBatchSize().then(adjustment => {
            if (adjustment.changed) {
              this.logger.info('Adaptive batch size adjustment', {
                newSize: adjustment.newBatchSize,
                reason: adjustment.reason,
              });
            }
            pendingAdjustment = null;
            return adjustment;
          });
        }

        // Await pending adjustment every 20 batches to apply changes
        if (pendingAdjustment && batchNum % 20 === 0) {
          await pendingAdjustment;
        }

        // Single-pass batch preparation (optimization: 7 operations → 1)
        const prepared = adaptiveController.prepareBatch(symbols.slice(i));
        const { nameTexts, descriptionTexts, decidedBatchSize, finalBatch } = prepared;

        let batchProcessed = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (!batchProcessed && retryCount < maxRetries) {
          try {
            // Generate combined embeddings (name + description)
            const batchStart = Date.now();
            const combinedTexts = nameTexts.map((name, idx) => {
              const desc = descriptionTexts[idx];
              return desc ? `${name} ${desc}` : name;
            });
            const combinedEmbeddings = await embeddingService.generateBatchEmbeddings(combinedTexts);

            const batchDuration = Date.now() - batchStart;

            // Record processing time for adaptive learning
            // Pass actual batch size so controller knows if it was text-reduced
            adaptiveController.recordBatchTime(batchDuration, decidedBatchSize);

            const updates = finalBatch.map((symbol, j) => ({
              id: symbol.id!,
              combinedEmbedding: combinedEmbeddings[j],
              embeddingModel: 'bge-m3',
            }));

            await this.dbService.batchUpdateSymbolEmbeddings(updates);

            // Clear references immediately after write to free memory
            updates.length = 0;
            combinedEmbeddings.length = 0;

            processed += finalBatch.length;
            i += decidedBatchSize;
            batchProcessed = true;

            // Log progress with adaptive state
            const controllerState = adaptiveController.getState();
            this.logger.debug('Batch embeddings generated', {
              processed,
              total: totalSymbols,
              batchSize: decidedBatchSize,
              progress: `${Math.round((processed / totalSymbols) * 100)}%`,
              adaptiveBatchSize: controllerState.currentBatchSize,
              batchDurationMs: batchDuration,
            });

            // Adaptive session reset based on runtime conditions
            const resetDecision = await adaptiveController.shouldResetSession();
            if (resetDecision.shouldReset && processed < totalSymbols) {
              const percentComplete = Math.round((processed / totalSymbols) * 100);
              this.logger.info('Adaptive ONNX session reset triggered', {
                processed,
                total: totalSymbols,
                progress: `${percentComplete}%`,
                reason: resetDecision.reason,
                gpuMemory: resetDecision.memoryInfo ? {
                  used: `${resetDecision.memoryInfo.used}MB`,
                  total: `${resetDecision.memoryInfo.total}MB`,
                  utilization: `${resetDecision.memoryInfo.utilizationPercent.toFixed(1)}%`,
                } : undefined,
              });

              const resetStart = Date.now();
              await embeddingService.dispose();
              await embeddingService.initialize();
              adaptiveController.recordSessionReset();

              const resetDuration = Date.now() - resetStart;
              this.logger.info('ONNX session reset complete', {
                durationMs: resetDuration,
              });
            }
          } catch (error) {
            retryCount++;
            const errorMessage = (error as Error).message;

            if (
              errorMessage.includes('Failed to allocate memory') ||
              errorMessage.includes('FusedMatMul')
            ) {
              this.logger.warn('GPU OOM detected - adaptive controller will handle', {
                error: errorMessage,
                retry: retryCount,
                maxRetries,
              });

              // Force immediate session reset to clear GPU memory
              await embeddingService.dispose();
              await embeddingService.initialize();
              adaptiveController.recordSessionReset();

              // Adaptive controller will reduce batch size on next iteration
              if (retryCount >= maxRetries) {
                this.logger.error('Failed after retries, skipping batch', {
                  batchStart: i,
                  decidedBatchSize,
                });
                i += decidedBatchSize; // Skip this batch
                batchProcessed = true;
              }
            } else {
              this.logger.error('Failed to generate embeddings for batch', {
                batchStart: i,
                batchSize: decidedBatchSize,
                error: errorMessage,
              });
              i += decidedBatchSize; // Skip this batch
              batchProcessed = true;
            }
          }
        }  // end retry while loop
      }  // end batch while loop

      // Fetch next chunk (or wait for pre-fetched chunk)
      if (nextChunkPromise) {
        currentChunk = await nextChunkPromise;
      } else {
        currentChunk = [];
      }
      chunkIndex++;
    }

    // Log final adaptive statistics
    const finalState = adaptiveController.getState();
    this.logger.info('Embedding generation completed', {
      symbolsProcessed: processed,
      totalBatches: finalState.totalBatches,
      finalBatchSize: finalState.currentBatchSize,
      initialBatchSize: finalState.initialBatchSize,
      baselineProcessingTime: finalState.baselineProcessingTime ? `${Math.round(finalState.baselineProcessingTime)}ms` : 'N/A',
      recentAvgProcessingTime: finalState.recentAvgProcessingTime ? `${Math.round(finalState.recentAvgProcessingTime)}ms` : 'N/A',
    });
  }

  private findFileForEntity(
    filePath: string,
    filesMap: Map<string, any>,
    normalizedFilesMap: Map<string, any>,
    allFiles: any[]
  ): any | null {
    let matchingFile = filesMap.get(filePath);

    if (!matchingFile) {
      matchingFile = normalizedFilesMap.get(path.normalize(filePath));
    }

    if (!matchingFile) {
      const parseResultBasename = path.basename(filePath);
      matchingFile = allFiles.find(f => {
        const dbPathBasename = path.basename(f.path);
        if (dbPathBasename === parseResultBasename) {
          const parseResultDir = path.dirname(filePath);
          const dbPathDir = path.dirname(f.path);
          return (
            parseResultDir.endsWith(dbPathDir) ||
            dbPathDir.endsWith(parseResultDir) ||
            path.basename(parseResultDir) === path.basename(dbPathDir)
          );
        }
        return false;
      });
    }

    return matchingFile || null;
  }

  private async storeFrameworkEntities(
    repositoryId: number,
    symbols: Symbol[],
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<void> {
    this.logger.info('Storing framework entities', {
      repositoryId,
      parseResultsCount: parseResults.length,
    });

    const allFiles = await this.dbService.getFilesByRepository(repositoryId);
    const filesMap = new Map(allFiles.map(f => [f.path, f]));
    const normalizedFilesMap = new Map(allFiles.map(f => [path.normalize(f.path), f]));

    for (const parseResult of parseResults) {
      if (!parseResult.frameworkEntities || parseResult.frameworkEntities.length === 0) {
        continue;
      }

      const fileSymbols = symbols.filter(s => {
        return parseResult.symbols.some(
          ps => ps.name === s.name && ps.symbol_type === s.symbol_type
        );
      });

      for (const entity of parseResult.frameworkEntities) {
        let matchingSymbol: Symbol | undefined;

        try {
          if (this.isLaravelRoute(entity)) {
            const laravelRoute = entity as LaravelRoute;
            let normalizedMethod = laravelRoute.method;
            if (normalizedMethod === 'RESOURCE') {
              normalizedMethod = 'ANY';
            }

            const matchingFile = this.findFileForEntity(
              parseResult.filePath,
              filesMap,
              normalizedFilesMap,
              allFiles
            );

            if (!matchingFile) {
              this.logger.error('Cannot persist Laravel route: file not found in database', {
                routePath: laravelRoute.path,
                routeMethod: laravelRoute.method,
                filePath: parseResult.filePath,
                normalizedFilePath: path.normalize(parseResult.filePath),
                entityName: entity.name,
              });
              continue;
            }

            await this.dbService.createRoute({
              repo_id: repositoryId,
              path: laravelRoute.path,
              method: normalizedMethod,
              handler_symbol_id: null,
              framework_type: 'laravel',
              middleware: laravelRoute.middleware || [],
              dynamic_segments: [],
              auth_required: false,
              name: laravelRoute.routeName,
              controller_class: laravelRoute.controller,
              controller_method: this.extractControllerMethod(laravelRoute.action),
              action: laravelRoute.action,
              file_path: laravelRoute.filePath,
              line_number: laravelRoute.metadata?.line || 1,
            });
            continue;
          }

          matchingSymbol = fileSymbols.find(
            s =>
              s.name === entity.name || entity.name.includes(s.name) || s.name.includes(entity.name)
          );

          if (!matchingSymbol) {
            const matchingFile = this.findFileForEntity(
              parseResult.filePath,
              filesMap,
              normalizedFilesMap,
              allFiles
            );

            if (!matchingFile) {
              this.logger.warn('Could not find file record for framework entity', {
                filePath: parseResult.filePath,
                normalizedFilePath: path.normalize(parseResult.filePath),
                entityName: entity.name,
                entityType: entity.type,
                availableFilesCount: allFiles.length,
                sampleAvailableFiles: allFiles
                  .map(f => ({
                    path: f.path,
                    normalized: path.normalize(f.path),
                  }))
                  .slice(0, 5),
                parseResultDirectory: path.dirname(parseResult.filePath),
                parseResultBasename: path.basename(parseResult.filePath),
              });
              continue;
            }

            const entityLine = (entity.metadata as any)?.line || 1;
            const syntheticSymbol = await this.dbService.createSymbol({
              file_id: matchingFile.id,
              name: entity.name,
              symbol_type: 'component' as any,
              start_line: entityLine,
              end_line: entityLine,
              is_exported: true,
              signature: `${entity.type} ${entity.name}`,
            });

            matchingSymbol = syntheticSymbol;
          }

          if (this.isLaravelController(entity)) {
            // Laravel controllers don't map directly to our component table
            // Store as metadata for now
            await this.dbService.storeFrameworkMetadata({
              repo_id: repositoryId,
              framework_type: 'laravel',
              metadata: {
                entityType: 'controller',
                name: entity.name,
                actions: (entity as LaravelController).actions,
                middleware: (entity as LaravelController).middleware,
                resourceController: (entity as LaravelController).resourceController,
              },
            });
          } else if (this.isEloquentModel(entity)) {
            // Eloquent models could be stored as metadata
            await this.dbService.storeFrameworkMetadata({
              repo_id: repositoryId,
              framework_type: 'laravel',
              metadata: {
                entityType: 'model',
                name: entity.name,
                tableName: (entity as EloquentModel).tableName,
                fillable: (entity as EloquentModel).fillable,
                relationships: (entity as EloquentModel).relationships,
              },
            });
          } else if (this.isRouteEntity(entity)) {
            const routeEntity = entity as NextJSRoute | ExpressRoute | FastifyRoute | VueRoute;
            await this.dbService.createRoute({
              repo_id: repositoryId,
              path: routeEntity.path || '/',
              method: (routeEntity as any).method || 'GET',
              handler_symbol_id: matchingSymbol?.id || null,
              framework_type: (routeEntity as any).framework || 'unknown',
              middleware: (routeEntity as any).middleware || [],
              dynamic_segments: (routeEntity as any).dynamicSegments || [],
              auth_required: false,
            });
          } else if (this.isVueComponent(entity)) {
            const vueEntity = entity as VueComponent;
            await this.dbService.createComponent({
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              component_type: 'vue' as any,
              props: vueEntity.props || [],
              emits: vueEntity.emits || [],
              slots: vueEntity.slots || [],
              hooks: [],
              template_dependencies: vueEntity.template_dependencies || [],
            });
          } else if (this.isReactComponent(entity)) {
            const reactEntity = entity as ReactComponent;
            await this.dbService.createComponent({
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              component_type: 'react' as any,
              props: reactEntity.props || [],
              emits: [],
              slots: [],
              hooks: reactEntity.hooks || [],
              template_dependencies: reactEntity.jsxDependencies || [],
            });
          } else if (this.isVueComposable(entity)) {
            const composableEntity = entity as VueComposable;
            await this.dbService.createComposable({
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              composable_type: 'vue' as any,
              returns: composableEntity.returns || [],
              dependencies: composableEntity.dependencies || [],
              reactive_refs: composableEntity.reactive_refs || [],
              dependency_array: [],
            });
          } else if (this.isReactHook(entity)) {
            const hookEntity = entity as ReactHook;
            await this.dbService.createComposable({
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              composable_type: 'react' as any,
              returns: hookEntity.returns || [],
              dependencies: hookEntity.dependencies || [],
              reactive_refs: [],
              dependency_array: [],
            });
          } else if (this.isJobSystemEntity(entity)) {
            // Handle background job system entities
            const jobSystemEntity = entity as any;
            await this.dbService.createJobQueue({
              repo_id: repositoryId,
              name: jobSystemEntity.name,
              queue_type: jobSystemEntity.jobSystems?.[0] || 'bull', // Use first detected system
              symbol_id: matchingSymbol.id,
              config_data: jobSystemEntity.config || {},
            });
          } else if (this.isORMSystemEntity(entity)) {
            // Handle ORM system entities
            const ormSystemEntity = entity as any;
            await this.dbService.createORMEntity({
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              entity_name: ormSystemEntity.name,
              orm_type: ormSystemEntity.metadata?.orm || ormSystemEntity.name || 'unknown',
              fields: ormSystemEntity.metadata?.fields || {},
            });
          } else if (this.isTestSystemEntity(entity)) {
            const testSystemEntity = entity as any;

            const matchingFile =
              filesMap.get(parseResult.filePath) ||
              normalizedFilesMap.get(path.normalize(parseResult.filePath));

            if (matchingFile) {
              await this.dbService.createTestSuite({
                repo_id: repositoryId,
                file_id: matchingFile.id,
                suite_name: testSystemEntity.name,
                framework_type: testSystemEntity.testFrameworks?.[0] || 'jest',
              });
            }
          } else if (this.isPackageSystemEntity(entity)) {
            // Handle package manager system entities
            const packageSystemEntity = entity as any;
            await this.dbService.createPackageDependency({
              repo_id: repositoryId,
              package_name: packageSystemEntity.name,
              version_spec: packageSystemEntity.version || '1.0.0',
              dependency_type: 'dependencies' as any,
              package_manager: packageSystemEntity.packageManagers?.[0] || 'npm',
            });
          } else if (this.isGodotScene(entity)) {
            // Handle Godot scene entities - Core of Solution 1
            const sceneEntity = entity as any;

            const storedScene = await this.dbService.storeGodotScene({
              repo_id: repositoryId,
              scene_path: sceneEntity.scenePath || parseResult.filePath,
              scene_name: sceneEntity.name,
              node_count: sceneEntity.nodes?.length || 0,
              has_script: sceneEntity.nodes?.some((node: any) => node.script) || false,
              metadata: {
                rootNodeType: sceneEntity.rootNode?.nodeType,
                connections: sceneEntity.connections?.length || 0,
                resources: sceneEntity.resources?.length || 0,
              },
            });

            // Store nodes for this scene
            if (sceneEntity.nodes && Array.isArray(sceneEntity.nodes)) {
              for (const node of sceneEntity.nodes) {
                await this.dbService.storeGodotNode({
                  repo_id: repositoryId,
                  scene_id: storedScene.id,
                  node_name: node.nodeName || node.name,
                  node_type: node.nodeType || node.type || 'Node',
                  script_path: node.script,
                  properties: node.properties || {},
                });
              }

              // Update scene with root node reference
              if (sceneEntity.rootNode) {
                const rootNode = sceneEntity.nodes.find(
                  (n: any) =>
                    n.nodeName === sceneEntity.rootNode.nodeName ||
                    n.name === sceneEntity.rootNode.name
                );
                if (rootNode) {
                  // The root node would have been stored above, but we'd need its ID
                  // For now, we'll skip updating the root_node_id to avoid complexity
                }
              }
            }
          } else if (this.isGodotScript(entity)) {
            // Handle Godot script entities
            const scriptEntity = entity as any;
            await this.dbService.storeGodotScript({
              repo_id: repositoryId,
              script_path: parseResult.filePath,
              class_name: scriptEntity.className || scriptEntity.name,
              base_class: scriptEntity.baseClass,
              is_autoload: scriptEntity.isAutoload || false,
              signals: scriptEntity.signals || [],
              exports: scriptEntity.exports || [],
              metadata: {
                attachedScenes: scriptEntity.attachedScenes || [],
              },
            });
          } else if (this.isGodotAutoload(entity)) {
            // Handle Godot autoload entities
            const autoloadEntity = entity as any;

            // Find the script entity first
            const scriptEntity = await this.dbService.findGodotScriptByPath(
              repositoryId,
              autoloadEntity.scriptPath
            );

            await this.dbService.storeGodotAutoload({
              repo_id: repositoryId,
              autoload_name: autoloadEntity.autoloadName || autoloadEntity.name,
              script_path: autoloadEntity.scriptPath,
              script_id: scriptEntity?.id,
              metadata: {
                className: autoloadEntity.className,
              },
            });

            // Create autoload-script relationship if script exists
            if (scriptEntity) {
              await this.dbService.createGodotRelationship({
                repo_id: repositoryId,
                relationship_type: 'autoload_reference' as any,
                from_entity_type: 'autoload' as any,
                from_entity_id: scriptEntity.id, // We'd need the autoload ID here
                to_entity_type: 'script' as any,
                to_entity_id: scriptEntity.id,
              });
            }
          } else if (entity.type === 'api_call') {
            // API calls from Vue components - these will be extracted later by cross-stack builder
            // API calls will be processed by cross-stack builder
          }
        } catch (error) {
          this.logger.error(
            `Failed to store ${entity.type} entity '${entity.name}': ${error instanceof Error ? error.message : String(error)}`,
            {
              entityType: entity.type,
              entityName: entity.name,
              filePath: parseResult.filePath,
              symbolId: matchingSymbol?.id,
              repositoryId: repositoryId,
            }
          );
        }
      }
    }

    // Build Godot framework relationships after all entities have been stored
    await this.buildGodotRelationships(repositoryId, parseResults);
  }

  /**
   * Build Godot framework relationships after all entities have been stored
   */
  private async buildGodotRelationships(
    repositoryId: number,
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<void> {
    try {
      // Collect all Godot framework entities from parse results
      const godotEntities: any[] = [];

      for (const parseResult of parseResults) {
        if (parseResult.frameworkEntities) {
          const godotFrameworkEntities = parseResult.frameworkEntities.filter(
            entity =>
              (entity as any).framework === 'godot' ||
              this.isGodotScene(entity) ||
              this.isGodotNode(entity) ||
              this.isGodotScript(entity) ||
              this.isGodotAutoload(entity)
          );
          godotEntities.push(...godotFrameworkEntities);
        }
      }

      if (godotEntities.length === 0) {
        return;
      }

      this.logger.info('Building Godot framework relationships', {
        repositoryId,
        totalGodotEntities: godotEntities.length,
        entityTypes: [...new Set(godotEntities.map(e => e.type))],
      });

      // Retrieve stored Godot entities from database with proper IDs
      const storedScenes = await this.dbService.getGodotScenesByRepository(repositoryId);
      const storedScripts = await this.dbService.getGodotScriptsByRepository(repositoryId);
      const storedAutoloads = await this.dbService.getGodotAutoloadsByRepository(repositoryId);

      // Get all nodes from all scenes
      const storedNodes: any[] = [];
      for (const scene of storedScenes) {
        const sceneNodes = await this.dbService.getGodotNodesByScene(scene.id);
        storedNodes.push(...sceneNodes);
      }

      // Create dependencies between nodes and their scripts (Second pass - symbols exist now)
      this.logger.info('Creating node-script dependencies', {
        totalNodes: storedNodes.length,
        nodesWithScripts: storedNodes.filter((n: any) => n.script_path).length,
      });

      for (const node of storedNodes) {
        if (!node.script_path) continue;

        try {
          // Find the scene this node belongs to
          const scene = storedScenes.find((s: any) => s.id === node.scene_id);
          if (!scene) continue;

          // Get the scene file to find node symbol
          const sceneFile = await this.dbService.getFileByPath(scene.scene_path);
          if (!sceneFile) {
            this.logger.warn('Scene file not found', { scenePath: scene.scene_path });
            continue;
          }

          // Get all symbols in the scene file
          const sceneSymbols = await this.dbService.getSymbolsByFile(sceneFile.id);
          const nodeSymbol = sceneSymbols.find(s => s.name === node.node_name);

          if (!nodeSymbol) {
            this.logger.warn('Node symbol not found', {
              nodeName: node.node_name,
              scenePath: scene.scene_path,
              totalSymbols: sceneSymbols.length,
            });
            continue;
          }

          // Get the script file
          const scriptFile = await this.dbService.getFileByPath(node.script_path);
          if (!scriptFile) {
            this.logger.warn('Script file not found', { scriptPath: node.script_path });
            continue;
          }

          // Get the class symbol in the script
          const scriptSymbols = await this.dbService.getSymbolsByFile(scriptFile.id);
          const scriptClassSymbol = scriptSymbols.find(s => s.symbol_type === 'class');

          if (!scriptClassSymbol) {
            this.logger.warn('Script class symbol not found', {
              scriptPath: node.script_path,
              totalSymbols: scriptSymbols.length,
            });
            continue;
          }

          // Create dependency from node to script class
          await this.dbService.createDependency({
            from_symbol_id: nodeSymbol.id,
            to_symbol_id: scriptClassSymbol.id,
            dependency_type: DependencyType.REFERENCES,
            line_number: (node.metadata as any)?.line || 1,
          });

          this.logger.info('Created node-script dependency', {
            nodeSymbol: nodeSymbol.name,
            scriptClass: scriptClassSymbol.name,
            fromId: nodeSymbol.id,
            toId: scriptClassSymbol.id,
          });
        } catch (error) {
          this.logger.error('Failed to create node-script dependency', {
            nodeName: node.node_name,
            scriptPath: node.script_path,
            error: (error as Error).message,
          });
        }
      }

      // Convert to framework entities format expected by the relationship builder
      const storedGodotEntities = [
        ...storedScenes.map((scene: any) => ({ ...scene, type: 'godot_scene' })),
        ...storedNodes.map((node: any) => ({ ...node, type: 'godot_node' })),
        ...storedScripts.map((script: any) => ({ ...script, type: 'godot_script' })),
        ...storedAutoloads.map((autoload: any) => ({ ...autoload, type: 'godot_autoload' })),
      ];

      // Use the GodotRelationshipBuilder to create relationships with stored entities
      const relationships = await this.godotRelationshipBuilder.buildRelationships(
        repositoryId,
        storedGodotEntities
      );

      this.logger.info('Godot framework relationships built successfully', {
        repositoryId,
        relationshipsCreated: relationships.length,
        relationshipTypes: [...new Set(relationships.map(r => r.relationship_type))],
      });
    } catch (error) {
      this.logger.error('Failed to build Godot relationships', {
        repositoryId,
        error: (error as Error).message,
      });
      // Don't throw - relationship building is optional for overall analysis success
    }
  }

  // Type guards for framework entities
  private isRouteEntity(
    entity: any
  ): entity is NextJSRoute | ExpressRoute | FastifyRoute | VueRoute {
    return (
      entity.type === 'route' ||
      entity.type === 'nextjs-page-route' ||
      entity.type === 'nextjs-api-route' ||
      entity.type === 'express-route' ||
      entity.type === 'fastify-route' ||
      'path' in entity
    );
  }

  private isVueComponent(entity: any): entity is VueComponent {
    // Vue components are identified by type 'component' and being in a .vue file
    return entity.type === 'component' && entity.filePath && entity.filePath.endsWith('.vue');
  }

  private isReactComponent(entity: any): entity is ReactComponent {
    return (
      entity.type === 'component' &&
      'componentType' in entity &&
      'hooks' in entity &&
      'jsxDependencies' in entity
    );
  }

  private isVueComposable(entity: any): entity is VueComposable {
    return entity.type === 'composable' && 'reactive_refs' in entity;
  }

  private isReactHook(entity: any): entity is ReactHook {
    return entity.type === 'hook' && 'returns' in entity && 'dependencies' in entity;
  }

  // Laravel entity type guards
  private isLaravelRoute(entity: any): entity is LaravelRoute {
    return entity.type === 'route' && entity.framework === 'laravel';
  }

  private isLaravelController(entity: any): entity is LaravelController {
    return entity.type === 'controller' && entity.framework === 'laravel';
  }

  private isEloquentModel(entity: any): entity is EloquentModel {
    return entity.type === 'model' && entity.framework === 'laravel';
  }

  /**
   * Extract controller method from Laravel action string
   * Examples: "App\\Http\\Controllers\\UserController@index" -> "index"
   *           "UserController@show" -> "show"
   */
  private extractControllerMethod(action?: string): string | undefined {
    if (!action) return undefined;

    const atIndex = action.lastIndexOf('@');
    if (atIndex === -1) return undefined;

    return action.substring(atIndex + 1);
  }

  // Phase 3 entity type guards
  private isJobSystemEntity(entity: any): boolean {
    return entity.type === 'job_system';
  }

  private isORMSystemEntity(entity: any): boolean {
    return entity.type === 'orm_system';
  }

  private isTestSystemEntity(entity: any): boolean {
    return entity.type === 'test_suite' || entity.type === 'test_system';
  }

  private isPackageSystemEntity(entity: any): boolean {
    return entity.type === 'package_system' || entity.type === 'package';
  }

  // Phase 7B: Godot Framework Entity type guards
  private isGodotScene(entity: any): boolean {
    return entity.type === 'godot_scene' && entity.framework === 'godot';
  }

  private isGodotNode(entity: any): boolean {
    return entity.type === 'godot_node' && entity.framework === 'godot';
  }

  private isGodotScript(entity: any): boolean {
    return entity.type === 'godot_script' && entity.framework === 'godot';
  }

  private isGodotAutoload(entity: any): boolean {
    return entity.type === 'godot_autoload' && entity.framework === 'godot';
  }

  private isGodotResource(entity: any): boolean {
    return entity.type === 'godot_resource' && entity.framework === 'godot';
  }

  private createImportsMap(files: File[], parseResults: Array<ParseResult & { filePath: string }>) {
    const map = new Map();

    for (const file of files) {
      const parseResult = parseResults.find(r => r.filePath === file.path);
      if (parseResult) {
        map.set(file.id, parseResult.imports);
      }
    }

    return map;
  }

  private createExportsMap(files: File[], parseResults: Array<ParseResult & { filePath: string }>) {
    const map = new Map();

    for (const file of files) {
      const parseResult = parseResults.find(r => r.filePath === file.path);
      if (parseResult) {
        map.set(file.id, parseResult.exports);
      }
    }

    return map;
  }

  private createDependenciesMap(
    symbols: Symbol[],
    parseResults: Array<ParseResult & { filePath: string }>,
    dbFiles: File[]
  ) {
    const map = new Map();

    // Create a file-to-symbols map for efficient lookup
    const fileToSymbolsMap = new Map<string, Symbol[]>();

    // Create a mapping from file_id to file path
    const fileIdToPathMap = new Map<number, string>();
    for (const file of dbFiles) {
      fileIdToPathMap.set(file.id, file.path);
    }

    for (const symbol of symbols) {
      const filePath = fileIdToPathMap.get(symbol.file_id);
      if (filePath) {
        if (!fileToSymbolsMap.has(filePath)) {
          fileToSymbolsMap.set(filePath, []);
        }
        fileToSymbolsMap.get(filePath)!.push(symbol);
      }
    }

    // Process dependencies with file context preserved
    for (const parseResult of parseResults) {
      const filePath = parseResult.filePath;
      const fileSymbols = fileToSymbolsMap.get(filePath) || [];

      const dependencies = parseResult.dependencies.filter(
        d =>
          d.from_symbol && d.from_symbol.trim() !== '' && d.to_symbol && d.to_symbol.trim() !== ''
      );

      for (const dependency of dependencies) {
        // Extract the method/function name from qualified names (e.g., "Class.Method" -> "Method")
        // This handles C# qualified names like "CardManager.SetHandPositions" or "Namespace.Class.Method"
        const extractMethodName = (qualifiedName: string): string => {
          const parts = qualifiedName.split('.');
          // For patterns like "Class.<lambda>" or "Method.<local>", take the first meaningful part
          const lastPart = parts[parts.length - 1];
          if (lastPart.startsWith('<') && parts.length > 1) {
            return parts[parts.length - 2];
          }
          return lastPart;
        };

        const fromMethodName = extractMethodName(dependency.from_symbol);

        // Find the specific symbol that contains this dependency call
        // Must match: name (supporting both simple and qualified), file, and line range
        const containingSymbol = fileSymbols.find(symbol => {
          // Direct match (for non-qualified names)
          if (symbol.name === dependency.from_symbol) {
            return (
              dependency.line_number >= symbol.start_line &&
              dependency.line_number <= symbol.end_line
            );
          }

          // Qualified name match (for C# and similar languages)
          if (symbol.name === fromMethodName) {
            return (
              dependency.line_number >= symbol.start_line &&
              dependency.line_number <= symbol.end_line
            );
          }

          // Enhanced matching: check if dependency is within symbol line range
          // This handles cases where the dependency call is inside a method/function
          // but the from_symbol name doesn't exactly match the containing symbol name
          if (
            dependency.line_number >= symbol.start_line &&
            dependency.line_number <= symbol.end_line
          ) {
            // Prioritize methods/functions/properties over classes to avoid creating dependencies from the class
            if (
              symbol.symbol_type === SymbolType.METHOD ||
              symbol.symbol_type === SymbolType.FUNCTION ||
              symbol.symbol_type === SymbolType.PROPERTY
            ) {
              return true;
            }

            // Only match class if no method/function/property contains this line
            if (symbol.symbol_type === SymbolType.CLASS) {
              const hasContainingMethod = fileSymbols.some(
                s =>
                  (s.symbol_type === SymbolType.METHOD ||
                    s.symbol_type === SymbolType.FUNCTION ||
                    s.symbol_type === SymbolType.PROPERTY) &&
                  dependency.line_number >= s.start_line &&
                  dependency.line_number <= s.end_line
              );
              if (!hasContainingMethod) {
                return true;
              }
              return false;
            }

            // Fallback: if no method/function/property/class contains this line,
            // accept any symbol that contains it
            const hasMethodOrFunction = fileSymbols.some(
              s =>
                (s.symbol_type === SymbolType.METHOD ||
                  s.symbol_type === SymbolType.FUNCTION ||
                  s.symbol_type === SymbolType.PROPERTY ||
                  s.symbol_type === SymbolType.CLASS) &&
                dependency.line_number >= s.start_line &&
                dependency.line_number <= s.end_line
            );

            if (!hasMethodOrFunction) {
              return true;
            }
          }

          return false;
        });

        if (containingSymbol) {
          const existingDeps = map.get(containingSymbol.id) || [];
          existingDeps.push(dependency);
          map.set(containingSymbol.id, existingDeps);
        }
      }
    }

    return map;
  }

  private shouldSkipDirectory(dirName: string, options: BuildOptions): boolean {
    const skipDirs = [
      'node_modules',
      '.git',
      '.svn',
      '.hg',
      'dist',
      'build',
      'coverage',
      '.nyc_output',
    ];

    if (skipDirs.includes(dirName)) {
      if (dirName === 'node_modules' && options.includeNodeModules) {
        return false;
      }
      return true;
    }

    return dirName.startsWith('.');
  }

  private shouldIncludeFile(
    filePath: string,
    relativePath: string,
    options: BuildOptions
  ): boolean {
    const ext = path.extname(filePath);

    // Use provided extensions if specified, otherwise fall back to defaults
    const allowedExtensions = options.fileExtensions || [
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '.mjs',
      '.cjs',
      '.vue',
      '.php',
      '.cs',
    ];

    if (!allowedExtensions.includes(ext)) {
      return false;
    }

    if (!options.includeTestFiles && this.isTestFile(relativePath)) {
      return false;
    }

    this.logger.info('File should be included', { filePath });
    return true;
  }

  private isTestFile(relativePath: string): boolean {
    const fileName = path.basename(relativePath).toLowerCase();

    // Check filename patterns first
    if (
      fileName.includes('.test.') ||
      fileName.includes('.spec.') ||
      fileName.endsWith('.test') ||
      fileName.endsWith('.spec')
    ) {
      return true;
    }

    // Check directory patterns within the project (relative path only)
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const pathSegments = normalizedPath.split('/');

    // Look for test directories in the project structure
    return pathSegments.some(
      segment =>
        segment === '__tests__' ||
        segment === 'test' ||
        segment === 'tests' ||
        segment === 'spec' ||
        segment === 'specs'
    );
  }

  private isGeneratedFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return (
      fileName.includes('.generated.') ||
      fileName.includes('.gen.') ||
      filePath.includes('/generated/') ||
      filePath.includes('/.next/') ||
      filePath.includes('/dist/') ||
      filePath.includes('/build/')
    );
  }

  private detectLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath);

    switch (ext) {
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.vue':
        return 'vue';
      case '.php':
        return 'php';
      case '.cs':
        return 'csharp';
      default:
        return 'unknown';
    }
  }

  private async detectPrimaryLanguage(repositoryPath: string): Promise<string> {
    try {
      const packageJsonPath = path.join(repositoryPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      if (packageJson.devDependencies?.typescript || packageJson.dependencies?.typescript) {
        return 'typescript';
      }
    } catch {
      // Ignore errors
    }

    return 'javascript';
  }

  private async detectFrameworks(repositoryPath: string): Promise<string[]> {
    const frameworks: string[] = [];

    // Check for JavaScript/Node.js frameworks
    try {
      const packageJsonPath = path.join(repositoryPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      if (deps.vue || deps['@vue/cli-service']) frameworks.push('vue');
      if (deps.react) frameworks.push('react');
      if (deps.next) frameworks.push('nextjs');
      if (deps.nuxt) frameworks.push('nuxt');
      if (deps.express) frameworks.push('express');
      if (deps.fastify) frameworks.push('fastify');
    } catch {
      // Ignore errors
    }

    // Check for PHP/Laravel frameworks
    try {
      const composerJsonPath = path.join(repositoryPath, 'composer.json');
      const composerJson = JSON.parse(await fs.readFile(composerJsonPath, 'utf-8'));

      const deps = { ...composerJson.require, ...composerJson['require-dev'] };

      if (deps['laravel/framework']) frameworks.push('laravel');
      if (deps['symfony/framework-bundle']) frameworks.push('symfony');
      if (deps['codeigniter4/framework']) frameworks.push('codeigniter');
    } catch {
      // Ignore errors - composer.json might not exist for non-PHP projects
    }

    // Check for Godot framework
    try {
      const projectGodotPath = path.join(repositoryPath, 'project.godot');
      await fs.access(projectGodotPath);
      frameworks.push('godot');
    } catch {
      // Ignore errors - project.godot might not exist for non-Godot projects
    }

    return frameworks;
  }

  private async getGitHash(repositoryPath: string): Promise<string | undefined> {
    try {
      const hash = execSync('git rev-parse HEAD', {
        cwd: repositoryPath,
        encoding: 'utf-8',
      }).trim();
      return hash;
    } catch {
      return undefined;
    }
  }

  /**
   * Read file with encoding recovery support
   */
  private async readFileWithEncodingRecovery(
    filePath: string,
    _options: BuildOptions
  ): Promise<string | null> {
    try {
      // First attempt: Standard UTF-8 read
      const content = await fs.readFile(filePath, 'utf-8');

      // Quick encoding issue check
      if (!content.includes('\uFFFD')) {
        return content;
      }

      // Encoding recovery needed
      this.logger.info('Attempting encoding recovery', { filePath });
      const buffer = await fs.readFile(filePath);
      const recovered = await EncodingConverter.convertToUtf8(buffer);
      return recovered;
    } catch (error) {
      this.logger.warn('File reading failed', { filePath, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Process file with unified size policy
   */
  private async processFileWithSizePolicy(
    file: { path: string; relativePath?: string },
    content: string,
    parser: any,
    options: BuildOptions
  ): Promise<ParseResult | null> {
    // Create file size manager with policy
    const fileSizePolicy = options.fileSizePolicy || this.createDefaultFileSizePolicy(options);
    const sizeManager = new FileSizeManager(fileSizePolicy);
    const action = sizeManager.getRecommendedAction(content.length);

    switch (action) {
      case 'reject':
        this.logger.warn('File rejected due to size policy', {
          path: file.path,
          size: content.length,
        });
        return null;

      case 'skip':
        this.logger.info('File skipped due to size policy', {
          path: file.path,
          size: content.length,
        });
        return null;

      case 'chunk':
        // Use chunked parsing
        const parseOptions = {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          enableChunking: true,
          enableEncodingRecovery: true,
          chunkSize: fileSizePolicy.chunkingThreshold,
          chunkOverlapLines: options.chunkOverlapLines || 100,
        };
        return await parser.parseFile(file.path, content, parseOptions);

      case 'truncate':
        // This case should no longer occur since truncation is replaced with chunking
        this.logger.warn('Truncate action requested but using chunking instead', {
          path: file.path,
          size: content.length,
        });
        // Fall through to chunked parsing
        const fallbackParseOptions = {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          enableChunking: true,
          enableEncodingRecovery: true,
          chunkSize: fileSizePolicy.truncationFallback,
          chunkOverlapLines: options.chunkOverlapLines || 100,
        };
        return await parser.parseFile(file.path, content, fallbackParseOptions);

      case 'warn':
        this.logger.warn('Processing large file', {
          path: file.path,
          size: content.length,
        });
      // Fall through to normal processing

      case 'process':
      default:
        // All files use enhanced parsing
        return await parser.parseFile(file.path, content, {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          enableChunking: true,
          enableEncodingRecovery: true,
          chunkOverlapLines: options.chunkOverlapLines || 100,
        });
    }
  }

  /**
   * Process file with unified size policy using MultiParser
   */
  private async processFileWithSizePolicyMultiParser(
    file: { path: string; relativePath?: string },
    content: string,
    multiParser: MultiParser,
    options: BuildOptions
  ): Promise<ParseResult | null> {
    // Create file size manager with policy
    const fileSizePolicy = options.fileSizePolicy || this.createDefaultFileSizePolicy(options);
    const sizeManager = new FileSizeManager(fileSizePolicy);
    const action = sizeManager.getRecommendedAction(content.length);

    switch (action) {
      case 'reject':
        this.logger.warn('File rejected due to size policy', {
          path: file.path,
          size: content.length,
        });
        return null;

      case 'skip':
        this.logger.info('File skipped due to size policy', {
          path: file.path,
          size: content.length,
        });
        return null;

      case 'chunk':
      case 'truncate':
      case 'warn':
      case 'process':
      default:
        // Use MultiParser for comprehensive parsing including Phase 3 features
        const parseOptions = {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          enableChunking: action === 'chunk',
          enableEncodingRecovery: true,
          chunkSize: action === 'chunk' ? fileSizePolicy.chunkingThreshold : undefined,
          chunkOverlapLines: options.chunkOverlapLines || 100,
        };

        const multiResult = await multiParser.parseFile(content, file.path, parseOptions);

        // Convert MultiParseResult to ParseResult
        return {
          symbols: multiResult.symbols,
          dependencies: multiResult.dependencies,
          imports: multiResult.imports,
          exports: multiResult.exports,
          errors: multiResult.errors,
          frameworkEntities: multiResult.frameworkEntities || [],
          success: multiResult.errors.length === 0,
        };
    }
  }

  /**
   * Create default file size policy
   */
  private createDefaultFileSizePolicy(_options: BuildOptions): FileSizePolicy {
    return { ...DEFAULT_POLICY };
  }

  private validateOptions(options: BuildOptions): Required<BuildOptions> {
    return {
      includeTestFiles: options.includeTestFiles ?? true,
      includeNodeModules: options.includeNodeModules ?? false,
      maxFiles: options.maxFiles ?? 10000,
      fileExtensions: options.fileExtensions ?? [
        '.js',
        '.jsx',
        '.ts',
        '.tsx',
        '.mjs',
        '.cjs',
        '.vue',
        '.php',
        '.cs',
      ],

      fileSizePolicy: options.fileSizePolicy || this.createDefaultFileSizePolicy(options),
      chunkOverlapLines: options.chunkOverlapLines ?? 100,
      encodingFallback: options.encodingFallback ?? 'iso-8859-1',
      compassignorePath: options.compassignorePath,
      enableParallelParsing: options.enableParallelParsing ?? true,
      maxConcurrency: options.maxConcurrency ?? 10,
      skipEmbeddings: options.skipEmbeddings ?? false,
      forceFullAnalysis: options.forceFullAnalysis ?? false,

      // Phase 5 - Cross-stack analysis options
      enableCrossStackAnalysis: options.enableCrossStackAnalysis ?? false,
      detectFrameworks: options.detectFrameworks ?? false,
      verbose: options.verbose ?? false,
    };
  }

  /**
   * Create file dependencies for unresolved external calls (e.g., Laravel model calls)
   */
  private createExternalCallFileDependencies(
    parseResults: Array<ParseResult & { filePath: string }>,
    dbFiles: File[],
    symbols: Symbol[]
  ): CreateFileDependency[] {
    const fileDependencies: CreateFileDependency[] = [];

    // Create lookup maps for efficiency
    const pathToFileId = new Map<string, number>();
    const symbolIdToFileId = new Map<number, number>();

    // Populate file mappings
    for (const file of dbFiles) {
      pathToFileId.set(file.path, file.id);
    }

    // Populate symbol to file mapping
    for (const symbol of symbols) {
      symbolIdToFileId.set(symbol.id, symbol.file_id);
    }

    // Track existing symbol dependencies to avoid duplicates
    const existingSymbolDeps = new Set<string>();
    // Note: We'll populate this by checking if symbols were successfully resolved

    for (const parseResult of parseResults) {
      const sourceFileId = pathToFileId.get(parseResult.filePath);
      if (!sourceFileId) continue;

      // Check each dependency to see if it was resolved to a symbol dependency
      for (const dependency of parseResult.dependencies) {
        // Handle both 'calls' and 'imports' dependencies for external calls
        if (dependency.dependency_type !== 'calls' && dependency.dependency_type !== 'imports') {
          continue;
        }

        // Check if this is likely an external call
        // For calls: contains :: for static methods (User::all, User::create)
        // For imports: Laravel facades and framework calls
        const isExternalCall =
          dependency.to_symbol.includes('::') || dependency.dependency_type === 'imports';

        if (isExternalCall) {
          // Create a file dependency representing this external call
          // The "target" will be the same file for now, representing the external call
          fileDependencies.push({
            from_file_id: sourceFileId,
            to_file_id: sourceFileId, // External calls don't have a target file in our codebase
            dependency_type: dependency.dependency_type,
            line_number: dependency.line_number,
          });
        }
      }
    }

    this.logger.info('Created external call file dependencies', {
      count: fileDependencies.length,
    });

    return fileDependencies;
  }

  /**
   * Create file dependencies for external imports (e.g., Laravel facades, npm packages)
   */
  private createExternalImportFileDependencies(
    parseResults: Array<ParseResult & { filePath: string }>,
    dbFiles: File[]
  ): CreateFileDependency[] {
    const fileDependencies: CreateFileDependency[] = [];

    // Create lookup map for efficiency
    const pathToFileId = new Map<string, number>();
    for (const file of dbFiles) {
      pathToFileId.set(file.path, file.id);
    }

    for (const parseResult of parseResults) {
      const sourceFileId = pathToFileId.get(parseResult.filePath);
      if (!sourceFileId) continue;

      // Process imports to identify external packages
      for (const importInfo of parseResult.imports) {
        // Check if this is an external import (not relative/absolute path to local file)
        const isExternalImport =
          !importInfo.source.startsWith('./') &&
          !importInfo.source.startsWith('../') &&
          !importInfo.source.startsWith('/') &&
          !importInfo.source.startsWith('src/') &&
          !importInfo.source.startsWith('@/');

        if (isExternalImport) {
          // Create a file dependency representing this external import
          // Since we can't reference a real external file, we create a self-reference
          // The presence of this dependency with dependency_type 'imports' indicates external usage
          fileDependencies.push({
            from_file_id: sourceFileId,
            to_file_id: sourceFileId, // Self-reference to indicate external import
            dependency_type: DependencyType.IMPORTS,
            line_number: importInfo.line_number || 1,
          });
        }
      }
    }

    this.logger.info('Created external import file dependencies', {
      count: fileDependencies.length,
    });

    return fileDependencies;
  }

  /**
   * Create file dependencies from cross-file symbol dependencies
   */
  private createCrossFileFileDependencies(
    symbolDependencies: any[],
    symbols: Symbol[],
    dbFiles: File[]
  ): CreateFileDependency[] {
    const fileDependencies: CreateFileDependency[] = [];

    // Create lookup maps for efficiency
    const symbolIdToFileId = new Map<number, number>();
    const fileIdToPath = new Map<number, string>();
    const pathToFileId = new Map<string, number>();

    // Populate symbol to file mapping
    for (const symbol of symbols) {
      symbolIdToFileId.set(symbol.id, symbol.file_id);
    }

    // Populate file mappings
    for (const file of dbFiles) {
      fileIdToPath.set(file.id, file.path);
      pathToFileId.set(file.path, file.id);
    }

    // Process each symbol dependency
    for (const symbolDep of symbolDependencies) {
      const fromFileId = symbolIdToFileId.get(symbolDep.from_symbol_id);
      const toFileId = symbolIdToFileId.get(symbolDep.to_symbol_id);

      // Only create file dependency if symbols are in different files
      if (fromFileId && toFileId && fromFileId !== toFileId) {
        // Check if this file dependency already exists in our list
        const existingDep = fileDependencies.find(
          fd =>
            fd.from_file_id === fromFileId &&
            fd.to_file_id === toFileId &&
            fd.dependency_type === symbolDep.dependency_type
        );

        if (!existingDep) {
          fileDependencies.push({
            from_file_id: fromFileId,
            to_file_id: toFileId,
            dependency_type: symbolDep.dependency_type,
            line_number: symbolDep.line_number,
          });
        }
      }
    }

    return fileDependencies;
  }

  private async persistVirtualFrameworkSymbols(
    repository: Repository,
    symbolGraph: SymbolGraphData,
    existingSymbols: Symbol[]
  ): Promise<void> {
    const virtualNodes = symbolGraph.nodes.filter(node => node.fileId < 0);

    if (virtualNodes.length === 0) {
      return;
    }

    this.logger.info('Persisting virtual framework symbols', { count: virtualNodes.length });

    const symbolsByFramework = new Map<string, typeof virtualNodes>();

    for (const node of virtualNodes) {
      const existingSymbol = existingSymbols.find(s => s.id === node.id);
      const framework = existingSymbol?.framework || 'unknown';

      if (!symbolsByFramework.has(framework)) {
        symbolsByFramework.set(framework, []);
      }
      symbolsByFramework.get(framework)!.push(node);
    }

    const idMapping = new Map<number, number>();

    for (const [framework, nodes] of symbolsByFramework) {
      const frameworkFile = await this.dbService.createFile({
        repo_id: repository.id,
        path: `[Framework:${framework}]`,
        language: framework.toLowerCase(),
        size: 0,
        is_generated: true,
      });

      const symbolsToCreate: CreateSymbol[] = nodes.map(node => {
        const createSymbol: CreateSymbol = {
          file_id: frameworkFile.id,
          name: node.name,
          symbol_type: node.type,
          start_line: node.startLine,
          end_line: node.endLine,
          is_exported: node.isExported,
          signature: node.signature,
        };

        if (node.visibility) {
          createSymbol.visibility = node.visibility as any;
        }

        return createSymbol;
      });

      const createdSymbols = await this.dbService.createSymbols(symbolsToCreate);

      for (let i = 0; i < nodes.length; i++) {
        idMapping.set(nodes[i].id, createdSymbols[i].id);
        const originalNode = symbolGraph.nodes.find(n => n.id === nodes[i].id);
        if (originalNode) {
          originalNode.id = createdSymbols[i].id;
          originalNode.fileId = createdSymbols[i].file_id;
        }
      }
    }

    for (const edge of symbolGraph.edges) {
      if (idMapping.has(edge.from)) {
        edge.from = idMapping.get(edge.from)!;
      }
      if (idMapping.has(edge.to)) {
        edge.to = idMapping.get(edge.to)!;
      }
    }

    this.logger.info('Virtual framework symbols persisted', { count: idMapping.size });
  }
}
