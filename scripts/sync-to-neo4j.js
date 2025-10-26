#!/usr/bin/env node

/**
 * Sync PostgreSQL dependency graph to Neo4j for visualization
 *
 * Usage: node scripts/sync-to-neo4j.js [repository-name]
 *
 * If no repository name is provided, syncs all repositories.
 */

const neo4j = require('neo4j-driver');
const knex = require('knex');

const pgConfig = {
  client: 'pg',
  connection: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: process.env.DATABASE_PORT || 5432,
    user: process.env.DATABASE_USER || 'claude_compass',
    password: process.env.DATABASE_PASSWORD || 'password',
    database: process.env.DATABASE_NAME || 'claude_compass',
  },
};

const db = knex(pgConfig);
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'password'
  )
);

function sanitizeRelationshipType(type) {
  return type.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
}

async function validateApocPlugin(session) {
  try {
    const result = await session.run('RETURN apoc.version() as version');
    const version = result.records[0]?.get('version');
    console.log(`✓ APOC plugin detected (version: ${version})`);
  } catch (error) {
    throw new Error('APOC plugin not installed. Please install APOC to use this script.\n' +
      'See: https://neo4j.com/labs/apoc/');
  }
}

async function clearNeo4j(session) {
  console.log('Clearing existing Neo4j data...');
  await session.run('MATCH (n) DETACH DELETE n');
  console.log('✓ Cleared Neo4j database');
}

async function createConstraints(session) {
  console.log('Creating constraints and indexes...');

  await session.run(`
    CREATE CONSTRAINT symbol_id IF NOT EXISTS
    FOR (s:Symbol) REQUIRE s.id IS UNIQUE
  `);

  await session.run(`
    CREATE CONSTRAINT file_id IF NOT EXISTS
    FOR (f:File) REQUIRE f.id IS UNIQUE
  `);

  await session.run(`
    CREATE INDEX symbol_name IF NOT EXISTS
    FOR (s:Symbol) ON (s.name)
  `);

  await session.run(`
    CREATE INDEX symbol_entity_type IF NOT EXISTS
    FOR (s:Symbol) ON (s.entity_type)
  `);

  console.log('✓ Created constraints and indexes');
}

async function syncRepository(session, repoName = null) {
  const repoFilter = repoName
    ? { name: repoName }
    : {};

  // Get repositories
  const repos = await db('repositories')
    .where(repoFilter)
    .select('*');

  if (repos.length === 0) {
    console.error(`No repositories found${repoName ? ` with name "${repoName}"` : ''}`);
    return;
  }

  for (const repo of repos) {
    console.log(`\nSyncing repository: ${repo.name} (${repo.path})`);

    // Get files
    const files = await db('files')
      .where('repo_id', repo.id)
      .select('*');

    console.log(`  Files: ${files.length}`);

    // Batch create files
    for (let i = 0; i < files.length; i += 1000) {
      const batch = files.slice(i, i + 1000);
      await session.run(`
        UNWIND $files AS file
        CREATE (f:File {
          id: file.id,
          path: file.path,
          language: file.language,
          repo_id: file.repo_id,
          repository_name: $repoName
        })
      `, { files: batch, repoName: repo.name });
    }

    // Get symbols
    const symbols = await db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repo.id)
      .select(
        'symbols.id',
        'symbols.name',
        'symbols.symbol_type',
        'symbols.entity_type',
        'symbols.file_id',
        'symbols.start_line',
        'symbols.end_line',
        'files.path as file_path'
      );

    console.log(`  Symbols: ${symbols.length}`);

    // Batch create symbols and link to files
    for (let i = 0; i < symbols.length; i += 1000) {
      const batch = symbols.slice(i, i + 1000);
      await session.run(`
        UNWIND $symbols AS symbol
        CREATE (s:Symbol {
          id: symbol.id,
          name: symbol.name,
          symbol_type: symbol.symbol_type,
          entity_type: symbol.entity_type,
          start_line: symbol.start_line,
          end_line: symbol.end_line,
          file_path: symbol.file_path
        })
        WITH s, symbol
        MATCH (f:File {id: symbol.file_id})
        CREATE (s)-[:IN_FILE]->(f)
      `, { symbols: batch });
    }

    // Get dependencies
    const dependencies = await db('dependencies')
      .join('symbols as s1', 'dependencies.from_symbol_id', 's1.id')
      .join('symbols as s2', 'dependencies.to_symbol_id', 's2.id')
      .join('files as f1', 's1.file_id', 'f1.id')
      .join('files as f2', 's2.file_id', 'f2.id')
      .where('f1.repo_id', repo.id)
      .where('f2.repo_id', repo.id)
      .select(
        'dependencies.from_symbol_id',
        'dependencies.to_symbol_id',
        'dependencies.dependency_type',
        'dependencies.line_number'
      );

    console.log(`  Dependencies: ${dependencies.length}`);

    // Batch create dependencies
    for (let i = 0; i < dependencies.length; i += 5000) {
      const batch = dependencies.slice(i, i + 5000).map(dep => ({
        ...dep,
        dependency_type: sanitizeRelationshipType(dep.dependency_type)
      }));
      await session.run(`
        UNWIND $deps AS dep
        MATCH (from:Symbol {id: dep.from_symbol_id})
        MATCH (to:Symbol {id: dep.to_symbol_id})
        CALL apoc.create.relationship(from, dep.dependency_type, {
          line_number: dep.line_number
        }, to) YIELD rel
        RETURN count(rel)
      `, { deps: batch });

      console.log(`    Synced ${Math.min(i + 5000, dependencies.length)}/${dependencies.length} dependencies`);
    }

    console.log(`✓ Synced repository: ${repo.name}`);
  }
}

async function main() {
  const repoName = process.argv[2];
  const session = driver.session();
  let hasError = false;

  try {
    await validateApocPlugin(session);
    await clearNeo4j(session);
    await createConstraints(session);
    await syncRepository(session, repoName);

    console.log('\n✓ Sync complete!');
    console.log('\nAccess Neo4j Browser at: http://localhost:7474');
    console.log(`Username: ${process.env.NEO4J_USER || 'neo4j'}`);
    console.log('\nExample queries:');
    console.log('  // Find CameraAlertInfoWindow and its connections');
    console.log('  MATCH (s:Symbol {name: "CameraAlertInfoWindow"})');
    console.log('  OPTIONAL MATCH (s)-[r]-(connected)');
    console.log('  RETURN s, r, connected LIMIT 100');
    console.log();
    console.log('  // Find who uses CameraAlertInfoWindow');
    console.log('  MATCH (s:Symbol {name: "CameraAlertInfoWindow"})<-[r]-(caller)');
    console.log('  RETURN caller.name, type(r), caller.entity_type');
    console.log();
    console.log('  // Find what CameraAlertInfoWindow needs');
    console.log('  MATCH (s:Symbol {name: "CameraAlertInfoWindow"})-[r]->(dependency)');
    console.log('  RETURN dependency.name, type(r), dependency.entity_type');

  } catch (error) {
    console.error('Error syncing to Neo4j:', error);
    hasError = true;
  } finally {
    await session.close();
    await driver.close();
    await db.destroy();
    if (hasError) {
      process.exit(1);
    }
  }
}

main();
