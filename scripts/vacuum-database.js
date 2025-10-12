#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

const config = {
  host: process.env.DATABASE_HOST || 'localhost',
  port: process.env.DATABASE_PORT || 5432,
  database: process.env.DATABASE_NAME || 'claude_compass',
  user: process.env.DATABASE_USER || 'claude_compass',
  password: process.env.DATABASE_PASSWORD || 'password'
};

async function vacuumDatabase() {
  console.log('🧹 Running database maintenance (VACUUM ANALYZE)...');
  console.log('');

  const client = new Client(config);

  try {
    await client.connect();

    // Get all user tables
    const result = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename NOT LIKE 'knex_%'
      ORDER BY tablename
    `);

    if (result.rows.length === 0) {
      console.log('⚠️  No tables found in database');
      return;
    }

    console.log(`📊 Found ${result.rows.length} tables\n`);

    // VACUUM ANALYZE each table
    for (const row of result.rows) {
      const tableName = row.tablename;
      process.stdout.write(`   Processing ${tableName}...`);

      try {
        await client.query(`VACUUM ANALYZE ${tableName}`);
        console.log(' ✅');
      } catch (error) {
        console.log(` ❌ ${error.message}`);
      }
    }

    console.log('');
    console.log('✅ Database maintenance complete');
    console.log('');
    console.log('📈 Benefits:');
    console.log('   • Updated query planner statistics');
    console.log('   • Reclaimed disk space from deleted rows');
    console.log('   • Improved query performance');
    console.log('');
    console.log('💡 Tip: Run this after large imports or bulk updates');

  } catch (error) {
    console.error('❌ Error during vacuum:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Main execution
vacuumDatabase().catch(console.error);
