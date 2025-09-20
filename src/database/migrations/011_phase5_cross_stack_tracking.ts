import type { Knex } from 'knex';

/**
 * Phase 5 Migration: Cross-Stack Tracking
 * Adds support for Vue ↔ Laravel dependency tracking
 */
export async function up(knex: Knex): Promise<void> {
  // Create api_calls table for tracking Vue API calls to Laravel endpoints
  await knex.schema.createTable('api_calls', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('frontend_symbol_id').nullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('backend_route_id').nullable().references('id').inTable('routes').onDelete('CASCADE');
    table.string('method').nullable(); // GET, POST, PUT, DELETE
    table.string('url_pattern').nullable(); // /api/users/{id}
    table.jsonb('request_schema').nullable(); // TypeScript interface/type definition
    table.jsonb('response_schema').nullable(); // TypeScript interface/type definition
    table.float('confidence').defaultTo(1.0).notNullable();
    table.timestamps(true, true);

    // Indexes for performance
    table.index('frontend_symbol_id', 'idx_api_calls_frontend_symbol');
    table.index('backend_route_id', 'idx_api_calls_backend_route');
    table.index('repo_id', 'idx_api_calls_repo');
    table.index(['repo_id', 'method'], 'idx_api_calls_repo_method');
  });

  // Create data_contracts table for tracking TypeScript interfaces ↔ PHP DTOs
  await knex.schema.createTable('data_contracts', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('name').notNullable(); // UserData, ProductInfo, etc.
    table.integer('frontend_type_id').nullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('backend_type_id').nullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.jsonb('schema_definition').nullable(); // Unified schema representation
    table.boolean('drift_detected').defaultTo(false).notNullable();
    table.timestamp('last_verified').defaultTo(knex.fn.now()).notNullable();
    table.timestamps(true, true);

    // Indexes for performance
    table.index('frontend_type_id', 'idx_data_contracts_frontend_type');
    table.index('backend_type_id', 'idx_data_contracts_backend_type');
    table.index('repo_id', 'idx_data_contracts_repo');
    table.index(['repo_id', 'name'], 'idx_data_contracts_repo_name');
    table.index('drift_detected', 'idx_data_contracts_drift');
  });

  // Add new cross-stack dependency types to dependencies table
  // This is handled by extending the DependencyType enum in models.ts
  // The database will accept the new enum values without schema changes
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order due to foreign key constraints
  await knex.schema.dropTableIfExists('data_contracts');
  await knex.schema.dropTableIfExists('api_calls');

}