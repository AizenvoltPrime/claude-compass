import Parser from 'tree-sitter';
import { php as PHP } from 'tree-sitter-php';
import {
  BaseParser,
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
  ParseOptions,
  ParseError
} from './base';
import { createComponentLogger } from '../utils/logger';
import {
  ChunkedParser,
  MergedParseResult,
  ChunkedParseOptions,
  ChunkResult
} from './chunked-parser';
import { SymbolType, DependencyType, Visibility } from '../database/models';

const logger = createComponentLogger('php-parser');

/**
 * PHP-specific parser using Tree-sitter with chunked parsing support
 */
export class PHPParser extends ChunkedParser {
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
      const chunkedResult = await this.parseFileInChunks(filePath, content, chunkedOptions);
      return this.convertMergedResult(chunkedResult);
    }

    // For smaller files or when chunking is disabled, use direct parsing
    return this.parseFileDirectly(filePath, content, chunkedOptions);
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

    const symbols = this.extractSymbols(tree.rootNode, content);
    const dependencies = this.extractDependencies(tree.rootNode, content);
    const imports = this.extractImports(tree.rootNode, content);
    const exports = this.extractExports(tree.rootNode, content);
    const errors = this.extractErrors(tree.rootNode, content, tree);

    return {
      symbols: validatedOptions.includePrivateSymbols ? symbols : symbols.filter(s => s.visibility !== 'private'),
      dependencies,
      imports,
      exports,
      errors
    };
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract namespace declarations
    const namespaceNodes = this.findNodesOfType(rootNode, 'namespace_definition');
    for (const node of namespaceNodes) {
      const symbol = this.extractNamespaceSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract class declarations
    const classNodes = this.findNodesOfType(rootNode, 'class_declaration');
    for (const node of classNodes) {
      const symbol = this.extractClassSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract interface declarations
    const interfaceNodes = this.findNodesOfType(rootNode, 'interface_declaration');
    for (const node of interfaceNodes) {
      const symbol = this.extractInterfaceSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract trait declarations
    const traitNodes = this.findNodesOfType(rootNode, 'trait_declaration');
    for (const node of traitNodes) {
      const symbol = this.extractTraitSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract function declarations
    const functionNodes = this.findNodesOfType(rootNode, 'function_definition');
    for (const node of functionNodes) {
      const symbol = this.extractFunctionSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract method declarations
    const methodNodes = this.findNodesOfType(rootNode, 'method_declaration');
    for (const node of methodNodes) {
      const symbol = this.extractMethodSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract property declarations
    const propertyNodes = this.findNodesOfType(rootNode, 'property_declaration');
    for (const node of propertyNodes) {
      const symbols_from_props = this.extractPropertySymbols(node, content);
      symbols.push(...symbols_from_props);
    }

    // Extract constants
    const constNodes = this.findNodesOfType(rootNode, 'const_declaration');
    for (const node of constNodes) {
      const symbols_from_consts = this.extractConstantSymbols(node, content);
      symbols.push(...symbols_from_consts);
    }

    return symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract function calls
    const callNodes = this.findNodesOfType(rootNode, 'function_call_expression');
    for (const node of callNodes) {
      const dependency = this.extractCallDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    // Extract method calls
    const methodCallNodes = this.findNodesOfType(rootNode, 'member_call_expression');
    for (const node of methodCallNodes) {
      const dependency = this.extractMethodCallDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    // Extract static method calls (scoped_call_expression)
    const scopedCallNodes = this.findNodesOfType(rootNode, 'scoped_call_expression');
    for (const node of scopedCallNodes) {
      const dependency = this.extractScopedCallDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    // Extract class instantiations (new expressions)
    const newNodes = this.findNodesOfType(rootNode, 'object_creation_expression');
    for (const node of newNodes) {
      const dependency = this.extractNewDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    return dependencies;
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Extract use statements (namespace imports)
    const useNodes = this.findNodesOfType(rootNode, 'namespace_use_declaration');
    for (const node of useNodes) {
      const importInfo = this.extractUseStatement(node, content);
      if (importInfo) imports.push(importInfo);
    }

    // Extract require/include statements
    const includeNodes = this.findIncludeStatements(rootNode, content);
    imports.push(...includeNodes);

    return imports;
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];

    // In PHP, exports are typically class/function declarations that are publicly accessible
    // We'll mark classes, interfaces, traits, and functions as exports if they're public
    const classNodes = this.findNodesOfType(rootNode, 'class_declaration');
    for (const node of classNodes) {
      const exportInfo = this.extractClassExport(node, content);
      if (exportInfo) exports.push(exportInfo);
    }

    const interfaceNodes = this.findNodesOfType(rootNode, 'interface_declaration');
    for (const node of interfaceNodes) {
      const exportInfo = this.extractInterfaceExport(node, content);
      if (exportInfo) exports.push(exportInfo);
    }

    const traitNodes = this.findNodesOfType(rootNode, 'trait_declaration');
    for (const node of traitNodes) {
      const exportInfo = this.extractTraitExport(node, content);
      if (exportInfo) exports.push(exportInfo);
    }

    const functionNodes = this.findNodesOfType(rootNode, 'function_definition');
    for (const node of functionNodes) {
      const exportInfo = this.extractFunctionExport(node, content);
      if (exportInfo) exports.push(exportInfo);
    }

    return exports;
  }

  private extractNamespaceSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      name,
      symbol_type: SymbolType.NAMESPACE,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true, // Namespaces are always accessible
      visibility: Visibility.PUBLIC
    };
  }

  private extractClassSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractClassSignature(node, content);

    return {
      name,
      symbol_type: SymbolType.CLASS,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true, // Classes are typically exportable in PHP
      visibility: Visibility.PUBLIC,
      signature
    };
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
      is_exported: true, // Interfaces are typically exportable
      visibility: Visibility.PUBLIC
    };
  }

  private extractTraitSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      name,
      symbol_type: SymbolType.TRAIT,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true, // Traits are typically exportable
      visibility: Visibility.PUBLIC
    };
  }

  private extractFunctionSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractFunctionSignature(node, content);

    return {
      name,
      symbol_type: SymbolType.FUNCTION,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true, // Functions are typically exportable
      visibility: Visibility.PUBLIC,
      signature
    };
  }

  private extractMethodSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractFunctionSignature(node, content);
    const visibility = this.extractVisibility(node, content);

    return {
      name,
      symbol_type: SymbolType.METHOD,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: visibility === Visibility.PUBLIC,
      visibility,
      signature
    };
  }

  private extractPropertySymbols(node: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    const visibility = this.extractVisibility(node, content);

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
          visibility
        });
      }
    }

    return symbols;
  }

  private extractConstantSymbols(node: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

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
          visibility: Visibility.PUBLIC
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
      line_number: node.startPosition.row + 1,
      confidence: 1.0
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
      line_number: node.startPosition.row + 1,
      confidence: 1.0
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
      line_number: node.startPosition.row + 1,
      confidence: 1.0
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
      line_number: node.startPosition.row + 1,
      confidence: 1.0
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
   * Find optimal chunk boundaries for PHP content
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries: number[] = [];
    const searchLimit = Math.floor(maxChunkSize * 0.85);
    const searchContent = content.substring(0, Math.min(searchLimit, content.length));

    // PHP-specific boundary patterns
    const boundaryPatterns = [
      // End of class definitions
      /class\s+\w+(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*{[^}]*}\s*\n/g,

      // End of interface definitions
      /interface\s+\w+(?:\s+extends\s+[\w,\s]+)?\s*{[^}]*}\s*\n/g,

      // End of trait definitions
      /trait\s+\w+\s*{[^}]*}\s*\n/g,

      // End of function definitions
      /function\s+\w+\s*\([^)]*\)\s*{[^}]*}\s*\n/g,

      // End of method definitions
      /(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)\s*{[^}]*}\s*\n/g,

      // End of namespace blocks
      /namespace\s+[\w\\]+\s*{[^}]*}\s*\n/g,

      // End of use statements block
      /use\s+[\w\\]+(?:\s+as\s+\w+)?;\s*\n\s*\n/g,

      // Simple closing braces with newlines
      /}\s*\n/g
    ];

    for (const pattern of boundaryPatterns) {
      let match;
      while ((match = pattern.exec(searchContent)) !== null) {
        const position = match.index + match[0].length;
        if (position > 100 && position < searchLimit) {
          boundaries.push(position);
        }
      }
    }

    return [...new Set(boundaries)].sort((a, b) => b - a);
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