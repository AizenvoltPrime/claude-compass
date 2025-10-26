import type { Knex } from 'knex';

/**
 * Migration 003: Performance Optimization
 *
 * Creates performance optimizations for search and query patterns.
 *
 * Features:
 * - Optimized composite indexes for common query patterns
 */
export async function up(knex: Knex): Promise<void> {
  console.log('⚡ Creating performance optimizations...');

  // === COMPOSITE INDEXES FOR COMPLEX QUERIES ===

  // Repository analysis indexes (skip if already exists from migration 001)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS repositories_language_primary_last_indexed_index
    ON repositories (language_primary, last_indexed)
  `);

  // Optimize symbol lookups across repository boundaries
  // Used by search queries that filter symbols by repo_id through files join
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_file_id_repo_lookup_idx
    ON symbols (file_id) INCLUDE (id, name, symbol_type, is_exported, entity_type)
  `);

  // Optimize file-based symbol queries (used heavily in parsing/resolution)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS files_repo_id_id_idx
    ON files (repo_id, id) INCLUDE (path, language)
  `);

  // Optimize dependency traversal queries (used in transitive analysis)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS dependencies_traversal_idx
    ON dependencies (to_symbol_id, dependency_type) INCLUDE (from_symbol_id, line_number)
  `);

  console.log('✅ Performance optimizations created');
}

export async function down(knex: Knex): Promise<void> {
  // Remove composite indexes
  await knex.raw('DROP INDEX IF EXISTS repositories_language_primary_last_indexed_index');
  await knex.raw('DROP INDEX IF EXISTS symbols_file_id_repo_lookup_idx');
  await knex.raw('DROP INDEX IF EXISTS files_repo_id_id_idx');
  await knex.raw('DROP INDEX IF EXISTS dependencies_traversal_idx');
}
