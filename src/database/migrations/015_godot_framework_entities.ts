import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create godot_scenes table - equivalent to routes/components for other frameworks
  await knex.schema.createTable('godot_scenes', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.string('scene_path', 500).notNullable(); // Full file path to .tscn file
    table.string('scene_name', 255).notNullable(); // Scene name (usually filename without extension)
    table.integer('root_node_id'); // Will be set after nodes are created
    table.integer('node_count').defaultTo(0); // Number of nodes in the scene
    table.boolean('has_script').defaultTo(false); // Whether any nodes have scripts attached
    table.jsonb('metadata').defaultTo('{}'); // Additional scene metadata
    table.timestamps(true, true);

    // Performance indexes
    table.index(['repo_id', 'scene_path'], 'idx_godot_scenes_repo_path');
    table.index(['repo_id'], 'idx_godot_scenes_repo');
    table.index(['scene_name'], 'idx_godot_scenes_name');
    table.index(['has_script'], 'idx_godot_scenes_script');

    // Ensure unique scene paths per repository
    table.unique(['repo_id', 'scene_path'], 'uq_godot_scenes_repo_path');
  });

  // Create godot_nodes table - represents individual nodes within scenes
  await knex.schema.createTable('godot_nodes', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table
      .integer('scene_id')
      .notNullable()
      .references('id')
      .inTable('godot_scenes')
      .onDelete('CASCADE');
    table.string('node_name', 255).notNullable(); // Node name within the scene
    table.string('node_type', 100).notNullable(); // Node type (Node2D, Control, etc.)
    table.integer('parent_node_id').references('id').inTable('godot_nodes').onDelete('SET NULL'); // Parent-child relationships
    table.string('script_path', 500); // Path to attached script file
    table.jsonb('properties').defaultTo('{}'); // Node properties from .tscn
    table.timestamps(true, true);

    // Performance indexes
    table.index(['scene_id', 'node_name'], 'idx_godot_nodes_scene_name');
    table.index(['parent_node_id'], 'idx_godot_nodes_parent');
    table.index(['script_path'], 'idx_godot_nodes_script');
    table.index(['node_type'], 'idx_godot_nodes_type');
    table.index(['repo_id'], 'idx_godot_nodes_repo');

    // Ensure unique node names per scene
    table.unique(['scene_id', 'node_name'], 'uq_godot_nodes_scene_name');
  });

  // Create godot_scripts table - represents C# scripts with Godot-specific features
  await knex.schema.createTable('godot_scripts', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.string('script_path', 500).notNullable(); // Full file path to .cs script
    table.string('class_name', 255).notNullable(); // C# class name
    table.string('base_class', 100); // Godot base class (Node, Control, etc.)
    table.boolean('is_autoload').defaultTo(false); // Whether it's an autoload singleton
    table.jsonb('signals').defaultTo('[]'); // Godot signals defined in script
    table.jsonb('exports').defaultTo('[]'); // [Export] properties
    table.jsonb('metadata').defaultTo('{}'); // Additional script metadata
    table.timestamps(true, true);

    // Performance indexes
    table.index(['repo_id', 'script_path'], 'idx_godot_scripts_repo_path');
    table.index(['class_name'], 'idx_godot_scripts_class');
    table.index(['base_class'], 'idx_godot_scripts_base');
    table.index(['is_autoload'], 'idx_godot_scripts_autoload');
    table.index(['repo_id'], 'idx_godot_scripts_repo');

    // Ensure unique script paths per repository
    table.unique(['repo_id', 'script_path'], 'uq_godot_scripts_repo_path');
  });

  // Create godot_autoloads table - represents singleton scripts defined in project.godot
  await knex.schema.createTable('godot_autoloads', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.string('autoload_name', 255).notNullable(); // Name defined in project.godot
    table.string('script_path', 500).notNullable(); // Path to script file
    table.integer('script_id').references('id').inTable('godot_scripts').onDelete('SET NULL'); // Link to script entity
    table.jsonb('metadata').defaultTo('{}'); // Additional autoload metadata
    table.timestamps(true, true);

    // Performance indexes
    table.index(['repo_id', 'autoload_name'], 'idx_godot_autoloads_repo_name');
    table.index(['script_id'], 'idx_godot_autoloads_script');
    table.index(['repo_id'], 'idx_godot_autoloads_repo');

    // Ensure unique autoload names per repository
    table.unique(['repo_id', 'autoload_name'], 'uq_godot_autoloads_repo_name');
  });

  // Create godot_relationships table - the core of Solution 1: Enhanced Framework Relationships
  await knex.schema.createTable('godot_relationships', table => {
    table.increments('id').primary();
    table
      .integer('repo_id')
      .notNullable()
      .references('id')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.string('relationship_type', 50).notNullable(); // 'scene_script_attachment', 'scene_resource_reference', 'node_hierarchy', 'signal_connection'
    table.string('from_entity_type', 20).notNullable(); // 'scene', 'node', 'script', 'autoload'
    table.integer('from_entity_id').notNullable(); // ID in the corresponding table
    table.string('to_entity_type', 20).notNullable(); // 'scene', 'node', 'script', 'autoload'
    table.integer('to_entity_id').notNullable(); // ID in the corresponding table
    table.string('resource_id', 100); // ExtResource ID for .tscn references (e.g., "1_p4on2")
    table.decimal('confidence', 3, 2).defaultTo(0.9); // Confidence score for the relationship
    table.jsonb('metadata').defaultTo('{}'); // Additional relationship metadata
    table.timestamps(true, true);

    // Performance indexes for relationship queries
    table.index(['from_entity_type', 'from_entity_id'], 'idx_godot_relationships_from');
    table.index(['to_entity_type', 'to_entity_id'], 'idx_godot_relationships_to');
    table.index(['relationship_type'], 'idx_godot_relationships_type');
    table.index(['repo_id', 'relationship_type'], 'idx_godot_relationships_repo_type');
    table.index(['repo_id'], 'idx_godot_relationships_repo');
    table.index(['confidence'], 'idx_godot_relationships_confidence');
  });

  // Note: Complex CHECK constraints with subqueries not supported in PostgreSQL
  // Entity integrity will be enforced at the application level

  // Now we can add the foreign key reference for root_node_id in godot_scenes
  await knex.raw(`
    ALTER TABLE godot_scenes
    ADD CONSTRAINT fk_godot_scenes_root_node
    FOREIGN KEY (root_node_id) REFERENCES godot_nodes(id) ON DELETE SET NULL
  `);

  console.log('Phase 7B: Created Godot framework entity tables and relationships');
}

export async function down(knex: Knex): Promise<void> {
  // Drop foreign key constraints first
  await knex.raw('ALTER TABLE godot_scenes DROP CONSTRAINT IF EXISTS fk_godot_scenes_root_node');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('godot_relationships');
  await knex.schema.dropTableIfExists('godot_autoloads');
  await knex.schema.dropTableIfExists('godot_scripts');
  await knex.schema.dropTableIfExists('godot_nodes');
  await knex.schema.dropTableIfExists('godot_scenes');

  console.log('Phase 7B: Removed Godot framework entity tables and relationships');
}
