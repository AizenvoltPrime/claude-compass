import Parser from 'tree-sitter';
import { SymbolType } from '../../database/models';
import { ParsedSymbol, ParsedDependency, ParseResult } from '../base';
import { ChunkedParseOptions, ChunkResult, MergedParseResult } from '../chunked-parser';
import { StructuralContext } from './types';

/**
 * Check if chunking should be used based on content size and options
 */
export function shouldUseChunking(
  content: string,
  options: ChunkedParseOptions,
  defaultChunkSize: number
): boolean {
  const chunkingEnabled = options.enableChunking !== false;
  const exceedsSize = content.length > (options.chunkSize || defaultChunkSize);
  return chunkingEnabled && exceedsSize;
}

/**
 * Find optimal chunk boundaries based on top-level declarations
 */
export function getChunkBoundaries(
  content: string,
  maxChunkSize: number,
  parseContentFn: (content: string) => Parser.Tree | null,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  findNodesOfTypeFn: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): number[] {
  const boundaries: number[] = [];
  const tree = parseContentFn(content);

  if (!tree?.rootNode) return boundaries;

  // Find top-level declarations
  const declarations = findTopLevelDeclarations(tree.rootNode, content, findNodesOfTypeFn);

  let currentSize = 0;

  for (const decl of declarations) {
    const declSize = decl.endIndex - decl.startIndex;

    if (currentSize + declSize > maxChunkSize && currentSize > 0) {
      boundaries.push(decl.startIndex - 1);
      currentSize = 0;
    }

    currentSize += declSize;
  }

  return boundaries;
}

/**
 * Find all top-level type declarations in the AST
 */
export function findTopLevelDeclarations(
  rootNode: Parser.SyntaxNode,
  _content: string,
  findNodesOfTypeFn: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): Array<{ startIndex: number; endIndex: number; type: string }> {
  const declarations: Array<{ startIndex: number; endIndex: number; type: string }> = [];

  const topLevelTypes = [
    'namespace_declaration',
    'class_declaration',
    'interface_declaration',
    'struct_declaration',
    'enum_declaration',
    'delegate_declaration',
  ];

  for (const type of topLevelTypes) {
    const nodes = findNodesOfTypeFn(rootNode, type);
    for (const node of nodes) {
      // Only include actual top-level declarations
      let parent = node.parent;
      let isTopLevel = true;

      while (parent && parent !== rootNode) {
        if (topLevelTypes.includes(parent.type)) {
          isTopLevel = false;
          break;
        }
        parent = parent.parent;
      }

      if (isTopLevel) {
        declarations.push({
          startIndex: node.startIndex,
          endIndex: node.endIndex,
          type: node.type,
        });
      }
    }
  }

  return declarations.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Extract structural context (namespaces, classes) from the file
 */
export function extractStructuralContext(
  content: string,
  parseContentFn: (content: string) => Parser.Tree | null,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): StructuralContext[] {
  const structures: StructuralContext[] = [];
  const tree = parseContentFn(content);

  if (!tree?.rootNode) return structures;

  const namespaceStack: string[] = [];
  const classStack: string[] = [];

  const traverse = (node: Parser.SyntaxNode) => {
    switch (node.type) {
      case 'namespace_declaration':
      case 'file_scoped_namespace_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = getNodeTextFn(nameNode, content);
          namespaceStack.push(name);

          structures.push({
            type: 'namespace',
            name,
            qualifiedName: name,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        break;
      }

      case 'class_declaration':
      case 'interface_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = getNodeTextFn(nameNode, content);
          const namespace = namespaceStack.length > 0 ? namespaceStack.join('.') : undefined;
          const parentClass =
            classStack.length > 0 ? classStack[classStack.length - 1] : undefined;

          const qualifiedParts: string[] = [];
          if (namespace) qualifiedParts.push(namespace);
          if (parentClass) qualifiedParts.push(parentClass);
          qualifiedParts.push(name);

          const qualifiedName = qualifiedParts.join('.');

          structures.push({
            type: node.type === 'class_declaration' ? 'class' : 'interface',
            name,
            qualifiedName,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            namespace,
            parentClass,
          });

          classStack.push(name);
        }
        break;
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        traverse(child);
      }
    }

    if (node.type === 'class_declaration' || node.type === 'interface_declaration') {
      classStack.pop();
    }
    if (
      node.type === 'namespace_declaration' ||
      node.type === 'file_scoped_namespace_declaration'
    ) {
      namespaceStack.pop();
    }
  };

  traverse(tree.rootNode);
  return structures;
}

/**
 * Add structural context metadata to chunk results
 */
export function enrichChunksWithStructuralContext(
  chunks: ChunkResult[],
  structures: StructuralContext[]
): ChunkResult[] {
  return chunks.map(chunk => {
    const enclosingClasses: string[] = [];
    let enclosingNamespace: string | undefined;
    let qualifiedClassName: string | undefined;

    for (const structure of structures) {
      const chunkOverlapsStructure =
        (chunk.startLine >= structure.startLine && chunk.startLine <= structure.endLine) ||
        (chunk.endLine >= structure.startLine && chunk.endLine <= structure.endLine) ||
        (chunk.startLine <= structure.startLine && chunk.endLine >= structure.endLine);

      if (chunkOverlapsStructure) {
        if (structure.type === 'namespace') {
          enclosingNamespace = structure.qualifiedName;
        } else if (structure.type === 'class' || structure.type === 'interface') {
          enclosingClasses.push(structure.name);
          if (!qualifiedClassName) {
            qualifiedClassName = structure.qualifiedName;
          }
        }
      }
    }

    if (!chunk.metadata) {
      chunk.metadata = {
        originalStartLine: chunk.startLine,
        hasOverlapBefore: false,
        hasOverlapAfter: false,
        totalChunks: chunks.length,
      };
    }

    chunk.metadata.enclosingStructures = {
      namespace: enclosingNamespace,
      classes: enclosingClasses.length > 0 ? enclosingClasses : undefined,
      qualifiedClassName,
    };

    return chunk;
  });
}

/**
 * Merge chunk results and remove duplicates
 */
export function mergeChunkResults(
  chunks: ParseResult[],
  chunkMetadata: ChunkResult[],
  removeDuplicateSymbolsFn: (symbols: ParsedSymbol[]) => ParsedSymbol[],
  removeDuplicateDependenciesFn: (dependencies: ParsedDependency[]) => ParsedDependency[]
): MergedParseResult {
  const merged: ParseResult = {
    symbols: [],
    dependencies: [],
    imports: [],
    exports: [],
    errors: [],
  };

  // Merge all chunks
  for (const chunk of chunks) {
    merged.symbols.push(...chunk.symbols);
    merged.dependencies.push(...chunk.dependencies);
    merged.imports.push(...chunk.imports);
    merged.exports.push(...chunk.exports);
    merged.errors.push(...chunk.errors);
  }

  // Remove duplicates
  merged.symbols = removeDuplicateSymbolsFn(merged.symbols);
  merged.dependencies = removeDuplicateDependenciesFn(merged.dependencies);

  return {
    ...merged,
    chunksProcessed: chunks.length,
    metadata: {
      totalChunks: chunkMetadata.length,
      duplicatesRemoved: 0,
      crossChunkReferencesFound: 0,
    },
  };
}

/**
 * Remove duplicate symbols with special handling for partial classes
 */
export function removeDuplicateSymbols(
  symbols: ParsedSymbol[],
  isMoreCompleteSymbolFn: (symbol1: ParsedSymbol, symbol2: ParsedSymbol) => boolean
): ParsedSymbol[] {
  const seen = new Map<string, ParsedSymbol>();

  for (const symbol of symbols) {
    const key =
      symbol.symbol_type === SymbolType.CLASS && symbol.signature?.includes('partial')
        ? `${symbol.qualified_name}:CLASS:partial`
        : `${symbol.qualified_name || symbol.name}:${symbol.symbol_type}`;

    if (!seen.has(key)) {
      seen.set(key, symbol);
    } else {
      const existing = seen.get(key)!;
      if (symbol.symbol_type === SymbolType.CLASS && isPartialClass(symbol)) {
        seen.set(key, {
          ...existing,
          start_line: Math.min(existing.start_line, symbol.start_line),
          end_line: Math.max(existing.end_line, symbol.end_line),
        });
      } else if (isMoreCompleteSymbolFn(symbol, existing)) {
        seen.set(key, symbol);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Check if a symbol is a partial class
 */
export function isPartialClass(symbol: ParsedSymbol): boolean {
  return symbol.symbol_type === SymbolType.CLASS && !!symbol.signature?.includes('partial');
}

/**
 * Convert merged result to regular ParseResult
 */
export function convertMergedResult(mergedResult: MergedParseResult): ParseResult {
  return {
    symbols: mergedResult.symbols,
    dependencies: mergedResult.dependencies,
    imports: mergedResult.imports,
    exports: mergedResult.exports,
    errors: mergedResult.errors,
  };
}
