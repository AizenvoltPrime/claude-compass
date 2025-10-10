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

// Auto-detect TypeScript stores directory
const possibleStoreDirs = [
  path.join(REPOSITORY_PATH, 'resources/ts/stores'),
  path.join(REPOSITORY_PATH, 'src/stores'),
  path.join(REPOSITORY_PATH, 'stores'),
];

let storesDir = null;
for (const dir of possibleStoreDirs) {
  if (fs.existsSync(dir)) {
    storesDir = dir;
    break;
  }
}

const storeApiCalls = [];
if (storesDir) {
  const storeFiles = fs.readdirSync(storesDir).filter(f => f.endsWith('.ts'));
  console.log(`📁 Analyzing ${storeFiles.length} TypeScript store files...`);
  console.log(`   Location: ${storesDir}`);
  console.log();

  storeFiles.forEach(file => {
    const filePath = path.join(storesDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const calls = extractUrlsFromFile(content, filePath);
    storeApiCalls.push(...calls);
  });

  console.log(`  ✅ Found ${storeApiCalls.length} API calls from stores`);
  console.log();
} else {
  console.log('  ⚠️  No TypeScript stores directory found');
  console.log();
}

// Auto-detect Vue components with axios calls
const possibleVueDirs = [
  path.join(REPOSITORY_PATH, 'resources/ts/Pages'),
  path.join(REPOSITORY_PATH, 'resources/js/Pages'),
  path.join(REPOSITORY_PATH, 'src/components'),
];

const vueApiCalls = [];
for (const vueDir of possibleVueDirs) {
  if (fs.existsSync(vueDir)) {
    console.log(`📁 Scanning for Vue components with axios calls...`);
    console.log(`   Location: ${vueDir}`);

    // Recursively find .vue files
    function findVueFiles(dir) {
      const files = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...findVueFiles(fullPath));
        } else if (entry.name.endsWith('.vue')) {
          files.push(fullPath);
        }
      }

      return files;
    }

    const allVueFiles = findVueFiles(vueDir);
    const vueFilesWithAxios = [];

    allVueFiles.forEach(filePath => {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('axios.')) {
        vueFilesWithAxios.push(filePath);
        const calls = extractUrlsFromFile(content, filePath);
        vueApiCalls.push(...calls);
      }
    });

    console.log(`  ✅ Found ${vueApiCalls.length} API calls from ${vueFilesWithAxios.length} Vue components`);
    console.log();
    break;
  }
}

// Combine and deduplicate
const allCalls = [...storeApiCalls, ...vueApiCalls];
const uniqueEndpoints = new Set(allCalls.map(c => `${c.method} ${c.url}`));

console.log('='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log();
console.log(`  Total API calls extracted:    ${allCalls.length}`);
console.log(`  Unique endpoints:             ${uniqueEndpoints.size}`);
console.log();
console.log(`  From TypeScript stores:       ${storeApiCalls.length}`);
console.log(`  From Vue components:          ${vueApiCalls.length}`);
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
    total: allCalls.length,
    unique: uniqueEndpoints.size,
    fromStores: storeApiCalls.length,
    fromVueComponents: vueApiCalls.length,
  },
  byMethod,
  endpoints: Array.from(uniqueEndpoints).sort(),
  details: allCalls,
};

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`Results saved to: ${outputPath}`);
