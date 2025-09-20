import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  console.log('Adding description column to symbols table...');

  // Check if description column already exists
  const hasDescriptionColumn = await knex.schema.hasColumn('symbols', 'description');

  if (!hasDescriptionColumn) {
    // Add description column to symbols table
    await knex.schema.alterTable('symbols', (table) => {
      table.text('description').nullable();
    });
    console.log('Description column added successfully');
  } else {
    console.log('Description column already exists, skipping...');
  }
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing description column from symbols table...');

  // Remove description column from symbols table
  await knex.schema.alterTable('symbols', (table) => {
    table.dropColumn('description');
  });

  console.log('Description column removed successfully');
}