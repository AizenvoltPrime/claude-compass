import type { Knex } from 'knex';

/**
 * Migration 001: Consolidated Core Infrastructure
 *
 * Key features:
 * - Optimized indexes for full-table queries
 * - Clean data_contracts schema with correct column names
 * - All framework support included from start
 * - Materialized views and performance optimizations
 */
export async function up(knex: Knex): Promise<void> {
  console.log('🏗️  Creating consolidated core infrastructure...');

  // Enable required extensions first
  await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gin');

  // Create repositories table
  await knex.schema.createTable('repositories', table => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.text('path').notNullable().unique();
    table.string('language_primary');
    table.jsonb('framework_stack').defaultTo('[]');
    table.timestamp('last_indexed');
    table.string('git_hash');
    table.timestamps(true, true);

    // Performance indexes
    table.index(['name']);
    table.index(['language_primary']);
    table.index(['last_indexed']);
  });

  // Create files table
  await knex.schema.createTable('files', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.text('path').notNullable();
    table.string('language');
    table.integer('size');
    table.timestamp('last_modified');
    table.string('git_hash');
    table.boolean('is_generated').defaultTo(false);
    table.boolean('is_test').defaultTo(false);
    table.timestamps(true, true);

    // Constraints and indexes
    table.unique(['repo_id', 'path']);
    table.index(['repo_id', 'language'], 'files_repo_lang_idx');
    table.index(['repo_id', 'is_test'], 'files_repo_test_idx');
    table.index(['repo_id', 'last_modified'], 'files_repo_modified_idx');
    table.index(['language']);
    table.index(['is_test']);
  });

  await knex.schema.createTable('symbols', table => {
    table.increments('id').primary();
    table.integer('file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.string('name', 1000).notNullable();
    table.text('qualified_name');
    table.integer('parent_symbol_id').unsigned().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('symbol_type', 500).notNullable();
    table.text('signature');
    table.text('description');
    table.integer('start_line');
    table.integer('end_line');
    table.boolean('is_exported').defaultTo(false);
    table.string('visibility', 500);
    table.string('namespace', 1000);
    table.jsonb('metadata').defaultTo('{}');
    table.text('raw_source');
    table.specificType('search_vector', 'tsvector');
    table.timestamps(true, true);

    // Performance indexes
    table.index(['file_id', 'symbol_type'], 'symbols_file_type_idx');
    table.index(['file_id', 'is_exported'], 'symbols_file_exported_idx');
    table.index(['symbol_type', 'is_exported'], 'symbols_type_exported_idx');
    table.index(['name']);
    table.index(['qualified_name'], 'symbols_qualified_name_idx');
    table.index(['parent_symbol_id'], 'symbols_parent_id_idx');
    table.index(['symbol_type']);
    table.index(['is_exported']);
    table.index(['start_line']);
  });

  await knex.raw('CREATE INDEX symbols_search_vector_idx ON symbols USING gin(search_vector)');

  await knex.schema.createTable('dependencies', table => {
    table.increments('id').primary();
    table
      .integer('from_symbol_id')
      .notNullable()
      .references('id')
      .inTable('symbols')
      .onDelete('CASCADE');
    table.integer('to_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('dependency_type').notNullable();
    table.integer('line_number');
    table.text('parameter_context');
    table.text('call_instance_id');
    table.jsonb('parameter_types');
    table.text('calling_object');
    table.text('qualified_context');
    table.text('resolved_class'); // C# resolved class name for disambiguation
    table.text('raw_text');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);

    // Unique constraint for ON CONFLICT usage
    table.unique(['from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number']);

    table.index(['from_symbol_id', 'dependency_type'], 'deps_from_symbol_type_idx');
    table.index(['to_symbol_id', 'dependency_type'], 'deps_to_symbol_type_idx');
    table.index(['dependency_type', 'from_symbol_id', 'to_symbol_id'], 'deps_type_symbols_idx');
    table.index(['from_symbol_id', 'line_number'], 'deps_symbol_line_idx');
    table.index(['dependency_type']);
    table.index(['resolved_class'], 'deps_resolved_class_idx');
  });

  await knex.schema.createTable('file_dependencies', table => {
    table.increments('id').primary();
    table
      .integer('from_file_id')
      .notNullable()
      .references('id')
      .inTable('files')
      .onDelete('CASCADE');
    table.integer('to_file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.string('dependency_type').notNullable();
    table.string('import_path');
    table.integer('line_number');
    table.timestamps(true, true);

    // Unique constraint for ON CONFLICT usage
    table.unique(['from_file_id', 'to_file_id', 'dependency_type']);

    // Performance indexes
    table.index(['from_file_id', 'dependency_type'], 'file_deps_from_type_idx');
    table.index(['to_file_id', 'dependency_type'], 'file_deps_to_type_idx');
    table.index(['dependency_type', 'from_file_id', 'to_file_id'], 'file_deps_type_idx');
  });

  console.log('✅ Core infrastructure tables created');
}

export async function down(knex: Knex): Promise<void> {
  console.log('🗑️  Dropping consolidated core infrastructure...');

  await knex.schema.dropTableIfExists('file_dependencies');
  await knex.schema.dropTableIfExists('dependencies');
  await knex.schema.dropTableIfExists('symbols');
  await knex.schema.dropTableIfExists('files');
  await knex.schema.dropTableIfExists('repositories');

  console.log('✅ Core infrastructure dropped');
}
