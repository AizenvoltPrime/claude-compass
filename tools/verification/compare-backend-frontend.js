#!/usr/bin/env node

/**
 * Backend vs Frontend API Comparison Tool
 *
 * Compares Laravel backend routes (from api.php) with frontend API calls
 * to verify extraction accuracy and identify mismatches.
 *
 * Usage:
 *   node compare-backend-frontend.js <repository-path>
 *   node compare-backend-frontend.js /path/to/iemis
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Configuration
const REPOSITORY_PATH = process.argv[2] || process.env.REPO_PATH;
const REPOSITORY_NAME = path.basename(REPOSITORY_PATH || '');

// Database configuration
const DB_CONFIG = {
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'claude_compass',
  user: process.env.DATABASE_USER || 'claude_compass',
  password: process.env.DATABASE_PASSWORD || 'password',
};

if (!REPOSITORY_PATH) {
  console.error('Error: Repository path required');
  console.error('Usage: node compare-backend-frontend.js <repository-path>');
  process.exit(1);
}

console.log('='.repeat(70));
console.log('BACKEND vs FRONTEND API ENDPOINT VERIFICATION');
console.log('='.repeat(70));
console.log(`Repository: ${REPOSITORY_PATH}`);
console.log();

// Extract backend routes from database (routes table)
async function extractBackendRoutesFromDatabase() {
  const client = new Client(DB_CONFIG);

  try {
    await client.connect();

    const query = `
      SELECT
        r.method,
        r.path
      FROM routes r
      JOIN repositories repo ON r.repo_id = repo.id
      WHERE repo.name = $1
        AND r.file_path LIKE '%/routes/api.php'
      ORDER BY r.path, r.method
    `;

    const result = await client.query(query, [REPOSITORY_NAME]);

    const backendRoutes = new Map();

    for (const row of result.rows) {
      const method = row.method.toUpperCase();
      const originalPath = row.path;

      // Normalize route parameters to {id} for comparison with frontend
      const normalizedPath = row.path.replace(/\{[^}]+\}/g, '{id}');

      const key = `${method} ${normalizedPath}`;
      backendRoutes.set(key, {
        method,
        path: normalizedPath,  // For matching
        originalPath  // For display
      });
    }

    return backendRoutes;
  } finally {
    await client.end();
  }
}

// Main function to wrap async operations
async function main() {
  // Fetch backend routes from database
  const backendRoutes = await extractBackendRoutesFromDatabase();

  console.log('📊 BACKEND ROUTES (api.php)');
console.log('-'.repeat(70));
console.log(`  Total routes defined: ${backendRoutes.size}`);
console.log();

// Count by method
const backendByMethod = {};
backendRoutes.forEach(route => {
  backendByMethod[route.method] = (backendByMethod[route.method] || 0) + 1;
});

console.log('Breakdown by HTTP method:');
Object.entries(backendByMethod).sort((a, b) => b[1] - a[1]).forEach(([method, count]) => {
  console.log(`  ${method.padEnd(8)} ${count}`);
});
console.log();

// Read frontend extraction results
const frontendResultsPath = path.join(__dirname, 'frontend-api-calls.json');
if (!fs.existsSync(frontendResultsPath)) {
  console.error('Error: Run extract-frontend-api-calls.js first to generate frontend-api-calls.json');
  process.exit(1);
}

const frontendResults = JSON.parse(fs.readFileSync(frontendResultsPath, 'utf-8'));
const frontendEndpoints = new Set(frontendResults.endpoints);

console.log('📊 FRONTEND API CALLS (extracted from Vue/TypeScript)');
console.log('-'.repeat(70));
console.log(`  Total unique endpoints: ${frontendEndpoints.size}`);
console.log();

// Find matches and mismatches
const matched = [];
const frontendOnly = [];
const backendOnly = [];

frontendEndpoints.forEach(endpoint => {
  if (backendRoutes.has(endpoint)) {
    matched.push(endpoint);
  } else {
    frontendOnly.push(endpoint);
  }
});

backendRoutes.forEach((route, key) => {
  if (!frontendEndpoints.has(key)) {
    // Store original path with parameter names for better display
    const displayKey = `${route.method} ${route.originalPath}`;
    backendOnly.push(displayKey);
  }
});

console.log('='.repeat(70));
console.log('COMPARISON RESULTS');
console.log('='.repeat(70));
console.log();
console.log(`✅ Matched (frontend calls backend):     ${matched.length}`);
console.log(`⚠️  Frontend only (no backend route):    ${frontendOnly.length}`);
console.log(`ℹ️  Backend only (not called by frontend): ${backendOnly.length}`);
console.log();

const coverage = ((matched.length / backendRoutes.size) * 100).toFixed(1);
console.log(`Coverage: ${coverage}%`);
console.log();

// Show frontend-only endpoints (potential issues or external APIs)
if (frontendOnly.length > 0) {
  console.log('='.repeat(70));
  console.log('FRONTEND-ONLY ENDPOINTS (not in api.php)');
  console.log('='.repeat(70));
  console.log();
  frontendOnly.sort().forEach(endpoint => {
    console.log(`  ${endpoint}`);
  });
  console.log();
  console.log('These may be:');
  console.log('  - External APIs (e.g., /sanctum/csrf-cookie)');
  console.log('  - Route parameter mismatches');
  console.log('  - Typos in frontend code');
  console.log();
}

// Show sample of backend-only (unused routes)
if (backendOnly.length > 0) {
  console.log('='.repeat(70));
  console.log('BACKEND-ONLY ROUTES (not called by frontend)');
  console.log('='.repeat(70));
  console.log();
  const sampleSize = Math.min(20, backendOnly.length);
  backendOnly.sort().slice(0, sampleSize).forEach(endpoint => {
    console.log(`  ${endpoint}`);
  });
  if (backendOnly.length > sampleSize) {
    console.log(`  ... and ${backendOnly.length - sampleSize} more`);
  }
  console.log();
  console.log('These routes exist but are not called by the current frontend.');
  console.log('Common reasons:');
  console.log('  - Mobile app routes');
  console.log('  - Webhook endpoints');
  console.log('  - Utility/validation routes');
  console.log('  - Legacy/deprecated endpoints');
  console.log();
}

// Save comparison results
const comparisonResults = {
  repository: REPOSITORY_PATH,
  timestamp: new Date().toISOString(),
  backend: {
    total: backendRoutes.size,
    byMethod: backendByMethod,
  },
  frontend: {
    total: frontendEndpoints.size,
    byMethod: frontendResults.byMethod,
  },
  comparison: {
    matched: matched.length,
    frontendOnly: frontendOnly.length,
    backendOnly: backendOnly.length,
    coverage: parseFloat(coverage),
  },
  frontendOnlyEndpoints: frontendOnly.sort(),
  backendOnlyEndpoints: backendOnly.sort(),
  matchedEndpoints: matched.sort(),
};

const outputPath = path.join(__dirname, 'comparison-results.json');
fs.writeFileSync(outputPath, JSON.stringify(comparisonResults, null, 2));

  console.log('='.repeat(70));
  console.log('Results saved to: ' + outputPath);
  console.log('='.repeat(70));
}

// Run main function
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
