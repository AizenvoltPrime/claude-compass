# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Compass is an AI-native development environment that solves the "context starvation" problem by giving AI assistants complete contextual understanding of codebases. It builds dependency graphs using Tree-sitter parsing and exposes them via Model Context Protocol (MCP) for AI integration.

**Current Status**: Phase 2 complete - Full JavaScript/TypeScript framework analysis with Vue.js, Next.js, React, and Node.js support ready for production use.

## Essential Commands

### Build and Development

```bash
npx tsc              # Compile TypeScript to dist/
npm run dev               # Build with watch mode for development
npm run clean             # Remove dist/ directory
```

### Testing

```bash
npm test                  # Run all tests
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Run tests with coverage report
```

### Code Quality

```bash
npm run lint              # Lint TypeScript files
npm run lint:fix          # Lint and auto-fix issues
npm run format            # Format code with Prettier
```

### Database Operations

```bash
npm run docker:up         # Start PostgreSQL with Docker
npm run docker:down       # Stop Docker containers
npm run migrate:latest    # Run database migrations
npm run migrate:rollback  # Rollback last migration
npm run migrate:make <name> # Create new migration
```

### Core Application Commands

```bash
npm run analyze <path>    # Analyze a codebase and build graphs
npm run mcp-server        # Start MCP server for AI integration
npm start search <query>  # Search for symbols in analyzed codebases
```

### CLI Usage Examples

```bash
# Analyze with options
./dist/src/cli/index.js analyze /path/to/project --verbose --no-test-files

# Search with filters
./dist/src/cli/index.js search "useState" --type function --exported-only

# Start MCP server
./dist/src/cli/index.js mcp-server --port 3000 --verbose
```

## Architecture Overview

### Core Components

1. **Parsers** (`src/parsers/`): Tree-sitter based language parsing
   - JavaScript/TypeScript support with ES6, CommonJS, dynamic imports
   - Framework-aware parsing for Vue.js, Next.js, React, and Node.js
   - Chunked parsing for large files (>28KB) with size validation
   - Encoding detection and recovery for problematic files
   - Bundle file filtering to skip minified/generated content
   - Extracts symbols, dependencies, framework entities, and relationships

2. **Database** (`src/database/`): PostgreSQL with pgvector extension
   - Knex-based migrations and connection management
   - Stores repositories, files, symbols, dependency graphs, and framework entities
   - Framework-specific tables: routes, components, composables, framework metadata

3. **Graph Builder** (`src/graph/`): Dependency graph construction
   - File graph: Import/export relationships between files
   - Symbol graph: Function calls, references, and inheritance

4. **MCP Server** (`src/mcp/`): Model Context Protocol implementation
   - Exposes 5 tools: get_file, get_symbol, search_code, who_calls, list_dependencies
   - Provides 3 resources: repositories, file graph, symbol graph

5. **CLI** (`src/cli/`): Command-line interface using Commander.js
   - Repository analysis, search, and MCP server management

### Technology Stack

- **Language**: TypeScript with ES2022 target
- **Database**: PostgreSQL with Knex ORM
- **Parser**: Tree-sitter with language-specific grammars
- **Protocol**: Model Context Protocol (MCP) for AI integration
- **Testing**: Jest with comprehensive coverage
- **Build**: Native TypeScript compiler

### Configuration

- Environment variables in `.env` (see `.env.example`)
- Database configuration in `knexfile.js`
- TypeScript config uses strict mode disabled for flexibility
- Base path alias: `@/*` maps to `src/*`

## Development Workflow

### Before Making Changes

1. Ensure database is running: `npm run docker:up`
2. Run migrations: `npm run migrate:latest`
3. Build project: `npx tsc`

### After Making Changes

1. Run tests: `npm test`
2. Check linting: `npm run lint`
3. Verify build: `npx tsc`

### Working with Database

- Migrations are in `src/database/migrations/` and compiled to `dist/database/migrations/`
- Always run `npx tsc` before running migrations
- Database models defined in `src/database/models.ts`
- Database operations in `src/database/services.ts`

### Testing Strategy

- Unit tests for parsers, graph builders, and database operations
- Integration tests for MCP server functionality
- Test files follow pattern: `*.test.ts` or `*.spec.ts`
- Test setup in `tests/setup.ts`

## Key Design Patterns

### Error Handling

- Comprehensive error handling throughout the system
- Database connection management with proper cleanup
- Parser errors collected but don't stop overall analysis

### Async Architecture

- Heavy use of async/await for I/O operations
- Database operations use connection pooling
- File processing handles large codebases efficiently

### Modular Design

- Clear separation between parsing, graph building, and storage
- MCP server is independent module for AI integration
- CLI provides unified interface to all functionality

## Current Capabilities (Phase 2 Complete)

**Supported Languages**: JavaScript, TypeScript, JSX, TSX, ES modules, CommonJS
**Supported Frameworks**: Vue.js, Next.js, React, Node.js with full framework-aware parsing
**Graph Types**: File dependencies, symbol relationships, framework entity relationships
**AI Integration**: Full MCP server with 5 tools and 3 resources

**Framework-Specific Features**:

- **Vue.js**: SFC parsing, Vue Router, Pinia/Vuex, composables, reactive refs
- **Next.js**: Pages/App router, API routes, middleware, ISR, client/server components
- **React**: Functional/class components, custom hooks, memo/forwardRef, context
- **Node.js**: Express/Fastify routes, middleware factories, controllers, validation patterns

**Advanced Parsing Capabilities**:

- Dynamic route segment extraction
- Authentication/authorization pattern detection
- Component dependency mapping and props extraction
- Middleware chain analysis
- Data fetching method detection (getStaticProps, getServerSideProps)
- Swagger/OpenAPI documentation extraction
- TypeScript interface and type analysis

## Limitations and Future Phases

**Current Limitations**:

- No background job detection (worker threads, job queues)
- No ORM relationship mapping (Prisma, TypeORM, Sequelize)
- No test-to-code linkage analysis
- No vector search capabilities yet
- No monorepo structure analysis

**Planned Features** (Phase 3+):

- Background job detection and queue analysis
- Database ORM mapping and relationship detection
- Test-to-code linkage (Jest, Vitest, Cypress, Playwright)
- Enhanced `who_calls` and `list_dependencies` tools
- Package manager integration and monorepo analysis
- Vector search with embeddings
- PHP/Laravel support
- Advanced impact analysis and drift detection
