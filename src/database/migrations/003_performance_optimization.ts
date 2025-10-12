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

  // Note: Additional composite indexes removed after analysis (2025-10-12)
  // - symbols_repo_type_exported_idx with INCLUDE clause (2 MB, rarely used)
  // - dependencies_full_context_idx with INCLUDE clause (premature optimization)
  // Migration 001 already creates sufficient indexes for common query patterns

  console.log('✅ Performance optimizations created');
}

export async function down(knex: Knex): Promise<void> {
  // Remove composite indexes
  await knex.raw('DROP INDEX IF EXISTS repositories_language_primary_last_indexed_index');
}
