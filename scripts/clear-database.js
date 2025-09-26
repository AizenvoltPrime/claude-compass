#!/usr/bin/env node

const knex = require('knex');
const { execSync } = require('child_process');
require('dotenv').config();

const config = {
  client: 'pg',
  connection: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: process.env.DATABASE_PORT || 5432,
    database: process.env.DATABASE_NAME || 'claude_compass',
    user: process.env.DATABASE_USER || 'claude_compass',
    password: process.env.DATABASE_PASSWORD || 'password'
  }
};

async function clearDatabase() {
  console.log('🗑️  Clearing database completely...');

  let db;
  try {
    // Connect to database
    db = knex(config);

    // Get all table names
    console.log('📋 Finding all tables...');
    const tables = await db.raw(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename NOT LIKE 'knex_%'
    `);

    if (tables.rows.length === 0) {
      console.log('✅ Database is already empty');
      return;
    }

    console.log(`📋 Found ${tables.rows.length} tables to drop`);

    // Drop all tables (disable foreign key checks temporarily)
    for (const table of tables.rows) {
      console.log(`   Dropping table: ${table.tablename}`);
      await db.raw(`DROP TABLE IF EXISTS "${table.tablename}" CASCADE`);
    }

    // Drop all extensions that might have been created
    console.log('🧹 Cleaning up extensions...');
    await db.raw('DROP EXTENSION IF EXISTS vector CASCADE').catch(() => {});
    await db.raw('DROP EXTENSION IF EXISTS pg_trgm CASCADE').catch(() => {});
    await db.raw('DROP EXTENSION IF EXISTS btree_gin CASCADE').catch(() => {});

    // Clear knex migrations table
    await db.raw('DROP TABLE IF EXISTS knex_migrations CASCADE').catch(() => {});
    await db.raw('DROP TABLE IF EXISTS knex_migrations_lock CASCADE').catch(() => {});

    console.log('✅ Database cleared successfully');

  } catch (error) {
    console.error('❌ Error clearing database:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.destroy();
    }
  }
}

// Alternative: Complete Docker reset
async function dockerReset() {
  console.log('🐳 Performing complete Docker reset...');

  try {
    console.log('   Stopping containers...');
    execSync('docker-compose down', { stdio: 'inherit' });

    console.log('   Removing volumes...');
    execSync('docker volume rm claude-compass_postgres-data 2>/dev/null || true', { stdio: 'inherit' });

    console.log('   Starting fresh containers...');
    execSync('docker-compose up -d', { stdio: 'inherit' });

    console.log('✅ Docker reset complete');
  } catch (error) {
    console.error('❌ Docker reset failed:', error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const method = process.argv[2] || 'sql';

  if (method === 'docker') {
    await dockerReset();
  } else {
    await clearDatabase();
  }
}

main().catch(console.error);