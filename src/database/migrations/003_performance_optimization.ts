import type { Knex } from 'knex';

/**
 * Migration 003: Consolidated Performance Optimization
 *
 * Creates all performance optimizations, indexes, materialized views,
 * and advanced features in final form.
 * Consolidates the optimization features from migrations 012+ into clean implementation.
 *
 * Features:
 * - Full-text search with trigram support
 * - Materialized views for dependency statistics
 * - Cache invalidation triggers
 * - Optimized indexes for all query patterns
 * - Performance monitoring functions
 */
export async function up(knex: Knex): Promise<void> {
  console.log('⚡ Creating performance optimizations...');

  // Enable required extensions for advanced search
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gin');

  // === FULL-TEXT SEARCH INDEXES ===

  // Full-text search on symbol names with trigram support
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_name_trigram_idx
    ON symbols USING gin (name gin_trgm_ops)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_signature_trigram_idx
    ON symbols USING gin (signature gin_trgm_ops)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS files_path_trigram_idx
    ON files USING gin (path gin_trgm_ops)
  `);

  // === COMPOSITE INDEXES FOR COMPLEX QUERIES ===

  // Repository analysis indexes
  await knex.schema.table('repositories', (table) => {
    table.index(['language_primary', 'last_indexed']);
  });

  // Multi-column indexes for common query patterns
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbols_repo_type_exported_idx
    ON symbols(symbol_type, is_exported)
    INCLUDE (file_id, name)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS dependencies_full_context_idx
    ON dependencies(dependency_type, from_symbol_id, to_symbol_id)
    INCLUDE (line_number, raw_text)
  `);

  // === MATERIALIZED VIEWS FOR PERFORMANCE ===

  // Materialized view for frequently accessed dependency counts
  await knex.raw(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS symbol_dependency_stats AS
    SELECT
      s.id as symbol_id,
      s.name as symbol_name,
      s.symbol_type,
      s.file_id,
      f.repo_id,
      COUNT(d_out.id) as outgoing_dependencies,
      COUNT(DISTINCT d_out.dependency_type) as outgoing_dependency_types,
      COUNT(d_in.id) as incoming_dependencies,
      COUNT(DISTINCT d_in.dependency_type) as incoming_dependency_types,
      MAX(GREATEST(d_out.created_at, d_in.created_at, s.updated_at)) as last_dependency_update
    FROM symbols s
    INNER JOIN files f ON s.file_id = f.id
    LEFT JOIN dependencies d_out ON s.id = d_out.from_symbol_id
    LEFT JOIN dependencies d_in ON s.id = d_in.to_symbol_id
    GROUP BY s.id, s.name, s.symbol_type, s.file_id, f.repo_id
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS symbol_dependency_stats_pkey
    ON symbol_dependency_stats(symbol_id)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS symbol_dependency_stats_repo_type_idx
    ON symbol_dependency_stats(repo_id, symbol_type, outgoing_dependencies DESC)
  `);

  // Repository summary view
  await knex.raw(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS repository_stats AS
    SELECT
      r.id as repo_id,
      r.name as repo_name,
      r.language_primary,
      r.framework_stack,
      COUNT(DISTINCT f.id) as total_files,
      COUNT(DISTINCT s.id) as total_symbols,
      COUNT(DISTINCT d.id) as total_dependencies,
      COUNT(DISTINCT csc.id) as cross_stack_calls,
      MAX(r.last_indexed) as last_indexed,
      COUNT(DISTINCT f.id) FILTER (WHERE f.is_test = true) as test_files,
      COUNT(DISTINCT s.id) FILTER (WHERE s.symbol_type = 'function') as functions,
      COUNT(DISTINCT s.id) FILTER (WHERE s.symbol_type = 'class') as classes
    FROM repositories r
    LEFT JOIN files f ON r.id = f.repo_id
    LEFT JOIN symbols s ON f.id = s.file_id
    LEFT JOIN dependencies d ON s.id = d.from_symbol_id
    LEFT JOIN cross_stack_calls csc ON r.id = csc.repo_id
    GROUP BY r.id, r.name, r.language_primary, r.framework_stack
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS repository_stats_pkey
    ON repository_stats(repo_id)
  `);

  // === CACHE INVALIDATION AND TRIGGERS ===

  // Helper function to refresh materialized views
  await knex.raw(`
    CREATE OR REPLACE FUNCTION refresh_dependency_stats() RETURNS void AS $$
    BEGIN
      REFRESH MATERIALIZED VIEW CONCURRENTLY symbol_dependency_stats;
      REFRESH MATERIALIZED VIEW CONCURRENTLY repository_stats;
    END;
    $$ LANGUAGE plpgsql
  `);

  // Function to notify cache invalidation
  await knex.raw(`
    CREATE OR REPLACE FUNCTION notify_dependency_change() RETURNS trigger AS $$
    BEGIN
      -- Notify cache invalidation system with the appropriate symbol_id field
      IF TG_TABLE_NAME = 'api_calls' THEN
        PERFORM pg_notify('dependency_changed',
          json_build_object(
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'symbol_id', COALESCE(NEW.caller_symbol_id, OLD.caller_symbol_id),
            'timestamp', extract(epoch from now())
          )::text
        );
      ELSIF TG_TABLE_NAME = 'cross_stack_calls' THEN
        PERFORM pg_notify('dependency_changed',
          json_build_object(
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'symbol_id', COALESCE(NEW.frontend_symbol_id, OLD.frontend_symbol_id),
            'timestamp', extract(epoch from now())
          )::text
        );
      ELSE
        -- For dependencies table and others that use from_symbol_id
        PERFORM pg_notify('dependency_changed',
          json_build_object(
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'symbol_id', COALESCE(NEW.from_symbol_id, OLD.from_symbol_id),
            'timestamp', extract(epoch from now())
          )::text
        );
      END IF;

      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql
  `);

  // Apply cache invalidation triggers to key tables
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

  await knex.raw(`
    DROP TRIGGER IF EXISTS cross_stack_calls_change_notify ON cross_stack_calls;
    CREATE TRIGGER cross_stack_calls_change_notify
      AFTER INSERT OR UPDATE OR DELETE ON cross_stack_calls
      FOR EACH ROW EXECUTE FUNCTION notify_dependency_change();
  `);

  // === PERFORMANCE MONITORING FUNCTIONS ===

  // Function to get dependency analysis performance stats
  await knex.raw(`
    CREATE OR REPLACE FUNCTION get_dependency_stats(repo_id_param INTEGER DEFAULT NULL)
    RETURNS TABLE (
      metric_name TEXT,
      metric_value BIGINT,
      repo_id INTEGER
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        'total_symbols'::text, COUNT(*)::bigint, f.repo_id
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE repo_id_param IS NULL OR f.repo_id = repo_id_param
      GROUP BY f.repo_id

      UNION ALL

      SELECT
        'total_dependencies'::text, COUNT(*)::bigint, f.repo_id
      FROM dependencies d
      JOIN symbols s ON d.from_symbol_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE repo_id_param IS NULL OR f.repo_id = repo_id_param
      GROUP BY f.repo_id

      UNION ALL

      SELECT
        'cross_stack_calls'::text, COUNT(*)::bigint, csc.repo_id
      FROM cross_stack_calls csc
      WHERE repo_id_param IS NULL OR csc.repo_id = repo_id_param
      GROUP BY csc.repo_id;
    END;
    $$ LANGUAGE plpgsql
  `);

  console.log('✅ Performance optimizations created');
  console.log('   • Full-text search indexes with trigram support');
  console.log('   • Materialized views for dependency statistics');
  console.log('   • Cache invalidation triggers for real-time updates');
  console.log('   • Performance monitoring functions');
}

export async function down(knex: Knex): Promise<void> {
  console.log('🗑️  Removing performance optimizations...');

  // Remove triggers
  await knex.raw('DROP TRIGGER IF EXISTS dependencies_change_notify ON dependencies');
  await knex.raw('DROP TRIGGER IF EXISTS api_calls_change_notify ON api_calls');
  await knex.raw('DROP TRIGGER IF EXISTS cross_stack_calls_change_notify ON cross_stack_calls');

  // Remove functions
  await knex.raw('DROP FUNCTION IF EXISTS notify_dependency_change()');
  await knex.raw('DROP FUNCTION IF EXISTS refresh_dependency_stats()');
  await knex.raw('DROP FUNCTION IF EXISTS get_dependency_stats(INTEGER)');

  // Remove materialized views
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS repository_stats');
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS symbol_dependency_stats');

  // Remove performance indexes (keep essential ones from migration 001 and 002)
  await knex.raw('DROP INDEX IF EXISTS symbols_repo_type_exported_idx');
  await knex.raw('DROP INDEX IF EXISTS dependencies_full_context_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_name_trigram_idx');
  await knex.raw('DROP INDEX IF EXISTS symbols_signature_trigram_idx');
  await knex.raw('DROP INDEX IF EXISTS files_path_trigram_idx');

  console.log('✅ Performance optimizations removed');
}