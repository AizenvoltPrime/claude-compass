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
 * C# Parse State Interface for tracking parsing context
 */
interface CSharpParseState {
  // String literal tracking
  inString: 'none' | 'single' | 'double' | 'verbatim' | 'interpolated';
  stringDelimiter: string;
  escapeNext: boolean;

  // Comment tracking
  inComment: 'none' | 'single' | 'multi' | 'xml';

  // Nesting level tracking
  braceLevel: number;
  parenLevel: number;
  bracketLevel: number;
  angleLevel: number; // For generics

  // C# structure tracking
  inUsings: boolean;
  inNamespace: boolean;
  inClass: boolean;
  inMethod: boolean;
  inProperty: boolean;
  inInterface: boolean;
  inStruct: boolean;
  inEnum: boolean;

  // Safe boundary positions
  lastUsingEnd: number;
  lastNamespaceEnd: number;
  lastClassEnd: number;
  lastMethodEnd: number;
  lastPropertyEnd: number;
  lastStatementEnd: number;
  lastBlockEnd: number;
  lastEnumEnd: number;
  lastInterfaceEnd: number;
  lastStructEnd: number;

  // Context preservation
  usingDirectives: string[];
  namespaceContext: string;
  classContext: string;
  inheritanceContext: string;
  currentIndentLevel: number;
}

/**
 * Chunk validation result interface
 */
interface ChunkValidation {
  isValid: boolean;
  issues: string[];
  hasCompleteUsings: boolean;
  hasBalancedBraces: boolean;
  hasSplitClass: boolean;
}

/**
 * Top-level declaration interface for AST-based chunking
 */
interface TopLevelDeclaration {
  type: string;
  startPos: number;
  endPos: number;
  startLine: number;
  endLine: number;
  name: string;
  depth: number; // Nesting depth (0 for top-level)
}

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
      // Special case: Check if file contains a single large class that can't be chunked
      const declarations = this.findTopLevelDeclarations(content);
      const nonUsingDeclarations = declarations.filter(d => d.type !== 'using_block');

      // Check if we have classes that are too large to chunk
      const largeDeclarations = nonUsingDeclarations.filter(d =>
        (d.type === 'class_declaration' || d.type === 'namespace_declaration') &&
        d.endPos - d.startPos + 1 > this.DEFAULT_CHUNK_SIZE
      );

      logger.debug('Checking for large declarations', {
        totalDeclarations: nonUsingDeclarations.length,
        largeDeclarations: largeDeclarations.map(d => ({
          name: d.name,
          type: d.type,
          size: d.endPos - d.startPos + 1
        }))
      });

      // If file has large declarations that would be broken by chunking, parse as single oversized chunk
      // This happens when we have a very large class that can't be split
      if (largeDeclarations.length > 0) {
        // Check if the large declarations contain most of the file content
        const totalLargeSize = largeDeclarations.reduce((sum, d) => sum + (d.endPos - d.startPos + 1), 0);
        const fileSize = content.length;

        // If large declarations are more than 80% of file, parse as single chunk
        if (totalLargeSize > fileSize * 0.8) {
          logger.info('Processing file with large class/namespace as single oversized chunk', {
            declarationCount: nonUsingDeclarations.length,
            largeDeclarationSize: totalLargeSize,
            fileSize: fileSize,
            percentage: Math.round(totalLargeSize * 100 / fileSize)
          });
          // Bypass the size check by parsing directly
          const tree = this.parser.parse(content);
          const result = this.extractFromTree(tree, content, filePath, chunkedOptions);
          return result;
        }
      }

      const chunkedResult = await this.parseFileInChunks(filePath, content, chunkedOptions);
      return this.convertMergedResult(chunkedResult);
    }

    // For smaller files or when chunking is disabled, use direct parsing
    return this.parseFileDirectly(filePath, content, chunkedOptions);
  }

  /**
   * Extract symbols and dependencies directly from a parsed tree
   */
  private extractFromTree(tree: Parser.Tree | null, content: string, filePath: string, options?: ChunkedParseOptions): ParseResult {
    const validatedOptions = this.validateOptions(options);

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
      // Validate syntax tree health
      const validationErrors = this.validateSyntaxTree(tree.rootNode, filePath);

      const symbols = this.extractSymbols(tree.rootNode, content);
      const dependencies = this.extractDependencies(tree.rootNode, content);
      const imports = this.extractImports(tree.rootNode, content);
      const exports = this.extractExports(tree.rootNode, content);

      logger.info('C# parsing completed for large file', {
        filePath,
        symbolsFound: symbols.length,
        dependenciesFound: dependencies.length,
        importsFound: imports.length,
        exportsFound: exports.length,
        syntaxErrors: validationErrors.length,
        hasErrors: tree.rootNode.hasError
      });

      return {
        symbols: validatedOptions.includePrivateSymbols ? symbols : symbols.filter(s => s.visibility !== Visibility.PRIVATE),
        dependencies,
        imports,
        exports,
        errors: validationErrors
      };
    } catch (error) {
      logger.error('C# symbol extraction failed', {
        filePath,
        error: (error as Error).message
      });

      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `Symbol extraction failed: ${(error as Error).message}`,
          line: 1,
          column: 1,
          severity: 'error'
        }]
      };
    }
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
      // Validate syntax tree health
      const validationErrors = this.validateSyntaxTree(tree.rootNode, filePath);

      const symbols = this.extractSymbols(tree.rootNode, content);
      const dependencies = this.extractDependencies(tree.rootNode, content);
      const imports = this.extractImports(tree.rootNode, content);
      const exports = this.extractExports(tree.rootNode, content);

      // Log parsing statistics for C# files
      logger.debug('C# parsing completed', {
        filePath,
        symbolsFound: symbols.length,
        dependenciesFound: dependencies.length,
        importsFound: imports.length,
        exportsFound: exports.length,
        syntaxErrors: validationErrors.length,
        hasErrors: tree.rootNode.hasError
      });

      // Warn if no symbols found in a substantial file (might indicate parsing issues)
      if (symbols.length === 0 && content.length > 1000) {
        validationErrors.push({
          message: 'No symbols extracted from substantial C# file - possible parsing issue',
          line: 1,
          column: 1,
          severity: 'warning'
        });
      }

      return {
        symbols: validatedOptions.includePrivateSymbols ? symbols : symbols.filter(s => s.visibility !== Visibility.PRIVATE),
        dependencies,
        imports,
        exports,
        errors: validationErrors
      };
    } catch (error) {
      logger.error('C# symbol extraction failed', {
        filePath,
        error: (error as Error).message
      });

      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `Symbol extraction failed: ${(error as Error).message}`,
          line: 1,
          column: 1,
          severity: 'error'
        }]
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

    // Extract method name, handling different expression types
    let methodName = '';
    if (expressionNode.type === 'member_access_expression') {
      // For member access like obj.Method(), get just the method name
      const nameNode = expressionNode.childForFieldName('name');
      methodName = nameNode ? this.getNodeText(nameNode, content) : this.getNodeText(expressionNode, content);
    } else if (expressionNode.type === 'identifier') {
      // For simple method calls like Method()
      methodName = this.getNodeText(expressionNode, content);
    } else {
      // For complex expressions, use the full text
      methodName = this.getNodeText(expressionNode, content);
    }

    const callerName = this.findContainingFunction(node, content);

    return {
      from_symbol: callerName,
      to_symbol: methodName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
      confidence: 0.9 // Higher confidence with improved extraction
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

  // Validation methods

  /**
   * Validate syntax tree health and detect common C# parsing issues
   */
  private validateSyntaxTree(rootNode: Parser.SyntaxNode, filePath: string): ParseError[] {
    const errors: ParseError[] = [];

    // Check for general syntax errors
    if (rootNode.hasError) {
      const errorNodes = this.findErrorNodes(rootNode);
      for (const errorNode of errorNodes) {
        errors.push({
          message: `C# syntax error at line ${errorNode.startPosition.row + 1}`,
          line: errorNode.startPosition.row + 1,
          column: errorNode.startPosition.column + 1,
          severity: 'error'
        });
      }
    }

    // Check for common C# constructs that should be present
    const hasNamespaceOrClass = this.findNodesOfType(rootNode, 'namespace_declaration').length > 0 ||
                                this.findNodesOfType(rootNode, 'class_declaration').length > 0 ||
                                this.findNodesOfType(rootNode, 'interface_declaration').length > 0 ||
                                this.findNodesOfType(rootNode, 'struct_declaration').length > 0;

    if (!hasNamespaceOrClass) {
      // This might be okay for some C# files (like global using files), so make it a warning
      errors.push({
        message: 'No namespace, class, interface, or struct declarations found - verify C# file structure',
        line: 1,
        column: 1,
        severity: 'warning'
      });
    }

    // Check for potential parsing issues with using directives
    const usingNodes = this.findNodesOfType(rootNode, 'using_directive');
    if (usingNodes.length === 0 && filePath.includes('.cs')) {
      // Check if this file might legitimately not need using directives
      const hasNamespace = this.findNodesOfType(rootNode, 'namespace_declaration').length > 0;
      const hasClasses = this.findNodesOfType(rootNode, 'class_declaration').length > 0;
      const hasInterfaces = this.findNodesOfType(rootNode, 'interface_declaration').length > 0;
      const hasEnums = this.findNodesOfType(rootNode, 'enum_declaration').length > 0;
      const hasStructs = this.findNodesOfType(rootNode, 'struct_declaration').length > 0;

      // Only warn if the file has no meaningful C# constructs at all
      // Simple enums, interfaces with primitives, etc. often don't need using directives
      if (!hasNamespace && !hasClasses && !hasInterfaces && !hasEnums && !hasStructs) {
        errors.push({
          message: 'No using directives or C# declarations found - verify file is valid C#',
          line: 1,
          column: 1,
          severity: 'warning'
        });
      }
    }

    return errors;
  }

  /**
   * Find all ERROR nodes in the syntax tree
   */
  private findErrorNodes(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const errorNodes: Parser.SyntaxNode[] = [];

    if (node.type === 'ERROR') {
      errorNodes.push(node);
    }

    for (const child of node.children) {
      errorNodes.push(...this.findErrorNodes(child));
    }

    return errorNodes;
  }

  // Utility methods

  /**
   * Find the containing function for a call expression node by traversing up the AST
   */
  private findContainingFunction(callNode: Parser.SyntaxNode, content: string): string {
    let parent = callNode.parent;
    let className = '';

    // Walk up the AST to find containing function, method, or constructor
    while (parent) {
      if (parent.type === 'method_declaration' ||
          parent.type === 'constructor_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const methodName = this.getNodeText(nameNode, content);
          // Include class context if available
          return className ? `${className}.${methodName}` : methodName;
        }
      }

      if (parent.type === 'property_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const propertyName = this.getNodeText(nameNode, content);
          // Properties often have getter/setter, so specify it's from property
          return className ? `${className}.${propertyName}` : propertyName;
        }
      }

      // Keep track of class context for better naming
      if (parent.type === 'class_declaration' && !className) {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          className = this.getNodeText(nameNode, content);
        }
      }

      // Check for namespace context
      if (parent.type === 'namespace_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const namespaceName = this.getNodeText(nameNode, content);
          return className ? `${namespaceName}.${className}.<unknown>` : `${namespaceName}.<unknown>`;
        }
      }

      parent = parent.parent;
    }

    // Return class context if no method found but class is available
    return className ? `${className}.<unknown>` : '<global>';
  }

  private extractModifiers(node: Parser.SyntaxNode, content: string): string[] {
    const modifiers: string[] = [];

    // C# modifier types in tree-sitter-c-sharp grammar
    const csharpModifierTypes = new Set([
      'public', 'private', 'internal', 'protected',
      'static', 'partial', 'abstract', 'sealed',
      'virtual', 'override', 'readonly', 'async',
      'const', 'new', 'extern', 'unsafe', 'volatile'
    ]);

    // Look for actual modifier node types in the declaration
    for (const child of node.children) {
      if (csharpModifierTypes.has(child.type)) {
        modifiers.push(child.type);
      }
    }

    return modifiers;
  }

  private extractClassSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    // Build signature with proper spacing
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    return `${modifierString}class ${name}`;
  }

  private extractInterfaceSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    // Build signature with proper spacing
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    return `${modifierString}interface ${name}`;
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

    // Build signature with proper spacing
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    return `${modifierString}${returnType} ${name}${parameters}`;
  }

  private extractPropertySignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    // Extract property type
    const typeNode = node.childForFieldName('type');
    const type = typeNode ? this.getNodeText(typeNode, content) : 'object';

    // Build signature with proper spacing
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    return `${modifierString}${type} ${name}`;
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

  /**
   * Find all top-level declarations in the content using Tree-sitter AST
   * This is used for intelligent chunk boundary detection
   */
  private findTopLevelDeclarations(content: string): TopLevelDeclaration[] {
    const declarations: TopLevelDeclaration[] = [];

    try {
      // Parse the content directly with Tree-sitter to get AST
      // We bypass the normal parseContent to avoid size checks since we need the full file AST
      const tree = this.parser.parse(content);
      if (!tree || !tree.rootNode) {
        logger.warn('Failed to parse content for top-level declarations');
        return declarations;
      }

      // Types of top-level constructs we want to preserve intact
      const topLevelTypes = [
        'namespace_declaration',
        'class_declaration',
        'interface_declaration',
        'struct_declaration',
        'enum_declaration',
        'delegate_declaration'
      ];

      // Also track file-scoped namespace declarations (C# 10+)
      const fileScopedNamespace = this.findNodesOfType(tree.rootNode, 'file_scoped_namespace_declaration');

      // Process each type of declaration
      for (const type of topLevelTypes) {
        const nodes = this.findNodesOfType(tree.rootNode, type);

        for (const node of nodes) {
          // Calculate nesting depth
          let depth = 0;
          let parent = node.parent;
          while (parent) {
            if (topLevelTypes.includes(parent.type)) {
              depth++;
            }
            parent = parent.parent;
          }

          // Extract declaration name
          const nameNode = node.childForFieldName('name');
          const name = nameNode ? this.getNodeText(nameNode, content) : '<anonymous>';

          declarations.push({
            type,
            startPos: node.startIndex,
            endPos: node.endIndex,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            name,
            depth
          });
        }
      }

      // Sort declarations by position
      declarations.sort((a, b) => a.startPos - b.startPos);

      // Add using directives as a special "declaration" to preserve them
      const usingNodes = this.findNodesOfType(tree.rootNode, 'using_directive');
      if (usingNodes.length > 0) {
        const firstUsing = usingNodes[0];
        const lastUsing = usingNodes[usingNodes.length - 1];

        // Group all using directives together
        declarations.unshift({
          type: 'using_block',
          startPos: firstUsing.startIndex,
          endPos: lastUsing.endIndex,
          startLine: firstUsing.startPosition.row + 1,
          endLine: lastUsing.endPosition.row + 1,
          name: 'using_directives',
          depth: 0
        });
      }

      return declarations;
    } catch (error) {
      logger.error('Error finding top-level declarations', { error: (error as Error).message });
      return declarations;
    }
  }

  /**
   * Extract declaration name for context preservation
   */
  private extractDeclarationName(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    return nameNode ? this.getNodeText(nameNode, content) : '<anonymous>';
  }

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries: number[] = [];

    // First attempt: Use AST-based chunking
    const astBoundaries = this.getASTBasedBoundaries(content, maxChunkSize);
    if (astBoundaries.length > 0) {
      return astBoundaries;
    }

    // Fallback: Use improved state-based chunking with strong class boundary preference
    logger.warn('AST-based chunking failed, using fallback state-based approach');
    return this.getFallbackBoundaries(content, maxChunkSize);
  }

  /**
   * Get chunk boundaries using AST analysis to ensure complete declarations
   */
  private getASTBasedBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries: number[] = [];

    // Find all top-level declarations
    const declarations = this.findTopLevelDeclarations(content);

    if (declarations.length === 0) {
      logger.warn('No top-level declarations found for AST-based chunking');
      return boundaries;
    }

    // Filter out the using block and process declarations
    const usingBlock = declarations.find(d => d.type === 'using_block');
    const nonUsingDeclarations = declarations.filter(d => d.type !== 'using_block');

    // If we only have using directives, no chunking needed
    if (nonUsingDeclarations.length === 0) {
      return boundaries;
    }

    // Special case: if entire file is just one large class/namespace, we need to handle it specially
    if (nonUsingDeclarations.length === 1) {
      const singleDecl = nonUsingDeclarations[0];
      if (singleDecl.endPos - singleDecl.startPos + 1 > maxChunkSize) {
        logger.warn('File contains single large declaration exceeding chunk size', {
          declaration: singleDecl.name,
          size: singleDecl.endPos - singleDecl.startPos + 1
        });
        // For a single large declaration, we'll need to parse it as an oversized chunk
        // Return empty boundaries to process the entire file as one chunk
        return [];
      }
    }

    // Extract using directives to preserve in each chunk
    const usingDirectives = usingBlock ? content.substring(usingBlock.startPos, usingBlock.endPos + 1) : '';
    const usingSize = usingDirectives.length;

    // Start after using directives
    let currentChunkStart = usingBlock ? usingBlock.endPos + 1 : 0;
    let currentChunkSize = 0;

    // Group declarations into chunks
    for (let i = 0; i < nonUsingDeclarations.length; i++) {
      const decl = nonUsingDeclarations[i];

      // Calculate size including the declaration
      const declSize = decl.endPos - decl.startPos + 1;
      const totalSizeWithUsings = currentChunkSize + declSize + usingSize;

      // Check if we need to create a new chunk
      if (currentChunkSize > 0 && totalSizeWithUsings > maxChunkSize) {
        // Create boundary before current declaration
        const boundaryPos = decl.startPos - 1;

        // Ensure boundary is after previous content
        if (boundaryPos > currentChunkStart) {
          boundaries.push(boundaryPos);
          currentChunkStart = decl.startPos;
          currentChunkSize = 0;
        }
      }

      // For very large single declarations that exceed chunk size
      if (declSize + usingSize > maxChunkSize) {
        logger.warn('Single declaration exceeds chunk size, will process as single chunk', {
          declaration: decl.name,
          size: declSize,
          maxChunkSize
        });

        // If this is not the first declaration in chunk, create boundary before it
        if (currentChunkSize > 0) {
          const boundaryPos = decl.startPos - 1;
          if (boundaryPos > currentChunkStart) {
            boundaries.push(boundaryPos);
            currentChunkStart = decl.startPos;
            currentChunkSize = 0;
          }
        }

        // For large declarations, we'll process them as a single oversized chunk
        // Create boundary after this large declaration
        const boundaryPos = decl.endPos;
        if (i < nonUsingDeclarations.length - 1) { // Only add boundary if not the last declaration
          boundaries.push(boundaryPos);
          currentChunkStart = decl.endPos + 1;
          currentChunkSize = 0;
        }
      } else {
        // Add declaration to current chunk
        currentChunkSize += declSize;
      }

      // For namespace declarations, try to keep their contents together
      if (decl.type === 'namespace_declaration' && declSize < maxChunkSize) {
        // Find all declarations within this namespace
        const namespaceEnd = decl.endPos;
        let j = i + 1;
        let namespaceTotalSize = declSize;

        while (j < declarations.length && declarations[j].startPos < namespaceEnd) {
          const innerDecl = declarations[j];
          const innerSize = innerDecl.endPos - innerDecl.startPos + 1;

          // If namespace contents fit in chunk, keep together
          if (namespaceTotalSize + innerSize + usingSize <= maxChunkSize) {
            namespaceTotalSize += innerSize;
            j++;
          } else {
            break;
          }
        }

        // Skip inner declarations we've included
        if (j > i + 1) {
          i = j - 1;
          currentChunkSize = namespaceTotalSize;
        }
      }
    }

    return boundaries;
  }

  /**
   * Fallback boundary detection with improved heuristics
   */
  private getFallbackBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries: number[] = [];
    const targetChunkSize = Math.floor(maxChunkSize * 0.85);

    let position = 0;
    let lastBoundary = 0;

    while (position < content.length) {
      const chunkStart = lastBoundary;
      const searchStart = chunkStart + Math.floor(targetChunkSize * 0.7);
      const searchEnd = Math.min(chunkStart + maxChunkSize, content.length);

      // If remaining content fits in one chunk, we're done
      if (searchEnd >= content.length && (content.length - chunkStart) <= maxChunkSize) {
        break;
      }

      // Use improved state tracking with focus on class boundaries
      const selectedBoundary = this.findBestFallbackBoundary(content, chunkStart, searchStart, searchEnd);

      if (selectedBoundary > chunkStart) {
        boundaries.push(selectedBoundary);
        lastBoundary = selectedBoundary;
        position = selectedBoundary;
      } else {
        // Emergency fallback
        const fallback = Math.min(chunkStart + targetChunkSize, content.length - 1);
        logger.error('Using emergency fallback boundary', {
          chunkStart,
          fallback,
          contentLength: content.length
        });
        boundaries.push(fallback);
        break;
      }
    }

    return boundaries;
  }

  /**
   * Find best boundary using state tracking with strong class boundary preference
   */
  private findBestFallbackBoundary(content: string, chunkStart: number, searchStart: number, searchEnd: number): number {
    const state = this.initializeCSharpParseState();
    const boundaries: Array<{position: number, quality: number, type: string}> = [];

    // Parse from chunk start to build up state
    for (let i = chunkStart; i < searchEnd && i < content.length; i++) {
      const char = content[i];
      const nextChar = i < content.length - 1 ? content[i + 1] : '';
      const prevChar = i > 0 ? content[i - 1] : '';

      // Update state
      this.updateCSharpParseState(state, char, nextChar, prevChar, i, content);

      // Only look for boundaries in the search range
      if (i >= searchStart && i < searchEnd) {
        // Strongly prefer boundaries after complete classes
        if (char === '}' && state.braceLevel === 0) {
          // Check if this might be end of a class/namespace
          const context = content.substring(Math.max(0, i - 500), i);
          if (context.includes('class ') || context.includes('interface ') ||
              context.includes('namespace ') || context.includes('struct ')) {
            boundaries.push({
              position: i,
              quality: 1.0,
              type: 'class_end'
            });
          }
        }

        // Good boundary: after statement at top level
        if (char === ';' && state.braceLevel === 0) {
          boundaries.push({
            position: i,
            quality: 0.7,
            type: 'statement_end'
          });
        }

        // OK boundary: after any block
        if (char === '}' && state.braceLevel === 1) {
          boundaries.push({
            position: i,
            quality: 0.5,
            type: 'block_end'
          });
        }
      }
    }

    // Sort by quality, then prefer later positions for larger chunks
    boundaries.sort((a, b) => {
      if (Math.abs(a.quality - b.quality) > 0.1) {
        return b.quality - a.quality;
      }
      return b.position - a.position;
    });

    return boundaries.length > 0 ? boundaries[0].position : -1;
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

    // Remove duplicates before context preservation
    let uniqueSymbols = this.removeDuplicateSymbols(allSymbols);
    let uniqueDependencies = this.removeDuplicateDependencies(allDependencies);
    let uniqueImports = this.removeDuplicateImports(allImports);
    const uniqueExports = this.removeDuplicateExports(allExports);

    // Apply C# specific context preservation
    uniqueImports = this.preserveUsingDirectives(chunks);
    uniqueSymbols = this.preserveClassContext(chunks, uniqueSymbols);
    uniqueDependencies = this.preserveInheritanceContext(chunks, uniqueDependencies);

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
        crossChunkReferencesFound: this.findCrossChunkReferences(uniqueSymbols, uniqueDependencies)
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

  // State-based chunking helper methods

  private initializeCSharpParseState(): CSharpParseState {
    return {
      // String literal tracking
      inString: 'none',
      stringDelimiter: '',
      escapeNext: false,

      // Comment tracking
      inComment: 'none',

      // Nesting level tracking
      braceLevel: 0,
      parenLevel: 0,
      bracketLevel: 0,
      angleLevel: 0,

      // C# structure tracking
      inUsings: false,
      inNamespace: false,
      inClass: false,
      inMethod: false,
      inProperty: false,
      inInterface: false,
      inStruct: false,
      inEnum: false,

      // Safe boundary positions
      lastUsingEnd: -1,
      lastNamespaceEnd: -1,
      lastClassEnd: -1,
      lastMethodEnd: -1,
      lastPropertyEnd: -1,
      lastStatementEnd: -1,
      lastBlockEnd: -1,
      lastEnumEnd: -1,
      lastInterfaceEnd: -1,
      lastStructEnd: -1,

      // Context preservation
      usingDirectives: [],
      namespaceContext: '',
      classContext: '',
      inheritanceContext: '',
      currentIndentLevel: 0
    };
  }

  private updateCSharpParseState(
    state: CSharpParseState,
    char: string,
    nextChar: string,
    prevChar: string,
    position: number,
    content: string
  ): void {
    // Update string literal state
    this.updateStringState(state, char, nextChar, prevChar);

    // Update comment state
    this.updateCommentState(state, char, nextChar, prevChar);

    // Skip further processing if in string or comment
    if (state.inString !== 'none' || state.inComment !== 'none') {
      return;
    }

    // Update nesting levels
    this.updateNestingLevels(state, char);

    // Update C# structure context
    this.updateStructureContext(state, char, position, content);

    // Update safe boundary positions
    this.updateSafeBoundaryPositions(state, char, position, content);
  }

  private updateStringState(
    state: CSharpParseState,
    char: string,
    nextChar: string,
    prevChar: string
  ): void {
    // Handle escape sequences
    if (state.escapeNext) {
      state.escapeNext = false;
      return;
    }

    // Check for escape character
    if (char === '\\' && state.inString !== 'none' && state.inString !== 'verbatim') {
      state.escapeNext = true;
      return;
    }

    // Handle string entry/exit
    if (state.inString === 'none') {
      // Check for string start
      if (char === '"') {
        if (prevChar === '@') {
          state.inString = 'verbatim';
        } else if (prevChar === '$') {
          state.inString = 'interpolated';
        } else {
          state.inString = 'double';
        }
        state.stringDelimiter = '"';
      } else if (char === "'") {
        state.inString = 'single';
        state.stringDelimiter = "'";
      }
    } else {
      // Check for string end
      if (char === state.stringDelimiter) {
        // For verbatim strings, check for doubled quotes
        if (state.inString === 'verbatim' && nextChar === '"') {
          // Skip - this is an escaped quote in verbatim string
          return;
        }
        state.inString = 'none';
        state.stringDelimiter = '';
      }
    }
  }

  private updateCommentState(
    state: CSharpParseState,
    char: string,
    nextChar: string,
    prevChar: string
  ): void {
    if (state.inComment === 'none') {
      // Check for comment start
      if (char === '/' && nextChar === '/') {
        state.inComment = 'single';
      } else if (char === '/' && nextChar === '*') {
        state.inComment = 'multi';
      } else if (char === '/' && nextChar === '/' && prevChar === '/') {
        // XML documentation comment
        state.inComment = 'xml';
      }
    } else if (state.inComment === 'single' || state.inComment === 'xml') {
      // Single-line and XML comments end at newline
      if (char === '\n') {
        state.inComment = 'none';
      }
    } else if (state.inComment === 'multi') {
      // Multi-line comments end with */
      if (char === '*' && nextChar === '/') {
        state.inComment = 'none';
      }
    }
  }

  private updateNestingLevels(state: CSharpParseState, char: string): void {
    switch (char) {
      case '{':
        state.braceLevel++;
        break;
      case '}':
        state.braceLevel = Math.max(0, state.braceLevel - 1);
        break;
      case '(':
        state.parenLevel++;
        break;
      case ')':
        state.parenLevel = Math.max(0, state.parenLevel - 1);
        break;
      case '[':
        state.bracketLevel++;
        break;
      case ']':
        state.bracketLevel = Math.max(0, state.bracketLevel - 1);
        break;
      case '<':
        // Simple heuristic for generics (not perfect but good enough)
        state.angleLevel++;
        break;
      case '>':
        state.angleLevel = Math.max(0, state.angleLevel - 1);
        break;
    }
  }

  private updateStructureContext(
    state: CSharpParseState,
    char: string,
    position: number,
    content: string
  ): void {
    // Get surrounding context for keyword detection
    const lookBehind = Math.max(0, position - 50);
    const lookAhead = Math.min(content.length, position + 50);
    const context = content.substring(lookBehind, lookAhead);
    const relativePos = position - lookBehind;

    // Check for structure keywords
    const beforeContext = context.substring(0, relativePos);
    const afterContext = context.substring(relativePos);

    // Check for using statements
    if (beforeContext.match(/\busing\s+[\w\.]+$/) && char === ';') {
      const usingMatch = beforeContext.match(/\busing\s+([\w\.]+)$/);
      if (usingMatch) {
        state.usingDirectives.push(usingMatch[1]);
        state.lastUsingEnd = position;
      }
    }

    // Check for namespace
    if (beforeContext.match(/\bnamespace\s+[\w\.]+\s*$/) && char === '{') {
      const nsMatch = beforeContext.match(/\bnamespace\s+([\w\.]+)\s*$/);
      if (nsMatch) {
        state.inNamespace = true;
        state.namespaceContext = nsMatch[1];
      }
    }

    // Check for class/interface/struct/enum
    if (char === '{') {
      if (beforeContext.match(/\bclass\s+\w+/)) {
        state.inClass = true;
        const classMatch = beforeContext.match(/\bclass\s+(\w+)/);
        if (classMatch) {
          state.classContext = classMatch[1];
        }
      } else if (beforeContext.match(/\binterface\s+\w+/)) {
        state.inInterface = true;
      } else if (beforeContext.match(/\bstruct\s+\w+/)) {
        state.inStruct = true;
      } else if (beforeContext.match(/\benum\s+\w+/)) {
        state.inEnum = true;
      }
    }

    // Check for method or property
    if (state.inClass && char === '{') {
      if (beforeContext.match(/\w+\s*\([^)]*\)\s*$/)) {
        state.inMethod = true;
      } else if (beforeContext.match(/\bget\s*;|\bset\s*;|\bget\s*\{|\bset\s*\{/)) {
        state.inProperty = true;
      }
    }
  }

  private updateSafeBoundaryPositions(
    state: CSharpParseState,
    char: string,
    position: number,
    content: string
  ): void {
    // Track indent level
    if (char === '\n') {
      let indent = 0;
      let i = position + 1;
      while (i < content.length && (content[i] === ' ' || content[i] === '\t')) {
        indent++;
        i++;
      }
      state.currentIndentLevel = indent;
    }

    // Update boundary positions when exiting structures
    if (char === '}') {
      if (state.braceLevel === 0) {
        // Top-level closing brace
        if (state.inNamespace) {
          state.lastNamespaceEnd = position;
          state.inNamespace = false;
        } else if (state.inClass) {
          state.lastClassEnd = position;
          state.inClass = false;
        } else if (state.inInterface) {
          state.lastInterfaceEnd = position;
          state.inInterface = false;
        } else if (state.inStruct) {
          state.lastStructEnd = position;
          state.inStruct = false;
        } else if (state.inEnum) {
          state.lastEnumEnd = position;
          state.inEnum = false;
        }
      } else if (state.braceLevel === 1 && state.inClass) {
        // Method or property end
        if (state.inMethod) {
          state.lastMethodEnd = position;
          state.inMethod = false;
        } else if (state.inProperty) {
          state.lastPropertyEnd = position;
          state.inProperty = false;
        }
      }
      state.lastBlockEnd = position;
    }

    // Track statement ends
    if (char === ';' && state.braceLevel > 0) {
      state.lastStatementEnd = position;
    }
  }

  private isSafeBoundaryPoint(
    state: CSharpParseState,
    position: number,
    content: string
  ): boolean {
    // Not safe if we're inside a string or comment
    if (state.inString !== 'none' || state.inComment !== 'none') {
      return false;
    }

    // Not safe if we have unbalanced parentheses or brackets (but angle brackets are ok - generics)
    if (state.parenLevel > 0 || state.bracketLevel > 0) {
      return false;
    }

    // Check current and next character
    const char = content[position];
    const nextChar = position < content.length - 1 ? content[position + 1] : '';

    // Safe after closing braces at any level
    if (char === '}') {
      return true;
    }

    // Safe after semicolons (statement ends)
    if (char === ';') {
      return true;
    }

    // Safe at newlines if we're at brace level 0 or 1
    if (char === '\n' && state.braceLevel <= 1) {
      return true;
    }

    // Safe between method declarations
    if (char === '\n' && position > 0) {
      // Look ahead to see if next non-whitespace starts a method/property/class
      let lookahead = position + 1;
      while (lookahead < content.length && (content[lookahead] === ' ' || content[lookahead] === '\t' || content[lookahead] === '\n')) {
        lookahead++;
      }

      if (lookahead < content.length) {
        const nextContent = content.substring(lookahead, Math.min(lookahead + 50, content.length));
        // Check for common C# keywords that start declarations
        if (nextContent.match(/^(public|private|protected|internal|static|abstract|virtual|override|sealed|partial|class|interface|struct|enum|namespace|using)/)) {
          return true;
        }
      }
    }

    return false;
  }

  private calculateBoundaryQuality(
    state: CSharpParseState,
    position: number,
    content: string
  ): number {
    let quality = 0.0;

    // High quality: End of complete structures
    if (position === state.lastNamespaceEnd) {
      quality += 0.5;
    } else if (position === state.lastClassEnd || position === state.lastInterfaceEnd || position === state.lastStructEnd) {
      quality += 0.4;
    } else if (position === state.lastMethodEnd) {
      quality += 0.3;
    } else if (position === state.lastPropertyEnd) {
      quality += 0.25;
    } else if (position === state.lastEnumEnd) {
      quality += 0.35;
    }

    // Medium quality: Statement and block boundaries
    if (position === state.lastStatementEnd) {
      quality += 0.2;
    }
    if (position === state.lastBlockEnd) {
      quality += 0.25;
    }

    // Using directive boundaries
    if (position === state.lastUsingEnd) {
      quality += 0.15;
    }

    // Context preservation bonus
    if (state.usingDirectives.length > 0) {
      quality += 0.1;
    }
    if (state.namespaceContext) {
      quality += 0.1;
    }
    if (state.classContext) {
      quality += 0.05;
    }

    // Penalty for deep nesting
    quality -= (state.braceLevel * 0.05);

    // Bonus for clean boundaries (after newline)
    if (position < content.length - 1 && content[position + 1] === '\n') {
      quality += 0.1;
    }

    // Bonus for being at low indent level
    if (state.currentIndentLevel <= 4) {
      quality += 0.05;
    }

    return Math.max(0, Math.min(1, quality));
  }


  // Context preservation methods for merging chunks

  private preserveUsingDirectives(chunkResults: ParseResult[]): ParsedImport[] {
    const allUsings = new Map<string, ParsedImport>();

    // Collect all unique using directives from all chunks
    chunkResults.forEach(result => {
      result.imports.forEach(imp => {
        // Check if this is a C# using directive
        if (imp.import_type === 'namespace' || imp.source.startsWith('System') || imp.source.includes('.')) {
          const key = imp.source;
          if (!allUsings.has(key)) {
            allUsings.set(key, {
              ...imp,
              import_type: 'namespace' // Normalize import type for C# usings
            });
          }
        }
      });
    });

    return Array.from(allUsings.values());
  }

  private preserveClassContext(chunkResults: ParseResult[], existingSymbols: ParsedSymbol[]): ParsedSymbol[] {
    const classHierarchy = new Map<string, { parent?: string, interfaces: string[], signature?: string }>();

    // Build complete class hierarchy from all chunks
    chunkResults.forEach(result => {
      result.symbols.forEach(symbol => {
        if (symbol.symbol_type === 'class' || symbol.symbol_type === 'interface') {
          const existing = classHierarchy.get(symbol.name);
          if (!existing) {
            classHierarchy.set(symbol.name, {
              parent: undefined,
              interfaces: [],
              signature: symbol.signature
            });
          } else {
            // Merge signature information from multiple chunks
            if (symbol.signature && !existing.signature) {
              existing.signature = symbol.signature;
            }
          }
        }
      });
    });

    // Apply preserved context to symbols
    return existingSymbols.map(symbol => {
      if ((symbol.symbol_type === 'class' || symbol.symbol_type === 'interface') && classHierarchy.has(symbol.name)) {
        const hierarchy = classHierarchy.get(symbol.name)!;
        return {
          ...symbol,
          // Preserve or enhance signature with inheritance info
          signature: symbol.signature || hierarchy.signature || symbol.name
        };
      }
      return symbol;
    });
  }

  private preserveInheritanceContext(chunkResults: ParseResult[], existingDependencies: ParsedDependency[]): ParsedDependency[] {
    const inheritanceMap = new Map<string, Set<string>>();

    // Build inheritance relationships from all chunks
    chunkResults.forEach(result => {
      result.dependencies.forEach(dep => {
        if (dep.dependency_type === 'inherits' || dep.dependency_type === 'implements') {
          const key = `${dep.from_symbol}:${dep.dependency_type}`;
          if (!inheritanceMap.has(key)) {
            inheritanceMap.set(key, new Set());
          }
          inheritanceMap.get(key)!.add(dep.to_symbol);
        }
      });
    });

    // Ensure all inheritance relationships are preserved
    const preservedDeps = [...existingDependencies];
    inheritanceMap.forEach((targets, key) => {
      const [source, type] = key.split(':');
      targets.forEach(target => {
        const exists = preservedDeps.some(dep =>
          dep.from_symbol === source &&
          dep.to_symbol === target &&
          dep.dependency_type === type
        );

        if (!exists) {
          preservedDeps.push({
            from_symbol: source,
            to_symbol: target,
            dependency_type: type as DependencyType,
            line_number: 0,
            confidence: 1.0
          });
        }
      });
    });

    return preservedDeps;
  }

  private findCrossChunkReferences(symbols: ParsedSymbol[], dependencies: ParsedDependency[]): number {
    // Count dependencies that reference symbols from different chunks
    let crossChunkCount = 0;
    const symbolChunkMap = new Map<string, number>();

    // Map symbols to their chunk indices (approximation based on line numbers)
    symbols.forEach(symbol => {
      const chunkIndex = Math.floor((symbol.start_line || 0) / 1000); // Rough estimate
      symbolChunkMap.set(symbol.name, chunkIndex);
    });

    // Count cross-chunk dependencies
    dependencies.forEach(dep => {
      const sourceChunk = symbolChunkMap.get(dep.from_symbol) || 0;
      const targetChunk = symbolChunkMap.get(dep.to_symbol) || 0;
      if (sourceChunk !== targetChunk) {
        crossChunkCount++;
      }
    });

    return crossChunkCount;
  }
}