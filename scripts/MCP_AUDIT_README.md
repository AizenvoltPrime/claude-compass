# MCP Tool Audit System

## Overview

The MCP Tool Audit system validates that all Model Context Protocol (MCP) tools work correctly across different project types and frameworks. It tests the actual SQL queries and business logic that power the MCP tools.

## Purpose

While the database audit (`run-audit.sh`) validates **data quality** (parser correctness, no duplicates, referential integrity), the MCP audit validates **tool functionality** (queries work, joins succeed, results are correct).

### Two-Layer Testing Strategy

```
┌─────────────────────────────────────────────┐
│  MCP Tool Audit (run-mcp-audit.sh)         │
│  Tests: Tool queries, joins, filters       │
│  Validates: Functional correctness         │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  Database Audit (run-audit.sh)             │
│  Tests: Data integrity, parser quality     │
│  Validates: Storage correctness            │
└─────────────────────────────────────────────┘
```

## Quick Start

### Run All Tests

```bash
# Test all MCP tools on iemis (Laravel + Vue project)
npm run audit:mcp:all iemis

# Test all MCP tools on project_card_game (Godot project)
npm run audit:mcp:all project_card_game
```

### Run Specific Test Suites

```bash
# General tests (work for all frameworks)
npm run audit:mcp iemis general

# Godot-specific tests
npm run audit:mcp:godot project_card_game

# Laravel-specific tests
npm run audit:mcp:laravel iemis

# All tests
npm run audit:mcp:all iemis
```

## Test Categories

### Universal Tests (Work for All Frameworks)

| Test | What It Validates | MCP Tool |
|------|------------------|----------|
| `test_search_code_basic` | Symbol search across repos | `search_code` |
| `test_search_code_entity_types` | Entity type filtering | `search_code` |
| `test_get_symbol` | Symbol retrieval with file info | `get_symbol` |
| `test_who_calls` | Reverse dependency lookup | `who_calls` |
| `test_list_dependencies` | Outgoing dependency tracking | `list_dependencies` |
| `test_dependency_joins` | LEFT JOIN correctness | All dependency tools |
| `test_null_handling` | NULL value safety | All tools |

### Godot-Specific Tests

| Test | What It Validates |
|------|------------------|
| `test_godot_scenes` | Scene file tracking |
| `test_godot_nodes` | Node hierarchy parsing |
| `test_godot_csharp_symbols` | C# symbol classification |
| `test_godot_dependencies` | C# call graph |

### Laravel-Specific Tests

| Test | What It Validates |
|------|------------------|
| `test_laravel_routes` | Route discovery & mapping |
| `test_laravel_models` | Eloquent model detection |
| `test_laravel_controllers` | Controller classification |

### Vue-Specific Tests

| Test | What It Validates |
|------|------------------|
| `test_vue_components` | Component discovery with props/emits |
| `test_vue_stores` | Pinia store detection |

### Cross-Stack Tests (Vue ↔ Laravel)

| Test | What It Validates |
|------|------------------|
| `test_api_calls` | Frontend → Backend API call tracking |
| `test_cross_stack_discovery` | Full-stack feature discovery |

## What Each Test Does

### `test_search_code_basic`
Simulates the `search_code` MCP tool by searching for symbols with a pattern (e.g., "Manager"). Validates:
- Query returns results
- Symbols match search criteria
- File paths are resolved

### `test_who_calls`
Simulates the `who_calls` MCP tool by finding reverse dependencies. Validates:
- `getDependenciesTo` query works
- LEFT JOINs include all callers
- Line numbers are tracked

### `test_dependency_joins`
Validates that dependency queries handle:
- Resolved dependencies (`to_symbol_id` populated)
- Unresolved dependencies (`to_qualified_name` only)
- NULL values don't break queries

### `test_null_handling`
Checks that queries gracefully handle:
- Missing qualified names (imports, constructors)
- Unclassified frameworks
- Missing entity types

### `test_godot_scenes` / `test_godot_nodes`
Validates Godot-specific parsing:
- `.tscn` files parsed into `godot_scenes` table
- Node hierarchies tracked with parent relationships
- Scene metadata preserved

### `test_laravel_routes`
Validates Laravel route discovery:
- Routes extracted from `routes/api.php`
- Handler methods linked to controllers
- HTTP methods tracked

### `test_api_calls`
Validates cross-stack tracing:
- Vue `axios` calls detected
- Endpoints matched to Laravel routes
- Frontend-backend connections mapped

## Output Format

Tests output color-coded results:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UNIVERSAL MCP TOOL TESTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEST: Basic symbol search across repository
✅ PASS: search_code finds Manager classes
   Expected: >0, Got: 7

TEST: who_calls finds reverse dependencies
✅ PASS: who_calls finds callers
   Expected: >0, Got: 16

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEST SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Tests Run:    18
Tests Passed:       18
Tests Failed:       0

🎉 ALL TESTS PASSED!
```

## Exit Codes

- `0`: All tests passed
- `1`: Some tests failed

## Integration with CI/CD

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Run MCP Tool Audits
  run: |
    npm run audit:mcp:all iemis
    npm run audit:mcp:all project_card_game
```

## When to Run

**Before deploying:**
- After modifying database queries
- After changing MCP tool logic
- After parser updates
- Before releases

**During development:**
- When adding new framework support
- When refactoring query code
- When adding new MCP tools

## Test Philosophy

### Pass Criteria

Tests use **flexible assertions** that account for varying project sizes:

- `>0`: "At least one result" (for searches)
- `>=90%`: "Coverage threshold" (for metadata)
- `"number"`: "Returns valid data" (for NULL tests)

This allows tests to work across projects of different sizes and structures.

### Framework-Aware Testing

Tests automatically detect framework capabilities:

```bash
if echo "$REPO_INFO" | grep -q "godot"; then
    run_godot_tests
fi

if echo "$REPO_INFO" | grep -q "laravel"; then
    run_laravel_tests
fi
```

This means:
- Godot tests only run on Godot projects
- Laravel tests only run on Laravel projects
- Universal tests run on all projects

## Troubleshooting

### "Repository not found"
Ensure the repository has been analyzed:
```bash
npm run analyze /path/to/repo
```

### "No dependencies to test"
The project might have no tracked dependencies. This is OK for small/simple projects.

### All tests pass but tools don't work
The audit tests SQL queries, not the TypeScript MCP tool code. You may have:
1. Logic errors in tool implementation
2. Incorrect parameter handling
3. Missing error handling

## File Structure

```
scripts/
├── run-mcp-audit.sh          # Main test runner
├── lib/
│   └── mcp-test-functions.sh # Test function library
└── MCP_AUDIT_README.md        # This file
```

## Adding New Tests

1. Add test function to `lib/mcp-test-functions.sh`
2. Call it from `run-mcp-audit.sh` in appropriate section
3. Use the `test_result` helper for consistent output

Example:

```bash
# In lib/mcp-test-functions.sh
test_my_new_feature() {
    local repo_id=$1

    echo "TEST: My new feature works"

    local result=$(count_query "SELECT COUNT(*) FROM my_table WHERE repo_id = $repo_id;")

    if [ "$result" -gt 0 ]; then
        test_result "My feature test" "PASS" ">0" "$result"
    else
        test_result "My feature test" "FAIL" ">0" "$result"
    fi
}

# In run-mcp-audit.sh
case $TEST_TYPE in
    "general"|"all")
        test_my_new_feature "$REPO_ID"
        ;;
esac
```

## Comparison: Database Audit vs MCP Audit

| Aspect | Database Audit | MCP Audit |
|--------|---------------|-----------|
| **What** | Data integrity | Query functionality |
| **Tests** | Duplicates, NULLs, orphans | Joins, filters, results |
| **Layer** | Storage layer | Business logic layer |
| **Runs** | After parsing | Before deployment |
| **Purpose** | Catch parser bugs | Catch query bugs |
| **Speed** | Fast (direct queries) | Fast (direct queries) |

Both are essential for ensuring system correctness!

## Coverage Matrix

| MCP Tool | Tested By | Status |
|----------|-----------|--------|
| `search_code` | ✅ `test_search_code_*` | Complete |
| `get_symbol` | ✅ `test_get_symbol` | Complete |
| `get_file` | ⚠️ Not yet tested | TODO |
| `who_calls` | ✅ `test_who_calls` | Complete |
| `list_dependencies` | ✅ `test_list_dependencies` | Complete |
| `impact_of` | ⚠️ Partial (dependency joins) | Partial |
| `trace_flow` | ⚠️ Not yet tested | TODO |
| `discover_feature` | ✅ `test_cross_stack_discovery` | Partial |

## Future Enhancements

- [ ] Add performance benchmarks (query execution time)
- [ ] Test pagination queries
- [ ] Test embedding-based search
- [ ] Test impact analysis recursion depth
- [ ] Add stress tests (large result sets)
- [ ] Mock MCP client requests
