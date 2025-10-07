# Claude Compass Webhook Server

Real-time file change monitoring and incremental analysis server for Claude Compass with integrated SSH tunnel management.

## Quick Start

```bash
# 1. Configure environment
cp .env.example .env
nano .env  # Update REMOTE_HOST, paths, and webhook secret

# 2. Install dependencies
npm install

# 3. Start everything (webhook server + SSH tunnel)
npm run pm2:start

# 4. Check status
pm2 status
npm run tunnel:status
```

## Available Commands

### Main Commands

| Command | Description |
|---------|-------------|
| `npm run pm2:start` | Start webhook server + SSH tunnel (integrated) |
| `npm run pm2:stop` | Stop webhook server + SSH tunnel (integrated) |
| `npm run pm2:restart` | Quick restart (server only, tunnel keeps running) |
| `npm run pm2:restart:full` | Full restart (server + tunnel) |
| `pm2 status` | Check PM2 process status |

### Tunnel Management

| Command | Description |
|---------|-------------|
| `npm run tunnel:status` | Check if SSH tunnel is running |
| `npm run tunnel:start` | Manually start SSH tunnel |
| `npm run tunnel:stop` | Manually stop SSH tunnel |

### Restart Options

| Command | Restarts Server | Restarts Tunnel | Speed | Use Case |
|---------|----------------|-----------------|-------|----------|
| `npm run pm2:restart` | ✓ | ✗ | Fast (5-10s) | Code changes, config updates |
| `npm run pm2:restart:full` | ✓ | ✓ | Slower (10-15s) | Tunnel issues, full refresh |

### Logs & Monitoring

| Command | Description |
|---------|-------------|
| `pm2 logs compass-webhook` | View live logs |
| `pm2 logs compass-webhook --lines 100` | View last 100 log lines |
| `tail -f /tmp/compass-webhook.log` | View webhook activity log |

### Manual Triggers

| Command | Description |
|---------|-------------|
| `curl -X POST http://localhost:3456/trigger/analyze -H "X-Webhook-Secret: YOUR_SECRET"` | Trigger full sync + analysis |
| `curl -X POST http://localhost:3456/trigger/sync -H "X-Webhook-Secret: YOUR_SECRET"` | Trigger sync only |
| `curl http://localhost:3456/health` | Check server health |

## How It Works

### Integrated Lifecycle

When you run `npm run pm2:start`, the system automatically:

1. **Pre-hook** (`prepm2:start`): Starts SSH tunnel via `scripts/start-tunnel.sh`
2. **Main**: Starts webhook server with PM2
3. **Ready**: Both tunnel and server running

When you run `npm run pm2:stop`, the system automatically:

1. **Main**: Stops PM2 webhook server
2. **Post-hook** (`postpm2:stop`): Stops SSH tunnel via `scripts/stop-tunnel.sh`
3. **Done**: Everything cleanly stopped

### Architecture

```
Hetzner (file changes) → Webhook → SSH Tunnel → WSL → rsync → Local Analysis
                                         ↑
                              Managed by npm scripts
```

## Configuration

Edit `.env` with your settings:

```bash
# Required
WEBHOOK_SECRET=your-super-secret-key-change-this
COMPASS_PATH=/home/YOUR_USERNAME/Documents/claude-compass
LOCAL_PROJECT_PATH=/home/YOUR_USERNAME/Documents/project_name
REMOTE_HOST=username@HETZNER_IP
REMOTE_PROJECT_PATH=/var/www/project_name
TUNNEL_PORT=3456

# Optional
SYNC_STRATEGY=incremental  # or 'full'
```

## Auto-Start on WSL Boot (Optional)

Add to `~/.bashrc`:

```bash
# Auto-start webhook server (tunnel starts automatically)
if ! pm2 show compass-webhook > /dev/null 2>&1; then
  cd ~/Documents/claude-compass/webhook-server && npm run pm2:start
fi
```

## Restart Decision Tree

**Changed webhook server code or .env?**
```bash
npm run pm2:restart  # Quick restart (5-10s)
```

**Tunnel connection issues or changed REMOTE_HOST?**
```bash
npm run pm2:restart:full  # Full restart (10-15s)
```

**Everything broken or want fresh start?**
```bash
npm run pm2:stop
npm run pm2:start  # Nuclear option
```

## Troubleshooting

### Tunnel won't start

```bash
# Test SSH connection
ssh YOUR_REMOTE_HOST echo "Connection works"

# Check if passwordless SSH is configured
ssh YOUR_REMOTE_HOST echo "test"
# Should NOT ask for password!

# View tunnel logs
npm run tunnel:status

# Force restart tunnel
npm run tunnel:stop
npm run tunnel:start
```

### Webhook not receiving requests

```bash
# Check tunnel from remote server
ssh YOUR_REMOTE_HOST "curl http://localhost:3456/health"
# Should return: {"status":"healthy",...}

# If not working, full restart
npm run pm2:restart:full
```

### Sync failures

```bash
# Test manual rsync
rsync -avz YOUR_REMOTE_HOST:/var/www/project_name/composer.json ~/Documents/project_name/

# Check webhook logs
tail -100 /tmp/compass-webhook.log

# Restart if needed
npm run pm2:restart
```

## Performance

With optimized exclusions (no dependencies, builds, uploads):

- **Initial sync**: 5-30 seconds
- **Incremental sync**: <1 second per file
- **Analysis time**: 1-3 seconds
- **Total latency**: 2-5 seconds from file change to analysis complete
- **Disk usage**: 70-95% smaller than full project

## Security

- Use strong webhook secret: `openssl rand -hex 32`
- SSH key authentication required (not passwords)
- Tunnel only accessible on localhost
- Follow SETUP_GUIDE.md for security hardening

## More Information

- **Full Setup Guide**: See [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- **Claude Compass Docs**: See [../README.md](../README.md)
