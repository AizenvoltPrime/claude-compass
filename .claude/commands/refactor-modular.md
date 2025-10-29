# Refactor: Modularize File into Functional Modules

You are an expert at refactoring monolithic files into well-organized functional modules following the established patterns in this codebase.

## Context

This codebase has successfully modularized several large files:

- `src/parsers/php.ts` → `src/parsers/php/` (16 modules)
- `src/parsers/javascript.ts` → `src/parsers/javascript/` (9 modules)
- `src/database/services.ts` → `src/database/services/` (23 modules)

## Your Task

Analyze the target file and perform modular refactoring following these principles:

### 1. Analysis Phase

First, analyze the target file to:

- Identify logical groupings of functions, classes, and types
- Detect common patterns and functional domains
- Measure file size and complexity metrics
- Identify dependencies between sections
- Determine if refactoring is warranted (>500 LOC typically)

### 2. Planning Phase

Create a detailed refactoring plan:

- Propose module structure with clear responsibilities
- Map existing code to proposed modules
- Identify shared dependencies and types
- Plan the migration order (types first, then implementations)
- Estimate risk level for each module

### 3. Module Categories

Organize modules by functional responsibility. Common patterns include:

**Type Definitions**

- `types.ts` - Core types, interfaces, enums, constants
- Should be the first module (no dependencies on other modules)
- Examples: type definitions, interface declarations, enums

**Utility Functions**

- `*-utils.ts` - Pure utility functions (no side effects)
- Examples from codebase: `signature-utils.ts`, `helper-utils.ts`, `validation-utils.ts`
- Group by functional area, not by similarity
- Keep utilities focused and cohesive

**Functional Domain Modules**

- Named by what they do, not how they do it
- Examples from codebase: `symbol-extractors.ts`, `dependency-extractors.ts`, `embedding-utils.ts`
- One module per conceptual domain
- Can be data processors, transformers, extractors, builders, etc.

**Service Modules**

- `*-service.ts` - Stateful services with business logic
- Examples from codebase: `repository-service.ts`, `search-service.ts`, `cache-management-service.ts`
- One service per domain aggregate
- Handle coordination, state management, complex workflows

**Specialized Modules**

- Domain-specific or context-specific functionality
- Examples from codebase: `framework-metadata-service.ts`, `impact-analysis-service.ts`
- Subdirectories for complex domains: `laravel/*.ts`, `vue/*.ts`, `php/*.ts`

### 4. Index File Structure

Create `index.ts` with organized exports:

```typescript
// Type definitions and constants
export * from './types';

// Utility modules
export * from './validation-utils';
export * from './helper-utils';

// Core domain modules
export * from './data-processor';
export * from './transformer';

// Service modules
export * from './business-service';

// Specialized modules
export * from './specialized-functionality';
```

### 5. Refactoring Rules

**CRITICAL: Follow these rules strictly**

1. **Preserve ALL functionality** - No behavior changes
2. **Maintain public API** - Consumers should not break
3. **No code rewrite** - Move code, don't refactor logic
4. **Test after each module** - Run tests incrementally
5. **Update imports incrementally** - Fix one consumer at a time
6. **Document breaking changes** - If API changes, document clearly

### 6. Module Design Principles

**Cohesion**

- Each module should have a single, clear responsibility
- Related functions stay together
- Minimize cross-module dependencies

**Naming**

- Use descriptive, consistent naming patterns
- Match existing patterns in codebase (`*-utils`, `*-service`)
- Avoid generic names like `helpers.ts`, `common.ts`, `misc.ts`
- Name by purpose: what the module does, not what it contains

**Size**

- Target 100-300 LOC per module
- Split modules that exceed 500 LOC
- Keep types modules under 200 LOC

**Dependencies**

- Types module: no internal dependencies
- Utils modules: depend only on types
- Domain modules: depend on types and utils
- Service modules: depend on types, utils, and domain modules
- Circular dependencies are PROHIBITED

### 7. Execution Steps

When refactoring:

1. **Create types module** first (`types.ts`)
   - Extract interfaces, types, enums, constants
   - No dependencies on other modules

2. **Create utility modules** (`*-utils.ts`)
   - Extract pure functions
   - Group by functional domain

3. **Create domain modules**
   - Extract core business logic by functional area
   - One file per conceptual domain
   - Name by purpose (what they do)

4. **Create service modules** (`*-service.ts`)
   - Extract stateful services and orchestration logic
   - One file per domain aggregate or workflow

5. **Create index.ts**
   - Re-export all modules with organized comments
   - Preserve original export structure

6. **Update imports in consumers**
   - Change from `./original-file` to `./original-file/`
   - TypeScript path resolution handles the rest

7. **Delete original file**
   - Only after all consumers are updated
   - Run full test suite first

### 8. Validation Checklist

Before completing:

- [ ] TypeScript compiles without errors (`npx tsc`)
- [ ] No circular dependencies detected
- [ ] All original exports are preserved
- [ ] Import paths are updated in all consumers
- [ ] Module sizes are reasonable (100-500 LOC)
- [ ] Index file has organized exports with comments
- [ ] No duplicate code across modules
- [ ] Documentation is updated if needed

## Interaction Model

Ask the user:

1. **Target file** - Which file to refactor?
2. **Automatic or guided** - Should I perform the refactoring or just provide a plan?
3. **Test after each step** - Should I run tests incrementally?

Then proceed with the chosen approach.

## Example Output Format

### Analysis Summary

```
File: src/domain/large-module.ts
Size: 1,250 LOC
Complexity: High
Dependencies: 18 imports

Recommended Modules:
1. types.ts (120 LOC) - Core type definitions
2. validation-utils.ts (180 LOC) - Validation functions
3. helper-utils.ts (200 LOC) - General utilities
4. data-processor.ts (280 LOC) - Data processing logic
5. transformer.ts (220 LOC) - Data transformation
6. business-service.ts (250 LOC) - Business logic
7. index.ts (40 LOC) - Re-exports

Risk Level: Medium
Estimated Time: 2-3 hours
Breaking Changes: None (if done correctly)
```

### Migration Plan

```
Phase 1: Create types.ts
- Extract interfaces, types, constants
- No dependencies

Phase 2: Create utility modules
- validation-utils.ts: Pure validation functions
- helper-utils.ts: General helper functions
- Test: npm test -- utils

Phase 3: Create domain modules
- data-processor.ts: Core processing logic
- transformer.ts: Data transformation
- Test: npm test -- domain

Phase 4: Create service modules
- business-service.ts: Stateful business logic
- Test: npm test -- service

Phase 5: Create index.ts and update imports
- Re-export all modules
- Update consumer imports
- Test: npm test (full suite)

... (continue with detailed steps)
```

Now analyze the user's target file and provide recommendations.

Target file: $ARGUMENTS
