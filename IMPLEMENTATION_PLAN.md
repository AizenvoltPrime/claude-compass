# Claude Compass: AI-Native Development Environment

## Overview

This project implements a "closed loop" system that gives AI assistants the same contextual understanding that senior engineers carry mentally. Based on insights from production experience where AI suggestions looked elegant but broke hidden dependencies, this system creates a bridge between code reality and development intent.

## Problem Statement

**The core problem**: Claude Code isn't dumb, it's context-starved.

Picture this: You're thrown into a sprawling codebase with years of accumulated business logic and interconnected systems. Claude Code analyzes the files you show it and suggests clean, elegant code. You trust it. Then testing reveals the changes have unknowingly:

- Broken a critical batch job processing user data overnight
- Crashed the API that relied on a specific response format
- Interfered with a legacy import system handling 30% of enterprise customers

The code wasn't wrong in isolation. Claude Code just had no idea about the hidden dependencies and business context that make any real system tick.

AI assistants suffer from "context starvation" - they make decisions without understanding:

- Hidden dependencies and business context
- Blast radius of changes
- Framework-specific relationships
- Legacy system interactions
- Cross-cutting concerns

**Result**: Elegant-looking code that breaks critical systems in production.

## Solution Architecture

### Core Components

1. **Reverse-Map Reality from Code**

   - Parse codebases with Tree-sitter
   - Build multiple graph types (files, symbols, framework-specific)
   - Generate dependency-aware summaries

2. **Generate Forward Specifications**

   - Transform problem statements into PRDs, user stories, schemas, prototypes
   - Use as guardrails during implementation

3. **MCP Integration**

   - Expose graphs and tools via Model Context Protocol
   - Enable AI assistants to query ground truth instead of guessing

4. **Sync & Drift Detection**
   - Monitor spec-to-code alignment
   - Detect missing endpoints, schema drift, unreferenced code

## Technical Architecture

### Technology Stack

**Core Infrastructure:**

- **Parser**: Tree-sitter with language-specific grammars
- **Database**: PostgreSQL with pgvector extension
- **Search**: Hybrid vector embeddings + full-text search
- **MCP Server**: Node.js/TypeScript implementation
- **Vector Embeddings**: OpenAI Ada v2 or similar

**Supported Languages & Frameworks (Sequential Implementation):**

- **Phase 1**: **JavaScript/TypeScript** (Vue.js, Node.js, Next.js)
- **Phase 2**: **PHP** (Laravel)
- **Phase 3**: **C#** (Godot game engine)
- **Phase 4**: **Python** (Django, FastAPI, Flask)

### Database Schema

#### Core Entities

```sql
-- Repositories
CREATE TABLE repositories (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    path VARCHAR NOT NULL,
    language_primary VARCHAR,
    framework_stack JSONB,
    last_indexed TIMESTAMP,
    git_hash VARCHAR
);

-- Files
CREATE TABLE files (
    id SERIAL PRIMARY KEY,
    repo_id INTEGER REFERENCES repositories(id),
    path VARCHAR NOT NULL,
    language VARCHAR,
    size INTEGER,
    last_modified TIMESTAMP,
    git_hash VARCHAR,
    is_generated BOOLEAN DEFAULT FALSE,
    is_test BOOLEAN DEFAULT FALSE
);

-- Symbols (functions, classes, interfaces, etc.)
CREATE TABLE symbols (
    id SERIAL PRIMARY KEY,
    file_id INTEGER REFERENCES files(id),
    name VARCHAR NOT NULL,
    symbol_type VARCHAR, -- function, class, interface, variable
    start_line INTEGER,
    end_line INTEGER,
    is_exported BOOLEAN DEFAULT FALSE,
    visibility VARCHAR, -- public, private, protected
    signature TEXT
);

-- Dependencies between symbols
CREATE TABLE dependencies (
    id SERIAL PRIMARY KEY,
    from_symbol_id INTEGER REFERENCES symbols(id),
    to_symbol_id INTEGER REFERENCES symbols(id),
    dependency_type VARCHAR, -- calls, imports, inherits, implements
    line_number INTEGER,
    confidence FLOAT DEFAULT 1.0
);
```

#### Framework-Specific Entities

```sql
-- Web Routes
CREATE TABLE routes (
    id SERIAL PRIMARY KEY,
    repo_id INTEGER REFERENCES repositories(id),
    path VARCHAR NOT NULL,
    method VARCHAR, -- GET, POST, PUT, DELETE
    handler_symbol_id INTEGER REFERENCES symbols(id),
    middleware JSONB DEFAULT '[]',
    auth_required BOOLEAN DEFAULT FALSE
);

-- Dependency Injection
CREATE TABLE di_providers (
    id SERIAL PRIMARY KEY,
    repo_id INTEGER REFERENCES repositories(id),
    symbol_id INTEGER REFERENCES symbols(id),
    provides_type VARCHAR,
    scope VARCHAR, -- singleton, transient, scoped
    dependencies JSONB DEFAULT '[]'
);

-- Background Jobs
CREATE TABLE jobs (
    id SERIAL PRIMARY KEY,
    repo_id INTEGER REFERENCES repositories(id),
    symbol_id INTEGER REFERENCES symbols(id),
    trigger_type VARCHAR, -- cron, queue, event
    schedule VARCHAR,
    queue_name VARCHAR
);

-- ORM Entities
CREATE TABLE orm_entities (
    id SERIAL PRIMARY KEY,
    repo_id INTEGER REFERENCES repositories(id),
    symbol_id INTEGER REFERENCES symbols(id),
    table_name VARCHAR,
    relationships JSONB DEFAULT '{}'
);
```

#### Analysis & Specifications

```sql
-- AI-generated summaries
CREATE TABLE summaries (
    id SERIAL PRIMARY KEY,
    target_type VARCHAR, -- file, symbol, feature
    target_id INTEGER,
    purpose TEXT,
    inputs TEXT,
    outputs TEXT,
    side_effects TEXT,
    invariants TEXT,
    error_paths TEXT,
    test_coverage TEXT,
    embedding VECTOR(1536) -- for semantic search
);

-- Forward specifications
CREATE TABLE features (
    id SERIAL PRIMARY KEY,
    repo_id INTEGER REFERENCES repositories(id),
    name VARCHAR NOT NULL,
    description TEXT,
    prd_doc TEXT,
    user_stories JSONB DEFAULT '[]',
    api_contracts JSONB DEFAULT '{}',
    db_schema JSONB DEFAULT '{}',
    status VARCHAR DEFAULT 'planning' -- planning, in_progress, implemented, deprecated
);

-- Drift tracking
CREATE TABLE spec_drift (
    id SERIAL PRIMARY KEY,
    feature_id INTEGER REFERENCES features(id),
    drift_type VARCHAR, -- missing_endpoint, schema_change, unreferenced_code
    description TEXT,
    severity VARCHAR, -- low, medium, high, critical
    detected_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);
```

### Graph Types

#### 1. File Graph

- **Nodes**: Files
- **Edges**: Import/export relationships
- **Purpose**: Understand module dependencies

#### 2. Symbol Graph

- **Nodes**: Functions, classes, interfaces, variables
- **Edges**: Calls, inheritance, implementation, references
- **Purpose**: Code-level dependency tracking

#### 3. Framework Graphs (The Secret Sauce)

**This is the key differentiator** - while AST-only maps are too brittle for frameworks with "magic", framework-aware graphs capture the real relationships:

**Route Graph:**

- **Nodes**: HTTP routes, controllers, middleware, services
- **Edges**: Route → handler → service → repository
- **Purpose**: Request flow understanding (Web routes → controller/handler → service → repo)

**Dependency Injection Graph:**

- **Nodes**: Services, providers, consumers
- **Edges**: Provides/depends relationships (DI edges: providers/consumers)
- **Purpose**: Runtime dependency tracking

**Job Graph:**

- **Nodes**: Jobs, queues, schedulers, handlers
- **Edges**: Trigger relationships, shared resources (Jobs/schedulers: cron queues, listeners)
- **Purpose**: Background processing flow

**ORM Graph:**

- **Nodes**: Entities, tables, relationships
- **Edges**: Foreign keys, associations, inheritance (ORM entities: models↔tables)
- **Purpose**: Data model understanding

## MCP Integration

### MCP Resources (Read-Only Context)

```typescript
interface MCPResources {
  // Repository metadata
  "repo://files": {
    id: string;
    path: string;
    language: string;
    sha: string;
  }[];

  // Symbol definitions with location info
  "graph://symbols": {
    id: string;
    name: string;
    type: "function" | "class" | "interface" | "variable";
    file_path: string;
    start_line: number;
    end_line: number;
    signature?: string;
  }[];

  // Framework-specific graphs
  "graph://routes": {
    path: string;
    method: string;
    handler: string;
    middleware: string[];
  }[];

  "graph://di": {
    provider: string;
    provides: string;
    dependencies: string[];
    scope: string;
  }[];

  "graph://jobs": {
    name: string;
    trigger: string;
    schedule?: string;
    handler: string;
  }[];

  // AI-generated documentation
  "kb://summaries": {
    target: string;
    purpose: string;
    inputs: string;
    outputs: string;
    side_effects: string;
  }[];

  // External library documentation
  "docs://{pkg}@{version}": {
    content: string;
    source_url: string;
  }[];
}
```

### MCP Tools (Actions)

```typescript
interface MCPTools {
  // Code search with citations
  search_code(
    query: string,
    repo_id: string,
    topK?: number
  ): {
    results: {
      file_path: string;
      line_number: number;
      content: string;
      score: number;
    }[];
  };

  // Entity retrieval
  get_symbol(symbol_id: string): SymbolDetails;
  get_file(file_id: string): FileDetails;

  // Dependency analysis
  who_calls(symbol_id: string): {
    callers: {
      symbol_id: string;
      file_path: string;
      line_number: number;
    }[];
  };

  list_dependencies(symbol_id: string): {
    dependencies: {
      symbol_id: string;
      type: "calls" | "imports" | "inherits";
      file_path: string;
    }[];
  };

  // Impact analysis (blast radius)
  impact_of(change: { symbol_id?: string; file_path?: string; description: string }): {
    affected_symbols: string[];
    affected_routes: string[];
    affected_jobs: string[];
    affected_tests: string[];
    confidence: number;
  };

  // External documentation search
  search_docs(
    query: string,
    pkg: string,
    version?: string
  ): {
    results: {
      content: string;
      url: string;
      score: number;
    }[];
  };

  // Specification management
  diff_spec_vs_code(
    feature_id: string,
    repo_id: string
  ): {
    missing_endpoints: string[];
    schema_drift: object[];
    unreferenced_code: string[];
    test_coverage_gaps: string[];
  };

  generate_reverse_prd(
    feature_id: string,
    repo_id: string
  ): {
    prd: string;
    user_stories: string[];
    api_contract: object;
    db_schema: object;
  };
}
```

## Implementation Phases

**Sequential Stack Implementation Strategy**: Following the principle of "start with one stack", we implement language support in phases to ensure solid foundation and learnings from each stack before expanding.

### Phase 1: JavaScript/TypeScript Foundation (Months 1-2) ✅ COMPLETED

**Goal**: Basic parsing and storage infrastructure with JS/TS focus

**Deliverables:** ✅ ALL COMPLETED

- ✅ Tree-sitter integration for JavaScript/TypeScript
- ✅ PostgreSQL schema setup with pgvector
- ✅ Basic file and symbol graph building
- ✅ JavaScript/TypeScript import/export relationship mapping
- ✅ Simple MCP server with `get_file` and `get_symbol` tools
- ✅ Command-line tool for repository analysis

**Success Criteria:** ✅ ALL MET

- ✅ Can parse Vue.js, Next.js, and Node.js projects and extract file/symbol relationships
- ✅ Accurately maps ES6 imports, CommonJS requires, and dynamic imports
- ✅ MCP server responds to basic queries
- ✅ Database stores and retrieves parsed data efficiently

**Additional Enhancements Implemented:**
- ✅ Comprehensive MCP tools: `get_file`, `get_symbol`, `search_code`, `who_calls`, `list_dependencies`
- ✅ Advanced resource endpoints: repositories, file graph, symbol graph
- ✅ Production-ready error handling with JSON-RPC 2.0 compliance
- ✅ Runtime input validation for all MCP tools
- ✅ Graceful shutdown and database cleanup
- ✅ Session management and future HTTP transport support
- ✅ Docker compose setup with pgvector
- ✅ Complete database schema with migrations
- ✅ Comprehensive test framework setup
- ✅ CLI with analyze command and watch mode
- ✅ Logger implementation with component-specific logging

**Critical Parser & Analysis Improvements (September 2025):**
- ✅ **Smart Size Limit Handling**: Added Tree-sitter size limit detection (28K characters)
- ✅ **Chunked Parsing System**: Implemented robust chunked parsing for large files with size validation
- ✅ **Large File Support**: Files up to 20MB now parse successfully via chunked approach
- ✅ **Clean Re-Analysis**: Fixed data accumulation issue with proper cleanup on re-analysis
- ✅ **Database Cleanup**: Added `cleanupRepositoryData()` and `deleteRepositoryCompletely()` methods
- ✅ **Production Robustness**: Parser handles encoding issues, binary content, and malformed files
- ✅ **Bundle File Filtering**: Automatic filtering of minified and generated files
- ✅ **Comprehensive Logging**: Enhanced parser logs show chunking details and processing stats
- ✅ **Transaction Safety**: Database operations use proper transactions with foreign key respect
- ✅ **Encoding Recovery**: Advanced encoding detection and conversion pipeline

**Parser Robustness Enhancements:**
- ✅ **Content Validation**: Binary detection, encoding issue detection, null byte handling
- ✅ **Smart Error Recovery**: Parser continues processing when individual files fail
- ✅ **Batch Processing**: Symbol and dependency creation optimized for large codebases
- ✅ **Memory Management**: Signature truncation prevents PostgreSQL query size issues
- ✅ **File Size Policy**: Unified size management with configurable thresholds and actions
- ✅ **CompassIgnore Support**: GitIgnore-style patterns with automatic default filtering
- ✅ **Chunk Size Validation**: Iterative size reduction to ensure Tree-sitter compatibility

### Phase 2: JavaScript/TypeScript Framework Analysis (Months 2-3)

**Goal**: Framework-aware parsing for JavaScript/TypeScript applications

**Deliverables:**

- Vue.js component and router analysis (pages/, components/, composables/)
- Next.js pages and API routes detection (pages/, app/, api/)
- Node.js Express/Fastify route detection
- React component and hook analysis
- JavaScript/TypeScript dependency injection patterns
- `search_code` tool with lexical search
- Route mapping visualization for JS frameworks

**Success Criteria:**

- Can map HTTP routes to handler functions in Next.js and Node.js
- Identifies Vue/React component dependencies and composition patterns
- Detects Vue composables, React hooks, and Node.js middleware chains
- Search returns relevant results with file/line citations

### Phase 3: Advanced JavaScript/TypeScript Graphs (Months 3-4)

**Goal**: Complete JavaScript/TypeScript ecosystem understanding

**Deliverables:**

- Background job detection (Node.js worker threads, job queues)
- Database ORM mapping (Prisma, TypeORM, Sequelize relationships)
- Test-to-code linkage (Jest, Vitest, Cypress, Playwright)
- Enhanced symbol relationships (inheritance, interfaces, Vue composables, React hooks)
- Package manager integration (npm, yarn, pnpm dependencies)
- `who_calls` and `list_dependencies` tools
- Monorepo structure analysis (nx, lerna, turborepo)

**Success Criteria:**

- Can trace data flow from HTTP request to database in JS/TS frameworks
- Identifies all consumers of a changed interface/type/composable/hook
- Maps test coverage to business functionality
- Handles complex monorepo dependencies and workspace relationships

### Phase 4: PHP Support (Months 4-5)

**Goal**: Add Laravel/PHP framework support

**Deliverables:**

- Tree-sitter integration for PHP
- Laravel route and controller detection (web.php, api.php, controllers)
- Laravel Eloquent model relationship mapping
- Laravel service provider and dependency injection analysis
- Laravel job queue and scheduler detection
- Test-to-code linkage (PHPUnit)

**Success Criteria:**

- Can parse Laravel projects and extract routes, controllers, models
- Maps Laravel's service container and dependency injection
- Identifies Laravel jobs, queues, and scheduled tasks
- Handles Laravel-specific patterns (facades, service providers)

### Phase 5: C# Support (Months 5-6)

**Goal**: Add Godot/C# game engine support

**Deliverables:**

- Tree-sitter integration for C#
- Godot scene (.tscn) and script (.cs) relationships
- Godot signal system detection and connections
- Godot node hierarchy and resource dependencies
- Godot autoload and singleton pattern detection
- Game-specific testing frameworks integration

**Success Criteria:**

- Can parse Godot projects and map scenes to scripts
- Identifies signal connections and node relationships
- Maps resource usage and autoload dependencies
- Understands Godot-specific inheritance patterns

### Phase 6: Python Support (Months 6-7)

**Goal**: Add Django/FastAPI/Flask support

**Deliverables:**

- Tree-sitter integration for Python
- Django URL patterns and view detection
- Django model and ORM relationship mapping
- FastAPI route and dependency injection analysis
- Python async/await pattern detection
- Test-to-code linkage (pytest)

**Success Criteria:**

- Can parse Django projects and map URLs to views and models
- Identifies FastAPI routes, dependencies, and Pydantic models
- Maps Python async task dependencies and execution flows
- Handles Python-specific patterns (decorators, context managers)

### Phase 7: AI-Powered Analysis (Months 7-8)

**Goal**: Semantic understanding and impact analysis across all stacks

**Deliverables:**

- Vector embeddings for code and documentation
- AI-generated summaries for symbols/files/features
- `impact_of` tool with blast radius calculation
- Hybrid vector + lexical search
- Purpose, side effects, and invariant detection

**Success Criteria:**

- Can predict which code will break from a change across all languages
- Generates accurate summaries of code functionality
- Search understands semantic similarity, not just keywords

### Phase 8: Forward Specifications & Drift Detection (Months 8-9)

**Goal**: Requirements → implementation workflow and sync maintenance

**Deliverables:**

- Problem statement → PRD generation
- API contract generation from requirements
- Spec vs. code comparison algorithms
- Drift detection and reporting
- Git hook integration for automatic re-indexing
- Integration with issue tracking (GitHub, Jira)

**Success Criteria:**

- Can generate detailed specifications from feature requests
- Detects when implemented features diverge from specifications
- Provides actionable recommendations for alignment
- Reduces manual effort to keep documentation current

## Framework-Specific Parsers

### Vue.js Detection

```typescript
interface VueParser {
  detectComponents(): {
    name: string;
    filePath: string;
    props: {
      name: string;
      type: string;
      required: boolean;
      default?: any;
    }[];
    emits: string[];
    slots: string[];
    composables: string[]; // useComposable imports
    dependencies: string[]; // imported components
  }[];

  detectRoutes(): {
    // Vue Router routes
    routes: {
      path: string; // '/users/:id'
      component: string; // 'UserDetail.vue'
      name?: string;
      children?: string[];
      guards: string[]; // beforeEnter, meta.requiresAuth
    }[];

    // Nuxt pages/ directory routes
    pageRoutes?: {
      path: string;
      filePath: string; // pages/users/[id].vue
      layout?: string;
      middleware: string[];
    }[];
  };

  detectComposables(): {
    name: string;
    filePath: string; // composables/useAuth.js
    returns: string[];
    dependencies: string[];
    reactiveRefs: string[];
  }[];

  detectStores(): {
    name: string; // Pinia stores
    state: string[];
    getters: string[];
    actions: string[];
    dependencies: string[];
  }[];
}
```

### Godot C# Detection

```typescript
interface GodotParser {
  detectScenes(): {
    name: string;
    filePath: string; // scenes/Player.tscn
    rootNode: string;
    children: {
      name: string;
      type: string;
      script?: string;
    }[];
    signals: {
      name: string;
      parameters: string[];
      connections: {
        target: string;
        method: string;
      }[];
    }[];
  }[];

  detectScripts(): {
    name: string;
    filePath: string; // scripts/Player.cs
    extends: string; // Node2D, RigidBody2D
    exports: {
      name: string;
      type: string;
    }[];
    methods: {
      name: string;
      virtual: boolean; // _ready(), _process()
      signals: string[]; // EmitSignal calls
    }[];
    nodeReferences: string[]; // GetNode calls
  }[];

  detectAutoloads(): {
    name: string;
    script: string;
    singleton: boolean;
  }[];

  detectResources(): {
    type: "texture" | "audio" | "scene" | "script";
    filePath: string;
    usedBy: string[];
  }[];
}
```

### Django Detection

```typescript
interface DjangoParser {
  detectUrls(): {
    patterns: {
      pattern: string; // r'^users/(?P<id>\d+)/$'
      view: string; // views.UserDetailView
      name?: string; // url name
    }[];
    includes: string[]; // include() statements
  };

  detectModels(): {
    name: string;
    fields: {
      name: string;
      type: string;
      relationship?: {
        type: "ForeignKey" | "ManyToMany" | "OneToOne";
        target: string;
      };
    }[];
    meta: {
      dbTable?: string;
      ordering?: string[];
    };
  }[];

  detectViews(): {
    name: string;
    type: "function" | "class";
    methods?: string[]; // for class-based views
    permissions: string[];
    middleware: string[];
  }[];

  detectAdmin(): {
    model: string;
    admin_class: string;
    list_display: string[];
    search_fields: string[];
    filters: string[];
  }[];
}
```

### FastAPI Detection

```typescript
interface FastAPIParser {
  detectRoutes(): {
    path: string; // '/users/{user_id}'
    method: string; // GET, POST, etc.
    function_name: string;
    dependencies: string[]; // Depends() injections
    response_model?: string;
    tags: string[];
  }[];

  detectModels(): {
    name: string; // Pydantic models
    fields: {
      name: string;
      type: string;
      validation: string[];
    }[];
    inheritance: string[];
  }[];

  detectDependencies(): {
    name: string;
    function: string;
    dependencies: string[]; // nested dependencies
    scope: "function" | "path" | "global";
  }[];
}
```

### Laravel Detection

```typescript
interface LaravelParser {
  detectRoutes(): {
    // Route definitions from web.php, api.php
    routes: {
      method: string; // GET, POST, PUT, DELETE
      uri: string; // 'users/{id}'
      controller: string; // 'UserController@show'
      middleware: string[]; // ['auth', 'verified']
      name?: string; // route name
    }[];

    // Resource routes
    resourceRoutes: {
      resource: string; // 'users'
      controller: string; // 'UserController'
      only?: string[];
      except?: string[];
    }[];
  };

  detectControllers(): {
    name: string;
    namespace: string;
    methods: {
      name: string;
      visibility: "public" | "private" | "protected";
      parameters: string[];
      returnType?: string;
    }[];
    middleware: string[];
    traits: string[];
  }[];

  detectModels(): {
    name: string;
    table: string;
    fillable: string[];
    relationships: {
      type: "hasOne" | "hasMany" | "belongsTo" | "belongsToMany";
      related: string;
      method: string;
    }[];
    casts: Record<string, string>;
    traits: string[];
  }[];

  detectServices(): {
    name: string;
    namespace: string;
    bindings: {
      abstract: string;
      concrete: string;
      singleton: boolean;
    }[];
  };
}
```

## Search Implementation

### Hybrid Search Strategy

**Storage/Search**: Postgres + pgvector for embeddings; Full-Text Search (FTS) for keywords; simple Reciprocal Rank Fusion (RRF) to blend scores.

**Key principle**: Store per-symbol summaries in the DB; don't bury them in markdown wikis.

```sql
-- Combine vector similarity with lexical matching using RRF
WITH vector_search AS (
  SELECT
    id, target_id, target_type,
    1 - (embedding <=> query_embedding) as vector_score,
    ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) as vector_rank
  FROM summaries
  WHERE embedding <=> query_embedding < 0.3
  ORDER BY embedding <=> query_embedding
  LIMIT 100
),
lexical_search AS (
  SELECT
    id, target_id, target_type,
    ts_rank(to_tsvector('english', purpose || ' ' || inputs || ' ' || outputs),
            plainto_tsquery('english', $1)) as lexical_score,
    ROW_NUMBER() OVER (ORDER BY ts_rank(...) DESC) as lexical_rank
  FROM summaries
  WHERE to_tsvector('english', purpose || ' ' || inputs || ' ' || outputs)
        @@ plainto_tsquery('english', $1)
  LIMIT 100
)
SELECT
  s.id, s.target_id, s.target_type,
  -- Simple RRF: 1/(k + rank) where k=60
  (1.0 / (60 + COALESCE(v.vector_rank, 100))) +
  (1.0 / (60 + COALESCE(l.lexical_rank, 100))) as rrf_score
FROM summaries s
LEFT JOIN vector_search v ON s.id = v.id
LEFT JOIN lexical_search l ON s.id = l.id
WHERE v.id IS NOT NULL OR l.id IS NOT NULL
ORDER BY rrf_score DESC;
```

## Impact Analysis Algorithm

### Blast Radius Calculation

```typescript
interface ImpactAnalysis {
  calculateBlastRadius(change: ChangeDescription): BlastRadius {
    const affected = new Set<string>();

    // Direct dependencies
    const directDeps = this.getDependencies(change.symbol_id);
    directDeps.forEach(dep => affected.add(dep));

    // Transitive dependencies (with depth limit)
    const transitiveDeps = this.getTransitiveDependencies(change.symbol_id, 3);
    transitiveDeps.forEach(dep => affected.add(dep));

    // Framework-specific impacts
    if (change.type === 'api_change') {
      const routeImpacts = this.getRouteImpacts(change.symbol_id);
      routeImpacts.forEach(route => affected.add(route));
    }

    if (change.type === 'database_change') {
      const ormImpacts = this.getORMImpacts(change.symbol_id);
      ormImpacts.forEach(entity => affected.add(entity));
    }

    // Test coverage analysis
    const testImpacts = this.getTestImpacts(Array.from(affected));

    return {
      affected_symbols: Array.from(affected),
      affected_routes: this.getAffectedRoutes(affected),
      affected_jobs: this.getAffectedJobs(affected),
      affected_tests: testImpacts,
      confidence: this.calculateConfidence(change, affected)
    };
  }

  private calculateConfidence(
    change: ChangeDescription,
    affected: Set<string>
  ): number {
    // Higher confidence for well-tested, documented code
    // Lower confidence for dynamic code, reflection, etc.
    let baseConfidence = 0.8;

    if (change.involves_dynamic_code) baseConfidence *= 0.6;
    if (change.has_test_coverage) baseConfidence *= 1.2;
    if (change.is_well_documented) baseConfidence *= 1.1;

    return Math.min(baseConfidence, 1.0);
  }
}
```

## Specification Generation

### PRD Generation Template

```typescript
interface PRDGenerator {
  generatePRD(problemStatement: string): ProductRequirementDocument {
    const analysis = this.analyzeProblemStatement(problemStatement);

    return {
      title: analysis.feature_name,
      overview: analysis.business_value,
      userStories: this.generateUserStories(analysis),
      acceptanceCriteria: this.generateAcceptanceCriteria(analysis),
      apiContract: this.generateAPIContract(analysis),
      databaseSchema: this.generateDatabaseSchema(analysis),
      testPlan: this.generateTestPlan(analysis),
      risks: this.identifyRisks(analysis),
      timeline: this.estimateTimeline(analysis)
    };
  }

  private generateUserStories(analysis: ProblemAnalysis): UserStory[] {
    return analysis.user_personas.map(persona => ({
      persona: persona.role,
      want: persona.goal,
      so_that: persona.benefit,
      acceptance_criteria: this.generateAcceptanceCriteria(persona)
    }));
  }

  private generateAPIContract(analysis: ProblemAnalysis): OpenAPISpec {
    return {
      openapi: '3.0.0',
      paths: analysis.endpoints.reduce((paths, endpoint) => {
        paths[endpoint.path] = {
          [endpoint.method.toLowerCase()]: {
            summary: endpoint.description,
            parameters: endpoint.parameters,
            requestBody: endpoint.request_schema,
            responses: endpoint.response_schemas
          }
        };
        return paths;
      }, {} as any)
    };
  }
}
```

## Testing Strategy

### Test Pyramid

```
┌─────────────────────────────┐
│         E2E Tests           │ ← Full workflow testing
│    (Repository Analysis)    │
├─────────────────────────────┤
│      Integration Tests      │ ← MCP + Database + Search
│   (Component Interactions)  │
├─────────────────────────────┤
│        Unit Tests           │ ← Parser logic, algorithms
│   (Individual Functions)    │
└─────────────────────────────┘
```

### Test Categories

**Parser Correctness Tests:**

```typescript
describe("NextJSParser", () => {
  it("should detect API routes in pages directory", () => {
    const parser = new NextJSParser("/path/to/nextjs-project");
    const routes = parser.detectRoutes();

    expect(routes.apiRoutes).toContainEqual({
      path: "/api/users/[id]",
      filePath: "pages/api/users/[id].ts",
      method: "GET",
      handler: "getUserById",
    });
  });
});
```

**Graph Building Tests:**

```typescript
describe("SymbolGraphBuilder", () => {
  it("should build correct call relationships", () => {
    const code = `
      function a() { b(); }
      function b() { c(); }
      function c() { return 42; }
    `;

    const graph = SymbolGraphBuilder.build(code);

    expect(graph.getDependencies("a")).toContain("b");
    expect(graph.getDependencies("b")).toContain("c");
    expect(graph.getCallers("c")).toContain("b");
  });
});
```

**Impact Analysis Tests:**

```typescript
describe("ImpactAnalysis", () => {
  it("should calculate correct blast radius", async () => {
    // Given a known codebase with documented dependencies
    const repo = await TestRepository.load("sample-nextjs-app");
    const analyzer = new ImpactAnalyzer(repo);

    // When analyzing impact of changing a core utility function
    const impact = await analyzer.calculateBlastRadius({
      symbol_id: "utils/validation/validateEmail",
      change_type: "signature_change",
    });

    // Then should identify all affected routes and components
    expect(impact.affected_routes).toContain("/api/auth/signup");
    expect(impact.affected_symbols).toContain("components/SignupForm");
    expect(impact.confidence).toBeGreaterThan(0.8);
  });
});
```

**MCP Integration Tests:**

```typescript
describe("MCP Server", () => {
  it("should respond to search_code requests", async () => {
    const server = new MCPServer();
    await server.initialize(testRepository);

    const response = await server.handleRequest({
      method: "tools/call",
      params: {
        name: "search_code",
        arguments: {
          query: "user authentication",
          repo_id: "test-repo",
        },
      },
    });

    expect(response.result).toHaveProperty("results");
    expect(response.result.results).toHaveLength(greaterThan(0));
    expect(response.result.results[0]).toHaveProperty("file_path");
    expect(response.result.results[0]).toHaveProperty("line_number");
  });
});
```

## Performance Requirements

### Scalability Targets

- **Repository Size**: Up to 1M lines of code
- **Parse Time**: < 5 minutes for full analysis
- **Search Response**: < 500ms for typical queries
- **Memory Usage**: < 4GB for largest repositories
- **Concurrent Users**: 50+ developers simultaneously

### Optimization Strategies

- **Incremental Parsing**: Only re-process changed files
- **Caching**: Cache expensive operations (embeddings, summaries)
- **Indexing**: Optimize database queries with proper indexes
- **Batch Processing**: Group similar operations
- **Streaming**: Stream large results instead of loading in memory

## Security Considerations

### Data Protection

- **Code Isolation**: Sandbox execution environments
- **Access Control**: Role-based repository access
- **Audit Logging**: Track all code analysis and queries
- **Encryption**: Encrypt sensitive code at rest and in transit

### Privacy Controls

- **Sensitive Data**: Detect and exclude secrets, credentials, PII
- **Compliance**: Support GDPR, SOC2, HIPAA requirements
- **Data Retention**: Configurable retention policies
- **Anonymization**: Option to anonymize code samples

## Monitoring & Observability

### Key Metrics

```typescript
interface SystemMetrics {
  // Performance metrics
  parse_duration_seconds: number;
  search_response_time_ms: number;
  graph_build_time_seconds: number;

  // Quality metrics
  parse_success_rate: number;
  search_relevance_score: number;
  impact_analysis_accuracy: number;

  // Usage metrics
  daily_active_users: number;
  queries_per_minute: number;
  repositories_indexed: number;

  // Business metrics
  developer_onboarding_time_hours: number;
  production_bugs_prevented: number;
  refactoring_time_saved_hours: number;
}
```

### Health Checks

- Database connectivity and performance
- MCP server responsiveness
- Parser success rates by language
- Search index freshness
- Memory and CPU utilization

## Deployment Architecture

### Infrastructure Components

```yaml
# Docker Compose example
version: "3.8"
services:
  # Core application
  claude-compass:
    build: .
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres:5432/claude_compass
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - postgres
      - redis

  # Database with vector support
  postgres:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_DB: claude_compass
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Caching layer
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  # MCP Server
  mcp-server:
    build: ./mcp-server
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres:5432/claude_compass
    ports:
      - "3000:3000"
```

### Deployment Options

**1. Self-Hosted (Enterprise)**

- Full control over code and data
- Deploy on-premises or private cloud
- Custom security and compliance controls

**2. Cloud SaaS (Teams)**

- Multi-tenant architecture
- Automatic scaling and updates
- Pay-per-repository pricing

**3. Hybrid (Large Organizations)**

- Local parsing for sensitive code
- Cloud analytics and search
- Federated across multiple locations

**4. Desktop (Individual Developers)**

- Local-only processing
- No network dependencies
- Integration with local editors

## Business Model & Pricing

### Target Market Segments

**Individual Developers ($9/month)**

- Personal repositories only
- Basic framework support
- Local processing

**Small Teams ($29/user/month)**

- Up to 10 repositories
- Advanced framework support
- Cloud processing and search
- Team collaboration features

**Enterprise ($199/user/month)**

- Unlimited repositories
- Multi-language support
- On-premises deployment
- Advanced security and compliance
- Custom integrations

### ROI Justification

**Cost Savings:**

- Reduced debugging time: 2-4 hours/developer/week
- Faster onboarding: 50% reduction in ramp-up time
- Fewer production incidents: 30% reduction in bugs
- Improved code reviews: 25% faster review cycles

**Revenue Impact:**

- Faster feature delivery: 15% improvement in velocity
- Better code quality: Reduced technical debt
- Developer satisfaction: Lower turnover costs

## What Didn't Work (Lessons Learned)

**Critical insights from real-world implementation - don't repeat these mistakes:**

### Technical Approaches That Failed

**AST-only maps**: Too brittle for frameworks with "magic" - you need route/DI/job/entity extraction beyond pure syntax analysis. Frameworks like Laravel, Django, and Next.js use conventions and runtime magic that ASTs can't capture.

**Search without structure**: Embeddings alone return nice snippets but miss the blast radius. You need the graph relationships to understand "what breaks if I change this?"

**Docs-only approach**: Forward specs are necessary, but without reverse understanding of the actual codebase, they drift immediately and become useless.

### Current Limitations (Work in Progress)

**Dynamic code**: Reflection, dynamic imports, and runtime-generated code still need a light runtime trace mode to capture relationships that static analysis misses.

**Monorepo boundaries**: Scale is manageable, but ownership boundaries (who owns what edge) need clear policies and tooling.

**Test linkage**: Mapping tests → stories → routes works well, but flaky test detection tied to impact analysis is still WIP.

### Why "Better Prompts" Wasn't Enough

Without structure (graphs, edges, summaries) and proper distribution (MCP), prompts just push the guessing problem upstream. The model needs the same structured context that a senior engineer carries in their head - not just more words.

## Risk Management

### Technical Risks

- **Parsing Accuracy**: Framework changes breaking detection logic
  - _Mitigation_: Automated testing, community contributions
- **Performance**: Large repositories causing slowdowns
  - _Mitigation_: Incremental processing, caching strategies
- **Accuracy**: AI-generated summaries being incorrect
  - _Mitigation_: Human review workflows, confidence scoring

### Business Risks

- **Competition**: Existing tools adding similar features
  - _Mitigation_: Focus on integration and user experience
- **Adoption**: Developers preferring manual processes
  - _Mitigation_: Gradual introduction, clear value demonstration
- **Privacy**: Concerns about code analysis and storage
  - _Mitigation_: Transparent privacy controls, local deployment options

### Operational Risks

- **Scalability**: Unable to handle growth in usage
  - _Mitigation_: Cloud-native architecture, horizontal scaling
- **Reliability**: System downtime affecting development workflows
  - _Mitigation_: High availability design, monitoring, SLAs
- **Security**: Code leakage or unauthorized access
  - _Mitigation_: Security audits, encryption, access controls

## Success Metrics

### Developer Experience

- Time to understand new codebase: < 2 hours (vs 2 days)
- Confidence in refactoring: 90% of developers feel confident
- Bug introduction rate: 50% reduction in breaking changes
- Documentation freshness: 90% of specs match implementation

### System Performance

- Parse accuracy: 95% of relationships correctly identified
- Search relevance: 85% of queries return useful results
- Response time: 95% of queries under 500ms
- Availability: 99.9% uptime SLA

### Business Impact

- Developer productivity: 20% improvement in feature delivery
- Code quality: 30% reduction in technical debt
- Team onboarding: 50% faster new developer productivity
- Customer satisfaction: Fewer bugs reaching production

## Future Enhancements

### Advanced Features (Year 2)

- **Runtime Tracing**: Dynamic analysis for reflection-heavy code
- **Multi-Repository**: Cross-service dependency tracking
- **Performance Analysis**: Identify performance bottlenecks
- **Security Analysis**: Detect security vulnerabilities

### AI Improvements (Year 2-3)

- **Custom Models**: Fine-tuned embeddings for code domains
- **Code Generation**: Generate implementations from specs
- **Automated Refactoring**: Suggest and implement improvements
- **Intelligent Testing**: Generate test cases from specifications

### Integration Ecosystem (Year 3+)

- **IDE Extensions**: Deep integration with VS Code, IntelliJ, etc.
- **CI/CD Pipelines**: Automated analysis in build processes
- **Project Management**: Integration with Jira, Linear, Asana
- **Documentation**: Automatic docs generation and updates

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 15+ with pgvector extension
- Git repositories to analyze
- OpenAI API key (for embeddings)

### Quick Start (Recommended Approach)

**If you want to try something similar, follow this battle-tested approach:**

```bash
# 1. Start with one stack (e.g., Vue.js, Next.js + NestJS or Django or Spring)
git clone https://github.com/your-org/claude-compass
cd claude-compass
npm install

# 2. Setup database with vector support
createdb claude_compass
psql claude_compass -c "CREATE EXTENSION vector;"
npm run migrate

# 3. Build 3 edges first - this is 80% of "what breaks if..."
# - Routes (HTTP endpoints → handlers)
# - DI/beans/providers (dependency injection)
# - Jobs/schedulers (background tasks)
npm run analyze -- --repo /path/to/your/project --focus=routes,di,jobs

# 4. Add your first MCP tools
npm run mcp-server

# 5. Wire the server into AI client early so you feel the UX
# Add MCP server configuration to your Claude Code settings
```

**Key principle**: Get search_code, who_calls, and impact_of working first. Store per-symbol summaries in the DB from day one.

### Development Environment

```bash
# Install development dependencies
npm install --save-dev

# Run tests
npm test

# Run with hot reload
npm run dev

# Run linting
npm run lint

# Build for production
npm run build
```

This comprehensive plan provides the foundation for building Claude Compass - an AI-native development environment that solves the context starvation problem by creating a closed loop between code reality and development intent.
