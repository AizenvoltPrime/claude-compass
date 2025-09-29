# Claude Compass

> A dependency analysis development environment that solves the "context gap" problem by providing AI assistants with complete contextual understanding of codebases.

Enhanced search with hybrid vector+lexical capabilities, tool consolidation from 12 to 6 focused core tools, comprehensive impact analysis, and streamlined CLI interface for production use.

## What is Claude Compass?

Claude Compass creates comprehensive dependency maps of your codebase. Instead of AI assistants making suggestions that break hidden dependencies, this system provides them with complete contextual understanding of code relationships and framework connections.

## The Problem

AI assistants suffer from **context gaps** - they make suggestions without understanding:

- Hidden dependencies and framework relationships
- Blast radius of changes
- Cross-stack connections (Vue ↔ Laravel)
- Background job dependencies
- Test coverage relationships

**Result**: AI suggestions that look good but break critical batch jobs, APIs, and system integrations.

## The Solution

### Core Capabilities

**🔍 Parse and Map Code Reality**

- Parse codebases with Tree-sitter
- Build multiple graph types (files, symbols, framework-specific)
- Extract framework relationships (routes, jobs, cross-stack connections)

**📊 Dependency Analysis**

- Map function calls, imports, and framework relationships
- Track cross-stack dependencies (Vue ↔ Laravel)
- Build comprehensive dependency graphs with full relationship data

**🔌 MCP Integration**

- Expose graphs and tools via Model Context Protocol
- Enable AI assistants to query dependency information
- Provide impact analysis and blast radius calculation

**🔧 Framework Understanding**

- Detect Vue components, Laravel routes, background jobs
- Map API calls between frontend and backend
- Track test coverage relationships

### Supported Frameworks

**Languages & Frameworks:**

- ✅ **JavaScript/TypeScript** - Full ES6, CommonJS, dynamic imports support
- ✅ **Vue.js** - Single File Components, Vue Router, Pinia/Vuex, composables
- ✅ **Next.js** - Pages/App router, API routes, middleware, SSR/SSG
- ✅ **React** - Functional/class components, hooks, context, memo
- ✅ **Node.js** - Express/Fastify routes, middleware, controllers
- ✅ **PHP/Laravel** - Routes, Eloquent models, job queues, service providers
- ✅ **C#/Godot** - Scene parsing (.tscn), C# script analysis, node hierarchy, autoloads
- ✅ **Cross-stack Integration** - Vue ↔ Laravel dependency tracking and API mapping

**Advanced Features:**

- ✅ **Background Jobs** - Bull, BullMQ, Agenda, Bee, Kue, Worker Threads
- ✅ **Test Frameworks** - Jest, Vitest, Cypress, Playwright with coverage analysis
- ✅ **ORM Systems** - Prisma, TypeORM, Sequelize, Mongoose, MikroORM
- ✅ **Package Managers** - npm, yarn, pnpm with monorepo support
- ✅ **Enhanced Search** - Hybrid vector+lexical search with framework awareness
- ✅ **Impact Analysis** - Comprehensive blast radius calculation

## Architecture

### Technology Stack

- **Parser**: Tree-sitter with language-specific grammars
- **Database**: PostgreSQL with pgvector extension
- **Search**: PostgreSQL full-text search with ranking
- **Cache**: Redis for performance optimization
- **MCP Server**: Node.js/TypeScript implementation

### Graph Types

- **File Graph**: Import/export relationships
- **Symbol Graph**: Function calls, inheritance, references
- **Framework Graphs**: Routes, dependency injection, jobs, ORM entities

## How the Analyze Command Works

The `analyze` command is the core of Claude Compass, performing deep multi-language codebase analysis through a sophisticated pipeline:

### 1. CLI Entry Point (`src/cli/index.ts`)

```bash
./dist/src/cli/index.js analyze <path> [options]
```

**Key Options:**
- `--force-full` - Force complete re-analysis instead of incremental
- `--no-test-files` - Exclude test files from analysis
- `--max-file-size <bytes>` - File size limit (default: 20MB)
- `--extensions <list>` - File extensions to analyze (default: `.js,.jsx,.ts,.tsx,.vue,.php,.cs,.tscn`)
- `--cross-stack` - Enable Vue ↔ Laravel analysis
- `--verbose` - Enable detailed logging

### 2. GraphBuilder Orchestration (`src/graph/builder.ts`)

The **GraphBuilder** coordinates the entire analysis pipeline:

```typescript
// Initialize sub-builders
new FileGraphBuilder()      // File-level relationships
new SymbolGraphBuilder()    // Symbol-level dependencies
new CrossStackGraphBuilder() // Vue ↔ Laravel connections
new GodotRelationshipBuilder() // Game engine relationships
```

### 3. Repository Setup & Framework Detection

**Repository Management:**
- Creates or retrieves repository record from database
- Detects frameworks by scanning for `package.json`, `composer.json`, `project.godot`
- Determines incremental vs full analysis based on `last_indexed` timestamp

**Framework Detection Results:**
- JavaScript/TypeScript: Vue, React, Next.js, Express, Fastify
- PHP: Laravel, Symfony, CodeIgniter
- C#: Godot game engine projects
- Cross-stack: Vue + Laravel combinations

### 4. File Discovery & Filtering (`src/graph/builder.ts:642`)

**Directory Traversal:**
- Recursive file system walk of repository path
- Respects `.compassignore` patterns (like `.gitignore`)
- Built-in skip rules for `node_modules`, `dist`, `build`, `.git`

**File Filtering:**
- Extension filtering: `.js,.jsx,.ts,.tsx,.vue,.php,.cs,.tscn` by default
- Test file detection and optional exclusion
- Generated file identification and handling
- Size policy enforcement with chunking for large files

### 5. Multi-Language Parsing (`src/parsers/multi-parser.ts`)

**Parser Selection Matrix:**

| File Type | Parser | Capabilities |
|-----------|--------|-------------|
| `.js/.ts` | TypeScriptParser | Functions, classes, imports, exports |
| `.vue` | VueParser | Components, composables, template deps |
| `.php` | LaravelParser | Routes, models, controllers, jobs |
| `.cs` | CSharpParser | Classes, methods, qualified names |
| `.tscn` | GodotParser | Scenes, nodes, script attachments |

**Tree-sitter Parsing Features:**
- Symbol extraction (functions, classes, methods, properties)
- Dependency tracking (calls, imports, inheritance)
- Framework entity detection (routes, components, models)
- Qualified name resolution (`IHandManager.SetHandPositions`)

### 6. Database Storage Pipeline (`src/database/services.ts`)

**Storage Sequence:**

```sql
-- Core Tables
repositories    -- Project metadata, detected frameworks
files          -- File paths, languages, modification times
symbols        -- Functions, classes, methods with line numbers
dependencies   -- Symbol→symbol relationships (calls, imports)
file_dependencies -- File→file relationships

-- Framework Tables
routes         -- Web routes (Laravel, Next.js, Express)
components     -- UI components (Vue, React)
composables    -- Reactive logic (Vue composables, React hooks)
framework_metadata -- Framework-specific data
godot_scenes/nodes/scripts -- Game entities
```

### 7. Graph Construction (`src/graph/`)

**File Graph Builder** (`file-graph.ts`):
- Import/export relationship mapping
- Module path resolution (relative, absolute, Node.js built-ins)
- Circular dependency detection
- Dependency depth calculation

**Symbol Graph Builder** (`symbol-graph.ts`):
- Enhanced qualified name resolution
- Interface-to-implementation mapping (C#/TypeScript)
- Call chain analysis with depth tracking
- Recursive call detection
- Symbol complexity metrics

**Cross-Stack Builder** (`cross-stack-builder.ts`):
- Vue component → Laravel API route mapping
- Data contract schema matching
- Feature cluster identification
- Cross-language dependency traversal

### 8. Advanced Analysis Components

**Symbol Resolver** (`src/graph/symbol-resolver.ts`):
- File-aware symbol resolution respecting import boundaries
- Field type mapping for C# interface resolution
- Framework symbol registry integration
- External symbol handling (npm packages, Laravel facades)

**Transitive Analyzer** (`src/graph/transitive-analyzer.ts`):
- Deep dependency traversal (configurable depth: default 10, max 20)
- Cycle detection with visited set tracking
- Cross-stack impact analysis
- Human-readable call chain formatting
- Performance optimization with caching

### 9. Analysis Results & Metrics

**Console Output:**
```
✅ Analysis completed successfully!
⏱️  Duration: 2.34s
📁 Files processed: 1,247
🔍 Symbols extracted: 8,932
🔗 Dependencies created: 12,045
📊 File graph nodes: 1,247
📊 File graph edges: 3,221
🎯 Symbol graph nodes: 8,932
🎯 Symbol graph edges: 12,045
```

**Database Storage:**
- All relationships stored with line numbers and metadata
- Embeddings generated for semantic search (pgvector)
- Indexes created for fast MCP tool queries
- Repository timestamp updated for incremental analysis

### 10. Incremental Analysis Optimization

**Change Detection:**
- Compares file `mtime` vs repository `last_indexed`
- Selective re-parsing of modified files only
- Smart graph rebuilding with updated relationships
- Database transaction management for consistency

**Performance Features:**
- Batch database operations for efficiency
- Configurable file size policies with chunking
- Memory-efficient streaming for large codebases
- Background processing for non-blocking analysis

### 11. Error Handling & Recovery

**Robust Error Management:**
- Parsing failures logged but don't stop analysis
- Encoding recovery with multiple fallback strategies
- Size policy enforcement prevents memory issues
- Transaction rollback on database errors
- Graceful degradation for unsupported constructs

This comprehensive pipeline enables Claude Compass to understand complex, multi-language codebases and provide AI assistants with complete contextual awareness of code relationships and dependencies.

## Quick Start

Ready to try Claude Compass? Get up and running in minutes:

```bash
# Clone and install
git clone https://github.com/your-org/claude-compass
cd claude-compass
npm install

# Setup database (Docker recommended)
npm run docker:up
npm run migrate:latest

# Analyze your codebase (JavaScript/TypeScript, PHP/Laravel, or C#/Godot)
npm run analyze .                              # Analyze current directory
npm run analyze /path/to/your/project          # Analyze specific path
npm run analyze /path/to/your/godot-project    # Analyze Godot game project
npm run analyze . --force-full                 # Force full analysis (clears existing data)

# Database management
npm run migrate:status                         # Check migration status
npm run db:clear                              # Clear database completely (SQL method)
npm run db:clear:docker                       # Clear database with Docker reset

# Clear existing repository analysis
./dist/src/cli/index.js clear <repository-name> --yes

# Start MCP server for AI integration
npm run mcp-server

# Test framework detection and parsing
npm test
```

**📚 For detailed setup instructions, troubleshooting, and advanced features, see [GETTING_STARTED.md](./GETTING_STARTED.md)**

## Roadmap

**Future Development:**

- **Specification Tracking & Drift Detection** - API contract validation and documentation integration
- **Python/Django Support** - Python framework support for web development
- **Enhanced AI Integration** - Advanced AI-powered code analysis and suggestions

## Success Metrics

- **Time to understand new codebase**: < 2 hours (vs 2 days)
- **Bug introduction rate**: 50% reduction in breaking changes
- **Developer productivity**: 20% improvement in feature delivery
- **Documentation freshness**: 90% of specs match implementation
- **Search accuracy**: 95% of relationships correctly identified
- **Response time**: 95% of queries under 500ms

## Contributing

We welcome contributions! Please follow these guidelines:

### Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/claude-compass.git`
3. Install dependencies: `npm install --force` (required due to Tree-sitter dependencies)
4. Set up the database: `npm run docker:up && npm run migrate:latest`

### Development Workflow

1. Create a feature branch: `git checkout -b feature/your-feature-name`
2. Make your changes following the existing code style
3. Add tests for new functionality
4. Run tests individually (full test suite has Tree-sitter dependency conflicts): `npm test -- tests/specific-test.test.ts`
5. Build the project: `npx tsc`
6. Commit with descriptive messages
7. Push to your fork and create a pull request

### Code Guidelines

- Follow TypeScript best practices
- Add JSDoc comments for public APIs
- Maintain test coverage for new features
- Use existing patterns for parsers and database operations
- Follow the established project structure in `src/`

### Testing

- Write unit tests for new parsers in `tests/parsers/`
- Add integration tests for database operations
- Test framework-specific features thoroughly
- Run tests individually due to Tree-sitter dependency conflicts: `npm test -- tests/specific-test.test.ts`
- Use `NODE_ENV=test` for test database operations
- Ensure relevant tests pass before submitting PRs

### Pull Request Process

1. Update documentation if needed
2. Add yourself to contributors if it's your first contribution
3. Ensure CI passes
4. Request review from maintainers

For questions or discussions, please open an issue first.
