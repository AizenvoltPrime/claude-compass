#!/usr/bin/env node
/**
 * HTTP MCP Server using Streamable HTTP transport with SSE support
 *
 * Supports both HTTP POST (client requests) and SSE GET (server notifications)
 */

import express from 'express';
import { randomUUID, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ClaudeCompassMCPServer } from '../server.js';
import { createComponentLogger } from '../../utils/logger.js';

const logger = createComponentLogger('http-mcp-server');
const app = express();
app.use(express.json());

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  return cryptoTimingSafeEqual(bufferA, bufferB);
}

function createAuthMiddleware() {
  const authToken = process.env.MCP_AUTH_TOKEN;

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path === '/health') {
      return next();
    }

    if (!authToken) {
      const clientIp = req.ip || req.socket.remoteAddress;
      if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1') {
        return next();
      }
      logger.warn('Unauthorized remote access attempt', { clientIp });
      return res.status(403).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Authentication required for remote access',
        },
        id: null,
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Missing or invalid authorization header', {
        hasAuthHeader: !!authHeader,
        clientIp: req.ip || req.socket.remoteAddress,
      });
      return res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Missing or invalid authorization header. Expected format: Bearer <token>',
        },
        id: null,
      });
    }

    const token = authHeader.substring(7);
    if (!timingSafeEqual(token, authToken)) {
      logger.warn('Invalid authentication token', {
        clientIp: req.ip || req.socket.remoteAddress,
      });
      return res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32002,
          message: 'Invalid authentication token',
        },
        id: null,
      });
    }

    next();
  };
}

// CORS support for browser-based clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(createAuthMiddleware());

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Check if all hosts are allowed (DNS rebinding protection disabled)
const allowAllHosts = process.env.MCP_ALLOW_ALL_HOSTS === 'true';

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    config: {
      authenticationEnabled: !!process.env.MCP_AUTH_TOKEN,
      dnsRebindingProtection: !allowAllHosts,
      defaultRepoName: process.env.DEFAULT_REPO_NAME || null,
    },
  });
});

// Handle POST requests for client-to-server communication
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  try {
    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else {
      // Create new transport and MCP server
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          transports[sessionId] = transport;
        },
        enableDnsRebindingProtection: !allowAllHosts,
        allowedHosts: allowAllHosts ? undefined : ['127.0.0.1', 'localhost'],
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      // Create Claude Compass MCP server with session ID
      const server = new ClaudeCompassMCPServer(transport.sessionId);
      await server.start(transport);
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Handle GET requests for server-to-client notifications via SSE
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

// Handle DELETE requests for session termination
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

const PORT = parseInt(process.env.MCP_HTTP_PORT || '3000', 10);
const HOST = process.env.MCP_HTTP_HOST || 'localhost';
const AUTH_ENABLED = !!process.env.MCP_AUTH_TOKEN;
const DEFAULT_REPO = process.env.DEFAULT_REPO_NAME;

app.listen(PORT, HOST, () => {
  logger.info(`Claude Compass HTTP MCP Server listening on ${HOST}:${PORT}`, {
    allowAllHosts,
    dnsRebindingProtection: !allowAllHosts,
    authenticationEnabled: AUTH_ENABLED,
    defaultRepoName: DEFAULT_REPO,
  });
  console.log(`🚀 Claude Compass HTTP MCP Server running on http://${HOST}:${PORT}`);
  console.log(`   GET  /health - Health check endpoint`);
  console.log(`   POST /mcp    - Client requests`);
  console.log(`   GET  /mcp    - SSE notifications`);
  console.log(`   DELETE /mcp  - Session termination`);
  console.log();

  if (DEFAULT_REPO) {
    console.log(`   📁 Default repository: ${DEFAULT_REPO}`);
  }

  if (AUTH_ENABLED) {
    console.log(`   🔐 Authentication: ENABLED (Bearer token required)`);
  } else {
    console.log(`   ⚠️  Authentication: DISABLED (localhost only)`);
  }

  if (allowAllHosts) {
    console.log(`   ⚠️  DNS rebinding protection: DISABLED (all hosts allowed)`);
  } else {
    console.log(`   🔒 DNS rebinding protection: ENABLED (localhost only)`);
  }
});