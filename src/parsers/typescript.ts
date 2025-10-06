import Parser from 'tree-sitter';
import { typescript as TypeScript } from 'tree-sitter-typescript';
import { JavaScriptParser } from './javascript';
import {
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
  ParseOptions
} from './base';
import { ChunkedParseOptions } from './chunked-parser';
import { SymbolType, Visibility } from '../database/models';

/**
 * TypeScript-specific parser extending JavaScript parser
 */
export class TypeScriptParser extends JavaScriptParser {
  private static readonly TS_BOUNDARY_PATTERNS = [
    /interface\s+\w+(?:\s*<[^>]*>)?(?:\s+extends\s+[^{]+)?\s*{[^}]*}\s*\n/g,
    /type\s+\w+(?:\s*<[^>]*>)?\s*=\s*[^;]+;\s*\n/g,
    /namespace\s+\w+\s*{[^}]*}\s*\n/g,
    /enum\s+\w+\s*{[^}]*}\s*\n/g,
    /abstract\s+class\s+\w+(?:\s+extends\s+\w+)?(?:\s+implements\s+[^{]+)?\s*{[^}]*}\s*\n/g,
    /@\w+(?:\([^)]*\))?\s*\n(?=(?:export\s+)?(?:class|function|interface|type))/g,
    /function\s+\w+\s*<[^>]*>\s*\([^)]*\)\s*:\s*[^{]+\s*{[^}]*}\s*\n/g,
    /\w+\s*\([^)]*\)\s*:\s*[^;]+;\s*\n/g,
    /(?:readonly\s+)?\w+\s*:\s*[^;=]+(?:;|=\s*[^;]+;)\s*\n/g,
    /(?:import|export)\s+(?:type\s+)?{[^}]*}\s+from\s+['"][^'"]+['"];\s*\n/g,
    /declare\s+module\s+['"][^'"]+['"]\s*{[^}]*}\s*\n/g,
    /declare\s+(?:const|let|var|function|class|interface|namespace)\s+[^;]+;?\s*\n/g,
  ];

  constructor() {
    super();
    this.parser = new Parser();
    this.parser.setLanguage(TypeScript);
    this.language = 'typescript';
  }

  getSupportedExtensions(): string[] {
    return ['.ts', '.tsx'];
  }

  protected performSinglePassExtraction(rootNode: Parser.SyntaxNode, content: string): {
    symbols: ParsedSymbol[];
    dependencies: ParsedDependency[];
    imports: ParsedImport[];
    exports: ParsedExport[];
  } {
    const result = super.performSinglePassExtraction(rootNode, content);

    const tsSymbols: ParsedSymbol[] = [];

    const traverse = (node: Parser.SyntaxNode): void => {
      switch (node.type) {
        case 'interface_declaration': {
          const symbol = this.extractInterfaceSymbol(node, content);
          if (symbol) tsSymbols.push(symbol);
          break;
        }
        case 'type_alias_declaration': {
          const symbol = this.extractTypeAliasSymbol(node, content);
          if (symbol) tsSymbols.push(symbol);
          break;
        }
        case 'enum_declaration': {
          const symbol = this.extractEnumSymbol(node, content);
          if (symbol) tsSymbols.push(symbol);
          break;
        }
        case 'class_declaration': {
          const modifiers = this.extractModifiers(node, content);
          if (modifiers.includes('abstract')) {
            const nameNode = node.childForFieldName('name');
            if (nameNode) {
              const name = this.getNodeText(nameNode, content);
              tsSymbols.push({
                name,
                symbol_type: SymbolType.CLASS,
                start_line: node.startPosition.row + 1,
                end_line: node.endPosition.row + 1,
                is_exported: this.isSymbolExported(node, name, content),
                visibility: this.getVisibilityFromModifiers(modifiers),
              });
            }
          }
          break;
        }
        case 'method_signature': {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = this.getNodeText(nameNode, content);
            tsSymbols.push({
              name,
              symbol_type: SymbolType.METHOD,
              start_line: node.startPosition.row + 1,
              end_line: node.endPosition.row + 1,
              is_exported: false,
              signature: this.getNodeText(node, content),
            });
          }
          break;
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) traverse(child);
      }
    };

    traverse(rootNode);

    return {
      symbols: [...result.symbols, ...tsSymbols],
      dependencies: result.dependencies,
      imports: result.imports,
      exports: result.exports,
    };
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols = super.extractSymbols(rootNode, content);

    // Add TypeScript-specific symbols
    symbols.push(...this.extractTypeScriptSymbols(rootNode, content));

    return symbols;
  }

  private extractTypeScriptSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract interfaces
    const interfaceNodes = this.findNodesOfType(rootNode, 'interface_declaration');
    for (const node of interfaceNodes) {
      const symbol = this.extractInterfaceSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract type aliases
    const typeNodes = this.findNodesOfType(rootNode, 'type_alias_declaration');
    for (const node of typeNodes) {
      const symbol = this.extractTypeAliasSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract enums
    const enumNodes = this.findNodesOfType(rootNode, 'enum_declaration');
    for (const node of enumNodes) {
      const symbol = this.extractEnumSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract decorators
    const decoratorNodes = this.findNodesOfType(rootNode, 'decorator');
    for (const node of decoratorNodes) {
      const symbol = this.extractDecoratorSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract abstract classes and methods
    const abstractNodes = this.findAbstractSymbols(rootNode, content);
    symbols.push(...abstractNodes);

    return symbols;
  }

  private extractInterfaceSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      name,
      symbol_type: SymbolType.INTERFACE,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      signature: this.extractInterfaceSignature(node, content)
    };
  }

  private extractTypeAliasSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      name,
      symbol_type: SymbolType.TYPE_ALIAS,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      signature: this.getNodeText(node, content)
    };
  }

  private extractEnumSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      name,
      symbol_type: SymbolType.ENUM,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      visibility: this.extractVisibility(node, content)
    };
  }

  private extractDecoratorSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    // Decorators are typically not symbols themselves, but they modify other symbols
    // We might want to track them for dependency analysis
    return null;
  }

  private findAbstractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Find abstract classes
    const classNodes = this.findNodesOfType(rootNode, 'class_declaration');
    for (const node of classNodes) {
      const modifiers = this.extractModifiers(node, content);
      if (modifiers.includes('abstract')) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = this.getNodeText(nameNode, content);
          symbols.push({
            name,
            symbol_type: SymbolType.CLASS,
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
            is_exported: this.isSymbolExported(node, name, content),
            visibility: this.getVisibilityFromModifiers(modifiers)
          });
        }
      }
    }

    // Find abstract methods
    const methodNodes = this.findNodesOfType(rootNode, 'method_signature');
    for (const node of methodNodes) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = this.getNodeText(nameNode, content);
        symbols.push({
          name,
          symbol_type: SymbolType.METHOD,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
          is_exported: false,
          signature: this.getNodeText(node, content)
        });
      }
    }

    return symbols;
  }

  private extractInterfaceSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    const bodyNode = node.childForFieldName('body');

    let signature = '';
    if (nameNode) {
      signature += `interface ${this.getNodeText(nameNode, content)}`;
    }

    // Add type parameters if present
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (typeParamsNode) {
      signature += this.getNodeText(typeParamsNode, content);
    }

    // Add extends clause if present
    const extendsNode = node.childForFieldName('extends');
    if (extendsNode) {
      signature += ` extends ${this.getNodeText(extendsNode, content)}`;
    }

    return signature;
  }

  private extractModifiers(node: Parser.SyntaxNode, content: string): string[] {
    const modifiers: string[] = [];

    // Look for modifier nodes
    for (const child of node.children) {
      if (child.type === 'abstract' ||
          child.type === 'public' ||
          child.type === 'private' ||
          child.type === 'protected' ||
          child.type === 'static' ||
          child.type === 'readonly' ||
          child.type === 'async' ||
          child.type === 'export') {
        modifiers.push(child.type);
      }
    }

    return modifiers;
  }

  private extractVisibility(node: Parser.SyntaxNode, content: string): Visibility | undefined {
    const modifiers = this.extractModifiers(node, content);
    return this.getVisibilityFromModifiers(modifiers);
  }

  protected isSymbolExported(node: Parser.SyntaxNode, symbolName: string, content: string): boolean {
    // Check for export keyword in modifiers
    const modifiers = this.extractModifiers(node, content);
    if (modifiers.includes('export')) {
      return true;
    }

    // Fall back to parent class implementation
    return super.isSymbolExported(node, symbolName, content);
  }

  /**
   * Enhanced chunk boundaries for TypeScript content
   * Adds TypeScript-specific boundary detection to JavaScript patterns
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    // Get JavaScript boundaries first
    const jsChunks = super.getChunkBoundaries(content, maxChunkSize);

    const searchLimit = Math.floor(maxChunkSize * 0.85);
    const searchContent = content.substring(0, Math.min(searchLimit, content.length));

    const tsPatterns = TypeScriptParser.TS_BOUNDARY_PATTERNS;
    const tsBoundaries: number[] = [];

    for (const pattern of tsPatterns) {
      let match;
      while ((match = pattern.exec(searchContent)) !== null) {
        const position = match.index + match[0].length;
        if (position > 100 && position < searchLimit) { // Ensure reasonable minimum chunk size
          tsBoundaries.push(position);
        }
      }
    }

    // Merge and optimize boundaries
    return this.optimizeChunkBoundaries([...jsChunks, ...tsBoundaries], content);
  }

  /**
   * Optimize chunk boundaries by removing overlapping or too-close boundaries
   */
  private optimizeChunkBoundaries(boundaries: number[], content: string): number[] {
    const uniqueBoundaries = [...new Set(boundaries)].sort((a, b) => b - a);
    const optimized: number[] = [];

    let lastBoundary = Number.MAX_SAFE_INTEGER;
    for (const boundary of uniqueBoundaries) {
      // Ensure boundaries are at least 1000 characters apart to avoid tiny chunks
      if (lastBoundary - boundary > 1000) {
        optimized.push(boundary);
        lastBoundary = boundary;
      }
    }

    return optimized;
  }

  /**
   * Override parseFile to handle TypeScript-specific chunking
   */
  async parseFile(filePath: string, content: string, options?: ParseOptions): Promise<ParseResult> {
    const validatedOptions = this.validateOptions(options);
    const chunkedOptions = validatedOptions as ChunkedParseOptions;

    // Enhanced TypeScript chunking threshold (higher due to type complexity)
    const tsChunkThreshold = Math.floor((chunkedOptions.chunkSize || this.DEFAULT_CHUNK_SIZE) * 1.1);

    // Always use chunking for large TypeScript files
    if (content.length > tsChunkThreshold) {
      const chunkedResult = await this.parseFileInChunks(filePath, content, chunkedOptions);
      return this.convertMergedResult(chunkedResult);
    }

    // Use parent implementation for smaller files
    return super.parseFile(filePath, content, options);
  }
}