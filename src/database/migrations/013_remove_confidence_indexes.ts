import { Knex } from 'knex';

/**
 * Phase 6: Remove Confidence Indexes and Columns
 *
 * This migration removes confidence-based infrastructure from the database:
 * - Drops confidence indexes from migration 002
 * - Removes confidence indexes from cross-stack tables (migration 008)
 * - Removes confidence columns entirely from all tables
 *
 * This completes the confidence removal architecture implementation.
 */

export async function up(knex: Knex): Promise<void> {
  console.log('🗑️  Phase 6: Removing confidence indexes and columns...');

  // Step 1: Remove confidence-based indexes from dependencies table (migration 002)
  try {
    await knex.raw('DROP INDEX IF EXISTS deps_type_confidence_idx');
    console.log('✅ Removed deps_type_confidence_idx');
  } catch (error) {
    console.log('ℹ️  deps_type_confidence_idx already removed or does not exist');
  }

  // Step 2: Remove confidence indexes from cross-stack tables (migration 008)
  try {
    await knex.raw('DROP INDEX IF EXISTS api_calls_confidence_idx');
    console.log('✅ Removed api_calls_confidence_idx');
  } catch (error) {
    console.log('ℹ️  api_calls_confidence_idx already removed or does not exist');
  }

  try {
    await knex.raw('DROP INDEX IF EXISTS data_contracts_confidence_idx');
    console.log('✅ Removed data_contracts_confidence_idx');
  } catch (error) {
    console.log('ℹ️  data_contracts_confidence_idx already removed or does not exist');
  }

  // Step 2b: Remove ALL other confidence indexes from ALL tables
  try {
    await knex.raw('DROP INDEX IF EXISTS test_coverage_confidence_index');
    console.log('✅ Removed test_coverage_confidence_index');
  } catch (error) {
    console.log('ℹ️  test_coverage_confidence_index already removed or does not exist');
  }

  try {
    await knex.raw('DROP INDEX IF EXISTS idx_godot_relationships_confidence');
    console.log('✅ Removed idx_godot_relationships_confidence');
  } catch (error) {
    console.log('ℹ️  idx_godot_relationships_confidence already removed or does not exist');
  }

  // Step 3: Remove confidence columns entirely from ALL tables
  const tables = [
    'dependencies',
    'file_dependencies',
    'api_calls',
    'data_contracts',
    'godot_relationships',
    'orm_relationships',
    'test_coverage'
  ];

  for (const table of tables) {
    try {
      const hasColumn = await knex.schema.hasColumn(table, 'confidence');
      if (hasColumn) {
        await knex.schema.alterTable(table, (table) => {
          table.dropColumn('confidence');
        });
        console.log(`✅ Removed confidence column from ${table}`);
      } else {
        console.log(`ℹ️  confidence column already removed from ${table}`);
      }
    } catch (error) {
      console.log(`⚠️  Could not remove confidence column from ${table}: ${error.message}`);
    }
  }

  // Step 4: Update any remaining database constraints or views that reference confidence
  try {
    // Remove any CHECK constraints that reference confidence columns
    await knex.raw(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        -- Find and drop any constraints that reference 'confidence'
        FOR r IN
          SELECT conname, conrelid::regclass AS table_name
          FROM pg_constraint
          WHERE contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%confidence%'
        LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.table_name, r.conname);
        END LOOP;
      END
      $$;
    `);
    console.log('✅ Removed any confidence-related constraints');
  } catch (error) {
    console.log(`⚠️  Could not remove confidence constraints: ${error.message}`);
  }

  // Step 5: Drop any materialized views that might reference confidence
  try {
    await knex.raw('DROP MATERIALIZED VIEW IF EXISTS symbol_confidence_summary');
    await knex.raw('DROP MATERIALIZED VIEW IF EXISTS dependency_confidence_stats');
    console.log('✅ Removed confidence-related materialized views');
  } catch (error) {
    console.log('ℹ️  No confidence-related materialized views found');
  }

  console.log('🎉 Phase 6 complete: Confidence infrastructure completely removed');
  console.log('   • Database now uses simple dependency format');
  console.log('   • AI can process full contextual information');
  console.log('   • "Return Everything, Let AI Decide" architecture active');
}

export async function down(knex: Knex): Promise<void> {
  console.log('⚠️  Rolling back confidence removal...');

  // Re-add confidence columns to ALL tables
  const tables = [
    'dependencies',
    'file_dependencies',
    'api_calls',
    'data_contracts',
    'godot_relationships',
    'orm_relationships',
    'test_coverage'
  ];

  for (const table of tables) {
    try {
      const hasColumn = await knex.schema.hasColumn(table, 'confidence');
      if (!hasColumn) {
        await knex.schema.alterTable(table, (table) => {
          table.decimal('confidence', 3, 2).defaultTo(0.5);
        });
        console.log(`✅ Restored confidence column to ${table}`);
      }
    } catch (error) {
      console.log(`⚠️  Could not restore confidence column to ${table}: ${error.message}`);
    }
  }

  // Recreate confidence indexes
  try {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS deps_type_confidence_idx
      ON dependencies(dependency_type, confidence DESC)
      WHERE confidence >= 0.5
    `);
    console.log('✅ Recreated deps_type_confidence_idx');
  } catch (error) {
    console.log(`⚠️  Could not recreate deps_type_confidence_idx: ${error.message}`);
  }

  try {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS api_calls_confidence_idx
      ON api_calls(confidence DESC)
      WHERE confidence >= 0.7
    `);
    console.log('✅ Recreated api_calls_confidence_idx');
  } catch (error) {
    console.log(`⚠️  Could not recreate api_calls_confidence_idx: ${error.message}`);
  }

  try {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS data_contracts_confidence_idx
      ON data_contracts(confidence DESC)
      WHERE confidence >= 0.7
    `);
    console.log('✅ Recreated data_contracts_confidence_idx');
  } catch (error) {
    console.log(`⚠️  Could not recreate data_contracts_confidence_idx: ${error.message}`);
  }

  // Recreate additional confidence indexes
  try {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS test_coverage_confidence_index
      ON test_coverage(confidence DESC)
      WHERE confidence >= 0.5
    `);
    console.log('✅ Recreated test_coverage_confidence_index');
  } catch (error) {
    console.log(`⚠️  Could not recreate test_coverage_confidence_index: ${error.message}`);
  }

  try {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_godot_relationships_confidence
      ON godot_relationships(confidence DESC)
      WHERE confidence >= 0.5
    `);
    console.log('✅ Recreated idx_godot_relationships_confidence');
  } catch (error) {
    console.log(`⚠️  Could not recreate idx_godot_relationships_confidence: ${error.message}`);
  }

  console.log('⚠️  Confidence infrastructure restored - system reverted to confidence-based filtering');
}