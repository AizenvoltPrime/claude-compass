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

interface EnhancedTypeInfo {
  type: string;
  confidence: number;
  source: 'field' | 'variable' | 'parameter' | 'property';
  namespace?: string;
  fullQualifiedName?: string;
}

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
  private currentFilePath?: string;
  // Use WeakMap to associate cache with specific tree root nodes
  private nodeTypeCacheMap: WeakMap<Parser.SyntaxNode, Map<string, Parser.SyntaxNode[]>> = new WeakMap();
  private typeResolutionCache: Map<string, EnhancedTypeInfo | null> = new Map();

  constructor() {
    const parser = new Parser();
    parser.setLanguage(CSharp as any);
    super(parser, 'csharp');
  }

  getSupportedExtensions(): string[] {
    return ['.cs'];
  }

  async parseFile(filePath: string, content: string, options?: ParseOptions): Promise<ParseResult> {
    // Clear caches for new file parse
    this.clearCaches();

    // Store current file path for enhanced context
    this.currentFilePath = filePath;

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

      // Validate method call detection completeness
      const methodCallValidationErrors = this.validateMethodCallDetection(content, dependencies, filePath);
      validationErrors.push(...methodCallValidationErrors);

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

      // Validate method call detection completeness
      const methodCallValidationErrors = this.validateMethodCallDetection(content, dependencies, filePath);
      validationErrors.push(...methodCallValidationErrors);

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

  /**
   * Collect all nodes by type in a single AST traversal for performance optimization
   * This reduces complexity from O(n*m) to O(n) where n is nodes and m is node types
   */
  private collectAllNodesByType(rootNode: Parser.SyntaxNode): Map<string, Parser.SyntaxNode[]> {
    const nodeMap = new Map<string, Parser.SyntaxNode[]>();

    // Single traversal to collect all nodes
    const traverse = (node: Parser.SyntaxNode) => {
      // Add node to its type's array
      if (!nodeMap.has(node.type)) {
        nodeMap.set(node.type, []);
      }
      nodeMap.get(node.type)!.push(node);

      // Traverse children using namedChildren for semantic traversal
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(rootNode);
    return nodeMap;
  }

  /**
   * Get nodes of a specific type from the cache or perform a single traversal
   */
  private getNodesOfType(rootNode: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    // Get or create cache for this specific tree
    let nodeTypeCache = this.nodeTypeCacheMap.get(rootNode);

    if (!nodeTypeCache) {
      // Build cache for this specific tree with a single traversal
      nodeTypeCache = this.collectAllNodesByType(rootNode);
      this.nodeTypeCacheMap.set(rootNode, nodeTypeCache);
    }

    return nodeTypeCache.get(type) || [];
  }

  /**
   * Clear the node type cache when starting a new file parse
   */
  private clearCaches() {
    // WeakMap automatically cleans up when trees are garbage collected
    // We only need to clear the type resolution cache
    this.typeResolutionCache.clear();
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract namespace declarations
    const namespaceNodes = this.getNodesOfType(rootNode, 'namespace_declaration');
    for (const node of namespaceNodes) {
      const symbol = this.extractNamespaceSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract class declarations
    const classNodes = this.getNodesOfType(rootNode, 'class_declaration');
    for (const node of classNodes) {
      const symbol = this.extractClassSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract interface declarations
    const interfaceNodes = this.getNodesOfType(rootNode, 'interface_declaration');
    for (const node of interfaceNodes) {
      const symbol = this.extractInterfaceSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract struct declarations
    const structNodes = this.getNodesOfType(rootNode, 'struct_declaration');
    for (const node of structNodes) {
      const symbol = this.extractStructSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract enum declarations
    const enumNodes = this.getNodesOfType(rootNode, 'enum_declaration');
    for (const node of enumNodes) {
      const symbol = this.extractEnumSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract method declarations
    const methodNodes = this.getNodesOfType(rootNode, 'method_declaration');
    for (const node of methodNodes) {
      const symbol = this.extractMethodSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract property declarations
    const propertyNodes = this.getNodesOfType(rootNode, 'property_declaration');
    for (const node of propertyNodes) {
      const symbol = this.extractPropertySymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract field declarations
    const fieldNodes = this.getNodesOfType(rootNode, 'field_declaration');
    for (const node of fieldNodes) {
      const fieldSymbols = this.extractFieldSymbols(node, content);
      symbols.push(...fieldSymbols);
    }

    // Extract event declarations
    const eventNodes = this.getNodesOfType(rootNode, 'event_declaration');
    for (const node of eventNodes) {
      const eventSymbols = this.extractEventSymbols(node, content);
      symbols.push(...eventSymbols);
    }

    // Extract delegate declarations
    const delegateNodes = this.getNodesOfType(rootNode, 'delegate_declaration');
    for (const node of delegateNodes) {
      const symbol = this.extractDelegateSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract constructor declarations
    const constructorNodes = this.getNodesOfType(rootNode, 'constructor_declaration');
    for (const node of constructorNodes) {
      const symbol = this.extractConstructorSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    return symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract method calls
    const callNodes = this.getNodesOfType(rootNode, 'invocation_expression');
    logger.debug('C# dependency extraction: method calls', {
      invocationExpressionCount: callNodes.length
    });

    for (const node of callNodes) {
      const dependency = this.extractCallDependency(node, content);
      if (dependency) {
        dependencies.push(dependency);
        logger.debug('C# method call detected', {
          from: dependency.from_symbol,
          to: dependency.to_symbol,
          line: dependency.line_number,
          confidence: dependency.confidence,
          type: dependency.dependency_type
        });
      } else {
        logger.debug('C# method call extraction failed', {
          line: node.startPosition.row + 1,
          nodeType: node.type,
          nodeText: this.getNodeText(node, content).substring(0, 100)
        });
      }
    }

    // Extract conditional access expressions (null-conditional operator ?.)
    const conditionalAccessNodes = this.getNodesOfType(rootNode, 'conditional_access_expression');
    logger.debug('C# dependency extraction: conditional access expressions', {
      conditionalAccessCount: conditionalAccessNodes.length
    });

    for (const node of conditionalAccessNodes) {
      const extractedDependencies = this.extractConditionalAccessDependencies(node, content);
      if (extractedDependencies.length > 0) {
        dependencies.push(...extractedDependencies);
        logger.debug('C# conditional access dependencies detected', {
          count: extractedDependencies.length,
          line: node.startPosition.row + 1,
          nodeText: this.getNodeText(node, content).substring(0, 100),
          dependencies: extractedDependencies.map(d => `${d.from_symbol} -> ${d.to_symbol}`)
        });
      } else {
        logger.debug('C# conditional access extraction failed', {
          line: node.startPosition.row + 1,
          nodeText: this.getNodeText(node, content).substring(0, 100)
        });
      }
    }

    // Extract member access expressions
    const memberAccessNodes = this.getNodesOfType(rootNode, 'member_access_expression');
    logger.debug('C# dependency extraction: member access expressions', {
      memberAccessCount: memberAccessNodes.length
    });

    let memberAccessDependencies = 0;
    for (const node of memberAccessNodes) {
      const dependency = this.extractMemberAccessDependency(node, content);
      if (dependency) {
        dependencies.push(dependency);
        memberAccessDependencies++;
        logger.debug('C# member access detected', {
          from: dependency.from_symbol,
          to: dependency.to_symbol,
          line: dependency.line_number
        });
      }
    }

    // Extract inheritance relationships
    const baseListNodes = this.getNodesOfType(rootNode, 'base_list');
    logger.debug('C# dependency extraction: inheritance relationships', {
      baseListCount: baseListNodes.length
    });

    for (const node of baseListNodes) {
      const inheritanceDeps = this.extractInheritanceDependencies(node, content);
      dependencies.push(...inheritanceDeps);
      logger.debug('C# inheritance relationships detected', {
        count: inheritanceDeps.length,
        line: node.startPosition.row + 1
      });
    }

    // Extract generic type constraints
    const constraintNodes = this.getNodesOfType(rootNode, 'type_parameter_constraints_clause');
    for (const node of constraintNodes) {
      const constraintDeps = this.extractConstraintDependencies(node, content);
      dependencies.push(...constraintDeps);
    }

    // Deduplicate dependencies to eliminate overlapping extractions
    const dedupedDependencies = this.deduplicateDependencies(dependencies);

    logger.info('C# dependency extraction completed', {
      totalDependencies: dependencies.length,
      deduplicatedDependencies: dedupedDependencies.length,
      duplicatesRemoved: dependencies.length - dedupedDependencies.length,
      invocationExpressions: callNodes.length,
      conditionalAccessExpressions: conditionalAccessNodes.length,
      memberAccessExpressions: memberAccessNodes.length,
      memberAccessDependencies,
      inheritanceRelationships: baseListNodes.length,
      methodCalls: dedupedDependencies.filter(d => d.dependency_type === 'calls').length,
      references: dedupedDependencies.filter(d => d.dependency_type === 'references').length,
      inheritance: dedupedDependencies.filter(d => d.dependency_type === 'inherits' || d.dependency_type === 'implements').length
    });

    return dedupedDependencies;
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Extract using directives
    const usingNodes = this.getNodesOfType(rootNode, 'using_directive');
    for (const node of usingNodes) {
      const importObj = this.extractUsingDirective(node, content);
      if (importObj) imports.push(importObj);
    }

    // Extract extern alias directives
    const externAliasNodes = this.getNodesOfType(rootNode, 'extern_alias_directive');
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

    // Extract field type - in C# AST, type is in variable_declaration child, not directly on field_declaration
    let fieldType = 'object';
    const variableDeclarationNode = node.children.find(child => child.type === 'variable_declaration');
    if (variableDeclarationNode) {
      const typeNode = variableDeclarationNode.childForFieldName('type');
      if (typeNode) {
        fieldType = this.getNodeText(typeNode, content);
      }
    }

    // Field declarations can contain multiple variables
    const declaratorNodes = this.getNodesOfType(node, 'variable_declarator');
    for (const declarator of declaratorNodes) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;

      const name = this.getNodeText(nameNode, content);

      // Build signature with type information
      const signature = `${modifiers.join(' ')} ${fieldType} ${name}`.trim();

      symbols.push({
        name,
        symbol_type: modifiers.includes('const') ? SymbolType.CONSTANT : SymbolType.VARIABLE,
        start_line: declarator.startPosition.row + 1,
        end_line: declarator.endPosition.row + 1,
        is_exported: modifiers.includes('public'),
        visibility: visibility || Visibility.PRIVATE,
        signature // Include type information in signature for later resolution
      });
    }

    return symbols;
  }

  private extractEventSymbols(node: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    const modifiers = this.extractModifiers(node, content);
    const visibility = this.getVisibilityFromModifiers(modifiers);

    // Event declarations can contain multiple events
    const declaratorNodes = this.getNodesOfType(node, 'variable_declarator');
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

  /**
   * Resolve the class type of a calling object by looking up field declarations
   * @param callingObject - The object name (e.g., "_cardManager")
   * @param rootNode - The root node to search for field declarations
   * @param content - The file content
   * @returns The resolved class type (e.g., "CardManager") or null if not found
   */
  private resolveCallingObjectType(callingObject: string, rootNode: Parser.SyntaxNode, content: string): string | null {
    if (!callingObject || callingObject.trim() === '') {
      return null;
    }

    // Check cache first to avoid repeated traversals
    const cacheKey = callingObject.trim();
    if (this.typeResolutionCache.has(cacheKey)) {
      const cached = this.typeResolutionCache.get(cacheKey);
      return cached ? cached.type : null;
    }

    try {
      // Multi-strategy resolution with fallbacks (Phase 3.2 Enhancement)
      const strategies = [
        () => this.resolveFieldType(callingObject, rootNode, content),
        () => this.resolveLocalVariableType(callingObject, rootNode, content),
        () => this.resolveParameterType(callingObject, rootNode, content),
        () => this.resolvePropertyType(callingObject, rootNode, content)
      ];

      for (const strategy of strategies) {
        const result = strategy();
        if (result) {
          // Cache the result for future lookups
          this.typeResolutionCache.set(cacheKey, result);
          return result.type;
        }
      }

      // Cache null result to avoid re-traversing for this object
      this.typeResolutionCache.set(cacheKey, null);
      return null;
    } catch (error) {
      // Cache null result even on error
      this.typeResolutionCache.set(cacheKey, null);
      return null;
    }
  }


  /**
   * Strategy 1: Resolve field type
   */
  private resolveFieldType(callingObject: string, rootNode: Parser.SyntaxNode, content: string): EnhancedTypeInfo | null {
    const cleanObjectName = callingObject.trim().replace(/^(this\.|_)/, '');
    const fieldNodes = this.getNodesOfType(rootNode, 'field_declaration');

    for (const fieldNode of fieldNodes) {
      let fieldType = '';
      const variableDeclarationNode = fieldNode.children.find(child => child.type === 'variable_declaration');
      if (variableDeclarationNode) {
        const typeNode = variableDeclarationNode.childForFieldName('type');
        if (typeNode) {
          fieldType = this.getNodeText(typeNode, content);
        }
      }
      if (!fieldType) continue;

      const declaratorNodes = this.getNodesOfType(fieldNode, 'variable_declarator');
      for (const declarator of declaratorNodes) {
        const nameNode = declarator.childForFieldName('name');
        if (!nameNode) continue;

        const fieldName = this.getNodeText(nameNode, content);
        if (fieldName === callingObject || fieldName === cleanObjectName) {
          const resolvedType = this.extractClassNameFromType(fieldType);
          return {
            type: resolvedType,
            confidence: 0.95,
            source: 'field',
            fullQualifiedName: fieldType
          };
        }
      }
    }
    return null;
  }

  /**
   * Strategy 2: Resolve local variable type
   */
  private resolveLocalVariableType(callingObject: string, rootNode: Parser.SyntaxNode, content: string): EnhancedTypeInfo | null {
    const cleanObjectName = callingObject.trim().replace(/^(this\.|_)/, '');
    const localDeclarations = this.getNodesOfType(rootNode, 'local_declaration_statement');

    for (const localDecl of localDeclarations) {
      const variableDeclaration = this.findNodeOfType(localDecl, 'variable_declaration');
      if (!variableDeclaration) continue;

      const typeNode = variableDeclaration.childForFieldName('type');
      if (!typeNode) continue;

      const declarators = this.getNodesOfType(variableDeclaration, 'variable_declarator');
      for (const declarator of declarators) {
        const nameNode = declarator.childForFieldName('name');
        if (!nameNode) continue;

        const varName = this.getNodeText(nameNode, content);
        if (varName === callingObject || varName === cleanObjectName) {
          const varType = this.getNodeText(typeNode, content);
          const resolvedType = this.extractClassNameFromType(varType);
          return {
            type: resolvedType,
            confidence: 0.90,
            source: 'variable',
            fullQualifiedName: varType
          };
        }
      }
    }
    return null;
  }

  /**
   * Strategy 3: Resolve parameter type
   */
  private resolveParameterType(callingObject: string, rootNode: Parser.SyntaxNode, content: string): EnhancedTypeInfo | null {
    const cleanObjectName = callingObject.trim().replace(/^(this\.|_)/, '');
    const methodNodes = this.getNodesOfType(rootNode, 'method_declaration');

    for (const methodNode of methodNodes) {
      const parameterList = methodNode.childForFieldName('parameters');
      if (!parameterList) continue;

      for (let i = 0; i < parameterList.childCount; i++) {
        const child = parameterList.child(i);
        if (child?.type === 'parameter') {
          const typeNode = child.childForFieldName('type');
          const nameNode = child.childForFieldName('name');
          if (!typeNode || !nameNode) continue;

          const paramName = this.getNodeText(nameNode, content);
          if (paramName === callingObject || paramName === cleanObjectName) {
            const paramType = this.getNodeText(typeNode, content);
            const resolvedType = this.extractClassNameFromType(paramType);
            return {
              type: resolvedType,
              confidence: 0.85,
              source: 'parameter',
              fullQualifiedName: paramType
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * Strategy 4: Resolve property type
   */
  private resolvePropertyType(callingObject: string, rootNode: Parser.SyntaxNode, content: string): EnhancedTypeInfo | null {
    const cleanObjectName = callingObject.trim().replace(/^(this\.|_)/, '');
    const propertyNodes = this.getNodesOfType(rootNode, 'property_declaration');

    for (const propertyNode of propertyNodes) {
      const typeNode = propertyNode.childForFieldName('type');
      const nameNode = propertyNode.childForFieldName('name');

      if (!typeNode || !nameNode) continue;

      const propertyName = this.getNodeText(nameNode, content);
      if (propertyName === callingObject || propertyName === cleanObjectName) {
        const propertyType = this.getNodeText(typeNode, content);
        const resolvedType = this.extractClassNameFromType(propertyType);
        return {
          type: resolvedType,
          confidence: 0.88,
          source: 'property',
          fullQualifiedName: propertyType
        };
      }
    }
    return null;
  }

  /**
   * Extract the class name from a type declaration, handling interfaces and generic types
   * @param typeString - The full type string (e.g., "ICardManager", "List<CardData>", "CardManager")
   * @returns The clean class name (e.g., "CardManager", "List", "CardManager")
   */
  private extractClassNameFromType(typeString: string): string {
    if (!typeString) return typeString;

    // Remove interface prefix (I prefix) - convert ICardManager to CardManager
    let cleanType = typeString.trim();

    // Handle generic types - extract base type from List<T>, Dictionary<K,V>, etc.
    const genericMatch = cleanType.match(/^([^<]+)</);
    if (genericMatch) {
      cleanType = genericMatch[1];
    }

    // Remove interface prefix if it follows the IClassName pattern
    if (cleanType.startsWith('I') && cleanType.length > 1 && /^[A-Z]/.test(cleanType.charAt(1))) {
      // Check if this looks like an interface name (IClassName -> ClassName)
      const withoutI = cleanType.substring(1);
      logger.debug('C# interface type conversion', {
        original: cleanType,
        converted: withoutI
      });
      return withoutI;
    }

    return cleanType;
  }

  private extractCallDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) {
      logger.debug('C# method call extraction failed: no function node', {
        line: node.startPosition.row + 1,
        nodeType: node.type
      });
      return null;
    }

    // Extract method name and calling context, handling different expression types
    let methodName = '';
    let callingObject = '';

    if (functionNode.type === 'member_access_expression') {
      // For member access like obj.Method() or this.Method()
      const nameNode = functionNode.childForFieldName('name');
      const objectNode = functionNode.childForFieldName('expression');

      methodName = nameNode ? this.getNodeText(nameNode, content) : '';
      callingObject = objectNode ? this.getNodeText(objectNode, content) : '';

      // If no method name extracted, use the full expression
      if (!methodName) {
        methodName = this.getNodeText(functionNode, content);
      }
    } else if (functionNode.type === 'identifier') {
      // For simple method calls like Method()
      methodName = this.getNodeText(functionNode, content);
    } else if (functionNode.type === 'generic_name') {
      // For generic method calls like Method<T>()
      const nameNode = functionNode.childForFieldName('name');
      methodName = nameNode ? this.getNodeText(nameNode, content) : this.getNodeText(functionNode, content);
    } else if (functionNode.type === 'qualified_name') {
      // For qualified calls like Namespace.Class.Method()
      const nameNode = functionNode.childForFieldName('name');
      methodName = nameNode ? this.getNodeText(nameNode, content) : this.getNodeText(functionNode, content);
    } else if (functionNode.type === 'conditional_access_expression') {
      // For conditional access calls like obj?.Method() - extract the final method in the chain
      // Look for member_binding_expression nodes which contain the method names in chained calls
      const memberBindingNodes = this.getNodesOfType(functionNode, 'member_binding_expression');

      if (memberBindingNodes.length > 0) {
        // Get the last member_binding_expression for the final method in the chain
        const finalMemberBinding = memberBindingNodes[memberBindingNodes.length - 1];
        const identifierNode = finalMemberBinding.children.find(child => child.type === 'identifier');
        methodName = identifierNode ? this.getNodeText(identifierNode, content) : '';

        logger.debug('C# conditional access method extracted from member binding', {
          methodName,
          memberBindingCount: memberBindingNodes.length,
          finalBindingText: this.getNodeText(finalMemberBinding, content)
        });
      }

      if (!methodName) {
        // Fallback: try to extract from the full text
        methodName = this.getNodeText(functionNode, content);
      }
    } else if (functionNode.type === 'element_access_expression') {
      // For indexer method calls like array[index].Method()
      methodName = this.getNodeText(functionNode, content);
    } else if (functionNode.type === 'invocation_expression') {
      // For nested invocation expressions like Method1().Method2()
      const innerFunction = functionNode.childForFieldName('function');
      methodName = innerFunction ? this.getNodeText(innerFunction, content) : this.getNodeText(functionNode, content);
    } else {
      // For complex expressions, use the full text but try to extract meaningful names
      const fullText = this.getNodeText(functionNode, content);

      // Try to extract method name from complex expressions
      const methodCallMatch = fullText.match(/(\w+)\s*\(/);
      if (methodCallMatch) {
        methodName = methodCallMatch[1];
      } else {
        methodName = fullText;
      }
    }

    // Clean up method name (remove whitespace, handle edge cases)
    methodName = methodName.trim();
    if (!methodName) {
      // Fallback to full expression text if no method name could be extracted
      methodName = this.getNodeText(functionNode, content).trim();
    }

    // Skip if we couldn't extract a meaningful method name
    if (!methodName || methodName.length === 0) {
      logger.debug('C# method call extraction failed: no method name', {
        line: node.startPosition.row + 1,
        functionType: functionNode.type,
        functionText: this.getNodeText(functionNode, content).substring(0, 50)
      });
      return null;
    }

    const callerName = this.findContainingFunction(node, content);

    // Create qualified method name if we can resolve the calling object type
    let qualifiedMethodName = methodName;

    if (callingObject && callingObject.trim() !== '') {
      try {
        // Find the root node by traversing up the AST
        let rootNode = node;
        while (rootNode.parent !== null) {
          rootNode = rootNode.parent;
        }

        // Resolve the calling object type
        const resolvedObjectType = this.resolveCallingObjectType(callingObject, rootNode, content);

        if (resolvedObjectType) {
          // Create qualified method name: "ClassName.MethodName"
          qualifiedMethodName = `${resolvedObjectType}.${methodName}`;

          logger.debug('C# calling object type resolved', {
            callingObject,
            cleanObjectName: callingObject.trim().replace(/^(this\.|_)/, ''),
            resolvedType: resolvedObjectType
          });
        } else {
          logger.debug('C# calling object type could not be resolved', {
            methodName,
            callingObject,
            line: node.startPosition.row + 1
          });
        }
      } catch (error) {
        // Don't let resolution errors break the dependency creation
        logger.debug('C# calling object resolution failed', {
          callingObject,
          methodName,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Log method call detection
    logger.debug('C# method call extraction details');

    // Determine confidence based on extraction quality
    let confidence = 0.9;
    if (qualifiedMethodName !== methodName) {
      // Highest confidence when we have resolved qualified method name
      confidence = 0.98;
    } else if (callingObject) {
      // Higher confidence when we have calling object context (even if unresolved)
      confidence = 0.95;
    } else if (functionNode.type === 'identifier' || functionNode.type === 'member_access_expression') {
      // High confidence for simple patterns
      confidence = 0.9;
    } else if (methodName.includes('(') || methodName.includes('.')) {
      // Lower confidence for complex expressions that might not be clean method names
      confidence = 0.7;
    }

    return {
      from_symbol: callerName,
      to_symbol: methodName,          // ✅ Use unqualified name for reliable symbol matching
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
      confidence,

      // 🚀 Enhanced context fields for rich analysis
      calling_object: callingObject || undefined,
      resolved_class: (qualifiedMethodName !== methodName) ? qualifiedMethodName.split('.')[0] : undefined,
      qualified_context: (qualifiedMethodName !== methodName) ? qualifiedMethodName : undefined,
      method_signature: this.buildMethodSignature(methodName, node, content),
      file_context: this.currentFilePath || undefined,
      namespace_context: this.getCurrentNamespace(node, content)
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

  /**
   * Extract dependencies from conditional access expressions (null-conditional operator ?.)
   * Handles patterns like: obj?.Method(), obj?.Property?.Method(), chained calls, etc.
   * Returns array to support chained method calls that generate multiple dependencies.
   */
  private extractConditionalAccessDependencies(node: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];
    const maxChainDepth = 10; // Prevent infinite recursion

    logger.debug('C# conditional access extraction starting', {
      line: node.startPosition.row + 1,
      nodeText: this.getNodeText(node, content).substring(0, 100)
    });

    // First, try to extract chained calls using regex for complete coverage
    // This handles cases like _serviceA?.MethodOne()?.MethodTwo()
    const expressionText = this.getNodeText(node, content);
    if (expressionText.includes('?.')) {
      const callerName = this.findContainingFunction(node, content);
      const chainedCalls = this.extractChainedCallsFromText(expressionText, callerName, node.startPosition.row + 1);

      if (chainedCalls.length > 0) {
        // Add these with higher confidence since we detected the pattern
        for (const call of chainedCalls) {
          call.confidence = 0.85;
        }
        dependencies.push(...chainedCalls);

        logger.debug('C# conditional access chained calls extracted', {
          count: chainedCalls.length,
          expression: expressionText.substring(0, 100),
          methods: chainedCalls.map(d => d.to_symbol)
        });
      }
    }

    // Extract all invocation expressions within the conditional access chain
    const invocationNodes = this.getNodesOfType(node, 'invocation_expression');

    logger.debug('C# conditional access invocation nodes found', {
      count: invocationNodes.length
    });

    // Process each invocation expression to capture chained method calls
    for (const invocationNode of invocationNodes) {
      const dependency = this.extractCallDependency(invocationNode, content);
      if (dependency) {
        // Check if we already have this dependency from regex extraction
        const isDuplicate = dependencies.some(d =>
          d.to_symbol === dependency.to_symbol &&
          d.from_symbol === dependency.from_symbol &&
          d.line_number === dependency.line_number
        );

        if (!isDuplicate) {
          // Mark as higher confidence since we specifically detected the conditional access pattern
          dependency.confidence = Math.min(0.95, dependency.confidence + 0.1);
          dependencies.push(dependency);

          logger.debug('C# conditional access call extracted', {
            from: dependency.from_symbol,
            to: dependency.to_symbol,
            line: dependency.line_number,
            confidence: dependency.confidence
          });
        }
      }
    }

    // If we found dependencies, we're done
    if (dependencies.length > 0) {
      logger.debug('C# conditional access dependencies extracted', {
        count: dependencies.length,
        methods: dependencies.map(d => d.to_symbol)
      });
      return dependencies;
    }

    // If no invocation found, check for member access within conditional access
    const memberAccessNodes = this.getNodesOfType(node, 'member_access_expression');
    logger.debug('C# conditional access member access nodes found', {
      count: memberAccessNodes.length
    });

    for (const memberAccessNode of memberAccessNodes) {
      const nameNode = memberAccessNode.childForFieldName('name');
      if (!nameNode) continue;

      const memberName = this.getNodeText(nameNode, content);
      const callerName = this.findContainingFunction(node, content);

      // Check if this is a method call (has parentheses) or just property access
      const nodeText = this.getNodeText(node, content);
      const isMethodCall = nodeText.includes('(') && nodeText.includes(')');

      const dependency: ParsedDependency = {
        from_symbol: callerName,
        to_symbol: memberName,
        dependency_type: isMethodCall ? DependencyType.CALLS : DependencyType.REFERENCES,
        line_number: node.startPosition.row + 1,
        confidence: 0.85 // High confidence for conditional access
      };

      dependencies.push(dependency);

      logger.debug('C# conditional access member dependency extracted', {
        from: dependency.from_symbol,
        to: dependency.to_symbol,
        type: dependency.dependency_type,
        line: dependency.line_number
      });
    }

    // If we found member access, we're done
    if (dependencies.length > 0) {
      logger.debug('C# conditional access dependencies extracted from member access', {
        count: dependencies.length
      });
      return dependencies;
    }

    // Fallback: extract using regex pattern matching for complex expressions
    // (Already handled above, so we can skip this duplicate code)

    return dependencies;
  }

  /**
   * Extract chained method calls from complex conditional access expressions using regex patterns
   */
  private extractChainedCallsFromText(expressionText: string, callerName: string, lineNumber: number): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // First, fix the expression if it's missing closing parentheses
    // This handles cases where tree-sitter truncates the expression
    const openParens = (expressionText.match(/\(/g) || []).length;
    const closeParens = (expressionText.match(/\)/g) || []).length;

    // Check if the last identifier looks like a method that's missing parentheses
    // Pattern: ends with "?.Identifier" or ".Identifier" without following parentheses
    const truncatedMethodPattern = /[?.]\s*(\w+)\s*$/;
    const truncatedMatch = expressionText.match(truncatedMethodPattern);

    if (truncatedMatch) {
      // Add parentheses to the last identifier to make it look like a method call
      expressionText = expressionText + '()';
      logger.debug('C# fixed truncated method call by adding parentheses', {
        original: expressionText.substring(0, 100),
        methodName: truncatedMatch[1]
      });
    } else if (openParens > closeParens) {
      // Add missing closing parentheses
      expressionText = expressionText + ')'.repeat(openParens - closeParens);
      logger.debug('C# fixed truncated expression by adding closing parentheses', {
        original: expressionText.substring(0, 100),
        addedParens: openParens - closeParens
      });
    }

    // Pattern to match ALL method calls, including chained ones: obj?.Method1()?.Method2()
    // This captures any identifier followed by parentheses
    const methodCallPattern = /(\w+)\s*\(/g;
    let match;
    const foundMethods: string[] = [];

    logger.debug('C# extractChainedCallsFromText analyzing', {
      expression: expressionText,
      callerName: callerName
    });

    while ((match = methodCallPattern.exec(expressionText)) !== null) {
      const methodName = match[1];

      // Skip if this is likely the initial object name (comes before any ?. or .)
      const beforeMatch = expressionText.substring(0, match.index);
      const isInitialObject = !beforeMatch.includes('?.') && !beforeMatch.includes('.') && !beforeMatch.includes('(');

      // Skip constructor calls (new ClassName())
      const isConstructor = beforeMatch.trim().endsWith('new');

      logger.debug('C# regex match evaluation', {
        methodName: methodName,
        beforeMatch: beforeMatch.substring(Math.max(0, beforeMatch.length - 20)),
        isInitialObject: isInitialObject,
        isConstructor: isConstructor,
        willInclude: !isInitialObject && !isConstructor && !foundMethods.includes(methodName)
      });

      if (!isInitialObject && !isConstructor && !foundMethods.includes(methodName)) {
        foundMethods.push(methodName);
        const dependency: ParsedDependency = {
          from_symbol: callerName,
          to_symbol: methodName,
          dependency_type: DependencyType.CALLS,
          line_number: lineNumber,
          confidence: 0.75 // Lower confidence for regex-based extraction
        };

        dependencies.push(dependency);

        logger.debug('C# chained conditional access call extracted via regex', {
          from: dependency.from_symbol,
          to: dependency.to_symbol,
          pattern: match[0]
        });
      }
    }

    // If no method calls found, try property access pattern: obj?.Property
    if (dependencies.length === 0) {
      const propertyPattern = /\?\s*\.?\s*(\w+)(?!\s*\()/g;
      while ((match = propertyPattern.exec(expressionText)) !== null) {
        const propertyName = match[1];
        const dependency: ParsedDependency = {
          from_symbol: callerName,
          to_symbol: propertyName,
          dependency_type: DependencyType.REFERENCES,
          line_number: lineNumber,
          confidence: 0.70 // Lower confidence for property access via regex
        };

        dependencies.push(dependency);

        logger.debug('C# conditional access property extracted via regex', {
          from: dependency.from_symbol,
          to: dependency.to_symbol,
          pattern: match[0]
        });
      }
    }

    return dependencies;
  }

  private extractInheritanceDependencies(node: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Find the parent class/interface declaration to get the correct 'from_symbol'
    const parentDeclaration = this.findParentDeclaration(node);
    if (!parentDeclaration) {
      return dependencies;
    }

    const parentNameNode = parentDeclaration.childForFieldName('name');
    if (!parentNameNode) {
      return dependencies;
    }

    const fromSymbol = this.getNodeText(parentNameNode, content);
    const isInterface = parentDeclaration.type === 'interface_declaration';

    // Extract base classes and interfaces from the base_list
    const baseNames: string[] = [];
    for (const child of node.children) {
      if (child.type === 'identifier' || child.type === 'qualified_name') {
        const baseName = this.getNodeText(child, content);
        if (baseName && baseName.trim()) {
          baseNames.push(baseName.trim());
        }
      }
    }

    // Process inheritance relationships
    for (let i = 0; i < baseNames.length; i++) {
      const baseName = baseNames[i];
      let dependencyType: DependencyType;

      if (isInterface) {
        // Interfaces can only extend other interfaces
        dependencyType = DependencyType.INHERITS;
      } else {
        // For classes: first item is typically base class, rest are interfaces
        // However, if the first item starts with 'I' and is PascalCase, it's likely an interface
        if (i === 0 && !this.isLikelyInterface(baseName)) {
          dependencyType = DependencyType.INHERITS;
        } else {
          dependencyType = DependencyType.IMPLEMENTS;
        }
      }

      dependencies.push({
        from_symbol: fromSymbol,
        to_symbol: baseName,
        dependency_type: dependencyType,
        line_number: node.startPosition.row + 1,
        confidence: 0.9
      });
    }

    return dependencies;
  }

  /**
   * Find the parent class/interface/struct declaration that contains the given base_list node
   */
  private findParentDeclaration(baseListNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    let parent = baseListNode.parent;

    while (parent) {
      if (parent.type === 'class_declaration' ||
          parent.type === 'interface_declaration' ||
          parent.type === 'struct_declaration') {
        return parent;
      }
      parent = parent.parent;
    }

    return null;
  }

  /**
   * Determine if a name is likely an interface based on C# naming conventions
   * Interfaces typically start with 'I' followed by a capital letter
   */
  private isLikelyInterface(name: string): boolean {
    if (!name || name.length < 2) {
      return false;
    }

    // Check if it starts with 'I' followed by a capital letter (PascalCase interface convention)
    return name.charAt(0) === 'I' &&
           name.charAt(1) >= 'A' &&
           name.charAt(1) <= 'Z';
  }

  private extractConstraintDependencies(node: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract type constraints
    const constraintNodes = this.getNodesOfType(node, 'type_constraint');
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
    // Look for identifier or qualified_name child nodes
    const nameNode = node.children.find(child =>
      child.type === 'identifier' || child.type === 'qualified_name'
    );
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
    const nodes = this.getNodesOfType(rootNode, type);
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
    const hasNamespaceOrClass = this.getNodesOfType(rootNode, 'namespace_declaration').length > 0 ||
                                this.getNodesOfType(rootNode, 'class_declaration').length > 0 ||
                                this.getNodesOfType(rootNode, 'interface_declaration').length > 0 ||
                                this.getNodesOfType(rootNode, 'struct_declaration').length > 0;

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
    const usingNodes = this.getNodesOfType(rootNode, 'using_directive');
    if (usingNodes.length === 0 && filePath.includes('.cs')) {
      // Check if this file might legitimately not need using directives
      const hasNamespace = this.getNodesOfType(rootNode, 'namespace_declaration').length > 0;
      const hasClasses = this.getNodesOfType(rootNode, 'class_declaration').length > 0;
      const hasInterfaces = this.getNodesOfType(rootNode, 'interface_declaration').length > 0;
      const hasEnums = this.getNodesOfType(rootNode, 'enum_declaration').length > 0;
      const hasStructs = this.getNodesOfType(rootNode, 'struct_declaration').length > 0;

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
   * Validate method call detection by comparing AST results with text-based analysis
   * This helps identify potential gaps in Tree-sitter parsing
   */
  private validateMethodCallDetection(content: string, dependencies: ParsedDependency[], filePath: string): ParseError[] {
    const validationErrors: ParseError[] = [];

    // Use regex to find potential method calls that might have been missed
    const methodCallRegex = /(\w+)\s*\?\?\s*\.(\w+)\s*\(|(\w+)\s*\?\s*\.(\w+)\s*\(|(\w+)\.(\w+)\s*\(/g;
    const textBasedCalls = new Set<string>();
    let match;

    while ((match = methodCallRegex.exec(content)) !== null) {
      const methodName = match[2] || match[4] || match[6]; // Extract method name from different patterns
      if (methodName) {
        textBasedCalls.add(methodName.toLowerCase());
      }
    }

    // Check what we detected through AST
    const astDetectedCalls = new Set<string>();
    for (const dep of dependencies) {
      if (dep.dependency_type === 'calls') {
        astDetectedCalls.add(dep.to_symbol.toLowerCase());
      }
    }

    // Find potentially missed method calls
    for (const textCall of textBasedCalls) {
      if (!astDetectedCalls.has(textCall)) {
        logger.warn('C# method call potentially missed by AST parsing', {
          methodName: textCall,
          filePath,
          textBasedCalls: textBasedCalls.size,
          astDetectedCalls: astDetectedCalls.size
        });

        validationErrors.push({
          message: `Potential method call '${textCall}' detected in text but not in AST - verify parsing completeness`,
          line: 1,
          column: 1,
          severity: 'warning'
        });
      }
    }

    // Log validation summary
    logger.debug('C# method call validation completed', {
      filePath,
      textBasedCallsFound: textBasedCalls.size,
      astDetectedCalls: astDetectedCalls.size,
      potentiallyMissedCalls: Array.from(textBasedCalls).filter(call => !astDetectedCalls.has(call)),
      validationErrors: validationErrors.length
    });

    return validationErrors;
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
   * Two-phase approach: 1) Collect full context, 2) Find method and build qualified name
   */
  private findContainingFunction(callNode: Parser.SyntaxNode, content: string): string {
    logger.debug('C# findContainingFunction starting', {
      startNodeType: callNode.type,
      startNodeText: this.getNodeText(callNode, content).substring(0, 50)
    });

    // Phase 1: Collect complete context by traversing up the AST
    const context = this.collectASTContext(callNode, content);

    logger.debug('C# findContainingFunction collected context', {
      className: context.className,
      namespaceName: context.namespaceName,
      interfaceName: context.interfaceName,
      structName: context.structName
    });

    // Phase 2: Find the specific method/constructor/property with complete context
    let parent = callNode.parent;
    while (parent) {
      logger.debug('C# findContainingFunction searching for method', {
        nodeType: parent.type
      });

      // Method declarations
      if (parent.type === 'method_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const methodName = this.getNodeText(nameNode, content);
          const containerName = context.className || context.interfaceName || context.structName;
          const qualifiedName = this.buildQualifiedName(context.namespaceName, containerName, methodName);

          logger.debug('C# findContainingFunction found method with full context', {
            methodName,
            containerName,
            namespaceName: context.namespaceName,
            qualifiedName
          });

          return qualifiedName;
        }
      }

      // Constructor declarations
      if (parent.type === 'constructor_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const constructorName = this.getNodeText(nameNode, content);
          const containerName = context.className || context.structName;
          return this.buildQualifiedName(context.namespaceName, containerName, `.ctor(${constructorName})`);
        }
      }

      // Property declarations (including auto-properties)
      if (parent.type === 'property_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const propertyName = this.getNodeText(nameNode, content);

          // Check if we're inside an accessor (get/set)
          let accessorType = '';
          let accessorParent = callNode.parent;
          while (accessorParent && accessorParent !== parent) {
            if (accessorParent.type === 'accessor_declaration') {
              const keyword = accessorParent.children.find(child =>
                child.type === 'get' || child.type === 'set' || child.type === 'init'
              );
              if (keyword) {
                accessorType = `.${keyword.type}`;
              }
              break;
            }
            accessorParent = accessorParent.parent;
          }

          const containerName = context.className || context.interfaceName || context.structName;
          return this.buildQualifiedName(context.namespaceName, containerName, `${propertyName}${accessorType}`);
        }
      }

      // Event declarations
      if (parent.type === 'event_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const eventName = this.getNodeText(nameNode, content);
          const containerName = context.className || context.interfaceName || context.structName;
          return this.buildQualifiedName(context.namespaceName, containerName, `${eventName}.event`);
        }
      }

      // Indexer declarations
      if (parent.type === 'indexer_declaration') {
        const containerName = context.className || context.interfaceName || context.structName;
        return this.buildQualifiedName(context.namespaceName, containerName, 'this[]');
      }

      // Operator declarations
      if (parent.type === 'operator_declaration') {
        const operatorKeyword = parent.children.find(child => child.type === 'operator_token');
        const operatorName = operatorKeyword ? this.getNodeText(operatorKeyword, content) : 'operator';
        const containerName = context.className || context.interfaceName || context.structName;
        return this.buildQualifiedName(context.namespaceName, containerName, `operator_${operatorName}`);
      }

      // Local function declarations (C# 7.0+)
      if (parent.type === 'local_function_statement') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const localFunctionName = this.getNodeText(nameNode, content);
          // Continue traversing to find the containing method
          const containingMethod = this.findContainingFunction(parent, content);
          return `${containingMethod}.${localFunctionName}`;
        }
      }

      // Lambda expressions and anonymous methods
      if (parent.type === 'lambda_expression' || parent.type === 'anonymous_method_expression') {
        // Continue traversing to find the containing method
        const containingMethod = this.findContainingFunction(parent, content);
        return `${containingMethod}.<lambda>`;
      }

      parent = parent.parent;
    }

    // Return best available context if no specific method found
    const containerName = context.className || context.interfaceName || context.structName;
    if (containerName) {
      return this.buildQualifiedName(context.namespaceName, containerName, '<unknown>');
    }

    return context.namespaceName ? `${context.namespaceName}.<global>` : '<global>';
  }

  /**
   * Phase 1: Collect complete AST context by traversing up to the root
   */
  private collectASTContext(startNode: Parser.SyntaxNode, content: string): {
    className: string;
    namespaceName: string;
    interfaceName: string;
    structName: string;
  } {
    let parent = startNode.parent;
    let className = '';
    let namespaceName = '';
    let interfaceName = '';
    let structName = '';

    // Traverse up the entire AST to collect all context
    while (parent) {
      // Keep track of class context
      if (parent.type === 'class_declaration' && !className) {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          className = this.getNodeText(nameNode, content);
          logger.debug('C# collectASTContext found class', {
            className
          });
        }
      }

      // Keep track of interface context
      if (parent.type === 'interface_declaration' && !interfaceName) {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          interfaceName = this.getNodeText(nameNode, content);
        }
      }

      // Keep track of struct context
      if (parent.type === 'struct_declaration' && !structName) {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          structName = this.getNodeText(nameNode, content);
        }
      }

      // Check for namespace context
      if (parent.type === 'namespace_declaration' && !namespaceName) {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          namespaceName = this.getNodeText(nameNode, content);
        }
      }

      // File-scoped namespace (C# 10+)
      if (parent.type === 'file_scoped_namespace_declaration' && !namespaceName) {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          namespaceName = this.getNodeText(nameNode, content);
        }
      }

      parent = parent.parent;
    }

    return {
      className,
      namespaceName,
      interfaceName,
      structName
    };
  }

  /**
   * Build a qualified name from namespace, class, and member components
   */
  private buildQualifiedName(namespaceName: string, className: string, memberName: string): string {
    const parts: string[] = [];

    if (namespaceName) {
      parts.push(namespaceName);
    }

    if (className) {
      parts.push(className);
    }

    if (memberName) {
      parts.push(memberName);
    }

    return parts.join('.');
  }

  /**
   * Deduplicate dependencies based on from_symbol, to_symbol, dependency_type, and line_number.
   * When duplicates are found, prefer the one with higher confidence.
   */
  private deduplicateDependencies(dependencies: ParsedDependency[]): ParsedDependency[] {
    const uniqueMap = new Map<string, ParsedDependency>();

    for (const dependency of dependencies) {
      // Create a unique key for the dependency
      const key = `${dependency.from_symbol}|${dependency.to_symbol}|${dependency.dependency_type}|${dependency.line_number}`;

      const existing = uniqueMap.get(key);
      if (!existing) {
        // First occurrence, add it
        uniqueMap.set(key, dependency);
      } else {
        // Duplicate found, keep the one with higher confidence
        if (dependency.confidence > existing.confidence) {
          uniqueMap.set(key, dependency);

          logger.debug('C# dependency deduplication: replaced with higher confidence', {
            key,
            oldConfidence: existing.confidence,
            newConfidence: dependency.confidence,
            from: dependency.from_symbol,
            to: dependency.to_symbol
          });
        } else {
          logger.debug('C# dependency deduplication: ignored lower confidence duplicate', {
            key,
            existingConfidence: existing.confidence,
            duplicateConfidence: dependency.confidence,
            from: dependency.from_symbol,
            to: dependency.to_symbol
          });
        }
      }
    }

    return Array.from(uniqueMap.values());
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

    // Look for modifier nodes and extract their types
    for (const child of node.children) {
      if (child.type === 'modifier') {
        // Look at the first child of the modifier node for the actual modifier type
        if (child.childCount > 0) {
          const modifierType = child.child(0)?.type;
          if (modifierType && csharpModifierTypes.has(modifierType)) {
            modifiers.push(modifierType);
          }
        }
      } else if (csharpModifierTypes.has(child.type)) {
        // Direct modifier nodes (fallback)
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

    // Extract generic type parameters
    const typeParametersNode = node.children.find(child => child.type === 'type_parameter_list');
    let typeParameters = '';
    if (typeParametersNode) {
      typeParameters = this.getNodeText(typeParametersNode, content);
    }

    // Build signature with proper spacing and generic parameters
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    return `${modifierString}class ${name}${typeParameters}`;
  }

  private extractInterfaceSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    // Extract generic type parameters
    const typeParametersNode = node.children.find(child => child.type === 'type_parameter_list');
    let typeParameters = '';
    if (typeParametersNode) {
      typeParameters = this.getNodeText(typeParametersNode, content);
    }

    // Build signature with proper spacing and generic parameters
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    return `${modifierString}interface ${name}${typeParameters}`;
  }

  private extractMethodSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return '';

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node, content);

    // Extract return type - look for any type child node
    let returnType = 'void';
    const typeNode = node.children.find(child =>
      child.type === 'predefined_type' ||
      child.type === 'identifier' ||
      child.type === 'qualified_name' ||
      child.type === 'generic_name' ||
      child.type === 'array_type' ||
      child.type === 'nullable_type'
    );
    if (typeNode) {
      returnType = this.getNodeText(typeNode, content);
    }

    // Extract parameters
    const parametersNode = node.children.find(child => child.type === 'parameter_list');
    let parameters = '()';
    if (parametersNode) {
      parameters = this.getNodeText(parametersNode, content);
    }

    // Extract generic type parameters
    const typeParametersNode = node.children.find(child => child.type === 'type_parameter_list');
    let typeParameters = '';
    if (typeParametersNode) {
      typeParameters = this.getNodeText(typeParametersNode, content);
    }

    // Build signature with proper spacing, including async keyword if present
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    return `${modifierString}${returnType} ${name}${typeParameters}${parameters}`;
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
      const fileScopedNamespace = this.getNodesOfType(tree.rootNode, 'file_scoped_namespace_declaration');

      // Process each type of declaration
      for (const type of topLevelTypes) {
        const nodes = this.getNodesOfType(tree.rootNode, type);

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
      const usingNodes = this.getNodesOfType(tree.rootNode, 'using_directive');
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

  /**
   * Build method signature with parameters for enhanced context (Phase 3.1)
   */
  private buildMethodSignature(methodName: string, node: Parser.SyntaxNode, content: string): string | undefined {
    try {
      // Try to find the method definition by traversing the AST
      const methodDefinition = this.findMethodDefinition(methodName, node, content);
      if (methodDefinition) {
        return this.extractMethodSignatureFromDefinition(methodDefinition, content);
      }

      // Fallback: build signature from call site if possible
      const argumentsList = this.extractMethodParameters(node, content);
      if (argumentsList.length > 0) {
        return `${methodName}(${argumentsList.join(', ')})`;
      }

      // Basic fallback
      return `${methodName}()`;
    } catch (error) {
      logger.debug('Failed to build method signature', {
        methodName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return undefined;
    }
  }

  /**
   * Extract current namespace context for enhanced analysis (Phase 3.1)
   */
  private getCurrentNamespace(node: Parser.SyntaxNode, content: string): string | undefined {
    try {
      let current = node;

      // Traverse up the AST to find namespace declaration
      while (current.parent !== null) {
        current = current.parent;

        if (current.type === 'namespace_declaration') {
          const nameNode = current.childForFieldName('name');
          if (nameNode) {
            return this.getNodeText(nameNode, content);
          }
        }
      }

      // Check for file-scoped namespace (C# 10 feature)
      const rootNode = this.findASTRoot(node);
      for (let i = 0; i < rootNode.childCount; i++) {
        const child = rootNode.child(i);
        if (child?.type === 'file_scoped_namespace_declaration') {
          const nameNode = child.childForFieldName('name');
          if (nameNode) {
            return this.getNodeText(nameNode, content);
          }
        }
      }

      return undefined;
    } catch (error) {
      logger.debug('Failed to extract namespace context', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return undefined;
    }
  }

  /**
   * Find method definition in the AST for signature extraction
   */
  private findMethodDefinition(methodName: string, searchNode: Parser.SyntaxNode, content: string): Parser.SyntaxNode | null {
    const rootNode = this.findASTRoot(searchNode);
    return this.findMethodDefinitionRecursive(methodName, rootNode, content);
  }

  /**
   * Recursively search for method definition
   */
  private findMethodDefinitionRecursive(methodName: string, node: Parser.SyntaxNode, content: string): Parser.SyntaxNode | null {
    // Check if current node is a method declaration
    if (node.type === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && this.getNodeText(nameNode, content) === methodName) {
        return node;
      }
    }

    // Search children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        const result = this.findMethodDefinitionRecursive(methodName, child, content);
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Extract method signature from method definition node
   */
  private extractMethodSignatureFromDefinition(methodNode: Parser.SyntaxNode, content: string): string {
    try {
      const modifiers = this.extractModifiers(methodNode, content);
      const returnType = this.extractMethodReturnType(methodNode, content);
      const nameNode = methodNode.childForFieldName('name');
      const methodName = nameNode ? this.getNodeText(nameNode, content) : 'Unknown';
      const parameters = this.extractMethodDefinitionParameters(methodNode, content);

      const modifierString = modifiers.length > 0 ? modifiers.join(' ') + ' ' : '';
      const returnTypeString = returnType ? returnType + ' ' : 'void ';

      return `${modifierString}${returnTypeString}${methodName}(${parameters.join(', ')})`;
    } catch (error) {
      logger.debug('Failed to extract method signature from definition', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 'Unknown';
    }
  }

  /**
   * Enhanced helper methods for Phase 3 functionality
   */

  /**
   * Extract method signature parameters for enhanced context
   */
  private extractMethodParameters(node: Parser.SyntaxNode, content: string): string[] {
    const parameters: string[] = [];

    // Find argument list in invocation
    const argumentList = this.findNodeOfType(node, 'argument_list');
    if (argumentList) {
      for (let i = 0; i < argumentList.childCount; i++) {
        const child = argumentList.child(i);
        if (child?.type === 'argument') {
          const argText = this.getNodeText(child, content).trim();
          if (argText) parameters.push(argText);
        }
      }
    }

    return parameters;
  }

  /**
   * Extract parameters from method definition for signature building
   */
  private extractMethodDefinitionParameters(methodNode: Parser.SyntaxNode, content: string): string[] {
    const parameters: string[] = [];

    const parameterList = methodNode.childForFieldName('parameters');
    if (parameterList) {
      for (let i = 0; i < parameterList.childCount; i++) {
        const child = parameterList.child(i);
        if (child?.type === 'parameter') {
          const paramText = this.getNodeText(child, content).trim();
          if (paramText) parameters.push(paramText);
        }
      }
    }

    return parameters;
  }

  /**
   * Extract return type from method definition for signature building
   */
  private extractMethodReturnType(methodNode: Parser.SyntaxNode, content: string): string | null {
    const typeNode = methodNode.childForFieldName('type');
    return typeNode ? this.getNodeText(typeNode, content) : null;
  }

  /**
   * Find root node by traversing up the AST
   */
  private findASTRoot(node: Parser.SyntaxNode): Parser.SyntaxNode {
    let current = node;
    while (current.parent !== null) {
      current = current.parent;
    }
    return current;
  }

  /**
   * Find first child of specific type
   */
  private findNodeOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === type) {
        return child;
      }
    }
    return null;
  }

}