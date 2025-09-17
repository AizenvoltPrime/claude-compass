# Getting Started with Claude Compass

## Phase 2 Implementation Complete! 🎉

Welcome to Claude Compass - an AI-native development environment that solves the "context starvation" problem by giving AI assistants complete contextual understanding of your codebase.

This Phase 2 implementation provides:
- ✅ JavaScript/TypeScript parsing with Tree-sitter
- ✅ Framework-aware parsing for Vue.js, Next.js, React, and Node.js
- ✅ Chunked parsing for large files with size validation
- ✅ Encoding detection and recovery for problematic files
- ✅ Bundle file filtering and CompassIgnore support
- ✅ PostgreSQL database with graph storage and framework entities
- ✅ File, symbol, and framework entity graph building
- ✅ MCP server for AI integration
- ✅ CLI interface for repository analysis and management
- ✅ Comprehensive test suite with 100% framework parser coverage

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
npx tsc
```

### 4. Analyze Your First Repository

```bash
# Analyze a JavaScript/TypeScript repository
npm run analyze /path/to/your/nextjs-project

# Or using the built CLI
./dist/src/cli/index.js analyze /path/to/your/project --verbose
```

### 5. Clear Previous Analysis (Optional)

```bash
# Clear existing repository analysis
./dist/src/cli/index.js clear <repository-name> --yes

# Or clear all repositories
./dist/src/cli/index.js clear --all --yes
```

### 6. Test Framework Parsing

```bash
# Run framework parser tests
npm test tests/parsers/

# Test specific framework parser
npm test tests/parsers/react.test.ts
npm test tests/parsers/nextjs.test.ts
npm test tests/parsers/vue.test.ts
npm test tests/parsers/nodejs.test.ts
```

### 7. Start the MCP Server

```bash
# Start the MCP server for AI integration
npm run mcp-server
```

### 8. Search Your Codebase

```bash
# Search for symbols
npm run start search "useState"
npm run start search "User" --type class --exported-only

# Search for framework-specific entities
./dist/src/cli/index.js search "router" --type route
./dist/src/cli/index.js search "useEffect" --type hook
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
│   ├── parsers/           # Tree-sitter language and framework parsers
│   │   ├── base.ts        # Abstract parser interface
│   │   ├── base-framework.ts # Framework parser base class
│   │   ├── framework-detector.ts # Framework detection logic
│   │   ├── multi-parser.ts # Multi-parser coordination
│   │   ├── javascript.ts  # JavaScript parser
│   │   ├── typescript.ts  # TypeScript parser
│   │   ├── vue.ts         # Vue.js framework parser
│   │   ├── nextjs.ts      # Next.js framework parser
│   │   ├── react.ts       # React framework parser
│   │   └── nodejs.ts      # Node.js framework parser
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
# --frameworks <list>      Specific frameworks to analyze (vue,nextjs,react,nodejs)
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
# --type <type>       Filter by symbol type (function, class, route, component, hook)
# --exported-only     Show only exported symbols
# --framework <name>  Filter by framework (vue, nextjs, react, nodejs)
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

# Clear repository analysis
claude-compass clear <repository-name> [--yes]

# Clear all repositories
claude-compass clear --all [--yes]
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

Phase 2 successfully meets all success criteria:

- ✅ **Framework-specific parsing**: Vue.js, Next.js, React, and Node.js components, routes, and hooks
- ✅ **Map HTTP routes to handlers**: Express/Fastify routes with middleware chains and controllers
- ✅ **Component dependency detection**: Vue/React component relationships and props extraction
- ✅ **Hooks/composables analysis**: Custom hooks, Vue composables, and React state management
- ✅ **Advanced route analysis**: Dynamic segments, auth patterns, validation, Swagger docs
- ✅ **MCP server responds to framework queries**: Enhanced search with framework-aware context
- ✅ **Database stores framework entities**: Complete schema for routes, components, composables

## What's Working

- 🔍 **Symbol Extraction**: Functions, classes, interfaces, variables, methods, components, hooks
- 📦 **Import Analysis**: ES6, CommonJS, dynamic imports with path resolution
- 🎯 **Framework Detection**: Evidence-based detection for Vue, Next.js, React, Node.js
- 🧩 **Component Analysis**: Props extraction, JSX dependencies, HOC detection
- 🚀 **Route Mapping**: Express/Fastify routes with middleware, auth, validation patterns
- 🎣 **Hook/Composable Parsing**: Custom hooks, Vue composables, state management
- 📊 **Graph Building**: File, symbol, and framework entity relationships
- 🔧 **Large File Processing**: Chunked parsing for files up to 20MB
- 🎯 **Smart Filtering**: Bundle files and generated content automatically filtered
- 🛠️ **Encoding Recovery**: Handles encoding issues and problematic files
- 🔌 **MCP Integration**: Framework-aware AI assistant integration
- 💻 **CLI Interface**: Full-featured command-line tool with repository management
- 🧪 **Testing**: Comprehensive test coverage with 100% framework parser pass rate

## Next Steps (Prioritized Roadmap)

The framework foundation is complete for focused implementation:

### Phase 3: Advanced Vue/TypeScript Graphs - **PRIORITY**
- Test-to-code linkage (Vitest, Jest, Cypress, Playwright) - **Critical for Vue/Vite testing**
- Enhanced Vue composables relationship mapping - **Essential for Vue.js**
- Package manager integration (npm, yarn, pnpm) - **Vite dependency tracking**
- Background job detection (Node.js worker threads, job queues)
- Enhanced `who_calls` and `list_dependencies` tools

### Phase 4: PHP/Laravel Support - **HIGH PRIORITY**
- Laravel route and controller detection
- Laravel Eloquent model relationship mapping - **Critical for backend**
- Laravel job queue and scheduler detection
- Laravel service provider and dependency injection analysis

### Phase 5: Vue ↔ Laravel Integration - **HIGH PRIORITY**
- Cross-stack dependency tracking (TypeScript interfaces ↔ PHP DTOs)
- Frontend API calls mapped to Laravel controller methods
- Full-stack impact analysis and blast radius calculation

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
npx tsc
```

### Permission Issues
```bash
# Make CLI executable
chmod +x dist/src/cli/index.js
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

**Phase 2 Complete!** 🚀 Claude Compass now provides comprehensive framework-aware analysis for JavaScript/TypeScript applications.