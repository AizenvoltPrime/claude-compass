import type { Knex } from 'knex';
import { createComponentLogger } from '../../utils/logger';
import * as RepositoryService from './repository-service';

const logger = createComponentLogger('cleanup-service');

/**
 * Clean up all repository data for re-analysis.
 * Deletes all framework entities, dependencies, symbols, and files in correct order.
 */
export async function cleanupRepositoryData(db: Knex, repositoryId: number): Promise<void> {
  logger.info('Cleaning up repository data for re-analysis', { repositoryId });

  await db.transaction(async trx => {
    // Delete framework entities (they reference symbols)
    const deletedRoutes = await trx('routes').where('repo_id', repositoryId).del();
    const deletedApiCalls = await trx('api_calls').where('repo_id', repositoryId).del();
    const deletedComponents = await trx('components').where('repo_id', repositoryId).del();
    const deletedFrameworkMetadata = await trx('framework_metadata')
      .where('repo_id', repositoryId)
      .del();

    // Delete dependencies related to symbols in this repository
    const deletedDependencies = await trx('dependencies')
      .whereIn(
        'from_symbol_id',
        trx('symbols')
          .select('id')
          .whereIn('file_id', trx('files').select('id').where('repo_id', repositoryId))
      )
      .orWhereIn(
        'to_symbol_id',
        trx('symbols')
          .select('id')
          .whereIn('file_id', trx('files').select('id').where('repo_id', repositoryId))
      )
      .del();

    // Delete symbols in files belonging to this repository
    const deletedSymbols = await trx('symbols')
      .whereIn('file_id', trx('files').select('id').where('repo_id', repositoryId))
      .del();

    // Delete files belonging to this repository
    const deletedFiles = await trx('files').where('repo_id', repositoryId).del();

    logger.info('Repository cleanup completed', {
      repositoryId,
      deletedRoutes,
      deletedApiCalls,
      deletedComponents,
      deletedFrameworkMetadata,
      deletedDependencies,
      deletedSymbols,
      deletedFiles,
    });
  });
}

/**
 * Clean up file data for incremental re-analysis.
 * Deletes symbols, dependencies, and framework entities for specific files.
 */
export async function cleanupFileData(db: Knex, fileIds: number[]): Promise<void> {
  if (fileIds.length === 0) return;

  logger.info('Cleaning up file data for incremental re-analysis', {
    fileIds,
    count: fileIds.length,
  });

  await db.transaction(async trx => {
    const symbolIds = await trx('symbols').whereIn('file_id', fileIds).pluck('id');

    logger.info('Found symbols to clean up', { symbolCount: symbolIds.length });

    const deletionResults: Record<string, number> = {};

    if (symbolIds.length > 0) {
      // Capture qualified names of symbols being cleaned up
      const cleanedQualifiedNames = await trx('symbols')
        .whereIn('id', symbolIds)
        .whereNotNull('qualified_name')
        .pluck('qualified_name');

      logger.info('Captured qualified names of cleaned symbols', {
        count: cleanedQualifiedNames.length,
      });

      // Delete dependencies FROM changed files
      deletionResults.dependencies = await trx('dependencies')
        .whereIn('from_symbol_id', symbolIds)
        .del();

      // Delete orphaned dependencies (to_symbol_id IS NULL) pointing to cleaned qualified names
      // During incremental re-analysis, symbols are cleaned and re-parsed
      // Only truly orphaned dependencies should be removed; valid dependencies from other files
      // will be preserved and re-resolved during the symbol resolution phase
      if (cleanedQualifiedNames.length > 0) {
        deletionResults.orphanedDependencies = await trx('dependencies')
          .whereNull('to_symbol_id')
          .whereIn('to_qualified_name', cleanedQualifiedNames)
          .del();

        logger.info('Cleaned up orphaned dependencies to cleaned symbols', {
          count: deletionResults.orphanedDependencies,
        });
      }

      const hasRoutes = await trx.schema.hasTable('routes');
      if (hasRoutes) {
        // Get file paths for the files being re-analyzed
        const filePaths = await trx('files').whereIn('id', fileIds).pluck('path');

        // Delete routes defined in these files (by file_path column)
        // Routes are parsed from route definition files (e.g., routes/api.php)
        // and need to be deleted when those files are re-analyzed
        deletionResults.routes = await trx('routes')
          .where(function() {
            // Delete by handler_symbol_id (for routes where handler is in the file being cleaned)
            this.whereIn('handler_symbol_id', symbolIds)
              // OR delete by file_path (for routes defined in the file being re-analyzed)
              .orWhereIn('file_path', filePaths);
          })
          .del();
      }

      const hasComponents = await trx.schema.hasTable('components');
      if (hasComponents) {
        deletionResults.components = await trx('components')
          .whereIn('symbol_id', symbolIds)
          .del();
      }

      const hasComposables = await trx.schema.hasTable('composables');
      if (hasComposables) {
        deletionResults.composables = await trx('composables')
          .whereIn('symbol_id', symbolIds)
          .del();
      }

      const hasOrmEntities = await trx.schema.hasTable('orm_entities');
      if (hasOrmEntities) {
        deletionResults.ormEntities = await trx('orm_entities')
          .whereIn('symbol_id', symbolIds)
          .del();
      }

      const hasJobQueues = await trx.schema.hasTable('job_queues');
      if (hasJobQueues) {
        deletionResults.jobQueues = await trx('job_queues').whereIn('symbol_id', symbolIds).del();
      }
    }

    deletionResults.fileDependencies = await trx('file_dependencies')
      .whereIn('from_file_id', fileIds)
      .orWhereIn('to_file_id', fileIds)
      .del();

    const hasTestSuites = await trx.schema.hasTable('test_suites');
    if (hasTestSuites) {
      deletionResults.testSuites = await trx('test_suites').whereIn('file_id', fileIds).del();
    }

    const hasGodotScenes = await trx.schema.hasTable('godot_scenes');
    if (hasGodotScenes) {
      const filePaths = await trx('files').whereIn('id', fileIds).pluck('path');

      const scenePaths = await trx('godot_scenes').whereIn('scene_path', filePaths).pluck('id');

      if (scenePaths.length > 0) {
        const hasGodotNodes = await trx.schema.hasTable('godot_nodes');
        if (hasGodotNodes) {
          deletionResults.godotNodes = await trx('godot_nodes')
            .whereIn('scene_id', scenePaths)
            .del();
        }

        const hasGodotRelationships = await trx.schema.hasTable('godot_relationships');
        if (hasGodotRelationships) {
          deletionResults.godotRelationships = await trx('godot_relationships')
            .where(function () {
              this.where('from_entity_type', 'scene')
                .whereIn('from_entity_id', scenePaths)
                .orWhere('to_entity_type', 'scene')
                .whereIn('to_entity_id', scenePaths);
            })
            .del();
        }

        deletionResults.godotScenes = await trx('godot_scenes').whereIn('id', scenePaths).del();
      }
    }

    const hasGodotScripts = await trx.schema.hasTable('godot_scripts');
    if (hasGodotScripts) {
      const scriptPaths = await trx('files')
        .whereIn('id', fileIds)
        .where('language', 'csharp')
        .pluck('path');

      if (scriptPaths.length > 0) {
        const scriptIds = await trx('godot_scripts')
          .whereIn('script_path', scriptPaths)
          .pluck('id');

        if (scriptIds.length > 0) {
          const hasGodotRelationships = await trx.schema.hasTable('godot_relationships');
          if (hasGodotRelationships) {
            deletionResults.godotScriptRelationships = await trx('godot_relationships')
              .where(function () {
                this.where('from_entity_type', 'script')
                  .whereIn('from_entity_id', scriptIds)
                  .orWhere('to_entity_type', 'script')
                  .whereIn('to_entity_id', scriptIds);
              })
              .del();
          }

          deletionResults.godotScripts = await trx('godot_scripts')
            .whereIn('id', scriptIds)
            .del();
        }
      }
    }

    if (symbolIds.length > 0) {
      deletionResults.symbols = await trx('symbols').whereIn('id', symbolIds).del();
    }

    logger.info('File cleanup completed', {
      fileCount: fileIds.length,
      ...deletionResults,
    });
  });
}

/**
 * Delete files and all related data in a single atomic transaction.
 * Combines cleanup of related data and file record deletion for atomicity.
 */
export async function deleteFilesWithTransaction(db: Knex, fileIds: number[]): Promise<number> {
  if (fileIds.length === 0) return 0;

  if (!fileIds.every(id => Number.isInteger(id) && id > 0)) {
    throw new Error('Invalid file IDs: must be positive integers');
  }

  logger.info('Deleting files with transaction', {
    count: fileIds.length,
    sample: fileIds.slice(0, 5),
  });

  return await db.transaction(async trx => {
    const symbolIds = await trx('symbols').whereIn('file_id', fileIds).pluck('id');

    logger.info('Found symbols to clean up', { symbolCount: symbolIds.length });

    const deletionResults: Record<string, number> = {};

    if (symbolIds.length > 0) {
      // Capture qualified names of symbols being deleted
      const deletedQualifiedNames = await trx('symbols')
        .whereIn('id', symbolIds)
        .whereNotNull('qualified_name')
        .pluck('qualified_name');

      logger.info('Captured qualified names of deleted symbols', {
        count: deletedQualifiedNames.length,
      });

      // Delete dependencies FROM deleted symbols
      deletionResults.dependencies = await trx('dependencies')
        .whereIn('from_symbol_id', symbolIds)
        .del();

      // Delete orphaned dependencies TO deleted symbols (by qualified name)
      // This handles both direct references (to_symbol_id) and unresolved references (to_qualified_name)
      if (deletedQualifiedNames.length > 0) {
        deletionResults.orphanedDependencies = await trx('dependencies')
          .where(function() {
            this.whereIn('to_symbol_id', symbolIds)
              .orWhere(function() {
                this.whereNull('to_symbol_id')
                  .whereIn('to_qualified_name', deletedQualifiedNames);
              });
          })
          .del();

        logger.info('Cleaned up orphaned dependencies to deleted symbols', {
          count: deletionResults.orphanedDependencies,
        });
      }

      const hasRoutes = await trx.schema.hasTable('routes');
      if (hasRoutes) {
        // Get file paths for the files being deleted
        const filePaths = await trx('files').whereIn('id', fileIds).pluck('path');

        // Delete routes where handler is in deleted files OR routes defined in deleted files
        deletionResults.routes = await trx('routes')
          .where(function() {
            this.whereIn('handler_symbol_id', symbolIds)
              .orWhereIn('file_path', filePaths);
          })
          .del();
      }

      const hasComponents = await trx.schema.hasTable('components');
      if (hasComponents) {
        deletionResults.components = await trx('components')
          .whereIn('symbol_id', symbolIds)
          .del();
      }

      const hasComposables = await trx.schema.hasTable('composables');
      if (hasComposables) {
        deletionResults.composables = await trx('composables')
          .whereIn('symbol_id', symbolIds)
          .del();
      }

      const hasOrmEntities = await trx.schema.hasTable('orm_entities');
      if (hasOrmEntities) {
        deletionResults.ormEntities = await trx('orm_entities')
          .whereIn('symbol_id', symbolIds)
          .del();
      }

      const hasJobQueues = await trx.schema.hasTable('job_queues');
      if (hasJobQueues) {
        deletionResults.jobQueues = await trx('job_queues').whereIn('symbol_id', symbolIds).del();
      }
    }

    deletionResults.fileDependencies = await trx('file_dependencies')
      .whereIn('from_file_id', fileIds)
      .orWhereIn('to_file_id', fileIds)
      .del();

    const hasTestSuites = await trx.schema.hasTable('test_suites');
    if (hasTestSuites) {
      deletionResults.testSuites = await trx('test_suites').whereIn('file_id', fileIds).del();
    }

    const hasGodotScenes = await trx.schema.hasTable('godot_scenes');
    if (hasGodotScenes) {
      const filePaths = await trx('files').whereIn('id', fileIds).pluck('path');
      const scenePaths = await trx('godot_scenes').whereIn('scene_path', filePaths).pluck('id');

      if (scenePaths.length > 0) {
        const hasGodotNodes = await trx.schema.hasTable('godot_nodes');
        if (hasGodotNodes) {
          deletionResults.godotNodes = await trx('godot_nodes')
            .whereIn('scene_id', scenePaths)
            .del();
        }

        const hasGodotRelationships = await trx.schema.hasTable('godot_relationships');
        if (hasGodotRelationships) {
          deletionResults.godotRelationships = await trx('godot_relationships')
            .where(function () {
              this.where('from_entity_type', 'scene')
                .whereIn('from_entity_id', scenePaths)
                .orWhere('to_entity_type', 'scene')
                .whereIn('to_entity_id', scenePaths);
            })
            .del();
        }

        deletionResults.godotScenes = await trx('godot_scenes').whereIn('id', scenePaths).del();
      }
    }

    const hasGodotScripts = await trx.schema.hasTable('godot_scripts');
    if (hasGodotScripts) {
      const scriptPaths = await trx('files')
        .whereIn('id', fileIds)
        .where('language', 'csharp')
        .pluck('path');

      if (scriptPaths.length > 0) {
        const scriptIds = await trx('godot_scripts')
          .whereIn('script_path', scriptPaths)
          .pluck('id');

        if (scriptIds.length > 0) {
          const hasGodotRelationships = await trx.schema.hasTable('godot_relationships');
          if (hasGodotRelationships) {
            deletionResults.godotScriptRelationships = await trx('godot_relationships')
              .where(function () {
                this.where('from_entity_type', 'script')
                  .whereIn('from_entity_id', scriptIds)
                  .orWhere('to_entity_type', 'script')
                  .whereIn('to_entity_id', scriptIds);
              })
              .del();
          }

          deletionResults.godotScripts = await trx('godot_scripts')
            .whereIn('id', scriptIds)
            .del();
        }
      }
    }

    if (symbolIds.length > 0) {
      deletionResults.symbols = await trx('symbols').whereIn('id', symbolIds).del();
    }

    const deletedFileCount = await trx('files').whereIn('id', fileIds).del();

    logger.info('File deletion completed', {
      fileCount: deletedFileCount,
      ...deletionResults,
    });

    return deletedFileCount;
  });
}

/**
 * Delete a repository by name.
 * Cleans up all related data first, then deletes the repository record.
 * Returns true if the repository was found and deleted, false if not found.
 */
export async function deleteRepositoryByName(db: Knex, name: string): Promise<boolean> {
  logger.info('Deleting repository by name', { name });

  const repository = await RepositoryService.getRepositoryByName(db, name);
  if (!repository) {
    logger.warn('Repository not found', { name });
    return false;
  }

  logger.info('Repository found, proceeding with deletion', { name, id: repository.id });

  // Clean up all related data first (with detailed logging)
  await cleanupRepositoryData(db, repository.id);

  // Then delete the repository record
  const deleted = await RepositoryService.deleteRepository(db, repository.id);
  return deleted;
}
