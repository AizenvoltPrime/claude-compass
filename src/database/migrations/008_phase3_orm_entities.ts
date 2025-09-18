import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create orm_entities table for database entity models
  await knex.schema.createTable('orm_entities', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('entity_name').notNullable(); // User, Post, Comment
    table.string('table_name').nullable(); // users, posts, comments (database table name)
    table.string('orm_type').notNullable(); // 'prisma', 'typeorm', 'sequelize', 'mongoose'
    table.integer('schema_file_id').references('id').inTable('files').onDelete('SET NULL');
    table.jsonb('fields').defaultTo('{}'); // field definitions with types
    table.jsonb('indexes').defaultTo('[]'); // database indexes definition
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'orm_type']);
    table.index(['repo_id', 'entity_name']);
    table.index(['symbol_id']);
    table.index(['orm_type']);
    table.index(['table_name']);
    table.index(['schema_file_id']);

    // Ensure unique entity name per repository and ORM type
    table.unique(['repo_id', 'entity_name', 'orm_type']);
  });

  // Create orm_relationships table for entity relationships (foreign keys, associations)
  await knex.schema.createTable('orm_relationships', (table) => {
    table.increments('id').primary();
    table.integer('from_entity_id').notNullable().references('id').inTable('orm_entities').onDelete('CASCADE');
    table.integer('to_entity_id').notNullable().references('id').inTable('orm_entities').onDelete('CASCADE');
    table.string('relationship_type').notNullable(); // 'has_many', 'belongs_to', 'has_one', 'many_to_many'
    table.string('foreign_key').nullable(); // Foreign key column name
    table.string('through_table').nullable(); // Junction table for many-to-many relationships
    table.integer('inverse_relationship_id').references('id').inTable('orm_relationships').onDelete('SET NULL');
    table.float('confidence').defaultTo(1.0); // Confidence score for relationship detection
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['from_entity_id', 'relationship_type']);
    table.index(['to_entity_id', 'relationship_type']);
    table.index(['relationship_type']);
    table.index(['foreign_key']);
    table.index(['through_table']);
    table.index(['inverse_relationship_id']);

    // Prevent duplicate relationships
    table.unique(['from_entity_id', 'to_entity_id', 'relationship_type']);
  });

  // Create orm_repositories table for ORM repositories and service patterns
  await knex.schema.createTable('orm_repositories', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.integer('entity_id').notNullable().references('id').inTable('orm_entities').onDelete('CASCADE');
    table.string('repository_type').notNullable(); // 'typeorm_repository', 'prisma_service', 'sequelize_model', 'custom_repository'
    table.jsonb('methods').defaultTo('[]'); // available repository methods (find, create, update, delete, etc.)
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'repository_type']);
    table.index(['symbol_id']);
    table.index(['entity_id']);
    table.index(['repository_type']);

    // Ensure unique repository per entity
    table.unique(['symbol_id', 'entity_id']);
  });

  // Add new indexes for improved ORM relationship queries
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_orm_relationships_entity
    ON orm_relationships(from_entity_id, relationship_type);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_orm_relationships_reverse_entity
    ON orm_relationships(to_entity_id, relationship_type);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop indexes first
  await knex.schema.raw('DROP INDEX IF EXISTS idx_orm_relationships_reverse_entity;');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_orm_relationships_entity;');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('orm_repositories');
  await knex.schema.dropTableIfExists('orm_relationships');
  await knex.schema.dropTableIfExists('orm_entities');
}