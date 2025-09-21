import type { Knex } from 'knex';

/**
 * Fix unique constraint on dependencies table to allow multiple calls
 * between same symbols with different parameter contexts
 */
export async function up(knex: Knex): Promise<void> {
  // Drop the existing unique constraint
  await knex.schema.alterTable('dependencies', (table) => {
    table.dropUnique(['from_symbol_id', 'to_symbol_id', 'dependency_type']);
  });

  // Add a new unique constraint that includes line_number to allow multiple
  // calls between the same symbols at different lines (different parameter contexts)
  await knex.schema.alterTable('dependencies', (table) => {
    table.unique(['from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number']);
  });
}

export async function down(knex: Knex): Promise<void> {
  // Revert back to the original unique constraint
  await knex.schema.alterTable('dependencies', (table) => {
    table.dropUnique(['from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number']);
  });

  await knex.schema.alterTable('dependencies', (table) => {
    table.unique(['from_symbol_id', 'to_symbol_id', 'dependency_type']);
  });
}