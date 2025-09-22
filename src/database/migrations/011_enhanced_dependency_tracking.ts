import type { Knex } from 'knex';

/**
 * Migration 011: Enhanced Dependency Tracking
 *
 * Adds advanced C# and parameter context tracking to dependencies table.
 * Consolidates: Original migrations 016, 017, 018
 *
 * Features:
 * - C# Context Fields: calling_object, resolved_class, qualified_context, method_signature, file_context, namespace_context
 * - Parameter Context Fields: parameter_context, call_instance_id, parameter_types
 * - Fixed Unique Constraint: includes line_number to allow multiple calls between same symbols
 * - Comprehensive indexing for enhanced context queries
 *
 * CRITICAL FIX: Applies proper unique constraint from the beginning,
 * avoiding the three-step evolution of the dependencies table.
 */
export async function up(knex: Knex): Promise<void> {
  console.log('Adding enhanced dependency tracking capabilities...');

  // Add C# context fields from original migration 016
  await knex.schema.alterTable('dependencies', (table) => {
    table.string('calling_object', 255).nullable().comment('Calling object name (e.g., "_cardManager", "this.service")');
    table.string('resolved_class', 255).nullable().comment('Resolved class name (e.g., "CardManager", "UserService")');
    table.string('qualified_context', 500).nullable().comment('Qualified method context (e.g., "CardManager.SetHandPositions")');
    table.text('method_signature').nullable().comment('Full method signature with parameters');
    table.string('file_context', 500).nullable().comment('File path for cross-file analysis');
    table.string('namespace_context', 255).nullable().comment('C# namespace information');
  });

  // Add parameter context fields from original migration 017
  await knex.schema.alterTable('dependencies', (table) => {
    table.text('parameter_context').nullable().comment('Parameter expressions at call site');
    table.uuid('call_instance_id').nullable().comment('UUID to distinguish multiple calls between same symbols');
    table.text('parameter_types').nullable().comment('Parameter type information');
  });

  // CRITICAL FIX: Drop the old unique constraint and create the new one from migration 018
  // This includes line_number to allow multiple calls between same symbols
  await knex.schema.alterTable('dependencies', (table) => {
    table.dropUnique(['from_symbol_id', 'to_symbol_id', 'dependency_type']);
  });

  await knex.schema.alterTable('dependencies', (table) => {
    table.unique(['from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number'], 'deps_unique_with_line');
  });

  // Add comprehensive indexes for enhanced context queries
  await knex.schema.alterTable('dependencies', (table) => {
    table.index(['qualified_context'], 'idx_dependencies_qualified_context');
    table.index(['resolved_class'], 'idx_dependencies_resolved_class');
    table.index(['calling_object'], 'idx_dependencies_calling_object');
    table.index(['call_instance_id'], 'idx_dependencies_call_instance');
    table.index(['namespace_context'], 'idx_dependencies_namespace');
    table.index(['file_context'], 'idx_dependencies_file_context');
  });

  // Add specialized indexes for C# dependency analysis
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_dependencies_csharp_context
    ON dependencies(resolved_class, qualified_context)
    WHERE resolved_class IS NOT NULL
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_dependencies_parameter_calls
    ON dependencies(from_symbol_id, parameter_context)
    WHERE parameter_context IS NOT NULL
  `);

  // Add index for object-oriented context tracking
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_dependencies_object_method
    ON dependencies(calling_object, method_signature)
    WHERE calling_object IS NOT NULL
  `);

  console.log('Enhanced dependency tracking capabilities added successfully');
  console.log('Dependencies table evolution completed: 4 migrations -> 1 comprehensive structure');
}

export async function down(knex: Knex): Promise<void> {
  console.log('Removing enhanced dependency tracking capabilities...');

  // Drop specialized indexes first
  await knex.raw('DROP INDEX IF EXISTS idx_dependencies_object_method');
  await knex.raw('DROP INDEX IF EXISTS idx_dependencies_parameter_calls');
  await knex.raw('DROP INDEX IF EXISTS idx_dependencies_csharp_context');

  // Drop enhanced context indexes
  await knex.schema.alterTable('dependencies', (table) => {
    table.dropIndex(['qualified_context'], 'idx_dependencies_qualified_context');
    table.dropIndex(['resolved_class'], 'idx_dependencies_resolved_class');
    table.dropIndex(['calling_object'], 'idx_dependencies_calling_object');
    table.dropIndex(['call_instance_id'], 'idx_dependencies_call_instance');
    table.dropIndex(['namespace_context'], 'idx_dependencies_namespace');
    table.dropIndex(['file_context'], 'idx_dependencies_file_context');
  });

  // Revert unique constraint to original form
  await knex.schema.alterTable('dependencies', (table) => {
    table.dropUnique(['from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number'], 'deps_unique_with_line');
  });

  await knex.schema.alterTable('dependencies', (table) => {
    table.unique(['from_symbol_id', 'to_symbol_id', 'dependency_type']);
  });

  // Remove enhanced context columns
  await knex.schema.alterTable('dependencies', (table) => {
    // Parameter context fields (from migration 017)
    table.dropColumn('parameter_types');
    table.dropColumn('call_instance_id');
    table.dropColumn('parameter_context');

    // C# context fields (from migration 016)
    table.dropColumn('namespace_context');
    table.dropColumn('file_context');
    table.dropColumn('method_signature');
    table.dropColumn('qualified_context');
    table.dropColumn('resolved_class');
    table.dropColumn('calling_object');
  });

  console.log('Enhanced dependency tracking capabilities removed successfully');
}