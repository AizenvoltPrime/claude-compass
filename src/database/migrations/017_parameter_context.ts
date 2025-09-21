import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Check if parameter context columns already exist
  const hasParameterContextColumn = await knex.schema.hasColumn('dependencies', 'parameter_context');

  if (!hasParameterContextColumn) {
    // Add parameter context columns to dependencies table
    await knex.schema.alterTable('dependencies', (table) => {
      table.text('parameter_context').nullable().comment('Raw parameter expressions from method calls (e.g., "_handPosition, null")');
      table.string('call_instance_id', 36).nullable().comment('Unique identifier for distinguishing multiple calls to same method');
      table.json('parameter_types').nullable().comment('JSON array of parameter type information when available');
    });

    // Add indexes for performance on commonly queried fields
    await knex.schema.alterTable('dependencies', (table) => {
      table.index(['call_instance_id'], 'idx_dependencies_call_instance_id');
      // Add composite index for grouping calls by method and file context
      table.index(['to_symbol_id', 'from_symbol_id'], 'idx_dependencies_call_grouping');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Drop indexes first
  await knex.schema.alterTable('dependencies', (table) => {
    table.dropIndex([], 'idx_dependencies_call_instance_id');
    table.dropIndex([], 'idx_dependencies_call_grouping');
  });

  // Remove parameter context columns from dependencies table
  await knex.schema.alterTable('dependencies', (table) => {
    table.dropColumn('parameter_context');
    table.dropColumn('call_instance_id');
    table.dropColumn('parameter_types');
  });
}