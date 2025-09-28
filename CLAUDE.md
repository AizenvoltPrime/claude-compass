# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Compass is a dependency analysis development environment that solves the "context gap" problem by providing AI assistants with complete contextual understanding of codebases. It builds comprehensive dependency graphs using Tree-sitter parsing and exposes them via Model Context Protocol (MCP) for AI integration.

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
npm run migrate:status    # Check migration status
npm run db:clear          # Clear database completely (SQL method)
npm run db:clear:docker   # Clear database with Docker reset
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
./dist/src/cli/index.js analyze /path/to/repo --debug-file scripts/core/managers/CardManager.cs --verbose  # Debug single file parsing

# Clear repository data (with confirmation prompt bypass)
./dist/src/cli/index.js clear <repository-name> --yes

# Start MCP server
./dist/src/cli/index.js mcp-server --port 3000 --verbose
```

## Architecture

### Core Components

**Parser System (`src/parsers/`)**

- Multi-language parsing using Tree-sitter
- Language parsers: JavaScript, TypeScript, PHP, C#
- Framework parsers: Vue, React, Laravel, Next.js, Godot
- Chunking strategies for large files
- Cross-stack dependency detection

**Graph Builder (`src/graph/`)**

- Constructs dependency graphs from parsed symbols
- Handles file, symbol, and framework relationships
- Cross-stack builder for Vue � Laravel connections
- Call chain analysis and formatting

**Database Layer (`src/database/`)**

- PostgreSQL with pgvector for enhanced search
- Knex.js for migrations and queries
- Services for repositories, symbols, dependencies
- Full-text search with ranking

**MCP Integration (`src/mcp/`)**

- Model Context Protocol server implementation
- Tools for code search, dependency analysis, impact assessment
- Consolidated tool interface (6 core tools)
- Laravel and cross-stack specific tools

**CLI (`src/cli/`)**

- Command-line interface for analysis and queries
- Progress tracking with ora spinners
- Repository management commands

### Database Schema

The system uses PostgreSQL with these core tables:

- `repositories`: Project metadata and framework detection
- `symbols`: All parsed code symbols with embeddings
- `dependencies`: Symbol relationships and calls
- `routes`: Framework-agnostic routes with Laravel-specific fields
- `cross_stack_calls`: Frontend-backend connections
- `framework_metadata`: Consolidated framework-specific data storage

### Parser Flow

1. **File Discovery**: Walks directory tree, filters by extensions
2. **Chunking**: Splits large files into manageable chunks
3. **Parsing**: Tree-sitter extracts symbols and relationships
4. **Framework Detection**: Identifies Vue, Laravel, React patterns
5. **Graph Building**: Constructs dependency relationships
6. **Database Storage**: Persists with embeddings for search

### Key Concepts

**Symbol Types**

- Functions, classes, interfaces, methods
- Vue components, composables, stores
- Laravel routes, controllers, models
- React components, hooks

**Dependency Types**

- Function calls, imports/exports
- Class inheritance, interface implementation
- Framework-specific (API calls, route handlers)
- Cross-stack (Vue � Laravel API)

**Search Capabilities**

- Full-text search with PostgreSQL ranking
- Vector similarity for semantic search
- Framework-aware filtering
- Impact analysis and blast radius

## Environment Variables

Create a `.env` file with:

```bash
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=claude_compass
DATABASE_USER=claude_compass
DATABASE_PASSWORD=password

# For test environment
NODE_ENV=test  # Uses separate test database

# Debug mode
CLAUDE_COMPASS_DEBUG=true
LOG_LEVEL=debug
```

## Testing Strategy

- Unit tests for parsers and core logic
- Integration tests for database operations
- Framework-specific test suites (Vue, Laravel, C#)
- Cross-stack integration tests
- Performance benchmarks for large codebases

Test files follow pattern: `*.test.ts` in `tests/` directory
Setup file: `tests/setup.ts` initializes test database

## Development Principles

### Code Quality Standards

**NEVER implement fallback business logic, backwards compatibility, or lazy solutions**

- Write robust, well-designed code from the start
- Avoid temporary fixes or "quick and dirty" solutions
- Do not add fallback mechanisms that mask underlying issues
- Implement proper error handling instead of silent failures
- Address root causes rather than symptoms
- Maintain high code quality standards throughout development

## Common Patterns

### Adding Language Support

1. Add Tree-sitter grammar dependency
2. Create parser in `src/parsers/languages/`
3. Implement chunking strategy if needed
4. Add tests in `tests/parsers/`
5. Register in multi-parser

### Debugging Parser Issues

```bash
# Enable debug logging
CLAUDE_COMPASS_DEBUG=true ./dist/src/cli/index.js analyze /path --verbose

# Debug single file parsing (for parser development and troubleshooting)
./dist/src/cli/index.js analyze /path/to/repo --debug-file relative/path/to/file.cs --verbose

### Database Migrations

Migrations in `src/database/migrations/` use Knex
Naming: `XXX_description.ts` where XXX is sequential
Always include both `up` and `down` methods
```
