import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import {
  BaseParser,
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
  ParseOptions,
  ParseError,
} from './base';
import { FrameworkParseOptions } from './base-framework';
import { createComponentLogger } from '../utils/logger';
import {
  extractJSDocComment as extractJSDoc,
  cleanJSDocComment as cleanJSDoc,
} from './utils/jsdoc-extractor';
import {
  ChunkedParser,
  MergedParseResult,
  ChunkedParseOptions,
  ChunkResult,
} from './chunked-parser';
import { SymbolType, DependencyType, Visibility } from '../database/models';
import { entityClassifier } from '../utils/entity-classifier';

const logger = createComponentLogger('javascript-parser');

/**
 * JavaScript-specific parser using Tree-sitter with chunked parsing support
 */
export class JavaScriptParser extends ChunkedParser {
  private static readonly BOUNDARY_PATTERNS = [
    /}\s*(?:;)?\s*(?:\n\s*\n|\n\s*\/\/|\n\s*\/\*)/g,
    /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+\w+[^}]*}\s*(?:;)?\s*\n/g,
    /function\s+\w+\s*\([^)]*\)\s*{[^}]*}\s*(?:;)?\s*\n/g,
    /(?:const|let|var)\s+\w+\s*=\s*\([^)]*\)\s*=>\s*{[^}]*}\s*(?:;)?\s*\n/g,
    /class\s+\w+(?:\s+extends\s+\w+)?\s*{[^}]*}\s*\n/g,
    /(?:const|let|var)\s+\w+\s*=\s*{[^}]*}\s*(?:;)?\s*\n/g,
    /\}\s*\)\s*\(\s*[^)]*\s*\)\s*(?:;)?\s*\n/g,
    /\w+\s*:\s*function\s*\([^)]*\)\s*{[^}]*}\s*,?\s*\n/g,
    /;\s*\n\s*\n/g,
    /}\s*\n/g,
  ];

  private static readonly MODIFIER_KEYWORDS = new Set([
    'async',
    'static',
    'get',
    'set',
  ]);

  private static readonly COMPONENT_RENDER_FUNCTIONS = new Set([
    'h',
    'jsx',
    '_jsx',
    '_jsxs',
    'createElement'
  ]);

  private static readonly MAX_VARIABLE_VALUE_LENGTH = 100;
  private static readonly MAX_CALL_SIGNATURE_LENGTH = 100;
  private static readonly MAX_ARGUMENT_TEXT_LENGTH = 30;
  private static readonly ELLIPSIS_LENGTH = 3;

  constructor() {
    const parser = new Parser();
    parser.setLanguage(JavaScript);
    super(parser, 'javascript');
  }

  getSupportedExtensions(): string[] {
    return ['.js', '.jsx', '.mjs', '.cjs'];
  }

  async parseFile(filePath: string, content: string, options?: ParseOptions): Promise<ParseResult> {
    const validatedOptions = this.validateOptions(options);
    const chunkedOptions = validatedOptions as ChunkedParseOptions;

    // Check file size limit first
    if (validatedOptions.maxFileSize && content.length > validatedOptions.maxFileSize) {
      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [
          {
            message: `File is too large (${content.length} bytes, limit: ${validatedOptions.maxFileSize} bytes)`,
            line: 1,
            column: 1,
            severity: 'error',
          },
        ],
      };
    }

    // Check if chunking should be used and is enabled
    if (
      chunkedOptions.enableChunking !== false &&
      content.length > (chunkedOptions.chunkSize || this.DEFAULT_CHUNK_SIZE)
    ) {
      // Merge chunkedOptions with original options to preserve frameworkContext
      const chunkedResult = await this.parseFileInChunks(filePath, content, {
        ...chunkedOptions,
        frameworkContext: options?.frameworkContext,
        repositoryFrameworks: options?.repositoryFrameworks,
      });
      return this.convertMergedResult(chunkedResult);
    }

    // For smaller files or when chunking is disabled, use direct parsing
    // Merge chunkedOptions with original options to preserve frameworkContext
    return this.parseFileDirectly(filePath, content, {
      ...chunkedOptions,
      frameworkContext: options?.frameworkContext,
      repositoryFrameworks: options?.repositoryFrameworks,
    });
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
        errors: [
          {
            message: 'Failed to parse syntax tree',
            line: 1,
            column: 1,
            severity: 'error',
          },
        ],
      };
    }

    try {
      this.clearNodeCache();
      const result = this.performSinglePassExtraction(tree.rootNode, content, filePath, options as FrameworkParseOptions);

      const deduplicatedSymbols = this.removeDuplicateSymbols(result.symbols);
      const deduplicatedDependencies = this.removeDuplicateDependencies(result.dependencies);
      const deduplicatedImports = this.removeDuplicateImports(result.imports);
      const deduplicatedExports = this.removeDuplicateExports(result.exports);

      return {
        symbols: validatedOptions.includePrivateSymbols
          ? deduplicatedSymbols
          : deduplicatedSymbols.filter(s => s.visibility !== 'private'),
        dependencies: deduplicatedDependencies,
        imports: deduplicatedImports,
        exports: deduplicatedExports,
        errors: [],
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

    const processedArrowFunctions = new Set<Parser.SyntaxNode>();

    const traverse = (node: Parser.SyntaxNode): void => {
      this.cacheNode(node.type, node);

      switch (node.type) {
        case 'function_declaration': {
          const symbol = this.extractFunctionSymbol(node, content, filePath, options);
          if (symbol) symbols.push(symbol);
          break;
        }
        case 'variable_declarator': {
          const symbol = this.extractVariableSymbol(node, content, filePath, options);
          if (symbol) symbols.push(symbol);
          const valueNode = node.childForFieldName('value');
          if (valueNode?.type === 'arrow_function') {
            processedArrowFunctions.add(valueNode);
          }

          if (valueNode?.type === 'call_expression') {
            const callee = valueNode.child(0);
            if (callee?.text === 'defineStore' && symbol) {
              const stateTypeDeps = this.extractStateFieldTypes(valueNode, symbol.name);
              dependencies.push(...stateTypeDeps);
            }
          }
          break;
        }
        case 'class_declaration': {
          if (this.isActualClassDeclaration(node, content)) {
            const symbol = this.extractClassSymbol(node, content, filePath, options);
            if (symbol) symbols.push(symbol);
          }
          break;
        }
        case 'method_definition': {
          // CRITICAL FIX: Reject method_definition nodes that are actually control flow statements
          // Control flow keywords (if, catch, while, etc.) are JavaScript reserved words and can
          // NEVER be legitimate method names. Tree-sitter occasionally reports these nodes when
          // parsing certain code patterns, but they represent impossible symbols that must be filtered.
          const nameNode = node.childForFieldName('name');
          const controlFlowKeywords = ['if', 'else', 'catch', 'while', 'for', 'do', 'switch', 'try'];
          const isControlFlow = nameNode && controlFlowKeywords.includes(nameNode.text);

          if (isControlFlow) {
            // Skip - control flow keywords cannot be method names
            break;
          }

          const symbol = this.extractMethodSymbol(node, content, filePath, options);
          if (symbol) {
            symbols.push(symbol);
          }
          break;
        }
        case 'arrow_function': {
          if (
            !processedArrowFunctions.has(node) &&
            node.parent?.type !== 'variable_declarator' &&
            node.parent?.type !== 'assignment_expression'
          ) {
            const symbol = this.extractArrowFunctionSymbol(node, content, filePath, options);
            if (symbol) symbols.push(symbol);
          }
          break;
        }
        case 'call_expression': {
          const dependency = this.extractCallDependency(node, content);
          if (dependency) dependencies.push(dependency);
          const calleeText = node.childForFieldName('function')
            ? this.getNodeText(node.childForFieldName('function')!, content)
            : '';
          if (calleeText === 'require' || calleeText === 'import') {
            const importInfo = this.extractRequireOrDynamicImport(node, content, calleeText);
            if (importInfo) imports.push(importInfo);
          }
          break;
        }
        case 'import_statement': {
          const importInfo = this.extractImportStatement(node, content);
          if (importInfo) imports.push(importInfo);
          break;
        }
        case 'export_statement': {
          const exportInfo = this.extractExportStatement(node, content);
          if (exportInfo) exports.push(exportInfo);
          const nodeText = this.getNodeText(node, content);
          if (nodeText.includes('default')) {
            const defaultExport = this.extractDefaultExport(node, content);
            if (defaultExport && defaultExport !== exportInfo) exports.push(defaultExport);
          }
          break;
        }
        case 'assignment_expression': {
          const leftNode = node.childForFieldName('left');
          if (leftNode) {
            const leftText = this.getNodeText(leftNode, content);
            if (leftText.startsWith('module.exports') || leftText.startsWith('exports.')) {
              const commonJSExport = this.extractCommonJSExport(node, content);
              if (commonJSExport) exports.push(commonJSExport);
            }
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

    return { symbols, dependencies, imports, exports };
  }

  private extractRequireOrDynamicImport(
    node: Parser.SyntaxNode,
    content: string,
    calleeText: string
  ): ParsedImport | null {
    const args = node.childForFieldName('arguments');
    if (!args || args.namedChildCount === 0) return null;

    const firstArg = args.namedChild(0);
    if (!firstArg || firstArg.type !== 'string') return null;

    const source = this.getNodeText(firstArg, content).replace(/['"]/g, '');

    return {
      source,
      imported_names: [],
      import_type: 'default',
      line_number: node.startPosition.row + 1,
      is_dynamic: calleeText === 'import',
    };
  }

  private extractCommonJSExport(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    const leftNode = node.childForFieldName('left');
    if (!leftNode) return null;

    const leftText = this.getNodeText(leftNode, content);

    return {
      exported_names: [leftText],
      export_type: 'named',
      line_number: node.startPosition.row + 1,
    };
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract function declarations
    const functionNodes = this.findNodesOfType(rootNode, 'function_declaration');
    for (const node of functionNodes) {
      const symbol = this.extractFunctionSymbol(node, content, undefined, undefined);
      if (symbol) symbols.push(symbol);
    }

    // Extract arrow functions assigned to variables
    const variableNodes = this.findNodesOfType(rootNode, 'variable_declarator');
    for (const node of variableNodes) {
      const symbol = this.extractVariableSymbol(node, content, undefined, undefined);
      if (symbol) symbols.push(symbol);
    }

    // Extract class declarations
    const classNodes = this.findNodesOfType(rootNode, 'class_declaration');
    for (const node of classNodes) {
      const symbol = this.extractClassSymbol(node, content, undefined, undefined);
      if (symbol) symbols.push(symbol);
    }

    // Extract method definitions
    const methodNodes = this.findNodesOfType(rootNode, 'method_definition');
    for (const node of methodNodes) {
      const symbol = this.extractMethodSymbol(node, content, undefined, undefined);
      if (symbol) symbols.push(symbol);
    }

    // Extract standalone arrow functions (not assigned to variables)
    const arrowNodes = this.findNodesOfType(rootNode, 'arrow_function');
    for (const node of arrowNodes) {
      // Skip arrow functions that are already captured as variable assignments
      if (
        node.parent?.type !== 'variable_declarator' &&
        node.parent?.type !== 'assignment_expression'
      ) {
        const symbol = this.extractArrowFunctionSymbol(node, content, undefined, undefined);
        if (symbol) symbols.push(symbol);
      }
    }

    return symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract function calls
    const callNodes = this.findNodesOfType(rootNode, 'call_expression');
    for (const node of callNodes) {
      const dependency = this.extractCallDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    return dependencies;
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Extract ES6 import declarations
    const importNodes = this.findNodesOfType(rootNode, 'import_statement');
    for (const node of importNodes) {
      const importInfo = this.extractImportStatement(node, content);
      if (importInfo) imports.push(importInfo);
    }

    // Extract CommonJS require calls
    const requireCalls = this.findRequireCalls(rootNode, content);
    imports.push(...requireCalls);

    // Extract dynamic imports
    const dynamicImports = this.findDynamicImports(rootNode, content);
    imports.push(...dynamicImports);

    return imports;
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];

    // Extract named exports
    const exportNodes = this.findNodesOfType(rootNode, 'export_statement');
    for (const node of exportNodes) {
      const exportInfo = this.extractExportStatement(node, content);
      if (exportInfo) exports.push(exportInfo);
    }

    // Extract default exports
    const defaultExportNodes = this.findNodesOfType(rootNode, 'export_statement').filter(node =>
      this.getNodeText(node, content).includes('default')
    );

    for (const node of defaultExportNodes) {
      const exportInfo = this.extractDefaultExport(node, content);
      if (exportInfo) exports.push(exportInfo);
    }

    // Extract CommonJS exports
    const commonJSExports = this.findCommonJSExports(rootNode, content);
    exports.push(...commonJSExports);

    return exports;
  }

  protected extractJSDocComment(node: Parser.SyntaxNode, content: string): string | undefined {
    return extractJSDoc(node, content);
  }

  protected cleanJSDocComment(commentText: string): string {
    return cleanJSDoc(commentText);
  }

  private extractFunctionSymbol(node: Parser.SyntaxNode, content: string, filePath?: string, options?: FrameworkParseOptions): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractFunctionSignature(node, content);
    const description = this.extractJSDocComment(node, content);

    const frameworkContext = options?.frameworkContext?.framework;

    const classification = entityClassifier.classify(
      'function',
      name,
      [],
      filePath || '',
      frameworkContext,
      undefined,
      options?.repositoryFrameworks
    );

    const isExported = this.isSymbolExported(node, name, content);

    // Override entity_type for Vue composables
    // Only exported functions matching use*/create* patterns should be composables
    // Non-exported helper functions should remain as regular functions
    let entityType = classification.entityType;
    if (
      frameworkContext === 'vue' &&
      classification.entityType === 'composable' &&
      !isExported
    ) {
      entityType = 'function';
    }

    return {
      name,
      symbol_type: SymbolType.FUNCTION,
      entity_type: entityType,
      base_class: classification.baseClass || undefined,
      framework: classification.framework,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: isExported,
      signature,
      description,
    };
  }

  private extractVariableSymbol(node: Parser.SyntaxNode, content: string, filePath?: string, options?: FrameworkParseOptions): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    const valueNode = node.childForFieldName('value');

    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    let symbolType = SymbolType.VARIABLE;
    let signature: string | undefined;

    if (valueNode) {
      if (valueNode.type === 'arrow_function') {
        symbolType = SymbolType.FUNCTION;
        signature = this.buildArrowFunctionSignature(valueNode, content);
      } else if (valueNode.type === 'function_expression') {
        symbolType = SymbolType.FUNCTION;
        signature = this.buildFunctionExpressionSignature(valueNode, content);
      } else if (valueNode.type === 'call_expression') {
        signature = this.buildCallExpressionSignature(valueNode, content);
      } else if (valueNode.type === 'object') {
        signature = '{...}';
      } else if (valueNode.type === 'array') {
        signature = '[...]';
      } else {
        const valueText = this.getNodeText(valueNode, content);
        signature = valueText.length > JavaScriptParser.MAX_VARIABLE_VALUE_LENGTH
          ? valueText.substring(0, JavaScriptParser.MAX_VARIABLE_VALUE_LENGTH) + '...'
          : valueText;
      }
    }

    const parent = node.parent;
    if (parent && parent.type === 'variable_declaration') {
      const kind = parent.childForFieldName('kind');
      if (kind && this.getNodeText(kind, content) === 'const') {
        symbolType = SymbolType.CONSTANT;
      }
    }

    const description = this.extractJSDocComment(node, content);

    const frameworkContext = options?.frameworkContext?.framework;

    const classification = entityClassifier.classify(
      symbolType === SymbolType.FUNCTION ? 'function' : 'variable',
      name,
      [],
      filePath || '',
      frameworkContext,
      undefined,
      options?.repositoryFrameworks
    );

    // Override entity_type for Pinia store definitions (Vue framework)
    // Detect defineStore() calls to distinguish actual store definitions
    // from store usages (e.g., const x = useXxxStore())
    let entityType = classification.entityType;
    if (
      frameworkContext === 'vue' &&
      signature &&
      signature.includes('defineStore(')
    ) {
      entityType = 'store';
    }

    const isExported = this.isSymbolExported(node, name, content);

    // Override entity_type for Vue composables (arrow functions)
    // Only exported arrow functions matching use*/create* patterns should be composables
    // Non-exported helper arrow functions should remain as regular functions
    if (
      frameworkContext === 'vue' &&
      classification.entityType === 'composable' &&
      !isExported
    ) {
      entityType = 'function';
    }

    return {
      name,
      symbol_type: symbolType,
      entity_type: entityType,
      framework: classification.framework,
      base_class: classification.baseClass || undefined,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: isExported,
      signature,
      description,
    };
  }

  private extractClassSymbol(node: Parser.SyntaxNode, content: string, filePath?: string, options?: FrameworkParseOptions): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const description = this.extractJSDocComment(node, content);

    // Extract base classes for classification
    const baseClasses: string[] = [];
    const heritageNode = node.childForFieldName('heritage');
    if (heritageNode) {
      const baseClassName = this.getNodeText(heritageNode, content).replace(/^extends\s+/, '').trim();
      if (baseClassName) {
        baseClasses.push(baseClassName);
      }
    }

    const frameworkContext = options?.frameworkContext?.framework;

    const classification = entityClassifier.classify(
      'class',
      name,
      baseClasses,
      filePath || '',
      frameworkContext,
      undefined,
      options?.repositoryFrameworks
    );

    return {
      name,
      symbol_type: SymbolType.CLASS,
      entity_type: classification.entityType,
      base_class: classification.baseClass || undefined,
      framework: classification.framework,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      description,
    };
  }

  private extractMethodSymbol(node: Parser.SyntaxNode, content: string, filePath?: string, options?: FrameworkParseOptions): ParsedSymbol | null {
    // Defensive validation: Only process actual method_definition nodes
    if (node.type !== 'method_definition') {
      return null;
    }

    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    if (name === 'constructor') {
      return null;
    }

    const modifiers = this.extractModifiers(node);
    const paramsNode = node.childForFieldName('parameters');
    const params = paramsNode ? this.getNodeText(paramsNode, content) : '()';
    const signature = this.buildMethodSignature(name, modifiers, params);
    const description = this.extractJSDocComment(node, content);

    let visibility: Visibility | undefined;
    if (name.startsWith('#')) {
      visibility = Visibility.PRIVATE;
    } else if (name.startsWith('_')) {
      visibility = Visibility.PRIVATE;
    }

    const frameworkContext = options?.frameworkContext?.framework;

    const classification = entityClassifier.classify(
      'method',
      name,
      [],
      filePath || '',
      frameworkContext,
      undefined,
      options?.repositoryFrameworks
    );

    return {
      name,
      symbol_type: SymbolType.METHOD,
      entity_type: classification.entityType,
      framework: classification.framework,
      base_class: classification.baseClass || undefined,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: false,
      visibility,
      signature,
      description,
    };
  }

  private extractArrowFunctionSymbol(
    node: Parser.SyntaxNode,
    content: string,
    filePath?: string,
    options?: FrameworkParseOptions
  ): ParsedSymbol | null {
    const frameworkContext = options?.frameworkContext?.framework;

    const classification = entityClassifier.classify(
      'function',
      'arrow_function',
      [],
      filePath || '',
      frameworkContext,
      undefined,
      options?.repositoryFrameworks
    );

    return {
      name: 'arrow_function',
      symbol_type: SymbolType.FUNCTION,
      entity_type: classification.entityType,
      framework: classification.framework,
      base_class: classification.baseClass || undefined,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: false,
      visibility: Visibility.PRIVATE,
      signature: this.buildArrowFunctionSignature(node, content),
    };
  }

  /**
   * Extract component reference from render function first argument
   * Returns component name and line number if valid component reference found
   *
   * Uses heuristics to distinguish React/Vue components (PascalCase) from
   * constants (UPPER_CASE) and regular identifiers (camelCase)
   */
  private extractComponentReference(
    callNode: Parser.SyntaxNode,
    content: string
  ): { name: string; lineNumber: number } | null {
    const args = callNode.childForFieldName('arguments');
    if (!args || args.namedChildCount === 0) return null;

    const firstArg = args.namedChild(0);
    if (!firstArg) return null;

    if (firstArg.type !== 'identifier') return null;

    const componentName = this.getNodeText(firstArg, content);

    if (!this.isPascalCaseComponent(componentName)) return null;

    return {
      name: componentName,
      lineNumber: firstArg.startPosition.row + 1
    };
  }

  /**
   * Check if a name follows PascalCase component naming convention
   * Returns true for: MyComponent, Button, UserProfile
   * Returns false for: CONSTANTS, MY_ENUM, camelCase, _private
   */
  private isPascalCaseComponent(name: string): boolean {
    if (name.length === 0) return false;

    if (name[0] !== name[0].toUpperCase()) return false;

    if (name === name.toUpperCase()) return false;

    if (name.includes('_')) return false;

    return true;
  }

  /**
   * Find the containing function for a call expression node by traversing up the AST
   */
  private findContainingFunction(callNode: Parser.SyntaxNode): string {
    let parent = callNode.parent;

    // Walk up the AST to find containing function or method
    while (parent) {
      if (
        parent.type === 'function_declaration' ||
        parent.type === 'function_expression' ||
        parent.type === 'arrow_function' ||
        parent.type === 'method_definition'
      ) {
        // Extract name from the function node
        if (parent.type === 'function_declaration') {
          const nameNode = parent.childForFieldName('name');
          if (nameNode) return nameNode.text;
        }
        if (parent.type === 'method_definition') {
          const keyNode = parent.childForFieldName('key');
          if (keyNode) return keyNode.text;
        }
        // For arrow functions and function expressions, return a generic name
        return parent.type === 'arrow_function' ? 'arrow_function' : 'function_expression';
      }
      parent = parent.parent;
    }

    return 'global';
  }

  private extractCallDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) return null;

    let functionName: string;

    if (functionNode.type === 'identifier') {
      functionName = this.getNodeText(functionNode, content);

      if (JavaScriptParser.COMPONENT_RENDER_FUNCTIONS.has(functionName)) {
        const componentRef = this.extractComponentReference(node, content);
        if (componentRef) {
          const callerName = this.findContainingFunction(node);
          return {
            from_symbol: callerName,
            to_symbol: componentRef.name,
            dependency_type: DependencyType.REFERENCES,
            line_number: componentRef.lineNumber,
          };
        }
      }
    } else if (functionNode.type === 'member_expression') {
      const objectNode = functionNode.childForFieldName('object');
      const propertyNode = functionNode.childForFieldName('property');

      if (objectNode && propertyNode) {
        const objectName = this.getNodeText(objectNode, content);
        const propertyName = this.getNodeText(propertyNode, content);

        if (objectName === 'React' && propertyName === 'createElement') {
          const componentRef = this.extractComponentReference(node, content);
          if (componentRef) {
            const callerName = this.findContainingFunction(node);
            return {
              from_symbol: callerName,
              to_symbol: componentRef.name,
              dependency_type: DependencyType.REFERENCES,
              line_number: componentRef.lineNumber,
            };
          }
        }
      }

      if (!propertyNode) return null;
      functionName = this.getNodeText(propertyNode, content);
    } else {
      return null;
    }

    const callerName = this.findContainingFunction(node);

    return {
      from_symbol: callerName,
      to_symbol: functionName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
    };
  }

  private extractImportStatement(node: Parser.SyntaxNode, content: string): ParsedImport | null {
    const importedNames: string[] = [];
    let importType: 'named' | 'default' | 'namespace' | 'side_effect' = 'side_effect';
    let source = '';

    // Check if this is a side effect import (no import clause)
    const secondChild = node.child(1);
    if (!secondChild) return null;

    if (secondChild.type === 'string') {
      // Side effect import: import './styles.css';
      source = this.getNodeText(secondChild, content).replace(/['"]/g, '');
      importType = 'side_effect';
    } else if (secondChild.type === 'import_clause') {
      // Import with clause: import React from 'react'; or import { useState } from 'react';
      const sourceNode = node.child(3); // Source is at position 3 for imports with clauses
      if (!sourceNode || sourceNode.type !== 'string') return null;

      source = this.getNodeText(sourceNode, content).replace(/['"]/g, '');

      // Analyze the import clause to determine type and extract names
      const clauseChild = secondChild.child(0);
      if (!clauseChild) return null;

      if (clauseChild.type === 'identifier') {
        // Default import: import React from 'react';
        importType = 'default';
        importedNames.push(this.getNodeText(clauseChild, content));
      } else if (clauseChild.type === 'named_imports') {
        // Named import: import { useState, useEffect } from 'react';
        importType = 'named';

        // Extract all import specifiers
        for (let i = 0; i < clauseChild.childCount; i++) {
          const child = clauseChild.child(i);
          if (child.type === 'import_specifier') {
            const nameNode = child.child(0); // The identifier is the first child
            if (nameNode && nameNode.type === 'identifier') {
              importedNames.push(this.getNodeText(nameNode, content));
            }
          }
        }
      } else if (clauseChild.type === 'namespace_import') {
        // Namespace import: import * as utils from './utils';
        importType = 'namespace';

        // The alias is the last child of namespace_import
        const aliasNode = clauseChild.child(clauseChild.childCount - 1);
        if (aliasNode && aliasNode.type === 'identifier') {
          importedNames.push(this.getNodeText(aliasNode, content));
        }
      }
    } else {
      return null; // Unknown import structure
    }

    return {
      source,
      imported_names: importedNames,
      import_type: importType,
      line_number: node.startPosition.row + 1,
      is_dynamic: false,
    };
  }

  private findRequireCalls(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const callNodes = this.findNodesOfType(rootNode, 'call_expression');

    for (const node of callNodes) {
      const functionNode = node.childForFieldName('function');
      if (!functionNode || this.getNodeText(functionNode, content) !== 'require') {
        continue;
      }

      const args = node.childForFieldName('arguments');
      if (!args || args.namedChildCount === 0) continue;

      const firstArg = args.namedChild(0);
      if (!firstArg || firstArg.type !== 'string') continue;

      const source = this.getNodeText(firstArg, content).replace(/['"]/g, '');

      imports.push({
        source,
        imported_names: [], // CommonJS doesn't have named imports in the same way
        import_type: 'default',
        line_number: node.startPosition.row + 1,
        is_dynamic: false,
      });
    }

    return imports;
  }

  private findDynamicImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const callNodes = this.findNodesOfType(rootNode, 'call_expression');

    for (const node of callNodes) {
      const functionNode = node.childForFieldName('function');
      if (!functionNode || this.getNodeText(functionNode, content) !== 'import') {
        continue;
      }

      const args = node.childForFieldName('arguments');
      if (!args || args.namedChildCount === 0) continue;

      const firstArg = args.namedChild(0);
      if (!firstArg || firstArg.type !== 'string') continue;

      const source = this.getNodeText(firstArg, content).replace(/['"]/g, '');

      imports.push({
        source,
        imported_names: [],
        import_type: 'default',
        line_number: node.startPosition.row + 1,
        is_dynamic: true,
      });
    }

    return imports;
  }

  private extractExportStatement(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    const exportedNames: string[] = [];
    let exportType: 'named' | 'default' | 're_export' = 'named';
    let source: string | undefined;

    // Handle different export patterns
    const nodeText = this.getNodeText(node, content);

    if (nodeText.includes('export default')) {
      exportType = 'default';
    } else if (nodeText.includes('export * from')) {
      exportType = 're_export';
    }

    // Extract source if it's a re-export
    const sourceNode = node.childForFieldName('source');
    if (sourceNode) {
      source = this.getNodeText(sourceNode, content).replace(/['"]/g, '');
    }

    return {
      exported_names: exportedNames,
      export_type: exportType,
      source,
      line_number: node.startPosition.row + 1,
    };
  }

  private extractDefaultExport(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    return {
      exported_names: ['default'],
      export_type: 'default',
      line_number: node.startPosition.row + 1,
    };
  }

  private findCommonJSExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];
    const assignmentNodes = this.findNodesOfType(rootNode, 'assignment_expression');

    for (const node of assignmentNodes) {
      const leftNode = node.childForFieldName('left');
      if (!leftNode) continue;

      const leftText = this.getNodeText(leftNode, content);
      if (leftText.startsWith('module.exports') || leftText.startsWith('exports.')) {
        exports.push({
          exported_names: [leftText],
          export_type: 'named',
          line_number: node.startPosition.row + 1,
        });
      }
    }

    return exports;
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

  private buildArrowFunctionSignature(node: Parser.SyntaxNode, content: string): string {
    let signature = '';

    for (const child of node.children) {
      if (child.type === 'async') {
        signature += 'async ';
        break;
      }
    }

    const paramsNode = node.childForFieldName('parameters');
    if (paramsNode) {
      signature += this.getNodeText(paramsNode, content);
    } else {
      for (const child of node.children) {
        if (child.type === 'identifier') {
          signature += this.getNodeText(child, content);
          break;
        }
      }
    }

    signature += ' => ';

    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      if (bodyNode.type === 'statement_block') {
        signature += '{...}';
      } else {
        signature += '...';
      }
    }

    return signature;
  }

  private buildFunctionExpressionSignature(node: Parser.SyntaxNode, content: string): string {
    let signature = '';

    for (const child of node.children) {
      if (child.type === 'async') {
        signature += 'async ';
        break;
      }
    }

    signature += 'function';

    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      signature += ' ' + this.getNodeText(nameNode, content);
    }

    const paramsNode = node.childForFieldName('parameters');
    if (paramsNode) {
      signature += this.getNodeText(paramsNode, content);
    }

    return signature;
  }

  private buildCallExpressionSignature(
    node: Parser.SyntaxNode,
    content: string,
    maxLength: number = JavaScriptParser.MAX_CALL_SIGNATURE_LENGTH
  ): string {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) return '';

    let signature = this.getNodeText(functionNode, content);
    signature += '(';

    const argsNode = node.childForFieldName('arguments');
    if (argsNode) {
      const args: string[] = [];
      for (let i = 0; i < argsNode.namedChildCount; i++) {
        const arg = argsNode.namedChild(i);
        if (arg) {
          const argText = this.getNodeText(arg, content);
          if (argText.length > JavaScriptParser.MAX_ARGUMENT_TEXT_LENGTH) {
            if (arg.type === 'string') {
              args.push('"..."');
            } else if (arg.type === 'object') {
              args.push('{...}');
            } else if (arg.type === 'array') {
              args.push('[...]');
            } else {
              args.push('...');
            }
          } else {
            args.push(argText);
          }
        }
      }
      signature += args.join(', ');
    }

    signature += ')';

    if (signature.length > maxLength) {
      signature = signature.substring(0, maxLength - JavaScriptParser.ELLIPSIS_LENGTH) + '...';
    }

    return signature;
  }

  protected extractModifiers(node: Parser.SyntaxNode): string[] {
    const modifiers: string[] = [];

    for (const child of node.children) {
      if (JavaScriptParser.MODIFIER_KEYWORDS.has(child.type)) {
        modifiers.push(child.type);
      }
    }

    return modifiers;
  }

  private buildMethodSignature(name: string, modifiers: string[], params: string): string {
    const modifierString = modifiers.length > 0 ? modifiers.join(' ') + ' ' : '';
    return `${modifierString}${name}${params}`;
  }

  /**
   * Validate that a node is actually a class declaration and not misclassified
   * Prevents false positive class detection from import statements or other contexts
   */
  private isActualClassDeclaration(node: Parser.SyntaxNode, content: string): boolean {
    const parent = node.parent;
    if (!parent) return true;

    if (parent.type === 'import_statement' || parent.type === 'import_clause' || parent.type === 'import_specifier') {
      return false;
    }

    if (parent.type === 'export_statement') {
      const declaration = parent.childForFieldName('declaration');
      if (declaration && declaration.id === node.id) {
        return true;
      }
    }

    const nodeText = this.getNodeText(node, content);
    return /^\s*(?:export\s+)?(?:default\s+)?class\s+/i.test(nodeText);
  }

  /**
   * Find optimal chunk boundaries for JavaScript/TypeScript content
   * Returns array of character positions where chunks should end, in order of preference
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries: number[] = [];

    // Search within 85% of max size for safe boundaries
    const searchLimit = Math.floor(maxChunkSize * 0.85);
    const searchContent = content.substring(0, Math.min(searchLimit, content.length));

    const boundaryPatterns = JavaScriptParser.BOUNDARY_PATTERNS;

    for (const pattern of boundaryPatterns) {
      let match;
      while ((match = pattern.exec(searchContent)) !== null) {
        const position = match.index + match[0].length;
        if (position > 100 && position < searchLimit) {
          // Ensure reasonable minimum chunk size
          boundaries.push(position);
        }
      }
    }

    // Sort boundaries by position (descending - prefer later boundaries for larger chunks)
    return [...new Set(boundaries)].sort((a, b) => b - a);
  }

  /**
   * Merge results from multiple chunks, handling duplicates and cross-chunk references
   */
  protected mergeChunkResults(
    chunks: ParseResult[],
    chunkMetadata: ChunkResult[]
  ): MergedParseResult {
    const allSymbols: ParsedSymbol[] = [];
    const allDependencies: ParsedDependency[] = [];
    const allImports: ParsedImport[] = [];
    const allExports: ParsedExport[] = [];
    const allErrors: ParseError[] = [];

    // Collect all results
    for (const chunk of chunks) {
      allSymbols.push(...chunk.symbols);
      allDependencies.push(...chunk.dependencies);
      allImports.push(...chunk.imports);
      allExports.push(...chunk.exports);
      // Filter out known false positive errors before adding them
      const filteredErrors = this.filterFalsePositiveErrors(chunk.errors);
      allErrors.push(...filteredErrors);
    }

    // Remove duplicates using inherited utility methods
    const mergedSymbols = this.removeDuplicateSymbols(allSymbols);
    const mergedDependencies = this.removeDuplicateDependencies(allDependencies);
    const mergedImports = this.removeDuplicateImports(allImports);
    const mergedExports = this.removeDuplicateExports(allExports);

    // Detect cross-chunk references
    const crossChunkReferences = this.detectCrossChunkReferences(
      mergedSymbols,
      mergedDependencies,
      chunkMetadata
    );

    return {
      symbols: mergedSymbols,
      dependencies: mergedDependencies,
      imports: mergedImports,
      exports: mergedExports,
      errors: allErrors,
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunkMetadata.length,
        duplicatesRemoved:
          allSymbols.length -
          mergedSymbols.length +
          (allDependencies.length - mergedDependencies.length),
        crossChunkReferencesFound: crossChunkReferences,
      },
    };
  }

  /**
   * Convert MergedParseResult to regular ParseResult
   */
  protected convertMergedResult(mergedResult: MergedParseResult): ParseResult {
    return {
      symbols: mergedResult.symbols,
      dependencies: mergedResult.dependencies,
      imports: mergedResult.imports,
      exports: mergedResult.exports,
      errors: mergedResult.errors,
    };
  }

  /**
   * Remove duplicate imports across chunks
   */
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

  /**
   * Remove duplicate exports across chunks
   */
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
   * Detect references that span across chunks
   */
  private detectCrossChunkReferences(
    symbols: ParsedSymbol[],
    dependencies: ParsedDependency[],
    chunkMetadata: ChunkResult[]
  ): number {
    let crossReferences = 0;

    for (const dep of dependencies) {
      const fromSymbol = symbols.find(s => s.name === dep.from_symbol);
      const toSymbol = symbols.find(s => s.name === dep.to_symbol);

      if (fromSymbol && toSymbol) {
        // Find which chunks these symbols belong to
        const fromChunk = chunkMetadata.findIndex(
          chunk => dep.line_number >= chunk.startLine && dep.line_number <= chunk.endLine
        );
        const toChunkFrom = chunkMetadata.findIndex(
          chunk =>
            fromSymbol.start_line >= chunk.startLine && fromSymbol.start_line <= chunk.endLine
        );
        const toChunkTo = chunkMetadata.findIndex(
          chunk => toSymbol.start_line >= chunk.startLine && toSymbol.start_line <= chunk.endLine
        );

        // If symbols are in different chunks, it's a cross-chunk reference
        if (toChunkFrom !== toChunkTo && toChunkFrom !== -1 && toChunkTo !== -1) {
          crossReferences++;
        }
      }
    }

    return crossReferences;
  }

  /**
   * Filter out known false positive parsing errors
   */
  private filterFalsePositiveErrors(errors: ParseError[]): ParseError[] {
    return errors.filter(error => {
      const message = error.message.toLowerCase();

      // Filter out common false positive patterns
      const falsePositivePatterns = [
        // External type definition errors
        'google.maps',
        'google.analytics',
        'microsoft.maps',

        // TypeScript interface parsing issues
        'parsing error in error: interface',
        'parsing error in labeled_statement',
        'parsing error in expression_statement',
        'parsing error in subscript_expression',
        'parsing error in identifier:',

        // Vue script section false positives
        'syntax errors in vue script section',

        // Generic type errors
        'parsing error in program',
        'parsing error in statement_block',

        // Empty or minimal errors that provide no value
        'parsing error in identifier: \n',
        'parsing error in identifier: ',
      ];

      // Check if error message contains any false positive pattern
      const isFalsePositive = falsePositivePatterns.some(pattern => message.includes(pattern));

      if (isFalsePositive) {
        return false;
      }

      return true;
    });
  }

  /**
   * Extract dependencies from Pinia store state field type annotations
   * Creates REFERENCES dependencies from store to managed types
   */
  private extractStateFieldTypes(
    defineStoreNode: Parser.SyntaxNode,
    storeName: string
  ): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    const argsNode = defineStoreNode.children.find(c => c.type === 'arguments');
    if (!argsNode) return dependencies;

    const optionsArg = argsNode.namedChildren[1];
    if (!optionsArg || optionsArg.type !== 'object') {
      return dependencies;
    }

    for (const prop of optionsArg.namedChildren) {
      if (prop.type !== 'pair') continue;

      const key = prop.child(0);
      if (key?.text !== 'state') continue;

      const value = prop.child(2);
      if (!value || value.type !== 'arrow_function') continue;

      const body = value.child(value.childCount - 1);
      if (!body) continue;

      const stateObject = body.type === 'parenthesized_expression'
        ? body.child(1)
        : body;

      if (stateObject?.type !== 'object') continue;

      for (const stateProp of stateObject.namedChildren) {
        if (stateProp.type !== 'pair') continue;

        const propValue = stateProp.child(2);
        if (!propValue) continue;

        const types = this.extractTypeAssertions(propValue);

        for (const typeName of types) {
          dependencies.push({
            from_symbol: storeName,
            to_symbol: typeName,
            dependency_type: DependencyType.REFERENCES,
            line_number: propValue.startPosition.row + 1,
          });
        }
      }
    }

    return dependencies;
  }

  /**
   * Recursively extract type assertions from an expression
   * Handles: [] as Type[], Array<Type>, etc.
   */
  private extractTypeAssertions(node: Parser.SyntaxNode): string[] {
    const types: string[] = [];

    if (node.type === 'as_expression') {
      const typeNode = node.child(2);
      if (typeNode) {
        const typeName = this.normalizeTypeName(typeNode.text);
        if (typeName) types.push(typeName);
      }
    }

    for (const child of node.children) {
      types.push(...this.extractTypeAssertions(child));
    }

    return types;
  }

  /**
   * Normalize type name by removing array/generic wrappers
   * Type[] → Type
   * Array<Type> → Type
   * Type1 | Type2 → Type1 (first non-built-in)
   */
  private normalizeTypeName(rawType: string): string | null {
    let typeName = rawType.trim();

    const builtIns = ['string', 'number', 'boolean', 'any', 'unknown', 'void', 'null', 'undefined'];
    if (builtIns.includes(typeName.toLowerCase())) {
      return null;
    }

    typeName = typeName.replace(/\[\]$/, '');

    const arrayGenericMatch = typeName.match(/^Array<(.+)>$/);
    if (arrayGenericMatch) {
      typeName = arrayGenericMatch[1];
    }

    typeName = typeName.replace(/^readonly\s+/, '');

    if (typeName.includes('|')) {
      const parts = typeName.split('|').map(p => p.trim());
      for (const part of parts) {
        if (!builtIns.includes(part.toLowerCase())) {
          typeName = part;
          break;
        }
      }
    }

    return typeName || null;
  }
}
