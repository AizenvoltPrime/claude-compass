#!/usr/bin/env node

/**
 * Lists remaining unmatched routes from the comparison results
 *
 * Usage:
 *   node list-remaining-routes.js [--backend-only | --frontend-only | --all]
 */

const fs = require('fs');
const path = require('path');

const COMPARISON_FILE = path.join(__dirname, 'comparison-results.json');

function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--all';

  // Check if comparison results exist
  if (!fs.existsSync(COMPARISON_FILE)) {
    console.error('❌ Error: comparison-results.json not found');
    console.error('   Run compare-backend-frontend.js first');
    process.exit(1);
  }

  // Read comparison results
  const data = JSON.parse(fs.readFileSync(COMPARISON_FILE, 'utf-8'));

  console.log('======================================================================');
  console.log('REMAINING UNMATCHED ROUTES');
  console.log('======================================================================');
  console.log(`Repository: ${data.repository}`);
  console.log(`Timestamp: ${new Date(data.timestamp).toLocaleString()}`);
  console.log();

  // Display summary
  console.log('📊 SUMMARY');
  console.log('----------------------------------------------------------------------');
  console.log(`  Total backend routes:     ${data.backend.total}`);
  console.log(`  Total frontend endpoints: ${data.frontend.total}`);
  console.log(`  Matched:                  ${data.comparison.matched}`);
  console.log(`  Frontend-only:            ${data.comparison.frontendOnly}`);
  console.log(`  Backend-only:             ${data.comparison.backendOnly}`);
  console.log(`  Coverage:                 ${data.comparison.coverage}%`);
  console.log();

  // Display frontend-only routes
  if (mode === '--all' || mode === '--frontend-only') {
    console.log('======================================================================');
    console.log(`⚠️  FRONTEND-ONLY ENDPOINTS (${data.comparison.frontendOnly})`);
    console.log('======================================================================');
    console.log('These are called in frontend but don\'t exist in api.php:');
    console.log();

    if (data.frontendOnlyEndpoints.length === 0) {
      console.log('  ✅ None - all frontend calls match backend routes!');
    } else {
      data.frontendOnlyEndpoints.forEach((endpoint, idx) => {
        console.log(`  ${String(idx + 1).padStart(2)}. ${endpoint}`);
      });
    }
    console.log();
  }

  // Display backend-only routes
  if (mode === '--all' || mode === '--backend-only') {
    console.log('======================================================================');
    console.log(`ℹ️  BACKEND-ONLY ROUTES (${data.comparison.backendOnly})`);
    console.log('======================================================================');
    console.log('These routes exist in api.php but aren\'t called by frontend:');
    console.log();

    if (data.backendOnlyEndpoints.length === 0) {
      console.log('  ✅ None - all backend routes are used by frontend!');
    } else {
      // Group by method for better readability
      const byMethod = {};
      data.backendOnlyEndpoints.forEach(endpoint => {
        const [method] = endpoint.split(' ');
        if (!byMethod[method]) byMethod[method] = [];
        byMethod[method].push(endpoint);
      });

      // Display grouped by method
      Object.keys(byMethod).sort().forEach(method => {
        console.log(`  ${method} (${byMethod[method].length}):`);
        byMethod[method].forEach(endpoint => {
          const route = endpoint.substring(method.length + 1);
          console.log(`    ${route}`);
        });
        console.log();
      });
    }
  }

  console.log('======================================================================');

  // Export to file if requested
  if (args.includes('--export')) {
    const exportData = {
      repository: data.repository,
      timestamp: data.timestamp,
      summary: data.comparison,
      frontendOnly: data.frontendOnlyEndpoints,
      backendOnly: data.backendOnlyEndpoints
    };

    const exportFile = path.join(__dirname, 'remaining-routes.json');
    fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2));
    console.log(`\n✅ Exported to: ${exportFile}`);
  }

  // Show usage
  if (mode === '--help') {
    console.log('\nUsage:');
    console.log('  node list-remaining-routes.js [options]');
    console.log('\nOptions:');
    console.log('  --all             Show both frontend-only and backend-only (default)');
    console.log('  --frontend-only   Show only frontend-only endpoints');
    console.log('  --backend-only    Show only backend-only routes');
    console.log('  --export          Export results to remaining-routes.json');
    console.log('  --help            Show this help message');
  }
}

main();
