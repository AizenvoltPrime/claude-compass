import type { Knex } from 'knex';

/**
 * Migration 001: Core Infrastructure
 *
 * Creates the complete foundational schema for Claude Compass with all core enhancements.
 * Consolidates: Original migrations 001, 003, 004, 013
 *
 * Key improvements:
 * - Symbols table with TEXT fields from start (no fragmentation)
 * - Description field included from beginning (fixes ordering issue)
 * - Complete foreign key cascades
 * - Essential indexes for basic functionality
 * - Atomic creation of all core relationships
 */
export async function up(knex: Knex): Promise<void> {
  console.log('Creating core infrastructure tables...');

  // Create repositories table
  await knex.schema.createTable('repositories', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.text('path').notNullable().unique();
    table.string('language_primary');
    table.jsonb('framework_stack').defaultTo('[]');
    table.timestamp('last_indexed');
    table.string('git_hash');
    table.timestamps(true, true);

    // Essential indexes for performance
    table.index(['name']);
    table.index(['language_primary']);
    table.index(['last_indexed']);
  });

  // Create files table
  await knex.schema.createTable('files', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.text('path').notNullable();
    table.string('language');
    table.integer('size');
    table.timestamp('last_modified');
    table.string('git_hash');
    table.boolean('is_generated').defaultTo(false);
    table.boolean('is_test').defaultTo(false);
    table.timestamps(true, true);

    // Constraints
    table.unique(['repo_id', 'path']);

    // Essential indexes for performance
    table.index(['repo_id']);
    table.index(['language']);
    table.index(['is_generated']);
    table.index(['is_test']);
    table.index(['last_modified']);
  });

  // Create symbols table with complete structure from start
  await knex.schema.createTable('symbols', (table) => {
    table.increments('id').primary();
    table.integer('file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.text('name').notNullable(); // TEXT from start - no fragmentation
    table.string('symbol_type').notNullable(); // function, class, interface, variable, etc.
    table.integer('start_line');
    table.integer('end_line');
    table.boolean('is_exported').defaultTo(false);
    table.string('visibility'); // public, private, protected
    table.text('signature');
    table.text('description'); // Included from beginning - fixes ordering issue
    table.timestamps(true, true);

    // Essential indexes for performance
    table.index(['file_id']);
    table.index(['name']);
    table.index(['symbol_type']);
    table.index(['is_exported']);
    table.index(['file_id', 'name']);
  });

  // Create dependencies table with basic structure
  await knex.schema.createTable('dependencies', (table) => {
    table.increments('id').primary();
    table.integer('from_symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('to_symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('dependency_type').notNullable(); // calls, imports, inherits, implements
    table.integer('line_number');
    table.float('confidence').defaultTo(1.0);
    table.timestamps(true, true);

    // Basic unique constraint (will be enhanced in migration 011)
    table.unique(['from_symbol_id', 'to_symbol_id', 'dependency_type']);

    // Essential indexes for performance
    table.index(['from_symbol_id']);
    table.index(['to_symbol_id']);
    table.index(['dependency_type']);
  });

  // Create file_dependencies table for file-level relationships
  await knex.schema.createTable('file_dependencies', (table) => {
    table.increments('id').primary();
    table.integer('from_file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.integer('to_file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.string('dependency_type').notNullable(); // import, export, require, etc.
    table.integer('line_number');
    table.float('confidence').defaultTo(1.0);
    table.timestamps(true, true);

    // Constraints
    table.unique(['from_file_id', 'to_file_id', 'dependency_type']);

    // Essential indexes for performance
    table.index(['from_file_id']);
    table.index(['to_file_id']);
    table.index(['dependency_type']);
    table.index(['from_file_id', 'dependency_type']);
  });

  console.log('Core infrastructure tables created successfully');
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing core infrastructure tables...');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('file_dependencies');
  await knex.schema.dropTableIfExists('dependencies');
  await knex.schema.dropTableIfExists('symbols');
  await knex.schema.dropTableIfExists('files');
  await knex.schema.dropTableIfExists('repositories');

  console.log('Core infrastructure tables removed successfully');
}