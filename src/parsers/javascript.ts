import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import {
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
  ParseOptions,
} from './base';
import { FrameworkParseOptions } from './base-framework';
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
import {
  getChunkBoundaries,
  mergeChunkResults,
  convertMergedResult,
  performSinglePassExtraction,
  findRequireCalls,
  findDynamicImports,
  findCommonJSExports,
  convertImportsToDependencies,
  removeDuplicateImports,
  removeDuplicateExports,
  SymbolExtractorCallbacks,
} from './javascript/';

export class JavaScriptParser extends ChunkedParser {
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

    if (
      chunkedOptions.enableChunking !== false &&
      content.length > (chunkedOptions.chunkSize || this.DEFAULT_CHUNK_SIZE)
    ) {
      const chunkedResult = await this.parseFileInChunks(filePath, content, {
        ...chunkedOptions,
        frameworkContext: options?.frameworkContext,
        repositoryFrameworks: options?.repositoryFrameworks,
      });
      return convertMergedResult(chunkedResult);
    }

    return this.parseFileDirectly(filePath, content, {
      ...chunkedOptions,
      frameworkContext: options?.frameworkContext,
      repositoryFrameworks: options?.repositoryFrameworks,
    });
  }

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
      const result = this.performSinglePassExtraction(
        tree.rootNode,
        content,
        filePath,
        options as FrameworkParseOptions
      );

      const deduplicatedSymbols = this.removeDuplicateSymbols(result.symbols);
      const deduplicatedDependencies = this.removeDuplicateDependencies(result.dependencies);
      const deduplicatedImports = removeDuplicateImports(result.imports);
      const deduplicatedExports = removeDuplicateExports(result.exports);

      const importDependencies = convertImportsToDependencies(
        deduplicatedImports,
        deduplicatedSymbols,
        deduplicatedExports,
        filePath
      );
      const allDependencies = this.removeDuplicateDependencies([
        ...deduplicatedDependencies,
        ...importDependencies,
      ]);

      return {
        symbols: validatedOptions.includePrivateSymbols
          ? deduplicatedSymbols
          : deduplicatedSymbols.filter(s => s.visibility !== 'private'),
        dependencies: allDependencies,
        imports: deduplicatedImports,
        exports: deduplicatedExports,
        errors: [],
      };
    } finally {
      this.clearNodeCache();
    }
  }

  protected performSinglePassExtraction(
    rootNode: Parser.SyntaxNode,
    content: string,
    filePath?: string,
    options?: FrameworkParseOptions
  ): {
    symbols: ParsedSymbol[];
    dependencies: ParsedDependency[];
    imports: ParsedImport[];
    exports: ParsedExport[];
  } {
    const callbacks: SymbolExtractorCallbacks = {
      cacheNode: this.cacheNode.bind(this),
      getNodeText: this.getNodeText.bind(this),
      findNodesOfType: this.findNodesOfType.bind(this),
      extractJSDocComment: this.extractJSDocComment.bind(this),
      isSymbolExported: this.isSymbolExported.bind(this),
    };
    return performSinglePassExtraction(rootNode, content, filePath, options, callbacks);
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

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const callbacks = {
      cacheNode: this.cacheNode.bind(this),
      getNodeText: this.getNodeText.bind(this),
      findNodesOfType: this.findNodesOfType.bind(this),
    };

    const requireCalls = findRequireCalls(rootNode, content, callbacks);
    const dynamicImports = findDynamicImports(rootNode, content, callbacks);

    return [...requireCalls, ...dynamicImports];
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const callbacks = {
      cacheNode: this.cacheNode.bind(this),
      getNodeText: this.getNodeText.bind(this),
      findNodesOfType: this.findNodesOfType.bind(this),
    };

    return findCommonJSExports(rootNode, content, callbacks);
  }

  protected extractJSDocComment(node: Parser.SyntaxNode, content: string): string | undefined {
    return extractJSDoc(node, content);
  }

  protected cleanJSDocComment(commentText: string): string {
    return cleanJSDoc(commentText);
  }

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    return getChunkBoundaries(content, maxChunkSize);
  }

  protected mergeChunkResults(
    chunks: ParseResult[],
    chunkMetadata: ChunkResult[]
  ): MergedParseResult {
    return mergeChunkResults(
      chunks,
      chunkMetadata,
      this.removeDuplicateSymbols.bind(this),
      this.removeDuplicateDependencies.bind(this)
    );
  }
}
