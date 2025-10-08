#!/bin/bash

# Simple File Sync Script - Syncs files from Hetzner to WSL (no analysis)
# Usage: npm run sync

set -euo pipefail

# Load environment variables from .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: .env file not found at $ENV_FILE"
    echo "Copy .env.example to .env and configure it first."
    exit 1
fi

# Source the .env file
set -a
source "$ENV_FILE"
set +a

# Validate required variables
if [ -z "${REMOTE_HOST:-}" ] || [ -z "${REMOTE_PROJECT_PATH:-}" ] || [ -z "${LOCAL_PROJECT_PATH:-}" ]; then
    echo "❌ Error: Missing required environment variables"
    echo "Required: REMOTE_HOST, REMOTE_PROJECT_PATH, LOCAL_PROJECT_PATH"
    exit 1
fi

echo "🔄 Syncing files from Hetzner to WSL..."
echo "   Remote: $REMOTE_HOST:$REMOTE_PROJECT_PATH"
echo "   Local:  $LOCAL_PROJECT_PATH"
echo ""

# Ensure local directory exists
mkdir -p "$LOCAL_PROJECT_PATH"

# Full rsync with all exclusions
rsync -avz --delete \
    --exclude='node_modules' \
    --exclude='vendor' \
    --exclude='bin' \
    --exclude='obj' \
    --exclude='*.dll' \
    --exclude='*.exe' \
    --exclude='*.pdb' \
    --exclude='storage/logs' \
    --exclude='storage/framework' \
    --exclude='storage/app/cache' \
    --exclude='storage/app/public' \
    --exclude='storage/app/json' \
    --exclude='storage/app/private' \
    --exclude='storage/app/temp' \
    --exclude='storage/oauth-*.key' \
    --exclude='storage/*.key' \
    --exclude='storage/*.json' \
    --exclude='public/uploads' \
    --exclude='public/build' \
    --exclude='public/hot' \
    --exclude='.git' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='*.log' \
    --exclude='*.cache' \
    --exclude='.env' \
    "$REMOTE_HOST:$REMOTE_PROJECT_PATH/" \
    "$LOCAL_PROJECT_PATH/"

echo ""
echo "✅ Sync complete!"
echo "📊 Local project size:"
du -sh "$LOCAL_PROJECT_PATH"
