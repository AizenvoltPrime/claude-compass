#!/usr/bin/env node

/**
 * Claude Compass Webhook Server (rsync version)
 * Syncs changed files from Hetzner to local WSL, then triggers analysis
 * MUCH faster than SSHFS - uses local file I/O
 */

import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
  port: 3456,
  webhookSecret: process.env.WEBHOOK_SECRET || 'your-secret-key-here',
  compassPath: process.env.COMPASS_PATH,

  // NEW: Local project path (where rsync copies files)
  localProjectPath: process.env.LOCAL_PROJECT_PATH,

  // NEW: Remote connection details
  remoteHost: process.env.REMOTE_HOST,
  remoteProjectPath: process.env.REMOTE_PROJECT_PATH,

  batchDelayMs: parseInt(process.env.BATCH_DELAY_MS || '3000'),
  logFile: '/tmp/compass-webhook.log',

  // Sync strategy: 'incremental' or 'full'
  syncStrategy: process.env.SYNC_STRATEGY || 'incremental',

  // Analysis configuration
  enableAnalysis: process.env.ENABLE_ANALYSIS !== 'false', // true by default
  analysisFlags: process.env.ANALYSIS_FLAGS || '--verbose', // e.g., '--verbose --skip-embeddings --force-full'
};

interface WebhookPayload {
  event: 'created' | 'modified' | 'deleted' | 'moved';
  file_path: string;
  full_path: string;
  timestamp: string;
  repository: string;
}

// Batch processing queue
let pendingChanges: Set<string> = new Set();
let batchTimer: NodeJS.Timeout | null = null;

async function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());
  await fs.appendFile(CONFIG.logFile, logMessage).catch(() => {});
}

function verifyWebhook(req: Request): boolean {
  const secret = req.headers['x-webhook-secret'];
  return secret === CONFIG.webhookSecret;
}

// NEW: Sync files from Hetzner to local WSL using rsync
async function syncFiles(changedFiles: string[]) {
  const syncStart = Date.now();

  if (CONFIG.syncStrategy === 'full' || changedFiles.length === 0) {
    // Full project sync - only files Claude Compass analyzes
    await log(`🔄 Performing full rsync (excluding dependencies, build artifacts, logs, cache)...`);
    const command = `rsync -az --delete \
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
      ${CONFIG.remoteHost}:${CONFIG.remoteProjectPath}/ ${CONFIG.localProjectPath}/`;

    try {
      const { stderr } = await execAsync(command, {
        timeout: 120000, // 2 minute timeout
      });

      const syncTime = ((Date.now() - syncStart) / 1000).toFixed(2);
      await log(`✅ Full sync completed in ${syncTime}s`);
      if (stderr && stderr.trim()) await log(`Rsync output: ${stderr}`);
    } catch (error) {
      const err = error as Error;
      await log(`❌ Full sync failed: ${err.message}`);
      throw error;
    }
  } else {
    // Incremental sync (MUCH faster - only changed files)
    await log(`🔄 Syncing ${changedFiles.length} changed file(s)...`);

    // Create temp file list for rsync
    const tmpFile = `/tmp/rsync-files-${Date.now()}.txt`;
    await fs.writeFile(tmpFile, changedFiles.join('\n'));

    // Sync only specific files using --files-from
    const command = `rsync -az --files-from=${tmpFile} ${CONFIG.remoteHost}:${CONFIG.remoteProjectPath}/ ${CONFIG.localProjectPath}/`;

    try {
      await execAsync(command, {
        timeout: 60000, // 1 minute timeout
      });

      const syncTime = ((Date.now() - syncStart) / 1000).toFixed(2);
      await log(`✅ Incremental sync completed in ${syncTime}s`);

      // Cleanup temp file
      await fs.unlink(tmpFile).catch(() => {});
    } catch (error) {
      const err = error as Error;
      await log(`⚠️ Incremental sync failed, falling back to full sync: ${err.message}`);

      // Cleanup temp file
      await fs.unlink(tmpFile).catch(() => {});

      // Fallback to full sync if incremental fails
      return syncFiles([]);
    }
  }
}

// Trigger analysis on LOCAL copy
async function triggerAnalysis(changedFiles: string[]) {
  if (!CONFIG.enableAnalysis) {
    await log(`⏭️ Analysis disabled (ENABLE_ANALYSIS=false)`);
    return;
  }

  await log(`Triggering analysis on local copy for ${changedFiles.length} file(s)`);
  await log(`Analysis flags: ${CONFIG.analysisFlags}`);

  try {
    // Run Claude Compass analyze command on LOCAL path with configured flags
    // Note: -- is required to pass arguments through npm run
    const command = `cd ${CONFIG.compassPath} && npm run analyze -- ${CONFIG.localProjectPath} ${CONFIG.analysisFlags}`;
    await log(`Executing: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
      timeout: 300000, // 5 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    if (stdout) await log(`Analysis output: ${stdout.substring(0, 500)}...`);
    if (stderr) await log(`Analysis stderr: ${stderr}`);

    await log(`✅ Analysis completed successfully`);
  } catch (error) {
    const err = error as Error;
    await log(`❌ Analysis failed: ${err.message}`);
    throw error;
  }
}

// Process batched changes: sync THEN analyze
async function processBatch() {
  if (pendingChanges.size === 0) return;

  const files = Array.from(pendingChanges);
  pendingChanges.clear();
  batchTimer = null;

  await log(`Processing batch of ${files.length} changed file(s)`);

  try {
    // Step 1: Sync files from Hetzner to local
    await syncFiles(files);

    // Step 2: Analyze local copy (FAST - no network I/O!)
    await triggerAnalysis(files);
  } catch (error) {
    const err = error as Error;
    await log(`❌ Batch processing failed: ${err.message}`);
  }
}

function scheduleBatch() {
  if (batchTimer) {
    clearTimeout(batchTimer);
  }
  batchTimer = setTimeout(processBatch, CONFIG.batchDelayMs);
}

// Express server setup
const app = express();
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    pendingChanges: pendingChanges.size,
    config: {
      port: CONFIG.port,
      compassPath: CONFIG.compassPath,
      localProjectPath: CONFIG.localProjectPath,
      remoteHost: CONFIG.remoteHost,
      syncStrategy: CONFIG.syncStrategy,
      enableAnalysis: CONFIG.enableAnalysis,
      analysisFlags: CONFIG.analysisFlags,
      batchDelayMs: CONFIG.batchDelayMs,
    },
  });
});

app.post('/webhook/file-changed', async (req: Request, res: Response) => {
  if (!verifyWebhook(req)) {
    await log('❌ Invalid webhook secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body as WebhookPayload;

  if (!payload.file_path || !payload.event) {
    await log('❌ Invalid webhook payload');
    return res.status(400).json({ error: 'Invalid payload' });
  }

  await log(`📁 File ${payload.event}: ${payload.file_path}`);

  // Add to batch queue
  pendingChanges.add(payload.file_path);
  scheduleBatch();

  res.json({
    status: 'queued',
    file: payload.file_path,
    event: payload.event,
    batchSize: pendingChanges.size,
    willProcessIn: `${CONFIG.batchDelayMs / 1000}s`,
  });
});

app.post('/trigger/analyze', async (req: Request, res: Response) => {
  if (!verifyWebhook(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  await log('🚀 Manual analysis trigger requested');

  try {
    await syncFiles([]); // Full sync
    await triggerAnalysis([]);
    res.json({ status: 'success', message: 'Analysis triggered' });
  } catch (error) {
    const err = error as Error;
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// NEW: Manual sync endpoint (no analysis)
app.post('/trigger/sync', async (_req: Request, res: Response) => {
  if (!verifyWebhook(_req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  await log('🔄 Manual sync trigger requested');

  try {
    await syncFiles([]); // Full sync
    res.json({ status: 'success', message: 'Sync completed' });
  } catch (error) {
    const err = error as Error;
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(CONFIG.port, '0.0.0.0', () => {
  log(`🚀 Webhook server running on port ${CONFIG.port} (rsync mode)`);
  log(`📂 Compass path: ${CONFIG.compassPath}`);
  log(`📂 Local project: ${CONFIG.localProjectPath}`);
  log(`🌐 Remote: ${CONFIG.remoteHost}:${CONFIG.remoteProjectPath}`);
  log(`🔒 Secret configured: ${CONFIG.webhookSecret.substring(0, 10)}...`);
  log(`⚙️  Sync strategy: ${CONFIG.syncStrategy}`);
  log(`🔍 Analysis enabled: ${CONFIG.enableAnalysis}`);
  log(`🚩 Analysis flags: ${CONFIG.analysisFlags}`);
  log(`⏱️  Batch delay: ${CONFIG.batchDelayMs}ms`);
});

process.on('SIGTERM', async () => {
  await log('Received SIGTERM, shutting down...');
  if (pendingChanges.size > 0) {
    await log('Processing pending changes before shutdown...');
    await processBatch();
  }
  process.exit(0);
});
