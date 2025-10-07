#!/bin/bash
set -e

if [ ! -f .env ]; then
    echo "Error: .env file not found. Copy .env.example to .env and configure it."
    exit 1
fi

source .env

if [ -z "$REMOTE_HOST" ] || [ "$REMOTE_HOST" = "username@YOUR_HETZNER_IP" ]; then
    echo "Error: REMOTE_HOST not configured in .env"
    exit 1
fi

TUNNEL_PORT=${TUNNEL_PORT:-3456}

if ps aux | grep -q "[a]utossh.*$TUNNEL_PORT"; then
    echo "✓ SSH tunnel already running on port $TUNNEL_PORT"
    exit 0
fi

echo "Starting SSH tunnel to $REMOTE_HOST on port $TUNNEL_PORT..."

autossh -M 0 -N -f \
    -o "ServerAliveInterval 30" \
    -o "ServerAliveCountMax 3" \
    -R "$TUNNEL_PORT:localhost:$TUNNEL_PORT" \
    "$REMOTE_HOST"

sleep 2

if ps aux | grep -q "[a]utossh.*$TUNNEL_PORT"; then
    echo "✓ SSH tunnel started successfully"
else
    echo "✗ Failed to start SSH tunnel"
    exit 1
fi
