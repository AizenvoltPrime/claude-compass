# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Compass is an AI-native development environment that solves the "context starvation" problem by giving AI assistants complete contextual understanding of codebases. It builds dependency graphs using Tree-sitter parsing and exposes them via Model Context Protocol (MCP) for AI integration.

**Current Status**: Phase 5 complete - Advanced JavaScript/TypeScript, PHP/Laravel, and Vue ↔ Laravel cross-stack analysis with comprehensive framework support ready for production use.

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
```

### CLI Usage Examples

```bash
# Analyze with options (supports both relative and absolute paths)
npm run analyze .                                    # Analyze current directory
npm run analyze /path/to/project                     # Analyze absolute path
./dist/src/cli/index.js analyze . --verbose          # Verbose analysis
./dist/src/cli/index.js analyze . --force-full       # Force full analysis (clears existing data)
./dist/src/cli/index.js analyze . --no-test-files    # Exclude test files

# Search with filters
./dist/src/cli/index.js search "useState" --type function --exported-only

# Clear repository data (with confirmation prompt bypass)
./dist/src/cli/index.js clear <repository-name> --yes

# Start MCP server
./dist/src/cli/index.js mcp-server --port 3000 --verbose
```

## Architecture Overview

### Core Components

1. **Parsers** (`src/parsers/`): Tree-sitter based language parsing
   - JavaScript/TypeScript support with ES6, CommonJS, dynamic imports
   - Framework-aware parsing for Vue.js, Next.js, React, and Node.js
   - Background job parsing (Bull, BullMQ, Agenda, Bee, Kue, Worker Threads)
   - Test framework parsing (Jest, Vitest, Cypress, Playwright)
   - ORM relationship parsing (Prisma, TypeORM, Sequelize, Mongoose)
   - Package manager parsing (npm, yarn, pnpm, monorepo support)
   - Chunked parsing for large files (>28KB) with size validation
   - Encoding detection and recovery for problematic files
   - Bundle file filtering to skip minified/generated content
   - Extracts symbols, dependencies, framework entities, and relationships

2. **Database** (`src/database/`): PostgreSQL with pgvector extension
   - Knex-based migrations and connection management
   - Stores repositories, files, symbols, dependency graphs, and framework entities
   - Framework-specific tables: routes, components, composables, framework metadata
   - Phase 3 tables: job queues, job definitions, worker threads, test suites, test cases, test coverage, ORM entities, workspace projects

3. **Graph Builder** (`src/graph/`): Dependency graph construction
   - File graph: Import/export relationships between files
   - Symbol graph: Function calls, references, and inheritance
   - Transitive analyzer: Advanced dependency traversal with cycle detection and confidence scoring

4. **MCP Server** (`src/mcp/`): Model Context Protocol implementation
   - Exposes 5 enhanced tools: get_file, get_symbol, search_code, who_calls, list_dependencies
   - Enhanced tools support transitive analysis with indirect relationships and confidence scoring
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
2. Verify build: `npx tsc`

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

## Current Capabilities (Phase 5 Complete)

**Supported Languages**: JavaScript, TypeScript, JSX, TSX, ES modules, CommonJS, PHP
**Supported Frameworks**: Vue.js, Next.js, React, Node.js, Laravel with full framework-aware parsing
**Background Job Systems**: Bull, BullMQ, Agenda, Bee, Kue, Node.js Worker Threads
**Test Frameworks**: Jest, Vitest, Cypress, Playwright, Mocha
**ORM Systems**: Prisma, TypeORM, Sequelize, Mongoose, MikroORM
**Package Managers**: npm, yarn, pnpm, bun with monorepo support (Nx, Lerna, Turborepo, Rush)
**Graph Types**: File dependencies, symbol relationships, framework entity relationships, transitive analysis
**AI Integration**: Enhanced MCP server with 5 tools supporting indirect analysis and 3 resources

**Framework-Specific Features**:

- **Vue.js**: SFC parsing, Vue Router, Pinia/Vuex, composables, reactive refs
- **Next.js**: Pages/App router, API routes, middleware, ISR, client/server components
- **React**: Functional/class components, custom hooks, memo/forwardRef, context
- **Node.js**: Express/Fastify routes, middleware factories, controllers, validation patterns
- **Laravel**: Route detection (web.php, api.php), Eloquent models, job queues, service providers, middleware, commands

**Advanced Capabilities (Phases 3-4)**:

- **Background Jobs**: Queue detection, job definition parsing, worker thread analysis, scheduler recognition
- **Test-to-Code Linkage**: Test coverage analysis, mock detection, test suite hierarchy, confidence scoring
- **ORM Relationships**: Entity relationship mapping, CRUD operation detection, database schema analysis
- **Package Dependencies**: Lock file analysis, workspace relationships, version constraint analysis
- **Transitive Analysis**: Deep dependency traversal, cycle detection, confidence propagation, performance optimization
- **Monorepo Support**: Workspace detection, inter-project dependencies, shared configuration analysis
- **PHP/Laravel Support**: Laravel route/controller detection, Eloquent model relationships, job queues, service providers

**Advanced Parsing Capabilities**:

- Dynamic route segment extraction
- Authentication/authorization pattern detection
- Component dependency mapping and props extraction
- Middleware chain analysis
- Data fetching method detection (getStaticProps, getServerSideProps)
- Swagger/OpenAPI documentation extraction
- TypeScript interface and type analysis
- Job queue configuration and processing patterns
- Test coverage relationship mapping with confidence scores
- Database entity relationship analysis with foreign key detection
- Package dependency resolution with workspace support

## Limitations and Future Phases

**Current Limitations**:

- No vector search capabilities yet
- No runtime tracing for dynamic code analysis
- No AI-powered semantic understanding

**Completed Features** (Phases 3-5 ✅):

- ✅ **Background job detection** (Bull, BullMQ, Agenda, Bee, Kue, Worker Threads)
- ✅ **ORM relationship mapping** (Prisma, TypeORM, Sequelize, Mongoose, MikroORM)
- ✅ **Test-to-code linkage analysis** (Jest, Vitest, Cypress, Playwright with confidence scoring)
- ✅ **Monorepo structure analysis** (Nx, Lerna, Turborepo, Rush)
- ✅ **Enhanced transitive analysis** with cycle detection and confidence propagation
- ✅ **Package manager integration** (npm, yarn, pnpm with workspace support)
- ✅ **PHP/Laravel Support** (Laravel routes, controllers, Eloquent models, job queues, service providers)
- ✅ **Vue ↔ Laravel Integration** (Cross-stack dependency tracking, API mapping, full-stack impact analysis)

**Planned Features** (Prioritized for Vue + Laravel + Godot):

**Phase 6 - AI-Powered Analysis (NEXT PRIORITY):**
- Vector search with embeddings for full-stack understanding
- AI-generated summaries and semantic analysis
- Forward specifications and drift detection

**Phase 8 - C#/Godot Support (MEDIUM PRIORITY):**
- Game development framework support
