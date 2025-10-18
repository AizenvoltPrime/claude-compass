/**
 * Database Quality Audit Queries for Claude Compass
 *
 * This file contains a comprehensive set of SQL queries to audit database quality
 * for multi-framework projects (Laravel, Vue, C#, TypeScript, PHP, etc.)
 *
 * Usage:
 *   Run against PostgreSQL database to verify:
 *   - Data integrity and referential constraints
 *   - Symbol completeness and accuracy
 *   - Framework-specific entity tracking
 *   - Parser coverage and quality
 *
 * Replace {REPO_ID} with your repository ID before running.
 */

-- ============================================================================
-- SECTION 1: REPOSITORY INFORMATION
-- ============================================================================

\echo '=== Repository Information ==='
SELECT
    id,
    name,
    path,
    language_primary,
    framework_stack,
    last_indexed,
    (SELECT COUNT(*) FROM files WHERE repo_id = repositories.id) as file_count,
    (SELECT COUNT(*) FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.repo_id = repositories.id) as symbol_count
FROM repositories
WHERE id = {REPO_ID}
ORDER BY last_indexed DESC;

-- ============================================================================
-- SECTION 2: FILE TYPE COVERAGE
-- ============================================================================

\echo ''
\echo '=== File Type Distribution ==='
SELECT
    CASE
        WHEN path LIKE '%.cs' THEN '.cs (C#)'
        WHEN path LIKE '%.php' THEN '.php'
        WHEN path LIKE '%.ts' THEN '.ts'
        WHEN path LIKE '%.tsx' THEN '.tsx'
        WHEN path LIKE '%.js' THEN '.js'
        WHEN path LIKE '%.jsx' THEN '.jsx'
        WHEN path LIKE '%.vue' THEN '.vue'
        WHEN path LIKE '%.blade.php' THEN '.blade.php'
        WHEN path LIKE '%.tscn' THEN '.tscn (Godot)'
        ELSE 'other'
    END as file_type,
    COUNT(*) as file_count,
    SUM((SELECT COUNT(*) FROM symbols WHERE file_id = files.id)) as symbols_per_type
FROM files
WHERE repo_id = {REPO_ID}
GROUP BY file_type
ORDER BY file_count DESC;

\echo ''
\echo '=== C# Files Found ==='
SELECT COUNT(*) as cs_file_count
FROM files
WHERE repo_id = {REPO_ID} AND path LIKE '%.cs';

\echo ''
\echo '=== Sample File Paths by Type ==='
SELECT DISTINCT
    CASE
        WHEN path LIKE '%.cs' THEN 'C#'
        WHEN path LIKE '%.php' THEN 'PHP'
        WHEN path LIKE '%.ts' THEN 'TypeScript'
        WHEN path LIKE '%.vue' THEN 'Vue'
        ELSE 'Other'
    END as file_type,
    path
FROM files
WHERE repo_id = {REPO_ID}
ORDER BY file_type, path
LIMIT 20;

-- ============================================================================
-- SECTION 3: DATA INTEGRITY TESTS
-- ============================================================================

\echo ''
\echo '=== TEST 1: Required Fields - Symbols ==='
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE name IS NULL OR name = '') as null_or_empty_names,
    COUNT(*) FILTER (WHERE symbol_type IS NULL) as null_types,
    COUNT(*) FILTER (WHERE file_id IS NULL) as null_file_ids,
    COUNT(*) FILTER (WHERE start_line IS NULL) as null_start_lines,
    COUNT(*) FILTER (WHERE end_line IS NULL) as null_end_lines
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 2: Referential Integrity ==='
SELECT
    (SELECT COUNT(*)
     FROM symbols s
     LEFT JOIN files f ON s.file_id = f.id
     WHERE f.id IS NULL
       AND s.file_id IN (SELECT id FROM files WHERE repo_id = {REPO_ID})) as orphaned_symbols,
    (SELECT COUNT(*)
     FROM dependencies d
     LEFT JOIN symbols s ON d.from_symbol_id = s.id
     WHERE s.id IS NULL
       AND d.from_symbol_id IN (SELECT s.id FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.repo_id = {REPO_ID})) as orphaned_dependencies;

\echo ''
\echo '=== TEST 3: True Duplicates (same name, type, file, line) ==='
SELECT name, symbol_type, file_id, start_line, COUNT(*) as occurrences
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
GROUP BY name, symbol_type, file_id, start_line
HAVING COUNT(*) > 1
ORDER BY occurrences DESC
LIMIT 10;

-- ============================================================================
-- SECTION 4: SYMBOL QUALITY ANALYSIS
-- ============================================================================

\echo ''
\echo '=== TEST 4: Qualified Name Coverage by Type ==='
SELECT
    symbol_type,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE qualified_name IS NOT NULL AND qualified_name != '') as has_qualified_name,
    ROUND(100.0 * COUNT(*) FILTER (WHERE qualified_name IS NOT NULL AND qualified_name != '') / COUNT(*), 2) as coverage_pct
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND symbol_type IN ('class', 'struct', 'enum', 'interface', 'function', 'method')
GROUP BY symbol_type
ORDER BY symbol_type;

\echo ''
\echo '=== TEST 5: Symbol Type Distribution ==='
SELECT symbol_type, COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
GROUP BY symbol_type
ORDER BY count DESC;

\echo ''
\echo '=== TEST 6: Framework Distribution ==='
SELECT
    COALESCE(framework, 'unclassified') as framework,
    COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
GROUP BY framework
ORDER BY count DESC;

\echo ''
\echo '=== TEST 7: Qualified Name Coverage by File Type ==='
SELECT
    CASE
        WHEN f.path LIKE '%.cs' THEN 'C#'
        WHEN f.path LIKE '%.php' THEN 'PHP'
        WHEN f.path LIKE '%.ts' THEN 'TypeScript'
        WHEN f.path LIKE '%.vue' THEN 'Vue'
        WHEN f.path LIKE '%.js' THEN 'JavaScript'
        ELSE 'Other'
    END as file_type,
    s.symbol_type,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE s.qualified_name IS NOT NULL AND s.qualified_name != '') as has_qn,
    ROUND(100.0 * COUNT(*) FILTER (WHERE s.qualified_name IS NOT NULL AND s.qualified_name != '') / COUNT(*), 2) as pct
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.symbol_type IN ('class', 'function', 'method', 'interface')
GROUP BY file_type, s.symbol_type
ORDER BY file_type, s.symbol_type;

\echo ''
\echo '=== TEST 8: Sample Missing Qualified Names ==='
SELECT s.name, s.symbol_type, f.path
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.symbol_type IN ('class', 'function', 'method')
    AND (s.qualified_name IS NULL OR s.qualified_name = '')
LIMIT 20;

-- ============================================================================
-- SECTION 5: FRAMEWORK-SPECIFIC ENTITIES
-- ============================================================================

\echo ''
\echo '=== TEST 9: Laravel Routes ==='
SELECT COUNT(*) as total_routes
FROM routes
WHERE repo_id = {REPO_ID};

\echo ''
\echo 'Sample routes:'
SELECT path, method, controller_class, controller_method
FROM routes
WHERE repo_id = {REPO_ID}
ORDER BY path
LIMIT 10;

\echo ''
\echo 'Routes by Framework Type:'
SELECT framework_type, COUNT(*) as count
FROM routes
WHERE repo_id = {REPO_ID}
GROUP BY framework_type;

\echo ''
\echo '=== TEST 10: Components ==='
SELECT COUNT(*) as total_components
FROM components
WHERE repo_id = {REPO_ID};

\echo ''
\echo 'Components by Type:'
SELECT
    component_type,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE props IS NOT NULL AND jsonb_array_length(props) > 0) as has_props,
    COUNT(*) FILTER (WHERE emits IS NOT NULL AND jsonb_array_length(emits) > 0) as has_emits
FROM components
WHERE repo_id = {REPO_ID}
GROUP BY component_type;

\echo ''
\echo 'Sample components with names:'
SELECT c.component_type, s.name as component_name, f.path
FROM components c
JOIN symbols s ON c.symbol_id = s.id
JOIN files f ON s.file_id = f.id
WHERE c.repo_id = {REPO_ID}
LIMIT 10;

-- ============================================================================
-- SECTION 6: LINE NUMBER & CODE QUALITY
-- ============================================================================

\echo ''
\echo '=== TEST 11: Line Number Coverage ==='
SELECT
    ROUND(100.0 * COUNT(*) FILTER (WHERE start_line IS NOT NULL) / COUNT(*), 2) as line_coverage_pct,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE start_line IS NOT NULL) as has_lines
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 12: Line Number Sanity Checks ==='
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE start_line < 1) as invalid_start_lines,
    COUNT(*) FILTER (WHERE end_line < start_line) as end_before_start,
    COUNT(*) FILTER (WHERE end_line - start_line > 10000) as unreasonably_large_symbols
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 13: Empty Signature Check ==='
SELECT
    symbol_type,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE signature IS NULL OR signature = '') as empty_signatures,
    ROUND(100.0 * COUNT(*) FILTER (WHERE signature IS NOT NULL AND signature != '') / COUNT(*), 2) as sig_coverage_pct
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND symbol_type IN ('method', 'function', 'class', 'interface')
GROUP BY symbol_type;

\echo ''
\echo '=== TEST 14: Visibility Distribution ==='
SELECT visibility, COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID} AND visibility IS NOT NULL
GROUP BY visibility
ORDER BY count DESC;

-- ============================================================================
-- SECTION 7: C# / .NET SPECIFIC ANALYSIS
-- ============================================================================

\echo ''
\echo '=== TEST 15: C# Symbol Analysis ==='
SELECT symbol_type, COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID} AND f.path LIKE '%.cs'
GROUP BY symbol_type
ORDER BY count DESC;

\echo ''
\echo '=== TEST 16: C# Structs Classification ==='
SELECT COUNT(*) as struct_count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID} AND f.path LIKE '%.cs' AND s.symbol_type = 'struct';

\echo ''
\echo '=== TEST 17: C# Classes and Interfaces ==='
SELECT
    s.name,
    s.symbol_type,
    s.qualified_name,
    s.namespace,
    s.start_line,
    s.end_line,
    f.path
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.path LIKE '%.cs'
    AND s.symbol_type IN ('class', 'interface', 'struct')
ORDER BY f.path, s.start_line;

\echo ''
\echo '=== TEST 18: C# Methods with Missing Qualified Names ==='
SELECT s.name, s.symbol_type, s.qualified_name, f.path
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.path LIKE '%.cs'
    AND s.symbol_type = 'method'
    AND (s.qualified_name IS NULL OR s.qualified_name = '')
LIMIT 15;

-- ============================================================================
-- SECTION 8: GODOT FRAMEWORK (if applicable)
-- ============================================================================

\echo ''
\echo '=== TEST 19: Godot Nodes (if present) ==='
SELECT
    COUNT(*) as total_nodes,
    COUNT(*) FILTER (WHERE parent_node_id IS NOT NULL) as nodes_with_parents,
    COUNT(*) FILTER (WHERE parent_node_id IS NULL) as root_nodes,
    ROUND(100.0 * COUNT(*) FILTER (WHERE parent_node_id IS NOT NULL) / COUNT(*), 2) as parent_coverage_pct
FROM godot_nodes
WHERE repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 20: Godot Scenes (if present) ==='
SELECT
    gs.scene_name,
    gs.node_count as recorded_count,
    COUNT(gn.id) as actual_count,
    CASE
        WHEN gs.node_count = COUNT(gn.id) THEN '✓ MATCH'
        ELSE '✗ MISMATCH'
    END as status
FROM godot_scenes gs
LEFT JOIN godot_nodes gn ON gn.scene_id = gs.id
WHERE gs.repo_id = {REPO_ID}
GROUP BY gs.id, gs.scene_name, gs.node_count
ORDER BY status DESC, gs.scene_name;

\echo ''
\echo '=== TEST 21: Circular Parent References in Godot Nodes ==='
WITH RECURSIVE ancestors AS (
    SELECT id, parent_node_id, 1 as depth, ARRAY[id] as path
    FROM godot_nodes
    WHERE repo_id = {REPO_ID} AND parent_node_id IS NOT NULL

    UNION ALL

    SELECT a.id, gn.parent_node_id, a.depth + 1, a.path || gn.id
    FROM ancestors a
    JOIN godot_nodes gn ON a.parent_node_id = gn.id
    WHERE gn.repo_id = {REPO_ID}
        AND a.depth < 100
        AND gn.id != ALL(a.path)
)
SELECT COUNT(*) as nodes_in_circular_refs
FROM ancestors
WHERE id = ANY(path[2:array_length(path, 1)]);

-- ============================================================================
-- SECTION 9: API CALLS & CROSS-STACK ANALYSIS
-- ============================================================================

\echo ''
\echo '=== TEST 22: API Calls (Vue to Laravel) ==='
SELECT COUNT(*) as total_api_calls
FROM api_calls
WHERE repo_id = {REPO_ID};

\echo ''
\echo 'Sample API calls:'
SELECT
    ac.endpoint_path,
    ac.http_method,
    f.path as caller_file
FROM api_calls ac
JOIN symbols s ON ac.caller_symbol_id = s.id
JOIN files f ON s.file_id = f.id
WHERE ac.repo_id = {REPO_ID}
ORDER BY ac.endpoint_path
LIMIT 10;

-- ============================================================================
-- SECTION 10: FILE & DEPENDENCY ANALYSIS
-- ============================================================================

\echo ''
\echo '=== TEST 23: Files with No Symbols ==='
SELECT
    f.path,
    CASE
        WHEN f.path LIKE '%.ts' THEN 'TypeScript'
        WHEN f.path LIKE '%.js' THEN 'JavaScript'
        WHEN f.path LIKE '%.vue' THEN 'Vue'
        WHEN f.path LIKE '%.php' THEN 'PHP'
        WHEN f.path LIKE '%.cs' THEN 'C#'
        ELSE 'Other'
    END as file_type
FROM files f
LEFT JOIN symbols s ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
GROUP BY f.id, f.path
HAVING COUNT(s.id) = 0;

\echo ''
\echo '=== TEST 24: Dependencies Quality ==='
SELECT
    COUNT(*) as total_dependencies,
    COUNT(DISTINCT from_symbol_id) as unique_sources,
    COUNT(DISTINCT to_symbol_id) as unique_targets,
    COUNT(*) FILTER (WHERE dependency_type IS NULL) as missing_dep_type
FROM dependencies d
JOIN symbols s ON d.from_symbol_id = s.id
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 25: Dependency Type Distribution ==='
SELECT
    dependency_type,
    COUNT(*) as count
FROM dependencies d
JOIN symbols s ON d.from_symbol_id = s.id
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
GROUP BY dependency_type
ORDER BY count DESC;

-- ============================================================================
-- SECTION 11: EMPTY OR NONSENSICAL DATA DETECTION
-- ============================================================================

\echo ''
\echo '=== TEST 26: Empty or Whitespace Symbol Names ==='
SELECT COUNT(*) as empty_or_whitespace_names
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND (s.name = '' OR s.name ~ '^\s+$');

\echo ''
\echo '=== TEST 27: File Paths Sanity ==='
SELECT
    COUNT(*) as total_files,
    COUNT(*) FILTER (WHERE path IS NULL OR path = '') as missing_paths,
    COUNT(*) FILTER (WHERE NOT path LIKE '/%') as relative_paths
FROM files
WHERE repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 28: PHP Classes Missing Qualified Names ==='
SELECT COUNT(*) as missing_qn
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.path LIKE '%.php'
    AND s.symbol_type = 'class'
    AND (s.qualified_name IS NULL OR s.qualified_name = '');

-- ============================================================================
-- SECTION 12: SUMMARY STATISTICS
-- ============================================================================

\echo ''
\echo '=== AUDIT SUMMARY ==='
SELECT
    'Files Analyzed' as metric,
    COUNT(*)::text as value
FROM files
WHERE repo_id = {REPO_ID}

UNION ALL

SELECT
    'Total Symbols',
    COUNT(*)::text
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}

UNION ALL

SELECT
    'Total Dependencies',
    COUNT(*)::text
FROM dependencies d
JOIN symbols s ON d.from_symbol_id = s.id
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}

UNION ALL

SELECT
    'Laravel Routes',
    COUNT(*)::text
FROM routes
WHERE repo_id = {REPO_ID}

UNION ALL

SELECT
    'Vue Components',
    COUNT(*)::text
FROM components
WHERE repo_id = {REPO_ID}

UNION ALL

SELECT
    'API Calls Tracked',
    COUNT(*)::text
FROM api_calls
WHERE repo_id = {REPO_ID}

UNION ALL

SELECT
    'Line Coverage %',
    ROUND(100.0 * COUNT(*) FILTER (WHERE start_line IS NOT NULL) / COUNT(*), 2)::text
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID};

\echo ''
\echo '=== AUDIT COMPLETE ==='
\echo 'Review results above for any issues or inconsistencies.'
\echo 'Expected: Zero orphaned symbols, zero duplicates, 100% line coverage.'
