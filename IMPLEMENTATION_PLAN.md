# Claude Compass: AI-Native Development Environment

## Overview

This project implements a "closed loop" system that gives AI assistants the same contextual understanding that senior engineers carry mentally. Based on insights from production experience where AI suggestions looked elegant but broke hidden dependencies, this system creates a bridge between code reality and development intent.

## Problem Statement

AI assistants suffer from "context starvation" - they make decisions without understanding:
- Hidden dependencies and business context
- Blast radius of changes
- Framework-specific relationships
- Legacy system interactions
- Cross-cutting concerns

**Result**: Elegant-looking code that breaks critical batch jobs, APIs, and legacy import systems.

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

**Supported Languages & Frameworks (Initial):**
- **Python** (Django, FastAPI, Flask)
- **PHP** (Laravel)
- **C#** (Godot game engine)
- **JavaScript/TypeScript** (Vue.js, Node.js)

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

#### 3. Framework Graphs

**Route Graph:**
- **Nodes**: HTTP routes, controllers, middleware, services
- **Edges**: Route → handler → service → repository
- **Purpose**: Request flow understanding

**Dependency Injection Graph:**
- **Nodes**: Services, providers, consumers
- **Edges**: Provides/depends relationships
- **Purpose**: Runtime dependency tracking

**Job Graph:**
- **Nodes**: Jobs, queues, schedulers, handlers
- **Edges**: Trigger relationships, shared resources
- **Purpose**: Background processing flow

**ORM Graph:**
- **Nodes**: Entities, tables, relationships
- **Edges**: Foreign keys, associations, inheritance
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
  search_code(query: string, repo_id: string, topK?: number): {
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
  impact_of(change: {
    symbol_id?: string;
    file_path?: string;
    description: string;
  }): {
    affected_symbols: string[];
    affected_routes: string[];
    affected_jobs: string[];
    affected_tests: string[];
    confidence: number;
  };

  // External documentation search
  search_docs(query: string, pkg: string, version?: string): {
    results: {
      content: string;
      url: string;
      score: number;
    }[];
  };

  // Specification management
  diff_spec_vs_code(feature_id: string, repo_id: string): {
    missing_endpoints: string[];
    schema_drift: object[];
    unreferenced_code: string[];
    test_coverage_gaps: string[];
  };

  generate_reverse_prd(feature_id: string, repo_id: string): {
    prd: string;
    user_stories: string[];
    api_contract: object;
    db_schema: object;
  };
}
```

## Implementation Phases

### Phase 1: Core Foundation (Months 1-2)
**Goal**: Basic parsing and storage infrastructure

**Deliverables:**
- Tree-sitter integration for Python, PHP, C#, and JavaScript/TypeScript
- PostgreSQL schema setup with pgvector
- Basic file and symbol graph building
- Simple MCP server with `get_file` and `get_symbol` tools
- Command-line tool for repository analysis

**Success Criteria:**
- Can parse Python, Laravel, Godot, and Vue projects and extract file/symbol relationships
- MCP server responds to basic queries
- Database stores and retrieves parsed data efficiently

### Phase 2: Framework Analysis (Months 2-3)
**Goal**: Framework-aware parsing for web applications

**Deliverables:**
- Python Django/FastAPI route and view detection
- Laravel route and controller detection (web.php, api.php, controllers)
- Vue.js component and router analysis (pages/, components/, composables/)
- Godot C# scene and script relationships (*.tscn, *.cs files)
- Basic dependency injection graph for web frameworks
- `search_code` tool with lexical search
- Route mapping visualization

**Success Criteria:**
- Can map HTTP routes to handler functions in Python and Laravel
- Identifies Vue component dependencies and Godot scene relationships
- Search returns relevant results with file/line citations across all frameworks

### Phase 3: Advanced Graphs (Months 3-4)
**Goal**: Complete framework ecosystem understanding

**Deliverables:**
- Background job detection (Laravel queues, Celery tasks)
- ORM entity relationship mapping (Django ORM, Laravel Eloquent, SQLAlchemy)
- Test-to-code linkage (pytest, PHPUnit, Vue Test Utils, Godot test framework)
- Enhanced symbol relationships (inheritance, interfaces, traits, Vue composables)
- Godot scene hierarchy and signal connections
- `who_calls` and `list_dependencies` tools
- Package manager integration (pip, Composer, npm)

**Success Criteria:**
- Can trace data flow from HTTP request to database in web frameworks
- Identifies all consumers of a changed interface/class/trait/composable
- Maps Godot scene dependencies and signal flows
- Maps test coverage to business functionality

### Phase 4: AI-Powered Analysis (Months 4-5)
**Goal**: Semantic understanding and impact analysis

**Deliverables:**
- Vector embeddings for code and documentation
- AI-generated summaries for symbols/files/features
- `impact_of` tool with blast radius calculation
- Hybrid vector + lexical search
- Purpose, side effects, and invariant detection

**Success Criteria:**
- Can predict which code will break from a change
- Generates accurate summaries of code functionality
- Search understands semantic similarity, not just keywords

### Phase 5: Forward Specifications (Months 5-6)
**Goal**: Requirements → implementation workflow

**Deliverables:**
- Problem statement → PRD generation
- API contract generation from requirements
- Database schema generation from business rules
- Clickable prototype generation
- Spec-driven development workflow

**Success Criteria:**
- Can generate detailed specifications from feature requests
- Specifications provide clear implementation guidance
- Generated artifacts are technically accurate

### Phase 6: Sync & Drift Detection (Months 6-7)
**Goal**: Maintain spec-code alignment over time

**Deliverables:**
- Git hook integration for automatic re-indexing
- Spec vs. code comparison algorithms
- Drift detection and reporting
- Integration with issue tracking (GitHub, Jira)
- Automated spec update suggestions

**Success Criteria:**
- Detects when implemented features diverge from specifications
- Provides actionable recommendations for alignment
- Reduces manual effort to keep documentation current

### Phase 7: Advanced Framework Features (Months 7-8)
**Goal**: Deep framework-specific analysis and optimizations

**Deliverables:**
- Vue 3 Composition API advanced analysis (reactive dependencies, lifecycle hooks)
- Godot multiplayer and networking pattern detection
- Django admin interface auto-generation mapping
- Laravel service provider and facade pattern analysis
- Python async/await pattern detection
- Cross-framework API integration tracking

**Success Criteria:**
- Accurately maps Vue reactivity and component lifecycle dependencies
- Identifies Godot networking architecture and multiplayer patterns
- Tracks Laravel facades to underlying service implementations
- Maps Python async task dependencies and execution flows

### Phase 8: Enterprise Features (Months 8-9)
**Goal**: Production-ready deployment and scaling

**Deliverables:**
- Multi-tenant architecture
- Role-based access control
- Audit logging and compliance
- Horizontal scaling support
- Enterprise integrations (LDAP, SAML)

**Success Criteria:**
- Handles multiple teams and repositories securely
- Scales to enterprise-size codebases
- Meets security and compliance requirements

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
    type: 'texture' | 'audio' | 'scene' | 'script';
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
        type: 'ForeignKey' | 'ManyToMany' | 'OneToOne';
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
    type: 'function' | 'class';
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
    scope: 'function' | 'path' | 'global';
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
      visibility: 'public' | 'private' | 'protected';
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
      type: 'hasOne' | 'hasMany' | 'belongsTo' | 'belongsToMany';
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
```sql
-- Combine vector similarity with lexical matching
WITH vector_search AS (
  SELECT
    id, target_id, target_type,
    1 - (embedding <=> query_embedding) as vector_score
  FROM summaries
  WHERE embedding <=> query_embedding < 0.3
  ORDER BY embedding <=> query_embedding
  LIMIT 100
),
lexical_search AS (
  SELECT
    id, target_id, target_type,
    ts_rank(to_tsvector('english', purpose || ' ' || inputs || ' ' || outputs),
            plainto_tsquery('english', $1)) as lexical_score
  FROM summaries
  WHERE to_tsvector('english', purpose || ' ' || inputs || ' ' || outputs)
        @@ plainto_tsquery('english', $1)
  LIMIT 100
)
SELECT
  s.id, s.target_id, s.target_type,
  COALESCE(v.vector_score, 0) * 0.4 + COALESCE(l.lexical_score, 0) * 0.6 as final_score
FROM summaries s
LEFT JOIN vector_search v ON s.id = v.id
LEFT JOIN lexical_search l ON s.id = l.id
WHERE v.id IS NOT NULL OR l.id IS NOT NULL
ORDER BY final_score DESC;
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
describe('NextJSParser', () => {
  it('should detect API routes in pages directory', () => {
    const parser = new NextJSParser('/path/to/nextjs-project');
    const routes = parser.detectRoutes();

    expect(routes.apiRoutes).toContainEqual({
      path: '/api/users/[id]',
      filePath: 'pages/api/users/[id].ts',
      method: 'GET',
      handler: 'getUserById'
    });
  });
});
```

**Graph Building Tests:**
```typescript
describe('SymbolGraphBuilder', () => {
  it('should build correct call relationships', () => {
    const code = `
      function a() { b(); }
      function b() { c(); }
      function c() { return 42; }
    `;

    const graph = SymbolGraphBuilder.build(code);

    expect(graph.getDependencies('a')).toContain('b');
    expect(graph.getDependencies('b')).toContain('c');
    expect(graph.getCallers('c')).toContain('b');
  });
});
```

**Impact Analysis Tests:**
```typescript
describe('ImpactAnalysis', () => {
  it('should calculate correct blast radius', async () => {
    // Given a known codebase with documented dependencies
    const repo = await TestRepository.load('sample-nextjs-app');
    const analyzer = new ImpactAnalyzer(repo);

    // When analyzing impact of changing a core utility function
    const impact = await analyzer.calculateBlastRadius({
      symbol_id: 'utils/validation/validateEmail',
      change_type: 'signature_change'
    });

    // Then should identify all affected routes and components
    expect(impact.affected_routes).toContain('/api/auth/signup');
    expect(impact.affected_symbols).toContain('components/SignupForm');
    expect(impact.confidence).toBeGreaterThan(0.8);
  });
});
```

**MCP Integration Tests:**
```typescript
describe('MCP Server', () => {
  it('should respond to search_code requests', async () => {
    const server = new MCPServer();
    await server.initialize(testRepository);

    const response = await server.handleRequest({
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          query: 'user authentication',
          repo_id: 'test-repo'
        }
      }
    });

    expect(response.result).toHaveProperty('results');
    expect(response.result.results).toHaveLength(greaterThan(0));
    expect(response.result.results[0]).toHaveProperty('file_path');
    expect(response.result.results[0]).toHaveProperty('line_number');
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
version: '3.8'
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

## Risk Management

### Technical Risks
- **Parsing Accuracy**: Framework changes breaking detection logic
  - *Mitigation*: Automated testing, community contributions
- **Performance**: Large repositories causing slowdowns
  - *Mitigation*: Incremental processing, caching strategies
- **Accuracy**: AI-generated summaries being incorrect
  - *Mitigation*: Human review workflows, confidence scoring

### Business Risks
- **Competition**: Existing tools adding similar features
  - *Mitigation*: Focus on integration and user experience
- **Adoption**: Developers preferring manual processes
  - *Mitigation*: Gradual introduction, clear value demonstration
- **Privacy**: Concerns about code analysis and storage
  - *Mitigation*: Transparent privacy controls, local deployment options

### Operational Risks
- **Scalability**: Unable to handle growth in usage
  - *Mitigation*: Cloud-native architecture, horizontal scaling
- **Reliability**: System downtime affecting development workflows
  - *Mitigation*: High availability design, monitoring, SLAs
- **Security**: Code leakage or unauthorized access
  - *Mitigation*: Security audits, encryption, access controls

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

### Quick Start
```bash
# Clone and setup
git clone https://github.com/your-org/claude-compass
cd claude-compass
npm install

# Setup database
createdb claude_compass
psql claude_compass -c "CREATE EXTENSION vector;"
npm run migrate

# Index your first repository
npm run analyze -- --repo /path/to/your/nextjs-project

# Start MCP server
npm run mcp-server

# Connect with Claude Code
# Add MCP server configuration to your Claude Code settings
```

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