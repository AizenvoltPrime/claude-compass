import type { Knex } from 'knex';

/**
 * Phase 7 Migration: C# and Godot Support
 * Adds performance indexes for C# and Godot entity types
 *
 * New SymbolType values supported:
 * - godot_scene, godot_node, godot_script, godot_autoload, godot_resource
 *
 * New DependencyType values supported:
 * - scene_reference, node_child, signal_connection, script_attachment
 *
 * New FrameworkType values supported:
 * - godot
 */
export async function up(knex: Knex): Promise<void> {
  // Add indexes for Godot symbol types to optimize queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_symbols_godot_type
    ON symbols(symbol_type) WHERE symbol_type IN (
      'godot_scene', 'godot_node', 'godot_script', 'godot_autoload', 'godot_resource'
    );
  `);

  // Add indexes for Godot dependency types to optimize relationship queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_dependencies_godot_type
    ON dependencies(dependency_type) WHERE dependency_type IN (
      'scene_reference', 'node_child', 'signal_connection', 'script_attachment'
    );
  `);

  // Add index for C# file extensions to optimize parser selection
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_files_csharp
    ON files(path) WHERE path LIKE '%.cs';
  `);

  // Add index for Godot scene files to optimize scene parsing
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_files_godot_scenes
    ON files(path) WHERE path LIKE '%.tscn';
  `);

  // Add index for Godot project files
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_files_godot_project
    ON files(path) WHERE path LIKE '%project.godot';
  `);

  // Add composite index for Godot framework queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_symbols_godot_composite
    ON symbols(file_id, symbol_type, is_exported)
    WHERE symbol_type LIKE 'godot_%';
  `);

  // Add index for C# namespace symbols
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_symbols_csharp_namespace
    ON symbols(symbol_type, name) WHERE symbol_type = 'namespace';
  `);

  // Performance indexes for framework metadata queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_framework_metadata_godot
    ON framework_metadata(repo_id, framework_type) WHERE framework_type = 'godot';
  `);

  console.log('Phase 7: Added C# and Godot support indexes');
}

export async function down(knex: Knex): Promise<void> {
  // Drop indexes in reverse order
  await knex.raw('DROP INDEX IF EXISTS idx_framework_metadata_godot;');
  await knex.raw('DROP INDEX IF EXISTS idx_symbols_csharp_namespace;');
  await knex.raw('DROP INDEX IF EXISTS idx_symbols_godot_composite;');
  await knex.raw('DROP INDEX IF EXISTS idx_files_godot_project;');
  await knex.raw('DROP INDEX IF EXISTS idx_files_godot_scenes;');
  await knex.raw('DROP INDEX IF EXISTS idx_files_csharp;');
  await knex.raw('DROP INDEX IF EXISTS idx_dependencies_godot_type;');
  await knex.raw('DROP INDEX IF EXISTS idx_symbols_godot_type;');

  console.log('Phase 7: Removed C# and Godot support indexes');
}