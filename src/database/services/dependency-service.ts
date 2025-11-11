import type { Knex } from 'knex';
import type {
  Dependency,
  CreateDependency,
  FileDependency,
  CreateFileDependency,
  DependencyWithSymbols,
  EnhancedDependencyWithSymbols,
} from '../models';
import { createComponentLogger } from '../../utils/logger';
import { safeParseParameterTypes } from './validation-utils';

const logger = createComponentLogger('dependency-service');

/**
 * Deduplicate file dependencies by keeping the first entry
 * for each unique combination of from_file_id, to_file_id, dependency_type
 */
function deduplicateFileDependencies(
  dependencies: CreateFileDependency[]
): CreateFileDependency[] {
  const uniqueMap = new Map<string, CreateFileDependency>();

  for (const dep of dependencies) {
    const key = `${dep.from_file_id}-${dep.to_file_id}-${dep.dependency_type}`;
    const existing = uniqueMap.get(key);

    // Keep the first entry
    if (!existing) {
      uniqueMap.set(key, dep);
    }
  }

  return Array.from(uniqueMap.values());
}

/**
 * Deduplicate symbol dependencies by keeping the first entry
 * for each unique combination matching the database unique constraint:
 * (from_symbol_id, to_symbol_id, dependency_type, line_number)
 */
function deduplicateDependencies(
  dependencies: CreateDependency[]
): CreateDependency[] {
  const uniqueMap = new Map<string, CreateDependency>();

  for (const dep of dependencies) {
    const key = `${dep.from_symbol_id}-${dep.to_symbol_id}-${dep.dependency_type}-${dep.line_number}`;
    const existing = uniqueMap.get(key);

    // Keep the first entry
    if (!existing) {
      uniqueMap.set(key, dep);
    }
  }

  return Array.from(uniqueMap.values());
}

/**
 * Create a single dependency
 */
export async function createDependency(db: Knex, data: CreateDependency): Promise<Dependency> {
  // Convert parameter_types array to JSON string for database storage
  const insertData = {
    ...data,
    parameter_types: data.parameter_types ? JSON.stringify(data.parameter_types) : null,
  };

  const [dependency] = await db('dependencies').insert(insertData).returning('*');
  return dependency as Dependency;
}

/**
 * Create multiple dependencies in batch with upsert logic
 */
export async function createDependencies(db: Knex, dependencies: CreateDependency[]): Promise<Dependency[]> {
  if (dependencies.length === 0) return [];

  // Deduplicate before processing to prevent constraint violations
  const uniqueDependencies = deduplicateDependencies(dependencies);

  if (uniqueDependencies.length !== dependencies.length) {
    logger.debug('Removed duplicate dependencies from batch', {
      original: dependencies.length,
      unique: uniqueDependencies.length,
      duplicatesRemoved: dependencies.length - uniqueDependencies.length,
    });
  }

  // Process in chunks to avoid PostgreSQL parameter limits
  const BATCH_SIZE = 1000;
  const results: Dependency[] = [];

  try {
    for (let i = 0; i < uniqueDependencies.length; i += BATCH_SIZE) {
      const chunk = uniqueDependencies.slice(i, i + BATCH_SIZE);

      // Convert parameter_types arrays to JSON strings for database storage
      const processedChunk = chunk.map(dep => ({
        ...dep,
        parameter_types: dep.parameter_types ? JSON.stringify(dep.parameter_types) : null,
      }));

      // Use upsert logic to handle duplicates - PostgreSQL ON CONFLICT
      const chunkResults = await db('dependencies')
        .insert(processedChunk)
        .onConflict(['from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number'])
        .merge([
          'line_number',
          'updated_at',
          'parameter_context',
          'call_instance_id',
          'parameter_types',
        ])
        .returning('*');

      results.push(...(chunkResults as Dependency[]));
    }

    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    // Check if this is a duplicate key error (expected during incremental analysis)
    const isDuplicateError = errorMessage.includes('duplicate key') ||
                             errorMessage.includes('unique constraint');

    if (isDuplicateError) {
      // For duplicates, query and return the existing records
      logger.debug('Dependencies already exist, retrieving existing records', {
        count: uniqueDependencies.length,
      });

      try {
        const existingDeps: Dependency[] = [];
        for (const dep of uniqueDependencies) {
          const whereClause: any = {
            from_symbol_id: dep.from_symbol_id,
            to_symbol_id: dep.to_symbol_id,
            dependency_type: dep.dependency_type,
            line_number: dep.line_number,
          };

          const existing = await db('dependencies')
            .where(whereClause)
            .first();

          if (existing) {
            existingDeps.push(existing);
          }
        }
        return existingDeps;
      } catch (queryError) {
        const queryErrorMsg = queryError instanceof Error ? queryError.message : String(queryError);
        logger.warn('Failed to query existing dependencies after duplicate error', {
          error: queryErrorMsg,
          originalError: errorMessage,
        });
        // Return empty array rather than failing completely
        return [];
      }
    }

    // For non-duplicate errors, throw to fail fast
    logger.error('Failed to create dependencies', {
      error: errorMessage,
      stack,
      count: uniqueDependencies.length,
      sampleData: uniqueDependencies.slice(0, 2),
    });
    throw error;
  }
}

/**
 * Create file dependencies in batch with deduplication
 */
export async function createFileDependencies(db: Knex, dependencies: CreateFileDependency[]): Promise<FileDependency[]> {
  if (dependencies.length === 0) return [];

  // Deduplicate before processing to prevent constraint violations
  const uniqueDependencies = deduplicateFileDependencies(dependencies);

  if (uniqueDependencies.length !== dependencies.length) {
    logger.warn('Removed duplicate file dependencies', {
      original: dependencies.length,
      unique: uniqueDependencies.length,
      duplicatesRemoved: dependencies.length - uniqueDependencies.length,
    });
  }

  // Process in chunks to handle large datasets efficiently
  const BATCH_SIZE = 1000;
  const results: FileDependency[] = [];

  for (let i = 0; i < uniqueDependencies.length; i += BATCH_SIZE) {
    const chunk = uniqueDependencies.slice(i, i + BATCH_SIZE);

    // Use upsert logic to handle duplicates - PostgreSQL ON CONFLICT
    const chunkResults = await db('file_dependencies')
      .insert(chunk)
      .onConflict(['from_file_id', 'to_file_id', 'dependency_type'])
      .merge(['line_number', 'updated_at'])
      .returning('*');

    results.push(...(chunkResults as FileDependency[]));
  }

  return results;
}

/**
 * Get file dependencies by repository
 */
export async function getFileDependenciesByRepository(db: Knex, repoId: number): Promise<FileDependency[]> {
  const dependencies = await db('file_dependencies')
    .join('files as from_files', 'file_dependencies.from_file_id', 'from_files.id')
    .join('files as to_files', 'file_dependencies.to_file_id', 'to_files.id')
    .where('from_files.repo_id', repoId)
    .select('file_dependencies.*');
  return dependencies as FileDependency[];
}

/**
 * Count file dependencies by repository
 */
export async function countFileDependenciesByRepository(db: Knex, repoId: number): Promise<number> {
  const result = await db('file_dependencies')
    .join('files as from_files', 'file_dependencies.from_file_id', 'from_files.id')
    .where('from_files.repo_id', repoId)
    .count('* as count')
    .first();
  return result ? Number(result.count) : 0;
}

/**
 * Count symbol dependencies by repository
 */
export async function countSymbolDependenciesByRepository(db: Knex, repoId: number): Promise<number> {
  const result = await db('dependencies')
    .join('symbols', 'dependencies.from_symbol_id', 'symbols.id')
    .join('files', 'symbols.file_id', 'files.id')
    .where('files.repo_id', repoId)
    .count('* as count')
    .first();
  return result ? Number(result.count) : 0;
}

/**
 * Get dependencies from a symbol (what this symbol depends on)
 */
export async function getDependenciesFrom(db: Knex, symbolId: number): Promise<DependencyWithSymbols[]> {
  const results = await db('dependencies')
    .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
    .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .select(
      'dependencies.*',
      'to_symbols.name as to_symbol_name',
      'to_symbols.symbol_type as to_symbol_type',
      'to_files.path as to_file_path',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_files.path as from_file_path'
    )
    .where('dependencies.from_symbol_id', symbolId)
    .distinct('dependencies.id');

  return results.map(result => ({
    ...result,
    from_symbol: {
      id: result.from_symbol_id,
      name: result.from_symbol_name,
      symbol_type: result.from_symbol_type,
      file: {
        id: result.from_file_id,
        path: result.from_file_path,
      },
    },
    to_symbol: {
      id: result.to_symbol_id,
      name: result.to_symbol_name,
      symbol_type: result.to_symbol_type,
      file: {
        id: result.to_file_id,
        path: result.to_file_path,
      },
    },
  })) as DependencyWithSymbols[];
}

/**
 * Get dependencies to a symbol (what depends on this symbol)
 */
export async function getDependenciesTo(db: Knex, symbolId: number): Promise<DependencyWithSymbols[]> {
  const results = await db('dependencies')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .select(
      'dependencies.*',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_symbols.entity_type as from_entity_type',
      'from_files.path as from_file_path'
    )
    .where('dependencies.to_symbol_id', symbolId)
    .distinct('dependencies.id');

  return results.map(result => ({
    ...result,
    from_symbol: {
      id: result.from_symbol_id,
      name: result.from_symbol_name,
      symbol_type: result.from_symbol_type,
      entity_type: result.from_entity_type,
      file: {
        id: result.from_file_id,
        path: result.from_file_path,
      },
    },
  })) as DependencyWithSymbols[];
}

/**
 * Get dependencies from a symbol with enhanced context
 */
export async function getDependenciesFromWithContext(db: Knex, symbolId: number): Promise<EnhancedDependencyWithSymbols[]> {
  const results = await db('dependencies')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
    .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
    .select(
      'dependencies.*',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_files.path as from_file_path',
      'to_symbols.name as to_symbol_name',
      'to_symbols.symbol_type as to_symbol_type',
      'to_files.path as to_file_path'
    )
    .where('dependencies.from_symbol_id', symbolId)
    .distinct('dependencies.id');

  return results.map(result => ({
    ...result,
    from_symbol: {
      id: result.from_symbol_id,
      name: result.from_symbol_name,
      symbol_type: result.from_symbol_type,
      file: {
        id: result.from_file_id,
        path: result.from_file_path,
      },
    },
    to_symbol: {
      id: result.to_symbol_id,
      name: result.to_symbol_name,
      symbol_type: result.to_symbol_type,
      file: {
        id: result.to_file_id,
        path: result.to_file_path,
      },
    },
    // Enhanced context fields (available due to spread operator)
    calling_object: result.calling_object,
    resolved_class: result.resolved_class,
    qualified_context: result.qualified_context,
    method_signature: result.method_signature,
    file_context: result.file_context,
    namespace_context: result.namespace_context,
    // Parameter context fields
    parameter_context: result.parameter_context,
    call_instance_id: result.call_instance_id,
    parameter_types: result.parameter_types
      ? safeParseParameterTypes(result.parameter_types)
      : undefined,
  })) as EnhancedDependencyWithSymbols[];
}

/**
 * Get callers with enhanced context information
 */
export async function getDependenciesToWithContext(db: Knex, symbolId: number): Promise<EnhancedDependencyWithSymbols[]> {
  const results = await db('dependencies')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .select(
      'dependencies.*',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_files.path as from_file_path'
    )
    .where('dependencies.to_symbol_id', symbolId)
    .whereRaw('dependencies.from_symbol_id != dependencies.to_symbol_id')
    .distinct(
      'dependencies.from_symbol_id',
      'dependencies.to_symbol_id',
      'dependencies.dependency_type',
      'dependencies.line_number'
    );

  return results.map(result => ({
    ...result,
    from_symbol: {
      id: result.from_symbol_id,
      name: result.from_symbol_name,
      symbol_type: result.from_symbol_type,
      file: {
        id: result.from_file_id,
        path: result.from_file_path,
      },
    },
    // Enhanced context fields (available due to spread operator)
    calling_object: result.calling_object,
    resolved_class: result.resolved_class,
    qualified_context: result.qualified_context,
    method_signature: result.method_signature,
    file_context: result.file_context,
    namespace_context: result.namespace_context,
    // Parameter context fields
    parameter_context: result.parameter_context,
    call_instance_id: result.call_instance_id,
    parameter_types: result.parameter_types
      ? safeParseParameterTypes(result.parameter_types)
      : undefined,
  })) as EnhancedDependencyWithSymbols[];
}

/**
 * Deduplicate dependencies based on source-side uniqueness.
 * Ensures only ONE dependency exists per (from_symbol_id, to_qualified_name, dependency_type, line_number).
 * This prevents constraint violations when multiple dependencies with the same source attributes
 * get resolved to the same target symbol. Keeps the most recently created entry.
 */
async function deduplicateDependenciesBeforeResolution(
  db: Knex,
  repositoryId: number
): Promise<number> {
  logger.info('Deduplicating dependencies before re-resolution', {
    repositoryId,
  });

  // Delete duplicate dependencies based on source-side uniqueness
  // Keep only the most recent (MAX(id)) for each (from_symbol, to_qualified_name, type, line) combination
  const result = await db.raw(
    `
      DELETE FROM dependencies
      WHERE id IN (
        SELECT dupes.id
        FROM (
          SELECT
            d.id,
            ROW_NUMBER() OVER (
              PARTITION BY d.from_symbol_id, d.to_qualified_name, d.dependency_type, d.line_number
              ORDER BY d.id DESC
            ) as rn
          FROM dependencies d
          INNER JOIN symbols s ON d.from_symbol_id = s.id
          INNER JOIN files f ON s.file_id = f.id
          WHERE f.repo_id = ?
            AND d.to_qualified_name IS NOT NULL
        ) dupes
        WHERE dupes.rn > 1
      )
    `,
    [repositoryId]
  );

  const deletedCount = result.rowCount || 0;
  if (deletedCount > 0) {
    logger.info('Removed duplicate dependencies with same source attributes', {
      deletedCount,
      repositoryId
    });
  }
  return deletedCount;
}

/**
 * Re-resolve dependencies by qualified name after incremental update.
 * Updates dependencies to link to their target symbols using qualified names.
 */
export async function resolveQualifiedNameDependencies(
  db: Knex,
  repositoryId: number
): Promise<number> {
  logger.info('Re-resolving dependencies by qualified name after incremental update', {
    repositoryId,
  });

  // Step 1: Deduplicate unresolved dependencies that would resolve to the same target
  const preDedupCount = await deduplicateDependenciesBeforeResolution(db, repositoryId);

  // Step 2: Resolve dependencies by updating to_symbol_id
  const result = await db.raw(
    `
      UPDATE dependencies
      SET to_symbol_id = symbols.id,
          updated_at = NOW()
      FROM symbols
      JOIN files ON symbols.file_id = files.id
      WHERE files.repo_id = ?
        AND dependencies.to_qualified_name = symbols.qualified_name
        AND dependencies.to_qualified_name IS NOT NULL
        AND (dependencies.to_symbol_id IS NULL
             OR dependencies.to_symbol_id != symbols.id)
    `,
    [repositoryId]
  );

  const updatedCount = result.rowCount || 0;
  logger.info('Resolved dependencies by qualified name', {
    updatedCount,
    preDedupDeleted: preDedupCount
  });

  return updatedCount;
}

/**
 * Delete orphaned dependencies (where to_symbol_id is NULL and cannot be resolved).
 * Deletes dependencies in two categories:
 * 1. No to_qualified_name - can never be resolved
 * 2. Has to_qualified_name but no matching symbol exists in repository
 */
export async function deleteOrphanedDependencies(
  db: Knex,
  repositoryId: number
): Promise<number> {
  logger.info('Cleaning up orphaned dependencies after incremental update', {
    repositoryId,
  });

  // Delete dependencies with no qualified name
  const result1 = await db.raw(
    `
      DELETE FROM dependencies
      WHERE to_symbol_id IS NULL
        AND to_qualified_name IS NULL
        AND from_symbol_id IN (
          SELECT s.id
          FROM symbols s
          JOIN files f ON s.file_id = f.id
          WHERE f.repo_id = ?
        )
    `,
    [repositoryId]
  );

  // Delete dependencies with qualified name but no matching symbol in repository
  // Preserve IMPORTS type as they may point to external packages (npm, system libs)
  // Note: Most orphaned dependencies are now cleaned up at deletion time in cleanup-service.ts
  // This function serves as a safety net for edge cases and post-resolution cleanup
  const result2 = await db.raw(
    `
      DELETE FROM dependencies d
      WHERE d.to_symbol_id IS NULL
        AND d.to_qualified_name IS NOT NULL
        AND d.dependency_type != 'imports'
        AND d.from_symbol_id IN (
          SELECT s.id
          FROM symbols s
          JOIN files f ON s.file_id = f.id
          WHERE f.repo_id = ?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM symbols s2
          JOIN files f2 ON s2.file_id = f2.id
          WHERE f2.repo_id = ?
            AND s2.qualified_name = d.to_qualified_name
        )
    `,
    [repositoryId, repositoryId]
  );

  const deletedCount = (result1.rowCount || 0) + (result2.rowCount || 0);
  if (deletedCount > 0) {
    logger.info('Deleted orphaned dependencies', {
      deletedCount,
      withoutQualifiedName: result1.rowCount || 0,
      withNonexistentTarget: result2.rowCount || 0
    });
  }
  return deletedCount;
}
