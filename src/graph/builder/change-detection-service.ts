import fs from 'fs/promises';
import path from 'path';
import type { Knex } from 'knex';
import { Repository, File, Symbol } from '../../database/models';
import * as FileService from '../../database/services/file-service';
import * as SymbolService from '../../database/services/symbol-service';
import * as DependencyService from '../../database/services/dependency-service';
import * as RepositoryService from '../../database/services/repository-service';
import * as CleanupService from '../../database/services/cleanup-service';
import { FileGraphBuilder, FileGraphData } from '../file-graph';
import { SymbolGraphBuilder, SymbolGraphData } from '../symbol-graph/';
import { BuildOptions, BuildResult, BuildError } from './types';
import { FileDiscoveryService } from './file-discovery-service';
import { RepositoryManager } from './repository-manager';
import { StorageOrchestrator } from './storage-orchestrator';
import { FileParsingOrchestrator } from './file-parsing-orchestrator';
import { EmbeddingOrchestrator } from './embedding-orchestrator';
import { FrameworkEntityPersister } from './framework-entity-persister';
import { GodotRelationshipBuilder } from './godot-relationship-builder';
import {
  createImportsMap,
  createExportsMap,
  createDependenciesMap,
} from './graph-data-map-builder';
import {
  createCrossFileFileDependencies,
  createExternalCallFileDependencies,
  createExternalImportFileDependencies,
} from './file-dependency-builder';
import { createComponentLogger } from '../../utils/logger';

/**
 * Change Detection Service
 * Handles incremental analysis with file change detection and reanalysis
 */
export class ChangeDetectionService {
  private logger: any;
  private buildErrors: BuildError[] = [];

  constructor(
    private db: Knex,
    private fileDiscoveryService: FileDiscoveryService,
    private repositoryManager: RepositoryManager,
    private storageOrchestrator: StorageOrchestrator,
    private fileParsingOrchestrator: FileParsingOrchestrator,
    private embeddingOrchestrator: EmbeddingOrchestrator,
    private frameworkEntityPersister: FrameworkEntityPersister,
    private godotRelationshipBuilder: GodotRelationshipBuilder,
    private fileGraphBuilder: FileGraphBuilder,
    private symbolGraphBuilder: SymbolGraphBuilder,
    logger?: any
  ) {
    this.logger = logger || createComponentLogger('change-detection-service');
  }

  getBuildErrors(): BuildError[] {
    return this.buildErrors;
  }

  clearBuildErrors(): void {
    this.buildErrors = [];
  }

  async detectChangedFiles(
    repositoryPath: string,
    repository: Repository,
    options: BuildOptions
  ): Promise<{
    changedFiles: string[];
    deletedFileIds: number[];
    newFiles: string[];
  }> {
    const changedFiles: string[] = [];
    const newFiles: string[] = [];
    const deletedFileIds: number[] = [];

    const lastIndexed = repository.last_indexed;
    if (!lastIndexed) {
      this.logger.info('No previous analysis found, treating all files as new');
      const allFiles = await this.fileDiscoveryService.discoverFiles(repositoryPath, options);
      return {
        changedFiles: [],
        deletedFileIds: [],
        newFiles: allFiles.map(f => f.path),
      };
    }

    this.logger.info('Detecting changes since last analysis', {
      lastIndexed: lastIndexed.toISOString(),
    });

    const currentFiles = await this.fileDiscoveryService.discoverFiles(repositoryPath, options);
    const currentFilePaths = currentFiles.map(f => f.path);

    const deletedFiles = await FileService.findDeletedFiles(
      this.db,
      repository.id,
      currentFilePaths
    );
    deletedFileIds.push(...deletedFiles.map(f => f.id));

    const dbPathsArray = await FileService.getFilePathsByRepository(this.db, repository.id);
    const dbFilePaths = new Set<string>(dbPathsArray);

    for (const fileInfo of currentFiles) {
      if (!dbFilePaths.has(fileInfo.path)) {
        newFiles.push(fileInfo.path);
      } else {
        try {
          const stats = await fs.stat(fileInfo.path);
          if (stats.mtime > lastIndexed) {
            changedFiles.push(fileInfo.path);
          }
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            this.logger.debug('File no longer exists during stat check', {
              file: fileInfo.path,
            });
          } else {
            this.logger.error('Unexpected error checking file modification time', {
              file: fileInfo.path,
              error: error instanceof Error ? error.message : String(error),
            });
            throw new Error(
              `Failed to check modification time for ${fileInfo.path}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
      }
    }

    this.logger.info('Change detection completed', {
      totalFiles: currentFiles.length,
      changedFiles: changedFiles.length,
      newFiles: newFiles.length,
      deletedFiles: deletedFileIds.length,
    });

    return { changedFiles, deletedFileIds, newFiles };
  }

  async performIncrementalAnalysis(
    repositoryPath: string,
    repository: Repository,
    options: BuildOptions
  ): Promise<BuildResult> {
    this.logger.info('Starting incremental analysis', {
      repositoryId: repository.id,
      repositoryPath,
    });

    const { changedFiles, deletedFileIds, newFiles } = await this.detectChangedFiles(
      repositoryPath,
      repository,
      options
    );

    try {
      if (deletedFileIds.length > 0) {
        await this.deleteFiles(deletedFileIds);
      }

      const filesToAnalyze = changedFiles.concat(newFiles);

      if (filesToAnalyze.length === 0 && deletedFileIds.length === 0) {
        this.logger.info('No changed files detected, skipping analysis');

        const { fileGraph, symbolGraph } = await this.buildGraphStatistics(
          repository,
          repository.path
        );

        return {
          repository,
          filesProcessed: 0,
          symbolsExtracted: 0,
          dependenciesCreated: 0,
          fileGraph,
          symbolGraph,
          errors: [...this.buildErrors],
          totalFiles: fileGraph.nodes.length,
          totalSymbols: symbolGraph.nodes.length,
        };
      }

      this.logger.info(
        `Processing ${filesToAnalyze.length} files (${changedFiles.length} changed, ${newFiles.length} new)`
      );

      const partialResult = await this.reanalyzeFiles(repository.id, filesToAnalyze, options);

      const { fileGraph, symbolGraph } = await this.buildGraphStatistics(
        repository,
        repository.path
      );

      await RepositoryService.updateRepository(this.db, repository.id, {
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
        errors: [...(partialResult.errors || []), ...this.buildErrors],
        totalFiles: fileGraph.nodes.length,
        totalSymbols: symbolGraph.nodes.length,
      };
    } catch (error) {
      this.logger.error('Incremental analysis failed', {
        repositoryId: repository.id,
        repositoryPath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Incremental analysis failed for repository ${repository.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async reanalyzeFiles(
    repositoryId: number,
    filePaths: string[],
    options: BuildOptions = {}
  ): Promise<Partial<BuildResult>> {
    this.logger.info('Re-analyzing files', {
      repositoryId,
      fileCount: filePaths.length,
    });

    const repository = await RepositoryService.getRepository(this.db, repositoryId);
    if (!repository) {
      throw new Error(`Repository with id ${repositoryId} not found`);
    }

    const validatedOptions = this.repositoryManager.validateOptions(options, repository);
    const files = filePaths.map(filePath => ({ path: filePath }));

    const parseResults = await this.fileParsingOrchestrator.parseFiles(
      files as any[],
      validatedOptions
    );

    const existingFiles = await FileService.getFilesByRepository(this.db, repositoryId);
    const fileIdsToCleanup = existingFiles
      .filter(f => filePaths.includes(f.path))
      .map(f => f.id);

    if (fileIdsToCleanup.length > 0) {
      this.logger.info('Cleaning up old data for changed files', {
        fileCount: fileIdsToCleanup.length,
      });
      await CleanupService.cleanupFileData(this.db, fileIdsToCleanup);
    }

    const dbFiles = await this.storageOrchestrator.storeFiles(
      repositoryId,
      files as any[],
      parseResults
    );
    await this.storageOrchestrator.storeSymbols(dbFiles, parseResults);

    await this.storageOrchestrator.linkSymbolHierarchy(repositoryId);

    const symbols = await SymbolService.getSymbolsByRepository(this.db, repositoryId);

    if (!validatedOptions.skipEmbeddings) {
      await this.embeddingOrchestrator.generateSymbolEmbeddings(repositoryId);
    } else {
      this.logger.info('Skipping embedding generation (--skip-embeddings enabled)');
    }

    await this.frameworkEntityPersister.storeFrameworkEntities(
      repositoryId,
      symbols,
      parseResults
    );

    const importsMap = createImportsMap(dbFiles, parseResults);
    const exportsMap = createExportsMap(dbFiles, parseResults);
    const dependenciesMap = createDependenciesMap(symbols, parseResults, dbFiles);

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
      exportsMap,
      repository.path
    );

    await this.frameworkEntityPersister.persistVirtualFrameworkSymbols(
      repository,
      symbolGraph,
      symbols
    );

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

    const allFileDependencies = [
      ...fileDependencies,
      ...crossFileFileDependencies,
      ...externalCallFileDependencies,
      ...externalImportFileDependencies,
    ];

    if (allFileDependencies.length > 0) {
      await DependencyService.createFileDependencies(this.db, allFileDependencies);
    }

    if (symbolDependencies.length > 0) {
      await DependencyService.createDependencies(this.db, symbolDependencies);
    }

    const resolvedCount = await DependencyService.resolveQualifiedNameDependencies(
      this.db,
      repositoryId
    );
    this.logger.info('Re-resolved dependencies by qualified name', { resolvedCount });

    await this.godotRelationshipBuilder.buildGodotRelationships(repositoryId, parseResults);

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

  private async deleteFiles(fileIds: number[]): Promise<void> {
    if (fileIds.length === 0) return;

    this.logger.info('Deleting files from database', {
      fileCount: fileIds.length,
    });

    const deletedCount = await CleanupService.deleteFilesWithTransaction(this.db, fileIds);

    this.logger.info('File deletion completed', {
      filesDeleted: deletedCount,
    });
  }

  private async buildGraphStatistics(
    repository: Repository,
    repositoryPath: string
  ): Promise<{ fileGraph: FileGraphData; symbolGraph: SymbolGraphData }> {
    const dbFiles = await FileService.getFilesByRepository(this.db, repository.id);
    const symbols = await SymbolService.getSymbolsByRepository(this.db, repository.id);
    const fileDependencyCount = await DependencyService.countFileDependenciesByRepository(
      this.db,
      repository.id
    );
    const symbolDependencyCount = await DependencyService.countSymbolDependenciesByRepository(
      this.db,
      repository.id
    );

    const fileGraph = {
      nodes: dbFiles.map(f => ({
        id: f.id,
        path: f.path,
        relativePath: path.relative(repositoryPath, f.path),
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

    return { fileGraph, symbolGraph };
  }
}
