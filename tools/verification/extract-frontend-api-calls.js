#!/usr/bin/env node

/**
 * Frontend API Call Extraction Tool (Database Version)
 *
 * Extracts all API calls from the Claude Compass database.
 * Queries the api_calls table to get AST-extracted API calls.
 *
 * Usage:
 *   node extract-frontend-api-calls.js <repository-name>
 *   node extract-frontend-api-calls.js iemis
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Configuration from environment or arguments
const REPOSITORY_NAME = process.argv[2] || process.env.REPO_NAME || 'iemis';

// Database connection from environment
const DB_CONFIG = {
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'claude_compass',
  user: process.env.DATABASE_USER || 'claude_compass',
  password: process.env.DATABASE_PASSWORD || 'password',
};

async function extractFromDatabase() {
  const client = new Client(DB_CONFIG);

  try {
    await client.connect();

    console.log('='.repeat(70));
    console.log('FRONTEND API CALL EXTRACTION (FROM DATABASE)');
    console.log('='.repeat(70));
    console.log(`Repository: ${REPOSITORY_NAME}`);
    console.log(`Database: ${DB_CONFIG.database}`);
    console.log();

    // Query all API calls from database with file information
    const query = `
      SELECT
        ac.http_method,
        ac.endpoint_path,
        ac.call_type,
        s.name as caller_name,
        f.path as file_path
      FROM api_calls ac
      JOIN symbols s ON ac.caller_symbol_id = s.id
      JOIN files f ON s.file_id = f.id
      JOIN repositories r ON f.repo_id = r.id
      WHERE r.name = $1
      ORDER BY ac.endpoint_path, ac.http_method
    `;

    const result = await client.query(query, [REPOSITORY_NAME]);

    console.log(`📊 Query Results:`);
    console.log(`   Found ${result.rows.length} API calls in database`);
    console.log();

    // Transform to match expected format
    const allCalls = result.rows.map(row => ({
      method: row.http_method,
      url: row.endpoint_path,
      source: row.call_type || 'axios',
      file: path.basename(row.file_path),
      caller: row.caller_name
    }));

    const uniqueEndpoints = new Set(allCalls.map(c => `${c.method} ${c.url}`));

    // Count by method
    const byMethod = {};
    allCalls.forEach(call => {
      byMethod[call.method] = (byMethod[call.method] || 0) + 1;
    });

    // Count files with API calls
    const filesWithApiCalls = new Set(allCalls.map(c => c.file)).size;

    return {
      repository: REPOSITORY_NAME,
      timestamp: new Date().toISOString(),
      summary: {
        totalApiCalls: allCalls.length,
        uniqueEndpoints: uniqueEndpoints.size,
        filesWithApiCalls,
      },
      byMethod,
      endpoints: Array.from(uniqueEndpoints).sort(),
      details: allCalls,
    };

  } finally {
    await client.end();
  }
}

async function main() {
  try {
    const results = await extractFromDatabase();

    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log();
    console.log(`  Total API calls extracted:    ${results.summary.totalApiCalls}`);
    console.log(`  Unique endpoints:             ${results.summary.uniqueEndpoints}`);
    console.log(`  Files with API calls:         ${results.summary.filesWithApiCalls}`);
    console.log();

    console.log('Breakdown by method:');
    Object.entries(results.byMethod).sort((a, b) => b[1] - a[1]).forEach(([method, count]) => {
      console.log(`  ${method.padEnd(8)} ${count}`);
    });
    console.log();

    // Show all unique endpoints
    console.log('='.repeat(70));
    console.log('ALL UNIQUE API ENDPOINTS');
    console.log('='.repeat(70));
    console.log();
    results.endpoints.forEach((endpoint, idx) => {
      console.log(`${String(idx + 1).padStart(3)}. ${endpoint}`);
    });
    console.log();

    // Export results as JSON
    const outputPath = path.join(__dirname, 'frontend-api-calls.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log('='.repeat(70));
    console.log(`✅ Results saved to: ${outputPath}`);
    console.log('='.repeat(70));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
