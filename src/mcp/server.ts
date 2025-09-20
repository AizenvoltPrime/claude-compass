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
import { McpTools } from './tools';
import { McpResources } from './resources';

const logger = createComponentLogger('mcp-server');

export class ClaudeCompassMCPServer {
  private server: Server;
  private dbService: DatabaseService;
  private tools: McpTools;
  private resources: McpResources;
  private sessionId?: string;

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

  private formatErrorResponse(code: number, message: string, data?: any) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: {
            code,
            message,
            data
          }
        }, null, 2)
      }]
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
      logger.debug('Received list_tools request');

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
                include_symbols: {
                  type: 'boolean',
                  description: 'Whether to include symbols defined in this file',
                  default: true,
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
                include_dependencies: {
                  type: 'boolean',
                  description: 'Whether to include symbol dependencies',
                  default: true,
                },
                include_callers: {
                  type: 'boolean',
                  description: 'Whether to include symbols that call this symbol',
                  default: false,
                },
              },
              required: ['symbol_id'],
            },
          },
          {
            name: 'search_code',
            description: 'Search for code symbols by name or pattern',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query (symbol name or pattern)',
                },
                repo_id: {
                  type: 'number',
                  description: 'Limit search to specific repository',
                },
                symbol_type: {
                  type: 'string',
                  enum: ['function', 'class', 'interface', 'variable', 'constant', 'type_alias', 'enum', 'method', 'property'],
                  description: 'Filter by symbol type',
                },
                is_exported: {
                  type: 'boolean',
                  description: 'Filter by exported symbols only',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  default: 50,
                  minimum: 1,
                  maximum: 200,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'who_calls',
            description: 'Find all symbols that call or reference a specific symbol',
            inputSchema: {
              type: 'object',
              properties: {
                symbol_id: {
                  type: 'number',
                  description: 'The ID of the symbol to find callers for',
                },
                dependency_type: {
                  type: 'string',
                  enum: ['calls', 'imports', 'inherits', 'implements', 'references', 'exports', 'api_call', 'shares_schema', 'frontend_backend'],
                  description: 'Type of dependency relationship to find',
                  default: 'calls',
                },
                include_indirect: {
                  type: 'boolean',
                  description: 'Include indirect callers (transitive dependencies)',
                  default: false,
                },
                include_cross_stack: {
                  type: 'boolean',
                  description: 'Include cross-stack callers (Vue ↔ Laravel)',
                  default: false,
                },
                cross_stack_confidence_threshold: {
                  type: 'number',
                  description: 'Confidence threshold for cross-stack relationships (0.0-1.0)',
                  default: 0.7,
                  minimum: 0,
                  maximum: 1,
                },
              },
              required: ['symbol_id'],
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
                  enum: ['calls', 'imports', 'inherits', 'implements', 'references', 'exports', 'api_call', 'shares_schema', 'frontend_backend'],
                  description: 'Type of dependency relationship to list',
                },
                include_indirect: {
                  type: 'boolean',
                  description: 'Include indirect dependencies (transitive)',
                  default: false,
                },
                include_cross_stack: {
                  type: 'boolean',
                  description: 'Include cross-stack dependencies (Vue ↔ Laravel)',
                  default: false,
                },
              },
              required: ['symbol_id'],
            },
          },
          {
            name: 'get_api_calls',
            description: 'Find API calls from Vue components to Laravel endpoints',
            inputSchema: {
              type: 'object',
              properties: {
                component_id: {
                  type: 'number',
                  description: 'The ID of the Vue component symbol to find API calls for',
                },
                include_response_schemas: {
                  type: 'boolean',
                  description: 'Whether to include full response schema information',
                  default: false,
                },
                repository_id: {
                  type: 'number',
                  description: 'Limit search to specific repository',
                },
              },
              required: ['component_id'],
            },
          },
          {
            name: 'get_data_contracts',
            description: 'List shared data structures between TypeScript and PHP',
            inputSchema: {
              type: 'object',
              properties: {
                schema_name: {
                  type: 'string',
                  description: 'The name of the data schema/interface to analyze',
                },
                repository_id: {
                  type: 'number',
                  description: 'Limit search to specific repository',
                },
                include_drift_analysis: {
                  type: 'boolean',
                  description: 'Whether to include schema drift analysis between frontend and backend',
                  default: false,
                },
              },
              required: ['schema_name'],
            },
          },
          {
            name: 'get_cross_stack_impact',
            description: 'Calculate blast radius across Vue ↔ Laravel boundaries',
            inputSchema: {
              type: 'object',
              properties: {
                symbol_id: {
                  type: 'number',
                  description: 'The ID of the symbol to analyze cross-stack impact for',
                },
                include_transitive: {
                  type: 'boolean',
                  description: 'Include transitive cross-stack impact analysis',
                  default: false,
                },
                max_depth: {
                  type: 'number',
                  description: 'Maximum depth for transitive analysis',
                  default: 10,
                  minimum: 1,
                  maximum: 20,
                },
              },
              required: ['symbol_id'],
            },
          },
          {
            name: 'get_laravel_routes',
            description: 'Get Laravel routes with filtering options',
            inputSchema: {
              type: 'object',
              properties: {
                repo_id: {
                  type: 'number',
                  description: 'Limit search to specific repository',
                },
                path: {
                  type: 'string',
                  description: 'Filter routes by path pattern',
                },
                method: {
                  type: 'string',
                  description: 'Filter routes by HTTP method (GET, POST, PUT, DELETE, etc.)',
                },
                middleware: {
                  type: 'string',
                  description: 'Filter routes by middleware name',
                },
                controller: {
                  type: 'string',
                  description: 'Filter routes by controller name',
                },
              },
              additionalProperties: false,
            },
          },
          {
            name: 'get_eloquent_models',
            description: 'Get Laravel Eloquent models with relationships',
            inputSchema: {
              type: 'object',
              properties: {
                repo_id: {
                  type: 'number',
                  description: 'Limit search to specific repository',
                },
                model_name: {
                  type: 'string',
                  description: 'Filter models by name pattern',
                },
                table_name: {
                  type: 'string',
                  description: 'Filter models by table name',
                },
                relationships: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                  description: 'Filter models by relationship types (hasMany, belongsTo, etc.)',
                },
              },
              additionalProperties: false,
            },
          },
          {
            name: 'get_laravel_controllers',
            description: 'Get Laravel controllers with actions and middleware',
            inputSchema: {
              type: 'object',
              properties: {
                repo_id: {
                  type: 'number',
                  description: 'Limit search to specific repository',
                },
                controller_name: {
                  type: 'string',
                  description: 'Filter controllers by name pattern',
                },
                action: {
                  type: 'string',
                  description: 'Filter controllers by action name',
                },
                middleware: {
                  type: 'string',
                  description: 'Filter controllers by middleware name',
                },
              },
              additionalProperties: false,
            },
          },
          {
            name: 'search_laravel_entities',
            description: 'Search across all Laravel entities (routes, models, controllers, etc.)',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query to match against entity names and properties',
                },
                repo_id: {
                  type: 'number',
                  description: 'Limit search to specific repository',
                },
                entity_types: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['route', 'model', 'controller', 'middleware', 'job', 'service_provider', 'command'],
                  },
                  description: 'Filter by specific Laravel entity types',
                },
                metadata_filter: {
                  type: 'object',
                  description: 'Additional metadata filters as key-value pairs',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  default: 50,
                  minimum: 1,
                  maximum: 200,
                },
              },
              required: ['query'],
              additionalProperties: false,
            },
          },
        ],
      };
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      logger.debug('Received list_resources request');

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

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      logger.debug('Received tool call', { name, args });

      try {
        switch (name) {
          case 'get_file':
            return await this.tools.getFile(args);

          case 'get_symbol':
            return await this.tools.getSymbol(args);

          case 'search_code':
            return await this.tools.searchCode(args);

          case 'who_calls':
            return await this.tools.whoCalls(args);

          case 'list_dependencies':
            return await this.tools.listDependencies(args);

          case 'get_api_calls':
            return await this.tools.getApiCalls(args);

          case 'get_data_contracts':
            return await this.tools.getDataContracts(args);

          case 'get_cross_stack_impact':
            return await this.tools.getCrossStackImpact(args);

          case 'get_laravel_routes':
            return await this.tools.getLaravelRoutes(args);

          case 'get_eloquent_models':
            return await this.tools.getEloquentModels(args);

          case 'get_laravel_controllers':
            return await this.tools.getLaravelControllers(args);

          case 'search_laravel_entities':
            return await this.tools.searchLaravelEntities(args);

          default:
            return this.formatErrorResponse(-32601, `Unknown tool: ${name}`, request.params);
        }
      } catch (error) {
        logger.error('Tool call failed', { name, error: (error as Error).message });

        // Return properly formatted error response instead of throwing
        const errorCode = this.getErrorCode(error as Error);
        return this.formatErrorResponse(errorCode, (error as Error).message, request.params);
      }
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      logger.debug('Received read_resource request', { uri });

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

    // Default to stdio transport if none provided
    // For future HTTP support, pass StreamableHTTPServerTransport or SSEServerTransport
    const serverTransport = transport || new StdioServerTransport();
    await this.server.connect(serverTransport);

    logger.info('MCP Server started and listening', {
      transportType: transport ? 'custom' : 'stdio',
      sessionId: this.sessionId
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

  server.start().catch((error) => {
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