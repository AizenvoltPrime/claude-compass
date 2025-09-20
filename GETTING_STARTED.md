# Getting Started with Claude Compass

Welcome to Claude Compass - an AI-native development environment that solves the "context starvation" problem by giving AI assistants complete contextual understanding of your codebase.

Claude Compass provides:
- ✅ JavaScript/TypeScript parsing with Tree-sitter
- ✅ PHP parsing with Tree-sitter and advanced chunked parsing
- ✅ C# parsing with Tree-sitter for game development
- ✅ Framework-aware parsing for Vue.js, Next.js, React, Node.js, Laravel, and Godot
- ✅ Laravel route and controller detection (web.php, api.php, controllers)
- ✅ Laravel Eloquent model relationship mapping
- ✅ Laravel job queue and scheduler detection
- ✅ Laravel service provider and dependency injection analysis
- ✅ Godot scene file parsing (.tscn) with node hierarchy and script analysis
- ✅ C# script parsing with Godot-specific patterns and autoload detection
- ✅ Background job parsing (Bull, BullMQ, Agenda, Bee, Kue, Worker Threads)
- ✅ Test framework parsing (Jest, Vitest, Cypress, Playwright)
- ✅ ORM relationship parsing (Prisma, TypeORM, Sequelize, Mongoose)
- ✅ Package manager parsing (npm, yarn, pnpm, monorepo support)
- ✅ Enhanced transitive analysis with cycle detection and confidence scoring
- ✅ Chunked parsing for large files with size validation
- ✅ Encoding detection and recovery for problematic files
- ✅ Bundle file filtering and CompassIgnore support
- ✅ PostgreSQL database with graph storage and framework entities
- ✅ File, symbol, and framework entity graph building
- ✅ Enhanced MCP server with indirect analysis support
- ✅ Vue ↔ Laravel cross-stack integration with API mapping and dependency tracking
- ✅ Full-stack impact analysis and blast radius calculation
- ✅ Cross-stack MCP tools (getApiCalls, getDataContracts, getCrossStackImpact)
- ✅ Tool consolidation from 12 overlapping tools to 6 focused core tools
- ✅ Enhanced search with hybrid vector+lexical capabilities and framework awareness
- ✅ Comprehensive impact analysis tool replacing 6 specialized tools
- ✅ Database infrastructure for vector search (pgvector, embeddings, full-text search)
- ✅ CLI interface for repository analysis and management
- ✅ Comprehensive test suite with 95%+ coverage including edge cases

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
# Analyze current directory (supports both relative and absolute paths)
npm run analyze .

# Analyze a JavaScript/TypeScript repository
npm run analyze /path/to/your/nextjs-project

# Analyze a Laravel/PHP repository
npm run analyze /path/to/your/laravel-project

# Analyze a Godot/C# game project
npm run analyze /path/to/your/godot-project

# Force full analysis (clears existing data and re-analyzes)
npm run analyze . --force-full

# Or using the built CLI with options
./dist/src/cli/index.js analyze . --verbose          # Verbose logging
./dist/src/cli/index.js analyze . --no-test-files    # Exclude test files
```

### 5. Clear Previous Analysis (Optional)

```bash
# Clear existing repository analysis
./dist/src/cli/index.js clear <repository-name> --yes

# Or clear all repositories
./dist/src/cli/index.js clear all --yes

# Note: --force-full option automatically clears existing data
npm run analyze . --force-full    # This clears and re-analyzes automatically
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
npm test tests/parsers/php.test.ts
npm test tests/parsers/laravel.test.ts
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
# Analyze repository (supports both relative and absolute paths)
claude-compass analyze <path> [options]

# Examples:
npm run analyze .                    # Analyze current directory
npm run analyze /path/to/project     # Analyze absolute path
npm run analyze . --force-full       # Force full analysis (clears existing data)

# Options:
# --no-test-files          Exclude test files
# --include-node-modules   Include node_modules (not recommended)
# --max-file-size <size>   Max file size in bytes (default: 20MB)
# --max-files <count>      Max files to process (default: 10,000)
# --extensions <list>      File extensions (default: .js,.jsx,.ts,.tsx,.mjs,.cjs,.vue,.php,.cs,.tscn)
# --force-full            Force full analysis instead of incremental (clears existing data)
# --cross-stack           Enable cross-stack analysis for Vue ↔ Laravel projects
# --vue-laravel           Specifically analyze Vue.js and Laravel cross-stack relationships
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
# --type <type>       Filter by symbol type (function, class, route, component, hook, scene, script)
# --exported-only     Show only exported symbols
# --framework <name>  Filter by framework (vue, nextjs, react, nodejs, laravel, godot)
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

### MCP Tools Available

**6 Focused Core Tools:**
1. **`get_file`** - Get file details with symbols
2. **`get_symbol`** - Get symbol details with dependencies
3. **`search_code`** - **Enhanced hybrid vector+lexical search** with framework awareness (replaces 4 specialized search tools)
4. **`who_calls`** - Find callers of a symbol with cross-stack and transitive analysis
5. **`list_dependencies`** - List symbol dependencies with cross-stack and transitive analysis
6. **`impact_of`** - **Comprehensive blast radius tool** (replaces get_cross_stack_impact, get_api_calls, get_data_contracts)

### Resources Available

1. **`repo://repositories`** - List of analyzed repositories

### Example MCP Usage

```typescript
// Enhanced hybrid search with framework awareness
const searchResponse = await mcpClient.callTool('search_code', {
  query: 'user authentication',
  entity_types: ['route', 'model', 'controller', 'component'],
  framework: 'laravel',
  use_vector: true,
  limit: 10
});

// Comprehensive blast radius analysis
const impactResponse = await mcpClient.callTool('impact_of', {
  symbol_id: 123,
  frameworks: ['vue', 'laravel'],
  include_routes: true,
  include_jobs: true,
  include_tests: true,
  confidence_threshold: 0.7,
  max_depth: 5
});

// Cross-stack dependency analysis
const callersResponse = await mcpClient.callTool('who_calls', {
  symbol_id: 456,
  include_indirect: true,
  dependency_type: 'calls'
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

## Features ✅

Claude Compass includes:

- ✅ **Framework-specific parsing**: Vue.js, Next.js, React, Node.js, Laravel, and Godot components, routes, scenes, and hooks
- ✅ **PHP/Laravel support**: Laravel routes, controllers, Eloquent models, job queues, service providers, middleware
- ✅ **C#/Godot support**: Godot scene parsing (.tscn), C# script analysis, node hierarchy, autoload detection, signal extraction
- ✅ **Background job detection**: Bull, BullMQ, Agenda, Bee, Kue, Worker Threads with configuration analysis
- ✅ **Test-to-code linkage**: Jest, Vitest, Cypress, Playwright with coverage analysis and confidence scoring
- ✅ **ORM relationship mapping**: Prisma, TypeORM, Sequelize, Mongoose entity relationships and CRUD operations
- ✅ **Package manager integration**: npm, yarn, pnpm with monorepo support (Nx, Lerna, Turborepo, Rush)
- ✅ **Enhanced transitive analysis**: Deep dependency traversal with cycle detection and confidence propagation
- ✅ **Map HTTP routes to handlers**: Express/Fastify routes with middleware chains and controllers
- ✅ **Component dependency detection**: Vue/React component relationships and props extraction
- ✅ **Hooks/composables analysis**: Custom hooks, Vue composables, and React state management
- ✅ **Advanced route analysis**: Dynamic segments, auth patterns, validation, Swagger docs
- ✅ **Enhanced MCP server**: Indirect analysis support with sophisticated relationship queries
- ✅ **Vue ↔ Laravel Integration**: Cross-stack dependency tracking, API mapping, full-stack impact analysis
- ✅ **Tool Consolidation**: 12 overlapping tools consolidated into 6 focused core tools
- ✅ **Enhanced Search**: Hybrid vector+lexical search with framework awareness and advanced ranking
- ✅ **Comprehensive Impact Analysis**: Single impact_of tool replacing 6 specialized tools
- ✅ **Vector Search Infrastructure**: pgvector database with embeddings, full-text search, and hybrid ranking
- ✅ **Database stores all entities**: Complete schema for routes, components, composables, jobs, tests, ORM entities, packages, API calls, data contracts

## What's Working

- 🔍 **Symbol Extraction**: Functions, classes, interfaces, variables, methods, components, hooks, jobs, tests, entities, scenes, scripts (JS/TS/PHP/C#)
- 📦 **Import Analysis**: ES6, CommonJS, dynamic imports with path resolution
- 🎯 **Framework Detection**: Evidence-based detection for Vue, Next.js, React, Node.js, Laravel, Godot
- 🧩 **Component Analysis**: Props extraction, JSX dependencies, HOC detection
- 🚀 **Route Mapping**: Express/Fastify/Laravel routes with middleware, auth, validation patterns
- 🏛️ **Laravel Support**: Route detection (web.php, api.php), Eloquent models, job queues, service providers
- 🎮 **Godot Support**: Scene file parsing (.tscn), C# script analysis, node hierarchy, autoload detection
- 🎣 **Hook/Composable Parsing**: Custom hooks, Vue composables, state management
- 📊 **Graph Building**: File, symbol, framework entity, and transitive relationships
- ⚡ **Background Jobs**: Queue detection, job processing, worker thread analysis
- 🧪 **Test Analysis**: Test suite parsing, coverage mapping, mock detection
- 🗄️ **ORM Relationships**: Entity mapping, relationship detection, database schema analysis
- 📦 **Package Management**: Dependency analysis, workspace detection, monorepo support
- 🔄 **Transitive Analysis**: Deep dependency traversal, cycle detection, confidence scoring
- 🔧 **Large File Processing**: Chunked parsing for files up to 20MB
- 🎯 **Smart Filtering**: Bundle files and generated content automatically filtered
- 🛠️ **Encoding Recovery**: Handles encoding issues and problematic files
- 🔌 **Enhanced MCP Integration**: 6 focused core tools with framework-aware AI assistant integration
- 🔍 **Advanced Search**: Hybrid vector+lexical search with framework awareness and confidence scoring
- 🎯 **Impact Analysis**: Comprehensive blast radius analysis with routes, jobs, tests, and cross-stack relationships
- 🌐 **Cross-Stack Integration**: Vue ↔ Laravel API mapping, dependency tracking, full-stack impact analysis
- 🗃️ **Vector Search Infrastructure**: pgvector with embeddings, full-text search, and advanced ranking
- 💻 **CLI Interface**: Full-featured command-line tool with repository management
- 🧪 **Testing**: Comprehensive test coverage with 95%+ coverage including edge cases

## Roadmap

Future development priorities:

### Specification Tracking & Drift Detection
- **API Contract Validation**: Between Vue components and Laravel endpoints
- **Specification Drift Detection**: Monitor and report specification changes
- **Documentation Integration**: Integrate with documentation systems
- **Contract Testing**: Automated validation of API contracts

### Additional Language Support
- **Python/Django Support**: Planned support for Python and Django framework
- **Additional Framework Integration**: Expand to other popular frameworks as needed

## Troubleshooting

### Analysis Issues

```bash
# If analysis hangs or doesn't process files
npm run analyze . --force-full --verbose    # Force full analysis with debug logging

# If relative paths don't work (now fixed)
npm run analyze .                           # This now works correctly
npm run analyze $(pwd)                      # Alternative absolute path

# If incremental analysis finds 0 changed files
npm run analyze . --force-full              # Bypass incremental mode
./dist/src/cli/index.js clear repo-name --yes && npm run analyze .  # Clear and re-analyze
```

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

The codebase follows these principles:
- TypeScript strict mode
- Comprehensive error handling
- Extensive logging
- Test-driven development
- Clean separation of concerns

## License

[License information to be added]

---

Claude Compass provides enhanced search with hybrid vector+lexical capabilities, streamlined 6-tool architecture, comprehensive impact analysis, and complete CLI interface for JavaScript/TypeScript, PHP/Laravel, and Vue ↔ Laravel cross-stack integration.