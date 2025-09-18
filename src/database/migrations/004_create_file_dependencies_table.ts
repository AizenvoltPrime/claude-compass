import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create file_dependencies table for file-to-file relationships (imports, requires, etc.)
  await knex.schema.createTable('file_dependencies', (table) => {
    table.increments('id').primary();
    table.integer('from_file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.integer('to_file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.string('dependency_type').notNullable(); // 'imports', 'requires', 'includes', etc.
    table.integer('line_number');
    table.float('confidence').defaultTo(1.0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Indexes for performance
    table.index(['from_file_id']);
    table.index(['to_file_id']);
    table.index(['dependency_type']);
    table.index(['from_file_id', 'dependency_type']);
    table.index(['to_file_id', 'dependency_type']);

    // Unique constraint to prevent duplicate dependencies
    table.unique(['from_file_id', 'to_file_id', 'dependency_type']);
  });

}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('file_dependencies');
}