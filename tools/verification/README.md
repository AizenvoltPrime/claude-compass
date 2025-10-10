# API Call Extraction Verification Tools

This directory contains tools to verify the accuracy of Claude Compass's API call extraction from frontend code and compare it against backend routes.

## Tools

### 1. `extract-frontend-api-calls.js`

Extracts all API calls from Vue components and TypeScript store files using the same logic as `cross-stack-builder.ts`.

**Features:**
- Extracts axios calls with string literals: `axios.get("/api/users")`
- Extracts axios calls with variable references: `const url = "/api/users"; axios.get(url)`
- Supports multiline patterns
- Normalizes template literals: `/api/users/${id}` → `/api/users/{id}`
- Auto-detects TypeScript stores and Vue component directories

**Usage:**
```bash
node extract-frontend-api-calls.js <repository-path>

# Example
node extract-frontend-api-calls.js /home/user/projects/iemis
```

**Output:**
- Console: Detailed extraction summary with endpoint list
- File: `frontend-api-calls.json` with complete results

### 2. `compare-backend-frontend.js`

Compares Laravel backend routes (from `routes/api.php`) with extracted frontend API calls.

**Features:**
- Parses Laravel route definitions
- Normalizes route parameters: `{userId}` → `{id}`
- Adds `/api/` prefix to routes (Laravel convention)
- Identifies matched, frontend-only, and backend-only endpoints
- Calculates coverage percentage

**Usage:**
```bash
# First, extract frontend calls
node extract-frontend-api-calls.js <repository-path>

# Then compare with backend
node compare-backend-frontend.js <repository-path>

# Example
node extract-frontend-api-calls.js /home/user/projects/iemis
node compare-backend-frontend.js /home/user/projects/iemis
```

**Output:**
- Console: Comparison report with coverage statistics
- File: `comparison-results.json` with detailed comparison data

## Example Workflow

```bash
cd /home/astefanopoulos/Documents/claude-compass/tools/verification

# Extract frontend API calls
node extract-frontend-api-calls.js /home/astefanopoulos/Documents/iemis

# Compare with backend routes
node compare-backend-frontend.js /home/astefanopoulos/Documents/iemis
```

## Expected Results

For the iemis repository:

```
Frontend extraction:
  - 174 API calls from TypeScript stores
  - 7 API calls from Vue components
  - 178 unique endpoints

Backend routes:
  - 219 routes in api.php

Comparison:
  - 176 matched (98.9%)
  - 2 frontend-only
  - 43 backend-only
  - Coverage: 80.4%
```

## Frontend-Only Endpoints

These endpoints appear in frontend code but not in `api.php`:
- External APIs (e.g., `/sanctum/csrf-cookie`)
- Route parameter mismatches
- Typos in frontend code

These are correctly filtered out by Claude Compass's matching logic.

## Backend-Only Endpoints

These routes exist in Laravel but aren't called by the frontend:
- Mobile app routes (`/api/mobile/*`)
- Webhook endpoints
- Utility/validation routes
- Image serving routes
- Admin-only routes not exposed in UI

This is normal and expected.

## Output Files

### `frontend-api-calls.json`
```json
{
  "repository": "/path/to/repo",
  "timestamp": "2025-10-10T...",
  "summary": {
    "total": 181,
    "unique": 178,
    "fromStores": 174,
    "fromVueComponents": 7
  },
  "byMethod": {
    "GET": 70,
    "POST": 49,
    ...
  },
  "endpoints": [
    "DELETE /api/areas/{id}",
    "GET /api/areas",
    ...
  ],
  "details": [...]
}
```

### `comparison-results.json`
```json
{
  "repository": "/path/to/repo",
  "timestamp": "2025-10-10T...",
  "backend": {
    "total": 219,
    "byMethod": {...}
  },
  "frontend": {
    "total": 178,
    "byMethod": {...}
  },
  "comparison": {
    "matched": 176,
    "frontendOnly": 2,
    "backendOnly": 43,
    "coverage": 80.4
  },
  "matchedEndpoints": [...],
  "frontendOnlyEndpoints": [...],
  "backendOnlyEndpoints": [...]
}
```

## How It Works

### Extraction Logic

The extraction matches the implementation in `src/graph/cross-stack-builder.ts`:

1. **URL Variable Declarations**: Find `const url = "/api/..."` patterns
2. **String Literal Calls**: Find `axios.METHOD("/api/...")` patterns
3. **Variable Reference Calls**: Find `axios.METHOD(url)` and resolve using proximity-based matching
4. **Normalization**: Convert template literals to `{id}` placeholders

### Comparison Logic

1. **Parse Backend**: Extract routes from `routes/api.php`
2. **Normalize**: Add `/api/` prefix, convert `{param}` to `{id}`
3. **Match**: Compare frontend endpoints to backend routes
4. **Categorize**: Identify matched, frontend-only, and backend-only

## Use Cases

### Verify Extraction Accuracy

After implementing new extraction features, run these tools to verify:
- Are all API calls being extracted?
- Are variable references being resolved correctly?
- Are multiline patterns being captured?

### Debug Mismatches

If the database shows fewer API calls than expected:
1. Run `extract-frontend-api-calls.js` to see what's in the source
2. Compare with database query results
3. Identify missing patterns or filtering issues

### Track Coverage

Monitor how much of your backend API is actively used by the frontend:
```bash
node compare-backend-frontend.js /path/to/repo | grep "Coverage:"
```

## Notes

- These tools are **read-only** verification utilities
- They don't modify any source code or database
- Run them anytime to verify extraction accuracy
- Useful for regression testing after parser changes
