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
- Build comprehensive dependency graphs with confidence scoring

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

## License

[License information to be added]

## Contributing

[Contributing guidelines to be added]