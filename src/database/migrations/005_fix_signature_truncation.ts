import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add a comment to document that signatures are now stored without truncation
  await knex.raw(`
    COMMENT ON COLUMN symbols.signature IS
    'Full function/method signature including complete implementation. No truncation applied as of migration 005.'
  `);

  // Note: We don't attempt to recover truncated signatures as they would need to be re-parsed
  // from source. The next repository re-analysis will capture full signatures.
}

export async function down(knex: Knex): Promise<void> {
  // Remove the comment
  await knex.raw(`
    COMMENT ON COLUMN symbols.signature IS NULL
  `);
}