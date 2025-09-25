/**
 * Phase 2: Prepare confidence removal migration
 *
 * This migration prepares the database for confidence column removal by:
 * 1. Adding deprecation comments to confidence columns
 * 2. Creating optimized indexes for full-table queries
 * 3. Preparing for the "Return Everything, Let AI Decide" approach
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  console.log('🔧 Phase 2: Preparing database for confidence removal...');

  // Add deprecation comments to confidence columns
  // This documents that these columns will be removed in Phase 6
  await knex.raw(`
    COMMENT ON COLUMN dependencies.confidence IS 'DEPRECATED: Will be removed in Phase 6 - confidence filtering replaced with AI-based result processing';
  `);

  await knex.raw(`
    COMMENT ON COLUMN file_dependencies.confidence IS 'DEPRECATED: Will be removed in Phase 6 - confidence filtering replaced with AI-based result processing';
  `);

  await knex.raw(`
    COMMENT ON COLUMN api_calls.confidence IS 'DEPRECATED: Will be removed in Phase 6 - confidence filtering replaced with AI-based result processing';
  `);

  await knex.raw(`
    COMMENT ON COLUMN data_contracts.confidence IS 'DEPRECATED: Will be removed in Phase 6 - confidence filtering replaced with AI-based result processing';
  `);

  // Optimize existing indexes for full-table queries (no confidence filtering)
  // Focus on dependency_type and symbol lookups since we'll return everything

  console.log('   • Creating optimized indexes for full-table dependency queries...');

  // Enhanced symbol-based indexes for efficient dependency lookups
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS deps_from_symbol_type_idx
    ON dependencies(from_symbol_id, dependency_type);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS deps_to_symbol_type_idx
    ON dependencies(to_symbol_id, dependency_type);
  `);

  // Composite indexes for common query patterns when returning all dependencies
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS deps_symbol_line_idx
    ON dependencies(from_symbol_id, line_number)
    WHERE line_number IS NOT NULL;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS deps_type_symbols_idx
    ON dependencies(dependency_type, from_symbol_id, to_symbol_id);
  `);

  // Cross-stack analysis optimization indexes
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS api_calls_method_pattern_idx
    ON api_calls(http_method, endpoint_path)
    WHERE http_method IS NOT NULL AND endpoint_path IS NOT NULL;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS api_calls_symbol_idx
    ON api_calls(caller_symbol_id, endpoint_symbol_id);
  `);

  // File-level dependency optimization (check if table exists)
  const hasFileDepsTable = await knex.schema.hasTable('file_dependencies');
  if (hasFileDepsTable) {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS file_deps_type_idx
      ON file_dependencies(dependency_type, from_file_id, to_file_id);
    `);
  }

  // Create materialized view for frequently accessed dependency counts
  // This helps with performance monitoring and query optimization
  await knex.raw(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS symbol_dependency_stats AS
    SELECT
      s.id as symbol_id,
      s.name as symbol_name,
      s.symbol_type,
      COUNT(d_out.id) as outgoing_dependencies,
      COUNT(DISTINCT d_out.dependency_type) as outgoing_dependency_types,
      COUNT(d_in.id) as incoming_dependencies,
      COUNT(DISTINCT d_in.dependency_type) as incoming_dependency_types,
      MAX(GREATEST(d_out.created_at, d_in.created_at)) as last_dependency_update
    FROM symbols s
    LEFT JOIN dependencies d_out ON s.id = d_out.from_symbol_id
    LEFT JOIN dependencies d_in ON s.id = d_in.to_symbol_id
    GROUP BY s.id, s.name, s.symbol_type;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS symbol_dependency_stats_pkey
    ON symbol_dependency_stats(symbol_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbol_dependency_stats_type_idx
    ON symbol_dependency_stats(symbol_type, outgoing_dependencies);
  `);

  // Add helper function to refresh materialized view
  await knex.raw(`
    CREATE OR REPLACE FUNCTION refresh_dependency_stats() RETURNS void AS $$
    BEGIN
      REFRESH MATERIALIZED VIEW symbol_dependency_stats;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Add trigger to track when dependencies are modified (for cache invalidation)
  await knex.raw(`
    CREATE OR REPLACE FUNCTION notify_dependency_change() RETURNS trigger AS $$
    BEGIN
      -- Notify cache invalidation system
      PERFORM pg_notify('dependency_changed',
        json_build_object(
          'table', TG_TABLE_NAME,
          'operation', TG_OP,
          'symbol_id', COALESCE(NEW.from_symbol_id, OLD.from_symbol_id),
          'timestamp', extract(epoch from now())
        )::text
      );
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Apply the trigger to key tables
  await knex.raw(`
    DROP TRIGGER IF EXISTS dependencies_change_notify ON dependencies;
    CREATE TRIGGER dependencies_change_notify
      AFTER INSERT OR UPDATE OR DELETE ON dependencies
      FOR EACH ROW EXECUTE FUNCTION notify_dependency_change();
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS api_calls_change_notify ON api_calls;
    CREATE TRIGGER api_calls_change_notify
      AFTER INSERT OR UPDATE OR DELETE ON api_calls
      FOR EACH ROW EXECUTE FUNCTION notify_dependency_change();
  `);

  console.log('   • Database prepared for confidence removal');
  console.log('   • Optimized indexes created for full-table queries');
  console.log('   • Materialized view created for dependency statistics');
  console.log('   • Cache invalidation triggers installed');
}

export async function down(knex: Knex): Promise<void> {
  console.log('🔄 Reversing confidence removal preparation...');

  // Remove triggers
  await knex.raw(`DROP TRIGGER IF EXISTS dependencies_change_notify ON dependencies;`);
  await knex.raw(`DROP TRIGGER IF EXISTS api_calls_change_notify ON api_calls;`);
  await knex.raw(`DROP FUNCTION IF EXISTS notify_dependency_change();`);
  await knex.raw(`DROP FUNCTION IF EXISTS refresh_dependency_stats();`);

  // Remove materialized view
  await knex.raw(`DROP MATERIALIZED VIEW IF EXISTS symbol_dependency_stats;`);

  // Remove optimized indexes
  await knex.raw(`DROP INDEX IF EXISTS deps_from_symbol_type_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS deps_to_symbol_type_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS deps_symbol_line_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS deps_type_symbols_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS api_calls_method_pattern_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS api_calls_symbol_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS file_deps_type_idx;`);

  // Remove comments (PostgreSQL doesn't have a direct way to remove comments, so we set them to NULL)
  await knex.raw(`COMMENT ON COLUMN dependencies.confidence IS NULL;`);
  await knex.raw(`COMMENT ON COLUMN file_dependencies.confidence IS NULL;`);
  await knex.raw(`COMMENT ON COLUMN api_calls.confidence IS NULL;`);
  await knex.raw(`COMMENT ON COLUMN data_contracts.confidence IS NULL;`);

  console.log('   • Confidence removal preparation reverted');
}