#!/bin/bash
set -e

if [ ! -f .env ]; then
    echo "Warning: .env file not found, using default port 3456"
    TUNNEL_PORT=3456
else
    source .env
    TUNNEL_PORT=${TUNNEL_PORT:-3456}
fi

if ! ps aux | grep -q "[a]utossh.*$TUNNEL_PORT"; then
    echo "✓ SSH tunnel not running (already stopped)"
    exit 0
fi

echo "Stopping SSH tunnel on port $TUNNEL_PORT..."

pkill -f "autossh.*$TUNNEL_PORT" || true

sleep 1

if ps aux | grep -q "[a]utossh.*$TUNNEL_PORT"; then
    echo "✗ Failed to stop SSH tunnel (still running)"
    exit 1
else
    echo "✓ SSH tunnel stopped successfully"
fi
