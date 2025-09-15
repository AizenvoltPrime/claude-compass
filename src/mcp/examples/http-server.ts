#!/usr/bin/env node
/**
 * Example HTTP MCP Server using Streamable HTTP transport
 *
 * This is a future-ready example showing how to run Claude Compass
 * with HTTP transport instead of stdio. Uncomment and install
 * additional dependencies when ready to use:
 *
 * npm install express
 * npm install @modelcontextprotocol/sdk
 */

/*
import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ClaudeCompassMCPServer } from '../server.js';
import { createComponentLogger } from '../../utils/logger.js';

const logger = createComponentLogger('http-mcp-server');
const app = express();
app.use(express.json());

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

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
        enableDnsRebindingProtection: true,
        allowedHosts: ['127.0.0.1', 'localhost'],
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

const PORT = process.env.MCP_HTTP_PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Claude Compass HTTP MCP Server listening on port ${PORT}`);
  console.log(`🚀 Claude Compass HTTP MCP Server running on http://localhost:${PORT}/mcp`);
});
*/

// For now, export a placeholder to prevent TypeScript errors
export const httpServerExample = 'This example requires additional HTTP dependencies';