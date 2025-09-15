# Claude Compass

> An AI-native development environment that solves the "context starvation" problem by giving AI assistants the same contextual understanding that senior engineers carry mentally.

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

**Sequential Implementation:**
- **Phase 1**: **JavaScript/TypeScript** (Vue.js, Next.js, React, Node.js)
- **Phase 2**: **PHP** (Laravel)
- **Phase 3**: **C#** (Godot game engine)
- **Phase 4**: **Python** (Django, FastAPI, Flask)

## Architecture

### Technology Stack
- **Parser**: Tree-sitter with language-specific grammars
- **Database**: PostgreSQL with pgvector extension
- **Search**: Hybrid vector embeddings + full-text search
- **MCP Server**: Node.js/TypeScript implementation

### Graph Types
- **File Graph**: Import/export relationships
- **Symbol Graph**: Function calls, inheritance, references
- **Framework Graphs**: Routes, dependency injection, jobs, ORM entities

## Quick Start

```bash
# Clone and setup
git clone https://github.com/your-org/claude-compass
cd claude-compass
npm install

# Setup database
createdb claude_compass
psql claude_compass -c "CREATE EXTENSION vector;"
npm run migrate

# Index your first repository (JavaScript/TypeScript projects supported first)
npm run analyze -- --repo /path/to/your/nextjs-project

# Start MCP server
npm run mcp-server

# Connect with Claude Code
# Add MCP server configuration to your Claude Code settings
```

## Development Phases

**Sequential Stack Implementation:**
1. **Phase 1**: JavaScript/TypeScript Foundation (Months 1-2)
2. **Phase 2**: JS/TS Framework Analysis (Months 2-3)
3. **Phase 3**: Advanced JS/TS Graphs (Months 3-4)
4. **Phase 4**: PHP Support (Months 4-5)
5. **Phase 5**: C# Support (Months 5-6)
6. **Phase 6**: Python Support (Months 6-7)
7. **Phase 7**: AI-Powered Analysis (Months 7-8)
8. **Phase 8**: Forward Specifications & Drift Detection (Months 8-9)

## Success Metrics

- **Time to understand new codebase**: < 2 hours (vs 2 days)
- **Bug introduction rate**: 50% reduction in breaking changes
- **Developer productivity**: 20% improvement in feature delivery
- **Documentation freshness**: 90% of specs match implementation

## License

[License information to be added]

## Contributing

[Contributing guidelines to be added]