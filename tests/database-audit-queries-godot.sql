/**
 * Database Quality Audit Queries - Godot & C# Projects
 *
 * Comprehensive test suite for C# Godot game projects with advanced
 * Godot framework validation and game-specific entity tracking.
 *
 * This test suite includes:
 * - C# struct classification validation
 * - Godot scene hierarchy correctness
 * - Node parent relationship validation
 * - Scene composition graph verification
 * - Game-specific quality checks
 *
 * Usage:
 *   Replace {REPO_ID} with your repository ID before running.
 *   Run against PostgreSQL database to verify game project quality.
 *
 * Example:
 *   sed 's/{REPO_ID}/2/g' tests/database-audit-queries-godot.sql | \
 *   docker exec -i claude-compass-postgres psql -U claude_compass -d claude_compass
 */

-- ============================================================================
-- SECTION 1: PROJECT OVERVIEW
-- ============================================================================

\echo '=== PROJECT INFORMATION ==='
SELECT
    id,
    name,
    path,
    language_primary,
    framework_stack,
    last_indexed,
    (SELECT COUNT(*) FROM files WHERE repo_id = repositories.id) as total_files,
    (SELECT COUNT(*) FROM files WHERE repo_id = repositories.id AND path LIKE '%.cs') as cs_files,
    (SELECT COUNT(*) FROM files WHERE repo_id = repositories.id AND path LIKE '%.tscn') as scene_files,
    (SELECT COUNT(*) FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.repo_id = repositories.id) as total_symbols
FROM repositories
WHERE id = {REPO_ID};

\echo ''
\echo '=== File Type Distribution ==='
SELECT
    CASE
        WHEN path LIKE '%.cs' THEN '.cs (C#)'
        WHEN path LIKE '%.tscn' THEN '.tscn (Godot Scene)'
        WHEN path LIKE '%.godot' THEN '.godot (Config)'
        WHEN path LIKE '%.tres' THEN '.tres (Resource)'
        WHEN path LIKE '%.shader' THEN '.shader'
        ELSE 'other'
    END as file_type,
    COUNT(*) as file_count,
    SUM((SELECT COUNT(*) FROM symbols WHERE file_id = files.id)) as symbols_per_type
FROM files
WHERE repo_id = {REPO_ID}
GROUP BY file_type
ORDER BY file_count DESC;

-- ============================================================================
-- SECTION 2: CORE DATA INTEGRITY
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
       AND d.from_symbol_id IN (SELECT s.id FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.repo_id = {REPO_ID})) as orphaned_dependencies,
    (SELECT COUNT(*)
     FROM godot_nodes gn
     LEFT JOIN godot_scenes gs ON gn.scene_id = gs.id
     WHERE gs.id IS NULL AND gn.repo_id = {REPO_ID}) as orphaned_nodes;

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

\echo ''
\echo '=== TEST 4: Line Number Coverage ==='
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE start_line IS NOT NULL) as has_start_line,
    COUNT(*) FILTER (WHERE end_line IS NOT NULL) as has_end_line,
    ROUND(100.0 * COUNT(*) FILTER (WHERE start_line IS NOT NULL) / COUNT(*), 2) as start_line_pct
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID};

-- ============================================================================
-- SECTION 3: C# SYMBOL ANALYSIS
-- ============================================================================

\echo ''
\echo '=== TEST 5: C# Symbol Type Distribution ==='
SELECT symbol_type, COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID} AND f.path LIKE '%.cs'
GROUP BY symbol_type
ORDER BY count DESC;

\echo ''
\echo '=== TEST 6: C# Struct Classification (CRITICAL) ==='
SELECT
    COUNT(*) FILTER (WHERE symbol_type = 'struct') as correctly_classified_structs,
    COUNT(*) FILTER (WHERE symbol_type = 'class' AND signature LIKE 'struct %') as misclassified_structs,
    COUNT(*) FILTER (WHERE symbol_type = 'struct') + COUNT(*) FILTER (WHERE symbol_type = 'class' AND signature LIKE 'struct %') as total_structs
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID} AND f.path LIKE '%.cs';

\echo ''
\echo '=== TEST 7: C# Structs Detail ==='
SELECT
    s.name,
    s.symbol_type,
    s.qualified_name,
    s.start_line,
    s.end_line,
    f.path
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.path LIKE '%.cs'
    AND s.symbol_type = 'struct'
ORDER BY s.name;

\echo ''
\echo '=== TEST 8: C# Qualified Name Coverage ==='
SELECT
    symbol_type,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE qualified_name IS NOT NULL AND qualified_name != '') as has_qualified_name,
    ROUND(100.0 * COUNT(*) FILTER (WHERE qualified_name IS NOT NULL AND qualified_name != '') / COUNT(*), 2) as coverage_pct
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.path LIKE '%.cs'
    AND symbol_type IN ('class', 'struct', 'enum', 'interface')
GROUP BY symbol_type
ORDER BY symbol_type;

\echo ''
\echo '=== TEST 9: C# Classes and Interfaces ==='
SELECT
    s.name,
    s.symbol_type,
    s.qualified_name,
    s.namespace,
    s.start_line,
    s.end_line
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.path LIKE '%.cs'
    AND s.symbol_type IN ('class', 'struct', 'interface', 'enum')
ORDER BY s.symbol_type, s.name;

\echo ''
\echo '=== TEST 10: C# Methods Missing Qualified Names ==='
SELECT
    s.name,
    s.symbol_type,
    s.qualified_name,
    CASE
        WHEN s.qualified_name IS NULL OR s.qualified_name = '' THEN 'Missing'
        ELSE 'Has QN'
    END as status,
    f.path
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND f.path LIKE '%.cs'
    AND s.symbol_type = 'method'
    AND (s.qualified_name IS NULL OR s.qualified_name = '')
LIMIT 20;

-- ============================================================================
-- SECTION 4: GODOT FRAMEWORK ENTITIES
-- ============================================================================

\echo ''
\echo '=== TEST 11: Godot Entity Counts ==='
SELECT
    (SELECT COUNT(*) FROM godot_scenes WHERE repo_id = {REPO_ID}) as total_scenes,
    (SELECT COUNT(*) FROM godot_nodes WHERE repo_id = {REPO_ID}) as total_nodes,
    (SELECT COUNT(*) FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.repo_id = {REPO_ID} AND s.symbol_type = 'godot_scene') as scene_symbols,
    (SELECT COUNT(*) FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.repo_id = {REPO_ID} AND s.symbol_type = 'godot_node') as node_symbols;

\echo ''
\echo '=== TEST 12: Godot Scenes Detail ==='
SELECT
    scene_name,
    scene_path,
    node_count,
    has_script,
    (SELECT COUNT(*) FROM godot_nodes WHERE scene_id = godot_scenes.id) as actual_node_count,
    CASE
        WHEN node_count = (SELECT COUNT(*) FROM godot_nodes WHERE scene_id = godot_scenes.id) THEN '✓ MATCH'
        ELSE '✗ MISMATCH'
    END as node_count_status
FROM godot_scenes
WHERE repo_id = {REPO_ID}
ORDER BY scene_name;

\echo ''
\echo '=== TEST 13: Godot Nodes - Required Fields ==='
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE node_name IS NULL OR node_name = '') as null_or_empty_node_names,
    COUNT(*) FILTER (WHERE node_type IS NULL OR node_type = '') as null_or_empty_node_types,
    COUNT(*) FILTER (WHERE scene_id IS NULL) as null_scene_ids,
    COUNT(*) FILTER (WHERE properties IS NULL) as null_properties
FROM godot_nodes
WHERE repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 14: Godot Node Parent Coverage ==='
SELECT
    COUNT(*) as total_nodes,
    COUNT(*) FILTER (WHERE parent_node_id IS NOT NULL) as nodes_with_parents,
    COUNT(*) FILTER (WHERE parent_node_id IS NULL) as root_nodes,
    ROUND(100.0 * COUNT(*) FILTER (WHERE parent_node_id IS NOT NULL) / COUNT(*), 2) as parent_coverage_pct
FROM godot_nodes
WHERE repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 15: Godot Root Nodes by Scene ==='
SELECT
    gs.scene_name,
    COUNT(gn.id) FILTER (WHERE gn.parent_node_id IS NULL) as root_node_count
FROM godot_scenes gs
LEFT JOIN godot_nodes gn ON gn.scene_id = gs.id
WHERE gs.repo_id = {REPO_ID}
GROUP BY gs.id, gs.scene_name
ORDER BY gs.scene_name;

-- ============================================================================
-- SECTION 5: GODOT HIERARCHY VALIDATION (CRITICAL)
-- ============================================================================

\echo ''
\echo '=== TEST 16: Duplicate Node Names (Should be ALLOWED under different parents) ==='
SELECT
    node_name,
    scene_id,
    COUNT(*) as occurrences,
    COUNT(DISTINCT parent_node_id) as different_parents
FROM godot_nodes
WHERE repo_id = {REPO_ID}
GROUP BY node_name, scene_id
HAVING COUNT(*) > 1
ORDER BY occurrences DESC
LIMIT 10;

\echo ''
\echo '=== TEST 17: Node Distribution Patterns (Parent-Child Ratios) ==='
\echo 'Checking for 1:N patterns that might indicate hierarchy bugs...'
SELECT
    parent.node_name as parent_name,
    child.node_name as child_name,
    COUNT(child.id) as child_count,
    MIN(child.id) as first_child_id,
    MAX(child.id) as last_child_id,
    CASE
        WHEN COUNT(child.id) > 10 THEN '⚠️ High ratio - verify correctness'
        ELSE '✓ Normal'
    END as status
FROM godot_nodes parent
JOIN godot_nodes child ON child.parent_node_id = parent.id
WHERE parent.repo_id = {REPO_ID}
GROUP BY parent.id, parent.node_name, child.node_name
HAVING COUNT(child.id) > 1
ORDER BY child_count DESC
LIMIT 20;

\echo ''
\echo '=== TEST 18: Verify Even Distribution Patterns ==='
\echo 'Example: If you have N parents of type X and N children of type Y,'
\echo 'this checks if distribution is N×1 (correct) vs 1×N (bug)...'
SELECT
    parent.node_name as parent_type,
    child_name,
    COUNT(DISTINCT parent.id) as parent_count,
    COUNT(child_id) as total_children,
    CASE
        WHEN COUNT(DISTINCT parent.id) > 0 THEN
            ROUND(COUNT(child_id)::numeric / COUNT(DISTINCT parent.id), 2)
        ELSE 0
    END as avg_children_per_parent,
    MIN(child_count) as min_children,
    MAX(child_count) as max_children
FROM (
    SELECT
        p.id as parent_id,
        p.node_name as parent_name,
        c.node_name as child_name,
        c.id as child_id,
        COUNT(c.id) OVER (PARTITION BY p.id) as child_count
    FROM godot_nodes p
    LEFT JOIN godot_nodes c ON c.parent_node_id = p.id
    WHERE p.repo_id = {REPO_ID}
) subquery
JOIN godot_nodes parent ON parent.id = parent_id
WHERE child_name IS NOT NULL
GROUP BY parent.node_name, child_name
HAVING COUNT(DISTINCT parent.id) > 5 AND COUNT(child_id) > 5
ORDER BY COUNT(DISTINCT parent.id) DESC;

\echo ''
\echo '=== TEST 19: Circular Parent References (CRITICAL BUG CHECK) ==='
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
SELECT
    COUNT(*) as nodes_in_circular_refs,
    CASE
        WHEN COUNT(*) = 0 THEN '✓ No circular references'
        ELSE '✗ CIRCULAR REFERENCES DETECTED - CRITICAL BUG'
    END as status
FROM ancestors
WHERE id = ANY(path[2:array_length(path, 1)]);

\echo ''
\echo '=== TEST 20: Maximum Hierarchy Depth ==='
WITH RECURSIVE hierarchy AS (
    SELECT id, node_name, parent_node_id, 0 as depth
    FROM godot_nodes
    WHERE repo_id = {REPO_ID} AND parent_node_id IS NULL

    UNION ALL

    SELECT gn.id, gn.node_name, gn.parent_node_id, h.depth + 1
    FROM godot_nodes gn
    JOIN hierarchy h ON gn.parent_node_id = h.id
    WHERE gn.repo_id = {REPO_ID}
)
SELECT
    MAX(depth) as max_depth,
    AVG(depth) as avg_depth,
    MIN(depth) as min_depth,
    CASE
        WHEN MAX(depth) > 50 THEN '⚠️ Very deep hierarchy - performance concern'
        WHEN MAX(depth) > 20 THEN '⚠️ Deep hierarchy - verify intentional'
        ELSE '✓ Normal depth'
    END as status
FROM hierarchy;

-- ============================================================================
-- SECTION 6: GODOT SCENE COMPOSITION
-- ============================================================================

\echo ''
\echo '=== TEST 21: Scene Instance Dependencies ==='
SELECT
    COUNT(*) as total_scene_instances,
    COUNT(DISTINCT gn.scene_id) as scenes_with_instances,
    COUNT(DISTINCT gn.id) as nodes_with_instances
FROM godot_nodes gn
WHERE gn.repo_id = {REPO_ID}
    AND gn.script_path IS NOT NULL
    AND gn.script_path LIKE '%.tscn';

\echo ''
\echo '=== TEST 22: Scene-to-Scene Dependencies ==='
\echo 'Checking file dependencies where scenes reference other scenes...'
SELECT
    f1.path as from_scene,
    f2.path as to_scene,
    d.dependency_type
FROM dependencies d
JOIN symbols s1 ON d.from_symbol_id = s1.id
JOIN files f1 ON s1.file_id = f1.id
JOIN symbols s2 ON d.to_symbol_id = s2.id
JOIN files f2 ON s2.file_id = f2.id
WHERE f1.repo_id = {REPO_ID}
    AND f1.path LIKE '%.tscn'
    AND f2.path LIKE '%.tscn'
LIMIT 20;

\echo ''
\echo '=== TEST 23: Nodes with Script Attachments ==='
SELECT
    COUNT(*) as total_nodes,
    COUNT(*) FILTER (WHERE script_path IS NOT NULL) as nodes_with_scripts,
    ROUND(100.0 * COUNT(*) FILTER (WHERE script_path IS NOT NULL) / COUNT(*), 2) as script_coverage_pct
FROM godot_nodes
WHERE repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 24: Godot Node Properties Validation ==='
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE properties IS NULL) as null_properties,
    COUNT(*) FILTER (WHERE properties = '{}') as empty_properties,
    COUNT(*) FILTER (WHERE jsonb_typeof(properties) != 'object') as invalid_json_type,
    COUNT(*) FILTER (WHERE jsonb_typeof(properties) = 'object' AND properties != '{}') as has_properties
FROM godot_nodes
WHERE repo_id = {REPO_ID};

-- ============================================================================
-- SECTION 7: GODOT NODE TYPE ANALYSIS
-- ============================================================================

\echo ''
\echo '=== TEST 25: Most Common Node Types ==='
SELECT
    node_type,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM godot_nodes WHERE repo_id = {REPO_ID}), 2) as percentage
FROM godot_nodes
WHERE repo_id = {REPO_ID}
GROUP BY node_type
ORDER BY count DESC
LIMIT 20;

\echo ''
\echo '=== TEST 26: Godot Framework Symbol Types ==='
SELECT
    symbol_type,
    COUNT(*) as count
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND symbol_type LIKE 'godot_%'
GROUP BY symbol_type
ORDER BY count DESC;

-- ============================================================================
-- SECTION 8: CROSS-REFERENCES AND DEPENDENCIES
-- ============================================================================

\echo ''
\echo '=== TEST 27: C# to Godot Scene References ==='
SELECT
    COUNT(*) as cs_to_scene_refs
FROM dependencies d
JOIN symbols s1 ON d.from_symbol_id = s1.id
JOIN files f1 ON s1.file_id = f1.id
JOIN symbols s2 ON d.to_symbol_id = s2.id
JOIN files f2 ON s2.file_id = f2.id
WHERE f1.repo_id = {REPO_ID}
    AND f1.path LIKE '%.cs'
    AND f2.path LIKE '%.tscn';

\echo ''
\echo '=== TEST 28: Dependency Type Distribution ==='
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
-- SECTION 9: DATA QUALITY CHECKS
-- ============================================================================

\echo ''
\echo '=== TEST 29: Empty or Whitespace Symbol Names ==='
SELECT COUNT(*) as empty_or_whitespace_names
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND (s.name = '' OR s.name ~ '^\s+$');

\echo ''
\echo '=== TEST 30: Line Number Sanity Checks ==='
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE start_line < 1) as invalid_start_lines,
    COUNT(*) FILTER (WHERE end_line < start_line) as end_before_start,
    COUNT(*) FILTER (WHERE end_line - start_line > 10000) as unreasonably_large_symbols
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 31: File Paths Sanity ==='
SELECT
    COUNT(*) as total_files,
    COUNT(*) FILTER (WHERE path IS NULL OR path = '') as missing_paths,
    COUNT(*) FILTER (WHERE NOT path LIKE '/%' AND NOT path LIKE '_:%') as potentially_relative_paths
FROM files
WHERE repo_id = {REPO_ID};

\echo ''
\echo '=== TEST 32: Signature Coverage ==='
SELECT
    symbol_type,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE signature IS NOT NULL AND signature != '') as has_signature,
    ROUND(100.0 * COUNT(*) FILTER (WHERE signature IS NOT NULL AND signature != '') / COUNT(*), 2) as signature_pct
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND symbol_type IN ('class', 'struct', 'method', 'function')
GROUP BY symbol_type
ORDER BY symbol_type;

-- ============================================================================
-- SECTION 10: GAME-SPECIFIC QUALITY CHECKS
-- ============================================================================

\echo ''
\echo '=== TEST 33: Scene Complexity Analysis ==='
SELECT
    scene_name,
    node_count,
    CASE
        WHEN node_count > 200 THEN '⚠️ Very complex scene - consider splitting'
        WHEN node_count > 100 THEN '⚠️ Complex scene - verify performance'
        ELSE '✓ Normal'
    END as complexity_status
FROM godot_scenes
WHERE repo_id = {REPO_ID}
ORDER BY node_count DESC;

\echo ''
\echo '=== TEST 34: Node Name Patterns ==='
\echo 'Checking for systematic naming (e.g., Position1_1, Position1_2)...'
SELECT
    node_name,
    COUNT(*) as occurrences,
    COUNT(DISTINCT scene_id) as used_in_scenes
FROM godot_nodes
WHERE repo_id = {REPO_ID}
GROUP BY node_name
HAVING COUNT(*) > 1
ORDER BY occurrences DESC
LIMIT 20;

\echo ''
\echo '=== TEST 35: C# Constructor Dependencies (IMPORTS) ==='
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
    ROUND(AVG(dep_count), 2) as avg_deps_per_constructor,
    CASE
        WHEN COUNT(DISTINCT d.id) > 0 THEN '✓ Constructor DI tracking working'
        WHEN COUNT(DISTINCT cs.constructor_id) = 0 THEN '○ No constructors found'
        ELSE '✗ Constructors exist but no dependencies tracked'
    END as status
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
\echo '=== TEST 36: Godot Entity Type Classification ==='
WITH entity_samples AS (
    SELECT
        entity_type,
        name,
        ROW_NUMBER() OVER (PARTITION BY entity_type ORDER BY name) as rn
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    WHERE f.repo_id = {REPO_ID}
        AND s.entity_type IN ('node', 'manager', 'service', 'handler',
                              'coordinator', 'engine', 'ui_component',
                              'resource', 'factory', 'pool', 'data_model',
                              'validator', 'effect')
)
SELECT
    s.entity_type,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM symbols s2 JOIN files f2 ON s2.file_id = f2.id WHERE f2.repo_id = {REPO_ID} AND s2.entity_type IS NOT NULL), 1) as pct_of_classified,
    (SELECT STRING_AGG(name, ', ' ORDER BY name)
     FROM entity_samples es
     WHERE es.entity_type = s.entity_type AND es.rn <= 5) as sample_names
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}
    AND s.entity_type IN ('node', 'manager', 'service', 'handler',
                          'coordinator', 'engine', 'ui_component',
                          'resource', 'factory', 'pool', 'data_model',
                          'validator', 'effect')
GROUP BY s.entity_type
ORDER BY count DESC;

\echo ''
\echo 'Godot framework coverage summary:'
SELECT
    framework_layer,
    COUNT(DISTINCT entity_type) as unique_entity_types,
    COUNT(*) as total_symbols,
    STRING_AGG(DISTINCT entity_type, ', ' ORDER BY entity_type) as entity_types_found
FROM (
    SELECT
        CASE
            WHEN s.entity_type IN ('node', 'ui_component', 'resource') THEN 'Godot Engine'
            WHEN s.entity_type IN ('manager', 'handler', 'coordinator', 'engine', 'pool') THEN 'Infrastructure'
            WHEN s.entity_type IN ('service') THEN 'Services'
            WHEN s.entity_type IN ('factory', 'validator', 'data_model') THEN 'Data Patterns'
            ELSE 'Other'
        END as framework_layer,
        s.entity_type
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    WHERE f.repo_id = {REPO_ID}
        AND s.entity_type IS NOT NULL
) categorized
GROUP BY framework_layer
ORDER BY total_symbols DESC;

\echo ''
\echo '=== TEST 37: Language Detection for C# Projects ==='
SELECT
    r.name as repository_name,
    r.language_primary as detected_language,
    most_common.language as most_common_file_language,
    most_common.file_count,
    most_common.percentage,
    CASE
        WHEN r.language_primary = 'csharp' AND most_common.language = 'csharp' THEN '✓ CORRECT'
        WHEN r.language_primary != 'csharp' AND most_common.language = 'csharp' THEN '✗ WRONG - Should be csharp'
        WHEN r.language_primary = 'javascript' THEN '✗ FALLBACK DETECTED - detectPrimaryLanguage() used default'
        ELSE '⚠️ Review language detection logic'
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
\echo 'File language distribution for this project:'
SELECT
    f.language,
    COUNT(*) as file_count,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM files WHERE repo_id = {REPO_ID}), 1) as percentage,
    CASE
        WHEN f.language = 'csharp' THEN '← Should match language_primary'
        ELSE ''
    END as note
FROM files f
WHERE f.repo_id = {REPO_ID}
    AND f.language IS NOT NULL
GROUP BY f.language
ORDER BY file_count DESC;

-- ============================================================================
-- SECTION 11: AUDIT SUMMARY
-- ============================================================================

\echo ''
\echo '=== GODOT PROJECT AUDIT SUMMARY ==='
SELECT
    'Files Analyzed' as metric,
    COUNT(*)::text as value
FROM files
WHERE repo_id = {REPO_ID}

UNION ALL

SELECT
    'C# Files',
    COUNT(*)::text
FROM files
WHERE repo_id = {REPO_ID} AND path LIKE '%.cs'

UNION ALL

SELECT
    'Godot Scene Files',
    COUNT(*)::text
FROM files
WHERE repo_id = {REPO_ID} AND path LIKE '%.tscn'

UNION ALL

SELECT
    'Total Symbols',
    COUNT(*)::text
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}

UNION ALL

SELECT
    'C# Structs',
    COUNT(*)::text
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID} AND s.symbol_type = 'struct'

UNION ALL

SELECT
    'Godot Scenes',
    COUNT(*)::text
FROM godot_scenes
WHERE repo_id = {REPO_ID}

UNION ALL

SELECT
    'Godot Nodes',
    COUNT(*)::text
FROM godot_nodes
WHERE repo_id = {REPO_ID}

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
    'Line Coverage %',
    ROUND(100.0 * COUNT(*) FILTER (WHERE start_line IS NOT NULL) / COUNT(*), 2)::text
FROM symbols s
JOIN files f ON s.file_id = f.id
WHERE f.repo_id = {REPO_ID}

UNION ALL

SELECT
    'Parent Coverage %',
    ROUND(100.0 * COUNT(*) FILTER (WHERE parent_node_id IS NOT NULL) / NULLIF(COUNT(*), 0), 2)::text
FROM godot_nodes
WHERE repo_id = {REPO_ID};

\echo ''
\echo '=== CRITICAL CHECKS SUMMARY ==='
\echo ''
\echo 'PASS/FAIL Criteria:'
\echo '✓ Zero orphaned symbols'
\echo '✓ Zero orphaned dependencies'
\echo '✓ Zero true duplicates'
\echo '✓ 100% line coverage'
\echo '✓ 100% C# class qualified names'
\echo '✓ All structs correctly classified'
\echo '✓ All scene node counts match'
\echo '✓ Zero circular parent references'
\echo '✓ Parent coverage >= 80% (remainder are root nodes)'
\echo ''
\echo '=== GODOT AUDIT COMPLETE ==='
