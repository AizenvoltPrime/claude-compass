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
import { FrameworkParseOptions } from './base-framework';
import { ChunkedParseOptions } from './chunked-parser';
import { SymbolType, Visibility, DependencyType } from '../database/models';
import { entityClassifier } from '../utils/entity-classifier';
import { FrameworkDetector } from './utils/framework-detector';
import { convertMergedResult } from './javascript/';

interface TypeScriptParsingContext {
  imports: ParsedImport[];
  filePath: string;
}

/**
 * TypeScript-specific parser extending JavaScript parser
 */
export class TypeScriptParser extends JavaScriptParser {
  private currentFilePath: string = '';
  private currentOptions: ParseOptions | undefined;

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

  private static readonly TS_MODIFIER_KEYWORDS = new Set([
    'async',
    'static',
    'get',
    'set',
    'abstract',
    'public',
    'private',
    'protected',
    'readonly',
    'export',
  ]);

  constructor() {
    super();
    this.parser = new Parser();
    this.parser.setLanguage(TypeScript);
    this.language = 'typescript';
  }

  /**
   * Build qualified name from namespace and parent context
   */
  private buildQualifiedName(
    namespace: string | undefined,
    parentName: string | undefined,
    symbolName: string
  ): string {
    const parts: string[] = [];

    if (namespace) {
      parts.push(namespace);
    }

    if (parentName) {
      parts.push(parentName);
    }

    parts.push(symbolName);

    return parts.join('::');
  }

  getSupportedExtensions(): string[] {
    return ['.ts', '.tsx'];
  }

  protected performSinglePassExtraction(rootNode: Parser.SyntaxNode, content: string, filePath?: string, options?: FrameworkParseOptions): {
    symbols: ParsedSymbol[];
    dependencies: ParsedDependency[];
    imports: ParsedImport[];
    exports: ParsedExport[];
  } {
    const result = super.performSinglePassExtraction(rootNode, content, filePath, options);

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
        case 'method_signature': {
          // Defensive validation: Only process actual method_signature nodes
          if (node.type !== 'method_signature') {
            break;
          }

          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = this.getNodeText(nameNode, content);

            // CRITICAL FIX: Filter control flow keywords
            // Control flow keywords are JavaScript/TypeScript reserved words and cannot be method names
            const controlFlowKeywords = ['if', 'else', 'catch', 'while', 'for', 'do', 'switch', 'try'];
            if (controlFlowKeywords.includes(name)) {
              break; // Skip - impossible method names
            }

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

    const context: TypeScriptParsingContext = {
      imports: result.imports,
      filePath: filePath || ''
    };

    const enhancedDependencies = this.enhanceDependenciesWithImportResolution(
      result.dependencies,
      context
    );

    return {
      symbols: [...result.symbols, ...tsSymbols],
      dependencies: enhancedDependencies,
      imports: result.imports,
      exports: result.exports,
    };
  }


  private extractInterfaceSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const description = this.extractJSDocComment(node, content);

    const extendsNode = node.childForFieldName('extends');
    const extendsClasses = extendsNode ? [this.getNodeText(extendsNode, content)] : [];

    const frameworkContext = (this.currentOptions as any)?.frameworkContext?.framework;

    const classification = entityClassifier.classify(
      'interface',
      name,
      extendsClasses,
      this.currentFilePath,
      frameworkContext,
      undefined,
      (this.currentOptions as any)?.repositoryFrameworks
    );

    return {
      name,
      qualified_name: this.buildQualifiedName(undefined, undefined, name),
      symbol_type: SymbolType.INTERFACE,
      entity_type: classification.entityType,
      framework: classification.framework,
      base_class: classification.baseClass || undefined,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      signature: this.extractInterfaceSignature(node, content),
      description,
    };
  }

  private extractTypeAliasSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const description = this.extractJSDocComment(node, content);

    const frameworkContext = (this.currentOptions as any)?.frameworkContext?.framework;

    const classification = entityClassifier.classify(
      'type_alias',
      name,
      [],
      this.currentFilePath,
      frameworkContext,
      undefined,
      (this.currentOptions as any)?.repositoryFrameworks
    );

    return {
      name,
      qualified_name: this.buildQualifiedName(undefined, undefined, name),
      symbol_type: SymbolType.TYPE_ALIAS,
      entity_type: classification.entityType,
      framework: classification.framework,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      signature: this.getNodeText(node, content),
      description,
    };
  }

  private extractEnumSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const description = this.extractJSDocComment(node, content);

    const frameworkContext = (this.currentOptions as any)?.frameworkContext?.framework;

    const classification = entityClassifier.classify(
      'enum',
      name,
      [],
      this.currentFilePath,
      frameworkContext,
      undefined,
      (this.currentOptions as any)?.repositoryFrameworks
    );

    return {
      name,
      qualified_name: this.buildQualifiedName(undefined, undefined, name),
      symbol_type: SymbolType.ENUM,
      entity_type: classification.entityType,
      framework: classification.framework,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      visibility: this.extractVisibility(node, content),
      description,
    };
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

  protected extractModifiers(node: Parser.SyntaxNode): string[] {
    const modifiers: string[] = [];

    for (const child of node.children) {
      if (TypeScriptParser.TS_MODIFIER_KEYWORDS.has(child.type)) {
        modifiers.push(child.type);
      }
    }

    return modifiers;
  }

  private extractVisibility(node: Parser.SyntaxNode, content: string): Visibility | undefined {
    const modifiers = this.extractModifiers(node);
    return this.getVisibilityFromModifiers(modifiers);
  }

  protected isSymbolExported(node: Parser.SyntaxNode, symbolName: string, content: string): boolean {
    const modifiers = this.extractModifiers(node);
    if (modifiers.includes('export')) {
      return true;
    }

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
   * Detect Vue patterns in file content to auto-set framework context
   */

  /**
   * Override parseFile to handle TypeScript-specific chunking
   */
  async parseFile(filePath: string, content: string, options?: ParseOptions): Promise<ParseResult> {
    this.currentFilePath = filePath;

    // Auto-detect Vue framework if not already set
    const repositoryFrameworks = options?.repositoryFrameworks;
    if (!options?.frameworkContext?.framework && FrameworkDetector.detectVue(content, repositoryFrameworks)) {
      this.currentOptions = {
        ...options,
        frameworkContext: {
          framework: 'vue',
        },
      } as any;
    } else {
      this.currentOptions = options;
    }

    const validatedOptions = this.validateOptions(this.currentOptions);
    const chunkedOptions = validatedOptions as ChunkedParseOptions;

    // Enhanced TypeScript chunking threshold (higher due to type complexity)
    const tsChunkThreshold = Math.floor((chunkedOptions.chunkSize || this.DEFAULT_CHUNK_SIZE) * 1.1);

    // Always use chunking for large TypeScript files
    if (content.length > tsChunkThreshold) {
      const chunkedResult = await this.parseFileInChunks(filePath, content, { ...chunkedOptions, ...(this.currentOptions as any) });
      return convertMergedResult(chunkedResult);
    }

    // Use parent implementation for smaller files
    return super.parseFile(filePath, content, this.currentOptions);
  }

  private enhanceDependenciesWithImportResolution(
    dependencies: ParsedDependency[],
    context: TypeScriptParsingContext
  ): ParsedDependency[] {
    const importMap = this.buildImportMap(context.imports);

    return dependencies.map(dep => {
      const toSymbol = dep.to_symbol;
      const moduleSource = importMap.get(toSymbol);

      if (moduleSource) {
        return {
          ...dep,
          to_qualified_name: `${moduleSource}::${toSymbol}`
        };
      }

      return dep;
    });
  }

  private buildImportMap(imports: ParsedImport[]): Map<string, string> {
    const importMap = new Map<string, string>();

    for (const importStmt of imports) {
      if (!importStmt.imported_names || importStmt.imported_names.length === 0) {
        continue;
      }

      const source = importStmt.source;

      for (const importedName of importStmt.imported_names) {
        if (importStmt.import_type === 'named') {
          importMap.set(importedName, source);
        } else if (importStmt.import_type === 'default') {
          importMap.set(importedName, source);
        } else if (importStmt.import_type === 'namespace') {
          importMap.set(importedName, source);
        }
      }
    }

    return importMap;
  }
}