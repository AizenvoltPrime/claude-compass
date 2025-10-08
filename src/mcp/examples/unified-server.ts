#!/usr/bin/env node
/**
 * Unified Server - Combines Webhook Server and HTTP MCP Server
 *
 * Runs on single port (default: 3456) with:
 * - /webhook/* endpoints (webhook secret authentication)
 * - /mcp endpoints (bearer token authentication)
 * - /health endpoint (no authentication)
 */

import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';
import { exec, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ClaudeCompassMCPServer } from '../server.js';
import { createComponentLogger } from '../../utils/logger.js';

const execAsync = promisify(exec);
const logger = createComponentLogger('unified-server');

const app = express();
app.use(express.json());

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  port: parseInt(process.env.MCP_HTTP_PORT || '3456', 10),
  host: process.env.MCP_HTTP_HOST || 'localhost',

  // MCP authentication
  mcpAuthToken: process.env.MCP_AUTH_TOKEN,
  allowAllHosts: process.env.MCP_ALLOW_ALL_HOSTS === 'true',
  defaultRepoName: process.env.DEFAULT_REPO_NAME,

  // SSH Tunnel configuration
  enableTunnel: process.env.ENABLE_SSH_TUNNEL === 'true',
  sshRemoteHost: process.env.SSH_REMOTE_HOST, // username@hostname
  sshKeyPath: process.env.SSH_KEY_PATH, // Optional: path to SSH key
  tunnelServerAliveInterval: parseInt(process.env.SSH_SERVER_ALIVE_INTERVAL || '30'),
  tunnelServerAliveCountMax: parseInt(process.env.SSH_SERVER_ALIVE_COUNT_MAX || '3'),

  // Webhook configuration
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  compassPath: process.env.COMPASS_PATH,
  localProjectPath: process.env.LOCAL_PROJECT_PATH,
  remoteHost: process.env.REMOTE_HOST,
  remoteProjectPath: process.env.REMOTE_PROJECT_PATH,
  batchDelayMs: parseInt(process.env.BATCH_DELAY_MS || '3000'),
  syncStrategy: process.env.SYNC_STRATEGY || 'incremental',
  enableAnalysis: process.env.ENABLE_ANALYSIS !== 'false',
  analysisFlags: process.env.ANALYSIS_FLAGS || '--verbose',
  logFile: '/tmp/compass-webhook.log',
};

// =============================================================================
// SSH TUNNEL MANAGER
// =============================================================================

class SSHTunnelManager {
  private sshProcess: ChildProcess | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  async start(): Promise<void> {
    if (!CONFIG.enableTunnel) {
      logger.info('SSH tunnel disabled (ENABLE_SSH_TUNNEL not set to true)');
      return;
    }

    if (!CONFIG.sshRemoteHost) {
      logger.warn('SSH tunnel enabled but SSH_REMOTE_HOST not configured');
      return;
    }

    await this.startTunnel();
  }

  private async startTunnel(): Promise<void> {
    if (this.sshProcess) {
      logger.warn('SSH tunnel already running');
      return;
    }

    logger.info('Starting SSH reverse tunnel', {
      remoteHost: CONFIG.sshRemoteHost,
      localPort: CONFIG.port,
    });

    const sshArgs = [
      '-N',  // No command execution
      '-R', `${CONFIG.port}:localhost:${CONFIG.port}`,  // Reverse tunnel
      '-o', `ServerAliveInterval=${CONFIG.tunnelServerAliveInterval}`,
      '-o', `ServerAliveCountMax=${CONFIG.tunnelServerAliveCountMax}`,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'LogLevel=ERROR',
    ];

    if (CONFIG.sshKeyPath) {
      sshArgs.push('-i', CONFIG.sshKeyPath);
    }

    sshArgs.push(CONFIG.sshRemoteHost!);

    this.sshProcess = spawn('ssh', sshArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.sshProcess.stdout?.on('data', (data) => {
      logger.debug(`SSH tunnel stdout: ${data.toString().trim()}`);
    });

    this.sshProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        logger.error(`SSH tunnel stderr: ${message}`);
      }
    });

    this.sshProcess.on('error', (error) => {
      logger.error('SSH tunnel process error', { error: error.message });
      this.handleTunnelExit(1);
    });

    this.sshProcess.on('exit', (code, signal) => {
      logger.warn('SSH tunnel exited', { code, signal });
      this.sshProcess = null;
      this.handleTunnelExit(code || 0);
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    if (this.sshProcess && !this.sshProcess.killed) {
      logger.info('✅ SSH tunnel established successfully');
    } else {
      logger.error('❌ SSH tunnel failed to start');
    }
  }

  private handleTunnelExit(code: number): void {
    if (this.isShuttingDown) {
      logger.info('SSH tunnel shutdown complete');
      return;
    }

    if (code !== 0) {
      logger.warn('SSH tunnel disconnected, attempting reconnect in 5 seconds...');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.isShuttingDown) {
        logger.info('Attempting to reconnect SSH tunnel...');
        await this.startTunnel();
      }
    }, 5000);
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sshProcess) {
      logger.info('Stopping SSH tunnel...');
      this.sshProcess.kill('SIGTERM');

      await new Promise(resolve => setTimeout(resolve, 1000));

      if (this.sshProcess && !this.sshProcess.killed) {
        logger.warn('SSH tunnel did not stop gracefully, forcing...');
        this.sshProcess.kill('SIGKILL');
      }

      this.sshProcess = null;
    }
  }

  isRunning(): boolean {
    return this.sshProcess !== null && !this.sshProcess.killed;
  }
}

const sshTunnel = new SSHTunnelManager();

// =============================================================================
// AUTHENTICATION HELPERS
// =============================================================================

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  return cryptoTimingSafeEqual(bufferA, bufferB);
}

function createMcpAuthMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!CONFIG.mcpAuthToken) {
      const clientIp = req.ip || req.socket.remoteAddress;
      if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1') {
        return next();
      }
      logger.warn('Unauthorized remote MCP access attempt', { clientIp });
      return res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Authentication required for remote access' },
        id: null,
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Missing or invalid authorization header for MCP', {
        clientIp: req.ip || req.socket.remoteAddress,
      });
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Missing or invalid authorization header' },
        id: null,
      });
    }

    const token = authHeader.substring(7);
    if (!timingSafeEqual(token, CONFIG.mcpAuthToken)) {
      logger.warn('Invalid MCP authentication token', {
        clientIp: req.ip || req.socket.remoteAddress,
      });
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32002, message: 'Invalid authentication token' },
        id: null,
      });
    }

    next();
  };
}

function createWebhookAuthMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const secret = req.headers['x-webhook-secret'];
    if (!secret || secret !== CONFIG.webhookSecret) {
      logger.warn('Invalid webhook secret', {
        clientIp: req.ip || req.socket.remoteAddress,
      });
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
    next();
  };
}

// =============================================================================
// CORS CONFIGURATION
// =============================================================================

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Authorization, X-Webhook-Secret');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// =============================================================================
// HEALTH ENDPOINT (No Authentication)
// =============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    config: {
      mcpEnabled: true,
      webhookEnabled: !!CONFIG.webhookSecret,
      mcpAuthenticationEnabled: !!CONFIG.mcpAuthToken,
      defaultRepoName: CONFIG.defaultRepoName || null,
      dnsRebindingProtection: !CONFIG.allowAllHosts,
      sshTunnelEnabled: CONFIG.enableTunnel,
      sshTunnelRunning: sshTunnel.isRunning(),
    },
  });
});

// =============================================================================
// WEBHOOK ENDPOINTS (Webhook Secret Authentication)
// =============================================================================

interface WebhookPayload {
  event: 'created' | 'modified' | 'deleted' | 'moved';
  file_path: string;
  full_path: string;
  timestamp: string;
  repository: string;
}

let pendingChanges: Set<string> = new Set();
let batchTimer: NodeJS.Timeout | null = null;

async function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());
  await fs.appendFile(CONFIG.logFile, logMessage).catch(() => {});
}

async function syncFiles(changedFiles: string[]) {
  const syncStart = Date.now();

  if (CONFIG.syncStrategy === 'full' || changedFiles.length === 0) {
    await log(`🔄 Performing full rsync...`);
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
      --exclude='public/uploads' \
      --exclude='public/build' \
      --exclude='.git' \
      --exclude='dist' \
      --exclude='build' \
      --exclude='*.log' \
      --exclude='*.cache' \
      --exclude='.env' \
      ${CONFIG.remoteHost}:${CONFIG.remoteProjectPath}/ ${CONFIG.localProjectPath}/`;

    const { stderr } = await execAsync(command, { timeout: 120000 });
    const syncTime = ((Date.now() - syncStart) / 1000).toFixed(2);
    await log(`✅ Full sync completed in ${syncTime}s`);
    if (stderr?.trim()) await log(`Rsync output: ${stderr}`);
  } else {
    await log(`🔄 Syncing ${changedFiles.length} changed file(s)...`);
    const tmpFile = `/tmp/rsync-files-${Date.now()}.txt`;
    await fs.writeFile(tmpFile, changedFiles.join('\n'));

    const command = `rsync -az --files-from=${tmpFile} ${CONFIG.remoteHost}:${CONFIG.remoteProjectPath}/ ${CONFIG.localProjectPath}/`;
    await execAsync(command, { timeout: 60000 });

    const syncTime = ((Date.now() - syncStart) / 1000).toFixed(2);
    await log(`✅ Incremental sync completed in ${syncTime}s`);
    await fs.unlink(tmpFile).catch(() => {});
  }
}

async function triggerAnalysis(changedFiles: string[]) {
  if (!CONFIG.enableAnalysis) {
    await log('ℹ️ Analysis disabled (ENABLE_ANALYSIS=false)');
    return;
  }

  const analysisStart = Date.now();
  await log(`📊 Starting analysis of ${CONFIG.localProjectPath}...`);

  const command = `cd ${CONFIG.compassPath} && npm run analyze -- "${CONFIG.localProjectPath}" ${CONFIG.analysisFlags}`;

  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 300000 });
    const analysisTime = ((Date.now() - analysisStart) / 1000).toFixed(2);
    await log(`✅ Analysis completed in ${analysisTime}s`);
    if (stdout) await log(`Analysis output: ${stdout}`);
    if (stderr) await log(`Analysis stderr: ${stderr}`);
  } catch (error) {
    const err = error as Error;
    await log(`❌ Analysis failed: ${err.message}`);
    throw error;
  }
}

async function processBatch() {
  const filesToProcess = Array.from(pendingChanges);
  pendingChanges.clear();
  batchTimer = null;

  if (filesToProcess.length === 0) return;

  await log(`📦 Processing batch of ${filesToProcess.length} file(s)...`);

  try {
    await syncFiles(filesToProcess);
    await triggerAnalysis(filesToProcess);
  } catch (error) {
    const err = error as Error;
    await log(`❌ Batch processing failed: ${err.message}`);
  }
}

function scheduleBatch() {
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(processBatch, CONFIG.batchDelayMs);
}

app.post('/webhook/file-changed', createWebhookAuthMiddleware(), async (req: Request, res: Response) => {
  const payload: WebhookPayload = req.body;
  await log(`📝 Received ${payload.event} event for: ${payload.file_path}`);

  pendingChanges.add(payload.file_path);
  scheduleBatch();

  res.json({
    status: 'queued',
    file: payload.file_path,
    queueSize: pendingChanges.size,
    batchDelayMs: CONFIG.batchDelayMs,
  });
});

app.post('/trigger/analyze', createWebhookAuthMiddleware(), async (req: Request, res: Response) => {
  await log('🔄 Manual full analysis triggered');
  res.json({ status: 'started', message: 'Full analysis triggered' });

  try {
    await syncFiles([]);
    await triggerAnalysis([]);
  } catch (error) {
    const err = error as Error;
    await log(`❌ Manual analysis failed: ${err.message}`);
  }
});

app.post('/trigger/sync', createWebhookAuthMiddleware(), async (req: Request, res: Response) => {
  await log('🔄 Manual full sync triggered');
  res.json({ status: 'started', message: 'Full sync triggered' });

  try {
    await syncFiles([]);
  } catch (error) {
    const err = error as Error;
    await log(`❌ Manual sync failed: ${err.message}`);
  }
});

// =============================================================================
// MCP ENDPOINTS (Bearer Token Authentication)
// =============================================================================

const mcpTransports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

app.post('/mcp', createMcpAuthMiddleware(), async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  try {
    if (sessionId && mcpTransports[sessionId]) {
      transport = mcpTransports[sessionId];
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          mcpTransports[sessionId] = transport;
        },
        enableDnsRebindingProtection: !CONFIG.allowAllHosts,
        allowedHosts: CONFIG.allowAllHosts ? undefined : ['127.0.0.1', 'localhost'],
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          delete mcpTransports[transport.sessionId];
        }
      };

      const server = new ClaudeCompassMCPServer(transport.sessionId);
      await server.start(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', createMcpAuthMiddleware(), async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !mcpTransports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = mcpTransports[sessionId];
  await transport.handleRequest(req, res);
});

app.delete('/mcp', createMcpAuthMiddleware(), async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !mcpTransports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = mcpTransports[sessionId];
  await transport.handleRequest(req, res);
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

app.listen(CONFIG.port, CONFIG.host, async () => {
  logger.info(`Unified Server listening on ${CONFIG.host}:${CONFIG.port}`, {
    mcpEnabled: true,
    webhookEnabled: !!CONFIG.webhookSecret,
    mcpAuthEnabled: !!CONFIG.mcpAuthToken,
    defaultRepoName: CONFIG.defaultRepoName,
  });

  console.log(`🚀 Unified Server running on http://${CONFIG.host}:${CONFIG.port}`);
  console.log();
  console.log('📡 Available Endpoints:');
  console.log('   GET    /health                  - Health check');
  console.log('   POST   /webhook/file-changed    - File change webhook');
  console.log('   POST   /trigger/analyze         - Manual analysis trigger');
  console.log('   POST   /trigger/sync            - Manual sync trigger');
  console.log('   POST   /mcp                     - MCP client requests');
  console.log('   GET    /mcp                     - MCP SSE notifications');
  console.log('   DELETE /mcp                     - MCP session termination');
  console.log();

  if (CONFIG.defaultRepoName) {
    console.log(`   📁 Default repository: ${CONFIG.defaultRepoName}`);
  }

  console.log('🔐 Authentication:');
  if (CONFIG.webhookSecret) {
    console.log('   ✅ Webhook: Secret configured');
  } else {
    console.log('   ⚠️  Webhook: No secret (insecure)');
  }

  if (CONFIG.mcpAuthToken) {
    console.log('   ✅ MCP: Bearer token required');
  } else {
    console.log('   ⚠️  MCP: Localhost only (no token)');
  }

  if (CONFIG.allowAllHosts) {
    console.log('   ⚠️  DNS rebinding protection: DISABLED');
  } else {
    console.log('   🔒 DNS rebinding protection: ENABLED');
  }

  console.log();

  if (CONFIG.enableTunnel) {
    console.log('🔌 Starting SSH tunnel...');
    await sshTunnel.start();
    if (sshTunnel.isRunning()) {
      console.log(`   ✅ Tunnel: ${CONFIG.sshRemoteHost} → localhost:${CONFIG.port}`);
    } else {
      console.log(`   ⚠️  Tunnel: Failed to establish (check SSH configuration)`);
    }
  } else {
    console.log('🔌 SSH Tunnel: DISABLED');
    console.log('   💡 Set ENABLE_SSH_TUNNEL=true to auto-create reverse tunnel');
  }
});

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  console.log(`\n🛑 Shutting down (${signal})...`);

  if (sshTunnel.isRunning()) {
    console.log('   Stopping SSH tunnel...');
    await sshTunnel.stop();
  }

  console.log('   Server stopped');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
