# Claude Compass

> A dependency analysis development environment that solves the "context gap" problem by providing AI assistants with complete contextual understanding of codebases.

**🎉 Phase 5 Complete!** - Advanced JavaScript/TypeScript, PHP/Laravel, and Vue ↔ Laravel cross-stack analysis with comprehensive framework support is ready for production use.

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

**Sequential Implementation (Prioritized for Vue + Laravel + Godot):**
- **Phase 1**: ✅ **JavaScript/TypeScript Foundation** - **COMPLETED** with enhanced parser robustness
- **Phase 2**: ✅ **JavaScript/TypeScript Framework Analysis** (Vue.js, Next.js, React, Node.js) - **COMPLETED**
- **Phase 3**: ✅ **Advanced JavaScript/TypeScript Analysis** (Background jobs, test frameworks, ORM, packages, transitive analysis, monorepos) - **COMPLETED**
- **Phase 4**: ✅ **PHP/Laravel Support** (Laravel routes, Eloquent models, job queues) - **COMPLETED**
- **Phase 5**: ✅ **Vue ↔ Laravel Integration** (Cross-stack dependency tracking, API mapping, full-stack impact analysis) - **COMPLETED**
- **Phase 6**: **Enhanced Impact Analysis** (Comprehensive blast radius and enhanced search) - **NEXT PRIORITY**
- **Phase 7**: **Specification Tracking & Drift Detection** - **HIGH PRIORITY**
- **Phase 8**: **C#/Godot Support** (Game development) - **MEDIUM PRIORITY**

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

# Analyze your codebase (JavaScript/TypeScript or PHP/Laravel)
npm run analyze .                              # Analyze current directory
npm run analyze /path/to/your/project          # Analyze specific path
npm run analyze . --force-full                 # Force full analysis (clears existing data)

# Clear existing repository analysis
./dist/src/cli/index.js clear <repository-name> --yes

# Start MCP server for AI integration
npm run mcp-server

# Test framework detection and parsing
npm test
```

**📚 For detailed setup instructions, troubleshooting, and advanced features, see [GETTING_STARTED.md](./GETTING_STARTED.md)**

## Development Phases

**Prioritized Implementation for Vue + Laravel + Godot:**
1. ✅ **Phase 1**: JavaScript/TypeScript Foundation - **COMPLETED**
2. ✅ **Phase 2**: JS/TS Framework Analysis - **COMPLETED**
3. ✅ **Phase 3**: Advanced JS/TS Analysis - **COMPLETED** (Background jobs, test frameworks, ORM, packages, transitive analysis, monorepos)
4. ✅ **Phase 4**: PHP/Laravel Support - **COMPLETED** (Routes, Eloquent, jobs, service providers)
5. ✅ **Phase 5**: Vue ↔ Laravel Integration - **COMPLETED** (Cross-stack tracking, API mapping, full-stack impact analysis)
6. **Phase 6**: Enhanced Impact Analysis - **NEXT PRIORITY** (Comprehensive blast radius and enhanced search)
7. **Phase 7**: Specification Tracking & Drift Detection - **HIGH PRIORITY**
8. **Phase 8**: C#/Godot Support - **MEDIUM PRIORITY** (Game development)

**📋 See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for detailed roadmap and technical specifications.**

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