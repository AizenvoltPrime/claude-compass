import Parser from 'tree-sitter';
import { SymbolType, DependencyType, CreateSymbol, CreateDependency } from '../database/models';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('parser-base');

// Parser result interfaces
export interface ParsedSymbol {
  name: string;
  symbol_type: SymbolType;
  start_line: number;
  end_line: number;
  is_exported: boolean;
  visibility?: 'public' | 'private' | 'protected';
  signature?: string;
}

export interface ParsedDependency {
  from_symbol: string;
  to_symbol: string;
  dependency_type: DependencyType;
  line_number: number;
  confidence: number;
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

export interface ParseResult {
  symbols: ParsedSymbol[];
  dependencies: ParsedDependency[];
  imports: ParsedImport[];
  exports: ParsedExport[];
  errors: ParseError[];
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
}

/**
 * Abstract base class for all language parsers
 */
export abstract class BaseParser {
  protected parser: Parser;
  protected language: string;
  protected logger: any;

  constructor(parser: Parser, language: string) {
    this.parser = parser;
    this.language = language;
    this.logger = createComponentLogger(`parser-${language}`);
  }

  /**
   * Parse a file and extract symbols, dependencies, imports, and exports
   */
  abstract parseFile(filePath: string, content: string, options?: ParseOptions): Promise<ParseResult>;

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
  protected parseContent(content: string): Parser.Tree | null {
    try {
      // Validate content before parsing
      if (!content || typeof content !== 'string') {
        this.logger.warn('Invalid content provided to parser', {
          contentType: typeof content,
          isEmpty: !content
        });
        return null;
      }

      // Check for extremely large files that might cause issues
      if (content.length > 5 * 1024 * 1024) { // 5MB limit
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

      // Check for Tree-sitter size limitation (around 30-35K characters)
      const TREE_SITTER_SIZE_LIMIT = 32000;
      let contentToParse = normalizedContent;

      if (normalizedContent.length > TREE_SITTER_SIZE_LIMIT) {
        this.logger.warn('Content exceeds Tree-sitter size limit, attempting smart truncation', {
          originalSize: normalizedContent.length,
          limit: TREE_SITTER_SIZE_LIMIT
        });

        const truncated = this.truncateAtSafePoint(normalizedContent, TREE_SITTER_SIZE_LIMIT);
        if (truncated) {
          contentToParse = truncated;
          this.logger.info('Successfully truncated content at safe point', {
            originalSize: normalizedContent.length,
            truncatedSize: contentToParse.length
          });
        } else {
          this.logger.warn('Could not find safe truncation point, using hard limit');
          contentToParse = normalizedContent.substring(0, TREE_SITTER_SIZE_LIMIT);
        }
      }

      const tree = this.parser.parse(contentToParse);
      if (tree.rootNode.hasError) {
        this.logger.warn('Syntax tree contains errors', {
          errorCount: this.countTreeErrors(tree.rootNode)
        });
      }
      return tree;
    } catch (error) {
      this.logger.error('Failed to parse content', { error: (error as Error).message });
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
        if (line.length > 10000) { // 10K character line limit
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
  protected abstract extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[];

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
   * Find all nodes of a specific type
   */
  protected findNodesOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    const nodes: Parser.SyntaxNode[] = [];

    if (node.type === type) {
      nodes.push(node);
    }

    for (const child of node.children) {
      nodes.push(...this.findNodesOfType(child, type));
    }

    return nodes;
  }

  /**
   * Get visibility from modifiers
   */
  protected getVisibilityFromModifiers(modifiers: string[]): 'public' | 'private' | 'protected' | undefined {
    if (modifiers.includes('private')) return 'private';
    if (modifiers.includes('protected')) return 'protected';
    if (modifiers.includes('public')) return 'public';
    return undefined;
  }

  /**
   * Check if symbol is exported
   */
  protected isSymbolExported(node: Parser.SyntaxNode, symbolName: string, content: string): boolean {
    // This is a basic implementation - language-specific parsers should override
    const parentNode = node.parent;
    if (!parentNode) return false;

    return parentNode.type === 'export_statement' ||
           parentNode.type === 'export_declaration';
  }

  /**
   * Smart truncation at safe points to avoid cutting off important symbols
   */
  private truncateAtSafePoint(content: string, maxLength: number): string | null {
    if (content.length <= maxLength) return content;

    // Calculate a safe range to look for truncation points (85% of maxLength)
    const safeSearchEnd = Math.floor(maxLength * 0.85);
    const searchRange = content.substring(0, safeSearchEnd);

    // Look for safe truncation points in order of preference
    const safePoints = [
      // End of function/class/interface definitions with closing brace and semicolon
      searchRange.lastIndexOf(';\n\n'),
      searchRange.lastIndexOf('};\n'),
      searchRange.lastIndexOf('}\n\n'),
      // End of export statements
      searchRange.lastIndexOf('\nexport '),
      // End of function declarations
      searchRange.lastIndexOf('\nfunction '),
      searchRange.lastIndexOf('\nconst '),
      searchRange.lastIndexOf('\nlet '),
      searchRange.lastIndexOf('\nvar '),
      // End of class/interface declarations
      searchRange.lastIndexOf('\nclass '),
      searchRange.lastIndexOf('\ninterface '),
      searchRange.lastIndexOf('\ntype '),
      // Simple closing braces
      searchRange.lastIndexOf('}\n'),
      searchRange.lastIndexOf('}\r\n')
    ];

    // Find the best truncation point
    const validPoints = safePoints.filter(point => point > 0);

    if (validPoints.length === 0) {
      this.logger.warn('No safe truncation points found');
      return null;
    }

    const bestPoint = Math.max(...validPoints);

    // Add a few characters to include the newline/delimiter
    const truncateAt = bestPoint + (content.charAt(bestPoint) === ';' ? 2 : 1);

    this.logger.debug('Found safe truncation point', {
      originalLength: content.length,
      truncateAt,
      contextBefore: content.substring(Math.max(0, bestPoint - 50), bestPoint),
      contextAfter: content.substring(bestPoint, bestPoint + 20)
    });

    return content.substring(0, truncateAt);
  }

  /**
   * Validate parse options
   */
  protected validateOptions(options: ParseOptions = {}): ParseOptions {
    return {
      includePrivateSymbols: options.includePrivateSymbols ?? true,
      includeTestFiles: options.includeTestFiles ?? true,
      maxFileSize: options.maxFileSize ?? 1024 * 1024, // 1MB default
    };
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