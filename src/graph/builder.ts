import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { Repository, File, Symbol, CreateFile, CreateSymbol } from '../database/models';
import { DatabaseService } from '../database/services';
import { getParserForFile, ParseResult } from '../parsers';
import { FileGraphBuilder, FileGraphData } from './file-graph';
import { SymbolGraphBuilder, SymbolGraphData } from './symbol-graph';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('graph-builder');

export interface BuildOptions {
  includeTestFiles?: boolean;
  includeNodeModules?: boolean;
  maxFileSize?: number;
  maxFiles?: number;
  fileExtensions?: string[];
}

export interface BuildResult {
  repository: Repository;
  filesProcessed: number;
  symbolsExtracted: number;
  dependenciesCreated: number;
  fileGraph: FileGraphData;
  symbolGraph: SymbolGraphData;
  errors: BuildError[];
}

export interface BuildError {
  filePath: string;
  message: string;
  stack?: string;
}

export class GraphBuilder {
  private dbService: DatabaseService;
  private fileGraphBuilder: FileGraphBuilder;
  private symbolGraphBuilder: SymbolGraphBuilder;
  private logger: any;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
    this.fileGraphBuilder = new FileGraphBuilder();
    this.symbolGraphBuilder = new SymbolGraphBuilder();
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
      options
    });

    const validatedOptions = this.validateOptions(options);

    try {
      // Create or get repository record
      const repository = await this.ensureRepository(repositoryPath);

      // Automatically detect if incremental analysis is possible
      if (repository.last_indexed) {
        this.logger.info('Previous analysis detected, using incremental analysis mode');
        return await this.performIncrementalAnalysis(repositoryPath, repository, validatedOptions);
      } else {
        this.logger.info('No previous analysis found, performing full analysis');
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

      // Build graphs
      const importsMap = this.createImportsMap(dbFiles, parseResults);
      const exportsMap = this.createExportsMap(dbFiles, parseResults);
      const dependenciesMap = this.createDependenciesMap(symbols, parseResults);

      const fileGraph = await this.fileGraphBuilder.buildFileGraph(
        repository,
        dbFiles,
        importsMap,
        exportsMap
      );

      const symbolGraph = await this.symbolGraphBuilder.buildSymbolGraph(
        symbols,
        dependenciesMap
      );

      // Store dependencies
      const fileDependencies = this.fileGraphBuilder.createFileDependencies(fileGraph, new Map());
      const symbolDependencies = this.symbolGraphBuilder.createSymbolDependencies(symbolGraph);

      // Store file dependencies in separate table
      if (fileDependencies.length > 0) {
        await this.dbService.createFileDependencies(fileDependencies);
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

      return {
        repository,
        filesProcessed: files.length,
        symbolsExtracted: symbols.length,
        dependenciesCreated: fileDependencies.length + symbolDependencies.length,
        fileGraph,
        symbolGraph,
        errors
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
        dependenciesMap
      );

      return {
        repository,
        filesProcessed: 0,
        symbolsExtracted: 0,
        dependenciesCreated: 0,
        fileGraph,
        symbolGraph,
        errors: []
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
      dependenciesMap
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
      errors: partialResult.errors || []
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

    const traverse = async (currentPath: string): Promise<void> => {
      const stats = await fs.stat(currentPath);

      if (stats.isDirectory()) {
        // Skip certain directories
        const dirName = path.basename(currentPath);
        if (this.shouldSkipDirectory(dirName, options)) {
          return;
        }

        const entries = await fs.readdir(currentPath);

        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry);
          await traverse(entryPath);
        }

      } else if (stats.isFile()) {
        if (this.shouldIncludeFile(currentPath, options)) {
          files.push({
            path: currentPath,
            relativePath: path.relative(repositoryPath, currentPath)
          });
        }
      }
    };

    await traverse(repositoryPath);

    // Limit the number of files if specified
    if (options.maxFiles && files.length > options.maxFiles) {
      this.logger.warn(`Limiting analysis to ${options.maxFiles} files`);
      return files.slice(0, options.maxFiles);
    }

    return files;
  }

  private async parseFiles(
    files: Array<{ path: string; relativePath?: string }>,
    options: BuildOptions
  ): Promise<Array<ParseResult & { filePath: string }>> {
    const results: Array<ParseResult & { filePath: string }> = [];

    for (const file of files) {
      try {
        const parser = getParserForFile(file.path);
        if (!parser) {
          this.logger.debug('No parser found for file', { path: file.path });
          continue;
        }

        const content = await fs.readFile(file.path, 'utf-8');

        if (content.length > options.maxFileSize!) {
          this.logger.warn('File exceeds size limit', {
            path: file.path,
            size: content.length
          });
          continue;
        }

        const parseResult = await parser.parseFile(file.path, content, {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          maxFileSize: options.maxFileSize
        });

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
          }]
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

      if (!parseResult || parseResult.errors.some(e => e.severity === 'error')) {
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

  private createDependenciesMap(symbols: Symbol[], parseResults: Array<ParseResult & { filePath: string }>) {
    const map = new Map();

    for (const symbol of symbols) {
      // Find the corresponding parse result
      const file = parseResults.find(r => r.symbols.some(s => s.name === symbol.name));
      if (file) {
        const dependencies = file.dependencies.filter(d => d.from_symbol === symbol.name);
        map.set(symbol.id, dependencies);
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

  private shouldIncludeFile(filePath: string, options: BuildOptions): boolean {
    const ext = path.extname(filePath);

    if (options.fileExtensions && !options.fileExtensions.includes(ext)) {
      return false;
    }

    const defaultExtensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
    if (!defaultExtensions.includes(ext)) {
      return false;
    }

    if (!options.includeTestFiles && this.isTestFile(filePath)) {
      return false;
    }

    return true;
  }

  private isTestFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return fileName.includes('.test.') ||
           fileName.includes('.spec.') ||
           fileName.endsWith('.test') ||
           fileName.endsWith('.spec') ||
           filePath.includes('__tests__') ||
           filePath.includes('/test/') ||
           filePath.includes('/tests/');
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

  private validateOptions(options: BuildOptions): Required<BuildOptions> {
    return {
      includeTestFiles: options.includeTestFiles ?? true,
      includeNodeModules: options.includeNodeModules ?? false,
      maxFileSize: options.maxFileSize ?? 1024 * 1024, // 1MB
      maxFiles: options.maxFiles ?? 10000,
      fileExtensions: options.fileExtensions ?? ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']
    };
  }
}