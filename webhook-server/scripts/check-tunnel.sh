#!/bin/bash

if [ ! -f .env ]; then
    echo "Warning: .env file not found, using default port 3456"
    TUNNEL_PORT=3456
else
    source .env
    TUNNEL_PORT=${TUNNEL_PORT:-3456}
fi

echo "Checking SSH tunnel status on port $TUNNEL_PORT..."
echo ""

if ps aux | grep -q "[a]utossh.*$TUNNEL_PORT"; then
    echo "✓ SSH tunnel is RUNNING"
    echo ""
    echo "Process details:"
    ps aux | grep "[a]utossh.*$TUNNEL_PORT"
    exit 0
else
    echo "✗ SSH tunnel is NOT running"
    exit 1
fi
