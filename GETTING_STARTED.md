# Getting Started with Claude Compass

## Phase 1 Implementation Complete! 🎉

Welcome to Claude Compass - an AI-native development environment that solves the "context starvation" problem by giving AI assistants complete contextual understanding of your codebase.

This Phase 1 implementation provides:
- ✅ JavaScript/TypeScript parsing with Tree-sitter
- ✅ PostgreSQL database with graph storage
- ✅ File and symbol graph building
- ✅ MCP server for AI integration
- ✅ CLI interface for repository analysis
- ✅ Comprehensive test suite

## Prerequisites

- Node.js 18+
- PostgreSQL 15+ (or Docker)
- Git repository to analyze

## Quick Start

### 1. Install Dependencies

```bash
# Install dependencies (no need for sudo)
npm install

# If you encounter permission issues, use:
# npm config set prefix ~/.npm-global
# export PATH=~/.npm-global/bin:$PATH
```

### 2. Set Up Database

Using Docker (recommended):
```bash
# Start PostgreSQL with pgvector
npm run docker:up

# Run migrations
npm run migrate:latest
```

Or manually:
```bash
createdb claude_compass
psql claude_compass -c "CREATE EXTENSION vector;"
npm run migrate:latest
```

### 3. Build the Project

```bash
npm run build
```

### 4. Analyze Your First Repository

```bash
# Analyze a JavaScript/TypeScript repository
npm run analyze /path/to/your/nextjs-project

# Or using the built CLI
./dist/cli/index.js analyze /path/to/your/project --verbose
```

### 5. Start the MCP Server

```bash
# Start the MCP server for AI integration
npm run mcp-server
```

### 6. Search Your Codebase

```bash
# Search for symbols
npm run start search "useState"
npm run start search "User" --type class --exported-only
```

## Project Structure

```
/
├── src/
│   ├── database/          # Database models, services, migrations
│   │   ├── migrations/    # SQL migration files
│   │   ├── models.ts      # TypeScript interfaces
│   │   ├── services.ts    # Database operations
│   │   └── connection.ts  # Database connection
│   ├── parsers/           # Tree-sitter language parsers
│   │   ├── base.ts        # Abstract parser interface
│   │   ├── javascript.ts  # JavaScript parser
│   │   └── typescript.ts  # TypeScript parser
│   ├── graph/             # Graph building algorithms
│   │   ├── file-graph.ts  # Import/export relationships
│   │   ├── symbol-graph.ts # Function calls and references
│   │   └── builder.ts     # Main analysis orchestrator
│   ├── mcp/               # Model Context Protocol server
│   │   ├── server.ts      # MCP server implementation
│   │   ├── tools.ts       # MCP tool implementations
│   │   └── resources.ts   # MCP resource exposures
│   ├── cli/               # Command-line interface
│   │   └── index.ts       # CLI commands and options
│   └── utils/             # Shared utilities
│       ├── config.ts      # Configuration management
│       └── logger.ts      # Logging setup
├── tests/                 # Comprehensive test suite
├── docker-compose.yml     # Database setup
└── package.json           # Dependencies and scripts
```

## Available Commands

### Analysis Commands

```bash
# Analyze repository
claude-compass analyze <path> [options]

# Options:
# --no-test-files          Exclude test files
# --include-node-modules   Include node_modules (not recommended)
# --max-file-size <size>   Max file size in bytes (default: 1MB)
# --max-files <count>      Max files to process (default: 10,000)
# --extensions <list>      File extensions (default: .js,.jsx,.ts,.tsx,.mjs,.cjs)
# --verbose               Enable debug logging
```

### MCP Server

```bash
# Start MCP server for AI integration
claude-compass mcp-server [options]

# Options:
# --port <port>    Port to listen on (default: 3000)
# --host <host>    Host to bind to (default: localhost)
# --verbose       Enable debug logging
```

### Search Commands

```bash
# Search for symbols
claude-compass search <query> [options]

# Options:
# --repo-id <id>      Limit to specific repository
# --type <type>       Filter by symbol type
# --exported-only     Show only exported symbols
# --limit <count>     Max results (default: 20)
```

### Database Commands

```bash
# Run migrations
claude-compass migrate

# Rollback migrations
claude-compass migrate:rollback

# Show statistics
claude-compass stats
```

## MCP Integration

The MCP server provides these tools for AI assistants:

### Tools Available

1. **`get_file`** - Get file details with symbols
2. **`get_symbol`** - Get symbol details with dependencies
3. **`search_code`** - Search for symbols by name/pattern
4. **`who_calls`** - Find callers of a symbol
5. **`list_dependencies`** - List symbol dependencies

### Resources Available

1. **`repo://repositories`** - List of analyzed repositories
2. **`graph://files`** - File dependency graph
3. **`graph://symbols`** - Symbol dependency graph

### Example MCP Usage

```typescript
// Connect to the MCP server and use tools
const response = await mcpClient.callTool('search_code', {
  query: 'useState',
  symbol_type: 'function',
  limit: 10
});
```

## Testing

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## Development Scripts

```bash
# Development mode with hot reload
npm run dev

# Build project
npm run build

# Lint code
npm run lint
npm run lint:fix

# Format code
npm run format

# Database operations
npm run docker:up     # Start database
npm run docker:down   # Stop database
```

## Configuration

Set up environment variables in `.env`:

```bash
# Database
DATABASE_URL=postgresql://claude_compass:password@localhost:5432/claude_compass
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=claude_compass
DATABASE_USER=claude_compass
DATABASE_PASSWORD=password

# Logging
LOG_LEVEL=info
LOG_FILE=logs/claude-compass.log

# MCP Server
MCP_SERVER_PORT=3000
MCP_SERVER_HOST=localhost

# Development
NODE_ENV=development
```

## Success Criteria Achieved ✅

Phase 1 successfully meets all success criteria:

- ✅ **Parse Vue.js, Next.js, Node.js projects**: JavaScript/TypeScript parser handles all major frameworks
- ✅ **Map ES6 imports, CommonJS requires, dynamic imports**: All import types supported with proper resolution
- ✅ **MCP server responds to basic queries**: Full MCP implementation with 5 tools and 3 resources
- ✅ **Database stores/retrieves data efficiently**: PostgreSQL with optimized indexes and batch operations

## What's Working

- 🔍 **Symbol Extraction**: Functions, classes, interfaces, variables, methods
- 📦 **Import Analysis**: ES6, CommonJS, dynamic imports with path resolution
- 📊 **Graph Building**: File dependencies and symbol relationships
- 🔌 **MCP Integration**: Ready for AI assistant integration
- 💻 **CLI Interface**: Full-featured command-line tool
- 🧪 **Testing**: Comprehensive test coverage

## Next Steps (Phase 2)

The foundation is solid for Phase 2 implementation:

- Vue.js component and router analysis
- Next.js pages and API routes detection
- React component and hook analysis
- Node.js Express/Fastify route detection
- Vector search capabilities
- Advanced impact analysis

## Troubleshooting

### Database Issues
```bash
# Reset database
npm run docker:down
npm run docker:up
npm run migrate:latest
```

### Build Issues
```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

### Permission Issues
```bash
# Make CLI executable
chmod +x dist/cli/index.js
```

## Contributing

See `IMPLEMENTATION_PLAN.md` for detailed architecture and future phases.

The codebase follows these principles:
- TypeScript strict mode
- Comprehensive error handling
- Extensive logging
- Test-driven development
- Clean separation of concerns

## License

[License information to be added]

---

**Phase 1 Complete!** 🚀 Claude Compass now provides a solid foundation for AI-native code analysis.