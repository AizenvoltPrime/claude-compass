import type { Knex } from 'knex';

/**
 * Migration 004: Background Job Systems
 *
 * Creates background job and worker thread support tables.
 * Consolidates: Original migration 007
 *
 * Features:
 * - Job queues for queue definitions (Bull, BullMQ, Agenda, Bee, Kue)
 * - Job definitions for individual job configurations
 * - Worker threads for Node.js worker thread patterns
 * - Enhanced transitive analysis indexes
 */
export async function up(knex: Knex): Promise<void> {
  console.log('Creating background job systems tables...');

  // Create job_queues table for background job queue definitions
  await knex.schema.createTable('job_queues', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.string('name').notNullable(); // queue name (e.g., 'email-queue', 'image-processing')
    table.string('queue_type').notNullable(); // 'bull', 'bullmq', 'agenda', 'bee', 'kue'
    table.integer('symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.jsonb('config_data').defaultTo('{}'); // queue configuration options
    table.jsonb('redis_config').nullable(); // Redis connection configuration
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'queue_type']);
    table.index(['repo_id', 'name']);
    table.index(['queue_type']);
    table.index(['symbol_id']);

    // Ensure unique queue name per repository
    table.unique(['repo_id', 'name']);
  });

  // Create job_definitions table for individual background job definitions
  await knex.schema.createTable('job_definitions', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('queue_id').notNullable().references('id').inTable('job_queues').onDelete('CASCADE');
    table.string('job_name').notNullable(); // job identifier (e.g., 'send-email', 'process-image')
    table.integer('handler_symbol_id').notNullable().references('id').inTable('symbols').onDelete('CASCADE');
    table.string('schedule_pattern').nullable(); // cron pattern for scheduled jobs
    table.integer('concurrency').defaultTo(1); // concurrent job processing limit
    table.integer('retry_attempts').defaultTo(3); // number of retry attempts
    table.jsonb('job_options').defaultTo('{}'); // job-specific options (delay, priority, etc.)
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'job_name']);
    table.index(['queue_id', 'job_name']);
    table.index(['handler_symbol_id']);
    table.index(['schedule_pattern']);
    table.index(['queue_id']);

    // Ensure unique job name per queue
    table.unique(['queue_id', 'job_name']);
  });

  // Create worker_threads table for Node.js worker thread patterns
  await knex.schema.createTable('worker_threads', (table) => {
    table.increments('id').primary();
    table.integer('repo_id').notNullable().references('id').inTable('repositories').onDelete('CASCADE');
    table.integer('worker_file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    table.integer('parent_symbol_id').references('id').inTable('symbols').onDelete('CASCADE');
    table.string('worker_type').notNullable(); // 'worker_threads', 'cluster', 'child_process'
    table.jsonb('data_schema').nullable(); // expected data structure for worker communication
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['repo_id', 'worker_type']);
    table.index(['worker_file_id']);
    table.index(['parent_symbol_id']);
    table.index(['worker_type']);
    table.index(['repo_id']);
  });

  // Add enhanced transitive analysis indexes
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_dependencies_transitive
    ON dependencies(from_symbol_id, dependency_type, confidence)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_dependencies_reverse_transitive
    ON dependencies(to_symbol_id, dependency_type, confidence)
  `);

  console.log('Background job systems tables created successfully');
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing background job systems tables...');

  // Drop enhanced indexes first
  await knex.raw('DROP INDEX IF EXISTS idx_dependencies_reverse_transitive');
  await knex.raw('DROP INDEX IF EXISTS idx_dependencies_transitive');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('worker_threads');
  await knex.schema.dropTableIfExists('job_definitions');
  await knex.schema.dropTableIfExists('job_queues');

  console.log('Background job systems tables removed successfully');
}