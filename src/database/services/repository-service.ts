import type { Knex } from 'knex';
import type { Repository, CreateRepository, File } from '../models';

/**
 * Parse framework_stack JSON field if it's a string
 */
function parseFrameworkStack(repository: any): Repository {
  if (repository.framework_stack && typeof repository.framework_stack === 'string') {
    repository.framework_stack = JSON.parse(repository.framework_stack);
  }
  return repository as Repository;
}

/**
 * Create a new repository
 */
export async function createRepository(db: Knex, data: CreateRepository): Promise<Repository> {
  // Convert framework_stack array to JSON for database storage
  const insertData = {
    ...data,
    framework_stack: JSON.stringify(data.framework_stack || []),
  };

  const [repository] = await db('repositories').insert(insertData).returning('*');

  // Parse JSON back to array for the returned object
  return parseFrameworkStack(repository);
}

/**
 * Get repository by ID
 */
export async function getRepository(db: Knex, id: number): Promise<Repository | null> {
  const repository = await db('repositories').where({ id }).first();

  if (!repository) return null;

  return parseFrameworkStack(repository);
}

/**
 * Get repository by file path
 */
export async function getRepositoryByPath(db: Knex, path: string): Promise<Repository | null> {
  const repository = await db('repositories').where({ path }).first();

  if (!repository) return null;

  return parseFrameworkStack(repository);
}

/**
 * Get repository by name
 */
export async function getRepositoryByName(db: Knex, name: string): Promise<Repository | null> {
  const repository = await db('repositories').where({ name }).first();

  if (!repository) return null;

  return parseFrameworkStack(repository);
}

/**
 * Get all repositories
 */
export async function getAllRepositories(db: Knex): Promise<Repository[]> {
  const repositories = await db('repositories').select('*').orderBy('name');

  // Parse framework_stack JSON for all repositories
  return repositories.map(parseFrameworkStack);
}

/**
 * Update repository
 */
export async function updateRepository(
  db: Knex,
  id: number,
  data: Partial<CreateRepository>
): Promise<Repository | null> {
  const [repository] = await db('repositories')
    .where({ id })
    .update({ ...data, updated_at: new Date() })
    .returning('*');

  if (!repository) return null;

  return parseFrameworkStack(repository);
}

/**
 * Delete repository
 */
export async function deleteRepository(db: Knex, id: number): Promise<boolean> {
  const deletedCount = await db('repositories').where({ id }).del();
  return deletedCount > 0;
}

/**
 * Get last indexed timestamp for repository
 */
export async function getRepositoryLastIndexed(db: Knex, repositoryId: number): Promise<Date | null> {
  const repo = await db('repositories')
    .select('last_indexed')
    .where('id', repositoryId)
    .first();
  return repo?.last_indexed || null;
}

/**
 * Find files modified since a given date
 */
export async function findModifiedFilesSince(db: Knex, repositoryId: number, since: Date): Promise<File[]> {
  const files = await db('files')
    .where('repo_id', repositoryId)
    .where('last_modified', '>', since)
    .select('*');
  return files as File[];
}

/**
 * Find files that exist on disk but not in database
 */
export async function findFilesNotInDatabase(
  db: Knex,
  repositoryId: number,
  currentFilePaths: string[]
): Promise<string[]> {
  if (currentFilePaths.length === 0) {
    return [];
  }

  const existingFiles = await db('files')
    .where('repo_id', repositoryId)
    .whereIn('path', currentFilePaths)
    .select('path');

  const existingPaths = existingFiles.map(f => f.path);
  return currentFilePaths.filter(path => !existingPaths.includes(path));
}

/**
 * Find files in database that no longer exist on disk
 */
export async function findOrphanedFiles(
  db: Knex,
  repositoryId: number,
  currentFilePaths: string[]
): Promise<File[]> {
  if (currentFilePaths.length === 0) {
    // If no current files, all existing files are orphaned
    return (await db('files').where('repo_id', repositoryId).select('*')) as File[];
  }

  const orphanedFiles = await db('files')
    .where('repo_id', repositoryId)
    .whereNotIn('path', currentFilePaths)
    .select('*');

  return orphanedFiles as File[];
}
