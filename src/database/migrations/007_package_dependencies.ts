import type { Knex } from 'knex';

/**
 * Migration 007: Package Dependencies
 *
 * Creates package manager and monorepo support tables.
 * Consolidates: Original migration 010
 *
 * Features:
 * - Package dependencies for dependency tracking
 * - Workspace projects for monorepo structure
 */
export async function up(knex: Knex): Promise<void> {
  console.log('Creating package dependencies tables...');

  // Create package_dependencies table for dependency tracking
  await knex.schema.createTable('package_dependencies', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('package_name').notNullable();
    table.string('version_constraint').notNullable();
    table.string('installed_version').nullable();
    table.string('dependency_type').notNullable(); // 'production', 'development', 'peer', 'optional'
    table.string('package_manager').notNullable(); // 'npm', 'yarn', 'pnpm', 'bun'
    table.integer('package_file_id').references('id').inTable('files').onDelete('SET NULL');
    table.integer('lock_file_id').references('id').inTable('files').onDelete('SET NULL');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'package_manager']);
    table.index(['repo_id', 'dependency_type']);
    table.index(['package_name']);
    table.index(['dependency_type']);
    table.index(['package_manager']);
    table.index(['package_file_id']);
    table.index(['lock_file_id']);

    // Ensure unique package per repository and type
    table.unique(['repo_id', 'package_name', 'dependency_type']);
  });

  // Create workspace_projects table for monorepo structure
  await knex.schema.createTable('workspace_projects', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('project_name').notNullable();
    table.string('project_path').notNullable();
    table.string('workspace_type').notNullable(); // 'nx', 'lerna', 'turborepo', 'rush', 'yarn_workspaces'
    table.integer('package_file_id').references('id').inTable('files').onDelete('SET NULL');
    table.integer('parent_project_id').references('id').inTable('workspace_projects').onDelete('CASCADE');
    table.jsonb('config_data').defaultTo('{}');
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'workspace_type']);
    table.index(['repo_id', 'project_name']);
    table.index(['parent_project_id']);
    table.index(['workspace_type']);
    table.index(['package_file_id']);

    // Ensure unique project per repository
    table.unique(['repo_id', 'project_name']);
  });

  console.log('Package dependencies tables created successfully');
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing package dependencies tables...');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('workspace_projects');
  await knex.schema.dropTableIfExists('package_dependencies');

  console.log('Package dependencies tables removed successfully');
}