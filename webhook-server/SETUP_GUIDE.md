# Real-Time Incremental Analysis Setup Guide

Complete guide for setting up file change monitoring from Hetzner to WSL Claude Compass with **rsync-based local analysis** (10x faster than SSHFS).

## Architecture

```
Hetzner (file changes) → Webhook → SSH Tunnel → WSL → rsync sync → Local Analysis (FAST!)
                                                        ↓
                                         Excludes: dependencies, builds, uploads
                                         Includes: Only source code Claude Compass analyzes
```

## Prerequisites

- Hetzner server with SSH access
- WSL2 on Windows 11
- Claude Compass installed on WSL
- Network connectivity between Hetzner and your Windows PC

---

## Part 1: SSH Key Authentication (CRITICAL!)

**Autossh requires passwordless SSH authentication.** Without this, the tunnel won't work automatically.

### 1.1 Generate SSH Key on WSL

```bash
# Check if you already have a key
ls -la ~/.ssh/id_*

# If no key exists, generate one
ssh-keygen -t ed25519 -C "wsl-to-hetzner"
# Press Enter for all prompts (accept defaults, no passphrase recommended for automation)
```

### 1.2 Copy Key to Hetzner

```bash
# Copy the key to Hetzner (will ask for password ONE LAST TIME)
ssh-copy-id username@HETZNER_IP

# Test passwordless auth works
ssh username@HETZNER_IP echo "Passwordless auth works"
# Should NOT ask for password!
```

**★ Critical:** If this asks for a password, autossh will NOT work. Debug with:

```bash
# Check key was copied correctly
ssh username@HETZNER_IP "cat ~/.ssh/authorized_keys"

# Test with verbose output
ssh -v username@HETZNER_IP echo "test"
# Look for "Authenticated with key" in output
```

---

## Part 2: Initial Project Sync (WSL)

### 2.1 Create Local Directory and Sync

```bash
# Create local directory for project files
mkdir -p ~/Documents/project_name

# One-time full sync - ONLY files Claude Compass analyzes
# Excludes: dependencies, build artifacts, logs, cache, uploads, user images
rsync -avz --delete --exclude='node_modules' --exclude='vendor' --exclude='bin' --exclude='obj' --exclude='*.dll' --exclude='*.exe' --exclude='*.pdb' --exclude='storage/logs' --exclude='storage/framework' --exclude='storage/app/cache' --exclude='storage/app/public' --exclude='storage/app/json' --exclude='storage/app/private' --exclude='storage/app/temp' --exclude='storage/oauth-*.key' --exclude='storage/*.key' --exclude='storage/*.json' --exclude='public/uploads' --exclude='public/build' --exclude='public/hot' --exclude='.git' --exclude='dist' --exclude='build' --exclude='*.log' --exclude='*.cache' --exclude='.env' username@HETZNER_IP:/var/www/project_name/ ~/Documents/project_name/

# Verify files are synced (should be MUCH smaller than full project)
ls ~/Documents/project_name
du -sh ~/Documents/project_name  # Check actual disk usage
```

**Why exclude these?**

- Claude Compass only analyzes source files: `.js, .jsx, .ts, .tsx, .vue, .php, .cs, .tscn`
- Skips compiled/generated files:
  - JavaScript/PHP dependencies: `node_modules/`, `vendor/`
  - .NET build outputs: `bin/`, `obj/`, `*.dll`, `*.exe`
  - User uploads: Images, documents, media files
  - Runtime data: Logs, cache, thumbnails, temp files
- Result: **70-95% smaller** sync size and **5-20x faster** initial sync!

---

## Part 3: Webhook Server Setup (WSL)

### 3.1 Configure Environment

```bash
cd ~/Documents/claude-compass/webhook-server

# Copy example env file
cp .env.example .env

# Edit with your details
nano .env
```

**Update these required values:**

```bash
WEBHOOK_SECRET=your-super-secret-key-change-this  # Must match Hetzner!
COMPASS_PATH=/home/YOUR_USERNAME/Documents/claude-compass
LOCAL_PROJECT_PATH=/home/YOUR_USERNAME/Documents/project_name
REMOTE_HOST=username@HETZNER_IP
REMOTE_PROJECT_PATH=/var/www/project_name
```

**Optional configurations:**

```bash
# File sync strategy (incremental = faster, full = safer)
SYNC_STRATEGY=incremental

# Analysis configuration
ENABLE_ANALYSIS=true                    # Set to 'false' to sync files only (no analysis)
ANALYSIS_FLAGS=--verbose                # Add --skip-embeddings, --force-full, --no-test-files, etc.
BATCH_DELAY_MS=3000                     # Wait time before processing batched changes (ms)
```

**Common analysis flag combinations:**

```bash
# Fast mode (skip vector search embeddings, 5-10x faster analysis)
ANALYSIS_FLAGS="--verbose --skip-embeddings"

# Force full re-analysis every time (clears existing data)
ANALYSIS_FLAGS="--verbose --force-full"

# Skip test files (faster, smaller database)
ANALYSIS_FLAGS="--verbose --no-test-files"

# Only sync files, no analysis
ENABLE_ANALYSIS=false
```

**IMPORTANT:** Generate a strong webhook secret:

```bash
openssl rand -hex 32
```

### 3.2 Install Dependencies

```bash
cd ~/Documents/claude-compass/webhook-server

# Install if not already done
npm install

# Install PM2 globally for process management
npm install -g pm2
```

### 3.3 Start Webhook Server (Tunnel Auto-Managed)

The SSH tunnel is now **automatically managed** by PM2 commands - no need to start/stop it separately!

```bash
cd ~/Documents/claude-compass/webhook-server

# This automatically starts the tunnel, then the webhook server
npm run pm2:start

# Check status (both PM2 and tunnel)
pm2 status
npm run tunnel:status

# Check logs
pm2 logs compass-webhook --lines 20
```

**What happens:**
1. `npm run pm2:start` automatically runs `prepm2:start` hook
2. Pre-hook starts SSH tunnel via `scripts/start-tunnel.sh`
3. PM2 starts the webhook server
4. Everything runs together seamlessly!

**Test tunnel on Hetzner:**

```bash
# On Hetzner: Check if port is listening
ss -tlnp | grep 3456

# Should show port listening on localhost:3456
```

### 3.4 Stop Webhook Server (Tunnel Auto-Stopped)

```bash
# This automatically stops the webhook server, then the tunnel
npm run pm2:stop

# Verify tunnel stopped
npm run tunnel:status
# Should show: ✗ SSH tunnel is NOT running
```

### 3.5 Test Setup

```bash
# On WSL: Test locally
curl http://localhost:3456/health
# Should return: {"status":"healthy","timestamp":"...","config":{...}}

# On Hetzner: Test through tunnel
curl http://localhost:3456/health
# Should return same JSON (if tunnel works)
```

---

## Part 4: Hetzner File Watcher Setup

This part sets up the file watcher on Hetzner that detects changes and sends webhooks.

**Choose your path:**
- **4.A**: Fresh setup (nothing configured yet)
- **4.B**: Verify existing setup (watcher already configured)

---

### 4.A: Fresh Hetzner Setup (From Scratch)

Follow these steps if you don't have a file watcher configured yet.

#### 4.A.1 Install Required Tools

```bash
# On Hetzner
sudo apt update
sudo apt install -y inotify-tools curl
```

#### 4.A.2 Create File Watcher Script

```bash
# Create the watcher script
sudo nano /usr/local/bin/project_name-file-watcher.sh
```

**Paste this content** (update PROJECT_PATH, WEBHOOK_SECRET, and repository name in JSON):

```bash
#!/bin/bash

# Hetzner File Watcher - Monitors codebase and triggers WSL Claude Compass analysis
# Installation: sudo systemctl enable --now project_name-watcher.service

set -euo pipefail

# Configuration
PROJECT_PATH="/var/www/project_name"
WEBHOOK_URL="http://localhost:3456/webhook/file-changed"
WEBHOOK_SECRET="your-super-secret-key-change-this"  # MUST match WSL .env!
LOG_FILE="/var/log/project_name-watcher.log"

# File patterns to watch (only what Claude Compass analyzes)
WATCH_EXTENSIONS="php|ts|js|jsx|tsx|vue|cs|tscn|json"
EXCLUDE_PATTERNS="node_modules|vendor|storage/logs|storage/framework|public/uploads|bin|obj|\.git|dist|build"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Send webhook notification
send_webhook() {
    local file_path="$1"
    local event_type="$2"

    # Make path relative to project root
    local relative_path="${file_path#$PROJECT_PATH/}"

    log "File change detected: $event_type - $relative_path"

    # Send HTTP POST to WSL webhook server (through SSH tunnel)
    curl -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
        -d "{
            \"event\": \"$event_type\",
            \"file_path\": \"$relative_path\",
            \"full_path\": \"$file_path\",
            \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
            \"repository\": \"project_name\"
        }" \
        --max-time 5 \
        --silent \
        --show-error \
        || log "ERROR: Failed to send webhook for $relative_path"
}

# Check if inotify-tools is installed
if ! command -v inotifywait &> /dev/null; then
    log "ERROR: inotify-tools not installed. Run: sudo apt install inotify-tools"
    exit 1
fi

log "Starting file watcher for: $PROJECT_PATH"
log "Webhook URL: $WEBHOOK_URL"
log "Watching extensions: $WATCH_EXTENSIONS"

# Start monitoring with inotifywait
inotifywait -m -r -e modify,create,delete,move \
    --exclude "($EXCLUDE_PATTERNS)" \
    --format '%w%f %e' \
    "$PROJECT_PATH" | while read -r filepath event; do

    # Check if file matches watch patterns
    if [[ "$filepath" =~ \.($WATCH_EXTENSIONS)$ ]]; then
        # Determine event type
        if [[ "$event" =~ CREATE ]]; then
            send_webhook "$filepath" "created"
        elif [[ "$event" =~ MODIFY ]]; then
            send_webhook "$filepath" "modified"
        elif [[ "$event" =~ DELETE ]]; then
            send_webhook "$filepath" "deleted"
        elif [[ "$event" =~ MOVED_TO ]]; then
            send_webhook "$filepath" "moved"
        fi
    fi
done
```

**Make it executable:**

```bash
sudo chmod +x /usr/local/bin/project_name-file-watcher.sh
```

**★ Important Configuration:**
- `PROJECT_PATH`: Your project path on Hetzner
- `WEBHOOK_SECRET`: Must match your WSL `.env` file exactly
- `repository` in JSON: Used to identify the project (change "project_name")
- `WATCH_EXTENSIONS`: Only source files Claude Compass analyzes
- `EXCLUDE_PATTERNS`: Skips dependencies, builds, uploads (faster monitoring)

**★ Script Features:**
- `set -euo pipefail`: Bash strict mode (exit on errors)
- `log()` function: Timestamps with `tee` for both terminal and file
- Checks if `inotify-tools` is installed before running
- Event type detection: created, modified, deleted, moved
- Graceful error handling with `|| log "ERROR: ..."`

#### 4.A.3 Create Systemd Service

```bash
# Create service file
sudo nano /etc/systemd/system/project_name-watcher.service
```

**Paste this content:**

```ini
[Unit]
Description=Project File Watcher - Triggers WSL Claude Compass Analysis
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
ExecStart=/usr/local/bin/project_name-file-watcher.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log

[Install]
WantedBy=multi-user.target
```

**★ Service Security Features:**
- `User=www-data`: Runs as web server user (not root) for better security
- `NoNewPrivileges=true`: Prevents privilege escalation
- `PrivateTmp=true`: Isolates /tmp directory
- `ProtectSystem=strict`: Makes most of filesystem read-only
- `ProtectHome=true`: Makes /home inaccessible
- `ReadWritePaths=/var/log`: Only allows writing to log directory

**Note:** If your project files aren't owned by `www-data`, change the `User` to the appropriate user (e.g., `root` or your deploy user).

#### 4.A.4 Enable and Start Service

```bash
# Reload systemd to recognize new service
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable project_name-watcher.service

# Start the service
sudo systemctl start project_name-watcher.service

# Check status
sudo systemctl status project_name-watcher.service
# Should show: active (running)
```

#### 4.A.5 Configure SSH for Reverse Tunnels (Optional)

Most servers are already configured, but if you have issues:

```bash
# Edit SSH config
sudo nano /etc/ssh/sshd_config

# Verify these settings:
GatewayPorts no             # Keep 'no' for localhost only (more secure)
AllowTcpForwarding yes      # Required for reverse tunnels

# Restart SSH if you made changes
sudo systemctl restart sshd
```

---

### 4.B: Verify Existing Setup

If your `project_name-watcher.service` is already configured, just verify it's working:

#### 4.B.1 Check Service Status

```bash
# On Hetzner
systemctl status project_name-watcher.service

# Should show: active (running)
```

#### 4.B.2 View Service Configuration

```bash
# View the watcher script
cat /usr/local/bin/project_name-file-watcher.sh

# Verify webhook URL points to localhost (for tunnel)
grep WEBHOOK_URL /usr/local/bin/project_name-file-watcher.sh
# Should show: WEBHOOK_URL="http://localhost:3456/webhook/file-changed"
```

#### 4.B.3 Update Webhook Secret (If Needed)

```bash
# Edit the watcher script
sudo nano /usr/local/bin/project_name-file-watcher.sh

# Update this line to match your .env file:
WEBHOOK_SECRET="your-super-secret-key-change-this"

# Restart service after changes
sudo systemctl restart project_name-watcher.service
```

#### 4.B.4 Monitor File Watcher

```bash
# View live logs
sudo journalctl -u project_name-watcher.service -f

# View recent activity
sudo journalctl -u project_name-watcher.service -n 100

# Check for errors
sudo journalctl -u project_name-watcher.service | grep ERROR
```

---

## Part 5: Testing End-to-End

### 5.1 Test File Change Detection

```bash
# On Hetzner: Make a test change
echo "// Test change $(date)" >> /var/www/project_name/app/Models/User.php

# Watch Hetzner logs (should see webhook sent)
sudo journalctl -u project_name-watcher.service -f

# Watch WSL logs (should see sync + analysis)
pm2 logs compass-webhook

# Check webhook log file
tail -f /tmp/compass-webhook.log
```

**Expected flow:**

1. Hetzner detects file change
2. Sends webhook to localhost:3456 (through tunnel)
3. WSL webhook server receives it
4. rsync syncs changed file (usually <1 second)
5. Claude Compass analyzes local copy (1-3 seconds)
6. **Total time: 2-5 seconds!**

### 5.2 Manual Webhook Test

```bash
# On Hetzner: Send test webhook
curl -X POST http://localhost:3456/webhook/file-changed \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-super-secret-key-change-this" \
  -d '{
    "event": "modified",
    "file_path": "app/Models/User.php",
    "full_path": "/var/www/project_name/app/Models/User.php",
    "timestamp": "2025-10-07T17:30:00Z",
    "repository": "project_name"
  }'

# Should return: {"status":"queued","file":"app/Models/User.php",...}
```

### 5.3 Manual Analysis Trigger

```bash
# On WSL: Trigger full sync + analysis manually
curl -X POST http://localhost:3456/trigger/analyze \
  -H "X-Webhook-Secret: your-super-secret-key-change-this"

# Or just sync without analysis
curl -X POST http://localhost:3456/trigger/sync \
  -H "X-Webhook-Secret: your-super-secret-key-change-this"
```

---

## Part 6: Auto-Start Configuration

### 6.1 Auto-Start on WSL Boot (Optional)

Since the tunnel is now integrated with PM2, you only need to auto-start PM2:

```bash
# Add to ~/.bashrc
nano ~/.bashrc

# Add this line at the end:
# Auto-start webhook server (tunnel starts automatically)
if ! pm2 show compass-webhook > /dev/null 2>&1; then
  cd ~/Documents/claude-compass/webhook-server && npm run pm2:start
fi
```

**Note:** The tunnel is automatically managed by `pm2:start` and `pm2:stop`, so you don't need separate tunnel management in bashrc!

### 6.2 Windows Task Scheduler (Optional)

Create a task to start WSL services on Windows boot:

**PowerShell script** (`C:\scripts\wsl-compass.ps1`):

```powershell
# Start WSL and webhook services
wsl -d Ubuntu -u YOUR_USERNAME -- bash -c "cd ~/Documents/claude-compass/webhook-server && npm run pm2:start"
wsl -d Ubuntu -u YOUR_USERNAME -- bash -c "autossh -M 0 -N -f -o 'ServerAliveInterval 30' -o 'ServerAliveCountMax 3' -R 3456:localhost:3456 username@HETZNER_IP"
```

**Task Scheduler:**

1. Open Task Scheduler
2. Create Basic Task
3. Trigger: At log on
4. Action: Start a program
5. Program: `powershell.exe`
6. Arguments: `-File C:\scripts\wsl-compass.ps1`

---

## Part 7: Monitoring & Maintenance

### WSL Commands

```bash
# Check webhook server status
pm2 status

# Check tunnel status
npm run tunnel:status

# View logs
pm2 logs compass-webhook
pm2 logs compass-webhook --lines 100

# Restart server only (keeps tunnel running - FAST)
pm2 restart compass-webhook
# OR
npm run pm2:restart

# Full restart (server + tunnel - use for tunnel issues)
npm run pm2:restart:full

# Stop server and tunnel
npm run pm2:stop

# Start server and tunnel
npm run pm2:start

# Check local project size
du -sh ~/Documents/project_name

# Manual full re-sync
rsync -avz --delete --exclude='node_modules' --exclude='vendor' --exclude='bin' --exclude='obj' --exclude='*.dll' --exclude='*.exe' --exclude='*.pdb' --exclude='storage/logs' --exclude='storage/framework' --exclude='storage/app/cache' --exclude='storage/app/public' --exclude='storage/app/json' --exclude='storage/app/private' --exclude='storage/app/temp' --exclude='storage/oauth-*.key' --exclude='storage/*.key' --exclude='storage/*.json' --exclude='public/uploads' --exclude='public/build' --exclude='public/hot' --exclude='.git' --exclude='dist' --exclude='build' --exclude='*.log' --exclude='*.cache' --exclude='.env' username@HETZNER_IP:/var/www/project_name/ ~/Documents/project_name/
```

### Hetzner Commands

```bash
# Check watcher status
systemctl status project_name-watcher.service

# View logs
journalctl -u project_name-watcher.service -f

# View recent errors
journalctl -u project_name-watcher.service | grep ERROR | tail -20

# Restart watcher
systemctl restart project_name-watcher.service

# Stop watcher
systemctl stop project_name-watcher.service

# Check tunnel port
ss -tlnp | grep 3456

# Test webhook endpoint
curl http://localhost:3456/health
```

---

## Troubleshooting

### Tunnel Not Working

**Symptom:** `curl: (7) Failed to connect to localhost port 3456: Connection refused` on Hetzner

**Solution:**

```bash
# On Hetzner: Check if port is listening
ss -tlnp | grep 3456
# If nothing shows, tunnel is down

# On WSL: Check autossh is running
ps aux | grep '[a]utossh'

# Kill and restart tunnel
pkill autossh
autossh -M 0 -N -f -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" -R 3456:localhost:3456 username@HETZNER_IP

# Test passwordless SSH (CRITICAL)
ssh username@HETZNER_IP echo "test"
# Should NOT ask for password! If it does, autossh won't work.
```

**Debug tunnel with verbose output:**

```bash
# Kill autossh
pkill autossh

# Try manual tunnel to see errors
ssh -v -N -R 3456:localhost:3456 username@HETZNER_IP

# Look for errors like:
# - "Warning: remote port forwarding failed"
# - "administratively prohibited"
# - "Permission denied (publickey)"
```

### Webhook Not Received

**Symptom:** File changes don't trigger analysis

**Check list:**

```bash
# 1. WSL webhook server running?
pm2 status

# 2. Tunnel working?
ssh username@HETZNER_IP "curl -s http://localhost:3456/health"

# 3. Hetzner watcher running?
ssh username@HETZNER_IP "systemctl status project_name-watcher.service"

# 4. Webhook secret matches?
cat ~/Documents/claude-compass/webhook-server/.env | grep WEBHOOK_SECRET
ssh username@HETZNER_IP "grep WEBHOOK_SECRET /usr/local/bin/project_name-file-watcher.sh"
# Must be identical!

# 5. Check Hetzner watcher logs for errors
ssh username@HETZNER_IP "journalctl -u project_name-watcher.service -n 50 | grep ERROR"
```

### Sync Failures

**Symptom:** rsync fails or takes too long

```bash
# Test manual rsync
rsync -avz username@HETZNER_IP:/var/www/project_name/composer.json ~/Documents/project_name/

# Check network latency
ping -c 10 HETZNER_IP

# Check SSH connection
ssh username@HETZNER_IP echo "Connection works"

# View webhook server logs
pm2 logs compass-webhook --lines 100 | grep rsync
```

### Analysis Not Triggering

**Symptom:** Sync works but Claude Compass doesn't analyze

```bash
# Check webhook logs
tail -100 /tmp/compass-webhook.log

# Check Compass path is correct
cat ~/Documents/claude-compass/webhook-server/.env | grep COMPASS_PATH

# Test manual analysis trigger
curl -X POST http://localhost:3456/trigger/analyze \
  -H "X-Webhook-Secret: your-secret-key"

# Check PM2 logs for errors
pm2 logs compass-webhook --err --lines 50
```

### Out of Sync

**Symptom:** Local copy doesn't match Hetzner

**Solution:**

```bash
# Delete local and re-sync from scratch
rm -rf ~/Documents/project_name
mkdir -p ~/Documents/project_name
rsync -avz --delete --exclude='node_modules' --exclude='vendor' --exclude='bin' --exclude='obj' --exclude='*.dll' --exclude='*.exe' --exclude='*.pdb' --exclude='storage/logs' --exclude='storage/framework' --exclude='storage/app/cache' --exclude='storage/app/public' --exclude='storage/app/json' --exclude='storage/app/private' --exclude='storage/app/temp' --exclude='storage/oauth-*.key' --exclude='storage/*.key' --exclude='storage/*.json' --exclude='.git' --exclude='dist' --exclude='build' username@HETZNER_IP:/var/www/project_name/ ~/Documents/project_name/

# Or use webhook trigger endpoint
curl -X POST http://localhost:3456/trigger/sync \
  -H "X-Webhook-Secret: your-secret-key"
```

### Passwordless SSH Not Working

**Symptom:** SSH still asks for password, autossh fails silently

```bash
# Check SSH key was copied
ssh username@HETZNER_IP "cat ~/.ssh/authorized_keys"
# Should show your public key

# Check key permissions on WSL
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub

# Check Hetzner SSH config allows key auth
ssh username@HETZNER_IP "grep -E 'PubkeyAuthentication|PasswordAuthentication' /etc/ssh/sshd_config"
# Should show: PubkeyAuthentication yes

# Test with explicit key
ssh -i ~/.ssh/id_ed25519 username@HETZNER_IP echo "test"

# Check SSH agent
eval $(ssh-agent)
ssh-add ~/.ssh/id_ed25519
```

---

## Performance Tuning

### What's Excluded and Why

**Excluded directories/files:**

- `node_modules/`, `vendor/` - JavaScript/PHP dependencies (not analyzed)
- `bin/`, `obj/` - .NET build output directories
- `*.dll`, `*.exe`, `*.pdb` - Compiled .NET assemblies and executables
- `storage/logs/`, `storage/framework/` - Laravel logs, cache, sessions, compiled views
- `storage/app/cache/` - Image cache and other runtime cache
- `storage/app/public/` - Laravel public file storage
- `storage/app/json/` - Runtime JSON data
- `storage/app/private/` - User-uploaded images and media
- `storage/app/temp/` - Temporary files
- `storage/*.key`, `storage/*.json` - OAuth keys and runtime JSON files (sensitive/temporary)
- `public/uploads/`, `public/build/` - User uploads and compiled assets
- `.git/`, `dist/`, `build/` - Version control and build artifacts
- `*.log`, `*.cache` - Temporary files

**Included (analyzed by Claude Compass):**

- All `.js, .jsx, .ts, .tsx` files (JavaScript/TypeScript)
- All `.vue` files (Vue components)
- All `.php` files (Laravel backend)
- All `.cs, .tscn` files (if using C#/Godot)

**Result:** 70-95% smaller sync + 10x faster!

### Adjust Batch Delay and Analysis Settings

```bash
# Edit .env
nano ~/Documents/claude-compass/webhook-server/.env

# Batch delay (default is 3000ms):
BATCH_DELAY_MS=10000  # Wait 10 seconds to batch more changes

# Analysis optimization flags:
ANALYSIS_FLAGS="--verbose --skip-embeddings"  # Skip vector embedding generation (5-10x faster analysis)

# Or disable analysis entirely (sync only):
ENABLE_ANALYSIS=false  # Only sync files, no analysis
```

Restart webhook server after changes:
```bash
npm run pm2:restart:full
```

### Add Custom Exclusions

```bash
# Edit webhook server TypeScript file
nano ~/Documents/claude-compass/webhook-server/webhook-server.ts

# Find line ~69, add your exclusions:
--exclude='your-custom-dir' \
--exclude='*.your-extension' \

# Rebuild and restart
cd ~/Documents/claude-compass/webhook-server
npm run pm2:restart:rsync
```

---

## Success Metrics

After setup with optimized exclusions, you should see:

✅ **Initial full sync**: 5-30 seconds (with exclusions, vs 60s+ without)
✅ **Incremental sync**: <1 second per file
✅ **Analysis time**: 1-3 seconds (local I/O)
✅ **Total latency**: 2-5 seconds from file change to analysis complete
✅ **Disk usage**: 70-95% smaller than full project

- Typical Laravel project: ~20-100MB (vs 500MB-2GB with dependencies/images/cache)
- Only source code - no dependencies, user uploads, or cache

**vs SSHFS:**

- ⚠️ Analysis time: 10-30 seconds (network I/O)
- ⚠️ Total latency: 15-40 seconds
- ⚠️ Disk usage: None (but much slower)

**Performance gain: 10x faster + 70-95% less disk space!** 🚀

---

## Security Recommendations

1. **Use Strong Webhook Secret:**

   ```bash
   # Generate strong secret
   openssl rand -hex 32
   ```

2. **Use SSH Key Authentication:**
   - REQUIRED for autossh to work
   - More secure than passwords
   - Follow Part 1 of this guide

3. **Restrict SSH Access:**

   ```bash
   # On Hetzner: Allow only WSL IP (if static)
   sudo ufw allow from YOUR_WSL_IP to any port 22
   ```

4. **Regular Security Updates:**

   ```bash
   # WSL
   sudo apt update && sudo apt upgrade

   # Hetzner
   ssh username@HETZNER_IP "apt update && apt upgrade"
   ```

---

## Next Steps

1. ✅ Monitor system for 24 hours
2. ✅ Adjust batch delay based on file change frequency
3. ✅ Setup log rotation for `/tmp/compass-webhook.log`
4. ✅ Configure auto-start on Windows boot
5. ✅ Document your specific webhook secret securely

---

## Quick Reference

### Essential Commands

**WSL:**

```bash
# Status
pm2 status
npm run tunnel:status

# Logs
pm2 logs compass-webhook
tail -f /tmp/compass-webhook.log

# Restart
npm run pm2:restart              # Quick restart (server only)
npm run pm2:restart:full         # Full restart (server + tunnel)
npm run pm2:stop && npm run pm2:start  # Manual full restart

# Test
curl http://localhost:3456/health
```

**Hetzner:**

```bash
# Status
systemctl status project_name-watcher.service
ss -tlnp | grep 3456

# Logs
journalctl -u project_name-watcher.service -f

# Test
curl http://localhost:3456/health
```

---

## Support

If you encounter issues not covered in troubleshooting:

1. Check PM2 logs: `pm2 logs compass-webhook --lines 200`
2. Check Hetzner logs: `journalctl -u project_name-watcher.service -n 200`
3. Test each component individually (SSH, tunnel, webhook, rsync)
4. Verify SSH key authentication works without passwords

---

**Setup complete!** File changes on Hetzner now trigger fast incremental analysis on WSL. 🚀
