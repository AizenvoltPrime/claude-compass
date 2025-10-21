#!/usr/bin/env node
import process from 'process';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { DatabaseService, databaseService } from '../database';
import { createComponentLogger } from '../utils/logger';
import {
  compressResponsePayload,
  optimizeResponsePayload,
  DEFAULT_COMPRESSION_CONFIG,
} from '../utils/response-compression';
import { McpTools } from './tools';
import { McpResources } from './resources';

const logger = createComponentLogger('mcp-server');

export class ClaudeCompassMCPServer {
  private server: Server;
  private dbService: DatabaseService;
  private tools: McpTools;
  private resources: McpResources;
  private sessionId?: string;
  private defaultRepoId?: number;

  constructor(sessionId?: string) {
    this.sessionId = sessionId;
    this.server = new Server(
      {
        name: 'claude-compass',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.dbService = databaseService;
    this.tools = new McpTools(this.dbService, this.sessionId);
    this.resources = new McpResources(this.dbService, this.sessionId);

    this.setupHandlers();
  }

  private async resolveDefaultRepository(): Promise<void> {
    const defaultRepoName = process.env.DEFAULT_REPO_NAME;

    if (!defaultRepoName || defaultRepoName.trim() === '') {
      return;
    }

    try {
      const repository = await this.dbService.getRepositoryByName(defaultRepoName);

      if (repository) {
        this.defaultRepoId = repository.id;
        this.tools.setDefaultRepoId(repository.id);
        logger.info('Default repository resolved', {
          name: defaultRepoName,
          id: repository.id,
        });
      } else {
        logger.warn('DEFAULT_REPO_NAME set but repository not found', {
          name: defaultRepoName,
        });
      }
    } catch (error) {
      logger.error('Failed to resolve default repository', {
        name: defaultRepoName,
        error: (error as Error).message,
      });
    }
  }

  private formatErrorResponse(code: number, message: string, data?: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: {
                code,
                message,
                data,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private getErrorCode(error: Error): number {
    const message = error.message.toLowerCase();

    // Map common errors to JSON-RPC error codes
    if (message.includes('not found')) {
      return -32602; // Invalid params (entity not found)
    }
    if (message.includes('required') || message.includes('must be')) {
      return -32602; // Invalid params
    }
    if (message.includes('database') || message.includes('connection')) {
      return -32603; // Internal error
    }

    return -32603; // Internal error (default)
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_file',
            description: 'Get details about a specific file including its metadata and symbols',
            inputSchema: {
              type: 'object',
              properties: {
                file_id: {
                  type: 'number',
                  description: 'The ID of the file to retrieve',
                },
                file_path: {
                  type: 'string',
                  description: 'The path of the file to retrieve (alternative to file_id)',
                },
              },
              additionalProperties: false,
            },
          },
          {
            name: 'get_symbol',
            description: 'Get details about a specific symbol including its dependencies',
            inputSchema: {
              type: 'object',
              properties: {
                symbol_id: {
                  type: 'number',
                  description: 'The ID of the symbol to retrieve',
                },
              },
              required: ['symbol_id'],
              additionalProperties: false,
            },
          },
          {
            name: 'search_code',
            description:
              'Enhanced search for code symbols with framework awareness - absorbs get_laravel_routes, get_eloquent_models, get_laravel_controllers, and search_laravel_entities functionality',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query (symbol name or pattern)',
                },
                entity_types: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: [
                      'route',
                      'model',
                      'controller',
                      'component',
                      'job',
                      'function',
                      'class',
                      'interface',
                      'scene',
                      'node',
                      'script',
                      'autoload',
                    ],
                  },
                  description:
                    'Framework-aware entity types (replaces Laravel-specific tools)',
                },
                framework: {
                  type: 'string',
                  enum: ['laravel', 'vue', 'react', 'node', 'godot'],
                  description: 'Filter by framework type',
                },
                is_exported: {
                  type: 'boolean',
                  description: 'Filter by exported symbols only',
                },
                search_mode: {
                  type: 'string',
                  enum: ['auto', 'exact', 'vector', 'qualified'],
                  description:
                    'Search mode: auto (hybrid), exact (lexical), vector (embedding-based), qualified (namespace-aware)',
                  default: 'auto',
                },
              },
              required: ['query'],
              additionalProperties: false,
            },
          },
          {
            name: 'who_calls',
            description: 'Find all symbols that call or reference a specific symbol. Includes parameter analysis showing different usage patterns and insights when parameter context is available. Provides transitive analysis metadata when max_depth > 1.',
            inputSchema: {
              type: 'object',
              properties: {
                symbol_id: {
                  type: 'number',
                  description: 'The ID of the symbol to find callers for',
                },
                dependency_type: {
                  type: 'string',
                  enum: [
                    'calls',
                    'imports',
                    'inherits',
                    'implements',
                    'references',
                    'exports',
                    'api_call',
                    'shares_schema',
                    'frontend_backend',
                  ],
                  description: 'Type of dependency relationship to find',
                  default: 'calls',
                },
                include_cross_stack: {
                  type: 'boolean',
                  description: 'Include cross-stack callers (Vue ↔ Laravel)',
                  default: false,
                },
                max_depth: {
                  type: 'number',
                  description: 'Transitive analysis depth (default: 1, min: 1, max: 20)',
                  default: 1,
                  minimum: 1,
                  maximum: 20,
                },
              },
              required: ['symbol_id'],
              additionalProperties: false,
            },
          },
          {
            name: 'list_dependencies',
            description: 'List all dependencies of a specific symbol',
            inputSchema: {
              type: 'object',
              properties: {
                symbol_id: {
                  type: 'number',
                  description: 'The ID of the symbol to list dependencies for',
                },
                dependency_type: {
                  type: 'string',
                  enum: [
                    'calls',
                    'imports',
                    'inherits',
                    'implements',
                    'references',
                    'exports',
                    'api_call',
                    'shares_schema',
                    'frontend_backend',
                  ],
                  description: 'Type of dependency relationship to list',
                },
                include_cross_stack: {
                  type: 'boolean',
                  description: 'Include cross-stack dependencies (Vue ↔ Laravel)',
                  default: false,
                },
                max_depth: {
                  type: 'number',
                  description: 'Transitive analysis depth (default: 1, min: 1, max: 20)',
                  default: 1,
                  minimum: 1,
                  maximum: 20,
                },
              },
              required: ['symbol_id'],
              additionalProperties: false,
            },
          },
          {
            name: 'impact_of',
            description:
              'Comprehensive impact analysis - calculate blast radius across all frameworks including routes, jobs, and tests. Returns categorized results with separate arrays for direct impact, indirect impact, routes, jobs, and tests.',
            inputSchema: {
              type: 'object',
              properties: {
                symbol_id: {
                  type: 'number',
                  description: 'The ID of the symbol to analyze impact for',
                },
                frameworks: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['vue', 'laravel', 'react', 'node', 'godot'],
                  },
                  description: 'Multi-framework impact analysis (default: all detected frameworks)',
                },
                max_depth: {
                  type: 'number',
                  description: 'Transitive analysis depth (default: 5)',
                  default: 5,
                  minimum: 1,
                  maximum: 20,
                },
              },
              required: ['symbol_id'],
              additionalProperties: false,
            },
          },
          {
            name: 'trace_flow',
            description:
              'Find execution paths between two symbols. Can find shortest path or all paths up to max_depth. Useful for understanding how code flows from point A to B.',
            inputSchema: {
              type: 'object',
              properties: {
                start_symbol_id: {
                  type: 'number',
                  description: 'Starting symbol ID',
                },
                end_symbol_id: {
                  type: 'number',
                  description: 'Ending symbol ID',
                },
                find_all_paths: {
                  type: 'boolean',
                  description: 'If true, finds all paths; if false, finds shortest path',
                  default: false,
                },
                max_depth: {
                  type: 'number',
                  description: 'Maximum path depth to search',
                  default: 10,
                  minimum: 1,
                  maximum: 20,
                },
              },
              required: ['start_symbol_id', 'end_symbol_id'],
              additionalProperties: false,
            },
          },
          {
            name: 'discover_feature',
            description:
              'Discover complete feature modules across the entire stack. Finds all related code for a feature by combining dependency analysis, naming heuristics, and cross-stack API tracing. Discovers semantic features that span frontend and backend with improved filtering, relevance scoring, and test exclusion.',
            inputSchema: {
              type: 'object',
              properties: {
                symbol_id: {
                  type: 'number',
                  description: 'Symbol ID to start feature discovery from (e.g., a controller method, store function, or service)',
                },
                include_components: {
                  type: 'boolean',
                  description: 'Include Vue/React components in the feature manifest',
                  default: true,
                },
                include_routes: {
                  type: 'boolean',
                  description: 'Include API routes in the feature manifest',
                  default: true,
                },
                include_models: {
                  type: 'boolean',
                  description: 'Include database models in the feature manifest',
                  default: true,
                },
                include_tests: {
                  type: 'boolean',
                  description: 'Include test files and test symbols (default: false to filter out test noise)',
                  default: false,
                },
                include_callers: {
                  type: 'boolean',
                  description: 'Include reverse dependencies (symbols that call/import the discovered symbols). Enables bidirectional discovery for symmetric results regardless of entry point (default: true)',
                  default: true,
                },
                naming_depth: {
                  type: 'number',
                  description: 'How aggressively to match related symbols by name (1=conservative, 2=moderate, 3=aggressive)',
                  default: 2,
                  minimum: 1,
                  maximum: 3,
                },
                max_depth: {
                  type: 'number',
                  description: 'Maximum depth for dependency graph traversal (lower = more focused results)',
                  default: 3,
                  minimum: 1,
                  maximum: 20,
                },
                max_symbols: {
                  type: 'number',
                  description: 'Maximum number of symbols to return (prevents overwhelming responses)',
                  default: 500,
                  minimum: 10,
                  maximum: 5000,
                },
                min_relevance_score: {
                  type: 'number',
                  description: 'Minimum relevance score (0.0-1.0) for including symbols, based on dependency distance',
                  default: 0,
                  minimum: 0,
                  maximum: 1,
                },
                semantic_filtering_enabled: {
                  type: 'boolean',
                  description: 'Enable semantic filtering using embedding similarity with strategy-based thresholds (0.60-0.75 optimized per discovery method)',
                  default: true,
                },
              },
              required: ['symbol_id'],
              additionalProperties: false,
            },
          },
          {
            name: 'detect_dead_code',
            description: 'Systematically detect dead code, interface bloat, and unused symbols in a codebase. Identifies interface methods implemented but never called, dead public/private methods, unused functions, dead classes, and unused exports. Excludes false positives like entry points, framework callbacks, test methods, and polymorphic methods. Results grouped by file path → category → confidence (high/medium/low).',
            inputSchema: {
              type: 'object',
              properties: {
                confidence_threshold: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                  description: 'Minimum confidence level to include in results (default: medium)',
                },
                include_exports: {
                  type: 'boolean',
                  description: 'Include exported symbols in results (default: false - excludes exports)',
                },
                include_tests: {
                  type: 'boolean',
                  description: 'Include test files in analysis (default: false)',
                },
                max_results: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 200)',
                },
                file_pattern: {
                  type: 'string',
                  description: 'Glob pattern to filter files (e.g., "src/**/*.cs")',
                },
              },
              required: [],
              additionalProperties: false,
            },
          },
        ],
      };
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'repo://repositories',
            name: 'Repositories',
            description: 'List of all analyzed repositories',
            mimeType: 'application/json',
          },
        ],
      };
    });

    // Handle tool calls with response optimization
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args } = request.params;

      try {
        let response: any;

        switch (name) {
          case 'get_file':
            response = await this.tools.getFile(args);
            break;

          case 'get_symbol':
            response = await this.tools.getSymbol(args);
            break;

          case 'search_code':
            response = await this.tools.searchCode(args);
            break;

          case 'who_calls':
            response = await this.tools.whoCalls(args);
            break;

          case 'list_dependencies':
            response = await this.tools.listDependencies(args);
            break;

          case 'impact_of':
            response = await this.tools.impactOf(args);
            break;

          case 'trace_flow':
            response = await this.tools.traceFlow(args);
            break;

          case 'discover_feature':
            response = await this.tools.discoverFeature(args);
            break;

          case 'detect_dead_code':
            response = await this.tools.detectDeadCode(args);
            break;

          default:
            return this.formatErrorResponse(-32601, `Unknown tool: ${name}`, request.params);
        }

        // Apply performance optimizations
        response = optimizeResponsePayload(response);

        // Apply compression if payload is large enough
        const compressionEnabled = false;
        if (compressionEnabled) {
          response = await compressResponsePayload(response, DEFAULT_COMPRESSION_CONFIG);
        }

        return response;
      } catch (error) {
        logger.error('Tool call failed', { name, error: (error as Error).message });

        // Return properly formatted error response instead of throwing
        const errorCode = this.getErrorCode(error as Error);
        return this.formatErrorResponse(errorCode, (error as Error).message, request.params);
      }
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async request => {
      const { uri } = request.params;

      try {
        return await this.resources.readResource(uri);
      } catch (error) {
        logger.error('Resource read failed', { uri, error: (error as Error).message });

        // Return properly formatted error response instead of throwing
        const errorCode = this.getErrorCode(error as Error);
        return this.formatErrorResponse(errorCode, (error as Error).message, { uri });
      }
    });
  }

  async start(transport?: any): Promise<void> {
    logger.info('Starting Claude Compass MCP Server', { sessionId: this.sessionId });

    await this.resolveDefaultRepository();

    // Default to stdio transport if none provided
    // For future HTTP support, pass StreamableHTTPServerTransport or SSEServerTransport
    const serverTransport = transport || new StdioServerTransport();
    await this.server.connect(serverTransport);

    logger.info('MCP Server started and listening', {
      transportType: transport ? 'custom' : 'stdio',
      sessionId: this.sessionId,
      defaultRepoId: this.defaultRepoId,
    });
  }

  async close(): Promise<void> {
    logger.info('Closing MCP Server');
    try {
      // Close database connections
      await this.dbService.close();
      logger.info('Database connections closed');
    } catch (error) {
      logger.error('Error closing database connections', { error: (error as Error).message });
    }
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  const server = new ClaudeCompassMCPServer();

  server.start().catch(error => {
    logger.error('Failed to start MCP server', { error: error.message });
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully');
    try {
      await server.close();
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: (error as Error).message });
      process.exit(1);
    }
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    try {
      await server.close();
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: (error as Error).message });
      process.exit(1);
    }
  });
}

// Export alias for backward compatibility
export { ClaudeCompassMCPServer as MCPServer };
