#!/usr/bin/env node

/**
 * Frontend API Call Extraction Tool
 *
 * Extracts all API calls from Vue components and TypeScript store files.
 * Mirrors the extraction logic used in cross-stack-builder.ts
 *
 * Usage:
 *   node extract-frontend-api-calls.js <repository-path>
 *   node extract-frontend-api-calls.js /path/to/iemis
 */

const fs = require('fs');
const path = require('path');

// Configuration
const REPOSITORY_PATH = process.argv[2] || process.env.REPO_PATH;

if (!REPOSITORY_PATH) {
  console.error('Error: Repository path required');
  console.error('Usage: node extract-frontend-api-calls.js <repository-path>');
  process.exit(1);
}

if (!fs.existsSync(REPOSITORY_PATH)) {
  console.error(`Error: Repository path does not exist: ${REPOSITORY_PATH}`);
  process.exit(1);
}

// Extraction logic matching cross-stack-builder.ts implementation
function extractUrlsFromFile(content, filePath) {
  const apiCalls = [];
  const uniqueCalls = new Set();

  // 1. Extract URL variable declarations with positions
  const urlVariableDeclarations = [];
  const urlVariablePatterns = [
    /(?:const|let|var)\s+(\w+)\s*=\s*['"`](\/api\/[^'"`]+)['"`]/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*`(\/api\/[^`]+)`/g,
  ];

  for (const pattern of urlVariablePatterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(content)) !== null) {
      const varName = match[1];
      let url = match[2];
      const position = match.index;

      if (url.includes('${')) {
        url = url.replace(/\$\{[^}]+\}/g, '{id}');
      }

      urlVariableDeclarations.push({ varName, url, position });
    }
  }

  // 2. Extract string literal axios calls
  const stringLiteralPatterns = [
    /axios\.(get|post|put|delete|patch)\s*\(\s+['"`]([^'"`]+)['"`]/g,
    /axios\.(get|post|put|delete|patch)\s*\(\s+`([^`]+)`/g,
    /axios\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /axios\.(get|post|put|delete|patch)\s*\(\s*`([^`]+)`/g,
  ];

  stringLiteralPatterns.forEach(pattern => {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      let url = match[2];
      if (url.includes('${')) {
        url = url.replace(/\$\{[^}]+\}/g, '{id}');
      }
      if (url && url.startsWith('/')) {
        const key = `${method} ${url}`;
        if (!uniqueCalls.has(key)) {
          uniqueCalls.add(key);
          apiCalls.push({ method, url, source: 'literal', file: path.basename(filePath) });
        }
      }
    }
  });

  // 3. Extract variable reference axios calls
  const variableReferencePattern = /axios\.(get|post|put|delete|patch)\s*\(\s*(\w+)\s*[,)]/g;
  variableReferencePattern.lastIndex = 0;
  let match;
  while ((match = variableReferencePattern.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const varName = match[2];
    const callPosition = match.index;

    const candidates = urlVariableDeclarations
      .filter(decl => decl.varName === varName && decl.position < callPosition)
      .sort((a, b) => b.position - a.position);

    if (candidates.length > 0) {
      const url = candidates[0].url;
      const key = `${method} ${url}`;
      if (!uniqueCalls.has(key)) {
        uniqueCalls.add(key);
        apiCalls.push({ method, url, source: 'variable', file: path.basename(filePath) });
      }
    }
  }

  return apiCalls;
}

console.log('='.repeat(70));
console.log('FRONTEND API CALL EXTRACTION');
console.log('='.repeat(70));
console.log(`Repository: ${REPOSITORY_PATH}`);
console.log();

// Recursively find all frontend files
function findAllFrontendFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip excluded directories
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '.git'
      ) {
        continue;
      }
      findAllFrontendFiles(fullPath, files);
    } else {
      // Include .ts, .js, .vue files
      if (
        (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) ||
        entry.name.endsWith('.js') ||
        entry.name.endsWith('.vue')
      ) {
        // Exclude test files
        if (
          !entry.name.includes('.test.') &&
          !entry.name.includes('.spec.')
        ) {
          files.push(fullPath);
        }
      }
    }
  }

  return files;
}

console.log(`📁 Scanning ALL frontend files (.ts, .js, .vue)...`);
console.log(`   Location: ${REPOSITORY_PATH}`);
console.log(`   Excluding: node_modules, dist, build, test files`);
console.log();

const allFrontendFiles = findAllFrontendFiles(REPOSITORY_PATH);
console.log(`  Found ${allFrontendFiles.length} frontend files to scan`);
console.log();

const allCalls = [];
let filesWithApiCalls = 0;

allFrontendFiles.forEach(filePath => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const calls = extractUrlsFromFile(content, filePath);
    if (calls.length > 0) {
      filesWithApiCalls++;
      allCalls.push(...calls);
    }
  } catch (error) {
    // Silently skip files that can't be read
  }
});

console.log(`  ✅ Found ${allCalls.length} API calls from ${filesWithApiCalls} files`);
console.log();
const uniqueEndpoints = new Set(allCalls.map(c => `${c.method} ${c.url}`));

console.log('='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log();
console.log(`  Total files scanned:          ${allFrontendFiles.length}`);
console.log(`  Files with API calls:         ${filesWithApiCalls}`);
console.log(`  Total API calls extracted:    ${allCalls.length}`);
console.log(`  Unique endpoints:             ${uniqueEndpoints.size}`);
console.log();

// Show breakdown
const byMethod = {};
allCalls.forEach(call => {
  byMethod[call.method] = (byMethod[call.method] || 0) + 1;
});

console.log('Breakdown by method:');
Object.entries(byMethod).sort((a, b) => b[1] - a[1]).forEach(([method, count]) => {
  console.log(`  ${method.padEnd(8)} ${count}`);
});
console.log();

// Show all unique endpoints
console.log('='.repeat(70));
console.log('ALL UNIQUE API ENDPOINTS');
console.log('='.repeat(70));
console.log();
Array.from(uniqueEndpoints).sort().forEach((endpoint, idx) => {
  console.log(`${String(idx + 1).padStart(3)}. ${endpoint}`);
});
console.log();

// Export results as JSON
const outputPath = path.join(__dirname, 'frontend-api-calls.json');
const results = {
  repository: REPOSITORY_PATH,
  timestamp: new Date().toISOString(),
  summary: {
    totalFilesScanned: allFrontendFiles.length,
    filesWithApiCalls: filesWithApiCalls,
    totalApiCalls: allCalls.length,
    uniqueEndpoints: uniqueEndpoints.size,
  },
  byMethod,
  endpoints: Array.from(uniqueEndpoints).sort(),
  details: allCalls,
};

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`Results saved to: ${outputPath}`);
