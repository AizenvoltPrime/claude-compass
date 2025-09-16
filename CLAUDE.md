# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Compass is an AI-native development environment that solves the "context starvation" problem by giving AI assistants complete contextual understanding of codebases. It builds dependency graphs using Tree-sitter parsing and exposes them via Model Context Protocol (MCP) for AI integration.

**Current Status**: Phase 1 complete - JavaScript/TypeScript foundation with MCP integration ready for production use.

## Essential Commands

### Build and Development
```bash
npm run build              # Compile TypeScript to dist/
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
./dist/cli/index.js analyze /path/to/project --verbose --no-test-files

# Search with filters
./dist/cli/index.js search "useState" --type function --exported-only

# Start MCP server
./dist/cli/index.js mcp-server --port 3000 --verbose
```

## Architecture Overview

### Core Components

1. **Parsers** (`src/parsers/`): Tree-sitter based language parsing
   - JavaScript/TypeScript support with ES6, CommonJS, dynamic imports
   - Extracts symbols, dependencies, and relationships

2. **Database** (`src/database/`): PostgreSQL with pgvector extension
   - Knex-based migrations and connection management
   - Stores repositories, files, symbols, and dependency graphs

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
3. Build project: `npm run build`

### After Making Changes
1. Run tests: `npm test`
2. Check linting: `npm run lint`
3. Verify build: `npm run build`

### Working with Database
- Migrations are in `src/database/migrations/` and compiled to `dist/database/migrations/`
- Always run `npm run build` before running migrations
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

## Phase 1 Capabilities (Current)

**Supported Languages**: JavaScript, TypeScript, JSX, TSX, ES modules, CommonJS
**Supported Frameworks**: Vue.js, Next.js, React, Node.js (any JS/TS framework)
**Graph Types**: File dependencies, symbol relationships
**AI Integration**: Full MCP server with 5 tools and 3 resources

## Limitations and Future Phases

**Current Limitations**:
- No framework-specific analysis (routes, components, etc.)
- No vector search capabilities yet
- No advanced impact analysis

**Planned Features** (Phase 2+):
- Vue.js component and router analysis
- Next.js pages and API routes detection
- React component and hook analysis
- Vector search with embeddings
- PHP/Laravel support
- Advanced impact analysis and drift detection