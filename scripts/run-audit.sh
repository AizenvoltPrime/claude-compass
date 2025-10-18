#!/bin/bash

# Database audit runner script
# Usage: ./scripts/run-audit.sh <repo_name> [audit-type]
#   audit-type: general (default) or godot

REPO_NAME="$1"
AUDIT_TYPE="${2:-general}"

if [ -z "$REPO_NAME" ]; then
    echo "Usage: npm run audit <repo_name>"
    echo "   or: npm run audit:godot <repo_name>"
    echo ""
    echo "Example:"
    echo "  npm run audit my_web_app              # Run general audit"
    echo "  npm run audit:godot my_game           # Run Godot audit"
    echo ""
    echo "Available repositories:"
    docker exec -i claude-compass-postgres psql -U claude_compass -d claude_compass -t -c \
        "SELECT '  - ' || name || ' (last indexed: ' || last_indexed::date || ')' FROM repositories ORDER BY name;"
    exit 1
fi

# Look up repository ID from name
REPO_ID=$(docker exec -i claude-compass-postgres psql -U claude_compass -d claude_compass -t -c \
    "SELECT id FROM repositories WHERE name = '$REPO_NAME';" | tr -d '[:space:]')

if [ -z "$REPO_ID" ]; then
    echo "Error: Repository '$REPO_NAME' not found in database"
    echo ""
    echo "Available repositories:"
    docker exec -i claude-compass-postgres psql -U claude_compass -d claude_compass -t -c \
        "SELECT '  - ' || name FROM repositories ORDER BY name;"
    exit 1
fi

echo "Found repository: $REPO_NAME (ID: $REPO_ID)"

# Select audit file
if [ "$AUDIT_TYPE" = "godot" ]; then
    AUDIT_FILE="tests/database-audit-queries-godot.sql"
    echo "Running Godot-specific audit for repository ID: $REPO_ID"
else
    AUDIT_FILE="tests/database-audit-queries.sql"
    echo "Running general audit for repository ID: $REPO_ID"
fi

# Check if audit file exists
if [ ! -f "$AUDIT_FILE" ]; then
    echo "Error: Audit file not found: $AUDIT_FILE"
    exit 1
fi

# Run audit
sed "s/{REPO_ID}/$REPO_ID/g" "$AUDIT_FILE" | \
    docker exec -i claude-compass-postgres psql -U claude_compass -d claude_compass
