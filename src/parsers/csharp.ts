import Parser from 'tree-sitter';
import * as CSharp from 'tree-sitter-c-sharp';
import {
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

const logger = createComponentLogger('csharp-parser');

/**
 * C#-specific parser using Tree-sitter with chunked parsing support
 * Handles all major C# language constructs including classes, interfaces,
 * methods, properties, fields, events, delegates, and namespaces
 */
export class CSharpParser extends ChunkedParser {
  constructor() {
    const parser = new Parser();
    parser.setLanguage(CSharp as any);
    super(parser, 'csharp');
  }

  getSupportedExtensions(): string[] {
    return ['.cs'];
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

    try {
      const symbols = this.extractSymbols(tree.rootNode, content);
      const dependencies = this.extractDependencies(tree.rootNode, content);
      const imports = this.extractImports(tree.rootNode, content);
      const exports = this.extractExports(tree.rootNode, content);

      return {
        symbols: validatedOptions.includePrivateSymbols ? symbols : symbols.filter(s => s.visibility !== Visibility.PRIVATE),
        dependencies,
        imports,
        exports,
        errors: []
      };
    } finally {
      // Tree-sitter trees are automatically garbage collected in Node.js
      // No explicit disposal needed
    }
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract namespace declarations
    const namespaceNodes = this.findNodesOfType(rootNode, 'namespace_declaration');
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

    // Extract struct declarations
    const structNodes = this.findNodesOfType(rootNode, 'struct_declaration');
    for (const node of structNodes) {
      const symbol = this.extractStructSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract enum declarations
    const enumNodes = this.findNodesOfType(rootNode, 'enum_declaration');
    for (const node of enumNodes) {
      const symbol = this.extractEnumSymbol(node, content);
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
      const symbol = this.extractPropertySymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract field declarations
    const fieldNodes = this.findNodesOfType(rootNode, 'field_declaration');
    for (const node of fieldNodes) {
      const fieldSymbols = this.extractFieldSymbols(node, content);
      symbols.push(...fieldSymbols);
    }

    // Extract event declarations
    const eventNodes = this.findNodesOfType(rootNode, 'event_declaration');
    for (const node of eventNodes) {
      const eventSymbols = this.extractEventSymbols(node, content);
      symbols.push(...eventSymbols);
    }

    // Extract delegate declarations
    const delegateNodes = this.findNodesOfType(rootNode, 'delegate_declaration');
    for (const node of delegateNodes) {
      const symbol = this.extractDelegateSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract constructor declarations
    const constructorNodes = this.findNodesOfType(rootNode, 'constructor_declaration');
    for (const node of constructorNodes) {
      const symbol = this.extractConstructorSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    return symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract method calls
    const callNodes = this.findNodesOfType(rootNode, 'invocation_expression');
    for (const node of callNodes) {
      const dependency = this.extractCallDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    // Extract member access expressions
    const memberAccessNodes = this.findNodesOfType(rootNode, 'member_access_expression');
    for (const node of memberAccessNodes) {
      const dependency = this.extractMemberAccessDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    // Extract inheritance relationships
    const baseListNodes = this.findNodesOfType(rootNode, 'base_list');
    for (const node of baseListNodes) {
      const inheritanceDeps = this.extractInheritanceDependencies(node, content);
      dependencies.push(...inheritanceDeps);
    }

    // Extract generic type constraints
    const constraintNodes = this.findNodesOfType(rootNode, 'type_parameter_constraints_clause');
    for (const node of constraintNodes) {
      const constraintDeps = this.extractConstraintDependencies(node, content);
      dependencies.push(...constraintDeps);
    }

    return dependencies;
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Extract using directives
    const usingNodes = this.findNodesOfType(rootNode, 'using_directive');
    for (const node of usingNodes) {
      const importObj = this.extractUsingDirective(node, content);
      if (importObj) imports.push(importObj);
    }

    // Extract extern alias directives
    const externAliasNodes = this.findNodesOfType(rootNode, 'extern_alias_directive');
    for (const node of externAliasNodes) {
      const importObj = this.extractExternAlias(node, content);
      if (importObj) imports.push(importObj);
    }

    return imports;
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];

    // In C#, "exports" are typically public members
    // Extract public class declarations
    const publicClasses = this.findPublicDeclarations(rootNode, 'class_declaration');
    for (const node of publicClasses) {
      const exportObj = this.extractPublicDeclaration(node, content, 'class');
      if (exportObj) exports.push(exportObj);
    }

    // Extract public interface declarations
    const publicInterfaces = this.findPublicDeclarations(rootNode, 'interface_declaration');
    for (const node of publicInterfaces) {
      const exportObj = this.extractPublicDeclaration(node, content, 'interface');
      if (exportObj) exports.push(exportObj);
    }

    // Extract public enum declarations
    const publicEnums = this.findPublicDeclarations(rootNode, 'enum_declaration');
    for (const node of publicEnums) {
      const exportObj = this.extractPublicDeclaration(node, content, 'enum');
      if (exportObj) exports.push(exportObj);
    }

    return exports;
  }

  // Symbol extraction helper methods

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
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    return {
      name,
      symbol_type: SymbolType.CLASS,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility: visibility || Visibility.PUBLIC,
      signature: this.extractClassSignature(node, content)
    };
  }

  private extractInterfaceSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    return {
      name,
      symbol_type: SymbolType.INTERFACE,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility: visibility || Visibility.PUBLIC,
      signature: this.extractInterfaceSignature(node, content)
    };
  }

  private extractStructSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    return {
      name,
      symbol_type: SymbolType.CLASS, // Use CLASS type for structs as they're similar
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility: visibility || Visibility.PUBLIC,
      signature: `struct ${name}`
    };
  }

  private extractEnumSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    return {
      name,
      symbol_type: SymbolType.ENUM,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility: visibility || Visibility.PUBLIC
    };
  }

  private extractMethodSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    return {
      name,
      symbol_type: SymbolType.METHOD,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility: visibility || Visibility.PRIVATE,
      signature: this.extractMethodSignature(node, content)
    };
  }

  private extractPropertySymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    return {
      name,
      symbol_type: SymbolType.PROPERTY,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility: visibility || Visibility.PRIVATE,
      signature: this.extractPropertySignature(node, content)
    };
  }

  private extractFieldSymbols(node: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    // Field declarations can contain multiple variables
    const declaratorNodes = this.findNodesOfType(node, 'variable_declarator');
    for (const declarator of declaratorNodes) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;

      const name = this.getNodeText(nameNode, content);

      symbols.push({
        name,
        symbol_type: modifiers.includes('const') ? SymbolType.CONSTANT : SymbolType.VARIABLE,
        start_line: declarator.startPosition.row + 1,
        end_line: declarator.endPosition.row + 1,
        is_exported: modifiers.includes('public'),
        visibility: visibility || Visibility.PRIVATE
      });
    }

    return symbols;
  }

  private extractEventSymbols(node: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    // Event declarations can contain multiple events
    const declaratorNodes = this.findNodesOfType(node, 'variable_declarator');
    for (const declarator of declaratorNodes) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;

      const name = this.getNodeText(nameNode, content);

      symbols.push({
        name,
        symbol_type: SymbolType.VARIABLE, // Use VARIABLE type for events
        start_line: declarator.startPosition.row + 1,
        end_line: declarator.endPosition.row + 1,
        is_exported: modifiers.includes('public'),
        visibility: visibility || Visibility.PRIVATE,
        signature: `event ${name}`
      });
    }

    return symbols;
  }

  private extractDelegateSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    return {
      name,
      symbol_type: SymbolType.TYPE_ALIAS, // Use TYPE_ALIAS for delegates
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility: visibility || Visibility.PUBLIC,
      signature: this.extractDelegateSignature(node, content)
    };
  }

  private extractConstructorSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    return {
      name,
      symbol_type: SymbolType.METHOD,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility: visibility || Visibility.PRIVATE,
      signature: this.extractConstructorSignature(node, content)
    };
  }

  // Dependency extraction helper methods

  private extractCallDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const expressionNode = node.childForFieldName('expression');
    if (!expressionNode) return null;

    const methodName = this.getNodeText(expressionNode, content);
    const callerName = this.findContainingFunction(node, content);

    return {
      from_symbol: callerName,
      to_symbol: methodName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
      confidence: 0.8
    };
  }

  private extractMemberAccessDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const memberName = this.getNodeText(nameNode, content);
    const callerName = this.findContainingFunction(node, content);

    return {
      from_symbol: callerName,
      to_symbol: memberName,
      dependency_type: DependencyType.REFERENCES,
      line_number: node.startPosition.row + 1,
      confidence: 0.7
    };
  }

  private extractInheritanceDependencies(node: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    for (const child of node.children) {
      if (child.type === 'identifier' || child.type === 'qualified_name') {
        const baseName = this.getNodeText(child, content);

        dependencies.push({
          from_symbol: 'derived',
          to_symbol: baseName,
          dependency_type: DependencyType.INHERITS,
          line_number: child.startPosition.row + 1,
          confidence: 0.9
        });
      }
    }

    return dependencies;
  }

  private extractConstraintDependencies(node: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract type constraints
    const constraintNodes = this.findNodesOfType(node, 'type_constraint');
    for (const constraintNode of constraintNodes) {
      const typeNode = constraintNode.child(0);
      if (typeNode) {
        const typeName = this.getNodeText(typeNode, content);

        dependencies.push({
          from_symbol: 'generic',
          to_symbol: typeName,
          dependency_type: DependencyType.REFERENCES,
          line_number: constraintNode.startPosition.row + 1,
          confidence: 0.8
        });
      }
    }

    return dependencies;
  }

  // Import/Export extraction helper methods

  private extractUsingDirective(node: Parser.SyntaxNode, content: string): ParsedImport | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const namespaceName = this.getNodeText(nameNode, content);

    return {
      source: namespaceName,
      imported_names: ['*'],
      import_type: 'namespace',
      line_number: node.startPosition.row + 1,
      is_dynamic: false
    };
  }

  private extractExternAlias(node: Parser.SyntaxNode, content: string): ParsedImport | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const aliasName = this.getNodeText(nameNode, content);

    return {
      source: aliasName,
      imported_names: [aliasName],
      import_type: 'named',
      line_number: node.startPosition.row + 1,
      is_dynamic: false
    };
  }

  private findPublicDeclarations(rootNode: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    const nodes = this.findNodesOfType(rootNode, type);
    return nodes.filter(node => {
      const modifiers = this.extractModifiers(node, this.getNodeText(rootNode, ''));
      return modifiers.includes('public');
    });
  }

  private extractPublicDeclaration(node: Parser.SyntaxNode, content: string, type: string): ParsedExport | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      exported_names: [name],
      export_type: 'named',
      line_number: node.startPosition.row + 1
    };
  }

  // Utility methods

  /**
   * Find the containing function for a call expression node by traversing up the AST
   */
  private findContainingFunction(callNode: Parser.SyntaxNode, content: string): string {
    let parent = callNode.parent;

    // Walk up the AST to find containing function, method, or constructor
    while (parent) {
      if (parent.type === 'method_declaration' ||
          parent.type === 'constructor_declaration' ||
          parent.type === 'property_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          return this.getNodeText(nameNode, content);
        }
      }

      // Also check for class context to provide better context
      if (parent.type === 'class_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const className = this.getNodeText(nameNode, content);
          return `${className}.<unknown>`;
        }
      }

      parent = parent.parent;
    }

    return '<global>';
  }

  private extractModifiers(node: Parser.SyntaxNode, content: string): string[] {
    const modifiers: string[] = [];

    // Look for modifier nodes in the declaration
    for (const child of node.children) {
      if (child.type === 'modifier') {
        modifiers.push(this.getNodeText(child, content));
      }
    }

    return modifiers;
  }

  private extractClassSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    return `${modifiers.join(' ')} class ${name}`;
  }

  private extractInterfaceSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    return `${modifiers.join(' ')} interface ${name}`;
  }

  private extractMethodSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    // Extract return type
    const returnTypeNode = node.childForFieldName('type');
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode, content) : 'void';

    // Extract parameters
    const parametersNode = node.childForFieldName('parameters');
    let parameters = '()';
    if (parametersNode) {
      parameters = this.getNodeText(parametersNode, content);
    }

    return `${modifiers.join(' ')} ${returnType} ${name}${parameters}`;
  }

  private extractPropertySignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    // Extract property type
    const typeNode = node.childForFieldName('type');
    const type = typeNode ? this.getNodeText(typeNode, content) : 'object';

    return `${modifiers.join(' ')} ${type} ${name}`;
  }

  private extractDelegateSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    return `${modifiers.join(' ')} delegate ${name}`;
  }

  private extractConstructorSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    // Extract parameters
    const parametersNode = node.childForFieldName('parameters');
    let parameters = '()';
    if (parametersNode) {
      parameters = this.getNodeText(parametersNode, content);
    }

    return `${modifiers.join(' ')} ${name}${parameters}`;
  }

  // Chunked parsing methods

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries: number[] = [];
    // Search within 85% of max size for safe boundaries
    const searchLimit = Math.floor(maxChunkSize * 0.85);
    const searchContent = content.substring(0, Math.min(searchLimit, content.length));

    // C#-specific boundary patterns in order of preference
    const boundaryPatterns = [
      // End of namespace declarations
      /^\s*}\s*(?:\/\/.*)?$\s*^\s*namespace\s+/gm,
      // End of class/interface/struct declarations
      /^\s*}\s*(?:\/\/.*)?$\s*^\s*(?:public\s+|private\s+|internal\s+|protected\s+)?(?:partial\s+)?(?:class|interface|struct)\s+/gm,
      // End of method declarations with proper closure
      /^\s*}\s*(?:\/\/.*)?$\s*^\s*(?:public\s+|private\s+|internal\s+|protected\s+)?(?:static\s+|virtual\s+|override\s+|abstract\s+)?[\w<>\[\]]+\s+\w+\s*\(/gm,
      // End of property declarations
      /^\s*}\s*(?:\/\/.*)?$\s*^\s*(?:public\s+|private\s+|internal\s+|protected\s+)?(?:static\s+)?[\w<>\[\]]+\s+\w+\s*{/gm,
      // Using directives
      /^using\s+[\w\.]+;\s*(?:\/\/.*)?$/gm,
      // Single-line comments
      /\/\/.*$/gm,
      // Multi-line comment endings
      /\*\/\s*$/gm
    ];

    for (const pattern of boundaryPatterns) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0; // Reset regex state

      while ((match = pattern.exec(searchContent)) !== null) {
        const position = match.index + match[0].length;

        // Ensure boundary is at a reasonable position
        if (position > maxChunkSize * 0.3 && position < searchLimit) {
          boundaries.push(position);
        }

        // Prevent infinite loops with global regex
        if (pattern.lastIndex === match.index) {
          pattern.lastIndex++;
        }
      }
    }

    // Sort boundaries by position and remove duplicates
    return [...new Set(boundaries)].sort((a, b) => a - b);
  }

  protected mergeChunkResults(chunks: ParseResult[], chunkMetadata: ChunkResult[]): MergedParseResult {
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
      allErrors.push(...chunk.errors);
    }

    // Remove duplicates
    const uniqueSymbols = this.removeDuplicateSymbols(allSymbols);
    const uniqueDependencies = this.removeDuplicateDependencies(allDependencies);
    const uniqueImports = this.removeDuplicateImports(allImports);
    const uniqueExports = this.removeDuplicateExports(allExports);

    return {
      symbols: uniqueSymbols,
      dependencies: uniqueDependencies,
      imports: uniqueImports,
      exports: uniqueExports,
      errors: allErrors,
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunkMetadata.length,
        duplicatesRemoved: (allSymbols.length - uniqueSymbols.length) +
                          (allDependencies.length - uniqueDependencies.length),
        crossChunkReferencesFound: 0 // TODO: Implement cross-chunk reference detection
      }
    };
  }

  private removeDuplicateImports(imports: ParsedImport[]): ParsedImport[] {
    const seen = new Set<string>();
    const result: ParsedImport[] = [];

    for (const imp of imports) {
      const key = `${imp.source}:${imp.import_type}:${imp.imported_names.join(',')}`;

      if (!seen.has(key)) {
        seen.add(key);
        result.push(imp);
      }
    }

    return result;
  }

  private removeDuplicateExports(exports: ParsedExport[]): ParsedExport[] {
    const seen = new Set<string>();
    const result: ParsedExport[] = [];

    for (const exp of exports) {
      const key = `${exp.export_type}:${exp.exported_names.join(',')}`;

      if (!seen.has(key)) {
        seen.add(key);
        result.push(exp);
      }
    }

    return result;
  }

  /**
   * Convert MergedParseResult to ParseResult for compatibility
   */
  private convertMergedResult(mergedResult: MergedParseResult): ParseResult {
    return {
      symbols: mergedResult.symbols,
      dependencies: mergedResult.dependencies,
      imports: mergedResult.imports,
      exports: mergedResult.exports,
      errors: mergedResult.errors
    };
  }
}