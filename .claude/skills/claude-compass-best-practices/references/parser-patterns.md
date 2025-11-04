# Parser Development Patterns

## Adding Language Support

Follow this exact sequence when adding support for a new programming language.

### 1. Add Tree-sitter Grammar Dependency

```bash
npm install tree-sitter-<language>
```

Update `package.json` to include the grammar package.

### 2. Create Parser Module

Create a new parser file in `src/parsers/<language>.ts` or modularize into `src/parsers/<language>/`.

#### Simple Parser (Single File)

Use for straightforward languages with limited complexity:

```typescript
// src/parsers/go.ts
import Parser from 'tree-sitter';
import Go from 'tree-sitter-go';
import { Symbol, Dependency } from '../types';

export async function parseGoFile(filePath: string, content: string): Promise<{
  symbols: Symbol[];
  dependencies: Dependency[];
}> {
  const parser = new Parser();
  parser.setLanguage(Go);

  const tree = parser.parse(content);
  const symbols = extractSymbols(tree.rootNode, filePath);
  const dependencies = extractDependencies(tree.rootNode, filePath);

  return { symbols, dependencies };
}
```

#### Modularized Parser (Directory Structure)

Use for complex languages (C#, PHP, TypeScript):

```
src/parsers/rust/
├── index.ts                    # Public API
├── parser.ts                   # Main parsing orchestration
├── symbol-extractor.ts         # Symbol extraction logic
├── dependency-analyzer.ts      # Dependency detection
├── trait-resolver.ts           # Language-specific features
├── chunking-strategy.ts        # Large file handling
└── types.ts                    # Parser-specific types
```

### 3. Implement Chunking Strategy (If Needed)

For languages that commonly have large files, implement chunking to handle files >100KB.

```typescript
export interface ChunkingStrategy {
  shouldChunk(fileSize: number): boolean;
  splitIntoChunks(content: string, filePath: string): Chunk[];
  mergeChunks(chunks: ParsedChunk[]): ParseResult;
}

export class TypeScriptChunkingStrategy implements ChunkingStrategy {
  private readonly CHUNK_SIZE = 500; // lines

  shouldChunk(fileSize: number): boolean {
    return fileSize > 100_000; // 100KB
  }

  splitIntoChunks(content: string, filePath: string): Chunk[] {
    const lines = content.split('\n');

    if (lines.length <= this.CHUNK_SIZE) {
      return [{ content, startLine: 1, endLine: lines.length }];
    }

    return this.splitAtTopLevelBoundaries(lines, filePath);
  }

  private splitAtTopLevelBoundaries(lines: string[], filePath: string): Chunk[] {
    // Split at class/function boundaries, not arbitrary line counts
  }
}
```

### 4. Add Comprehensive Tests

Create `tests/parsers/<language>.test.ts` with test cases for:

#### Basic Constructs
```typescript
describe('RustParser', () => {
  describe('function parsing', () => {
    it('extracts simple function definitions', () => {
      const code = `
        fn calculate_sum(a: i32, b: i32) -> i32 {
          a + b
        }
      `;

      const result = parseRustFile('test.rs', code);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0]).toMatchObject({
        name: 'calculate_sum',
        type: 'function',
        signature: 'fn calculate_sum(a: i32, b: i32) -> i32'
      });
    });
  });
});
```

#### Error Handling
```typescript
describe('error handling', () => {
  it('throws ChunkingError with context for malformed code', () => {
    const malformedCode = `
      fn broken( {
        // Missing parameters
      }
    `;

    expect(() => parseRustFile('test.rs', malformedCode))
      .toThrow(ChunkingError);

    try {
      parseRustFile('test.rs', malformedCode);
    } catch (error) {
      expect(error.context).toMatchObject({
        filePath: 'test.rs',
        chunkIndex: expect.any(Number),
      });
    }
  });
});
```

#### Framework-Specific Features
```typescript
describe('framework detection', () => {
  it('identifies Rocket web framework routes', () => {
    const code = `
      #[get("/users/<id>")]
      fn get_user(id: i32) -> Json<User> {
        // ...
      }
    `;

    const result = parseRustFile('routes.rs', code);

    expect(result.symbols[0].metadata?.isRoute).toBe(true);
    expect(result.symbols[0].metadata?.routePath).toBe('/users/<id>');
  });
});
```

### 5. Register in Multi-Parser

Update `src/parsers/multi-parser.ts` or `src/parsers/index.ts` to include the new language:

```typescript
import { parseRustFile } from './rust';

const LANGUAGE_PARSERS = {
  '.rs': parseRustFile,
  '.ts': parseTypeScriptFile,
  '.php': parsePHPFile,
  '.cs': parseCSharpFile,
  // ...
};

export async function parseFile(filePath: string): Promise<ParseResult> {
  const extension = path.extname(filePath);
  const parser = LANGUAGE_PARSERS[extension];

  if (!parser) {
    throw new UnsupportedLanguageError(
      `No parser available for file extension: ${extension}`
    );
  }

  const content = await fs.readFile(filePath, 'utf-8');
  return parser(filePath, content);
}
```

## Tree-sitter Best Practices

### Cursor-Based Traversal

Use Tree-sitter cursors for efficient tree traversal:

```typescript
function extractSymbols(rootNode: SyntaxNode, filePath: string): Symbol[] {
  const symbols: Symbol[] = [];
  const cursor = rootNode.walk();

  // Depth-first traversal
  let reachedRoot = false;

  while (!reachedRoot) {
    const node = cursor.currentNode();

    if (isSymbolNode(node)) {
      symbols.push(extractSymbolFromNode(node, filePath));
    }

    if (cursor.gotoFirstChild()) {
      continue;
    }

    if (cursor.gotoNextSibling()) {
      continue;
    }

    let ascending = true;
    while (ascending) {
      if (!cursor.gotoParent()) {
        reachedRoot = true;
        ascending = false;
      } else if (cursor.gotoNextSibling()) {
        ascending = false;
      }
    }
  }

  return symbols;
}
```

### Query-Based Extraction

For specific patterns, use Tree-sitter queries:

```typescript
const FUNCTION_QUERY = `
  (function_declaration
    name: (identifier) @function-name
    parameters: (formal_parameters) @params
    return_type: (type_annotation)? @return-type
  ) @function
`;

function extractFunctionsWithQuery(rootNode: SyntaxNode): Symbol[] {
  const query = parser.getLanguage().query(FUNCTION_QUERY);
  const matches = query.matches(rootNode);

  return matches.map(match => {
    const nameNode = match.captures.find(c => c.name === 'function-name');
    const paramsNode = match.captures.find(c => c.name === 'params');

    return {
      name: nameNode?.node.text || 'anonymous',
      type: 'function',
      parameters: parseParameters(paramsNode?.node),
      // ...
    };
  });
}
```

### Node Type Identification

Always check node types before extracting data:

```typescript
function isSymbolNode(node: SyntaxNode): boolean {
  const SYMBOL_NODE_TYPES = [
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
  ];

  return SYMBOL_NODE_TYPES.includes(node.type);
}
```

## Debugging Parser Issues

### Enable Debug Logging

```bash
CLAUDE_COMPASS_DEBUG=true ./dist/src/cli/index.js analyze /path --verbose
```

### Debug Single File Parsing

For focused debugging during parser development:

```bash
./dist/src/cli/index.js analyze /path/to/repo \
  --debug-file relative/path/to/problematic-file.cs \
  --verbose
```

This isolates the parsing of a single file, making it easier to:
- Identify Tree-sitter parsing errors
- Debug symbol extraction logic
- Test chunking strategies
- Validate dependency detection

### Add Contextual Logging

```typescript
function extractSymbol(node: SyntaxNode, filePath: string): Symbol {
  if (process.env.CLAUDE_COMPASS_DEBUG) {
    console.log(`[DEBUG] Extracting symbol from node type: ${node.type}`);
    console.log(`[DEBUG] Node text: ${node.text.substring(0, 100)}...`);
    console.log(`[DEBUG] Position: ${node.startPosition.row}:${node.startPosition.column}`);
  }

  try {
    return {
      name: extractName(node),
      type: mapNodeTypeToSymbolType(node.type),
      // ...
    };
  } catch (error) {
    throw new ParsingError(
      `Failed to extract symbol from ${node.type} at ${filePath}:${node.startPosition.row}`,
      { cause: error, node, filePath }
    );
  }
}
```

## Framework Detection Patterns

When adding framework support within a language parser:

### 1. Identify Framework Markers

```typescript
function detectFramework(rootNode: SyntaxNode, filePath: string): Framework | null {
  // Check imports/using statements
  const imports = extractImports(rootNode);

  if (imports.some(imp => imp.includes('rocket'))) {
    return 'rocket';
  }

  // Check decorators/attributes
  const decorators = extractDecorators(rootNode);

  if (decorators.some(dec => dec.name === 'Controller')) {
    return 'nestjs';
  }

  // Check file path patterns
  if (filePath.includes('/Controllers/') && path.extname(filePath) === '.php') {
    return 'laravel';
  }

  return null;
}
```

### 2. Extract Framework-Specific Metadata

```typescript
function extractLaravelRouteMetadata(node: SyntaxNode): RouteMetadata {
  // Extract from Route::get('/path', [Controller::class, 'method'])
  const httpMethod = extractHttpMethod(node);
  const path = extractRoutePath(node);
  const controller = extractController(node);
  const middleware = extractMiddleware(node);

  return {
    httpMethod,
    path,
    controller,
    middleware,
    framework: 'laravel'
  };
}
```

### 3. Store in Framework Metadata Table

```typescript
async function persistFrameworkMetadata(
  symbolId: number,
  metadata: RouteMetadata
): Promise<void> {
  await db('framework_metadata').insert({
    symbol_id: symbolId,
    framework: metadata.framework,
    metadata_type: 'route',
    data: JSON.stringify(metadata)
  });
}
```

## Cross-Stack Dependency Detection

For detecting frontend ↔ backend connections:

```typescript
function extractApiCalls(rootNode: SyntaxNode, filePath: string): ApiCall[] {
  const apiCalls: ApiCall[] = [];

  // Find axios/fetch calls in Vue/React
  const callNodes = findNodesOfType(rootNode, 'call_expression');

  for (const node of callNodes) {
    if (isHttpClient(node)) {
      const endpoint = extractEndpoint(node);
      const method = extractHttpMethod(node);

      apiCalls.push({
        endpoint,
        method,
        sourceFile: filePath,
        // Will be resolved to Laravel route later
      });
    }
  }

  return apiCalls;
}

function isHttpClient(node: SyntaxNode): boolean {
  const text = node.text;
  return text.includes('axios.') ||
         text.includes('fetch(') ||
         text.includes('http.get') ||
         text.includes('http.post');
}
```

## Chunking Error Handling

When parsing large files in chunks:

```typescript
async function parseFileWithChunking(
  filePath: string,
  content: string
): Promise<ParseResult> {
  const strategy = new TypeScriptChunkingStrategy();

  if (!strategy.shouldChunk(Buffer.byteLength(content))) {
    return parseTypeScriptFile(filePath, content);
  }

  const chunks = strategy.splitIntoChunks(content, filePath);
  const parsedChunks: ParsedChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    try {
      const result = parseTypeScriptFile(filePath, chunk.content);
      parsedChunks.push({ ...result, chunkIndex: i });
    } catch (error) {
      throw new ChunkingError(
        `Failed to parse chunk ${i + 1}/${chunks.length}`,
        {
          filePath,
          chunkIndex: i,
          totalChunks: chunks.length,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          cause: error
        }
      );
    }
  }

  return strategy.mergeChunks(parsedChunks);
}
```

## Performance Optimization

### Reuse Parser Instances

```typescript
class ParserPool {
  private parsers: Map<string, Parser> = new Map();

  getParser(language: string): Parser {
    if (!this.parsers.has(language)) {
      const parser = new Parser();
      parser.setLanguage(getLanguageGrammar(language));
      this.parsers.set(language, parser);
    }

    return this.parsers.get(language)!;
  }
}

const parserPool = new ParserPool();

export function parseFile(filePath: string, content: string): ParseResult {
  const language = detectLanguage(filePath);
  const parser = parserPool.getParser(language);

  const tree = parser.parse(content);
  return extractSymbolsAndDependencies(tree);
}
```

### Limit Tree Depth for Large Files

```typescript
function extractSymbolsWithDepthLimit(
  rootNode: SyntaxNode,
  maxDepth: number = 10
): Symbol[] {
  const symbols: Symbol[] = [];

  function traverse(node: SyntaxNode, depth: number) {
    if (depth > maxDepth) {
      return; // Prevent stack overflow on deeply nested files
    }

    if (isSymbolNode(node)) {
      symbols.push(extractSymbol(node));
    }

    for (const child of node.children) {
      traverse(child, depth + 1);
    }
  }

  traverse(rootNode, 0);
  return symbols;
}
```
