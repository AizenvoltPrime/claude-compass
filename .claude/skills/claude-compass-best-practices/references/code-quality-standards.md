# Code Quality Standards

## Core Principle: No Fallback Logic

**NEVER implement fallback business logic, backwards compatibility, or lazy solutions.**

This is the foundational principle of Claude Compass development. Every decision should prioritize robust, well-designed code over quick fixes.

### What This Means in Practice

#### ❌ Avoid

**Fallback Mechanisms That Mask Issues**
```typescript
// BAD: Silent fallback that hides the real problem
function parseSymbol(node: any) {
  try {
    return extractSymbolData(node);
  } catch (error) {
    // Silent fallback - masks parsing issues
    return { name: 'unknown', type: 'unknown' };
  }
}
```

**Temporary Fixes**
```typescript
// BAD: Quick fix that will cause technical debt
function getDependencies(symbolId: number) {
  // TODO: Fix this properly later
  const deps = queryDatabase(symbolId);
  if (!deps) return []; // Temporary workaround
  return deps;
}
```

**Backward Compatibility Hacks**
```typescript
// BAD: Supporting old broken behavior
function analyzeRepository(path: string, options?: any) {
  // Support old option format for backward compatibility
  if (options?.legacyMode) {
    return legacyAnalyze(path);
  }
  return modernAnalyze(path);
}
```

#### ✅ Prefer

**Proper Error Handling**
```typescript
// GOOD: Explicit error handling with context
function parseSymbol(node: any): Symbol {
  try {
    return extractSymbolData(node);
  } catch (error) {
    throw new ParsingError(
      `Failed to parse symbol from node at line ${node.startPosition.row}`,
      { cause: error, node }
    );
  }
}
```

**Root Cause Solutions**
```typescript
// GOOD: Address the underlying issue
function getDependencies(symbolId: number): Dependency[] {
  const deps = queryDatabase(symbolId);

  if (!deps) {
    throw new DatabaseError(
      `Symbol ${symbolId} not found in database. Ensure the repository has been analyzed.`
    );
  }

  return deps;
}
```

**Breaking Changes When Necessary**
```typescript
// GOOD: Clean break, clear migration path
function analyzeRepository(path: string, options: AnalysisOptions): AnalysisResult {
  validateOptions(options);
  return performAnalysis(path, options);
}
```

## Self-Documenting Code

### Never Use Inline Comments

Inline comments are a code smell indicating unclear code. Instead, use clear naming and structure.

#### ❌ Avoid

```typescript
// BAD: Relies on comments to explain logic
function process(data: any) {
  // Check if data is valid
  if (!data) return null;

  // Extract the symbol name
  const name = data.name || 'unknown';

  // Clean up the name by removing special characters
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '');

  return cleaned;
}
```

#### ✅ Prefer

```typescript
// GOOD: Self-explanatory code structure
function extractCleanSymbolName(symbolData: SymbolData | null): string | null {
  if (!symbolData) {
    return null;
  }

  const rawName = symbolData.name || 'unknown';
  return removeSpecialCharacters(rawName);
}

function removeSpecialCharacters(text: string): string {
  return text.replace(/[^a-zA-Z0-9]/g, '');
}
```

### Documentation Comments

Use concise documentation comments for methods, classes, and properties to describe their **purpose**, not their implementation.

#### ✅ Correct Usage

```typescript
/**
 * Extracts all symbol dependencies from a TypeScript file using Tree-sitter.
 *
 * @param filePath - Absolute path to the TypeScript file
 * @param options - Parsing configuration options
 * @returns Array of dependency relationships found in the file
 * @throws ParsingError if the file cannot be parsed
 */
async function extractDependencies(
  filePath: string,
  options: ParsingOptions
): Promise<Dependency[]> {
  // Implementation
}
```

## Modularization Patterns

Claude Compass follows strict modularization principles for maintainability.

### Directory Structure

When modularizing a large file, follow these patterns:

```
src/parsers/
├── csharp/              # Language-specific parser (modularized)
│   ├── index.ts         # Public API exports
│   ├── parser.ts        # Main parsing logic
│   ├── symbol-extractor.ts
│   ├── dependency-analyzer.ts
│   └── types.ts         # Type definitions
│
├── framework-detector/   # Feature module (modularized)
│   ├── index.ts
│   ├── detector.ts
│   ├── feature-detection/
│   │   ├── laravel-detector.ts
│   │   ├── vue-detector.ts
│   │   └── react-detector.ts
│   └── types.ts
```

### Modularization Checklist

When breaking up a large file:

1. **Create a directory** with the same name as the original file (without extension)
2. **Create index.ts** that exports the public API (maintain backward compatibility)
3. **Split by responsibility** into focused, single-purpose modules
4. **Create types.ts** for shared type definitions
5. **Update imports** in files that depend on the modularized code
6. **Verify tests pass** after refactoring

## Error Handling Philosophy

### Fail Fast, Fail Loudly

Errors should be detected and reported as early as possible with maximum context.

```typescript
// GOOD: Validate early with clear error messages
function createMigration(name: string): void {
  if (!name) {
    throw new ValidationError('Migration name cannot be empty');
  }

  if (!/^\d{3}_[\w-]+$/.test(name)) {
    throw new ValidationError(
      `Migration name must match format: NNN_description (e.g., "001_add_users_table"). Got: "${name}"`
    );
  }

  // Proceed with creation
}
```

### Context-Rich Errors

Always include enough context to debug the issue without needing to reproduce it.

```typescript
// GOOD: Error includes all relevant context
class ChunkingError extends Error {
  constructor(
    message: string,
    public readonly context: {
      filePath: string;
      chunkIndex: number;
      totalChunks: number;
      startLine: number;
      endLine: number;
    }
  ) {
    super(message);
    this.name = 'ChunkingError';
  }
}

throw new ChunkingError(
  `Failed to parse chunk: syntax error in object literal`,
  {
    filePath: '/path/to/file.ts',
    chunkIndex: 3,
    totalChunks: 5,
    startLine: 250,
    endLine: 499
  }
);
```

## Type Safety

### Avoid `any`

The `any` type defeats TypeScript's purpose. Use proper types or `unknown` with type guards.

#### ❌ Avoid

```typescript
function processNode(node: any): any {
  return node.text;
}
```

#### ✅ Prefer

```typescript
import { SyntaxNode } from 'tree-sitter';

function processNode(node: SyntaxNode): string {
  return node.text;
}

// If type is truly unknown, use unknown with guards
function processUnknownData(data: unknown): string {
  if (!isValidNodeData(data)) {
    throw new ValidationError('Invalid node data structure');
  }
  return data.text;
}

function isValidNodeData(data: unknown): data is { text: string } {
  return typeof data === 'object'
    && data !== null
    && 'text' in data
    && typeof (data as any).text === 'string';
}
```

## Naming Conventions

### Be Explicit and Descriptive

Names should reveal intent without requiring comments or context.

```typescript
// BAD: Vague names
function parse(f: string) { }
const d = getData();
let temp = [];

// GOOD: Clear, descriptive names
function parseTypeScriptFile(filePath: string): ParsedSymbol[] { }
const dependencies = extractDependencies(symbol);
const unresolvedImports: string[] = [];
```

### Function Naming

- **Predicates**: `isValid`, `hasChildren`, `canParse`
- **Actions**: `extractSymbols`, `buildGraph`, `analyzeDependencies`
- **Queries**: `findSymbolById`, `getParentNode`, `fetchDependencies`

### File Naming

- **Modules**: `kebab-case.ts` (e.g., `symbol-extractor.ts`)
- **Tests**: `*.test.ts` (e.g., `symbol-extractor.test.ts`)
- **Types**: `types.ts` or `interfaces.ts`

## Testing Requirements

Every new feature or bug fix should include tests.

### Test Coverage Expectations

- **Parsers**: Test each language construct (classes, functions, imports, etc.)
- **Graph builders**: Test relationship detection and edge cases
- **Database operations**: Test CRUD operations and queries
- **MCP tools**: Integration tests for each tool

### Test Organization

```typescript
describe('CSharpParser', () => {
  describe('class parsing', () => {
    it('extracts simple class definitions', () => { });
    it('extracts class with inheritance', () => { });
    it('extracts nested classes', () => { });
  });

  describe('error handling', () => {
    it('throws ChunkingError for malformed syntax', () => { });
    it('includes context in error messages', () => { });
  });
});
```
