import type { Knex } from 'knex';

/**
 * Migration 003: Performance Optimization
 *
 * Creates performance optimizations for search and query patterns.
 *
 * Features:
 * - Full-text search with trigram support
 * - Optimized composite indexes for common query patterns
 */
export async function up(knex: Knex): Promise<void> {
  console.log('⚡ Creating performance optimizations...');

  // === FULL-TEXT SEARCH INDEXES ===

  // Full-text search on symbol names with trigram support
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_name_trigram_idx
    ON symbols USING gin (name gin_trgm_ops)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_signature_trigram_idx
    ON symbols USING gin (signature gin_trgm_ops)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS files_path_trigram_idx
    ON files USING gin (path gin_trgm_ops)
  `);

  // === COMPOSITE INDEXES FOR COMPLEX QUERIES ===

  // Repository analysis indexes (skip if already exists from migration 001)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS repositories_language_primary_last_indexed_index
    ON repositories (language_primary, last_indexed)
  `);

  // Multi-column indexes for common query patterns
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_repo_type_exported_idx
    ON symbols(symbol_type, is_exported)
    INCLUDE (file_id, name)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS dependencies_full_context_idx
    ON dependencies(dependency_type, from_symbol_id, to_symbol_id)
    INCLUDE (line_number, raw_text)
  `);

  console.log('✅ Performance optimizations created');
  console.log('   • Full-text search indexes with trigram support');
  console.log('   • Composite indexes for common query patterns');
}

export async function down(knex: Knex): Promise<void> {
  console.log('🗑️  Removing performance optimizations...');

  // Remove composite indexes
  await knex.raw('DROP INDEX IF EXISTS dependencies_full_context_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_repo_type_exported_idx');
  await knex.raw('DROP INDEX IF EXISTS repositories_language_primary_last_indexed_index');

  // Remove full-text search indexes
  await knex.raw('DROP INDEX IF EXISTS files_path_trigram_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_signature_trigram_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_name_trigram_idx');

  console.log('✅ Performance optimizations removed');
}