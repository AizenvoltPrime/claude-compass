import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { Repository, File, Symbol, CreateFile, CreateSymbol, CreateFileDependency, DependencyType, ApiCall, DataContract } from '../database/models';
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
  ParsedDependency
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
    averageConfidence?: number;
    totalApiCalls?: number;
    totalDataContracts?: number;
    analysisTimestamp?: Date;
  };
}

export interface CrossStackGraphNode {
  id: string;
  type: 'vue_component' | 'laravel_route' | 'typescript_interface' | 'php_dto' | 'api_call' | 'data_contract';
  name: string;
  filePath: string;
  framework: 'vue' | 'laravel' | 'cross-stack';
  symbolId?: number;
  confidence?: number;
}

export interface CrossStackGraphEdge {
  id: string;
  from: string;
  to: string;
  type: 'api_call' | 'shares_schema' | 'frontend_backend';
  confidence: number;
  metadata?: Record<string, any>;
}

export interface CrossStackFeature {
  id: string;
  name: string;
  description?: string;
  components: CrossStackGraphNode[];
  apiCalls: ApiCall[];
  dataContracts: DataContract[];
  confidence: number;
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
      path: repositoryPath
      // Removed detailed options logging to reduce noise
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
        repositoryId: repository.id
      });
      await this.dbService.cleanupRepositoryData(repository.id);

      // Discover and process files
      const files = await this.discoverFiles(repositoryPath, validatedOptions);
      this.logger.info(`Discovered ${files.length} files`);

      // Parse files and extract symbols
      const parseResults = await this.parseFiles(files, validatedOptions);
      const errors = parseResults.flatMap(r => r.errors.map(e => ({
        filePath: r.filePath,
        message: e.message
      })));

      // Store files and symbols in database
      const dbFiles = await this.storeFiles(repository.id, files, parseResults);
      const symbols = await this.storeSymbols(dbFiles, parseResults);

      // Store framework entities
      await this.storeFrameworkEntities(repository.id, symbols, parseResults);

      // Build graphs
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

      // Store dependencies
      const fileDependencies = this.fileGraphBuilder.createFileDependencies(fileGraph, new Map());
      const symbolDependencies = this.symbolGraphBuilder.createSymbolDependencies(symbolGraph);

      // Create cross-file dependencies from symbol dependencies
      this.logger.debug('Processing cross-file dependencies', {
        symbolDependenciesCount: symbolDependencies.length,
        symbolsCount: symbols.length,
        filesCount: dbFiles.length
      });

      const crossFileFileDependencies = this.createCrossFileFileDependencies(symbolDependencies, symbols, dbFiles);

      // Create file dependencies for unresolved external calls (e.g., Laravel model calls)
      const externalCallFileDependencies = this.createExternalCallFileDependencies(parseResults, dbFiles, symbols);

      // Create file dependencies for external imports (e.g., Laravel facades)
      const externalImportFileDependencies = this.createExternalImportFileDependencies(parseResults, dbFiles);

      // Combine file dependencies
      const allFileDependencies = [...fileDependencies, ...crossFileFileDependencies, ...externalCallFileDependencies, ...externalImportFileDependencies];

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
        git_hash: await this.getGitHash(repositoryPath)
      });

      const duration = Date.now() - startTime;
      this.logger.info('Repository analysis completed', {
        duration,
        filesProcessed: files.length,
        symbolsExtracted: symbols.length
      });

      // Phase 5 - Cross-stack analysis
      let crossStackGraph: CrossStackGraphData | undefined;
      if (validatedOptions.enableCrossStackAnalysis) {
        this.logger.info('Starting cross-stack analysis', {
          repositoryId: repository.id
        });
        try {
          const fullStackGraph = await this.crossStackGraphBuilder.buildFullStackFeatureGraph(repository.id);

          // Convert CrossStackGraphBuilder types to GraphBuilder types
          const convertGraph = (graph: any) => ({
            nodes: graph.nodes.map((node: any) => ({
              id: node.id,
              type: node.type,
              name: node.name,
              filePath: node.filePath,
              framework: node.framework,
              symbolId: node.metadata?.symbolId,
              confidence: node.metadata?.confidence || 1.0
            })),
            edges: graph.edges.map((edge: any) => ({
              id: edge.id,
              from: edge.from,
              to: edge.to,
              type: edge.relationshipType === 'api_call' ? 'api_call' :
                    edge.relationshipType === 'shares_schema' ? 'shares_schema' : 'frontend_backend',
              confidence: edge.confidence,
              metadata: edge.metadata
            }))
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
                  confidence: c.metadata?.confidence || 1.0
                })),
                ...feature.laravelRoutes.map((r: any) => ({
                  id: r.id,
                  type: r.type,
                  name: r.name,
                  filePath: r.filePath,
                  framework: r.framework,
                  symbolId: r.metadata?.symbolId,
                  confidence: r.metadata?.confidence || 1.0
                }))
              ],
              apiCalls: [], // Will be populated from database if needed
              dataContracts: [], // Will be populated from database if needed
              confidence: feature.confidence
            })),
            metadata: {
              averageConfidence: fullStackGraph.metadata.averageConfidence,
              totalApiCalls: fullStackGraph.apiCallGraph.edges.length,
              totalDataContracts: fullStackGraph.dataContractGraph.edges.length,
              analysisTimestamp: new Date()
            }
          };
          this.logger.info('Cross-stack analysis completed', {
            apiCalls: crossStackGraph.metadata.totalApiCalls,
            dataContracts: crossStackGraph.metadata.totalDataContracts,
            averageConfidence: crossStackGraph.metadata.averageConfidence
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
        crossStackGraph
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
        lastIndexed: lastIndexed.toISOString()
      });

      // Discover all current files
      const currentFiles = await this.discoverFiles(repositoryPath, options);

      // Check each file's modification time
      for (const fileInfo of currentFiles) {
        try {
          const stats = await fs.stat(fileInfo.path);
          if (stats.mtime > lastIndexed) {
            changedFiles.push(fileInfo.path);
            this.logger.debug('File changed since last analysis', {
              file: fileInfo.relativePath,
              lastModified: stats.mtime.toISOString(),
              lastAnalyzed: lastIndexed.toISOString()
            });
          }
        } catch (error) {
          // File might have been deleted, skip it
          this.logger.warn('Error checking file modification time', {
            file: fileInfo.path,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      this.logger.info('Change detection completed', {
        totalFiles: currentFiles.length,
        changedFiles: changedFiles.length
      });

      return changedFiles;

    } catch (error) {
      this.logger.error('Error during change detection, falling back to full analysis', {
        error: error instanceof Error ? error.message : String(error)
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
      repositoryPath
    });

    // Detect changed files
    const changedFiles = await this.detectChangedFiles(repositoryPath, repository, options);

    if (changedFiles.length === 0) {
      this.logger.info('No changed files detected, skipping analysis');

      // Return current graph state - need to fetch data from database
      const dbFiles = await this.dbService.getFilesByRepository(repository.id);
      const symbols = await this.dbService.getSymbolsByRepository(repository.id);

      // Create empty maps for unchanged files (no new imports/exports)
      const importsMap = new Map<number, any[]>();
      const exportsMap = new Map<number, any[]>();
      const dependenciesMap = new Map<number, any[]>();

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

      return {
        repository,
        filesProcessed: 0,
        symbolsExtracted: 0,
        dependenciesCreated: 0,
        fileGraph,
        symbolGraph,
        errors: [],
        totalFiles: dbFiles.length,
        totalSymbols: symbols.length
      };
    }

    this.logger.info(`Processing ${changedFiles.length} changed files`);

    // Re-analyze only changed files
    const partialResult = await this.reanalyzeFiles(repository.id, changedFiles, options);

    // Rebuild graphs with updated data - fetch all current data from database
    const dbFiles = await this.dbService.getFilesByRepository(repository.id);
    const symbols = await this.dbService.getSymbolsByRepository(repository.id);

    // Create empty maps for graph building (symbols/dependencies are in database)
    const importsMap = new Map<number, any[]>();
    const exportsMap = new Map<number, any[]>();
    const dependenciesMap = new Map<number, any[]>();

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

    // Update repository timestamp
    await this.dbService.updateRepository(repository.id, {
      last_indexed: new Date()
    });

    this.logger.info('Incremental analysis completed', {
      filesProcessed: partialResult.filesProcessed || 0,
      symbolsExtracted: partialResult.symbolsExtracted || 0,
      errors: partialResult.errors?.length || 0
    });

    return {
      repository,
      filesProcessed: partialResult.filesProcessed || 0,
      symbolsExtracted: partialResult.symbolsExtracted || 0,
      dependenciesCreated: 0, // Will be calculated from graph
      fileGraph,
      symbolGraph,
      errors: partialResult.errors || [],
      totalFiles: dbFiles.length,
      totalSymbols: symbols.length
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
      fileCount: filePaths.length
    });

    const validatedOptions = this.validateOptions(options);
    const files = filePaths.map(filePath => ({ path: filePath }));

    const parseResults = await this.parseFiles(files as any[], validatedOptions);
    const repository = await this.dbService.getRepository(repositoryId);

    if (!repository) {
      throw new Error(`Repository with id ${repositoryId} not found`);
    }

    // Update existing files or create new ones
    const dbFiles = await this.storeFiles(repositoryId, files as any[], parseResults);
    const symbols = await this.storeSymbols(dbFiles, parseResults);

    // Store framework entities for changed files
    await this.storeFrameworkEntities(repositoryId, symbols, parseResults);

    return {
      filesProcessed: files.length,
      symbolsExtracted: symbols.length,
      errors: parseResults.flatMap(r => r.errors.map(e => ({
        filePath: r.filePath,
        message: e.message
      })))
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
        framework_stack: frameworkStack
      });

      this.logger.info('Created new repository', {
        name,
        path: absolutePath,
        id: repository.id
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

    this.logger.info('Starting file discovery', { repositoryPath, allowedExtensions: options.fileExtensions });

    const traverse = async (currentPath: string): Promise<void> => {
      try {
        const stats = await fs.stat(currentPath);
        this.logger.info('Traversing path', { path: currentPath, isDirectory: stats.isDirectory() });

        if (stats.isDirectory()) {
        const dirName = path.basename(currentPath);
        const relativePath = path.relative(repositoryPath, currentPath);

        // Check .compassignore patterns first
        if (compassIgnore.shouldIgnore(currentPath, relativePath)) {
          this.logger.debug('Directory ignored by .compassignore', { path: relativePath });
          return;
        }

        // Then check built-in skip logic
        if (this.shouldSkipDirectory(dirName, options)) {
          return;
        }

        const entries = await fs.readdir(currentPath);

        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry);
          await traverse(entryPath);
        }

      } else if (stats.isFile()) {
        const relativePath = path.relative(repositoryPath, currentPath);

        // Check .compassignore patterns first
        if (compassIgnore.shouldIgnore(currentPath, relativePath)) {
          this.logger.debug('File ignored by .compassignore', { path: relativePath });
          return;
        }

        // Then check built-in include logic
        if (this.shouldIncludeFile(currentPath, relativePath, options)) {
          this.logger.info('Including file', { path: relativePath });
          files.push({
            path: currentPath,
            relativePath: relativePath
          });
        } else {
          this.logger.info('File excluded', { path: relativePath, reason: 'shouldIncludeFile returned false' });
        }
      }
      } catch (error) {
        this.logger.error('Error traversing path', { path: currentPath, error: error.message });
      }
    };

    await traverse(repositoryPath);

    this.logger.info('File discovery completed', {
      totalFiles: files.length,
      patternsUsed: compassIgnore.getPatterns()
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
  private async loadCompassIgnore(repositoryPath: string, options: BuildOptions): Promise<CompassIgnore> {
    if (options.compassignorePath) {
      // Use custom path if provided
      const customPath = path.isAbsolute(options.compassignorePath)
        ? options.compassignorePath
        : path.join(repositoryPath, options.compassignorePath);
      const compassIgnore = await CompassIgnore.fromFile(customPath);

      // Add default patterns if no custom .compassignore file exists
      if (!await this.fileExists(customPath)) {
        compassIgnore.addPatterns(require('../utils/compassignore').DEFAULT_IGNORE_PATTERNS);
      }

      return compassIgnore;
    }

    // Use default .compassignore in repository root, with fallback to default patterns
    const compassIgnore = await CompassIgnore.fromDirectory(repositoryPath);
    const compassIgnorePath = path.join(repositoryPath, '.compassignore');

    // If no .compassignore file exists, add default patterns
    if (!await this.fileExists(compassIgnorePath)) {
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
    const results: Array<ParseResult & { filePath: string }> = [];
    const multiParser = new MultiParser();

    for (const file of files) {
      try {
        const content = await this.readFileWithEncodingRecovery(file.path, options);
        if (!content) {
          continue; // File was rejected due to encoding issues
        }

        const parseResult = await this.processFileWithSizePolicyMultiParser(file, content, multiParser, options);
        if (!parseResult) {
          continue; // File was rejected by size policy
        }

        results.push({
          ...parseResult,
          filePath: file.path
        });

      } catch (error) {
        this.logger.error('Failed to parse file', {
          path: file.path,
          error: (error as Error).message
        });

        results.push({
          filePath: file.path,
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [{
            message: (error as Error).message,
            line: 0,
            column: 0,
            severity: 'error'
          }],
          success: false
        });
      }
    }

    return results;
  }

  private async storeFiles(
    repositoryId: number,
    files: Array<{ path: string }>,
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<File[]> {
    const dbFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const parseResult = parseResults[i];

      // Skip files only if no parse result exists, but allow files with parsing errors
      // to be stored (especially framework-specific files like .prisma, .vue, etc.)
      if (!parseResult) {
        continue;
      }

      try {
        const stats = await fs.stat(file.path);
        const language = this.detectLanguageFromPath(file.path);

        const createFile: CreateFile = {
          repo_id: repositoryId,
          path: file.path,
          language,
          size: stats.size,
          last_modified: stats.mtime,
          is_generated: this.isGeneratedFile(file.path),
          is_test: this.isTestFile(file.path)
        };

        const dbFile = await this.dbService.createFile(createFile);
        dbFiles.push(dbFile);

      } catch (error) {
        this.logger.error('Failed to store file', {
          path: file.path,
          error: (error as Error).message
        });
      }
    }

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
          symbol_type: symbol.symbol_type,
          start_line: symbol.start_line,
          end_line: symbol.end_line,
          is_exported: symbol.is_exported,
          visibility: symbol.visibility as any,
          signature: symbol.signature
        });
      }
    }

    return await this.dbService.createSymbols(allSymbols);
  }

  private async storeFrameworkEntities(
    repositoryId: number,
    symbols: Symbol[],
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<void> {
    this.logger.info('Storing framework entities', {
      repositoryId,
      parseResultsCount: parseResults.length
    });

    for (const parseResult of parseResults) {

      // Skip if no framework entities
      if (!parseResult.frameworkEntities || parseResult.frameworkEntities.length === 0) {
        continue;
      }

      // Find symbols for this parse result's file by matching the file path
      // Note: symbols should have been stored with file_id pointing to files that match parseResult.filePath
      const fileSymbols = symbols.filter(s => {
        // We need to find the file record that matches this symbol's file_id and see if its path matches parseResult.filePath
        // Since we don't have direct access to files here, let's match by parse result symbols instead
        return parseResult.symbols.some(ps => ps.name === s.name && ps.symbol_type === s.symbol_type);
      });


      for (const entity of parseResult.frameworkEntities) {
        let matchingSymbol: Symbol | undefined;
        try {

          // Find matching symbol for this entity
          matchingSymbol = fileSymbols.find(s =>
            s.name === entity.name ||
            entity.name.includes(s.name) ||
            s.name.includes(entity.name)
          );

          if (!matchingSymbol) {
            // Create a synthetic symbol for this framework entity

            // First, get the file ID for this parse result
            const files = await this.dbService.getFilesByRepository(repositoryId);

            // Try multiple matching strategies to find the file
            let matchingFile = files.find(f => f.path === parseResult.filePath);

            if (!matchingFile) {
              // Try matching by normalized paths (handles different path separators)
              const normalizedParseResultPath = path.normalize(parseResult.filePath);
              matchingFile = files.find(f => path.normalize(f.path) === normalizedParseResultPath);
            }

            if (!matchingFile) {
              // Try matching by relative path (in case one is absolute and other is relative)
              const parseResultBasename = path.basename(parseResult.filePath);
              matchingFile = files.find(f => {
                const dbPathBasename = path.basename(f.path);
                // Match if basenames are the same and the relative parts match
                if (dbPathBasename === parseResultBasename) {
                  // Extract relative path from the full parseResult path
                  const parseResultDir = path.dirname(parseResult.filePath);
                  const dbPathDir = path.dirname(f.path);
                  // Check if the directory structures match (considering both might be partial paths)
                  return parseResultDir.endsWith(dbPathDir) || dbPathDir.endsWith(parseResultDir) ||
                         path.basename(parseResultDir) === path.basename(dbPathDir);
                }
                return false;
              });
            }

            if (!matchingFile) {
              this.logger.warn('Could not find file record for framework entity', {
                filePath: parseResult.filePath,
                normalizedFilePath: path.normalize(parseResult.filePath),
                entityName: entity.name,
                entityType: entity.type,
                availableFilesCount: files.length,
                sampleAvailableFiles: files.map(f => ({
                  path: f.path,
                  normalized: path.normalize(f.path)
                })).slice(0, 5), // Show first 5 with normalized paths for debugging
                parseResultDirectory: path.dirname(parseResult.filePath),
                parseResultBasename: path.basename(parseResult.filePath)
              });
              continue;
            }

            // Create symbol for the framework entity
            const syntheticSymbol = await this.dbService.createSymbol({
              file_id: matchingFile.id,
              name: entity.name,
              symbol_type: 'component' as any, // Vue components, React components etc.
              start_line: 1, // Default to start of file
              end_line: 1,
              is_exported: true, // Framework entities are typically exported
              signature: `${entity.type} ${entity.name}`
            });

            matchingSymbol = syntheticSymbol;
          }


          // Store different types of framework entities based on specific interfaces
          // Handle Laravel entities first
          if (this.isLaravelRoute(entity)) {
            const laravelRoute = entity as LaravelRoute;
            // Normalize HTTP method - convert Laravel-specific methods to standard HTTP methods
            let normalizedMethod = laravelRoute.method;
            if (normalizedMethod === 'RESOURCE') {
              normalizedMethod = 'ANY'; // Resource routes handle multiple methods
            }

            await this.dbService.createRoute({
              repo_id: repositoryId,
              path: laravelRoute.path,
              method: normalizedMethod,
              handler_symbol_id: matchingSymbol.id,
              framework_type: 'laravel',
              middleware: laravelRoute.middleware || [],
              dynamic_segments: [], // Laravel dynamic segments would need parsing
              auth_required: false // Could be enhanced to check middleware for auth
            });
          } else if (this.isLaravelController(entity)) {
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
                resourceController: (entity as LaravelController).resourceController
              }
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
                relationships: (entity as EloquentModel).relationships
              }
            });
          } else if (this.isRouteEntity(entity)) {
            const routeEntity = entity as NextJSRoute | ExpressRoute | FastifyRoute | VueRoute;
            await this.dbService.createRoute({
              repo_id: repositoryId,
              path: routeEntity.path || '/',
              method: (routeEntity as any).method || 'GET',
              handler_symbol_id: matchingSymbol.id,
              framework_type: (routeEntity as any).framework || 'unknown',
              middleware: (routeEntity as any).middleware || [],
              dynamic_segments: (routeEntity as any).dynamicSegments || [],
              auth_required: false // Not available in current interfaces
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
              template_dependencies: vueEntity.template_dependencies || []
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
              template_dependencies: reactEntity.jsxDependencies || []
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
              dependency_array: []
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
              dependency_array: []
            });
          } else if (this.isJobSystemEntity(entity)) {
            // Handle background job system entities
            const jobSystemEntity = entity as any;
            await this.dbService.createJobQueue({
              repo_id: repositoryId,
              name: jobSystemEntity.name,
              queue_type: jobSystemEntity.jobSystems?.[0] || 'bull', // Use first detected system
              symbol_id: matchingSymbol.id,
              config_data: jobSystemEntity.config || {}
            });
          } else if (this.isORMSystemEntity(entity)) {
            // Handle ORM system entities
            const ormSystemEntity = entity as any;
            this.logger.debug('Creating ORM entity', {
              entityName: ormSystemEntity.name,
              ormType: ormSystemEntity.metadata?.orm || ormSystemEntity.name || 'unknown',
              symbolId: matchingSymbol.id,
              entity: ormSystemEntity
            });
            await this.dbService.createORMEntity({
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              entity_name: ormSystemEntity.name,
              orm_type: ormSystemEntity.metadata?.orm || ormSystemEntity.name || 'unknown',
              fields: ormSystemEntity.metadata?.fields || {}
            });
          } else if (this.isTestSystemEntity(entity)) {
            // Handle test framework system entities
            const testSystemEntity = entity as any;

            // First, get the file ID for this parse result
            const files = await this.dbService.getFilesByRepository(repositoryId);
            const matchingFile = files.find(f => f.path === parseResult.filePath);

            if (matchingFile) {
              await this.dbService.createTestSuite({
                repo_id: repositoryId,
                file_id: matchingFile.id,
                suite_name: testSystemEntity.name,
                framework_type: testSystemEntity.testFrameworks?.[0] || 'jest'
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
              package_manager: packageSystemEntity.packageManagers?.[0] || 'npm'
            });
          } else if (this.isGodotScene(entity)) {
            // Handle Godot scene entities - Core of Solution 1
            const sceneEntity = entity as any;
            this.logger.debug('Creating Godot scene', {
              sceneName: sceneEntity.name,
              scenePath: sceneEntity.scenePath || parseResult.filePath,
              nodeCount: sceneEntity.nodes?.length || 0
            });

            const storedScene = await this.dbService.storeGodotScene({
              repo_id: repositoryId,
              scene_path: sceneEntity.scenePath || parseResult.filePath,
              scene_name: sceneEntity.name,
              node_count: sceneEntity.nodes?.length || 0,
              has_script: sceneEntity.nodes?.some((node: any) => node.script) || false,
              metadata: {
                rootNodeType: sceneEntity.rootNode?.nodeType,
                connections: sceneEntity.connections?.length || 0,
                resources: sceneEntity.resources?.length || 0
              }
            });

            // Store nodes for this scene
            if (sceneEntity.nodes && Array.isArray(sceneEntity.nodes)) {
              for (const node of sceneEntity.nodes) {
                const storedNode = await this.dbService.storeGodotNode({
                  repo_id: repositoryId,
                  scene_id: storedScene.id,
                  node_name: node.nodeName || node.name,
                  node_type: node.nodeType || node.type || 'Node',
                  script_path: node.script,
                  properties: node.properties || {}
                });

                // Create scene-script relationship if node has script
                if (node.script) {
                  // Find the script entity and create relationship
                  const scriptEntity = await this.dbService.findGodotScriptByPath(repositoryId, node.script);
                  if (scriptEntity) {
                    await this.dbService.createGodotRelationship({
                      repo_id: repositoryId,
                      relationship_type: 'scene_script_attachment' as any,
                      from_entity_type: 'scene' as any,
                      from_entity_id: storedScene.id,
                      to_entity_type: 'script' as any,
                      to_entity_id: scriptEntity.id,
                      confidence: 0.95
                    });
                  }
                }
              }

              // Update scene with root node reference
              if (sceneEntity.rootNode) {
                const rootNode = sceneEntity.nodes.find((n: any) =>
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
            this.logger.debug('Creating Godot script', {
              className: scriptEntity.className,
              scriptPath: parseResult.filePath,
              isAutoload: scriptEntity.isAutoload,
              signalCount: scriptEntity.signals?.length || 0
            });

            await this.dbService.storeGodotScript({
              repo_id: repositoryId,
              script_path: parseResult.filePath,
              class_name: scriptEntity.className || scriptEntity.name,
              base_class: scriptEntity.baseClass,
              is_autoload: scriptEntity.isAutoload || false,
              signals: scriptEntity.signals || [],
              exports: scriptEntity.exports || [],
              metadata: {
                attachedScenes: scriptEntity.attachedScenes || []
              }
            });
          } else if (this.isGodotAutoload(entity)) {
            // Handle Godot autoload entities
            const autoloadEntity = entity as any;
            this.logger.debug('Creating Godot autoload', {
              autoloadName: autoloadEntity.autoloadName,
              scriptPath: autoloadEntity.scriptPath
            });

            // Find the script entity first
            const scriptEntity = await this.dbService.findGodotScriptByPath(repositoryId, autoloadEntity.scriptPath);

            await this.dbService.storeGodotAutoload({
              repo_id: repositoryId,
              autoload_name: autoloadEntity.autoloadName || autoloadEntity.name,
              script_path: autoloadEntity.scriptPath,
              script_id: scriptEntity?.id,
              metadata: {
                className: autoloadEntity.className
              }
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
                confidence: 0.98
              });
            }
          } else {
            this.logger.debug('Unknown framework entity type', {
              type: entity.type,
              name: entity.name,
              filePath: parseResult.filePath
            });
          }
        } catch (error) {
          this.logger.error(`Failed to store ${entity.type} entity '${entity.name}': ${error instanceof Error ? error.message : String(error)}`, {
            entityType: entity.type,
            entityName: entity.name,
            filePath: parseResult.filePath,
            symbolId: matchingSymbol?.id,
            repositoryId: repositoryId
          });
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
          const godotFrameworkEntities = parseResult.frameworkEntities.filter(entity =>
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
        this.logger.debug('No Godot entities found, skipping relationship building');
        return;
      }

      this.logger.info('Building Godot framework relationships', {
        repositoryId,
        totalGodotEntities: godotEntities.length,
        entityTypes: [...new Set(godotEntities.map(e => e.type))]
      });

      // Use the GodotRelationshipBuilder to create relationships
      const relationships = await this.godotRelationshipBuilder.buildRelationships(
        repositoryId,
        godotEntities
      );

      this.logger.info('Godot framework relationships built successfully', {
        repositoryId,
        relationshipsCreated: relationships.length,
        relationshipTypes: [...new Set(relationships.map(r => r.relationship_type))]
      });

    } catch (error) {
      this.logger.error('Failed to build Godot relationships', {
        repositoryId,
        error: (error as Error).message
      });
      // Don't throw - relationship building is optional for overall analysis success
    }
  }

  // Type guards for framework entities
  private isRouteEntity(entity: any): entity is NextJSRoute | ExpressRoute | FastifyRoute | VueRoute {
    return entity.type === 'route' ||
           entity.type === 'nextjs-page-route' ||
           entity.type === 'nextjs-api-route' ||
           entity.type === 'express-route' ||
           entity.type === 'fastify-route' ||
           'path' in entity;
  }

  private isVueComponent(entity: any): entity is VueComponent {
    // Vue components are identified by type 'component' and being in a .vue file
    return entity.type === 'component' &&
           entity.filePath &&
           entity.filePath.endsWith('.vue');
  }

  private isReactComponent(entity: any): entity is ReactComponent {
    return entity.type === 'component' && 'componentType' in entity && 'hooks' in entity && 'jsxDependencies' in entity;
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

  private createDependenciesMap(symbols: Symbol[], parseResults: Array<ParseResult & { filePath: string }>, dbFiles: File[]) {
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

      const dependencies = parseResult.dependencies
        .filter(d => d.from_symbol && d.from_symbol.trim() !== '' && d.to_symbol && d.to_symbol.trim() !== '');

      for (const dependency of dependencies) {
        // Find the specific symbol that contains this dependency call
        // Must match: name, file, and line range
        const containingSymbol = fileSymbols.find(symbol =>
          symbol.name === dependency.from_symbol &&
          dependency.line_number >= symbol.start_line &&
          dependency.line_number <= symbol.end_line
        );

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
    const skipDirs = ['node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'coverage', '.nyc_output'];

    if (skipDirs.includes(dirName)) {
      if (dirName === 'node_modules' && options.includeNodeModules) {
        return false;
      }
      return true;
    }

    return dirName.startsWith('.');
  }

  private shouldIncludeFile(filePath: string, relativePath: string, options: BuildOptions): boolean {
    const ext = path.extname(filePath);

    // Use provided extensions if specified, otherwise fall back to defaults
    const allowedExtensions = options.fileExtensions || ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.php'];

    this.logger.info('Checking file inclusion', {
      filePath,
      ext,
      allowedExtensions,
      includeTestFiles: options.includeTestFiles,
      isTestFile: this.isTestFile(relativePath)
    });

    if (!allowedExtensions.includes(ext)) {
      this.logger.info('File excluded: extension not allowed', { filePath, ext, allowedExtensions });
      return false;
    }

    if (!options.includeTestFiles && this.isTestFile(relativePath)) {
      this.logger.info('File excluded: test file and includeTestFiles is false', { filePath, relativePath });
      return false;
    }

    this.logger.info('File should be included', { filePath });
    return true;
  }

  private isTestFile(relativePath: string): boolean {
    const fileName = path.basename(relativePath).toLowerCase();

    // Check filename patterns first
    if (fileName.includes('.test.') ||
        fileName.includes('.spec.') ||
        fileName.endsWith('.test') ||
        fileName.endsWith('.spec')) {
      return true;
    }

    // Check directory patterns within the project (relative path only)
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const pathSegments = normalizedPath.split('/');

    // Look for test directories in the project structure
    return pathSegments.some(segment =>
      segment === '__tests__' ||
      segment === 'test' ||
      segment === 'tests' ||
      segment === 'spec' ||
      segment === 'specs'
    );
  }

  private isGeneratedFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return fileName.includes('.generated.') ||
           fileName.includes('.gen.') ||
           filePath.includes('/generated/') ||
           filePath.includes('/.next/') ||
           filePath.includes('/dist/') ||
           filePath.includes('/build/');
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

    return frameworks;
  }

  private async getGitHash(repositoryPath: string): Promise<string | undefined> {
    try {
      const hash = execSync('git rev-parse HEAD', {
        cwd: repositoryPath,
        encoding: 'utf-8'
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
          size: content.length
        });
        return null;

      case 'skip':
        this.logger.info('File skipped due to size policy', {
          path: file.path,
          size: content.length
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
          chunkOverlapLines: options.chunkOverlapLines || 100
        };
        return await parser.parseFile(file.path, content, parseOptions);

      case 'truncate':
        // This case should no longer occur since truncation is replaced with chunking
        this.logger.warn('Truncate action requested but using chunking instead', {
          path: file.path,
          size: content.length
        });
        // Fall through to chunked parsing
        const fallbackParseOptions = {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          enableChunking: true,
          enableEncodingRecovery: true,
          chunkSize: fileSizePolicy.truncationFallback,
          chunkOverlapLines: options.chunkOverlapLines || 100
        };
        return await parser.parseFile(file.path, content, fallbackParseOptions);

      case 'warn':
        this.logger.warn('Processing large file', {
          path: file.path,
          size: content.length
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
          chunkOverlapLines: options.chunkOverlapLines || 100
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
          size: content.length
        });
        return null;

      case 'skip':
        this.logger.info('File skipped due to size policy', {
          path: file.path,
          size: content.length
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
          chunkOverlapLines: options.chunkOverlapLines || 100
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
          success: multiResult.errors.length === 0
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
      fileExtensions: options.fileExtensions ?? ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.php'],

      fileSizePolicy: options.fileSizePolicy || this.createDefaultFileSizePolicy(options),
      chunkOverlapLines: options.chunkOverlapLines ?? 100,
      encodingFallback: options.encodingFallback ?? 'iso-8859-1',
      compassignorePath: options.compassignorePath,
      enableParallelParsing: options.enableParallelParsing ?? false,
      forceFullAnalysis: options.forceFullAnalysis ?? false,

      // Phase 5 - Cross-stack analysis options
      enableCrossStackAnalysis: options.enableCrossStackAnalysis ?? false,
      detectFrameworks: options.detectFrameworks ?? false,
      verbose: options.verbose ?? false
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
        const isExternalCall = dependency.to_symbol.includes('::') ||
                               dependency.dependency_type === 'imports';

        if (isExternalCall) {
          this.logger.debug('Creating file dependency for external call', {
            from: dependency.from_symbol,
            to: dependency.to_symbol,
            sourceFile: parseResult.filePath,
            line: dependency.line_number
          });

          // Create a file dependency representing this external call
          // The "target" will be the same file for now, representing the external call
          fileDependencies.push({
            from_file_id: sourceFileId,
            to_file_id: sourceFileId, // External calls don't have a target file in our codebase
            dependency_type: dependency.dependency_type,
            line_number: dependency.line_number,
            confidence: dependency.confidence || 0.8
          });
        }
      }
    }

    this.logger.info('Created external call file dependencies', {
      count: fileDependencies.length
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
        const isExternalImport = !importInfo.source.startsWith('./') &&
                                !importInfo.source.startsWith('../') &&
                                !importInfo.source.startsWith('/') &&
                                !importInfo.source.startsWith('src/') &&
                                !importInfo.source.startsWith('@/');

        if (isExternalImport) {
          this.logger.debug('Creating file dependency for external import', {
            source: importInfo.source,
            importedNames: importInfo.imported_names,
            sourceFile: parseResult.filePath,
            line: importInfo.line_number
          });

          // Create a file dependency representing this external import
          // Since we can't reference a real external file, we create a self-reference
          // The presence of this dependency with dependency_type 'imports' indicates external usage
          fileDependencies.push({
            from_file_id: sourceFileId,
            to_file_id: sourceFileId, // Self-reference to indicate external import
            dependency_type: DependencyType.IMPORTS,
            line_number: importInfo.line_number || 1,
            confidence: 0.9
          });
        }
      }
    }

    this.logger.info('Created external import file dependencies', {
      count: fileDependencies.length
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

    // Log sample of symbol dependencies for debugging
    if (symbolDependencies.length > 0) {
      this.logger.debug('Sample symbol dependency structure', {
        firstDependency: symbolDependencies[0],
        dependencyKeys: Object.keys(symbolDependencies[0] || {})
      });
    }

    // Process each symbol dependency
    for (const symbolDep of symbolDependencies) {
      const fromFileId = symbolIdToFileId.get(symbolDep.from_symbol_id);
      const toFileId = symbolIdToFileId.get(symbolDep.to_symbol_id);

      // Only create file dependency if symbols are in different files
      if (fromFileId && toFileId && fromFileId !== toFileId) {
        // Check if this file dependency already exists in our list
        const existingDep = fileDependencies.find(
          fd => fd.from_file_id === fromFileId &&
                fd.to_file_id === toFileId &&
                fd.dependency_type === symbolDep.dependency_type
        );

        if (!existingDep) {
          fileDependencies.push({
            from_file_id: fromFileId,
            to_file_id: toFileId,
            dependency_type: symbolDep.dependency_type,
            line_number: symbolDep.line_number,
            confidence: symbolDep.confidence
          });
        }
      }
    }

    this.logger.debug('Created cross-file dependencies from symbol dependencies', {
      symbolDependencies: symbolDependencies.length,
      crossFileFileDependencies: fileDependencies.length
    });

    return fileDependencies;
  }
}