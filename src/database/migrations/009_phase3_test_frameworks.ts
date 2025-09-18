import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create test_suites table for test suites (describe blocks)
  await knex.schema.createTable('test_suites', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.string('suite_name').notNullable(); // name of the describe block
    table.integer('parent_suite_id').references('id').inTable('test_suites').onDelete('CASCADE');
    table.string('framework_type').notNullable(); // 'jest', 'vitest', 'cypress', 'playwright', 'mocha', 'jasmine'
    table.integer('start_line').nullable(); // line number where suite starts
    table.integer('end_line').nullable(); // line number where suite ends
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'framework_type']);
    table.index(['file_id', 'suite_name']);
    table.index(['parent_suite_id']);
    table.index(['framework_type']);
    table.index(['repo_id']);
    table.index(['start_line', 'end_line']);
  });

  // Create test_cases table for individual test cases (it/test blocks)
  await knex.schema.createTable('test_cases', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('suite_id').notNullable().references('id').inTable('test_suites').onDelete('CASCADE');
    table.integer('symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('test_name').notNullable(); // name of the it/test block
    table.string('test_type').notNullable(); // 'unit', 'integration', 'e2e', 'component'
    table.integer('start_line').nullable(); // line number where test starts
    table.integer('end_line').nullable(); // line number where test ends
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'test_type']);
    table.index(['suite_id', 'test_name']);
    table.index(['symbol_id']);
    table.index(['test_type']);
    table.index(['repo_id']);
    table.index(['start_line', 'end_line']);
  });

  // Create test_coverage table for test-to-code coverage relationships
  await knex.schema.createTable('test_coverage', (table) => {
    table.increments('id').primary();
    table.integer('test_case_id').notNullable().references('id').inTable('test_cases').onDelete('CASCADE');
    table.integer('target_symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('coverage_type').notNullable(); // 'tests', 'mocks', 'imports_for_test', 'spy'
    table.integer('line_number').nullable(); // specific line being tested/mocked
    table.float('confidence').defaultTo(1.0); // confidence score for the coverage relationship
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['test_case_id', 'coverage_type']);
    table.index(['target_symbol_id', 'coverage_type']);
    table.index(['coverage_type']);
    table.index(['target_symbol_id']);
    table.index(['confidence']);

    // Prevent duplicate coverage relationships
    table.unique(['test_case_id', 'target_symbol_id', 'coverage_type']);
  });

  // Add new indexes for improved test coverage analysis
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_test_coverage_target
    ON test_coverage(target_symbol_id, coverage_type, confidence);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_test_coverage_test_case
    ON test_coverage(test_case_id, coverage_type, confidence);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop indexes first
  await knex.schema.raw('DROP INDEX IF EXISTS idx_test_coverage_test_case;');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_test_coverage_target;');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('test_coverage');
  await knex.schema.dropTableIfExists('test_cases');
  await knex.schema.dropTableIfExists('test_suites');
}