# Claude Compass

> An AI-native development environment that solves the "context starvation" problem by giving AI assistants the same contextual understanding that senior engineers carry mentally.

**🎉 Phase 4 Complete!** - Advanced JavaScript/TypeScript and PHP/Laravel analysis with comprehensive framework support is ready for production use.

## What is Claude Compass?

Claude Compass creates a "closed loop" system between code reality and development intent. Instead of AI assistants making elegant-looking suggestions that break hidden dependencies, this system provides them with complete contextual understanding of your codebase.

## The Problem

AI assistants suffer from **context starvation** - they make decisions without understanding:
- Hidden dependencies and business context
- Blast radius of changes
- Framework-specific relationships
- Legacy system interactions
- Cross-cutting concerns

**Result**: Code that looks good but breaks critical batch jobs, APIs, and legacy systems.

## The Solution

### Core Capabilities

**🔍 Reverse-Map Reality from Code**
- Parse codebases with Tree-sitter
- Build multiple graph types (files, symbols, framework-specific)
- Generate dependency-aware summaries

**📋 Generate Forward Specifications**
- Transform problem statements into PRDs, user stories, schemas, prototypes
- Use as guardrails during implementation

**🔌 MCP Integration**
- Expose graphs and tools via Model Context Protocol
- Enable AI assistants to query ground truth instead of guessing

**🔄 Sync & Drift Detection**
- Monitor spec-to-code alignment
- Detect missing endpoints, schema drift, unreferenced code

### Supported Frameworks

**Sequential Implementation (Prioritized for Vue + Laravel + Godot):**
- **Phase 1**: ✅ **JavaScript/TypeScript Foundation** - **COMPLETED** with enhanced parser robustness
- **Phase 2**: ✅ **JavaScript/TypeScript Framework Analysis** (Vue.js, Next.js, React, Node.js) - **COMPLETED**
- **Phase 3**: ✅ **Advanced JavaScript/TypeScript Analysis** (Background jobs, test frameworks, ORM, packages, transitive analysis, monorepos) - **COMPLETED**
- **Phase 4**: ✅ **PHP/Laravel Support** (Laravel routes, Eloquent models, job queues) - **COMPLETED**
- **Phase 5**: **Vue ↔ Laravel Integration** (Cross-stack dependency tracking) - **NEXT PRIORITY**
- **Phase 6**: **AI-Powered Analysis** (Full-stack semantic understanding) - **HIGH PRIORITY**
- **Phase 7**: **Forward Specifications & Drift Detection** - **HIGH PRIORITY**
- **Phase 8**: **C#/Godot Support** (Game development) - **MEDIUM PRIORITY**

## Architecture

### Technology Stack
- **Parser**: Tree-sitter with language-specific grammars
- **Database**: PostgreSQL with pgvector extension
- **Search**: Hybrid vector embeddings + full-text search (RRF fusion)
- **Cache**: Redis for performance optimization
- **MCP Server**: Node.js/TypeScript implementation
- **Embeddings**: OpenAI Ada v2 or similar

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
npm run analyze /path/to/your/project

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
5. **Phase 5**: Vue ↔ Laravel Integration - **NEXT PRIORITY** (Cross-stack tracking)
6. **Phase 6**: AI-Powered Analysis - **HIGH PRIORITY** (Full-stack understanding)
7. **Phase 7**: Forward Specifications & Drift Detection - **HIGH PRIORITY**
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