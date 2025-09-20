import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  console.log('Adding Phase 6 vector search capabilities...');

  // Enable pgvector extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');

  // Add vector and full-text search columns to symbols table
  await knex.schema.alterTable('symbols', (table) => {
    // Vector embeddings for semantic search (384 dimensions for sentence-transformers/all-MiniLM-L6-v2)
    table.specificType('name_embedding', 'vector(384)').nullable();
    table.specificType('description_embedding', 'vector(384)').nullable();

    // Full-text search vector
    table.specificType('search_vector', 'tsvector').nullable();

    // Search metadata
    table.timestamp('embeddings_updated_at').nullable();
    table.string('embedding_model', 100).nullable().defaultTo('all-MiniLM-L6-v2');
  });

  // Create vector similarity indexes using IVFFlat algorithm
  // Note: CONCURRENTLY can't be used in transactions, so we'll create them normally
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_name_embedding_idx
    ON symbols USING ivfflat (name_embedding vector_cosine_ops)
    WITH (lists = 100)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_description_embedding_idx
    ON symbols USING ivfflat (description_embedding vector_cosine_ops)
    WITH (lists = 100)
  `);

  // Create full-text search index
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_search_vector_idx
    ON symbols USING gin(search_vector)
  `);

  // Create composite index for hybrid search performance
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_hybrid_search_idx
    ON symbols (symbol_type, is_exported, file_id)
    WHERE search_vector IS NOT NULL
  `);

  // Create function to update search_vector automatically
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_symbols_search_vector()
    RETURNS trigger AS $$
    BEGIN
      NEW.search_vector := to_tsvector('english',
        COALESCE(NEW.name, '') || ' ' ||
        COALESCE(NEW.description, '') || ' ' ||
        COALESCE(NEW.signature, '')
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create trigger to automatically update search_vector on insert/update
  await knex.raw(`
    DROP TRIGGER IF EXISTS symbols_search_vector_update ON symbols;
    CREATE TRIGGER symbols_search_vector_update
      BEFORE INSERT OR UPDATE ON symbols
      FOR EACH ROW EXECUTE FUNCTION update_symbols_search_vector();
  `);

  // Create function for hybrid search ranking
  await knex.raw(`
    CREATE OR REPLACE FUNCTION calculate_hybrid_rank(
      lexical_rank FLOAT DEFAULT 0,
      vector_similarity FLOAT DEFAULT 0,
      fulltext_rank FLOAT DEFAULT 0,
      weights FLOAT[] DEFAULT ARRAY[0.3, 0.4, 0.3]
    ) RETURNS FLOAT AS $$
    BEGIN
      RETURN (
        COALESCE(lexical_rank, 0) * weights[1] +
        COALESCE(vector_similarity, 0) * weights[2] +
        COALESCE(fulltext_rank, 0) * weights[3]
      );
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);

  console.log('Phase 6 vector search capabilities added successfully');
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing Phase 6 vector search capabilities...');

  // Drop triggers and functions
  await knex.raw('DROP TRIGGER IF EXISTS symbols_search_vector_update ON symbols');
  await knex.raw('DROP FUNCTION IF EXISTS update_symbols_search_vector()');
  await knex.raw('DROP FUNCTION IF EXISTS calculate_hybrid_rank(FLOAT, FLOAT, FLOAT, FLOAT[])');

  // Drop indexes
  await knex.raw('DROP INDEX IF EXISTS symbols_hybrid_search_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_search_vector_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_description_embedding_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_name_embedding_idx');

  // Remove columns from symbols table
  await knex.schema.alterTable('symbols', (table) => {
    table.dropColumn('embedding_model');
    table.dropColumn('embeddings_updated_at');
    table.dropColumn('search_vector');
    table.dropColumn('description_embedding');
    table.dropColumn('name_embedding');
  });

  // Note: We don't drop the vector extension as it might be used by other applications
  console.log('Phase 6 vector search capabilities removed successfully');
}