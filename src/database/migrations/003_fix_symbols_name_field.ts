import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Change the name field from varchar(255) to text to allow longer symbol names
  await knex.schema.alterTable('symbols', (table) => {
    table.text('name').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Revert back to varchar(255) - this may truncate data if names are longer than 255 chars
  await knex.schema.alterTable('symbols', (table) => {
    table.string('name').notNullable().alter();
  });
}