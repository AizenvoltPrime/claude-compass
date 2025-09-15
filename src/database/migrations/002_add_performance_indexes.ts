import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add composite indexes for common query patterns
  await knex.schema.table('files', (table) => {
    table.index(['repo_id', 'language'], 'files_repo_lang_idx');
    table.index(['repo_id', 'is_test'], 'files_repo_test_idx');
    table.index(['repo_id', 'last_modified'], 'files_repo_modified_idx');
  });

  await knex.schema.table('symbols', (table) => {
    table.index(['file_id', 'symbol_type'], 'symbols_file_type_idx');
    table.index(['file_id', 'is_exported'], 'symbols_file_exported_idx');
    table.index(['symbol_type', 'is_exported'], 'symbols_type_exported_idx');
  });

  await knex.schema.table('dependencies', (table) => {
    table.index(['dependency_type', 'confidence'], 'deps_type_confidence_idx');
    table.index(['from_symbol_id', 'dependency_type'], 'deps_from_type_idx');
    table.index(['to_symbol_id', 'dependency_type'], 'deps_to_type_idx');
  });

  // Add full-text search indexes for symbol names and signatures
  await knex.raw(`
    CREATE INDEX symbols_name_trgm_idx
    ON symbols USING gin (name gin_trgm_ops)
  `);

  await knex.raw(`
    CREATE INDEX symbols_signature_trgm_idx
    ON symbols USING gin (signature gin_trgm_ops)
    WHERE signature IS NOT NULL
  `);

  // Add partial indexes for common filters
  await knex.raw(`
    CREATE INDEX files_non_generated_idx
    ON files (repo_id, path)
    WHERE is_generated = false
  `);

  await knex.raw(`
    CREATE INDEX symbols_exported_idx
    ON symbols (file_id, name, symbol_type)
    WHERE is_exported = true
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop the indexes we created
  await knex.raw('DROP INDEX IF EXISTS symbols_exported_idx');
  await knex.raw('DROP INDEX IF EXISTS files_non_generated_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_signature_trgm_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_name_trgm_idx');

  await knex.schema.table('dependencies', (table) => {
    table.dropIndex(['dependency_type', 'confidence'], 'deps_type_confidence_idx');
    table.dropIndex(['from_symbol_id', 'dependency_type'], 'deps_from_type_idx');
    table.dropIndex(['to_symbol_id', 'dependency_type'], 'deps_to_type_idx');
  });

  await knex.schema.table('symbols', (table) => {
    table.dropIndex(['file_id', 'symbol_type'], 'symbols_file_type_idx');
    table.dropIndex(['file_id', 'is_exported'], 'symbols_file_exported_idx');
    table.dropIndex(['symbol_type', 'is_exported'], 'symbols_type_exported_idx');
  });

  await knex.schema.table('files', (table) => {
    table.dropIndex(['repo_id', 'language'], 'files_repo_lang_idx');
    table.dropIndex(['repo_id', 'is_test'], 'files_repo_test_idx');
    table.dropIndex(['repo_id', 'last_modified'], 'files_repo_modified_idx');
  });
}