import Parser from 'tree-sitter';
import {
  SymbolType,
  DependencyType,
  CreateSymbol,
  CreateDependency,
  Visibility,
} from '../database/models';
import { createComponentLogger } from '../utils/logger';
import { EncodingConverter } from '../utils/encoding-converter';
import * as fs from 'fs/promises';

const logger = createComponentLogger('parser-base');

// Parser result interfaces
export interface ParsedSymbol {
  name: string;
  symbol_type: SymbolType;
  start_line: number;
  end_line: number;
  is_exported: boolean;
  visibility?: Visibility;
  signature?: string;
  file_id?: number;
}

export interface ParsedDependency {
  from_symbol: string;
  to_symbol: string;
  dependency_type: DependencyType;
  line_number: number;
  confidence: number;
  // Optional fields for database compatibility
  from_symbol_id?: number;
  to_symbol_id?: number;
  calling_object?: string;
  resolved_class?: string;
  qualified_context?: string;
  method_signature?: string;
  file_context?: string;
  namespace_context?: string;
}

export interface ParsedImport {
  source: string;
  imported_names: string[];
  import_type: 'named' | 'default' | 'namespace' | 'side_effect';
  line_number: number;
  is_dynamic: boolean;
}

export interface ParsedExport {
  exported_names: string[];
  export_type: 'named' | 'default' | 're_export';
  source?: string;
  line_number: number;
}

// Framework entity types for Phase 5 cross-stack tracking
export enum FrameworkEntityType {
  VUE_COMPONENT = 'vue_component',
  REACT_COMPONENT = 'react_component',
  LARAVEL_ROUTE = 'laravel_route',
  LARAVEL_MODEL = 'laravel_model',
  EXPRESS_ROUTE = 'express_route',
  NEXTJS_ROUTE = 'nextjs_route',
  VUE_COMPOSABLE = 'vue_composable',
  REACT_HOOK = 'react_hook',
  PINIA_STORE = 'pinia_store',
}

// Framework-specific entity interfaces
export interface FrameworkEntity {
  type: string;
  name: string;
  filePath: string;
  metadata?: Record<string, any>;
  properties?: Record<string, any>; // Phase 5 addition for cross-stack properties
}

export interface VueComponent extends FrameworkEntity {
  type: 'component';
  props: PropDefinition[];
  emits: string[];
  slots: string[];
  composables: string[];
  template_dependencies: string[];
}

export interface ReactComponent extends FrameworkEntity {
  type: 'component';
  componentType: 'function' | 'class';
  props: PropDefinition[];
  hooks: string[];
  jsxDependencies: string[];
}

export interface VueComposable extends FrameworkEntity {
  type: 'composable';
  returns: string[];
  dependencies: string[];
  reactive_refs: string[];
}

export interface ReactHook extends FrameworkEntity {
  type: 'hook';
  returns: string[];
  dependencies: string[];
}

export interface ReactHOC extends FrameworkEntity {
  type: 'hoc';
  wrapsComponent: boolean;
  returnsComponent: boolean;
}

export interface VueRoute extends FrameworkEntity {
  type: 'route';
  path: string;
  component?: string;
}

export interface PiniaStore extends FrameworkEntity {
  type: 'store';
  state: string[];
  getters: string[];
  actions: string[];
}

export interface NextJSRoute extends FrameworkEntity {
  type:
    | 'nextjs-page-route'
    | 'nextjs-api-route'
    | 'page'
    | 'layout'
    | 'loading'
    | 'error'
    | 'not-found'
    | 'template'
    | 'api-route';
  path: string;
  method?: string;
  component?: string;
  handler?: string;
  dynamicSegments: string[];
  framework: 'nextjs';
}

export interface ExpressRoute extends FrameworkEntity {
  type: 'express-route';
  path: string;
  method: string;
  handler?: string;
  middleware: string[];
  framework: 'express';
}

export interface FastifyRoute extends FrameworkEntity {
  type: 'fastify-route';
  path: string;
  method: string;
  handler?: string;
  middleware: string[];
  framework: 'fastify';
}

export interface PropDefinition {
  name: string;
  type?: string;
  required: boolean;
  default?: any;
  description?: string;
}

// Framework parser result extension
export interface FrameworkParseResult {
  entities: FrameworkEntity[];
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  dependencies: ParsedDependency[];
  imports: ParsedImport[];
  exports: ParsedExport[];
  errors: ParseError[];
  frameworkEntities?: FrameworkEntity[];
  success?: boolean;
}

export interface ParseError {
  message: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
}

export interface ParseOptions {
  includePrivateSymbols?: boolean;
  includeTestFiles?: boolean;
  maxFileSize?: number;
  enableChunking?: boolean;
  enableEncodingRecovery?: boolean;
  chunkSize?: number;
  chunkOverlapLines?: number;
  preserveContext?: boolean;
  bypassSizeLimit?: boolean;
}

/**
 * Abstract base class for all language parsers
 */
export abstract class BaseParser {
  protected parser: Parser;
  protected language: string;
  protected logger: any;
  private syntaxErrorCount = 0;

  constructor(parser: Parser, language: string) {
    this.parser = parser;
    this.language = language;
    this.logger = createComponentLogger(`parser-${language}`);
  }

  /**
   * Parse a file and extract symbols, dependencies, imports, and exports
   */
  abstract parseFile(
    filePath: string,
    content: string,
    options?: ParseOptions
  ): Promise<ParseResult>;

  /**
   * Get file extensions that this parser supports
   */
  abstract getSupportedExtensions(): string[];

  /**
   * Check if this parser can handle the given file
   */
  canParseFile(filePath: string): boolean {
    const extension = this.getFileExtension(filePath);
    return this.getSupportedExtensions().includes(extension);
  }

  /**
   * Parse content and return the syntax tree
   */
  protected parseContent(content: string, options?: ParseOptions): Parser.Tree | null {
    try {
      // Validate content before parsing
      if (content == null || typeof content !== 'string') {
        this.logger.warn('Invalid content provided to parser', {
          contentType: typeof content,
          isEmpty: content == null,
        });
        return null;
      }

      // Check for extremely large files that might cause issues
      if (content.length > 5 * 1024 * 1024) {
        // 5MB limit
        this.logger.warn('Content too large for parsing', { size: content.length });
        return null;
      }

      // Check for binary content (rough heuristic)
      if (this.isBinaryContent(content)) {
        this.logger.warn('Content appears to be binary, skipping parse');
        return null;
      }

      // Check for invalid UTF-8 sequences or unusual encoding issues
      if (this.hasEncodingIssues(content)) {
        this.logger.warn('Content has encoding issues, skipping parse');
        return null;
      }

      // Normalize line endings to prevent parser issues
      const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Check for Tree-sitter size limitation (28KB) unless bypassed
      const TREE_SITTER_SIZE_LIMIT = 28000;

      if (!options?.bypassSizeLimit && normalizedContent.length > TREE_SITTER_SIZE_LIMIT) {
        this.logger.error(
          'Content exceeds Tree-sitter limit and should be chunked at parser level',
          {
            originalSize: normalizedContent.length,
            limit: TREE_SITTER_SIZE_LIMIT,
          }
        );
        throw new Error(
          `File content too large (${normalizedContent.length} bytes). Use ChunkedParser for files over ${TREE_SITTER_SIZE_LIMIT} bytes.`
        );
      }

      const tree = this.parser.parse(normalizedContent);
      if (tree && tree.rootNode) {
        if (tree.rootNode.hasError) {
          this.syntaxErrorCount++;
          // Only log syntax errors at debug level to reduce noise
          this.logger.debug('Syntax tree contains errors', {
            errorCount: this.countTreeErrors(tree.rootNode),
          });
        }
        return tree;
      } else {
        this.logger.error('Failed to parse content: tree or rootNode is null');
        return null;
      }
    } catch (error) {
      this.logger.error('Failed to parse content', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Enhanced encoding detection and recovery pipeline
   * Replaces the original hasEncodingIssues method with recovery capability
   */
  protected async recoverEncodingIssues(
    filePath: string,
    content: string,
    options?: ParseOptions
  ): Promise<string | null> {
    // Step 1: Detect issues using existing logic
    if (!this.hasEncodingIssues(content)) {
      return content;
    }

    // Step 2: Attempt recovery if enabled
    if (options?.enableEncodingRecovery === false) {
      return null; // Existing behavior - skip file
    }

    try {
      this.logger.info('Attempting encoding recovery', { filePath });

      // Re-read file as buffer for proper encoding detection
      const buffer = await fs.readFile(filePath);
      const encodingResult = await EncodingConverter.detectEncoding(buffer);

      if (encodingResult.confidence > 0.7) {
        const recovered = await EncodingConverter.convertToUtf8(
          buffer,
          encodingResult.detectedEncoding
        );
        this.logger.info('Encoding recovery successful', {
          filePath,
          detectedEncoding: encodingResult.detectedEncoding,
          confidence: encodingResult.confidence,
        });
        return recovered;
      } else {
        this.logger.warn('Low confidence encoding detection, skipping recovery', {
          filePath,
          confidence: encodingResult.confidence,
          detectedEncoding: encodingResult.detectedEncoding,
        });
      }

      return null;
    } catch (error) {
      this.logger.warn('Encoding recovery failed', { filePath, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Simple heuristic to detect binary content
   */
  private isBinaryContent(content: string): boolean {
    // Check for null bytes (common in binary files)
    if (content.indexOf('\0') !== -1) {
      return true;
    }

    // Check for high percentage of non-printable characters
    const nonPrintableCount = content.split('').filter(char => {
      const code = char.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13; // Exclude tab, LF, CR
    }).length;

    const nonPrintableRatio = nonPrintableCount / content.length;
    return nonPrintableRatio > 0.1; // More than 10% non-printable chars
  }

  /**
   * Check for encoding issues that might cause parser problems
   */
  private hasEncodingIssues(content: string): boolean {
    try {
      // Check for replacement characters (indicates encoding issues)
      if (content.includes('\uFFFD')) {
        return true;
      }

      // Check for very long lines that might indicate a minified file or data
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.length > 10000) {
          // 10K character line limit
          return true;
        }
      }

      // Check for unusual control characters that might confuse the parser
      const controlCharPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;
      if (controlCharPattern.test(content.substring(0, Math.min(1000, content.length)))) {
        return true;
      }

      return false;
    } catch (error) {
      // If any encoding check fails, assume there are issues
      return true;
    }
  }

  /**
   * Extract symbols from a syntax tree node
   */
  protected abstract extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[];

  /**
   * Extract dependencies from a syntax tree node
   */
  protected abstract extractDependencies(
    rootNode: Parser.SyntaxNode,
    content: string
  ): ParsedDependency[];

  /**
   * Extract imports from a syntax tree node
   */
  protected abstract extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[];

  /**
   * Extract exports from a syntax tree node
   */
  protected abstract extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[];

  /**
   * Get text content for a node
   */
  protected getNodeText(node: Parser.SyntaxNode, content: string): string {
    return content.slice(node.startIndex, node.endIndex);
  }

  /**
   * Get line number for a byte position
   */
  protected getLineNumber(position: number, content: string): number {
    return content.slice(0, position).split('\n').length;
  }

  /**
   * Get file extension
   */
  protected getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
  }

  /**
   * Count syntax errors in tree
   */
  protected countTreeErrors(node: Parser.SyntaxNode): number {
    let errorCount = 0;

    if (node.hasError) {
      if (node.type === 'ERROR') {
        errorCount++;
      }

      for (const child of node.children) {
        errorCount += this.countTreeErrors(child);
      }
    }

    return errorCount;
  }

  /**
   * Find all nodes of a specific type using semantic traversal
   */
  protected findNodesOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    const nodes: Parser.SyntaxNode[] = [];

    if (node.type === type) {
      nodes.push(node);
    }

    // Use namedChildren for semantic traversal, skipping whitespace and punctuation
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        nodes.push(...this.findNodesOfType(child, type));
      }
    }

    return nodes;
  }

  /**
   * Get visibility from modifiers
   */
  protected getVisibilityFromModifiers(modifiers: string[]): Visibility | undefined {
    if (modifiers.includes('private')) return Visibility.PRIVATE;
    if (modifiers.includes('protected')) return Visibility.PROTECTED;
    if (modifiers.includes('public')) return Visibility.PUBLIC;
    return undefined;
  }

  /**
   * Check if symbol is exported
   */
  protected isSymbolExported(
    node: Parser.SyntaxNode,
    symbolName: string,
    content: string
  ): boolean {
    // This is a basic implementation - language-specific parsers should override
    const parentNode = node.parent;
    if (!parentNode) return false;

    return parentNode.type === 'export_statement' || parentNode.type === 'export_declaration';
  }

  /**
   * Validate parse options
   */
  protected validateOptions(options: ParseOptions = {}): ParseOptions {
    return {
      includePrivateSymbols: options.includePrivateSymbols ?? true,
      includeTestFiles: options.includeTestFiles ?? true,
      maxFileSize: options.maxFileSize ?? 1024 * 1024, // 1MB default
      bypassSizeLimit: options.bypassSizeLimit ?? false,
    };
  }

  /**
   * Get syntax error summary and reset counter
   */
  protected getSyntaxErrorSummary(): { count: number } {
    const summary = { count: this.syntaxErrorCount };
    this.syntaxErrorCount = 0; // Reset for next file
    return summary;
  }
}

/**
 * Parser factory for creating language-specific parsers
 */
export class ParserFactory {
  private static parsers: Map<string, () => BaseParser> = new Map();

  static registerParser(language: string, factory: () => BaseParser): void {
    this.parsers.set(language, factory);
  }

  static createParser(language: string): BaseParser | null {
    const factory = this.parsers.get(language);
    return factory ? factory() : null;
  }

  static getParser(language: string): BaseParser | null {
    return this.createParser(language);
  }

  static getParserForFile(filePath: string): BaseParser | null {
    for (const [language, factory] of this.parsers) {
      const parser = factory();
      if (parser.canParseFile(filePath)) {
        return parser;
      }
    }
    return null;
  }

  static getSupportedLanguages(): string[] {
    return Array.from(this.parsers.keys());
  }
}
