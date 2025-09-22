import type { Knex } from 'knex';

/**
 * Migration 003: Framework Entities
 *
 * Creates framework-aware parsing support tables for tracking framework-specific entities.
 * Consolidates: Original migration 006
 *
 * Features:
 * - Routes table for HTTP route definitions
 * - Components table for Vue.js and React components
 * - Composables table for Vue composables and React hooks
 * - Framework metadata table for configuration tracking
 */
export async function up(knex: Knex): Promise<void> {
  console.log('Creating framework entities tables...');

  // Create routes table for framework-specific HTTP routes
  await knex.schema.createTable('routes', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('path').notNullable(); // '/api/users/[id]', '/users/:id'
    table.string('method'); // GET, POST, PUT, DELETE
    table.integer('handler_symbol_id').references('id').inTable('symbols').onDelete('SET NULL');
    table.string('framework_type'); // 'nextjs', 'express', 'fastify', 'vue-router', 'laravel'
    table.jsonb('middleware').defaultTo('[]'); // middleware chain
    table.jsonb('dynamic_segments').defaultTo('[]'); // [id], [...slug]
    table.boolean('auth_required').defaultTo(false);
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'framework_type']);
    table.index(['path', 'method']);
    table.index(['framework_type']);
    table.index(['handler_symbol_id']);
    table.index(['repo_id', 'path']);
  });

  // Create components table for Vue.js and React components
  await knex.schema.createTable('components', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('component_type').notNullable(); // 'vue', 'react'
    table.jsonb('props').defaultTo('[]'); // component props definition
    table.jsonb('emits').defaultTo('[]'); // Vue-specific: emitted events
    table.jsonb('slots').defaultTo('[]'); // Vue-specific: slot definitions
    table.jsonb('hooks').defaultTo('[]'); // React-specific: hooks usage
    table.integer('parent_component_id').references('id').inTable('components').onDelete('SET NULL');
    table.jsonb('template_dependencies').defaultTo('[]'); // referenced components in template/JSX
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'component_type']);
    table.index(['symbol_id']);
    table.index(['component_type']);
    table.index(['parent_component_id']);
    table.index(['repo_id']);
  });

  // Create composables table for Vue composables and React hooks
  await knex.schema.createTable('composables', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('composable_type').notNullable(); // 'vue-composable', 'react-hook'
    table.jsonb('returns').defaultTo('[]'); // what the composable/hook returns
    table.jsonb('dependencies').defaultTo('[]'); // other composables/hooks it depends on
    table.jsonb('reactive_refs').defaultTo('[]'); // Vue-specific: reactive references
    table.jsonb('dependency_array').defaultTo('[]'); // React-specific: useEffect dependency array
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'composable_type']);
    table.index(['symbol_id']);
    table.index(['composable_type']);
    table.index(['repo_id']);
  });

  // Create framework_metadata table for storing framework configuration and metadata
  await knex.schema.createTable('framework_metadata', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('framework_type').notNullable(); // 'vue', 'nextjs', 'react', 'express', 'fastify', 'laravel', 'godot'
    table.string('version'); // framework version
    table.string('config_path'); // path to config file (vue.config.js, next.config.js, etc.)
    table.jsonb('metadata').defaultTo('{}'); // flexible metadata storage
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'framework_type']);
    table.index(['framework_type']);
    table.index(['repo_id']);

    // Ensure unique framework type per repository
    table.unique(['repo_id', 'framework_type']);
  });

  console.log('Framework entities tables created successfully');
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing framework entities tables...');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('framework_metadata');
  await knex.schema.dropTableIfExists('composables');
  await knex.schema.dropTableIfExists('components');
  await knex.schema.dropTableIfExists('routes');

  console.log('Framework entities tables removed successfully');
}