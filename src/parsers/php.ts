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
import { FrameworkParseOptions } from './base-framework';
import {
  ChunkedParser,
  MergedParseResult,
  ChunkedParseOptions,
  ChunkResult
} from './chunked-parser';
import { SymbolType, DependencyType, Visibility } from '../database/models';
import { entityClassifier } from '../utils/entity-classifier';
import { FrameworkDetector } from './utils/framework-detector';

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
 * PHP-specific node types for closure/anonymous function detection
 */
const PHP_CLOSURE_NODE_TYPES = new Set([
  'anonymous_function_creation_expression',
  'anonymous_function',
  'arrow_function',
]);

/**
 * PHP call type indicators for qualified context formatting
 */
const PHP_CALL_PATTERNS = {
  instanceCallPrefixes: ['$this->', '$'],
  staticCallSuffix: '::',
  instanceAccessOperator: '->',
  staticAccessOperator: '::',
  namespaceOperator: '\\',
  newOperator: 'new',
} as const;

/**
 * Maximum length for parameter representation before truncation
 */
const MAX_PARAMETER_LENGTH = 200;

interface PHPParsingContext {
  currentNamespace: string | null;
  currentClass: string | null;
  typeMap: Map<string, string>;
  parentClass: string | null;
  filePath: string;
  useStatements: ParsedImport[];
  options?: FrameworkParseOptions;
  // Eloquent relationship registry: ModelClass → { methodName → TargetModelClass }
  // Example: 'User' → { 'profile' → 'Profile', 'posts' → 'Post' }
  relationshipRegistry: Map<string, Map<string, string>>;
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

  private static readonly MODIFIER_KEYWORDS = new Set([
    'public',
    'protected',
    'private',
    'static',
    'abstract',
    'final',
  ]);

  constructor() {
    const parser = new Parser();
    parser.setLanguage(PHP);
    super(parser, 'php');
  }

  getSupportedExtensions(): string[] {
    return ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'];
  }

  /**
   * Detect Laravel framework patterns in file content
   */

  async parseFile(filePath: string, content: string, options?: FrameworkParseOptions): Promise<ParseResult> {
    // Auto-detect Laravel framework if not already set
    const repositoryFrameworks = options?.repositoryFrameworks;
    let enhancedOptions: FrameworkParseOptions;

    if (!options?.frameworkContext?.framework && FrameworkDetector.detectLaravel(content, repositoryFrameworks)) {
      enhancedOptions = {
        ...options,
        frameworkContext: {
          framework: 'laravel',
        },
      } as any;
    } else {
      enhancedOptions = options || {};
    }

    const validatedOptions = this.validateOptions(enhancedOptions);
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
      const chunkedResult = await this.parseFileInChunks(filePath, content, { ...chunkedOptions, ...(enhancedOptions as any) });
      return this.convertMergedResult(chunkedResult);
    }

    // For smaller files or when chunking is disabled, use direct parsing
    this.wasChunked = false;
    return this.parseFileDirectly(filePath, content, { ...chunkedOptions, ...(enhancedOptions as any) });
  }

  /**
   * Parse file directly without chunking (internal method to avoid recursion)
   */
  protected async parseFileDirectly(
    filePath: string,
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
      const result = this.performSinglePassExtraction(tree.rootNode, content, filePath, options as FrameworkParseOptions);
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

  protected performSinglePassExtraction(rootNode: Parser.SyntaxNode, content: string, filePath?: string, options?: FrameworkParseOptions): {
    symbols: ParsedSymbol[];
    dependencies: ParsedDependency[];
    imports: ParsedImport[];
    exports: ParsedExport[];
  } {
    const symbols: ParsedSymbol[] = [];
    const dependencies: ParsedDependency[] = [];
    const imports: ParsedImport[] = [];
    const exports: ParsedExport[] = [];

    const context: PHPParsingContext = {
      currentNamespace: null,
      currentClass: null,
      typeMap: new Map<string, string>(),
      parentClass: null,
      filePath: filePath || '',
      useStatements: [],
      options: options,
      // Use shared registry if provided, otherwise create new empty one
      relationshipRegistry: options?.eloquentRelationshipRegistry || new Map<string, Map<string, string>>(),
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
            const previousParent = context.parentClass;
            context.currentClass = symbol.name;
            context.parentClass = this.extractParentClass(node, content);

            for (const child of node.children) {
              traverse(child);
            }

            context.currentClass = previousClass;
            context.parentClass = previousParent;

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

            const typeDeps = this.extractMethodTypeDependencies(node, content, context);
            dependencies.push(...typeDeps);
          }
          break;
        }
        case 'method_declaration': {
          const symbol = this.extractMethodSymbol(node, content, context);
          if (symbol) {
            symbols.push(symbol);
            if (symbol.name === '__construct') {
              this.trackConstructorParameterTypes(node, content, context.typeMap);
              const constructorDeps = this.extractConstructorDependencies(
                node,
                content,
                context
              );
              dependencies.push(...constructorDeps);
            } else {
              const typeDeps = this.extractMethodTypeDependencies(node, content, context);
              dependencies.push(...typeDeps);
            }
            // Extract Eloquent relationship definitions for semantic analysis
            if (context.currentClass) {
              this.extractRelationshipDefinition(node, content, context);
            }
          }
          break;
        }
        case 'property_declaration': {
          const propertySymbols = this.extractPropertySymbols(node, content, context);
          symbols.push(...propertySymbols);
          this.trackPropertyTypes(node, content, context.typeMap);
          break;
        }
        case 'const_declaration': {
          const constSymbols = this.extractConstantSymbols(node, content);
          symbols.push(...constSymbols);
          break;
        }
        case 'function_call_expression': {
          const dependency = this.extractCallDependency(node, content, context);
          if (dependency) dependencies.push(dependency);
          break;
        }
        case 'member_call_expression': {
          const dependency = this.extractMethodCallDependency(node, content, context);
          if (dependency) dependencies.push(dependency);
          break;
        }
        case 'scoped_call_expression': {
          const scopedDeps = this.extractScopedCallDependency(node, content, context);
          if (scopedDeps) dependencies.push(...scopedDeps);
          break;
        }
        case 'object_creation_expression': {
          const dependency = this.extractNewDependency(node, content, context);
          if (dependency) dependencies.push(dependency);
          break;
        }
        case 'namespace_use_declaration': {
          const importInfo = this.extractUseStatement(node, content);
          if (importInfo) {
            imports.push(importInfo);
            context.useStatements.push(importInfo);
          }
          break;
        }
        case 'assignment_expression': {
          this.trackPropertyAssignment(node, content, context.typeMap);
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

    const useStatementDeps = this.convertUseStatementsToDependencies(
      imports,
      symbols,
      exports
    );
    dependencies.push(...useStatementDeps);

    // Extract containment relationships (classes/services containing methods)
    const containmentDeps = this.extractContainmentDependencies(symbols);
    dependencies.push(...containmentDeps);

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

  private extractClassSymbol(node: Parser.SyntaxNode, content: string, context: { currentNamespace: string | null; currentClass: string | null; filePath?: string; options?: FrameworkParseOptions }): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractClassSignature(node, content);
    const description = this.extractPhpDocComment(node, content);
    const qualifiedName = this.buildQualifiedName(context, name);

    // Extract base classes for entity classification
    const baseClasses = this.extractBaseClasses(node, content);

    // Classify entity type using configuration-driven classifier
    const frameworkContext = (context.options as any)?.frameworkContext?.framework;
    const classification = entityClassifier.classify(
      'class',
      name,
      baseClasses,
      context.filePath || '',
      frameworkContext,
      context.currentNamespace || undefined,
      context.options?.repositoryFrameworks
    );

    return {
      name,
      qualified_name: qualifiedName,
      symbol_type: SymbolType.CLASS,
      entity_type: classification.entityType,
      base_class: classification.baseClass || undefined,
      framework: classification.framework,
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

  private extractMethodSymbol(node: Parser.SyntaxNode, content: string, context: PHPParsingContext): ParsedSymbol | null {
    // Defensive validation: Only process actual method_declaration nodes
    // This prevents bugs where other statement nodes are mistakenly passed to this method
    if (node.type !== 'method_declaration') {
      return null;
    }

    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node);
    const paramsNode = node.childForFieldName('parameters');
    const params = paramsNode ? this.getNodeText(paramsNode, content) : '()';
    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode, content) : null;
    const signature = this.buildMethodSignature(name, modifiers, params, returnType);
    const visibility = this.extractVisibility(node, content);
    const description = this.extractPhpDocComment(node, content);

    let qualifiedName: string | undefined;
    if (context.currentClass) {
      const classQualifiedName = this.buildQualifiedName(context, context.currentClass);
      qualifiedName = `${classQualifiedName}::${name}`;
    }

    // Classify entity type using configuration-driven classifier
    const frameworkContext = (context.options as any)?.frameworkContext?.framework;
    const classification = entityClassifier.classify(
      'method',
      name,
      context.parentClass ? [context.parentClass] : [],
      context.filePath,
      frameworkContext,
      context.currentNamespace || undefined,
      context.options?.repositoryFrameworks
    );

    return {
      name,
      qualified_name: qualifiedName,
      symbol_type: SymbolType.METHOD,
      entity_type: classification.entityType,
      framework: classification.framework,
      base_class: classification.baseClass || undefined,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: visibility === Visibility.PUBLIC,
      visibility,
      signature,
      description,
    };
  }

  private extractPropertySymbols(node: Parser.SyntaxNode, content: string, context: PHPParsingContext): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    const visibility = this.extractVisibility(node, content);
    const description = this.extractPhpDocComment(node, content);

    // Property declarations can contain multiple properties
    const propertyElements = this.findNodesOfType(node, 'property_element');
    for (const element of propertyElements) {
      const nameNode = element.childForFieldName('name');
      if (nameNode) {
        const name = this.getNodeText(nameNode, content);
        const cleanName = name.replace('$', ''); // Remove $ prefix from PHP variables

        // Classify entity type using configuration-driven classifier
        const frameworkContext = (context.options as any)?.frameworkContext?.framework;
        const classification = entityClassifier.classify(
          'property',
          cleanName,
          context.parentClass ? [context.parentClass] : [],
          context.filePath,
          frameworkContext,
          context.currentNamespace || undefined,
          context.options?.repositoryFrameworks
        );

        symbols.push({
          name: cleanName,
          symbol_type: SymbolType.PROPERTY,
          entity_type: classification.entityType,
          framework: classification.framework,
          base_class: classification.baseClass || undefined,
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

  private extractBaseClasses(node: Parser.SyntaxNode, content: string): string[] {
    const baseClasses: string[] = [];

    /**
     * Manual iteration required because Tree-sitter's PHP grammar doesn't expose
     * base_clause as a named field. The childForFieldName('base_clause') approach
     * doesn't work - we must iterate through namedChildren to find nodes with
     * type === 'base_clause'. This is a limitation of the php-tree-sitter grammar.
     */
    let baseClauseNode: Parser.SyntaxNode | null = null;
    for (const child of node.namedChildren) {
      if (child.type === 'base_clause') {
        baseClauseNode = child;
        break;
      }
    }

    if (baseClauseNode) {
      // Iterate through children to find class name nodes
      for (const child of baseClauseNode.children) {
        if (child.type === 'name' || child.type === 'qualified_name' || child.type === 'namespace_name') {
          const className = this.getNodeText(child, content).trim();
          if (className) {
            baseClasses.push(className);
          }
        }
      }

      // Fallback: if no named children found, get the full text and clean it
      if (baseClasses.length === 0) {
        const fullText = this.getNodeText(baseClauseNode, content).replace(/^extends\s+/, '').trim();
        if (fullText) {
          baseClasses.push(fullText);
        }
      }
    }

    return baseClasses;
  }

  private extractFunctionSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    const parametersNode = node.childForFieldName('parameters');
    const returnTypeNode = node.childForFieldName('return_type');

    let signature = '';
    if (nameNode) {
      signature += this.getNodeText(nameNode, content);
    }

    if (parametersNode) {
      signature += this.getNodeText(parametersNode, content);
    }

    if (returnTypeNode) {
      signature += ': ' + this.getNodeText(returnTypeNode, content);
    }

    return signature;
  }

  private extractModifiers(node: Parser.SyntaxNode): string[] {
    const modifiers: string[] = [];

    for (const child of node.children) {
      if (child.type === 'visibility_modifier' && child.childCount > 0) {
        const visibilityType = child.child(0)?.type;
        if (visibilityType && PHPParser.MODIFIER_KEYWORDS.has(visibilityType)) {
          modifiers.push(visibilityType);
        }
      } else if (PHPParser.MODIFIER_KEYWORDS.has(child.type)) {
        modifiers.push(child.type);
      }
    }

    return modifiers;
  }

  private buildMethodSignature(name: string, modifiers: string[], params: string, returnType: string | null = null): string {
    const modifierString = modifiers.length > 0 ? modifiers.join(' ') + ' ' : '';
    const returnTypeString = returnType ? `: ${returnType}` : '';
    return `${modifierString}function ${name}${params}${returnTypeString}`;
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

  private extractCallDependency(
    node: Parser.SyntaxNode,
    content: string,
    context: PHPParsingContext
  ): ParsedDependency | null {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) return null;

    let functionName: string;

    if (functionNode.type === 'name') {
      functionName = this.getNodeText(functionNode, content);
    } else if (functionNode.type === 'qualified_name') {
      functionName = this.getNodeText(functionNode, content);
    } else {
      return null;
    }

    const callerName = this.findContainingFunction(node, content);
    const { values: parameters, types: parameterTypes } = this.extractCallParameters(node, content, context.typeMap);
    const qualifiedContext = this.generateQualifiedContext(context.currentNamespace, context.currentClass, '', functionName);
    const callInstanceId = this.generateCallInstanceId(context.currentClass, functionName, node.startPosition.row, node.startPosition.column);

    return {
      from_symbol: callerName,
      to_symbol: functionName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
      calling_object: undefined,
      resolved_class: undefined,
      qualified_context: qualifiedContext,
      parameter_context: parameters.length > 0 ? parameters.join(', ') : undefined,
      parameter_types: parameterTypes.length > 0 ? parameterTypes : undefined,
      call_instance_id: callInstanceId,
    };
  }

  private extractMethodCallDependency(
    node: Parser.SyntaxNode,
    content: string,
    context: PHPParsingContext
  ): ParsedDependency | null {
    const memberNode = node.childForFieldName('name');
    if (!memberNode) return null;

    const methodName = this.getNodeText(memberNode, content);
    const callerName = this.findContainingFunction(node, content);
    const callingObject = this.extractCallingObject(node, content);
    const resolvedClass = this.resolvePhpType(callingObject, context.typeMap, context);
    const { values: parameters, types: parameterTypes } = this.extractCallParameters(node, content, context.typeMap);
    const qualifiedContext = this.generateQualifiedContext(context.currentNamespace, context.currentClass, callingObject, methodName);
    const callInstanceId = this.generateCallInstanceId(context.currentClass, methodName, node.startPosition.row, node.startPosition.column);

    return {
      from_symbol: callerName,
      to_symbol: methodName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
      calling_object: callingObject || undefined,
      resolved_class: resolvedClass,
      qualified_context: qualifiedContext,
      parameter_context: parameters.length > 0 ? parameters.join(', ') : undefined,
      parameter_types: parameterTypes.length > 0 ? parameterTypes : undefined,
      call_instance_id: callInstanceId,
    };
  }

  private extractNewDependency(
    node: Parser.SyntaxNode,
    content: string,
    context: PHPParsingContext
  ): ParsedDependency | null {
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
    const { values: parameters, types: parameterTypes } = this.extractCallParameters(node, content, context.typeMap);
    const qualifiedContext = this.generateQualifiedContext(context.currentNamespace, context.currentClass, 'new', className);
    const callInstanceId = this.generateCallInstanceId(context.currentClass, className, node.startPosition.row, node.startPosition.column);

    return {
      from_symbol: callerName,
      to_symbol: className,
      dependency_type: DependencyType.REFERENCES,
      line_number: node.startPosition.row + 1,
      calling_object: undefined,
      resolved_class: className,
      qualified_context: qualifiedContext,
      parameter_context: parameters.length > 0 ? parameters.join(', ') : undefined,
      parameter_types: parameterTypes.length > 0 ? parameterTypes : undefined,
      call_instance_id: callInstanceId,
    };
  }

  private extractScopedCallDependency(
    node: Parser.SyntaxNode,
    content: string,
    context: PHPParsingContext
  ): ParsedDependency[] | null {
    const children = node.children;
    if (children.length < 3) return null;

    const classNode = children[0];
    const methodNode = children[2];

    if (classNode.type !== 'name' || methodNode.type !== 'name') return null;

    const className = this.getNodeText(classNode, content);
    const methodName = this.getNodeText(methodNode, content);
    const callerName = this.findContainingFunction(node, content);
    const callingObject = `${className}::`;

    let resolvedClass: string | null;
    let fullyQualifiedName: string | null = null;

    if (className === 'self' || className === 'static') {
      resolvedClass = context.currentClass;
      if (context.currentNamespace && context.currentClass) {
        fullyQualifiedName = `${context.currentNamespace}\\${context.currentClass}`;
      }
    } else if (className === 'parent') {
      resolvedClass = context.parentClass;
      if (context.currentNamespace && context.parentClass) {
        fullyQualifiedName = `${context.currentNamespace}\\${context.parentClass}`;
      }
    } else {
      resolvedClass = className;

      const normalizedClassName = className.replace(/^\\/, '');

      if (process.env.CLAUDE_COMPASS_DEBUG === 'true' && className === 'Personnel') {
        console.log('[PHP Parser Debug] Resolving Personnel static call', {
          className,
          normalizedClassName,
          useStatementsCount: context.useStatements.length,
          useStatements: context.useStatements.map(u => u.imported_names),
          currentNamespace: context.currentNamespace,
          filePath: context.filePath
        });
      }

      for (const useStmt of context.useStatements) {
        if (!useStmt.imported_names) continue;

        for (const importedName of useStmt.imported_names) {
          const parts = importedName.split('\\');
          const lastPart = parts[parts.length - 1];

          if (lastPart === normalizedClassName || importedName === normalizedClassName) {
            fullyQualifiedName = importedName;
            break;
          }

          if (importedName.endsWith(`\\${normalizedClassName}`)) {
            fullyQualifiedName = importedName;
            break;
          }
        }
        if (fullyQualifiedName) break;
      }

      if (!fullyQualifiedName && context.currentNamespace) {
        fullyQualifiedName = `${context.currentNamespace}\\${className}`;
      } else if (!fullyQualifiedName) {
        fullyQualifiedName = className;
      }

      if (process.env.CLAUDE_COMPASS_DEBUG === 'true' && className === 'Personnel') {
        console.log('[PHP Parser Debug] Final FQN for Personnel', {
          fullyQualifiedName,
          toQualifiedName: fullyQualifiedName ? `${fullyQualifiedName}::${methodName}` : undefined
        });
      }
    }

    const { values: parameters, types: parameterTypes } = this.extractCallParameters(node, content, context.typeMap);
    const qualifiedContext = this.generateQualifiedContext(context.currentNamespace, context.currentClass, callingObject, methodName);
    const callInstanceId = this.generateCallInstanceId(context.currentClass, methodName, node.startPosition.row, node.startPosition.column);

    const dependencies: ParsedDependency[] = [];

    // 1. Create 'calls' dependency to the method (existing behavior)
    dependencies.push({
      from_symbol: callerName,
      to_symbol: methodName,
      to_qualified_name: fullyQualifiedName ? `${fullyQualifiedName}::${methodName}` : undefined,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
      calling_object: callingObject,
      resolved_class: resolvedClass || undefined,
      qualified_context: qualifiedContext,
      parameter_context: parameters.length > 0 ? parameters.join(', ') : undefined,
      parameter_types: parameterTypes.length > 0 ? parameterTypes : undefined,
      call_instance_id: callInstanceId,
    });

    /**
     * Create class reference dependency for static calls to enable method-level model discovery.
     * Patterns like Model::with(...) require both method and class dependencies.
     * Without class-level references, models are only discovered via structural imports.
     */
    if (className !== 'self' && className !== 'static' && className !== 'parent') {
      dependencies.push({
        from_symbol: callerName,
        to_symbol: className,
        to_qualified_name: fullyQualifiedName,
        dependency_type: DependencyType.REFERENCES,
        line_number: node.startPosition.row + 1,
      });
    }

    /**
     * Parse Eloquent relationship strings in with() calls for semantic model resolution.
     * Resolves relationship chains like Model::with(['relation1.relation2']) via registry.
     */
    if (methodName === 'with' && node.namedChildCount > 0) {
      const relationshipDeps = this.extractEloquentRelationshipDependencies(
        node,
        content,
        callerName,
        className,
        fullyQualifiedName,
        context
      );
      dependencies.push(...relationshipDeps);
    }

    return dependencies;
  }

  /**
   * Extract dependencies from Eloquent with() relationship strings.
   * Uses pure semantic analysis via relationship registry.
   *
   * Best Practice Implementation:
   * - Parses relationship method definitions to build registry
   * - Only creates dependencies for verified relationships
   * - No convention-based guessing or fallbacks
   * - 100% accuracy: if not in registry, not in dependencies
   *
   * Example: Model::with(['profile.address'])
   * - Looks up User → profile → Profile (from registry)
   * - Looks up Profile → address → Address (from registry)
   * - Creates references only for verified relationships
   */
  private extractEloquentRelationshipDependencies(
    node: Parser.SyntaxNode,
    content: string,
    callerName: string,
    _baseClassName: string,
    _baseClassFQN: string | null,
    _context: PHPParsingContext
  ): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Find the arguments node (the array passed to with())
    const argumentsNode = node.childForFieldName('arguments');
    if (!argumentsNode) return dependencies;

    // Extract string literals from the array
    const relationshipStrings: string[] = [];
    const traverse = (n: Parser.SyntaxNode) => {
      if (n.type === 'string' || n.type === 'encapsed_string') {
        // Remove quotes from string literal
        let stringValue = this.getNodeText(n, content);
        stringValue = stringValue.replace(/^['"]|['"]$/g, '');
        if (stringValue) relationshipStrings.push(stringValue);
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) traverse(child);
      }
    };
    traverse(argumentsNode);

    // Process each relationship string
    for (const relString of relationshipStrings) {
      // Handle nested relationships: 'profile.address.city'
      const parts = relString.split('.');

      // Track current model as we follow the chain
      let currentModelClass = _baseClassName;

      for (const relationshipName of parts) {
        let targetModelClass: string | undefined;

        // PURE SEMANTIC ANALYSIS: Only use registry - no fallbacks, no guessing
        // If relationship not found in registry, skip it (may not be parsed yet or custom pattern)
        if (currentModelClass && _context.relationshipRegistry.has(currentModelClass)) {
          const classRelationships = _context.relationshipRegistry.get(currentModelClass)!;
          targetModelClass = classRelationships.get(relationshipName);
        }

        // Only create dependency if we found the relationship in the registry
        if (targetModelClass) {
          // Create reference dependency to the verified model
          // The resolver will handle FQN resolution using use statements
          dependencies.push({
            from_symbol: callerName,
            to_symbol: targetModelClass,
            to_qualified_name: undefined, // Resolver will determine FQN
            dependency_type: DependencyType.REFERENCES,
            line_number: node.startPosition.row + 1,
          });

          // Update current model for next iteration in chain
          currentModelClass = targetModelClass;
        } else {
          // Relationship not in registry - stop traversing this chain
          // This ensures we only track verified relationships
          break;
        }
      }
    }

    return dependencies;
  }

  /**
   * Extract Eloquent relationship definition from method body.
   * Parses: return $this->hasMany(Post::class);
   * Stores in registry: User → { posts → Post }
   *
   * Handles all Laravel relationship types:
   * - hasMany, hasOne, belongsTo, belongsToMany
   * - morphTo, morphOne, morphMany, morphToMany
   * - hasManyThrough, hasOneThrough
   */
  private extractRelationshipDefinition(
    methodNode: Parser.SyntaxNode,
    content: string,
    context: PHPParsingContext
  ): void {
    if (!context.currentClass) return;

    const methodName = methodNode.childForFieldName('name');
    if (!methodName) return;

    const methodNameStr = this.getNodeText(methodName, content);

    // Find return statement in method body
    const body = methodNode.childForFieldName('body');
    if (!body) return;

    // Traverse to find return statements
    const findReturnStatements = (node: Parser.SyntaxNode): Parser.SyntaxNode[] => {
      const returns: Parser.SyntaxNode[] = [];
      if (node.type === 'return_statement') {
        returns.push(node);
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) returns.push(...findReturnStatements(child));
      }
      return returns;
    };

    const returnStatements = findReturnStatements(body);

    // Laravel relationship method patterns
    const relationshipMethods = new Set([
      'hasMany', 'hasOne', 'belongsTo', 'belongsToMany',
      'morphTo', 'morphOne', 'morphMany', 'morphToMany', 'morphedByMany',
      'hasManyThrough', 'hasOneThrough'
    ]);

    for (const returnStmt of returnStatements) {
      // Look for member_call_expression ($this->hasMany(...))
      const findMemberCalls = (node: Parser.SyntaxNode): Parser.SyntaxNode[] => {
        const calls: Parser.SyntaxNode[] = [];
        if (node.type === 'member_call_expression') {
          calls.push(node);
        }
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) calls.push(...findMemberCalls(child));
        }
        return calls;
      };

      const memberCalls = findMemberCalls(returnStmt);

      for (const call of memberCalls) {
        const nameNode = call.childForFieldName('name');
        if (!nameNode) continue;

        const callMethod = this.getNodeText(nameNode, content);
        if (!relationshipMethods.has(callMethod)) continue;

        // Extract Model::class argument
        const argsNode = call.childForFieldName('arguments');
        if (!argsNode) continue;

        // Find class_constant_access_expression (Model::class)
        const findClassConstants = (node: Parser.SyntaxNode): Parser.SyntaxNode[] => {
          const constants: Parser.SyntaxNode[] = [];
          if (node.type === 'class_constant_access_expression') {
            constants.push(node);
          }
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child) constants.push(...findClassConstants(child));
          }
          return constants;
        };

        const classConstants = findClassConstants(argsNode);

        for (const constant of classConstants) {
          if (constant.children.length === 0) continue;
          const classNameNode = constant.children[0];
          if (!classNameNode || classNameNode.type !== 'name') continue;

          const targetModelName = this.getNodeText(classNameNode, content);

          // Store in registry: CurrentClass → { methodName → TargetModel }
          if (!context.relationshipRegistry.has(context.currentClass)) {
            context.relationshipRegistry.set(context.currentClass, new Map());
          }

          const classRelationships = context.relationshipRegistry.get(context.currentClass)!;
          classRelationships.set(methodNameStr, targetModelName);

          break; // Found the model, no need to check more constants in this call
        }
      }
    }
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

  private trackPropertyTypes(node: Parser.SyntaxNode, content: string, typeMap: Map<string, string>): void {
    const typeNode = node.childForFieldName('type');
    const propertyElements = this.findNodesOfType(node, 'property_element');

    let typeName: string | null = null;
    if (typeNode) {
      typeName = this.getNodeText(typeNode, content);
    } else {
      const docComment = this.extractPhpDocComment(node, content);
      if (docComment) {
        const varMatch = docComment.match(/@var\s+([^\s]+)/);
        if (varMatch) {
          typeName = varMatch[1];
        }
      }
    }

    if (typeName) {
      for (const element of propertyElements) {
        const nameNode = element.childForFieldName('name');
        if (nameNode) {
          const propertyName = this.getNodeText(nameNode, content).replace('$', '');
          typeMap.set(propertyName, typeName);
        }
      }
    }
  }

  private trackConstructorParameterTypes(node: Parser.SyntaxNode, content: string, typeMap: Map<string, string>): void {
    const parametersNode = node.childForFieldName('parameters');
    if (!parametersNode) return;

    for (const param of parametersNode.children) {
      if (param.type !== 'simple_parameter' && param.type !== 'property_promotion_parameter') continue;

      const typeNode = param.childForFieldName('type');
      const nameNode = param.childForFieldName('name');

      if (typeNode && nameNode) {
        const typeName = this.getNodeText(typeNode, content);
        const paramName = this.getNodeText(nameNode, content).replace('$', '');
        typeMap.set(paramName, typeName);
      }
    }
  }

  private trackPropertyAssignment(node: Parser.SyntaxNode, content: string, typeMap: Map<string, string>): void {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');

    if (!leftNode || !rightNode) return;

    if (leftNode.type === 'member_access_expression') {
      const objectNode = leftNode.childForFieldName('object');
      const nameNode = leftNode.childForFieldName('name');

      if (!objectNode || !nameNode) return;

      const objectText = this.getNodeText(objectNode, content);
      if (objectText !== '$this') return;

      const propertyName = this.getNodeText(nameNode, content);

      if (rightNode.type === 'object_creation_expression') {
        const classNode = rightNode.namedChild(0);
        if (classNode && (classNode.type === 'name' || classNode.type === 'qualified_name')) {
          let className = this.getNodeText(classNode, content);

          if (classNode.type === 'qualified_name') {
            const parts = className.split('\\');
            className = parts[parts.length - 1];
          }

          typeMap.set(propertyName, className);
        }
      }
    }
  }

  private extractParentClass(node: Parser.SyntaxNode, content: string): string | null {
    const baseClauseNode = node.childForFieldName('base_clause');
    if (!baseClauseNode) return null;

    const nameNode = baseClauseNode.childForFieldName('name');
    if (!nameNode) return null;

    return this.getNodeText(nameNode, content);
  }

  /**
   * Extract dependencies from constructor parameter type hints
   * Creates IMPORTS dependencies from class to each injected service
   */
  private extractConstructorDependencies(
    node: Parser.SyntaxNode,
    content: string,
    context: PHPParsingContext
  ): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];
    const parametersNode = node.childForFieldName('parameters');

    if (!parametersNode || !context.currentClass) {
      return dependencies;
    }

    for (const param of parametersNode.children) {
      if (param.type !== 'simple_parameter' && param.type !== 'property_promotion_parameter') {
        continue;
      }

      const typeNode = param.childForFieldName('type');
      if (!typeNode) continue;

      let typeName = this.getNodeText(typeNode, content).trim();

      if (this.isBuiltInType(typeName)) continue;

      typeName = typeName.replace(/^\?/, '');

      const unionTypes = typeName.split('|').map(t => t.trim());

      for (const singleType of unionTypes) {
        if (this.isBuiltInType(singleType)) continue;

        const fullyQualifiedType = this.resolveFQN(singleType, context);

        dependencies.push({
          from_symbol: context.currentClass,
          to_symbol: singleType,
          to_qualified_name: fullyQualifiedType,
          dependency_type: DependencyType.IMPORTS,
          line_number: param.startPosition.row + 1,
        });
      }
    }

    return dependencies;
  }

  /**
   * Check if type is a built-in PHP type (not a class)
   */
  private isBuiltInType(type: string): boolean {
    const builtIns = new Set([
      'string', 'int', 'float', 'bool', 'array', 'object',
      'mixed', 'void', 'null', 'callable', 'iterable',
      'self', 'parent', 'static', 'never', 'true', 'false'
    ]);
    return builtIns.has(type.toLowerCase());
  }

  /**
   * Resolve fully qualified name for a class
   * Uses use statements and namespace context
   */
  private resolveFQN(className: string, context: PHPParsingContext): string {
    if (className.startsWith('\\')) {
      return className;
    }

    for (const useStmt of context.useStatements) {
      if (!useStmt.imported_names) continue;

      for (const imported of useStmt.imported_names) {
        const parts = imported.split('\\');
        const lastPart = parts[parts.length - 1];

        if (lastPart === className || imported === className) {
          return imported;
        }

        if (imported.endsWith(`\\${className}`)) {
          return imported;
        }
      }
    }

    if (context.currentNamespace) {
      return `${context.currentNamespace}\\${className}`;
    }

    return className;
  }

  /**
   * Convert use statements to dependency edges
   * Creates IMPORTS and REFERENCES dependencies from current class to imported classes
   */
  private convertUseStatementsToDependencies(
    imports: ParsedImport[],
    symbols: ParsedSymbol[],
    exports: ParsedExport[]
  ): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    let fromSymbol = '';
    let fromSymbolLineNumber = 1;

    if (exports.length > 0 && exports[0].exported_names.length > 0) {
      fromSymbol = exports[0].exported_names[0];
    }

    if (!fromSymbol && symbols.length > 0) {
      const firstClass = symbols.find(
        s => s.symbol_type === SymbolType.CLASS ||
             s.symbol_type === SymbolType.INTERFACE ||
             s.symbol_type === SymbolType.TRAIT
      );
      fromSymbol = firstClass?.name || symbols[0].name;
    }

    if (!fromSymbol) {
      return dependencies;
    }

    const classSymbol = symbols.find(s => s.name === fromSymbol);
    if (classSymbol) {
      fromSymbolLineNumber = classSymbol.start_line;
    }

    for (const importInfo of imports) {
      if (importInfo.import_type === 'side_effect') {
        continue;
      }

      for (const importedName of importInfo.imported_names) {
        const parts = importedName.split('\\');
        const shortName = parts[parts.length - 1];

        dependencies.push({
          from_symbol: fromSymbol,
          to_symbol: shortName,
          to_qualified_name: importedName,
          dependency_type: DependencyType.IMPORTS,
          line_number: fromSymbolLineNumber,
          qualified_context: `use ${importedName}`,
        });

        dependencies.push({
          from_symbol: fromSymbol,
          to_symbol: shortName,
          to_qualified_name: importedName,
          dependency_type: DependencyType.REFERENCES,
          line_number: fromSymbolLineNumber,
          qualified_context: `use ${importedName}`,
        });
      }
    }

    return dependencies;
  }

  /**
   * Extract dependencies from method/function parameter type hints and return type hints
   * Creates REFERENCES dependencies to all type-hinted classes
   */
  private extractMethodTypeDependencies(
    node: Parser.SyntaxNode,
    content: string,
    context: PHPParsingContext
  ): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];
    const methodName = node.childForFieldName('name')
      ? this.getNodeText(node.childForFieldName('name')!, content)
      : 'anonymous';

    const parametersNode = node.childForFieldName('parameters');
    if (parametersNode) {
      for (const param of parametersNode.children) {
        if (param.type !== 'simple_parameter' && param.type !== 'property_promotion_parameter') {
          continue;
        }

        const typeNode = param.childForFieldName('type');
        if (!typeNode) continue;

        let typeName = this.getNodeText(typeNode, content).trim();
        if (this.isBuiltInType(typeName)) continue;

        typeName = typeName.replace(/^\?/, '');

        const unionTypes = typeName.split('|').map(t => t.trim());

        for (const singleType of unionTypes) {
          if (this.isBuiltInType(singleType)) continue;

          const fullyQualifiedType = this.resolveFQN(singleType, context);

          dependencies.push({
            from_symbol: methodName,
            to_symbol: singleType,
            to_qualified_name: fullyQualifiedType,
            dependency_type: DependencyType.REFERENCES,
            line_number: param.startPosition.row + 1,
            qualified_context: `parameter type hint in ${methodName}`,
          });
        }
      }
    }

    const returnTypeNode = node.childForFieldName('return_type');
    if (returnTypeNode) {
      let returnType = this.getNodeText(returnTypeNode, content).trim();

      if (!this.isBuiltInType(returnType)) {
        returnType = returnType.replace(/^\?/, '');

        const unionTypes = returnType.split('|').map(t => t.trim());

        for (const singleType of unionTypes) {
          if (this.isBuiltInType(singleType)) continue;

          const fullyQualifiedType = this.resolveFQN(singleType, context);

          dependencies.push({
            from_symbol: methodName,
            to_symbol: singleType,
            to_qualified_name: fullyQualifiedType,
            dependency_type: DependencyType.REFERENCES,
            line_number: returnTypeNode.startPosition.row + 1,
            qualified_context: `return type hint in ${methodName}`,
          });
        }
      }
    }

    return dependencies;
  }

  private extractCallingObject(node: Parser.SyntaxNode, content: string): string {
    const objectNode = node.childForFieldName('object');
    if (!objectNode) return '';

    return this.getNodeText(objectNode, content);
  }

  private resolvePhpType(objectExpression: string, typeMap: Map<string, string>, context: { parentClass: string | null; currentClass: string | null }): string | undefined {
    if (!objectExpression) return undefined;

    const cleanedObject = objectExpression.replace(/^\$this->/, '').replace(/^\$/, '');

    if (objectExpression === '$this' || objectExpression === 'this') {
      return context.currentClass || undefined;
    }

    if (objectExpression === 'self' || objectExpression === 'static') {
      return context.currentClass || undefined;
    }

    if (objectExpression === 'parent') {
      return context.parentClass || undefined;
    }

    return typeMap.get(cleanedObject);
  }

  private extractCallParameters(node: Parser.SyntaxNode, content: string, typeMap: Map<string, string>): { values: string[]; types: string[] } {
    const argumentsNode = node.childForFieldName('arguments');
    const values: string[] = [];
    const types: string[] = [];

    if (!argumentsNode) return { values, types };

    for (const child of argumentsNode.children) {
      if (child.type === 'argument') {
        const valueNode = child.namedChild(0);
        if (valueNode) {
          const value = this.getParameterRepresentation(valueNode, content);
          values.push(value);

          const inferredType = this.inferParameterType(valueNode, content, typeMap);
          types.push(inferredType);
        }
      }
    }

    return { values, types };
  }

  private getParameterRepresentation(node: Parser.SyntaxNode, content: string): string {
    if (this.isClosureOrAnonymousFunction(node)) {
      const useClause = this.extractClosureUseClause(node, content);
      return useClause ? `function() use (${useClause})` : 'closure';
    }

    const closureChild = this.findClosureInNode(node);
    if (closureChild) {
      const useClause = this.extractClosureUseClause(closureChild, content);
      return useClause ? `function() use (${useClause})` : 'closure';
    }

    const value = this.getNodeText(node, content);

    if (value.length > MAX_PARAMETER_LENGTH) {
      return value.substring(0, MAX_PARAMETER_LENGTH) + '...';
    }

    return value;
  }

  private findClosureInNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (this.isClosureOrAnonymousFunction(node)) {
      return node;
    }

    for (const child of node.children) {
      if (this.isClosureOrAnonymousFunction(child)) {
        return child;
      }
    }

    return null;
  }

  private isClosureOrAnonymousFunction(node: Parser.SyntaxNode): boolean {
    return PHP_CLOSURE_NODE_TYPES.has(node.type);
  }

  private extractClosureUseClause(node: Parser.SyntaxNode, content: string): string | null {
    if (!PHP_CLOSURE_NODE_TYPES.has(node.type)) {
      return null;
    }

    for (const child of node.children) {
      if (child.type === 'anonymous_function_use_clause') {
        const useText = this.getNodeText(child, content);
        return useText.replace(/^use\s*\(\s*/, '').replace(/\s*\)\s*$/, '');
      }
    }

    return null;
  }

  private inferParameterType(node: Parser.SyntaxNode, content: string, typeMap: Map<string, string>): string {
    if (this.isClosureOrAnonymousFunction(node)) {
      return 'callable';
    }

    switch (node.type) {
      case 'integer':
        return 'int';
      case 'float':
        return 'float';
      case 'string':
      case 'encapsed_string':
        return 'string';
      case 'true':
      case 'false':
        return 'bool';
      case 'null':
        return 'null';
      case 'array_creation_expression':
        return 'array';
      case 'object_creation_expression':
        const classNode = node.childForFieldName('class');
        if (classNode) {
          return this.getNodeText(classNode, content);
        }
        return 'object';
      case 'variable_name':
      case 'variable':
        const varName = this.getNodeText(node, content).replace('$', '');
        return typeMap.get(varName) || 'mixed';
      default:
        return 'mixed';
    }
  }

  private generateQualifiedContext(
    namespace: string | null,
    currentClass: string | null,
    callingObject: string,
    methodName: string
  ): string {
    const { namespaceOperator, staticAccessOperator, instanceAccessOperator, newOperator, staticCallSuffix } = PHP_CALL_PATTERNS;

    let context = '';

    if (namespace && currentClass) {
      context = `${namespace}${namespaceOperator}${currentClass}`;
    } else if (currentClass) {
      context = currentClass;
    }

    if (callingObject && callingObject.trim()) {
      const cleanedObject = callingObject.trim();

      if (cleanedObject === newOperator) {
        return methodName ? `${newOperator} ${methodName}` : newOperator;
      }

      if (cleanedObject.endsWith(staticCallSuffix)) {
        const staticClass = cleanedObject.slice(0, -staticCallSuffix.length);
        return methodName ? `${staticClass}${staticAccessOperator}${methodName}` : staticClass;
      }
      else if (this.isInstanceCall(cleanedObject)) {
        if (context) {
          return `${context}${staticAccessOperator}${cleanedObject}${instanceAccessOperator}${methodName}`;
        } else {
          return `${cleanedObject}${instanceAccessOperator}${methodName}`;
        }
      }
      else {
        if (context) {
          return `${context}${staticAccessOperator}${cleanedObject}${staticAccessOperator}${methodName}`;
        } else {
          return `${cleanedObject}${staticAccessOperator}${methodName}`;
        }
      }
    }

    if (methodName && !callingObject) {
      if (context) {
        return `${context}${staticAccessOperator}${methodName}`;
      } else {
        return methodName;
      }
    }

    return context;
  }

  private isInstanceCall(callingObject: string): boolean {
    const { instanceCallPrefixes, instanceAccessOperator } = PHP_CALL_PATTERNS;

    return instanceCallPrefixes.some(prefix => callingObject.startsWith(prefix)) ||
           callingObject.includes(instanceAccessOperator);
  }

  private generateCallInstanceId(currentClass: string | null, methodName: string, row: number, column: number): string {
    const className = currentClass || 'global';
    return `${className}_${methodName}_${row}_${column}`;
  }

  /**
   * Extract containment relationships between parent classes/services and their methods.
   * Creates CONTAINS dependencies when a class/interface/trait contains methods.
   * Uses line range overlap to identify parent-child relationships.
   *
   * NOTE: All symbols in the input array are from the same file (guaranteed by caller).
   * This method is called per-file during parsing, so same-file validation is implicit.
   *
   * Performance: O(n²) where n = number of symbols per file.
   * Acceptable because typical files have < 100 symbols, resulting in < 10k comparisons.
   * Early exit optimizations: skip if no line ranges, filter candidates by type first.
   */
  private extractContainmentDependencies(symbols: ParsedSymbol[]): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Potential child symbols: methods and functions
    const childCandidates = symbols.filter(
      s => s.symbol_type === SymbolType.METHOD || s.symbol_type === SymbolType.FUNCTION
    );

    // Potential parent symbols: classes, interfaces, traits, and entity types (services, controllers, models)
    const parentCandidates = symbols.filter(
      s => s.symbol_type === SymbolType.CLASS ||
           s.symbol_type === SymbolType.INTERFACE ||
           s.symbol_type === SymbolType.TRAIT ||
           s.entity_type === 'service' ||
           s.entity_type === 'controller' ||
           s.entity_type === 'model'
    );

    if (childCandidates.length === 0 || parentCandidates.length === 0) return dependencies;

    // For each symbol, check if it's nested inside another symbol
    for (const child of childCandidates) {
      for (const parent of parentCandidates) {
        // Skip self-comparison
        if (child === parent) continue;

        // Skip if they don't have proper line ranges
        if (!child.start_line || !child.end_line || !parent.start_line || !parent.end_line) {
          continue;
        }

        // Check if parent's line range fully contains the child
        const isContained =
          parent.start_line < child.start_line &&
          parent.end_line > child.end_line;

        if (isContained) {
          // Ensure we only capture direct containment (not grandparent)
          // by checking no other symbol is between them
          const hasIntermediateParent = parentCandidates.some(intermediate => {
            if (intermediate === parent || intermediate === child) return false;
            if (!intermediate.start_line || !intermediate.end_line) return false;

            const intermediateContainsChild =
              intermediate.start_line < child.start_line &&
              intermediate.end_line > child.end_line;

            const parentContainsIntermediate =
              parent.start_line < intermediate.start_line &&
              parent.end_line > intermediate.end_line;

            return intermediateContainsChild && parentContainsIntermediate;
          });

          if (!hasIntermediateParent) {
            dependencies.push({
              from_symbol: parent.name,
              to_symbol: child.name,
              dependency_type: DependencyType.CONTAINS,
              line_number: child.start_line,
            });
          }
        }
      }
    }

    return dependencies;
  }
}