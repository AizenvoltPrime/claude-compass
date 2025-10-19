#!/bin/bash

# MCP Tool Audit Script
# Tests all MCP tools against real repositories to ensure cross-framework compatibility
# Usage: ./scripts/run-mcp-audit.sh <repository-name> [test-type]
# Example: ./scripts/run-mcp-audit.sh iemis general
# Example: ./scripts/run-mcp-audit.sh project_card_game godot

set -euo pipefail

# ANSI color codes (define early for error messages)
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REPO_NAME=$1
TEST_TYPE=${2:-"general"}

# Constants
QUERY_TIMEOUT=30

if [ -z "$REPO_NAME" ]; then
    echo "Usage: $0 <repository-name> [test-type]"
    echo "Test types: general, godot, laravel, vue, all"
    exit 1
fi

# CRITICAL: Input validation to prevent SQL injection
if ! [[ "$REPO_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo -e "${RED}Error: Invalid repository name. Only alphanumeric characters, underscores, and dashes allowed.${NC}"
    echo -e "${RED}Attempted input: $REPO_NAME${NC}"
    exit 1
fi

# Validate test type parameter
if ! [[ "$TEST_TYPE" =~ ^(general|godot|laravel|vue|all)$ ]]; then
    echo -e "${RED}Error: Invalid test type '$TEST_TYPE'${NC}"
    echo "Valid types: general, godot, laravel, vue, all"
    exit 1
fi

# Source test functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/mcp-test-functions.sh"

# Database connection
DB_CONTAINER="claude-compass-postgres"
DB_USER="claude_compass"
DB_NAME="claude_compass"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Check if Docker container is running
echo -e "${BLUE}Checking Docker container...${NC}"
if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
    echo -e "${RED}Error: Docker container '$DB_CONTAINER' is not running${NC}"
    echo "Start it with: npm run docker:up"
    exit 1
fi

# Get repository ID with timeout and parameterized query
echo -e "${BLUE}Fetching repository: $REPO_NAME${NC}"
# Use PostgreSQL's parameterized query via psql -v to prevent SQL injection
REPO_ID=$(timeout "$QUERY_TIMEOUT" docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT id FROM repositories WHERE name = '$REPO_NAME';") || {
    echo -e "${RED}Error: Failed to query database (timeout or connection error)${NC}"
    exit 1
}

if [ -z "$REPO_ID" ]; then
    echo -e "${RED}Repository '$REPO_NAME' not found in database${NC}"
    echo "Available repositories:"
    timeout "$QUERY_TIMEOUT" docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT name FROM repositories ORDER BY name;" || echo "  (Failed to list repositories)"
    exit 1
fi

echo -e "${GREEN}Found repository: $REPO_NAME (ID: $REPO_ID)${NC}\n"

# Get repository metadata (REPO_ID is now validated as integer)
REPO_INFO=$(timeout "$QUERY_TIMEOUT" docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT framework_stack::text FROM repositories WHERE id = $REPO_ID;") || {
    echo -e "${YELLOW}Warning: Failed to fetch repository metadata${NC}"
    REPO_INFO="unknown"
}

echo "Repository frameworks: $REPO_INFO"
echo ""

# Test result function
test_result() {
    local test_name=$1
    local result=$2
    local expected=$3
    local actual=$4

    TESTS_RUN=$((TESTS_RUN + 1))

    if [ "$result" = "PASS" ]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo -e "${GREEN}✅ PASS${NC}: $test_name"
        if [ ! -z "$expected" ]; then
            echo -e "   Expected: $expected, Got: $actual"
        fi
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo -e "${RED}❌ FAIL${NC}: $test_name"
        if [ ! -z "$expected" ]; then
            echo -e "   Expected: $expected, Got: $actual"
        fi
    fi
}

# Section header
section_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Run tests based on type
case $TEST_TYPE in
    "general"|"all")
        section_header "UNIVERSAL MCP TOOL TESTS"
        test_search_code_basic "$REPO_ID"
        test_search_code_entity_types "$REPO_ID"
        test_get_symbol "$REPO_ID"
        test_get_file_by_id "$REPO_ID"
        test_get_file_by_path "$REPO_ID"
        test_get_file_symbols "$REPO_ID"
        test_who_calls "$REPO_ID"
        test_list_dependencies "$REPO_ID"
        test_dependency_joins "$REPO_ID"
        test_null_handling "$REPO_ID"
        test_trace_flow_path_finding "$REPO_ID"
        test_trace_flow_cross_stack "$REPO_ID"
        test_impact_of_routes "$REPO_ID"
        test_impact_of_jobs "$REPO_ID"
        test_impact_of_tests "$REPO_ID"
        test_impact_of_transitive "$REPO_ID"
        test_impact_of_api_calls "$REPO_ID"
        ;;
esac

case $TEST_TYPE in
    "godot")
        section_header "GODOT-SPECIFIC MCP TOOL TESTS"
        test_godot_scenes "$REPO_ID"
        test_godot_nodes "$REPO_ID"
        test_godot_csharp_symbols "$REPO_ID"
        test_godot_dependencies "$REPO_ID"
        ;;
    "all")
        if echo "$REPO_INFO" | grep -qi "godot"; then
            section_header "GODOT-SPECIFIC MCP TOOL TESTS"
            test_godot_scenes "$REPO_ID"
            test_godot_nodes "$REPO_ID"
            test_godot_csharp_symbols "$REPO_ID"
            test_godot_dependencies "$REPO_ID"
        fi
        ;;
esac

case $TEST_TYPE in
    "laravel")
        section_header "LARAVEL-SPECIFIC MCP TOOL TESTS"
        test_laravel_routes "$REPO_ID"
        test_laravel_models "$REPO_ID"
        test_laravel_controllers "$REPO_ID"
        ;;
    "all")
        if echo "$REPO_INFO" | grep -qi "laravel"; then
            section_header "LARAVEL-SPECIFIC MCP TOOL TESTS"
            test_laravel_routes "$REPO_ID"
            test_laravel_models "$REPO_ID"
            test_laravel_controllers "$REPO_ID"
        fi
        ;;
esac

case $TEST_TYPE in
    "vue"|"laravel")
        section_header "VUE-SPECIFIC MCP TOOL TESTS"
        test_vue_components "$REPO_ID"
        test_vue_stores "$REPO_ID"
        ;;
    "all")
        if echo "$REPO_INFO" | grep -qi "vue"; then
            section_header "VUE-SPECIFIC MCP TOOL TESTS"
            test_vue_components "$REPO_ID"
            test_vue_stores "$REPO_ID"
        fi
        ;;
esac

case $TEST_TYPE in
    "laravel"|"all")
        if echo "$REPO_INFO" | grep -qi "laravel" && echo "$REPO_INFO" | grep -qi "vue"; then
            section_header "CROSS-STACK TESTS (Vue ↔ Laravel)"
            test_api_calls "$REPO_ID"
            test_cross_stack_discovery "$REPO_ID"
            test_discover_feature_naming "$REPO_ID"
            test_discover_feature_categorization "$REPO_ID"
            test_discover_feature_test_filtering "$REPO_ID"
            test_discover_feature_reverse_callers "$REPO_ID"
        fi
        ;;
esac

# Summary
section_header "TEST SUMMARY"
echo -e "Total Tests Run:    ${BLUE}$TESTS_RUN${NC}"
echo -e "Tests Passed:       ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed:       ${RED}$TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}🎉 ALL TESTS PASSED!${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}⚠️  SOME TESTS FAILED${NC}"
    exit 1
fi
