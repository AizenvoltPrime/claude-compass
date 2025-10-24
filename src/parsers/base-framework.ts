import Parser from 'tree-sitter';
import { ChunkedParser } from './chunked-parser';
import {
  ParseResult,
  FrameworkEntity,
  FrameworkParseResult,
  ParseOptions,
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseError,
} from './base';
import { SymbolType, DependencyType, Visibility } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';

const logger = createComponentLogger('base-framework-parser');

/**
 * Extended parse options for framework-specific parsing
 */
export interface FrameworkParseOptions extends ParseOptions {
  frameworkContext?: {
    framework: string;
    version?: string;
    projectRoot?: string;
    configPath?: string;
  };
  repositoryFrameworks?: string[]; // Detected frameworks for the entire repository
  detectFrameworkEntities?: boolean;
  skipFrameworkAnalysis?: boolean;
  // Eloquent relationship registry shared across repository for semantic analysis
  // ModelClass → { methodName → TargetModelClass }
  eloquentRelationshipRegistry?: Map<string, Map<string, string>>;
}

/**
 * Framework-specific file analysis result
 */
export interface ParseFileResult extends ParseResult {
  filePath: string; // Phase 5 addition for cross-stack tracking
  frameworkEntities?: FrameworkEntity[];
  metadata?: {
    framework?: string;
    fileType?: string;
    isFrameworkSpecific?: boolean;
  };
}

/**
 * Framework pattern definition for detection
 */
export interface FrameworkPattern {
  name: string;
  pattern: RegExp;
  fileExtensions: string[];
  description: string;
}

/**
 * Abstract base class for framework-specific parsers
 * Extends ChunkedParser to inherit robust file processing capabilities
 */
export abstract class BaseFrameworkParser extends ChunkedParser {
  protected frameworkType: string;
  protected patterns: FrameworkPattern[] = [];

  constructor(parser: Parser, frameworkType: string) {
    super(parser, `${frameworkType}-framework`);
    this.frameworkType = frameworkType;
    this.patterns = this.getFrameworkPatterns();
  }

  /**
   * Parse a file with framework-aware context
   */
  async parseFile(
    filePath: string,
    content: string,
    options: FrameworkParseOptions = {}
  ): Promise<ParseFileResult> {
    try {
      // Check if file needs chunked parsing due to size constraints
      let baseResult: ParseResult;
      if (this.shouldUseChunking(content, options)) {
        baseResult = await this.parseFileInChunks(filePath, content, options);
      } else {
        // Get base parsing result using direct parsing
        baseResult = await this.parseFileDirectly(filePath, content, options);
      }

      // Skip framework analysis if requested or not applicable
      if (options.skipFrameworkAnalysis || !this.isFrameworkApplicable(filePath, content)) {
        return {
          filePath,
          ...baseResult,
          frameworkEntities: [],
          metadata: {
            framework: this.frameworkType,
            isFrameworkSpecific: false,
          },
        };
      }

      // Detect framework-specific entities
      const frameworkResult = await this.detectFrameworkEntities(content, filePath, options);

      return this.mergeResults(baseResult, frameworkResult, filePath);
    } catch (error) {
      logger.error(`Framework parsing failed for ${filePath}`, {
        error,
        framework: this.frameworkType,
      });

      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [
          {
            message: `Framework parsing error: ${error.message}`,
            line: 0,
            column: 0,
            severity: 'error',
          },
        ],
        frameworkEntities: [],
        metadata: {
          framework: this.frameworkType,
          isFrameworkSpecific: false,
        },
      };
    }
  }

  /**
   * Abstract method to detect framework-specific entities
   * Must be implemented by concrete framework parsers
   */
  abstract detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkParseResult>;

  /**
   * Abstract method to get framework-specific patterns
   * Must be implemented by concrete framework parsers
   */
  abstract getFrameworkPatterns(): FrameworkPattern[];

  /**
   * Determine if framework parsing is applicable for this file
   */
  protected isFrameworkApplicable(filePath: string, content: string): boolean {
    const ext = path.extname(filePath);
    const fileName = path.basename(filePath);

    // Check file extension patterns
    const hasApplicableExtension = this.patterns.some(pattern =>
      pattern.fileExtensions.includes(ext)
    );

    if (!hasApplicableExtension) {
      return false;
    }

    // Check content patterns
    const hasApplicableContent = this.patterns.some(pattern => {
      try {
        const matches = pattern.pattern.test(content);
        return matches;
      } catch (error) {
        logger.warn(`Pattern test failed for ${pattern.name}`, { error });
        return false;
      }
    });

    return hasApplicableContent;
  }

  /**
   * Merge base parsing results with framework-specific results
   */
  protected mergeResults(
    baseResult: ParseResult,
    frameworkResult: FrameworkParseResult,
    filePath: string
  ): ParseFileResult {
    return {
      filePath,
      symbols: baseResult.symbols,
      dependencies: baseResult.dependencies,
      imports: baseResult.imports,
      exports: baseResult.exports,
      errors: baseResult.errors,
      frameworkEntities: frameworkResult.entities || [],
      metadata: {
        framework: this.frameworkType,
        isFrameworkSpecific: (frameworkResult.entities?.length || 0) > 0,
        fileType: this.detectFileType(filePath),
      },
    };
  }

  /**
   * Detect the type of file being parsed
   */
  protected detectFileType(filePath: string): string {
    const ext = path.extname(filePath);
    const fileName = path.basename(filePath);

    // Framework-specific file type detection
    if (ext === '.vue') return 'vue-sfc';
    if (fileName.includes('.component.')) return 'component';
    if (fileName.includes('.composable.') || fileName.startsWith('use')) return 'composable';
    if (fileName.includes('.hook.')) return 'hook';
    if (filePath.includes('/pages/') || filePath.includes('/app/')) return 'page';
    if (filePath.includes('/api/')) return 'api-route';
    if (fileName.includes('.config.') || fileName.includes('.setup.')) return 'config';

    return ext.substring(1) || 'unknown';
  }

  /**
   * Extract component name from file path
   */
  protected extractComponentName(filePath: string): string {
    const fileName = path.basename(filePath, path.extname(filePath));

    // Convert kebab-case to PascalCase for component names
    return fileName
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  /**
   * Check if content contains specific framework patterns
   */
  protected containsPattern(content: string, pattern: string | RegExp): boolean {
    try {
      if (typeof pattern === 'string') {
        return content.includes(pattern);
      }
      return pattern.test(content);
    } catch (error) {
      logger.warn('Pattern test failed', { error, pattern: pattern.toString() });
      return false;
    }
  }

  /**
   * Extract string literal from AST node
   */
  protected extractStringLiteral(node: any): string | null {
    if (!node) return null;

    if (node.type === 'string' || node.type === 'string_literal') {
      const text = node.text || '';
      // Remove quotes
      return text.replace(/^['"`]|['"`]$/g, '');
    }

    if (node.type === 'template_string') {
      return node.text || '';
    }

    return null;
  }

  /**
   * Find all function calls in the AST
   */
  protected findFunctionCalls(tree: any, functionNames: string[]): any[] {
    const calls: any[] = [];

    if (!tree || !tree.rootNode) {
      return calls;
    }

    const traverse = (node: any) => {
      if (node.type === 'call_expression') {
        const functionNode = node.children?.[0];
        if (functionNode && functionNames.includes(functionNode.text)) {
          calls.push(node);
        }
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return calls;
  }

  /**
   * Find all imports in the AST
   */
  protected findImports(tree: any): any[] {
    const imports: any[] = [];

    if (!tree || !tree.rootNode) {
      return imports;
    }

    const traverse = (node: any) => {
      if (node.type === 'import_statement' || node.type === 'import_declaration') {
        imports.push(node);
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return imports;
  }

  /**
   * Find exports in the AST
   */
  protected findExports(tree: any): any[] {
    const exports: any[] = [];

    if (!tree || !tree.rootNode) {
      return exports;
    }

    const traverse = (node: any) => {
      if (
        node.type === 'export_statement' ||
        node.type === 'export_declaration' ||
        node.type === 'export_default_declaration'
      ) {
        exports.push(node);
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return exports;
  }

  /**
   * Implementation of parseFileDirectly required by ChunkedParser
   * Provides base JavaScript/TypeScript parsing for framework parsers
   */
  protected async parseFileDirectly(
    filePath: string,
    content: string,
    options?: FrameworkParseOptions
  ): Promise<ParseResult> {
    const validatedOptions = this.validateOptions(options);

    // Configure parser language based on file extension if the subclass supports it
    if (typeof (this as any).configureParserLanguage === 'function') {
      (this as any).configureParserLanguage(filePath);
    }

    // Defensive size check - parseFileDirectly should only be called for appropriately sized content
    if (content.length > 28000 && !validatedOptions.bypassSizeLimit) {
      logger.warn('parseFileDirectly called with large content without bypass flag', {
        filePath,
        contentSize: content.length,
      });
      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [
          {
            message: `Content too large (${content.length} bytes) for direct parsing`,
            line: 1,
            column: 1,
            severity: 'error',
          },
        ],
        frameworkEntities: [],
      };
    }

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

    // Use JavaScript-style parsing for all framework parsers
    const symbols = this.extractSymbols(tree.rootNode, content);
    const dependencies = this.extractDependencies(tree.rootNode, content);
    const imports = this.extractImports(tree.rootNode, content);
    const exports = this.extractExports(tree.rootNode, content);

    // Collect syntax errors from the AST
    const errors = this.collectSyntaxErrors(tree.rootNode);

    return {
      symbols: validatedOptions.includePrivateSymbols
        ? symbols
        : symbols.filter(s => s.visibility !== 'private'),
      dependencies,
      imports,
      exports,
      errors,
    };
  }

  /**
   * Collect syntax errors from the AST
   */
  protected collectSyntaxErrors(rootNode: Parser.SyntaxNode): ParseError[] {
    const errors: ParseError[] = [];

    function traverse(node: Parser.SyntaxNode): void {
      if (node.type === 'ERROR' || node.type === 'MISSING') {
        errors.push({
          message: `Parsing error in ${node.type}: ${node.text.slice(0, 50)}${node.text.length > 50 ? '...' : ''}`,
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          severity: 'error',
        });
      }

      if (node.hasError && node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    }

    traverse(rootNode);
    return errors;
  }

  /**
   * Extract symbols (functions, classes, variables) from AST
   * Child classes can override this method for custom symbol extraction
   */
  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract function declarations
    const functionNodes = this.findNodesOfType(rootNode, 'function_declaration');
    for (const node of functionNodes) {
      const symbol = this.extractFunctionSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract class declarations
    const classNodes = this.findNodesOfType(rootNode, 'class_declaration');
    for (const node of classNodes) {
      const symbol = this.extractClassSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract variable declarations
    const variableNodes = this.findNodesOfType(rootNode, 'variable_declarator');
    for (const node of variableNodes) {
      const symbol = this.extractVariableSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    return symbols;
  }

  /**
   * Extract dependencies from AST
   * Child classes can override this method for custom dependency extraction
   */
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

  /**
   * Extract imports from AST
   * Child classes can override this method for custom import extraction
   */
  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Extract ES6 imports
    const importNodes = this.findNodesOfType(rootNode, 'import_statement');
    for (const node of importNodes) {
      const importObj = this.extractImportStatement(node, content);
      if (importObj) imports.push(importObj);
    }

    return imports;
  }

  /**
   * Extract exports from AST
   * Child classes can override this method for custom export extraction
   */
  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];

    // Extract ES6 exports
    const exportNodes = this.findNodesOfType(rootNode, 'export_statement');
    for (const node of exportNodes) {
      const exportObj = this.extractExportStatement(node, content);
      if (exportObj) exports.push(exportObj);
    }

    return exports;
  }

  /**
   * Helper method to find nodes of a specific type
   */
  protected findNodesOfType(rootNode: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    const nodes: Parser.SyntaxNode[] = [];

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === type) {
        nodes.push(node);
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(rootNode);
    return nodes;
  }

  /**
   * Extract function symbol from AST node
   */
  protected extractFunctionSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    try {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return null;

      const name = content.slice(nameNode.startIndex, nameNode.endIndex);

      return {
        name,
        symbol_type: 'function' as SymbolType,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        is_exported: this.isExported(node),
        visibility: Visibility.PUBLIC,
        signature: content.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 100)),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract class symbol from AST node
   */
  protected extractClassSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    try {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return null;

      const name = content.slice(nameNode.startIndex, nameNode.endIndex);

      return {
        name,
        symbol_type: 'class' as SymbolType,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        is_exported: this.isExported(node),
        visibility: Visibility.PUBLIC,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract variable symbol from AST node
   */
  protected extractVariableSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    try {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return null;

      const name = content.slice(nameNode.startIndex, nameNode.endIndex);

      return {
        name,
        symbol_type: 'variable' as SymbolType,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        is_exported: this.isExported(node),
        visibility: Visibility.PUBLIC,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract call dependency from AST node
   */
  protected extractCallDependency(
    node: Parser.SyntaxNode,
    content: string
  ): ParsedDependency | null {
    try {
      const functionNode = node.childForFieldName('function');
      if (!functionNode) return null;

      const functionName = content.slice(functionNode.startIndex, functionNode.endIndex);

      return {
        from_symbol: 'caller',
        to_symbol: functionName,
        dependency_type: 'calls' as DependencyType,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract import statement from AST node
   */
  protected extractImportStatement(node: Parser.SyntaxNode, content: string): ParsedImport | null {
    try {
      const sourceNode = node.childForFieldName('source');
      if (!sourceNode) return null;

      const source = content.slice(sourceNode.startIndex + 1, sourceNode.endIndex - 1); // Remove quotes

      return {
        source,
        imported_names: ['*'],
        import_type: 'named',
        line_number: node.startPosition.row + 1,
        is_dynamic: false,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract export statement from AST node
   */
  protected extractExportStatement(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    try {
      return {
        exported_names: ['*'],
        export_type: 'named',
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a node represents an exported symbol
   */
  protected isExported(node: Parser.SyntaxNode): boolean {
    let current = node.parent;
    while (current) {
      if (current.type === 'export_statement' || current.type === 'export_declaration') {
        return true;
      }
      current = current.parent;
    }
    return false;
  }
}
