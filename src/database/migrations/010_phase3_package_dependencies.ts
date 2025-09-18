import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create package_dependencies table for npm/yarn/pnpm dependencies
  await knex.schema.createTable('package_dependencies', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('package_name').notNullable(); // e.g., 'react', 'express', '@types/node'
    table.string('version_spec').notNullable(); // ^4.18.0, ~1.2.3, >=2.0.0, etc.
    table.string('resolved_version').nullable(); // actual resolved version from lock file
    table.string('dependency_type').notNullable(); // 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'
    table.string('package_manager').notNullable(); // 'npm', 'yarn', 'pnpm', 'bun'
    table.string('lock_file_path').nullable(); // path to package-lock.json, yarn.lock, etc.
    table.boolean('is_workspace').defaultTo(false); // is this a workspace/monorepo package
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'package_name']);
    table.index(['repo_id', 'dependency_type']);
    table.index(['package_name', 'version_spec']);
    table.index(['package_manager']);
    table.index(['dependency_type']);
    table.index(['is_workspace']);

    // Ensure unique package dependency per repository and type
    table.unique(['repo_id', 'package_name', 'dependency_type']);
  });

  // Create workspace_projects table for monorepo/workspace project structure
  await knex.schema.createTable('workspace_projects', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('project_name').notNullable(); // name of the project/package
    table.string('project_path').notNullable(); // relative path within monorepo
    table.string('package_json_path').notNullable(); // path to package.json
    table.integer('parent_project_id').references('id').inTable('workspace_projects').onDelete('CASCADE');
    table.string('workspace_type').notNullable(); // 'nx', 'lerna', 'turborepo', 'rush', 'yarn_workspaces', 'npm_workspaces'
    table.jsonb('config_data').defaultTo('{}'); // workspace-specific configuration
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'workspace_type']);
    table.index(['repo_id', 'project_name']);
    table.index(['parent_project_id']);
    table.index(['workspace_type']);
    table.index(['project_path']);

    // Ensure unique project path per repository
    table.unique(['repo_id', 'project_path']);
  });

  // Add new indexes for improved package dependency analysis
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_package_dependencies_workspace
    ON package_dependencies(repo_id, is_workspace, package_manager);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_workspace_projects_hierarchy
    ON workspace_projects(parent_project_id, workspace_type);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop indexes first
  await knex.schema.raw('DROP INDEX IF EXISTS idx_workspace_projects_hierarchy;');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_package_dependencies_workspace;');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('workspace_projects');
  await knex.schema.dropTableIfExists('package_dependencies');
}