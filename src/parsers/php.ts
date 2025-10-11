import Parser from 'tree-sitter';
import { php as PHP } from 'tree-sitter-php';
import {
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
  ParseOptions,
  ParseError
} from './base';
import {
  ChunkedParser,
  MergedParseResult,
  ChunkedParseOptions,
  ChunkResult
} from './chunked-parser';
import { SymbolType, DependencyType, Visibility } from '../database/models';

/**
 * PHP parsing state for syntax-aware chunking
 */
interface PhpParseState {
  // String state
  inString: 'none' | 'single' | 'double' | 'heredoc' | 'nowdoc';
  stringDelimiter: string;
  heredocIdentifier: string;

  // Comment state
  inComment: 'none' | 'single' | 'multi';

  // Nesting levels
  braceLevel: number;
  parenLevel: number;
  bracketLevel: number;

  // PHP structure tracking
  inPhpTag: boolean;
  classLevel: number;           // Nesting depth within classes
  methodLevel: number;          // Nesting depth within methods/functions
  topLevelBraceLevel: number;   // Track braces at top level only

  // Safe boundary tracking
  lastStatementEnd: number;     // Position after last ;
  lastBlockEnd: number;         // Position after last }
  lastSafeWhitespace: number;   // Position of last safe whitespace
  lastUseBlockEnd: number;      // Position after complete use block
  lastMethodEnd: number;        // Position after complete method/function
  lastClassEnd: number;         // Position after complete class/interface/trait
}


/**
 * PHP-specific parser using Tree-sitter with chunked parsing support
 */
export class PHPParser extends ChunkedParser {
  private wasChunked: boolean = false;

  private static readonly CLASS_PATTERNS = [
    /\b(?:class|interface|trait)\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*(?:\{|\s*$)/m,
    /\b(?:abstract\s+)?class\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*(?:\{|\s*$)/m,
    /\bfinal\s+class\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*(?:\{|\s*$)/m,
  ];

  private static readonly CLASS_BRACE_PATTERNS = [
    /\b(?:class|interface|trait)\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*$/,
    /\b(?:abstract\s+)?class\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*$/,
    /\bfinal\s+class\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*$/,
  ];

  private static readonly FUNCTION_PATTERNS = [
    /\bfunction\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
    /\b(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
    /\b(?:public|private|protected)\s+static\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
    /\bstatic\s+(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
    /\bstatic\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
    /\babstract\s+(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?;?\s*$/m,
  ];

  private static readonly FUNCTION_BRACE_PATTERNS = [
    /\bfunction\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
    /\b(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
    /\b(?:public|private|protected)\s+static\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
    /\bstatic\s+(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
    /\bstatic\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
  ];

  constructor() {
    const parser = new Parser();
    parser.setLanguage(PHP);
    super(parser, 'php');
  }

  getSupportedExtensions(): string[] {
    return ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'];
  }

  async parseFile(filePath: string, content: string, options?: ParseOptions): Promise<ParseResult> {
    const validatedOptions = this.validateOptions(options);
    const chunkedOptions = validatedOptions as ChunkedParseOptions;

    // Check if content is valid - handle empty files gracefully
    if (!content) {
      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [], // Empty files are not an error, just return empty results
      };
    }

    // Check file size limit first
    if (validatedOptions.maxFileSize && content.length > validatedOptions.maxFileSize) {
      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `File is too large (${content.length} bytes, limit: ${validatedOptions.maxFileSize} bytes)`,
          line: 1,
          column: 1,
          severity: 'error'
        }]
      };
    }

    // Check if chunking should be used and is enabled
    if (chunkedOptions.enableChunking !== false &&
        content.length > (chunkedOptions.chunkSize || this.DEFAULT_CHUNK_SIZE)) {
      this.wasChunked = true;
      const chunkedResult = await this.parseFileInChunks(filePath, content, chunkedOptions);
      return this.convertMergedResult(chunkedResult);
    }

    // For smaller files or when chunking is disabled, use direct parsing
    this.wasChunked = false;
    return this.parseFileDirectly(filePath, content, chunkedOptions);
  }

  /**
   * Parse file directly without chunking (internal method to avoid recursion)
   */
  protected async parseFileDirectly(
    _filePath: string,
    content: string,
    options?: ChunkedParseOptions
  ): Promise<ParseResult> {
    const validatedOptions = this.validateOptions(options);

    const tree = this.parseContent(content, validatedOptions);
    if (!tree || !tree.rootNode) {
      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: 'Failed to parse syntax tree',
          line: 1,
          column: 1,
          severity: 'error'
        }]
      };
    }

    try {
      this.clearNodeCache();
      const result = this.performSinglePassExtraction(tree.rootNode, content);
      const errors = this.extractErrors(tree.rootNode, content, tree);

      return {
        symbols: validatedOptions.includePrivateSymbols
          ? result.symbols
          : result.symbols.filter(s => s.visibility !== 'private'),
        dependencies: result.dependencies,
        imports: result.imports,
        exports: result.exports,
        errors,
      };
    } finally {
      this.clearNodeCache();
    }
  }

  protected performSinglePassExtraction(rootNode: Parser.SyntaxNode, content: string): {
    symbols: ParsedSymbol[];
    dependencies: ParsedDependency[];
    imports: ParsedImport[];
    exports: ParsedExport[];
  } {
    const symbols: ParsedSymbol[] = [];
    const dependencies: ParsedDependency[] = [];
    const imports: ParsedImport[] = [];
    const exports: ParsedExport[] = [];

    const context = {
      currentNamespace: null as string | null,
      currentClass: null as string | null,
    };

    const traverse = (node: Parser.SyntaxNode): void => {
      this.cacheNode(node.type, node);

      switch (node.type) {
        case 'namespace_definition': {
          const symbol = this.extractNamespaceSymbol(node, content);
          if (symbol) {
            symbols.push(symbol);
            context.currentNamespace = symbol.name;
          }
          break;
        }
        case 'class_declaration': {
          const symbol = this.extractClassSymbol(node, content, context);
          if (symbol) {
            symbols.push(symbol);
            const previousClass = context.currentClass;
            context.currentClass = symbol.name;

            for (const child of node.children) {
              traverse(child);
            }

            context.currentClass = previousClass;

            const exportInfo = this.extractClassExport(node, content);
            if (exportInfo) exports.push(exportInfo);
          }
          return;
        }
        case 'interface_declaration': {
          const symbol = this.extractInterfaceSymbol(node, content, context);
          if (symbol) {
            symbols.push(symbol);
            const previousClass = context.currentClass;
            context.currentClass = symbol.name;

            for (const child of node.children) {
              traverse(child);
            }

            context.currentClass = previousClass;

            const exportInfo = this.extractInterfaceExport(node, content);
            if (exportInfo) exports.push(exportInfo);
          }
          return;
        }
        case 'trait_declaration': {
          const symbol = this.extractTraitSymbol(node, content, context);
          if (symbol) {
            symbols.push(symbol);
            const previousClass = context.currentClass;
            context.currentClass = symbol.name;

            for (const child of node.children) {
              traverse(child);
            }

            context.currentClass = previousClass;

            const exportInfo = this.extractTraitExport(node, content);
            if (exportInfo) exports.push(exportInfo);
          }
          return;
        }
        case 'function_definition': {
          const symbol = this.extractFunctionSymbol(node, content, context);
          if (symbol) {
            symbols.push(symbol);
            const exportInfo = this.extractFunctionExport(node, content);
            if (exportInfo) exports.push(exportInfo);
          }
          break;
        }
        case 'method_declaration': {
          const symbol = this.extractMethodSymbol(node, content, context);
          if (symbol) symbols.push(symbol);
          break;
        }
        case 'property_declaration': {
          const propertySymbols = this.extractPropertySymbols(node, content);
          symbols.push(...propertySymbols);
          break;
        }
        case 'const_declaration': {
          const constSymbols = this.extractConstantSymbols(node, content);
          symbols.push(...constSymbols);
          break;
        }
        case 'function_call_expression': {
          const dependency = this.extractCallDependency(node, content);
          if (dependency) dependencies.push(dependency);
          break;
        }
        case 'member_call_expression': {
          const dependency = this.extractMethodCallDependency(node, content);
          if (dependency) dependencies.push(dependency);
          break;
        }
        case 'scoped_call_expression': {
          const dependency = this.extractScopedCallDependency(node, content);
          if (dependency) dependencies.push(dependency);
          break;
        }
        case 'object_creation_expression': {
          const dependency = this.extractNewDependency(node, content);
          if (dependency) dependencies.push(dependency);
          break;
        }
        case 'namespace_use_declaration': {
          const importInfo = this.extractUseStatement(node, content);
          if (importInfo) imports.push(importInfo);
          break;
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) traverse(child);
      }
    };

    traverse(rootNode);

    const includeNodes = this.findIncludeStatements(rootNode, content);
    imports.push(...includeNodes);

    return { symbols, dependencies, imports, exports };
  }

  protected extractSymbols(_rootNode: Parser.SyntaxNode, _content: string): ParsedSymbol[] {
    return [];
  }

  protected extractDependencies(_rootNode: Parser.SyntaxNode, _content: string): ParsedDependency[] {
    return [];
  }

  protected extractImports(_rootNode: Parser.SyntaxNode, _content: string): ParsedImport[] {
    return [];
  }

  protected extractExports(_rootNode: Parser.SyntaxNode, _content: string): ParsedExport[] {
    return [];
  }

  private extractPhpDocComment(node: Parser.SyntaxNode, content: string): string | undefined {
    const parent = node.parent;
    if (!parent) return undefined;

    const nodeIndex = parent.children.indexOf(node);
    if (nodeIndex <= 0) return undefined;

    for (let i = nodeIndex - 1; i >= 0; i--) {
      const sibling = parent.children[i];

      if (sibling.type === '\n' || sibling.type === 'whitespace') continue;

      if (sibling.type !== 'comment') break;

      const commentText = this.getNodeText(sibling, content);

      if (commentText.trim().startsWith('/**')) {
        return this.cleanPhpDocComment(commentText);
      }

      break;
    }

    return undefined;
  }

  private cleanPhpDocComment(commentText: string): string {
    let cleaned = commentText
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .trim();

    const lines = cleaned.split('\n').map(line => {
      return line.replace(/^\s*\*?\s?/, '');
    });

    return lines.join('\n').trim();
  }

  private buildQualifiedName(context: { currentNamespace: string | null; currentClass: string | null }, name: string): string {
    const parts: string[] = [];

    if (context.currentNamespace) {
      parts.push(context.currentNamespace);
    }

    if (context.currentClass && context.currentClass !== name) {
      parts.push(context.currentClass);
    }

    parts.push(name);

    return parts.join('\\');
  }

  private extractNamespaceSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const description = this.extractPhpDocComment(node, content);

    return {
      name,
      symbol_type: SymbolType.NAMESPACE,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true, // Namespaces are always accessible
      visibility: Visibility.PUBLIC,
      description,
    };
  }

  private extractClassSymbol(node: Parser.SyntaxNode, content: string, context: { currentNamespace: string | null; currentClass: string | null }): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractClassSignature(node, content);
    const description = this.extractPhpDocComment(node, content);
    const qualifiedName = this.buildQualifiedName(context, name);

    return {
      name,
      qualified_name: qualifiedName,
      symbol_type: SymbolType.CLASS,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true, // Classes are typically exportable in PHP
      visibility: Visibility.PUBLIC,
      signature,
      description,
    };
  }

  private extractInterfaceSymbol(node: Parser.SyntaxNode, content: string, context: { currentNamespace: string | null; currentClass: string | null }): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const description = this.extractPhpDocComment(node, content);
    const qualifiedName = this.buildQualifiedName(context, name);

    return {
      name,
      qualified_name: qualifiedName,
      symbol_type: SymbolType.INTERFACE,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true, // Interfaces are typically exportable
      visibility: Visibility.PUBLIC,
      description,
    };
  }

  private extractTraitSymbol(node: Parser.SyntaxNode, content: string, context: { currentNamespace: string | null; currentClass: string | null }): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const description = this.extractPhpDocComment(node, content);
    const qualifiedName = this.buildQualifiedName(context, name);

    return {
      name,
      qualified_name: qualifiedName,
      symbol_type: SymbolType.TRAIT,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true, // Traits are typically exportable
      visibility: Visibility.PUBLIC,
      description,
    };
  }

  private extractFunctionSymbol(node: Parser.SyntaxNode, content: string, context: { currentNamespace: string | null; currentClass: string | null }): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractFunctionSignature(node, content);
    const description = this.extractPhpDocComment(node, content);
    const qualifiedName = this.buildQualifiedName(context, name);

    return {
      name,
      qualified_name: qualifiedName,
      symbol_type: SymbolType.FUNCTION,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true, // Functions are typically exportable
      visibility: Visibility.PUBLIC,
      signature,
      description,
    };
  }

  private extractMethodSymbol(node: Parser.SyntaxNode, content: string, context: { currentNamespace: string | null; currentClass: string | null }): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractFunctionSignature(node, content);
    const visibility = this.extractVisibility(node, content);
    const description = this.extractPhpDocComment(node, content);

    let qualifiedName: string | undefined;
    if (context.currentClass) {
      const classQualifiedName = this.buildQualifiedName(context, context.currentClass);
      qualifiedName = `${classQualifiedName}::${name}`;
    }

    return {
      name,
      qualified_name: qualifiedName,
      symbol_type: SymbolType.METHOD,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: visibility === Visibility.PUBLIC,
      visibility,
      signature,
      description,
    };
  }

  private extractPropertySymbols(node: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    const visibility = this.extractVisibility(node, content);
    const description = this.extractPhpDocComment(node, content);

    // Property declarations can contain multiple properties
    const propertyElements = this.findNodesOfType(node, 'property_element');
    for (const element of propertyElements) {
      const nameNode = element.childForFieldName('name');
      if (nameNode) {
        const name = this.getNodeText(nameNode, content);
        symbols.push({
          name: name.replace('$', ''), // Remove $ prefix from PHP variables
          symbol_type: SymbolType.PROPERTY,
          start_line: element.startPosition.row + 1,
          end_line: element.endPosition.row + 1,
          is_exported: visibility === Visibility.PUBLIC,
          visibility,
          description,
        });
      }
    }

    return symbols;
  }

  private extractConstantSymbols(node: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    const description = this.extractPhpDocComment(node, content);

    // Constant declarations can contain multiple constants
    const constElements = this.findNodesOfType(node, 'const_element');
    for (const element of constElements) {
      const nameNode = element.childForFieldName('name');
      if (nameNode) {
        const name = this.getNodeText(nameNode, content);
        symbols.push({
          name,
          symbol_type: SymbolType.CONSTANT,
          start_line: element.startPosition.row + 1,
          end_line: element.endPosition.row + 1,
          is_exported: true, // Constants are typically accessible
          visibility: Visibility.PUBLIC,
          description,
        });
      }
    }

    return symbols;
  }

  private extractVisibility(node: Parser.SyntaxNode, content: string): Visibility {
    // Look for visibility modifiers in the node
    const modifiers = this.findNodesOfType(node, 'visibility_modifier');
    for (const modifier of modifiers) {
      const modifierText = this.getNodeText(modifier, content);
      switch (modifierText) {
        case 'private':
          return Visibility.PRIVATE;
        case 'protected':
          return Visibility.PROTECTED;
        case 'public':
          return Visibility.PUBLIC;
      }
    }

    // Default to public if no modifier found
    return Visibility.PUBLIC;
  }

  private extractClassSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    let signature = '';

    if (nameNode) {
      signature += this.getNodeText(nameNode, content);
    }

    // Check for extends clause
    const extendsNode = node.childForFieldName('base_clause');
    if (extendsNode) {
      signature += ' extends ' + this.getNodeText(extendsNode, content);
    }

    // Check for implements clause
    const implementsNode = node.childForFieldName('implements_clause');
    if (implementsNode) {
      signature += ' implements ' + this.getNodeText(implementsNode, content);
    }

    return signature;
  }

  private extractFunctionSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    const parametersNode = node.childForFieldName('parameters');

    let signature = '';
    if (nameNode) {
      signature += this.getNodeText(nameNode, content);
    }

    if (parametersNode) {
      signature += this.getNodeText(parametersNode, content);
    }

    return signature;
  }

  private findContainingFunction(callNode: Parser.SyntaxNode, content: string): string {
    let parent = callNode.parent;

    while (parent) {
      if (parent.type === 'function_definition' || parent.type === 'method_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) return this.getNodeText(nameNode, content);
      }
      parent = parent.parent;
    }

    return 'global';
  }

  private extractCallDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) return null;

    let functionName: string;

    if (functionNode.type === 'name') {
      functionName = this.getNodeText(functionNode, content);
    } else if (functionNode.type === 'qualified_name') {
      // Handle namespaced function calls
      functionName = this.getNodeText(functionNode, content);
    } else {
      return null;
    }

    const callerName = this.findContainingFunction(node, content);

    return {
      from_symbol: callerName,
      to_symbol: functionName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1
    };
  }

  private extractMethodCallDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const memberNode = node.childForFieldName('name');
    if (!memberNode) return null;

    const methodName = this.getNodeText(memberNode, content);
    const callerName = this.findContainingFunction(node, content);

    return {
      from_symbol: callerName,
      to_symbol: methodName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1
    };
  }

  private extractNewDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const classNode = node.childForFieldName('class');
    if (!classNode) return null;

    let className: string;
    if (classNode.type === 'name') {
      className = this.getNodeText(classNode, content);
    } else if (classNode.type === 'qualified_name') {
      className = this.getNodeText(classNode, content);
    } else {
      return null;
    }

    const callerName = this.findContainingFunction(node, content);

    return {
      from_symbol: callerName,
      to_symbol: className,
      dependency_type: DependencyType.REFERENCES,
      line_number: node.startPosition.row + 1
    };
  }

  private extractScopedCallDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    // Extract static method calls like User::create()
    // Structure: scoped_call_expression -> [name, ::, name, arguments]
    const children = node.children;
    if (children.length < 3) return null;

    const classNode = children[0]; // Class name
    const methodNode = children[2]; // Method name (after ::)

    if (classNode.type !== 'name' || methodNode.type !== 'name') return null;

    const className = this.getNodeText(classNode, content);
    const methodName = this.getNodeText(methodNode, content);
    const callerName = this.findContainingFunction(node, content);

    return {
      from_symbol: callerName,
      to_symbol: `${className}::${methodName}`,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1
    };
  }

  private extractUseStatement(node: Parser.SyntaxNode, content: string): ParsedImport | null {
    const importedNames: string[] = [];
    let source = '';

    // Extract use declarations
    const useClauses = this.findNodesOfType(node, 'namespace_use_clause');
    for (const clause of useClauses) {
      // Look for qualified_name child instead of using fieldName
      const nameNode = clause.children.find(child => child.type === 'qualified_name');
      if (nameNode) {
        const fullName = this.getNodeText(nameNode, content);
        importedNames.push(fullName);
        if (!source) {
          source = fullName;
        }
      }
    }

    if (importedNames.length === 0) return null;

    return {
      source,
      imported_names: importedNames,
      import_type: 'named',
      line_number: node.startPosition.row + 1,
      is_dynamic: false
    };
  }

  private findIncludeStatements(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const includeNodes = this.findNodesOfType(rootNode, 'include_expression');
    const includeOnceNodes = this.findNodesOfType(rootNode, 'include_once_expression');
    const requireNodes = this.findNodesOfType(rootNode, 'require_expression');
    const requireOnceNodes = this.findNodesOfType(rootNode, 'require_once_expression');

    const allIncludeNodes = [...includeNodes, ...includeOnceNodes, ...requireNodes, ...requireOnceNodes];

    for (const node of allIncludeNodes) {
      const argNode = node.child(1); // First argument after include/require keyword
      if (!argNode) continue;

      let source = '';
      if (argNode.type === 'string') {
        source = this.getNodeText(argNode, content).replace(/['"]/g, '');
      }

      if (source) {
        imports.push({
          source,
          imported_names: [],
          import_type: 'side_effect',
          line_number: node.startPosition.row + 1,
          is_dynamic: false
        });
      }
    }

    return imports;
  }

  private extractClassExport(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      exported_names: [name],
      export_type: 'named',
      line_number: node.startPosition.row + 1
    };
  }

  private extractInterfaceExport(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      exported_names: [name],
      export_type: 'named',
      line_number: node.startPosition.row + 1
    };
  }

  private extractTraitExport(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      exported_names: [name],
      export_type: 'named',
      line_number: node.startPosition.row + 1
    };
  }

  private extractFunctionExport(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      exported_names: [name],
      export_type: 'named',
      line_number: node.startPosition.row + 1
    };
  }

  /**
   * Configuration constants for chunk boundary detection
   */
  private static readonly CHUNK_BOUNDARY_CONFIG = {
    MIN_CHUNK_SIZE: 1000,          // Minimum chunk size to consider
    SAFE_BOUNDARY_BUFFER: 100,     // Buffer around boundary points
    MAX_NESTING_DEPTH: 50,         // Maximum brace nesting to track
    STRING_CONTEXT_SIZE: 200       // Characters to check around string boundaries
  };


  /**
   * Find optimal chunk boundaries for PHP content using syntax-aware boundary detection
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries: number[] = [];
    const targetChunkSize = Math.floor(maxChunkSize * 0.85);

    let position = 0;
    let lastBoundary = 0;

    while (position < content.length) {
      const chunkStart = lastBoundary;
      const searchLimit = chunkStart + targetChunkSize;

      if (searchLimit >= content.length) {
        // Remaining content fits in one chunk
        break;
      }

      const boundary = this.findNextSafeBoundary(content, chunkStart, searchLimit, maxChunkSize);

      if (boundary > chunkStart) {
        // Accept any valid boundary, even if it creates a small chunk
        // Small chunks are better than syntax errors
        boundaries.push(boundary);
        lastBoundary = boundary;
        position = boundary;
      } else {
        // No safe boundary found, use fallback
        const fallbackBoundary = this.findFallbackBoundary(content, chunkStart, searchLimit);
        if (fallbackBoundary > chunkStart) {
          boundaries.push(fallbackBoundary);
          lastBoundary = fallbackBoundary;
          position = fallbackBoundary;
        } else {
          // Emergency break to avoid infinite loop
          break;
        }
      }
    }

    return boundaries;
  }

  /**
   * Find the next safe boundary position using syntax-aware parsing
   */
  private findNextSafeBoundary(content: string, startPos: number, searchLimit: number, maxChunkSize: number): number {
    const state: PhpParseState = {
      inString: 'none',
      stringDelimiter: '',
      heredocIdentifier: '',
      inComment: 'none',
      braceLevel: 0,
      parenLevel: 0,
      bracketLevel: 0,
      inPhpTag: false,
      classLevel: 0,
      methodLevel: 0,
      topLevelBraceLevel: 0,
      lastStatementEnd: -1,
      lastBlockEnd: -1,
      lastSafeWhitespace: -1,
      lastUseBlockEnd: -1,
      lastMethodEnd: -1,
      lastClassEnd: -1
    };

    let useBlockStarted = false;
    let consecutiveUseStatements = 0;

    for (let i = startPos; i < Math.min(content.length, startPos + Math.floor(maxChunkSize * 1.2)); i++) {
      const char = content[i];
      const prevChar = i > 0 ? content[i - 1] : '';
      const nextChar = i < content.length - 1 ? content[i + 1] : '';

      // Update state based on current character
      this.updateParseState(state, char, prevChar, nextChar, content, i);

      // Track use statements
      if (this.isStartOfUseStatement(content, i, state)) {
        if (!useBlockStarted) {
          useBlockStarted = true;
          consecutiveUseStatements = 1;
        } else {
          consecutiveUseStatements++;
        }
      }

      // Check for end of use block
      if (useBlockStarted && char === ';' && state.inString === 'none' && state.inComment === 'none') {
        // Check if next non-whitespace/comment line is not a use statement
        const nextLineStart = this.findNextSignificantLine(content, i + 1);
        const isNextUse = nextLineStart !== -1 && this.isStartOfUseStatement(content, nextLineStart, state);

        if (!isNextUse) {
          state.lastUseBlockEnd = i + 1;
          useBlockStarted = false;
          consecutiveUseStatements = 0;
        }
      }

      // Track safe boundary points with improved structure awareness
      if (this.canCreateBoundaryAt(state, i)) {
        if (char === ';') {
          // Only record statement boundaries when at top level or after use statements
          if (state.classLevel === 0 && state.methodLevel === 0) {
            state.lastStatementEnd = i + 1;
          }
        } else if (char === '}') {
          state.lastBlockEnd = i + 1;
          // Method and class end boundaries are already tracked in updateParseState
        } else if (this.isWhitespace(char)) {
          state.lastSafeWhitespace = i;
        }
      }

      // Check if we should create a boundary
      if (i >= searchLimit) {
        return this.chooseBestBoundary(state, searchLimit, startPos);
      }
    }

    // Reached end of content
    return -1;
  }

  /**
   * Update the parsing state based on the current character
   */
  private updateParseState(state: PhpParseState, char: string, prevChar: string, nextChar: string, content: string, position: number): void {
    // Handle PHP tags
    if (state.inString === 'none' && state.inComment === 'none') {
      if (char === '<' && content.substr(position, 5) === '<?php') {
        state.inPhpTag = true;
        return;
      } else if (char === '?' && nextChar === '>' && state.inPhpTag) {
        state.inPhpTag = false;
        return;
      }
    }

    // Only process PHP syntax when inside PHP tags
    if (!state.inPhpTag) return;

    // Handle comments
    if (state.inComment === 'none' && state.inString === 'none') {
      if (char === '/' && nextChar === '/') {
        state.inComment = 'single';
        return;
      } else if (char === '/' && nextChar === '*') {
        state.inComment = 'multi';
        return;
      }
    }

    if (state.inComment === 'single' && char === '\n') {
      state.inComment = 'none';
      return;
    } else if (state.inComment === 'multi' && char === '*' && nextChar === '/') {
      state.inComment = 'none';
      return;
    }

    // Skip processing if we're in comments
    if (state.inComment !== 'none') return;

    // Handle strings
    if (state.inString === 'none') {
      if (char === '"') {
        state.inString = 'double';
        state.stringDelimiter = '"';
      } else if (char === "'") {
        state.inString = 'single';
        state.stringDelimiter = "'";
      } else if (char === '<' && content.substr(position, 3) === '<<<') {
        // Handle heredoc/nowdoc
        const heredocMatch = content.substr(position).match(/^<<<\s*['"]?(\w+)['"]?\s*\n/);
        if (heredocMatch) {
          state.inString = heredocMatch[0].includes("'") ? 'nowdoc' : 'heredoc';
          state.heredocIdentifier = heredocMatch[1];
        }
      }
    } else {
      // We're inside a string
      if (state.inString === 'single' || state.inString === 'double') {
        // Handle escaped characters
        if (char === '\\') {
          // Skip next character
          return;
        } else if (char === state.stringDelimiter && prevChar !== '\\') {
          state.inString = 'none';
          state.stringDelimiter = '';
        }
      } else if (state.inString === 'heredoc' || state.inString === 'nowdoc') {
        // Check for heredoc/nowdoc end
        if (char === '\n') {
          const lineStart = position + 1;
          if (content.substr(lineStart).startsWith(state.heredocIdentifier)) {
            const afterIdentifier = lineStart + state.heredocIdentifier.length;
            if (afterIdentifier >= content.length || content[afterIdentifier] === ';' || content[afterIdentifier] === '\n') {
              state.inString = 'none';
              state.heredocIdentifier = '';
            }
          }
        }
      }
    }

    // Skip processing if we're in strings
    if (state.inString !== 'none') return;

    // Handle nesting levels and PHP structure tracking
    if (char === '{') {
      state.braceLevel++;

      // Track PHP structure nesting
      const isClass = this.isAtStartOfClassOrInterface(content, position, state);
      const isMethod = this.isAtStartOfMethodOrFunction(content, position, state);

      if (isClass) {
        state.classLevel++;
        state.topLevelBraceLevel++;
      } else if (isMethod) {
        state.methodLevel++;
        if (state.classLevel === 0) {
          state.topLevelBraceLevel++;
        }
      }
    } else if (char === '}') {
      const wasTopLevel = (state.classLevel === 0) || (state.methodLevel > 0 && state.classLevel === 0);

      state.braceLevel--;

      // Track structure exits
      if (state.methodLevel > 0) {
        state.methodLevel--;
        if (state.methodLevel === 0) {
          // Exiting a method/function
          state.lastMethodEnd = position + 1;
          if (state.classLevel === 0) {
            state.topLevelBraceLevel--;
          }
        }
      } else if (state.classLevel > 0) {
        state.classLevel--;
        if (state.classLevel === 0) {
          // Exiting a class/interface/trait
          state.lastClassEnd = position + 1;
          state.topLevelBraceLevel--;
        }
      } else if (wasTopLevel) {
        state.topLevelBraceLevel--;
      }
    } else if (char === '(') {
      state.parenLevel++;
    } else if (char === ')') {
      state.parenLevel--;
    } else if (char === '[') {
      state.bracketLevel++;
    } else if (char === ']') {
      state.bracketLevel--;
    }
  }

  /**
   * Check if we can create a boundary at the current position
   */
  private canCreateBoundaryAt(state: PhpParseState, position: number): boolean {
    return state.inString === 'none' &&
           state.inComment === 'none' &&
           state.braceLevel >= 0 &&
           state.parenLevel >= 0 &&
           state.bracketLevel >= 0 &&
           state.inPhpTag;
  }

  /**
   * Check if current position is at the start of a class, interface, or trait
   */
  private isAtStartOfClassOrInterface(content: string, position: number, state: PhpParseState): boolean {
    if (!this.canCreateBoundaryAt(state, position)) return false;

    let searchStart = Math.max(0, position - 300);
    const searchText = content.substring(searchStart, position + 1);

    const classPatterns = PHPParser.CLASS_PATTERNS;

    if (content[position] === '{') {
      const beforeBrace = content.substring(searchStart, position).replace(/\s+$/, '');
      const bracePatterns = PHPParser.CLASS_BRACE_PATTERNS;

      if (bracePatterns.some(pattern => pattern.test(beforeBrace))) {
        return true;
      }
    }

    return classPatterns.some(pattern => pattern.test(searchText));
  }

  /**
   * Check if current position is at the start of a method or function
   */
  private isAtStartOfMethodOrFunction(content: string, position: number, state: PhpParseState): boolean {
    if (!this.canCreateBoundaryAt(state, position)) return false;

    let searchStart = Math.max(0, position - 500);
    const searchText = content.substring(searchStart, position + 1);

    const functionPatterns = PHPParser.FUNCTION_PATTERNS;

    if (content[position] === '{') {
      const beforeBrace = content.substring(searchStart, position).replace(/\s+$/, '');
      const bracePatterns = PHPParser.FUNCTION_BRACE_PATTERNS;

      if (bracePatterns.some(pattern => pattern.test(beforeBrace))) {
        return true;
      }
    }

    return functionPatterns.some(pattern => pattern.test(searchText));
  }

  /**
   * Check if the current position is the start of a use statement
   */
  private isStartOfUseStatement(content: string, position: number, state: PhpParseState): boolean {
    if (!this.canCreateBoundaryAt(state, position)) return false;

    // Look for 'use ' at the start of a line (ignoring whitespace)
    let lineStart = position;
    while (lineStart > 0 && content[lineStart - 1] !== '\n') {
      lineStart--;
    }

    const lineContent = content.substr(lineStart).replace(/^\s+/, '');
    const isUseLine = lineContent.startsWith('use ') && !lineContent.startsWith('use function ') && !lineContent.startsWith('use const ');

    // Only consider it a "start" if we're actually at or near the beginning of the use statement
    // not at the end of the line (like at a semicolon)
    if (isUseLine) {
      const relativePosition = position - lineStart;
      const trimmedLineStart = lineContent.length - lineContent.replace(/^\s+/, '').length;
      const useStatementStart = lineStart + trimmedLineStart;

      // Only return true if we're within the first few characters of the actual "use" keyword
      return position >= useStatementStart && position <= useStatementStart + 10;
    }

    return false;
  }

  /**
   * Find the next significant (non-whitespace, non-comment) line
   */
  private findNextSignificantLine(content: string, startPos: number): number {
    let pos = startPos;
    let foundNewline = false;

    while (pos < content.length) {
      const char = content[pos];

      if (char === '\n') {
        foundNewline = true;
        pos++;
        continue;
      }

      if (foundNewline && !this.isWhitespace(char)) {
        // Check if this line is a comment
        if (char === '/' && pos + 1 < content.length && content[pos + 1] === '/') {
          // Skip single line comment
          while (pos < content.length && content[pos] !== '\n') {
            pos++;
          }
          continue;
        } else if (char === '/' && pos + 1 < content.length && content[pos + 1] === '*') {
          // Skip multi-line comment
          pos += 2;
          while (pos + 1 < content.length) {
            if (content[pos] === '*' && content[pos + 1] === '/') {
              pos += 2;
              break;
            }
            pos++;
          }
          continue;
        }

        return pos;
      }

      if (foundNewline && this.isWhitespace(char)) {
        pos++;
        continue;
      }

      if (!foundNewline) {
        pos++;
        continue;
      }

      break;
    }

    return -1;
  }

  /**
   * Choose the best boundary point from available options
   */
  private chooseBestBoundary(state: PhpParseState, searchLimit: number, startPos: number): number {
    const candidates = [
      { pos: state.lastUseBlockEnd, priority: 1 },      // After complete use block (highest priority)
      { pos: state.lastClassEnd, priority: 2 },         // After complete class/interface/trait
      { pos: state.lastMethodEnd, priority: 3 },        // After complete method/function
      { pos: state.lastStatementEnd, priority: 4 },     // After statement end (top-level only)
      { pos: state.lastBlockEnd, priority: 5 },         // After any block end
      { pos: state.lastSafeWhitespace, priority: 6 }    // At safe whitespace (lowest priority)
    ].filter(candidate => candidate.pos > startPos && candidate.pos <= searchLimit);

    if (candidates.length === 0) {
      return -1;
    }

    // Sort by priority (lower number = higher priority)
    candidates.sort((a, b) => a.priority - b.priority);

    return candidates[0].pos;
  }

  /**
   * Find a fallback boundary when no safe boundary is available
   */
  private findFallbackBoundary(content: string, startPos: number, searchLimit: number): number {
    // Try to find at least a whitespace boundary
    for (let i = Math.min(searchLimit, content.length - 1); i > startPos; i--) {
      if (this.isWhitespace(content[i]) && content[i - 1] !== '\\') {
        return i;
      }
    }

    // Last resort: use the search limit
    return Math.min(searchLimit, content.length);
  }

  /**
   * Check if a character is whitespace
   */
  private isWhitespace(char: string): boolean {
    return /\s/.test(char);
  }




  /**
   * Merge results from multiple chunks
   */
  protected mergeChunkResults(chunks: ParseResult[], chunkMetadata: ChunkResult[]): MergedParseResult {
    const allSymbols: ParsedSymbol[] = [];
    const allDependencies: ParsedDependency[] = [];
    const allImports: ParsedImport[] = [];
    const allExports: ParsedExport[] = [];
    const allErrors: ParseError[] = [];

    for (const chunk of chunks) {
      allSymbols.push(...chunk.symbols);
      allDependencies.push(...chunk.dependencies);
      allImports.push(...chunk.imports);
      allExports.push(...chunk.exports);
      allErrors.push(...chunk.errors);
    }

    const mergedSymbols = this.removeDuplicateSymbols(allSymbols);
    const mergedDependencies = this.removeDuplicateDependencies(allDependencies);
    const mergedImports = this.removeDuplicateImports(allImports);
    const mergedExports = this.removeDuplicateExports(allExports);

    return {
      symbols: mergedSymbols,
      dependencies: mergedDependencies,
      imports: mergedImports,
      exports: mergedExports,
      errors: allErrors,
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunkMetadata.length,
        duplicatesRemoved: (allSymbols.length - mergedSymbols.length) +
                          (allDependencies.length - mergedDependencies.length),
        crossChunkReferencesFound: 0
      }
    };
  }

  protected convertMergedResult(mergedResult: MergedParseResult): ParseResult {
    return {
      symbols: mergedResult.symbols,
      dependencies: mergedResult.dependencies,
      imports: mergedResult.imports,
      exports: mergedResult.exports,
      errors: mergedResult.errors
    };
  }

  private removeDuplicateImports(imports: ParsedImport[]): ParsedImport[] {
    const seen = new Map<string, ParsedImport>();

    for (const imp of imports) {
      const key = `${imp.source}:${imp.imported_names.join(',')}:${imp.import_type}:${imp.line_number}`;
      if (!seen.has(key)) {
        seen.set(key, imp);
      }
    }

    return Array.from(seen.values());
  }

  private removeDuplicateExports(exports: ParsedExport[]): ParsedExport[] {
    const seen = new Map<string, ParsedExport>();

    for (const exp of exports) {
      const key = `${exp.exported_names.join(',')}:${exp.export_type}:${exp.source || ''}:${exp.line_number}`;
      if (!seen.has(key)) {
        seen.set(key, exp);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Extract syntax errors from the Tree-sitter AST
   */
  protected extractErrors(rootNode: Parser.SyntaxNode, content: string, tree?: Parser.Tree): ParseError[] {
    const errors: ParseError[] = [];
    const seenErrors = new Set<string>();

    // Check if Tree-sitter detected syntax errors at the tree level
    if (tree && tree.rootNode.hasError) {
      // If tree has error but no specific ERROR nodes, we need to create a general syntax error
      let hasSpecificErrors = false;

      // First, try to find specific ERROR nodes
      const findSpecificErrors = (node: Parser.SyntaxNode) => {
        if (node.type === 'ERROR') {
          hasSpecificErrors = true;
          const line = node.startPosition.row + 1;
          const column = node.startPosition.column + 1;
          // Get limited error text (first 50 chars)
          const errorText = this.getNodeText(node, content);
          const limitedErrorText = errorText.length > 50 ? errorText.substring(0, 50) + '...' : errorText;
          // Create unique key to avoid duplicates
          const errorKey = `${line}:${column}:${limitedErrorText}`;
          if (!seenErrors.has(errorKey)) {
            seenErrors.add(errorKey);
            let errorMessage = `Syntax error: unexpected token '${limitedErrorText.trim()}'`;

            // Add chunking context if file was processed in chunks
            if (this.wasChunked) {
              errorMessage += ' (Note: File was processed in chunks due to size. This may be a chunking boundary issue.)';
            }

            errors.push({
              message: errorMessage,
              line,
              column,
              severity: 'error'
            });
          }
        }
        // Recursively check all children
        for (const child of node.children) {
          findSpecificErrors(child);
        }
      };

      // Look for explicit ERROR nodes first
      findSpecificErrors(rootNode);

      // If no specific ERROR nodes found but tree has error, create a general error
      if (!hasSpecificErrors) {
        errors.push({
          message: 'Syntax error detected in file',
          line: 1,
          column: 1,
          severity: 'error'
        });
      }

      return errors;
    }

    // Fallback to original logic for explicit ERROR nodes only
    // Traverse the AST to find ERROR nodes
    const traverseForErrors = (node: Parser.SyntaxNode) => {
      if (node.type === 'ERROR') {
        const line = node.startPosition.row + 1;
        const column = node.startPosition.column + 1;

        // Get limited error text (first 50 chars)
        const errorText = this.getNodeText(node, content);
        const limitedErrorText = errorText.length > 50 ? errorText.substring(0, 50) + '...' : errorText;

        // Create unique key to avoid duplicates
        const errorKey = `${line}:${column}:${limitedErrorText}`;

        if (!seenErrors.has(errorKey)) {
          seenErrors.add(errorKey);
          errors.push({
            message: `Syntax error: unexpected token '${limitedErrorText.trim()}'`,
            line,
            column,
            severity: 'error'
          });
        }
      }

      // Recursively check all children
      for (const child of node.children) {
        traverseForErrors(child);
      }
    };

    traverseForErrors(rootNode);
    return errors;
  }
}