import Parser from 'tree-sitter';
import { php as PHP } from 'tree-sitter-php';
import {
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
} from './base';
import { FrameworkParseOptions } from './base-framework';
import {
  ChunkedParser,
  MergedParseResult,
  ChunkedParseOptions,
  ChunkResult,
} from './chunked-parser';
import { FrameworkDetector } from './utils/framework-detector';
import {
  getChunkBoundaries,
  mergeChunkResults,
  convertMergedResult,
  extractErrors,
  performSinglePassExtraction,
  TraversalCallbacks,
} from './php/';

/**
 * PHP-specific parser using Tree-sitter with chunked parsing support
 */
export class PHPParser extends ChunkedParser {
  private wasChunked: boolean = false;

  constructor() {
    const parser = new Parser();
    parser.setLanguage(PHP);
    super(parser, 'php');
  }

  getSupportedExtensions(): string[] {
    return ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'];
  }

  async parseFile(
    filePath: string,
    content: string,
    options?: FrameworkParseOptions
  ): Promise<ParseResult> {
    // Auto-detect Laravel framework if not already set
    const repositoryFrameworks = options?.repositoryFrameworks;
    let enhancedOptions: FrameworkParseOptions;

    if (
      !options?.frameworkContext?.framework &&
      FrameworkDetector.detectLaravel(content, repositoryFrameworks)
    ) {
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
      this.wasChunked = true;
      const chunkedResult = await this.parseFileInChunks(filePath, content, {
        ...chunkedOptions,
        ...(enhancedOptions as any),
      });
      return convertMergedResult(chunkedResult);
    }

    // For smaller files or when chunking is disabled, use direct parsing
    this.wasChunked = false;
    return this.parseFileDirectly(filePath, content, {
      ...chunkedOptions,
      ...(enhancedOptions as any),
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
      const callbacks: TraversalCallbacks = {
        cacheNode: this.cacheNode.bind(this),
        getNodeText: this.getNodeText.bind(this),
        findNodesOfType: this.findNodesOfType.bind(this),
      };
      const result = performSinglePassExtraction(
        tree.rootNode,
        content,
        filePath,
        options as FrameworkParseOptions,
        callbacks
      );
      const errors = extractErrors(tree.rootNode, content, this.getNodeText.bind(this), this.wasChunked, tree);

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


  protected extractSymbols(_rootNode: Parser.SyntaxNode, _content: string): ParsedSymbol[] {
    return [];
  }

  protected extractDependencies(
    _rootNode: Parser.SyntaxNode,
    _content: string
  ): ParsedDependency[] {
    return [];
  }

  protected extractImports(_rootNode: Parser.SyntaxNode, _content: string): ParsedImport[] {
    return [];
  }

  protected extractExports(_rootNode: Parser.SyntaxNode, _content: string): ParsedExport[] {
    return [];
  }

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    return getChunkBoundaries(content, maxChunkSize);
  }

  protected mergeChunkResults(
    chunks: ParseResult[],
    chunkMetadata: ChunkResult[]
  ): MergedParseResult {
    return mergeChunkResults(chunks, chunkMetadata);
  }

}
