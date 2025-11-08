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
 * - Data contracts for schema tracking
 * - Vector search capabilities
 * - Enhanced dependency tracking
 */
export async function up(knex: Knex): Promise<void> {
  console.log('🚀 Creating consolidated framework entities...');

  // Routes table (Laravel-biased design with core fields usable by other frameworks)
  await knex.schema.createTable('routes', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.string('path').notNullable();
    table.string('method');
    table.integer('handler_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('framework_type');
    table.jsonb('middleware').defaultTo('[]');
    table.jsonb('dynamic_segments').defaultTo('[]');
    table.boolean('auth_required').defaultTo(false);

    // Laravel-specific fields (nullable for other frameworks)
    table.string('name'); // Laravel route name
    table.string('controller_class'); // Laravel controller class
    table.string('controller_method'); // Laravel controller method
    table.text('action'); // Laravel route action
    table.text('file_path'); // Source file path
    table.integer('line_number'); // Line number in source file

    // Semantic search: embedding for route path matching
    // Nullable to support incremental embedding generation for existing routes
    table.specificType('path_embedding', 'vector(1024)').nullable();

    table.timestamps(true, true);

    // Indexes
    table.index(['repo_id', 'method', 'path'], 'routes_repo_method_path_idx');
    table.index(['handler_symbol_id']);
    table.index(['framework_type']);
    table.index(['controller_class', 'controller_method']);
    table.index(['name']);
  });

  await knex.schema.createTable('api_calls', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table
      .integer('caller_symbol_id')
      .notNullable()
      .references('id')
      .inTable('symbols')
      .onDelete('CASCADE');
    table.integer('endpoint_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('http_method');
    table.text('endpoint_path');
    table.integer('line_number');
    table.text('raw_call');
    table.string('call_type');
    table.jsonb('metadata').defaultTo('{}');

    // Semantic search: embedding for endpoint path matching
    // Nullable to support incremental embedding generation for existing API calls
    table.specificType('endpoint_embedding', 'vector(1024)').nullable();

    table.timestamps(true, true);

    // Optimized indexes for cross-stack analysis
    table.index(['repo_id']);
    table.index(['http_method', 'endpoint_path'], 'api_calls_method_pattern_idx');
    table.index(['caller_symbol_id', 'endpoint_symbol_id'], 'api_calls_symbol_idx');
    table.index(['caller_symbol_id']);
    table.index(['endpoint_symbol_id']);

    // UNIQUE constraint to prevent duplicate API call entries
    table.unique(
      ['caller_symbol_id', 'endpoint_symbol_id', 'line_number', 'http_method', 'endpoint_path'],
      { indexName: 'api_calls_unique_constraint' }
    );
  });

  // Data contracts table - CLEAN SCHEMA WITH CORRECT COLUMN NAMES
  await knex.schema.createTable('data_contracts', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table
      .integer('frontend_type_id')
      .notNullable()
      .references('id')
      .inTable('symbols')
      .onDelete('CASCADE');
    table
      .integer('backend_type_id')
      .notNullable()
      .references('id')
      .inTable('symbols')
      .onDelete('CASCADE');
    table.string('name').notNullable();
    table.jsonb('schema_definition'); // Schema compatibility information
    table.boolean('drift_detected').defaultTo(false);
    table.timestamps(true, true);

    // Indexes and constraints
    table.index(['repo_id']);
    table.index(['frontend_type_id']);
    table.index(['backend_type_id']);
    table.index(['drift_detected']);
    table.unique(['frontend_type_id', 'backend_type_id', 'name']);
  });

  await knex.schema.createTable('godot_scenes', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.text('scene_path').notNullable();
    table.string('scene_name');
    table.integer('symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.text('script_path');
    table.integer('node_count').defaultTo(0);
    table.boolean('has_script').defaultTo(false);
    table.jsonb('nodes').defaultTo('[]');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);

    table.unique(['repo_id', 'scene_path']);
    table.index(['repo_id']);
    table.index(['scene_name']);
    table.index(['symbol_id']);
    table.index(['has_script']);
  });

  /**
   * Godot nodes table stores scene hierarchy elements.
   * Nodes can share names when under different parents, requiring path-based resolution.
   */
  await knex.schema.createTable('godot_nodes', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table
      .integer('scene_id')
      .notNullable()
      .references('id')
      .inTable('godot_scenes')
      .onDelete('CASCADE');
    table.string('node_name').notNullable();
    table.string('node_type').notNullable();
    table.integer('parent_node_id').references('id').inTable('godot_nodes').onDelete('CASCADE');
    table.text('script_path');
    table.integer('script_symbol_id').references('id').inTable('symbols').onDelete('SET NULL');
    table.jsonb('properties').defaultTo('{}');
    table.timestamps(true, true);

    table.index(['repo_id']);
    table.index(['scene_id']);
    table.index(['node_type']);
    table.index(['parent_node_id']);
    table.index(['script_symbol_id']);
  });

  await knex.schema.createTable('godot_autoloads', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.string('autoload_name').notNullable();
    table.text('script_path').notNullable();
    table.integer('symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.timestamps(true, true);

    table.unique(['repo_id', 'autoload_name']);
    table.index(['repo_id']);
    table.index(['symbol_id']);
    table.index(['autoload_name']);
  });

  await knex.schema.createTable('godot_scene_instances', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table
      .integer('parent_scene_id')
      .notNullable()
      .references('id')
      .inTable('godot_scenes')
      .onDelete('CASCADE');
    table
      .integer('child_scene_id')
      .notNullable()
      .references('id')
      .inTable('godot_scenes')
      .onDelete('CASCADE');
    table.string('instance_name');
    table.integer('node_id').references('id').inTable('godot_nodes').onDelete('CASCADE');
    table.timestamps(true, true);

    table.index(['repo_id']);
    table.index(['parent_scene_id']);
    table.index(['child_scene_id']);
    table.index(['node_id']);
    table.unique(['parent_scene_id', 'child_scene_id', 'node_id']);
  });

  // Framework metadata table - stores framework-specific data as JSON
  await knex.schema.createTable('framework_metadata', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.string('framework_type').notNullable();
    table.string('version');
    table.text('config_path');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);

    // Indexes
    table.index(['repo_id', 'framework_type']);
    table.index(['framework_type']);
  });

  // Components table - Vue/React component metadata
  await knex.schema.createTable('components', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table
      .integer('symbol_id')
      .notNullable()
      .references('id')
      .inTable('symbols')
      .onDelete('CASCADE');
    table.string('component_type').notNullable();
    table.jsonb('props').defaultTo('[]');
    table.jsonb('emits').defaultTo('[]');
    table.jsonb('slots').defaultTo('[]');
    table.jsonb('hooks').defaultTo('[]');
    table
      .integer('parent_component_id')
      .references('id')
      .inTable('components')
      .onDelete('SET NULL');
    table.jsonb('template_dependencies').defaultTo('[]');
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'component_type']);
    table.index(['symbol_id']);
    table.index(['component_type']);
    table.index(['parent_component_id']);
  });

  // Composables table removed (never populated by parser)

  // Add vector extension support for symbols table (BGE-M3: 1024 dimensions)
  // Uses combined_embedding: embedding(name + description) for optimal speed and quality
  await knex.raw('ALTER TABLE symbols ADD COLUMN combined_embedding vector(1024)');
  await knex.raw('ALTER TABLE symbols ADD COLUMN embeddings_updated_at TIMESTAMP');
  await knex.raw('ALTER TABLE symbols ADD COLUMN embedding_model VARCHAR(100)');

  // Create HNSW vector index for embedding-based search
  // m = 16: connections per layer (good balance of speed/accuracy)
  // ef_construction = 64: index build quality
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_combined_embedding_idx
    ON symbols USING hnsw (combined_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
  `);

  console.log('✅ Framework entities created');
}

export async function down(knex: Knex): Promise<void> {
  console.log('🗑️  Dropping consolidated framework entities...');

  // Drop in reverse order to respect foreign key constraints
  await knex.schema.dropTableIfExists('components');
  await knex.schema.dropTableIfExists('godot_scene_instances');
  await knex.schema.dropTableIfExists('godot_autoloads');
  await knex.schema.dropTableIfExists('godot_nodes');
  await knex.schema.dropTableIfExists('godot_scenes');
  await knex.schema.dropTableIfExists('framework_metadata');
  await knex.schema.dropTableIfExists('data_contracts');
  await knex.schema.dropTableIfExists('api_calls');
  await knex.schema.dropTableIfExists('routes');

  // Remove vector columns from symbols
  await knex.raw('ALTER TABLE symbols DROP COLUMN IF EXISTS combined_embedding');
  await knex.raw('ALTER TABLE symbols DROP COLUMN IF EXISTS embeddings_updated_at');
  await knex.raw('ALTER TABLE symbols DROP COLUMN IF EXISTS embedding_model');

  console.log('✅ Framework entities dropped');
}
