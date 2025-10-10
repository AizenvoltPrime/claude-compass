#!/bin/bash

#
# API Extraction Verification Script
#
# Runs frontend extraction and backend comparison in sequence
#
# Usage:
#   ./verify-extraction.sh <repository-path>
#   ./verify-extraction.sh /home/user/projects/iemis
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_PATH="$1"

if [ -z "$REPO_PATH" ]; then
  echo "Error: Repository path required"
  echo "Usage: $0 <repository-path>"
  exit 1
fi

if [ ! -d "$REPO_PATH" ]; then
  echo "Error: Repository path does not exist: $REPO_PATH"
  exit 1
fi

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║           API EXTRACTION VERIFICATION                              ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Repository: $REPO_PATH"
echo ""

# Step 1: Extract frontend API calls
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1: Extracting Frontend API Calls"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

node "$SCRIPT_DIR/extract-frontend-api-calls.js" "$REPO_PATH"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2: Comparing with Backend Routes"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

node "$SCRIPT_DIR/compare-backend-frontend.js" "$REPO_PATH"

echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║           VERIFICATION COMPLETE                                    ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Results saved to:"
echo "  - $SCRIPT_DIR/frontend-api-calls.json"
echo "  - $SCRIPT_DIR/comparison-results.json"
echo ""
