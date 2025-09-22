import type { Knex } from 'knex';

/**
 * Migration 006: Test Framework Support
 *
 * Creates testing framework and coverage analysis tables.
 * Consolidates: Original migration 009
 *
 * Features:
 * - Test suites for test suite hierarchy
 * - Test cases for individual test cases
 * - Test coverage for test-to-code relationships
 */
export async function up(knex: Knex): Promise<void> {
  console.log('Creating test framework support tables...');

  // Create test_suites table for test suite hierarchy
  await knex.schema.createTable('test_suites', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.string('suite_name').notNullable();
    table.string('framework_type').notNullable(); // 'jest', 'vitest', 'cypress', 'playwright', 'mocha'
    table.integer('parent_suite_id').references('id').inTable('test_suites').onDelete('CASCADE');
    table.string('setup_method').nullable();
    table.string('teardown_method').nullable();
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'framework_type']);
    table.index(['file_id']);
    table.index(['parent_suite_id']);
    table.index(['framework_type']);
    table.index(['repo_id']);

    // Ensure unique suite name per file
    table.unique(['file_id', 'suite_name']);
  });

  // Create test_cases table for individual test cases
  await knex.schema.createTable('test_cases', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('suite_id').notNullable().references('id').inTable('test_suites').onDelete('CASCADE');
    table.integer('symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('test_name').notNullable();
    table.string('test_type').notNullable(); // 'unit', 'integration', 'e2e'
    table.jsonb('assertions').defaultTo('[]');
    table.jsonb('mocks').defaultTo('[]');
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'test_type']);
    table.index(['suite_id']);
    table.index(['symbol_id']);
    table.index(['test_type']);
    table.index(['repo_id']);

    // Ensure unique test name per suite
    table.unique(['suite_id', 'test_name']);
  });

  // Create test_coverage table for test-to-code relationships
  await knex.schema.createTable('test_coverage', (table) => {
    table.increments('id').primary();
    table.integer('test_case_id').notNullable().references('id').inTable('test_cases').onDelete('CASCADE');
    table.integer('covered_symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('coverage_type').notNullable(); // 'direct', 'indirect', 'mock'
    table.float('confidence').defaultTo(1.0);
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['test_case_id']);
    table.index(['covered_symbol_id']);
    table.index(['coverage_type']);
    table.index(['confidence']);

    // Prevent duplicate coverage relationships
    table.unique(['test_case_id', 'covered_symbol_id', 'coverage_type']);
  });

  console.log('Test framework support tables created successfully');
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing test framework support tables...');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('test_coverage');
  await knex.schema.dropTableIfExists('test_cases');
  await knex.schema.dropTableIfExists('test_suites');

  console.log('Test framework support tables removed successfully');
}