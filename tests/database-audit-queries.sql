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
-- SECTION 11: ENTITY CLASSIFICATION & ADVANCED DEPENDENCIES
-- ============================================================================

\echo ''
\echo '=== TEST 26: Entity Type Distribution ==='
SELECT
    COALESCE(entity_type, 'unclassified') as entity_type,
    COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
GROUP BY entity_type
ORDER BY count DESC;

\echo ''
\echo '=== TEST 27: Framework-Aware Classification Quality ==='
SELECT
    f.language,
    COALESCE(s.entity_type, 'unclassified') as entity_type,
    COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.language IN ('php', 'typescript', 'vue', 'javascript')
GROUP BY f.language, s.entity_type
ORDER BY f.language, count DESC;

\echo ''
\echo '=== TEST 28: Vue Stores Classification ==='
SELECT
    COUNT(*) as total_stores,
    COUNT(*) FILTER (WHERE s.name LIKE 'use%Store') as pinia_pattern_stores,
    COUNT(*) FILTER (WHERE f.path LIKE '%/stores/%') as in_stores_directory
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.entity_type = 'store';

\echo ''
\echo 'Sample stores:'
SELECT s.name, f.path, s.symbol_type
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.entity_type = 'store'
    AND f.path LIKE '%/stores/%'
ORDER BY f.path
LIMIT 10;

\echo ''
\echo '=== TEST 29: Vue Composables Classification ==='
SELECT
    COUNT(*) as total_composables,
    COUNT(*) FILTER (WHERE s.name LIKE 'use%') as use_pattern,
    COUNT(*) FILTER (WHERE s.name LIKE 'create%') as create_pattern,
    COUNT(*) FILTER (WHERE f.path LIKE '%/composables/%' OR f.path LIKE '%/Composables/%') as in_composables_dir
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.entity_type = 'composable';

\echo ''
\echo 'Sample composables:'
SELECT s.name, s.symbol_type, f.path
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.entity_type = 'composable'
ORDER BY s.name
LIMIT 10;

\echo ''
\echo '=== TEST 30: Laravel Backend Classification ==='
SELECT
    s.entity_type,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE s.name LIKE '%Controller') as controller_suffix,
    COUNT(*) FILTER (WHERE s.name LIKE '%Service') as service_suffix,
    COUNT(*) FILTER (WHERE s.name LIKE '%Request') as request_suffix
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.language = 'php'
    AND s.symbol_type = 'class'
    AND s.entity_type IN ('controller', 'service', 'request', 'model', 'job')
GROUP BY s.entity_type
ORDER BY count DESC;

\echo ''
\echo '=== TEST 31: PHP Constructor Dependencies (IMPORTS) ==='
WITH constructor_lines AS (
    SELECT s1.file_id, s1.start_line, s1.end_line
    FROM symbols s1
    JOIN files f ON s1.file_id = f.id
    WHERE f.repo_id = {REPO_ID}
        AND s1.name = '__construct'
        AND f.language = 'php'
)
SELECT
    COUNT(DISTINCT d.id) as total_constructor_imports,
    COUNT(DISTINCT s.id) as classes_with_constructor_deps,
    ROUND(AVG(dep_count), 2) as avg_deps_per_class
FROM dependencies d
JOIN symbols s ON d.from_symbol_id = s.id
JOIN constructor_lines cl ON s.file_id = cl.file_id
    AND d.line_number BETWEEN cl.start_line AND cl.end_line
JOIN files f ON s.file_id = f.id
CROSS JOIN LATERAL (
    SELECT COUNT(*) as dep_count
    FROM dependencies d2
    WHERE d2.from_symbol_id = s.id
        AND d2.dependency_type = 'imports'
        AND d2.line_number BETWEEN cl.start_line AND cl.end_line
) counts
WHERE f.repo_id = {REPO_ID}
    AND d.dependency_type = 'imports'
    AND s.symbol_type = 'class';

\echo ''
\echo 'Sample classes with constructor dependencies:'
WITH constructor_lines AS (
    SELECT s1.file_id, s1.start_line, s1.end_line
    FROM symbols s1
    JOIN files f ON s1.file_id = f.id
    WHERE f.repo_id = {REPO_ID}
        AND s1.name = '__construct'
        AND f.language = 'php'
)
SELECT
    s1.name as class_name,
    s2.name as injected_service,
    d.line_number,
    f.path
FROM dependencies d
JOIN symbols s1 ON d.from_symbol_id = s1.id
JOIN symbols s2 ON d.to_symbol_id = s2.id
JOIN constructor_lines cl ON s1.file_id = cl.file_id
    AND d.line_number BETWEEN cl.start_line AND cl.end_line
JOIN files f ON s1.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND d.dependency_type = 'imports'
    AND s1.symbol_type = 'class'
ORDER BY s1.name, d.line_number
LIMIT 20;

\echo ''
\echo '=== TEST 32: Vue State Field Type REFERENCES ==='
SELECT
    COUNT(DISTINCT d.id) as total_state_type_refs,
    COUNT(DISTINCT s1.id) as stores_with_type_refs,
    ROUND(AVG(ref_count), 2) as avg_refs_per_store
FROM dependencies d
JOIN symbols s1 ON d.from_symbol_id = s1.id
JOIN files f ON s1.file_id = f.id
CROSS JOIN LATERAL (
    SELECT COUNT(*) as ref_count
    FROM dependencies d2
    WHERE d2.from_symbol_id = s1.id
        AND d2.dependency_type = 'references'
) counts
WHERE f.repo_id = {REPO_ID}
    AND d.dependency_type = 'references'
    AND s1.entity_type = 'store';

\echo ''
\echo 'Sample stores with state type references:'
SELECT
    s1.name as store_name,
    s2.name as referenced_type,
    d.line_number,
    f.path
FROM dependencies d
JOIN symbols s1 ON d.from_symbol_id = s1.id
JOIN symbols s2 ON d.to_symbol_id = s2.id
JOIN files f ON s1.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND d.dependency_type = 'references'
    AND s1.entity_type = 'store'
ORDER BY s1.name, d.line_number
LIMIT 20;

\echo ''
\echo '=== TEST 33: Entity Type vs Symbol Type Consistency ==='
SELECT
    s.symbol_type,
    s.entity_type,
    COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.entity_type IS NOT NULL
GROUP BY s.symbol_type, s.entity_type
ORDER BY count DESC
LIMIT 20;

\echo ''
\echo '=== TEST 34: Classification Priority Validation ==='
-- Check for useXxxStore DEFINITIONS in /stores/ directory (should be 'store' not 'composable')
SELECT
    'useXxxStore definitions (priority 12 > 10)' as test,
    COUNT(*) as total_definitions,
    COUNT(*) FILTER (WHERE entity_type = 'store') as classified_as_store,
    COUNT(*) FILTER (WHERE entity_type = 'composable') as misclassified_as_composable,
    CASE
        WHEN COUNT(*) FILTER (WHERE entity_type = 'composable') = 0 THEN '✓ PASS'
        ELSE '✗ FAIL'
    END as status
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.name ~ '^use[A-Z].*Store$'
    AND s.symbol_type = 'variable'
    AND f.path LIKE '%/stores/%'
    AND f.language IN ('typescript', 'javascript');

\echo ''
\echo 'Distribution of useXxxStore symbols (definitions vs usages):'
SELECT
    CASE
        WHEN f.path LIKE '%/stores/%' THEN 'Definition (in /stores/)'
        ELSE 'Usage (elsewhere)'
    END as symbol_location,
    COALESCE(s.entity_type, 'unclassified') as entity_type,
    COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.name ~ '^use[A-Z].*Store$'
    AND f.language IN ('typescript', 'vue', 'javascript')
GROUP BY symbol_location, s.entity_type
ORDER BY symbol_location, count DESC;

-- ============================================================================
-- SECTION 12: EMPTY OR NONSENSICAL DATA DETECTION
-- ============================================================================

\echo ''
\echo '=== TEST 35: Empty or Whitespace Symbol Names ==='
SELECT COUNT(*) as empty_or_whitespace_names
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND (s.name = '' OR s.name ~ '^\s+$');

\echo ''
\echo '=== TEST 36: File Paths Sanity ==='
SELECT
    COUNT(*) as total_files,
    COUNT(*) FILTER (WHERE path IS NULL OR path = '') as missing_paths,
    COUNT(*) FILTER (WHERE NOT path LIKE '/%') as relative_paths
FROM files
WHERE repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 37: PHP Classes Missing Qualified Names ==='
SELECT COUNT(*) as missing_qn
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.path LIKE '%.php'
    AND s.symbol_type = 'class'
    AND (s.qualified_name IS NULL OR s.qualified_name = '');

\echo ''
\echo '=== TEST 38: C# Constructor Dependencies (IMPORTS) ==='
WITH constructor_symbols AS (
    SELECT
        s.id as constructor_id,
        s.parent_symbol_id as class_id,
        s.start_line,
        parent.name as class_name
    FROM symbols s
    JOIN symbols parent ON s.parent_symbol_id = parent.id
    JOIN files f ON s.file_id = f.id
    WHERE f.repo_id = {REPO_ID}
        AND f.language = 'csharp'
        AND s.symbol_type = 'method'
        AND s.name = parent.name
)
SELECT
    COUNT(DISTINCT cs.constructor_id) as total_constructors,
    COUNT(DISTINCT cs.class_id) as classes_with_constructors,
    COUNT(DISTINCT d.id) as constructor_import_dependencies,
    COUNT(DISTINCT d.to_symbol_id) as unique_types_imported,
    ROUND(AVG(dep_count), 2) as avg_deps_per_constructor
FROM constructor_symbols cs
LEFT JOIN dependencies d ON d.from_symbol_id = cs.class_id
    AND d.line_number = cs.start_line
    AND d.dependency_type = 'imports'
LEFT JOIN LATERAL (
    SELECT COUNT(*) as dep_count
    FROM dependencies d2
    WHERE d2.from_symbol_id = cs.class_id
        AND d2.line_number = cs.start_line
        AND d2.dependency_type = 'imports'
) counts ON true;

\echo ''
\echo 'Sample C# classes with constructor dependencies:'
WITH constructor_symbols AS (
    SELECT
        s.id as constructor_id,
        s.parent_symbol_id as class_id,
        s.start_line,
        parent.name as class_name
    FROM symbols s
    JOIN symbols parent ON s.parent_symbol_id = parent.id
    JOIN files f ON s.file_id = f.id
    WHERE f.repo_id = {REPO_ID}
        AND f.language = 'csharp'
        AND s.symbol_type = 'method'
        AND s.name = parent.name
)
SELECT
    cs.class_name,
    to_sym.name as injected_type,
    d.line_number,
    f.path
FROM constructor_symbols cs
JOIN dependencies d ON d.from_symbol_id = cs.class_id
    AND d.line_number = cs.start_line
    AND d.dependency_type = 'imports'
JOIN symbols to_sym ON d.to_symbol_id = to_sym.id
JOIN files f ON f.id = (SELECT file_id FROM symbols WHERE id = cs.class_id)
ORDER BY cs.class_name, d.line_number
LIMIT 20;

\echo ''
\echo '=== TEST 39: Language Detection Correctness ==='
SELECT
    r.name as repository_name,
    r.language_primary as detected_language,
    most_common.language as most_common_file_language,
    most_common.file_count,
    most_common.percentage,
    CASE
        WHEN r.language_primary = most_common.language THEN '✓ CORRECT'
        WHEN r.language_primary = 'unknown' AND most_common.file_count = 0 THEN '✓ CORRECT (no files)'
        ELSE '✗ MISMATCH - detectPrimaryLanguage() may have used fallback'
    END as validation_status
FROM repositories r
LEFT JOIN LATERAL (
    SELECT
        f.language,
        COUNT(*) as file_count,
        ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM files WHERE repo_id = r.id), 0), 1) as percentage
    FROM files f
    WHERE f.repo_id = r.id
        AND f.language IS NOT NULL
        AND f.language != 'unknown'
    GROUP BY f.language
    ORDER BY COUNT(*) DESC
    LIMIT 1
) most_common ON true
WHERE r.id = {REPO_ID};

\echo ''
\echo 'File language distribution:'
SELECT
    f.language,
    COUNT(*) as file_count,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM files WHERE repo_id = {REPO_ID}), 1) as percentage
FROM files f
WHERE f.repo_id = {REPO_ID}
    AND f.language IS NOT NULL
GROUP BY f.language
ORDER BY file_count DESC;

\echo ''
\echo '=== TEST 40: Multi-Framework Entity Type Coverage ==='
SELECT
    framework_category,
    entity_type,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY framework_category), 1) as pct_in_category
FROM (
    SELECT
        CASE
            WHEN s.entity_type IN ('store', 'component', 'composable') THEN 'Vue Frontend'
            WHEN s.entity_type IN ('controller', 'service', 'request', 'model', 'job') THEN 'Laravel Backend'
            WHEN s.entity_type IN ('node', 'ui_component', 'resource') THEN 'Godot Engine'
            WHEN s.entity_type IN ('manager', 'handler', 'coordinator', 'engine', 'pool') THEN 'Infrastructure'
            WHEN s.entity_type IN ('repository', 'factory', 'builder', 'validator', 'adapter') THEN 'Data Patterns'
            WHEN s.entity_type IN ('middleware', 'notification', 'command', 'provider') THEN 'Laravel Middleware'
            ELSE 'Other'
        END as framework_category,
        s.entity_type
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    WHERE f.repo_id = {REPO_ID}
        AND s.entity_type IS NOT NULL
) categorized
GROUP BY framework_category, entity_type
ORDER BY framework_category, count DESC;

\echo ''
\echo 'Entity type coverage summary by framework:'
SELECT
    framework_category,
    COUNT(DISTINCT entity_type) as unique_entity_types,
    COUNT(*) as total_symbols,
    STRING_AGG(DISTINCT entity_type, ', ' ORDER BY entity_type) as entity_types_found
FROM (
    SELECT
        CASE
            WHEN s.entity_type IN ('store', 'component', 'composable') THEN 'Vue Frontend'
            WHEN s.entity_type IN ('controller', 'service', 'request', 'model', 'job') THEN 'Laravel Backend'
            WHEN s.entity_type IN ('node', 'ui_component', 'resource') THEN 'Godot Engine'
            WHEN s.entity_type IN ('manager', 'handler', 'coordinator', 'engine', 'pool') THEN 'Infrastructure'
            WHEN s.entity_type IN ('repository', 'factory', 'builder', 'validator', 'adapter') THEN 'Data Patterns'
            WHEN s.entity_type IN ('middleware', 'notification', 'command', 'provider') THEN 'Laravel Middleware'
            ELSE 'Other'
        END as framework_category,
        s.entity_type
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    WHERE f.repo_id = {REPO_ID}
        AND s.entity_type IS NOT NULL
) categorized
GROUP BY framework_category
ORDER BY total_symbols DESC;

-- ============================================================================
-- SECTION 13: SUMMARY STATISTICS
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
