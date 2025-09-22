import type { Knex } from 'knex';

/**
 * Migration 008: Cross-Stack Tracking
 *
 * Creates Vue ↔ Laravel integration tables.
 * Consolidates: Original migration 011
 *
 * Features:
 * - API calls for frontend-to-backend tracking
 * - Data contracts for type synchronization
 */
export async function up(knex: Knex): Promise<void> {
  console.log('Creating cross-stack tracking tables...');

  // Create api_calls table for frontend-to-backend tracking
  await knex.schema.createTable('api_calls', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('caller_symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('endpoint_symbol_id').references('id').inTable('symbols').onDelete('SET NULL');
    table.string('endpoint_path').notNullable();
    table.string('http_method').notNullable();
    table.string('call_type').notNullable(); // 'axios', 'fetch', 'xhr', 'vue-resource'
    table.float('confidence').defaultTo(1.0);
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'endpoint_path']);
    table.index(['caller_symbol_id']);
    table.index(['endpoint_symbol_id']);
    table.index(['http_method']);
    table.index(['call_type']);
    table.index(['confidence']);

    // Prevent duplicate API call relationships
    table.unique(['caller_symbol_id', 'endpoint_path', 'http_method']);
  });

  // Create data_contracts table for type synchronization
  await knex.schema.createTable('data_contracts', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('frontend_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('backend_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('contract_type').notNullable(); // 'request', 'response', 'shared_interface'
    table.jsonb('schema_definition').defaultTo('{}');
    table.float('confidence').defaultTo(1.0);
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'contract_type']);
    table.index(['frontend_symbol_id']);
    table.index(['backend_symbol_id']);
    table.index(['contract_type']);
    table.index(['confidence']);

    // Prevent duplicate data contracts
    table.unique(['frontend_symbol_id', 'backend_symbol_id', 'contract_type']);
  });

  console.log('Cross-stack tracking tables created successfully');
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing cross-stack tracking tables...');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('data_contracts');
  await knex.schema.dropTableIfExists('api_calls');

  console.log('Cross-stack tracking tables removed successfully');
}