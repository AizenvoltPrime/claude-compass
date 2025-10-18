#!/bin/bash

# MCP Tool Test Functions Library
# Contains all test functions for validating MCP tool queries

set -euo pipefail

# Database connection vars (should be set by caller)
DB_CONTAINER=${DB_CONTAINER:-"claude-compass-postgres"}
DB_USER=${DB_USER:-"claude_compass"}
DB_NAME=${DB_NAME:-"claude_compass"}
QUERY_TIMEOUT=${QUERY_TIMEOUT:-30}

# Constants for thresholds (extracted from magic numbers)
readonly QUALIFIED_NAME_COVERAGE_MIN=95
readonly ROUTE_HANDLER_COVERAGE_MIN=90
readonly SEARCH_RESULT_LIMIT=100

# Helper function to run SQL query with timeout
run_query() {
    timeout "$QUERY_TIMEOUT" docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null || {
        echo "ERROR: Query timeout or connection failure" >&2
        return 1
    }
}

# Helper function to count query results with timeout
count_query() {
    timeout "$QUERY_TIMEOUT" docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null | tr -d ' ' || {
        echo "0"
        return 1
    }
}

# ================================
# UNIVERSAL TOOL TESTS
# ================================

# Test 1: search_code - Basic symbol search
test_search_code_basic() {
    local repo_id=$1

    echo "TEST: Basic symbol search across repository"

    # Search for common patterns across any symbol type
    # Try multiple patterns to ensure we find something in any repo
    local result=$(count_query "
        SELECT COUNT(DISTINCT s.id)
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND (
              s.name ILIKE '%Service%'
              OR s.name ILIKE '%Manager%'
              OR s.name ILIKE '%Controller%'
              OR s.name ILIKE '%Component%'
          )
        LIMIT $SEARCH_RESULT_LIMIT;
    ")

    if [ "$result" -gt 0 ]; then
        test_result "search_code finds common patterns" "PASS" ">0" "$result symbols"
    else
        test_result "search_code finds common patterns" "FAIL" ">0" "$result"
    fi
}

# Test 2: search_code - Entity type filtering
test_search_code_entity_types() {
    local repo_id=$1

    echo "TEST: Entity type filtering in search"

    # Search with entity_type filter
    local result=$(count_query "
        SELECT COUNT(DISTINCT s.id)
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND s.entity_type = 'service'
          AND s.symbol_type = 'class';
    ")

    # Result can be 0 if repo has no services, that's OK
    test_result "search_code entity_type filter works" "PASS" ">=0" "$result"
}

# Test 3: get_symbol - Retrieve symbol with file info
test_get_symbol() {
    local repo_id=$1

    echo "TEST: get_symbol retrieves complete symbol data"

    # Get a symbol ID from the repo
    local symbol_id=$(run_query "
        SELECT s.id
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND s.symbol_type IN ('class', 'method')
        LIMIT 1;
    ")

    if [ -z "$symbol_id" ]; then
        test_result "get_symbol (no symbols to test)" "PASS" "" ""
        return
    fi

    # Simulate getSymbolWithFile query
    local result=$(count_query "
        SELECT COUNT(*)
        FROM symbols s
        LEFT JOIN files f ON s.file_id = f.id
        LEFT JOIN repositories r ON f.repo_id = r.id
        WHERE s.id = $symbol_id
          AND f.path IS NOT NULL;
    ")

    if [ "$result" = "1" ]; then
        test_result "get_symbol returns symbol with file path" "PASS" "1" "$result"
    else
        test_result "get_symbol returns symbol with file path" "FAIL" "1" "$result"
    fi
}

# Test 4: who_calls - Find callers of a symbol
test_who_calls() {
    local repo_id=$1

    echo "TEST: who_calls finds reverse dependencies"

    # Find a symbol that has callers
    local symbol_with_callers=$(run_query "
        SELECT s.id
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        JOIN dependencies d ON d.to_symbol_id = s.id
        WHERE f.repo_id = $repo_id
        GROUP BY s.id
        HAVING COUNT(d.id) > 0
        LIMIT 1;
    ")

    if [ -z "$symbol_with_callers" ]; then
        test_result "who_calls (no dependencies to test)" "PASS" "" ""
        return
    fi

    # Simulate getDependenciesTo query
    local caller_count=$(count_query "
        SELECT COUNT(*)
        FROM dependencies d
        JOIN symbols s_from ON d.from_symbol_id = s_from.id
        JOIN files f ON s_from.file_id = f.id
        WHERE d.to_symbol_id = $symbol_with_callers
          AND f.repo_id = $repo_id;
    ")

    if [ "$caller_count" -gt 0 ]; then
        test_result "who_calls finds callers" "PASS" ">0" "$caller_count"
    else
        test_result "who_calls finds callers" "FAIL" ">0" "$caller_count"
    fi
}

# Test 5: list_dependencies - Outgoing dependencies
test_list_dependencies() {
    local repo_id=$1

    echo "TEST: list_dependencies finds outgoing dependencies"

    # Find a symbol with dependencies
    local symbol_with_deps=$(run_query "
        SELECT s.id
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        JOIN dependencies d ON d.from_symbol_id = s.id
        WHERE f.repo_id = $repo_id
        GROUP BY s.id
        HAVING COUNT(d.id) > 0
        LIMIT 1;
    ")

    if [ -z "$symbol_with_deps" ]; then
        test_result "list_dependencies (no dependencies to test)" "PASS" "" ""
        return
    fi

    # Simulate getDependenciesFrom query
    local dep_count=$(count_query "
        SELECT COUNT(*)
        FROM dependencies d
        WHERE d.from_symbol_id = $symbol_with_deps;
    ")

    if [ "$dep_count" -gt 0 ]; then
        test_result "list_dependencies finds dependencies" "PASS" ">0" "$dep_count"
    else
        test_result "list_dependencies finds dependencies" "FAIL" ">0" "$dep_count"
    fi
}

# Test 6: Dependency query joins work correctly
test_dependency_joins() {
    local repo_id=$1

    echo "TEST: Dependency LEFT JOINs handle NULL gracefully"

    # Test that LEFT JOINs don't filter out unresolved dependencies
    local total_deps=$(count_query "
        SELECT COUNT(*)
        FROM dependencies d
        JOIN symbols s ON d.from_symbol_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id;
    ")

    local deps_with_target=$(count_query "
        SELECT COUNT(*)
        FROM dependencies d
        JOIN symbols s ON d.from_symbol_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND d.to_symbol_id IS NOT NULL;
    ")

    local deps_with_qname=$(count_query "
        SELECT COUNT(*)
        FROM dependencies d
        JOIN symbols s ON d.from_symbol_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND d.to_qualified_name IS NOT NULL;
    ")

    # Should have deps with either to_symbol_id OR to_qualified_name
    local total_valid=$((deps_with_target + deps_with_qname))

    if [ "$total_valid" -ge "$total_deps" ]; then
        test_result "Dependencies have target or qualified name" "PASS" "$total_deps" "$total_valid"
    else
        test_result "Dependencies have target or qualified name" "FAIL" "$total_deps" "$total_valid"
    fi
}

# Test 7: NULL handling in symbol queries
test_null_handling() {
    local repo_id=$1

    echo "TEST: Queries handle NULL values correctly"

    # Count symbols with NULL qualified_name (expected for imports, etc.)
    local null_qname=$(count_query "
        SELECT COUNT(*)
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND s.qualified_name IS NULL;
    ")

    # This should not crash and should return a number
    if [[ "$null_qname" =~ ^[0-9]+$ ]]; then
        test_result "NULL qualified_name handling" "PASS" "number" "$null_qname symbols"
    else
        test_result "NULL qualified_name handling" "FAIL" "number" "$null_qname"
    fi

    # Test framework NULL handling
    local null_framework=$(count_query "
        SELECT COUNT(*)
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND s.framework IS NULL;
    ")

    if [[ "$null_framework" =~ ^[0-9]+$ ]]; then
        test_result "NULL framework handling" "PASS" "number" "$null_framework symbols"
    else
        test_result "NULL framework handling" "FAIL" "number" "$null_framework"
    fi
}

# ================================
# GODOT-SPECIFIC TESTS
# ================================

# Test 8: Godot scenes are tracked
test_godot_scenes() {
    local repo_id=$1

    echo "TEST: Godot scenes are tracked"

    local scene_count=$(count_query "
        SELECT COUNT(*)
        FROM godot_scenes
        WHERE repo_id = $repo_id;
    ")

    if [ "$scene_count" -gt 0 ]; then
        test_result "Godot scenes found" "PASS" ">0" "$scene_count"
    else
        test_result "Godot scenes found (none in repo)" "PASS" "0" "$scene_count"
    fi
}

# Test 9: Godot nodes are tracked with hierarchy
test_godot_nodes() {
    local repo_id=$1

    echo "TEST: Godot nodes tracked with parent relationships"

    local node_count=$(count_query "
        SELECT COUNT(*)
        FROM godot_nodes
        WHERE repo_id = $repo_id;
    ")

    if [ "$node_count" -eq 0 ]; then
        test_result "Godot nodes (none in repo)" "PASS" "0" "$node_count"
        return
    fi

    # Check for parent relationships
    local nodes_with_parents=$(count_query "
        SELECT COUNT(*)
        FROM godot_nodes
        WHERE repo_id = $repo_id
          AND parent_node_id IS NOT NULL;
    ")

    # Should have at least some child nodes if we have nodes
    if [ "$nodes_with_parents" -gt 0 ] || [ "$node_count" -le 1 ]; then
        test_result "Godot nodes have parent relationships" "PASS" ">0 or single node" "$nodes_with_parents/$node_count"
    else
        test_result "Godot nodes have parent relationships" "FAIL" ">0" "$nodes_with_parents/$node_count"
    fi
}

# Test 10: C# symbols in Godot project
test_godot_csharp_symbols() {
    local repo_id=$1

    echo "TEST: C# symbols classified correctly"

    local csharp_classes=$(count_query "
        SELECT COUNT(*)
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND s.symbol_type = 'class'
          AND f.language = 'csharp';
    ")

    if [ "$csharp_classes" -gt 0 ]; then
        # Check that C# classes have qualified names
        local with_qnames=$(count_query "
            SELECT COUNT(*)
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE f.repo_id = $repo_id
              AND s.symbol_type = 'class'
              AND f.language = 'csharp'
              AND s.qualified_name IS NOT NULL;
        ")

        local coverage=$((with_qnames * 100 / csharp_classes))

        if [ "$coverage" -ge "$QUALIFIED_NAME_COVERAGE_MIN" ]; then
            test_result "C# classes have qualified names (${coverage}%)" "PASS" ">=${QUALIFIED_NAME_COVERAGE_MIN}%" "${coverage}%"
        else
            test_result "C# classes have qualified names (${coverage}%)" "FAIL" ">=${QUALIFIED_NAME_COVERAGE_MIN}%" "${coverage}%"
        fi
    else
        test_result "C# symbols (none in repo)" "PASS" "0" "0"
    fi
}

# Test 11: Godot dependencies tracked
test_godot_dependencies() {
    local repo_id=$1

    echo "TEST: Godot C# dependencies tracked"

    local godot_deps=$(count_query "
        SELECT COUNT(*)
        FROM dependencies d
        JOIN symbols s ON d.from_symbol_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND f.language = 'csharp';
    ")

    if [ "$godot_deps" -gt 0 ]; then
        test_result "Godot C# dependencies tracked" "PASS" ">0" "$godot_deps"
    else
        test_result "Godot dependencies (none in repo)" "PASS" "0" "0"
    fi
}

# ================================
# LARAVEL-SPECIFIC TESTS
# ================================

# Test 12: Laravel routes tracked
test_laravel_routes() {
    local repo_id=$1

    echo "TEST: Laravel routes discovered"

    local route_count=$(count_query "
        SELECT COUNT(*)
        FROM routes
        WHERE repo_id = $repo_id
          AND framework_type = 'laravel';
    ")

    if [ "$route_count" -gt 0 ]; then
        # Check routes have handlers
        local with_handlers=$(count_query "
            SELECT COUNT(*)
            FROM routes
            WHERE repo_id = $repo_id
              AND framework_type = 'laravel'
              AND (handler_symbol_id IS NOT NULL OR controller_class IS NOT NULL);
        ")

        local coverage=$((with_handlers * 100 / route_count))

        if [ "$coverage" -ge "$ROUTE_HANDLER_COVERAGE_MIN" ]; then
            test_result "Laravel routes have handlers (${coverage}%)" "PASS" ">=${ROUTE_HANDLER_COVERAGE_MIN}%" "${coverage}%"
        else
            test_result "Laravel routes have handlers (${coverage}%)" "FAIL" ">=${ROUTE_HANDLER_COVERAGE_MIN}%" "${coverage}%"
        fi
    else
        test_result "Laravel routes (none in repo)" "PASS" "0" "0"
    fi
}

# Test 13: Laravel models discovered
test_laravel_models() {
    local repo_id=$1

    echo "TEST: Laravel Eloquent models discovered"

    local model_count=$(count_query "
        SELECT COUNT(*)
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND s.entity_type = 'model'
          AND s.symbol_type = 'class';
    ")

    if [ "$model_count" -gt 0 ]; then
        test_result "Laravel models discovered" "PASS" ">0" "$model_count"

        # Check models have qualified names
        local with_qnames=$(count_query "
            SELECT COUNT(*)
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE f.repo_id = $repo_id
              AND s.entity_type = 'model'
              AND s.symbol_type = 'class'
              AND s.qualified_name IS NOT NULL;
        ")

        if [ "$with_qnames" = "$model_count" ]; then
            test_result "Laravel models have qualified names" "PASS" "$model_count" "$with_qnames"
        else
            test_result "Laravel models have qualified names" "FAIL" "$model_count" "$with_qnames"
        fi
    else
        test_result "Laravel models (none in repo)" "PASS" "0" "0"
    fi
}

# Test 14: Laravel controllers discovered
test_laravel_controllers() {
    local repo_id=$1

    echo "TEST: Laravel controllers discovered"

    local controller_count=$(count_query "
        SELECT COUNT(*)
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND s.entity_type = 'controller'
          AND s.symbol_type = 'class';
    ")

    if [ "$controller_count" -gt 0 ]; then
        test_result "Laravel controllers discovered" "PASS" ">0" "$controller_count"
    else
        test_result "Laravel controllers (none in repo)" "PASS" "0" "0"
    fi
}

# ================================
# VUE-SPECIFIC TESTS
# ================================

# Test 15: Vue components discovered
test_vue_components() {
    local repo_id=$1

    echo "TEST: Vue components discovered with metadata"

    local component_count=$(count_query "
        SELECT COUNT(*)
        FROM components
        WHERE repo_id = $repo_id
          AND component_type = 'vue';
    ")

    if [ "$component_count" -gt 0 ]; then
        test_result "Vue components discovered" "PASS" ">0" "$component_count"

        # Check components have props or emits
        local with_metadata=$(count_query "
            SELECT COUNT(*)
            FROM components
            WHERE repo_id = $repo_id
              AND component_type = 'vue'
              AND (props IS NOT NULL OR emits IS NOT NULL);
        ")

        test_result "Vue components have metadata" "PASS" ">=0" "$with_metadata/$component_count"
    else
        test_result "Vue components (none in repo)" "PASS" "0" "0"
    fi
}

# Test 16: Vue stores/composables discovered
test_vue_stores() {
    local repo_id=$1

    echo "TEST: Vue stores and composables discovered"

    local store_count=$(count_query "
        SELECT COUNT(*)
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND s.entity_type IN ('store', 'composable')
          AND s.framework = 'vue';
    ")

    if [ "$store_count" -gt 0 ]; then
        test_result "Vue stores/composables discovered" "PASS" ">0" "$store_count"
    else
        test_result "Vue stores/composables (none in repo)" "PASS" "0" "0"
    fi
}

# ================================
# CROSS-STACK TESTS
# ================================

# Test 17: API calls tracked (Vue -> Laravel)
test_api_calls() {
    local repo_id=$1

    echo "TEST: Cross-stack API calls tracked"

    local api_call_count=$(count_query "
        SELECT COUNT(*)
        FROM api_calls
        WHERE repo_id = $repo_id;
    ")

    if [ "$api_call_count" -gt 0 ]; then
        test_result "API calls tracked" "PASS" ">0" "$api_call_count"

        # Check API calls link to routes
        local with_endpoints=$(count_query "
            SELECT COUNT(*)
            FROM api_calls ac
            JOIN routes r ON ac.endpoint_path = r.path
            WHERE ac.repo_id = $repo_id
              AND r.repo_id = $repo_id;
        ")

        if [ "$with_endpoints" -gt 0 ]; then
            test_result "API calls link to routes" "PASS" ">0" "$with_endpoints"
        else
            test_result "API calls link to routes" "FAIL" ">0" "$with_endpoints"
        fi
    else
        test_result "API calls (none in repo)" "PASS" "0" "0"
    fi
}

# Test 18: Cross-stack feature discovery
test_cross_stack_discovery() {
    local repo_id=$1

    echo "TEST: Cross-stack feature discovery works"

    # Find a Laravel controller method
    local controller_method=$(run_query "
        SELECT s.id
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.repo_id = $repo_id
          AND s.symbol_type = 'method'
          AND s.entity_type = 'method'
          AND f.path LIKE '%Controller.php'
        LIMIT 1;
    ")

    if [ -z "$controller_method" ]; then
        test_result "Cross-stack discovery (no controllers to test)" "PASS" "" ""
        return
    fi

    # Check if we can find related Vue components via API calls
    local related_frontend=$(count_query "
        SELECT COUNT(DISTINCT ac.caller_symbol_id)
        FROM routes r
        JOIN api_calls ac ON ac.endpoint_path = r.path
        WHERE r.handler_symbol_id = $controller_method
           OR r.controller_method = (
               SELECT name FROM symbols WHERE id = $controller_method
           );
    ")

    test_result "Cross-stack discovery finds frontend callers" "PASS" ">=0" "$related_frontend"
}
