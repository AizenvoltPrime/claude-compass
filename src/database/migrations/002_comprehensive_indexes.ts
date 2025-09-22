import type { Knex } from 'knex';

/**
 * Migration 002: Comprehensive Performance Indexes
 *
 * Consolidates all performance indexes and search infrastructure.
 * Consolidates: Original migrations 002, 014
 *
 * Features:
 * - Composite indexes for common query patterns
 * - Full-text search with trigram support
 * - Partial indexes for filtered queries
 * - Godot and C# specific indexes
 * - Performance monitoring indexes
 */
export async function up(knex: Knex): Promise<void> {
  console.log('Creating comprehensive performance indexes...');

  // Enable required extensions for trigram indexes
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gin');

  // === COMPOSITE INDEXES FOR COMMON QUERY PATTERNS ===

  // Files table composite indexes
  await knex.schema.table('files', (table) => {
    table.index(['repo_id', 'language'], 'files_repo_lang_idx');
    table.index(['repo_id', 'is_test'], 'files_repo_test_idx');
    table.index(['repo_id', 'last_modified'], 'files_repo_modified_idx');
  });

  // Symbols table composite indexes
  await knex.schema.table('symbols', (table) => {
    table.index(['file_id', 'symbol_type'], 'symbols_file_type_idx');
    table.index(['file_id', 'is_exported'], 'symbols_file_exported_idx');
    table.index(['symbol_type', 'is_exported'], 'symbols_type_exported_idx');
  });

  // Dependencies table composite indexes
  await knex.schema.table('dependencies', (table) => {
    table.index(['dependency_type', 'confidence'], 'deps_type_confidence_idx');
    table.index(['from_symbol_id', 'dependency_type'], 'deps_from_type_idx');
    table.index(['to_symbol_id', 'dependency_type'], 'deps_to_type_idx');
  });

  // File dependencies table composite indexes
  await knex.schema.table('file_dependencies', (table) => {
    table.index(['from_file_id', 'dependency_type'], 'file_deps_from_type_idx');
    table.index(['to_file_id', 'dependency_type'], 'file_deps_to_type_idx');
  });

  // === FULL-TEXT SEARCH INDEXES ===

  // Trigram indexes for fuzzy search on symbol names and signatures
  await knex.raw(`
    CREATE INDEX symbols_name_trgm_idx
    ON symbols USING gin (name gin_trgm_ops)
  `);

  await knex.raw(`
    CREATE INDEX symbols_signature_trgm_idx
    ON symbols USING gin (signature gin_trgm_ops)
    WHERE signature IS NOT NULL
  `);

  // Trigram index for description field
  await knex.raw(`
    CREATE INDEX symbols_description_trgm_idx
    ON symbols USING gin (description gin_trgm_ops)
    WHERE description IS NOT NULL
  `);

  // === PARTIAL INDEXES FOR FILTERED QUERIES ===

  // Index for non-generated files (most common query pattern)
  await knex.raw(`
    CREATE INDEX files_non_generated_idx
    ON files (repo_id, path)
    WHERE is_generated = false
  `);

  // Index for exported symbols (frequently queried)
  await knex.raw(`
    CREATE INDEX symbols_exported_idx
    ON symbols (file_id, name, symbol_type)
    WHERE is_exported = true
  `);

  // Index for test files (useful for filtering)
  await knex.raw(`
    CREATE INDEX files_test_only_idx
    ON files (repo_id, language)
    WHERE is_test = true
  `);

  // === GODOT AND C# SPECIFIC INDEXES ===

  // Godot symbol types optimization
  await knex.raw(`
    CREATE INDEX idx_symbols_godot_type
    ON symbols(symbol_type) WHERE symbol_type IN (
      'godot_scene', 'godot_node', 'godot_script', 'godot_autoload', 'godot_resource'
    )
  `);

  // Godot dependency types optimization
  await knex.raw(`
    CREATE INDEX idx_dependencies_godot_type
    ON dependencies(dependency_type) WHERE dependency_type IN (
      'scene_reference', 'node_child', 'signal_connection', 'script_attachment'
    )
  `);

  // C# file extensions optimization
  await knex.raw(`
    CREATE INDEX idx_files_csharp
    ON files(path) WHERE path LIKE '%.cs'
  `);

  // Godot scene files optimization
  await knex.raw(`
    CREATE INDEX idx_files_godot_scenes
    ON files(path) WHERE path LIKE '%.tscn'
  `);

  // Godot project files optimization
  await knex.raw(`
    CREATE INDEX idx_files_godot_project
    ON files(path) WHERE path LIKE '%project.godot'
  `);

  // Composite index for Godot framework queries
  await knex.raw(`
    CREATE INDEX idx_symbols_godot_composite
    ON symbols(file_id, symbol_type, is_exported)
    WHERE symbol_type LIKE 'godot_%'
  `);

  // C# namespace symbols optimization
  await knex.raw(`
    CREATE INDEX idx_symbols_csharp_namespace
    ON symbols(symbol_type, name) WHERE symbol_type = 'namespace'
  `);

  // === PERFORMANCE MONITORING INDEXES ===

  // Index for file size monitoring
  await knex.raw(`
    CREATE INDEX files_large_files_idx
    ON files (repo_id, size)
    WHERE size > 100000
  `);

  // Index for recent activity monitoring (without NOW() for immutability)
  await knex.raw(`
    CREATE INDEX files_recent_activity_idx
    ON files (last_modified)
    WHERE last_modified IS NOT NULL
  `);

  // Symbols count per file (for parser performance analysis)
  await knex.raw(`
    CREATE INDEX symbols_file_count_idx
    ON symbols (file_id, created_at)
  `);

  console.log('Comprehensive performance indexes created successfully');
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing comprehensive performance indexes...');

  // === DROP PERFORMANCE MONITORING INDEXES ===
  await knex.raw('DROP INDEX IF EXISTS symbols_file_count_idx');
  await knex.raw('DROP INDEX IF EXISTS files_recent_activity_idx');
  await knex.raw('DROP INDEX IF EXISTS files_large_files_idx');

  // === DROP GODOT AND C# SPECIFIC INDEXES ===
  await knex.raw('DROP INDEX IF EXISTS idx_symbols_csharp_namespace');
  await knex.raw('DROP INDEX IF EXISTS idx_symbols_godot_composite');
  await knex.raw('DROP INDEX IF EXISTS idx_files_godot_project');
  await knex.raw('DROP INDEX IF EXISTS idx_files_godot_scenes');
  await knex.raw('DROP INDEX IF EXISTS idx_files_csharp');
  await knex.raw('DROP INDEX IF EXISTS idx_dependencies_godot_type');
  await knex.raw('DROP INDEX IF EXISTS idx_symbols_godot_type');

  // === DROP PARTIAL INDEXES ===
  await knex.raw('DROP INDEX IF EXISTS files_test_only_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_exported_idx');
  await knex.raw('DROP INDEX IF EXISTS files_non_generated_idx');

  // === DROP FULL-TEXT SEARCH INDEXES ===
  await knex.raw('DROP INDEX IF EXISTS symbols_description_trgm_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_signature_trgm_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_name_trgm_idx');

  // === DROP COMPOSITE INDEXES ===

  // File dependencies table indexes
  await knex.schema.table('file_dependencies', (table) => {
    table.dropIndex(['from_file_id', 'dependency_type'], 'file_deps_from_type_idx');
    table.dropIndex(['to_file_id', 'dependency_type'], 'file_deps_to_type_idx');
  });

  // Dependencies table indexes
  await knex.schema.table('dependencies', (table) => {
    table.dropIndex(['dependency_type', 'confidence'], 'deps_type_confidence_idx');
    table.dropIndex(['from_symbol_id', 'dependency_type'], 'deps_from_type_idx');
    table.dropIndex(['to_symbol_id', 'dependency_type'], 'deps_to_type_idx');
  });

  // Symbols table indexes
  await knex.schema.table('symbols', (table) => {
    table.dropIndex(['file_id', 'symbol_type'], 'symbols_file_type_idx');
    table.dropIndex(['file_id', 'is_exported'], 'symbols_file_exported_idx');
    table.dropIndex(['symbol_type', 'is_exported'], 'symbols_type_exported_idx');
  });

  // Files table indexes
  await knex.schema.table('files', (table) => {
    table.dropIndex(['repo_id', 'language'], 'files_repo_lang_idx');
    table.dropIndex(['repo_id', 'is_test'], 'files_repo_test_idx');
    table.dropIndex(['repo_id', 'last_modified'], 'files_repo_modified_idx');
  });

  console.log('Comprehensive performance indexes removed successfully');
}