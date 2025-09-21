import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {

  // Check if enhanced columns already exist
  const hasCallingObjectColumn = await knex.schema.hasColumn('dependencies', 'calling_object');

  if (!hasCallingObjectColumn) {
    // Add enhanced context columns to dependencies table
    await knex.schema.alterTable('dependencies', (table) => {
      table.string('calling_object', 255).nullable().comment('Calling object name (e.g., "_cardManager", "this.service")');
      table.string('resolved_class', 255).nullable().comment('Resolved class name (e.g., "CardManager", "UserService")');
      table.string('qualified_context', 500).nullable().comment('Qualified method context (e.g., "CardManager.SetHandPositions")');
      table.text('method_signature').nullable().comment('Full method signature with parameters');
      table.string('file_context', 500).nullable().comment('File path for cross-file analysis');
      table.string('namespace_context', 255).nullable().comment('C# namespace information');
    });

    // Add indexes for performance on commonly queried fields

    await knex.schema.alterTable('dependencies', (table) => {
      table.index(['qualified_context'], 'idx_dependencies_qualified_context');
      table.index(['resolved_class'], 'idx_dependencies_resolved_class');
      table.index(['calling_object'], 'idx_dependencies_calling_object');
    });

  }
}

export async function down(knex: Knex): Promise<void> {
  // Drop indexes first
  await knex.schema.alterTable('dependencies', (table) => {
    table.dropIndex([], 'idx_dependencies_qualified_context');
    table.dropIndex([], 'idx_dependencies_resolved_class');
    table.dropIndex([], 'idx_dependencies_calling_object');
  });

  // Remove enhanced context columns from dependencies table
  await knex.schema.alterTable('dependencies', (table) => {
    table.dropColumn('calling_object');
    table.dropColumn('resolved_class');
    table.dropColumn('qualified_context');
    table.dropColumn('method_signature');
    table.dropColumn('file_context');
    table.dropColumn('namespace_context');
  });
}