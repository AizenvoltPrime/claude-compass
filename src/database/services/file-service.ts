import type { Knex } from 'knex';
import * as path from 'path';
import type { File, CreateFile, FileWithRepository, Repository } from '../models';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('file-service');

/**
 * Create a new file or update existing
 */
export async function createFile(db: Knex, data: CreateFile): Promise<File> {
  // Try to find existing file first
  const existingFile = await db('files')
    .where({ repo_id: data.repo_id, path: data.path })
    .first();

  if (existingFile) {
    // Update existing file
    const [file] = await db('files')
      .where({ id: existingFile.id })
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return file as File;
  } else {
    // Insert new file
    const [file] = await db('files').insert(data).returning('*');
    return file as File;
  }
}

/**
 * Create multiple files in a batch (transactional)
 */
export async function createFilesBatch(db: Knex, files: CreateFile[]): Promise<File[]> {
  return await db.transaction(async trx => {
    const results: File[] = [];

    for (const data of files) {
      const existingFile = await trx('files')
        .where({ repo_id: data.repo_id, path: data.path })
        .first();

      if (existingFile) {
        const [file] = await trx('files')
          .where({ id: existingFile.id })
          .update({ ...data, updated_at: new Date() })
          .returning('*');
        results.push(file as File);
      } else {
        const [file] = await trx('files').insert(data).returning('*');
        results.push(file as File);
      }
    }

    return results;
  });
}

/**
 * Get file by ID
 */
export async function getFile(db: Knex, id: number): Promise<File | null> {
  const file = await db('files').where({ id }).first();
  return (file as File) || null;
}

/**
 * Get file with repository information
 */
export async function getFileWithRepository(db: Knex, id: number): Promise<FileWithRepository | null> {
  const result = await db('files')
    .leftJoin('repositories', 'files.repo_id', 'repositories.id')
    .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
    .where('files.id', id)
    .first();

  if (!result) return null;

  return {
    ...result,
    repository: {
      id: result.repo_id,
      name: result.repo_name,
      path: result.repo_path,
    } as Repository,
  } as FileWithRepository;
}

/**
 * Get file by path with fallback matching strategies
 */
export async function getFileByPath(db: Knex, filePath: string): Promise<FileWithRepository | null> {
  // Try exact path match first
  let result = await db('files')
    .leftJoin('repositories', 'files.repo_id', 'repositories.id')
    .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
    .where('files.path', filePath)
    .first();

  if (result) {
    return {
      ...result,
      repository: {
        id: result.repo_id,
        name: result.repo_name,
        path: result.repo_path,
      } as Repository,
    } as FileWithRepository;
  }

  // If no exact match, try filename match (just the basename)
  const basename = path.basename(filePath);
  const filenameResults = await db('files')
    .leftJoin('repositories', 'files.repo_id', 'repositories.id')
    .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
    .whereRaw('files.path LIKE ?', [`%/${basename}`])
    .limit(1);

  if (filenameResults.length > 0) {
    const result = filenameResults[0];
    return {
      ...result,
      repository: {
        id: result.repo_id,
        name: result.repo_name,
        path: result.repo_path,
      } as Repository,
    } as FileWithRepository;
  }

  // If still no match, try relative path matching (ends with the given path)
  if (!filePath.startsWith('/')) {
    const relativeResults = await db('files')
      .leftJoin('repositories', 'files.repo_id', 'repositories.id')
      .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
      .whereRaw('files.path LIKE ?', [`%/${filePath}`])
      .limit(1);

    if (relativeResults.length > 0) {
      const result = relativeResults[0];
      return {
        ...result,
        repository: {
          id: result.repo_id,
          name: result.repo_name,
          path: result.repo_path,
        } as Repository,
      } as FileWithRepository;
    }
  }

  return null;
}

/**
 * Batch version of getFileByPath for performance-sensitive operations.
 * Queries all paths in a single database roundtrip.
 */
export async function getFilesByPaths(db: Knex, paths: string[]): Promise<FileWithRepository[]> {
  if (paths.length === 0) {
    return [];
  }

  const results = await db('files')
    .leftJoin('repositories', 'files.repo_id', 'repositories.id')
    .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
    .whereIn('files.path', paths);

  return results.map(result => ({
    ...result,
    repository: {
      id: result.repo_id,
      name: result.repo_name,
      path: result.repo_path,
    } as Repository,
  })) as FileWithRepository[];
}

/**
 * Get all files for a repository
 */
export async function getFilesByRepository(db: Knex, repoId: number): Promise<File[]> {
  const files = await db('files').where({ repo_id: repoId }).orderBy('path');
  return files as File[];
}

/**
 * Get only file paths for a repository (minimal memory footprint).
 * Optimized for large repositories - returns only paths, not full file objects.
 */
export async function getFilePathsByRepository(db: Knex, repoId: number): Promise<string[]> {
  const paths = await db('files').where('repo_id', repoId).pluck('path');
  return paths as string[];
}

/**
 * Find files in database that are not present in the provided file paths.
 * Optimized for large repositories - uses SQL query instead of loading all files into memory.
 */
export async function findDeletedFiles(
  db: Knex,
  repoId: number,
  currentFilePaths: string[]
): Promise<Pick<File, 'id' | 'path'>[]> {
  if (currentFilePaths.length === 0) {
    logger.debug('No current files provided, all DB files considered deleted', { repoId });
    const deletedFiles = await db('files')
      .where('repo_id', repoId)
      .select('id', 'path');
    return deletedFiles as Pick<File, 'id' | 'path'>[];
  }

  const CHUNK_THRESHOLD = 10000;

  if (currentFilePaths.length > CHUNK_THRESHOLD) {
    logger.info('Using temporary table approach for large file array', {
      repoId,
      fileCount: currentFilePaths.length,
    });
    return await findDeletedFilesWithTempTable(db, repoId, currentFilePaths);
  }

  const deletedFiles = await db('files')
    .where('repo_id', repoId)
    .whereNotIn('path', currentFilePaths)
    .select('id', 'path');

  logger.debug('Deletion detection completed', {
    repoId,
    currentFileCount: currentFilePaths.length,
    deletedFileCount: deletedFiles.length,
  });

  return deletedFiles as Pick<File, 'id' | 'path'>[];
}

/**
 * Find deleted files using temporary table for large file lists
 */
async function findDeletedFilesWithTempTable(
  db: Knex,
  repoId: number,
  currentFilePaths: string[]
): Promise<Pick<File, 'id' | 'path'>[]> {
  return await db.transaction(async trx => {
    await trx.raw(`
      CREATE TEMPORARY TABLE temp_current_paths (
        path TEXT NOT NULL
      ) ON COMMIT DROP
    `);

    const BATCH_SIZE = 1000;
    for (let i = 0; i < currentFilePaths.length; i += BATCH_SIZE) {
      const batch = currentFilePaths.slice(i, i + BATCH_SIZE);
      await trx('temp_current_paths').insert(batch.map(path => ({ path })));
    }

    const result = await trx.raw(
      `
      SELECT f.id, f.path
      FROM files f
      LEFT JOIN temp_current_paths t ON f.path = t.path
      WHERE f.repo_id = ?
        AND t.path IS NULL
    `,
      [repoId]
    );

    logger.debug('Deletion detection completed with temp table', {
      repoId,
      currentFileCount: currentFilePaths.length,
      deletedFileCount: result.rows.length,
    });

    return result.rows as Pick<File, 'id' | 'path'>[];
  });
}

/**
 * Update file
 */
export async function updateFile(db: Knex, id: number, data: Partial<CreateFile>): Promise<File | null> {
  const [file] = await db('files')
    .where({ id })
    .update({ ...data, updated_at: new Date() })
    .returning('*');
  return (file as File) || null;
}

/**
 * Delete file
 */
export async function deleteFile(db: Knex, id: number): Promise<boolean> {
  const deletedCount = await db('files').where({ id }).del();
  return deletedCount > 0;
}
