import type { Knex } from 'knex';

/**
 * Migration 002: Consolidated Framework Entities
 *
 * Creates all framework-specific tables and features in final form.
 * Consolidates what was previously migrations 003-011 into clean implementation.
 *
 * Features:
 * - Laravel entities (routes, models, controllers)
 * - Vue/React components and cross-stack calls
 * - Godot framework support
 * - Background job systems
 * - ORM relationships
 * - Test framework support
 * - Package dependencies
 * - Vector search capabilities
 * - Enhanced dependency tracking
 * - Clean data_contracts schema (no confidence, correct column names)
 */
export async function up(knex: Knex): Promise<void> {
  console.log('🚀 Creating consolidated framework entities...');

  // Generic routes table (framework-agnostic)
  await knex.schema.createTable('routes', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('path').notNullable();
    table.string('method');
    table.integer('handler_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('framework_type');
    table.jsonb('middleware').defaultTo('[]');
    table.jsonb('dynamic_segments').defaultTo('[]');
    table.boolean('auth_required').defaultTo(false);
    table.timestamps(true, true);

    // Indexes
    table.index(['repo_id', 'method', 'path'], 'routes_repo_method_path_idx');
    table.index(['handler_symbol_id']);
    table.index(['framework_type']);
  });

  // Laravel routes table
  await knex.schema.createTable('laravel_routes', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('method').notNullable();
    table.text('uri').notNullable();
    table.string('name');
    table.text('action');
    table.string('controller_class');
    table.string('controller_method');
    table.jsonb('middleware').defaultTo('[]');
    table.text('file_path');
    table.integer('line_number');
    table.timestamps(true, true);

    // Indexes
    table.index(['repo_id', 'method', 'uri'], 'laravel_routes_repo_method_uri_idx');
    table.index(['controller_class', 'controller_method']);
    table.index(['name']);
  });

  // Laravel models table
  await knex.schema.createTable('laravel_models', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('class_name').notNullable();
    table.string('table_name');
    table.text('namespace');
    table.text('file_path').notNullable();
    table.integer('line_number');
    table.jsonb('fillable').defaultTo('[]');
    table.jsonb('hidden').defaultTo('[]');
    table.jsonb('casts').defaultTo('{}');
    table.jsonb('relationships').defaultTo('{}');
    table.timestamps(true, true);

    // Indexes
    table.index(['repo_id', 'class_name']);
    table.index(['table_name']);
    table.index(['namespace']);
  });

  // Laravel controllers table
  await knex.schema.createTable('laravel_controllers', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('class_name').notNullable();
    table.text('namespace');
    table.text('file_path').notNullable();
    table.integer('line_number');
    table.jsonb('methods').defaultTo('[]');
    table.timestamps(true, true);

    // Indexes
    table.index(['repo_id', 'class_name']);
    table.index(['namespace']);
  });

  // Cross-stack calls table - NO CONFIDENCE COLUMN
  await knex.schema.createTable('cross_stack_calls', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('frontend_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('backend_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('call_type').notNullable();
    table.text('endpoint_path');
    table.string('http_method');
    table.integer('line_number');
    table.timestamps(true, true);

    // Performance indexes
    table.index(['repo_id', 'call_type']);
    table.index(['frontend_symbol_id']);
    table.index(['backend_symbol_id']);
    table.index(['http_method', 'endpoint_path']);
  });

  // API calls table - NO CONFIDENCE COLUMN
  await knex.schema.createTable('api_calls', (table) => {
    table.increments('id').primary();
    table.integer('caller_symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('endpoint_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('http_method');
    table.text('endpoint_path');
    table.integer('line_number');
    table.text('raw_call');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);

    // Optimized indexes for cross-stack analysis
    table.index(['http_method', 'endpoint_path'], 'api_calls_method_pattern_idx');
    table.index(['caller_symbol_id', 'endpoint_symbol_id'], 'api_calls_symbol_idx');
    table.index(['caller_symbol_id']);
    table.index(['endpoint_symbol_id']);
  });

  // Data contracts table - CLEAN SCHEMA WITH CORRECT COLUMN NAMES
  await knex.schema.createTable('data_contracts', (table) => {
    table.increments('id').primary();
    table.integer('frontend_type_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('backend_type_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('name').notNullable();
    table.boolean('drift_detected').defaultTo(false);
    table.timestamps(true, true);

    // Indexes and constraints
    table.index(['frontend_type_id']);
    table.index(['backend_type_id']);
    table.index(['drift_detected']);
    table.unique(['frontend_type_id', 'backend_type_id', 'name']);
  });

  // Background jobs table - NO CONFIDENCE COLUMN
  await knex.schema.createTable('background_jobs', (table) => {
    table.increments('id').primary();
    table.integer('symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('job_type').notNullable();
    table.string('queue_name');
    table.integer('delay_seconds');
    table.jsonb('payload_structure').defaultTo('{}');
    table.timestamps(true, true);

    table.index(['job_type']);
    table.index(['queue_name']);
  });

  // ORM relationships table - NO CONFIDENCE COLUMN
  await knex.schema.createTable('orm_relationships', (table) => {
    table.increments('id').primary();
    table.integer('from_model_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('to_model_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('relationship_type').notNullable();
    table.string('foreign_key');
    table.string('local_key');
    table.string('pivot_table');
    table.timestamps(true, true);

    table.index(['from_model_id', 'relationship_type']);
    table.index(['to_model_id', 'relationship_type']);
  });

  // Test coverage table - NO CONFIDENCE COLUMN
  await knex.schema.createTable('test_coverage', (table) => {
    table.increments('id').primary();
    table.integer('symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('test_symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('coverage_type').notNullable();
    table.text('test_description');
    table.timestamps(true, true);

    table.index(['symbol_id']);
    table.index(['test_symbol_id']);
    table.index(['coverage_type']);
  });

  // Package dependencies table - NO CONFIDENCE COLUMN
  await knex.schema.createTable('package_dependencies', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('package_name').notNullable();
    table.string('version');
    table.string('dependency_type').notNullable(); // 'dependencies', 'devDependencies', etc
    table.string('package_manager'); // npm, composer, etc
    table.timestamps(true, true);

    table.index(['repo_id', 'package_name']);
    table.index(['package_name']);
    table.index(['dependency_type']);
  });

  // Godot relationships table - NO CONFIDENCE COLUMN
  await knex.schema.createTable('godot_relationships', (table) => {
    table.increments('id').primary();
    table.integer('from_symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('to_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('relationship_type').notNullable();
    table.text('scene_path');
    table.text('resource_path');
    table.integer('line_number');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);

    table.index(['from_symbol_id', 'relationship_type']);
    table.index(['to_symbol_id', 'relationship_type']);
    table.index(['scene_path']);
  });

  // Add vector extension support for symbols table
  await knex.raw('ALTER TABLE symbols ADD COLUMN embedding vector(1536)');

  // Create vector index for semantic search
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_embedding_idx
    ON symbols USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `);

  console.log('✅ Framework entities created');
}

export async function down(knex: Knex): Promise<void> {
  console.log('🗑️  Dropping consolidated framework entities...');

  // Drop in reverse order to respect foreign key constraints
  await knex.schema.dropTableIfExists('godot_relationships');
  await knex.schema.dropTableIfExists('package_dependencies');
  await knex.schema.dropTableIfExists('test_coverage');
  await knex.schema.dropTableIfExists('orm_relationships');
  await knex.schema.dropTableIfExists('background_jobs');
  await knex.schema.dropTableIfExists('data_contracts');
  await knex.schema.dropTableIfExists('api_calls');
  await knex.schema.dropTableIfExists('cross_stack_calls');
  await knex.schema.dropTableIfExists('laravel_controllers');
  await knex.schema.dropTableIfExists('laravel_models');
  await knex.schema.dropTableIfExists('laravel_routes');
  await knex.schema.dropTableIfExists('routes');

  // Remove vector column from symbols
  await knex.raw('ALTER TABLE symbols DROP COLUMN IF EXISTS embedding');

  console.log('✅ Framework entities dropped');
}