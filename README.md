# Claude Compass

> A dependency analysis development environment that solves the "context gap" problem by providing AI assistants with complete contextual understanding of codebases.

Enhanced search with hybrid vector+lexical capabilities, 6 focused core tools for comprehensive code analysis, powerful impact analysis, and streamlined CLI interface for production use.

## What is Claude Compass?

Claude Compass creates comprehensive dependency maps of your codebase. Instead of AI assistants making suggestions that break hidden dependencies, this system provides them with complete contextual understanding of code relationships and framework connections.

## The Problem

AI assistants suffer from **context gaps** - they make suggestions without understanding:

- Hidden dependencies and framework relationships
- Blast radius of changes
- Cross-stack connections (Vue ↔ Laravel)
- Background job dependencies

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
- Track cross-stack dependencies (Vue ↔ Laravel)

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

- ✅ **Symbol Resolution** - Automatic FQN resolution via autoloader configs (PSR-4, tsconfig paths, C# namespaces)
- ✅ **Background Jobs** - Bull, BullMQ, Agenda, Bee, Kue, Worker Threads
- ✅ **Enhanced Search** - Hybrid embedding+lexical search with vector similarity
- ✅ **Impact Analysis** - Comprehensive blast radius calculation

## Architecture

### Technology Stack

- **Parser**: Tree-sitter with language-specific grammars
- **Database**: PostgreSQL with pgvector extension
- **Search**: Hybrid embedding+lexical search with GPU acceleration
  - **Model**: BGE-M3 (1024-dimensional embeddings, state-of-the-art for code)
  - **Performance**: CUDA GPU acceleration via ONNX Runtime (2-3x faster)
  - **Approach**: Vector similarity using learned code patterns from BGE-M3 training
  - **Quality**: Finds conceptually similar code through embedding proximity
  - **Fallback**: Automatic CPU mode if GPU unavailable
- **Cache**: Redis for performance optimization
- **MCP Server**: Node.js/TypeScript implementation

### GPU Acceleration (Optional)

**Performance Boost:**

- **2-3x faster** embedding generation with NVIDIA GPUs
- Automatic CUDA detection and configuration
- Graceful fallback to CPU if GPU unavailable

**Requirements:**

- NVIDIA GPU with CUDA support (11.x or 12.x recommended)
- ~1.2GB disk space for FP16 model
- Download model: `node download-bge-m3.js`

**Benefits:**

- Faster analysis of large codebases (1000+ files)
- Real-time vector similarity search with minimal latency
- Optimized batch processing (500 symbols at once)

### Graph Types

- **File Graph**: Import/export relationships
- **Symbol Graph**: Function calls, inheritance, references
- **Framework Graphs**: Routes, components, background jobs, cross-stack API connections

## How the Analyze Command Works

The `analyze` command is the core of Claude Compass, performing deep multi-language codebase analysis through a sophisticated pipeline:

### 1. CLI Entry Point (`src/cli/index.ts`)

```bash
./dist/src/cli/index.js analyze <path> [options]
```

**Key Options:**

- `--force-full` - Force complete re-analysis instead of incremental
- `--skip-embeddings` - Skip embedding generation for faster analysis (vector similarity search disabled, lexical/fulltext only)
- `--no-test-files` - Exclude test files from analysis
- `--max-file-size <bytes>` - File size limit (default: 20MB)
- `--extensions <list>` - File extensions to analyze (default: `.js,.jsx,.ts,.tsx,.vue,.php,.cs,.tscn`)
- `--cross-stack` - Enable Vue ↔ Laravel analysis
- `--verbose` - Enable detailed logging

### 2. GraphBuilder Orchestration (`src/graph/builder.ts`)

The **GraphBuilder** coordinates the entire analysis pipeline:

```typescript
// Initialize sub-builders
new FileGraphBuilder(); // File-level relationships
new SymbolGraphBuilder(); // Symbol-level dependencies
new CrossStackGraphBuilder(); // Vue ↔ Laravel connections
new GodotRelationshipBuilder(); // Game engine relationships
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

| File Type | Parser           | Capabilities                           |
| --------- | ---------------- | -------------------------------------- |
| `.js/.ts` | TypeScriptParser | Functions, classes, imports, exports   |
| `.vue`    | VueParser        | Components, composables, template deps |
| `.php`    | LaravelParser    | Routes, models, controllers, jobs      |
| `.cs`     | CSharpParser     | Classes, methods, qualified names      |
| `.tscn`   | GodotParser      | Scenes, nodes, script attachments      |

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
api_calls      -- Cross-stack frontend→backend API connections (Vue → Laravel)
components     -- UI components (Vue, React)
framework_metadata -- Framework-specific data
godot_scenes/nodes -- Game entities (scenes and node hierarchy)
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
- GPU-accelerated embeddings for vector similarity search (BGE-M3, 1024-dim, pgvector)
  - Finds conceptually similar symbols using learned code patterns
  - Uses cosine distance in 1024-dimensional embedding space
- Parallel batch processing (500 symbols per batch)
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

# Download GPU-optimized embedding model (recommended, ~1.2GB)
node download-bge-m3.js                        # Downloads FP16 model for GPU acceleration
                                               # Automatically falls back to CPU if no GPU

# Analyze your codebase (JavaScript/TypeScript, PHP/Laravel, or C#/Godot)
npm run analyze .                              # Analyze current directory
npm run analyze /path/to/your/project          # Analyze specific path
npm run analyze /path/to/your/godot-project    # Analyze Godot game project
npm run analyze . --force-full                 # Force full analysis (clears existing data)
npm run analyze . --skip-embeddings            # Skip vector embeddings (faster, lexical/fulltext search only)

# Database management
npm run migrate:status                         # Check migration status
npm run db:clear                              # Clear database completely (SQL method)
npm run db:clear:docker                       # Clear database with Docker reset
npm run db:vacuum                             # Run VACUUM ANALYZE (reclaim space, update stats)

# Clear existing repository analysis
./dist/src/cli/index.js clear <repository-name> --yes

# Start MCP server for AI integration
npm run mcp-server                         # STDIO mode (for Claude Desktop)
npm run mcp-http                           # HTTP mode (for remote access)
npm run mcp-unified                        # Unified mode (webhook + MCP + auto SSH tunnel)

# Test framework detection and parsing
npm test
```

**Server Modes:**

- **`mcp-server`** - STDIO transport for local Claude Desktop integration
- **`mcp-http`** - HTTP transport for remote MCP clients (manual tunnel setup)
- **`mcp-unified`** - Combined webhook + MCP server with automatic SSH tunnel (recommended for remote development)

**📚 For detailed setup instructions, troubleshooting, and advanced features, see [GETTING_STARTED.md](./GETTING_STARTED.md)**

## MCP Tools

Claude Compass exposes 8 focused core tools via the Model Context Protocol for AI assistant integration. These tools provide comprehensive codebase understanding, dependency analysis, impact assessment, and feature discovery.

### Available Tools

#### 1. `search_code`

Search for code symbols with framework awareness and hybrid search capabilities (combines vector similarity, lexical matching, and full-text search).

**Parameters:**

- `query` (required): Search query (symbol name or pattern)
- `repo_ids`: Array of repository IDs to search in
- `entity_types`: Framework-aware entity types
  - Options: `route`, `model`, `controller`, `component`, `job`, `function`, `class`, `interface`
- `framework`: Filter by framework type
  - Options: `laravel`, `vue`, `react`, `node`
- `is_exported`: Filter by exported symbols only (boolean)
- `search_mode`: Search strategy (default: `auto`)
  - `auto`: Hybrid embedding+lexical search (recommended)
  - `exact`: Lexical search only (exact name matching)
  - `vector`: Vector similarity search only (embedding-based)
  - `qualified`: Namespace-aware search (qualified names)

**Returns:** List of matching symbols with framework context (limit: 30 results)

#### 2. `get_file`

Get detailed information about a specific file including its metadata and symbols.

**Parameters:**

- `file_id`: The ID of the file to retrieve (number)
- `file_path`: The path of the file to retrieve (alternative to file_id)

**Note:** Either `file_id` or `file_path` must be provided.

**Returns:** File details with metadata and symbol list

#### 3. `get_symbol`

Get details about a specific symbol including its dependencies.

**Parameters:**

- `symbol_id` (required): The ID of the symbol to retrieve (number)

**Returns:** Symbol details with dependencies and callers

#### 4. `who_calls`

Find all symbols that call or reference a specific symbol. Supports transitive analysis to find indirect callers.

**Parameters:**

- `symbol_id` (required): The ID of the symbol to find callers for (number)
- `dependency_type`: Type of dependency relationship (default: `calls`)
  - Options: `calls`, `imports`, `inherits`, `implements`, `references`, `exports`, `api_call`, `shares_schema`, `frontend_backend`
- `include_cross_stack`: Include cross-stack callers (Vue ↔ Laravel) (boolean, default: false)
- `max_depth`: Transitive analysis depth (default: 1, min: 1, max: 20)
  - Controls how deep to search for indirect callers (e.g., depth 2 finds A→B→target)
  - Depth 1 returns only direct callers
  - Higher values find more indirect relationships but increase query time

**Returns:** List of symbols that call or reference the target symbol, including call chains for transitive results

#### 5. `list_dependencies`

List all dependencies of a specific symbol. Supports transitive analysis to find indirect dependencies.

**Parameters:**

- `symbol_id` (required): The ID of the symbol to list dependencies for (number)
- `dependency_type`: Type of dependency relationship
  - Options: `calls`, `imports`, `inherits`, `implements`, `references`, `exports`, `api_call`, `shares_schema`, `frontend_backend`
- `include_cross_stack`: Include cross-stack dependencies (Vue ↔ Laravel) (boolean, default: false)
- `max_depth`: Transitive analysis depth (default: 1, min: 1, max: 20)
  - Controls how deep to search for indirect dependencies (e.g., depth 2 finds target→B→C)
  - Depth 1 returns only direct dependencies
  - Higher values find more indirect relationships but increase query time

**Returns:** List of dependencies with relationship information, including call chains for transitive results

#### 6. `impact_of`

Comprehensive impact analysis - calculate blast radius across all frameworks including routes and jobs. Uses deep transitive analysis to find all affected code.

**Parameters:**

- `symbol_id` (required): The ID of the symbol to analyze impact for (number)
- `frameworks`: Multi-framework impact analysis (default: all detected frameworks)
  - Options: `vue`, `laravel`, `react`, `node`
- `max_depth`: Transitive analysis depth (default: 5, min: 1, max: 20)
  - Controls how deep to trace impact through the dependency graph
  - Higher values provide more comprehensive impact analysis
  - Default of 5 balances thoroughness with performance

**Returns:** Comprehensive impact analysis with categorized results:
- `direct_impact`: Symbols directly related to the target
- `indirect_impact`: Symbols indirectly affected through transitive dependencies
- `routes_affected`: Web routes that may be impacted
- `jobs_affected`: Background jobs that may be impacted
- `tests_affected`: Test files that should be run
- `summary`: Aggregate metrics including total counts and frameworks affected

#### 7. `trace_flow`

Find execution paths between two symbols. Can find shortest path or all paths up to max_depth. Useful for understanding how code flows from point A to B.

**Parameters:**

- `start_symbol_id` (required): Starting symbol ID (number)
- `end_symbol_id` (required): Ending symbol ID (number)
- `find_all_paths`: If true, finds all paths; if false, finds shortest path (boolean, default: false)
- `max_depth`: Maximum path depth to search (default: 10, min: 1, max: 20)
  - Controls how deep to search for execution paths
  - Higher values may find longer indirect paths but increase query time

**Returns:** Execution paths showing how code flows from the start symbol to the end symbol, including intermediate steps

#### 8. `discover_feature`

Discover complete feature modules across the entire stack. Finds all related code for a feature by combining dependency analysis, naming heuristics, and cross-stack API tracing. Discovers semantic features that span frontend and backend with improved filtering, relevance scoring, and test exclusion.

**Parameters:**

- `symbol_id` (required): Symbol ID to start feature discovery from (e.g., a controller method, store function, or service) (number)
- `include_components`: Include Vue/React components in the feature manifest (boolean, default: true)
- `include_routes`: Include API routes in the feature manifest (boolean, default: true)
- `include_models`: Include database models in the feature manifest (boolean, default: true)
- `include_tests`: Include test files and test symbols (boolean, default: false to filter out test noise)
- `include_callers`: Include reverse dependencies - symbols that call/import the discovered symbols (boolean, default: true)
  - Enables bidirectional discovery for symmetric results regardless of entry point
- `naming_depth`: How aggressively to match related symbols by name (default: 2, min: 1, max: 3)
  - 1 = conservative (exact matches)
  - 2 = moderate (pattern matching)
  - 3 = aggressive (fuzzy matching)
- `max_depth`: Maximum depth for dependency graph traversal (default: 3, min: 1, max: 20)
  - Lower values = more focused results
  - Higher values = more comprehensive discovery
- `max_symbols`: Maximum number of symbols to return (default: 500, min: 10, max: 5000)
  - Prevents overwhelming responses with too many results
- `min_relevance_score`: Minimum relevance score (0.0-1.0) for including symbols (default: 0)
  - Based on dependency distance and naming similarity
  - Higher values = only highly relevant symbols

**Returns:** Feature manifest with categorized symbols:
- `feature_name`: Inferred feature name
- `entry_point`: The starting symbol for discovery
- `frontend`: Categorized frontend symbols (stores, components, composables)
- `api`: API routes related to the feature
- `backend`: Categorized backend symbols (controllers, services, requests, models, jobs)
- `related_symbols`: Additional related symbols
- `summary`: Aggregate metrics including counts for each category

### Usage Examples

```typescript
// Search for authentication-related code using hybrid embedding+lexical search
const results = await mcpClient.callTool('search_code', {
  query: 'authenticate',
  entity_types: ['function', 'class', 'route'],
  framework: 'laravel',
  search_mode: 'auto', // Hybrid: combines vector similarity, lexical, and fulltext
});

// Or use vector similarity only
const vectorResults = await mcpClient.callTool('search_code', {
  query: 'user verification',
  search_mode: 'vector', // Vector similarity - finds login, auth, verify, etc.
});

// Get comprehensive impact analysis with deep transitive search
const impact = await mcpClient.callTool('impact_of', {
  symbol_id: 123,
  frameworks: ['vue', 'laravel'],
  max_depth: 10, // Deep analysis to find all indirect impacts
});

// Find who calls a specific function (with transitive analysis)
const callers = await mcpClient.callTool('who_calls', {
  symbol_id: 456,
  dependency_type: 'calls',
  include_cross_stack: true,
  max_depth: 3, // Find callers up to 3 levels deep (A→B→C→target)
});

// List dependencies with indirect relationships
const dependencies = await mcpClient.callTool('list_dependencies', {
  symbol_id: 789,
  max_depth: 2, // Find direct dependencies and one level of indirect
});

// Trace execution flow between two symbols
const flowPath = await mcpClient.callTool('trace_flow', {
  start_symbol_id: 100,
  end_symbol_id: 200,
  find_all_paths: false, // Find shortest path only
  max_depth: 10,
});

// Discover complete feature module from entry point
const feature = await mcpClient.callTool('discover_feature', {
  symbol_id: 350, // e.g., UserController.register
  include_components: true,
  include_routes: true,
  include_models: true,
  include_tests: false, // Exclude test files
  include_callers: true, // Bidirectional discovery
  naming_depth: 2, // Moderate name matching
  max_depth: 3, // Focused results
  max_symbols: 500,
  min_relevance_score: 0.5, // Only highly relevant symbols
});
```

### Resources Available

**`repo://repositories`** - List of all analyzed repositories with metadata and framework detection results.

## Remote Analysis Setup

For analyzing projects hosted on remote servers (e.g., Hetzner, AWS, VPS), Claude Compass includes a **unified server** that combines webhook-based file sync with MCP server functionality, enabling **real-time incremental analysis** with 10x performance improvement over network-mounted filesystems.

### Use Case

**Problem:** Analyzing code over SSHFS or network mounts is slow (10-30 seconds per analysis) due to network I/O latency.

**Solution:** The unified server syncs only source files to local WSL using rsync, then analyzes locally for 10x faster performance (1-3 seconds per analysis). It also provides MCP tools for AI assistant integration - all on a single port.

### Architecture

```
Remote Server (file changes) → Webhook → SSH Tunnel (auto-managed) → WSL Unified Server → rsync sync → Local Analysis (FAST!)
                                                                      ↓
                                                                   MCP Tools (AI Integration)
```

### Key Features

- ✅ **Unified server** - Webhook + MCP on single port (3456)
- ✅ **Automatic SSH tunnel** - Auto-creates reverse tunnel on startup
- ✅ **Real-time file change detection** using inotify on remote server
- ✅ **Incremental syncing** - only changed files, not entire project
- ✅ **Optimized exclusions** - skips dependencies, builds, uploads (70-95% smaller sync)
- ✅ **Auto-reconnect** - SSH tunnel reconnects automatically if dropped
- ✅ **Automatic analysis** - triggers Claude Compass on file changes
- ✅ **MCP integration** - Expose code tools to AI assistants
- ✅ **Dual authentication** - Webhook secret + Bearer token
- ✅ **Production-ready** - Graceful shutdown, process management, security hardening

### Quick Setup

```bash
# Configure environment
cp .env.example .env
nano .env

# Required configuration:
# ENABLE_SSH_TUNNEL=true
# SSH_REMOTE_HOST=user@server-ip
# WEBHOOK_SECRET=<generate-with: openssl rand -hex 32>
# MCP_AUTH_TOKEN=<generate-with: openssl rand -hex 32>
# LOCAL_PROJECT_PATH=/home/user/Documents/project
# REMOTE_PROJECT_PATH=/var/www/project
# DEFAULT_REPO_NAME=project_name

# Build and start unified server (handles everything!)
npm run build
npm run mcp-unified
```

**Output:**

```
🚀 Unified Server running on http://localhost:3456

📡 Available Endpoints:
   GET    /health                  - Health check
   POST   /webhook/file-changed    - File change webhook
   POST   /trigger/analyze         - Manual analysis trigger
   POST   /mcp                     - MCP client requests

   📁 Default repository: your_project

🔐 Authentication:
   ✅ Webhook: Secret configured
   ✅ MCP: Bearer token required

🔌 Starting SSH tunnel...
   ✅ Tunnel: user@server → localhost:3456
```

**On Remote Server:** Install file watcher - see complete instructions in `webhook-server/SETUP_GUIDE.md`

### Common Commands

```bash
# Start unified server (auto-creates SSH tunnel)
npm run mcp-unified

# Manual triggers (from WSL)
curl -X POST http://localhost:3456/trigger/sync \
  -H "X-Webhook-Secret: your-secret"

curl -X POST http://localhost:3456/trigger/analyze \
  -H "X-Webhook-Secret: your-secret"

# Check health (from remote server via tunnel)
curl http://localhost:3456/health

# Test webhook (from remote server)
curl -X POST http://localhost:3456/webhook/file-changed \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret" \
  -d '{"event":"modified","file_path":"test.php",...}'
```

### MCP Client Integration

Connect AI assistants from remote server:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport({
  url: 'http://localhost:3456/mcp', // via SSH tunnel
  headers: {
    Authorization: 'Bearer your-mcp-token',
  },
});

const client = new Client({ name: 'remote-client', version: '1.0.0' }, { capabilities: {} });

await client.connect(transport);

// Use MCP tools
const result = await client.callTool({
  name: 'search_code',
  arguments: { query: 'authenticate' },
});
```

### Performance Comparison

| Method               | Analysis Time  | Disk Usage | Network I/O              |
| -------------------- | -------------- | ---------- | ------------------------ |
| **SSHFS**            | 10-30 seconds  | None       | High (every file read)   |
| **Webhook + rsync**  | 1-3 seconds    | 20-100MB   | Low (only changed files) |
| **Performance Gain** | **10x faster** | Minimal    | **95% reduction**        |

**📚 Complete setup instructions:** [webhook-server/SETUP_GUIDE.md](./webhook-server/SETUP_GUIDE.md)

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
3. Install dependencies: `npm install --legacy-peer-deps` (required due to Tree-sitter dependencies)
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
