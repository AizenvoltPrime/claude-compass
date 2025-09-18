import Parser from 'tree-sitter';
import { BaseParser, ParseResult, ParseOptions, ParsedSymbol, ParsedDependency, ParsedImport, ParsedExport, ParseError } from './base';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('chunked-parser');

/**
 * Represents a chunk of a large file for parsing
 */
export interface ChunkResult {
  content: string;
  startLine: number;
  endLine: number;
  chunkIndex: number;
  isComplete: boolean;
  metadata?: {
    originalStartLine: number;
    hasOverlapBefore: boolean;
    hasOverlapAfter: boolean;
    totalChunks: number;
  };
}

/**
 * Result of merging multiple chunk parse results
 */
export interface MergedParseResult {
  symbols: ParsedSymbol[];
  dependencies: ParsedDependency[];
  imports: ParsedImport[];
  exports: ParsedExport[];
  errors: ParseError[];
  chunksProcessed: number;
  metadata?: {
    totalChunks: number;
    duplicatesRemoved: number;
    crossChunkReferencesFound: number;
  };
}

/**
 * Options for chunked parsing
 */
export interface ChunkedParseOptions extends ParseOptions {
  enableChunking?: boolean;
  chunkSize?: number;
  chunkOverlapLines?: number;
  preserveContext?: boolean;
}

/**
 * Abstract base class for parsers that support chunked parsing
 * Extends BaseParser to handle large files by splitting them into logical chunks
 */
export abstract class ChunkedParser extends BaseParser {
  protected readonly DEFAULT_CHUNK_SIZE = 28000; // 28KB - safe buffer under Tree-sitter limit
  protected readonly DEFAULT_OVERLAP_LINES = 100;
  protected declare readonly logger: any;

  constructor(parser: Parser, language: string) {
    super(parser, language);
    this.logger = createComponentLogger(`chunked-parser-${language}`);
  }

  /**
   * Parse a file using chunked approach for large files
   */
  public async parseFileInChunks(
    filePath: string,
    content: string,
    options?: ChunkedParseOptions
  ): Promise<MergedParseResult> {
    const chunkSize = options?.chunkSize || this.DEFAULT_CHUNK_SIZE;
    const overlapLines = options?.chunkOverlapLines || this.DEFAULT_OVERLAP_LINES;

    this.logger.debug('Starting chunked parsing', {
      filePath,
      fileSize: content.length,
      chunkSize,
      overlapLines
    });

    try {
      // Split content into chunks
      const chunks = this.splitIntoChunks(content, chunkSize, overlapLines);

      this.logger.debug('File split into chunks', {
        totalChunks: chunks.length,
        avgChunkSize: chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunks.length
      });

      // Parse each chunk
      const chunkResults: ParseResult[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Removed verbose per-chunk logging to reduce noise

        try {
          const chunkResult = await this.parseChunk(chunk, filePath, options);
          chunkResults.push(chunkResult);
        } catch (error) {
          this.logger.warn(`Failed to parse chunk ${i + 1}`, {
            error: (error as Error).message,
            chunkIndex: i
          });

          // Add error to results but continue with other chunks
          chunkResults.push({
            symbols: [],
            dependencies: [],
            imports: [],
            exports: [],
            errors: [{
              message: `Chunk parsing failed: ${(error as Error).message}`,
              line: chunk.startLine,
              column: 1,
              severity: 'error'
            }]
          });
        }
      }

      // Merge results from all chunks
      const mergedResult = this.mergeChunkResults(chunkResults, chunks);

      this.logger.info('Chunked parsing completed', {
        totalChunks: chunks.length,
        symbolsFound: mergedResult.symbols.length,
        dependenciesFound: mergedResult.dependencies.length,
        errorsEncountered: mergedResult.errors.length
      });

      return mergedResult;

    } catch (error) {
      this.logger.error('Chunked parsing failed', {
        filePath,
        error: (error as Error).message
      });

      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `Chunked parsing failed: ${(error as Error).message}`,
          line: 1,
          column: 1,
          severity: 'error'
        }],
        chunksProcessed: 0
      };
    }
  }

  /**
   * Split content into logical chunks with overlap
   */
  protected splitIntoChunks(
    content: string,
    maxChunkSize: number,
    overlapLines: number
  ): ChunkResult[] {
    const lines = content.split('\n');
    const chunks: ChunkResult[] = [];
    let currentPosition = 0;

    while (currentPosition < lines.length) {
      const chunkBoundaries = this.getChunkBoundaries(
        lines.slice(currentPosition).join('\n'),
        maxChunkSize
      );

      let chunkEndLine: number;
      if (chunkBoundaries.length > 0) {
        // Use the best boundary found
        const bestBoundary = chunkBoundaries[0];
        chunkEndLine = currentPosition + this.getLineFromPosition(
          lines.slice(currentPosition).join('\n'),
          bestBoundary
        );
      } else {
        // Fallback to character-based splitting
        let estimatedLines = Math.floor(maxChunkSize / 80); // Rough estimate of lines per chunk
        chunkEndLine = Math.min(currentPosition + estimatedLines, lines.length);
      }

      // Ensure we don't exceed file boundaries
      chunkEndLine = Math.min(chunkEndLine, lines.length);

      // Create chunk content and validate size
      let actualChunkEndLine = chunkEndLine;
      let chunkContent: string;

      // Ensure chunk doesn't exceed byte limit
      do {
        const chunkLines = lines.slice(currentPosition, actualChunkEndLine);
        chunkContent = chunkLines.join('\n');

        if (chunkContent.length <= maxChunkSize) {
          break; // Chunk is within limits
        }

        // Chunk is too large, reduce by 10% and try again
        const reduction = Math.max(1, Math.floor((actualChunkEndLine - currentPosition) * 0.1));
        actualChunkEndLine -= reduction;

        // Safety check to prevent infinite loop
        if (actualChunkEndLine <= currentPosition) {
          // Take just one line if we can't fit even a small chunk
          actualChunkEndLine = currentPosition + 1;
          chunkContent = lines[currentPosition] || '';
          break;
        }
      } while (actualChunkEndLine > currentPosition);

      const chunk: ChunkResult = {
        content: chunkContent,
        startLine: currentPosition + 1, // 1-based line numbers
        endLine: actualChunkEndLine,
        chunkIndex: chunks.length,
        isComplete: actualChunkEndLine >= lines.length,
        metadata: {
          originalStartLine: currentPosition + 1,
          hasOverlapBefore: chunks.length > 0,
          hasOverlapAfter: actualChunkEndLine < lines.length,
          totalChunks: 0 // Will be filled after all chunks are created
        }
      };

      chunks.push(chunk);

      // Calculate next position with overlap
      if (actualChunkEndLine >= lines.length) {
        break; // We've reached the end
      }

      // Move position forward, but leave overlap
      currentPosition = Math.max(
        currentPosition + 1, // Always advance at least one line
        actualChunkEndLine - overlapLines
      );
    }

    // Update total chunks metadata
    chunks.forEach(chunk => {
      if (chunk.metadata) {
        chunk.metadata.totalChunks = chunks.length;
      }
    });

    return chunks;
  }

  /**
   * Parse a single chunk
   */
  protected async parseChunk(
    chunk: ChunkResult,
    originalFilePath: string,
    options?: ChunkedParseOptions
  ): Promise<ParseResult> {
    // Create a clean temporary file name for the chunk (avoid path pollution)
    const cleanFilePath = originalFilePath.split('#chunk')[0]; // Remove any existing chunk markers
    const chunkFilePath = `${cleanFilePath}#chunk${chunk.chunkIndex}`;

    // Use the existing parseFile method but with chunk content
    // This will leverage all existing parsing logic in the subclass
    const result = await this.parseChunkContent(chunkFilePath, chunk.content, options);

    // Adjust line numbers to account for chunk position in original file
    const lineOffset = chunk.startLine - 1;

    return {
      symbols: result.symbols.map(symbol => ({
        ...symbol,
        start_line: symbol.start_line + lineOffset,
        end_line: symbol.end_line + lineOffset
      })),
      dependencies: result.dependencies.map(dep => ({
        ...dep,
        line_number: dep.line_number + lineOffset
      })),
      imports: result.imports.map(imp => ({
        ...imp,
        line_number: imp.line_number + lineOffset
      })),
      exports: result.exports.map(exp => ({
        ...exp,
        line_number: exp.line_number + lineOffset
      })),
      errors: result.errors.map(error => ({
        ...error,
        line: error.line + lineOffset
      }))
    };
  }

  /**
   * Parse chunk content - subclasses should override this to provide chunk-specific logic
   */
  protected async parseChunkContent(
    chunkFilePath: string,
    content: string,
    options?: ChunkedParseOptions
  ): Promise<ParseResult> {
    // Default implementation uses direct parsing to avoid recursion
    // Force non-chunked parsing for individual chunks and bypass size limits
    const nonChunkedOptions = { ...options, enableChunking: false, bypassSizeLimit: true };
    return this.parseFileDirectly(chunkFilePath, content, nonChunkedOptions);
  }

  /**
   * Parse file directly without chunking (internal method to avoid recursion)
   */
  protected async parseFileDirectly(
    filePath: string,
    content: string,
    options?: ChunkedParseOptions
  ): Promise<ParseResult> {
    // This should be implemented by subclasses to provide direct parsing
    // without going through the chunking logic
    throw new Error('parseFileDirectly must be implemented by subclasses');
  }

  /**
   * Get line number from character position in content
   */
  private getLineFromPosition(content: string, position: number): number {
    return content.substring(0, position).split('\n').length - 1;
  }

  // Abstract methods that subclasses must implement for chunk-aware parsing

  /**
   * Find optimal chunk boundaries in content
   * Returns array of character positions where chunks should end, in order of preference
   */
  protected abstract getChunkBoundaries(content: string, maxChunkSize: number): number[];

  /**
   * Merge results from multiple chunks, handling duplicates and cross-chunk references
   */
  protected abstract mergeChunkResults(chunks: ParseResult[], chunkMetadata: ChunkResult[]): MergedParseResult;

  /**
   * Enhanced parseContent method that checks for chunking requirements
   */
  protected parseContent(content: string, options?: ChunkedParseOptions): Parser.Tree | null {
    // Check if chunking should be used
    if (this.shouldUseChunking(content, options)) {
      // For chunked parsing, we'll handle this at a higher level
      // This method should only be called for individual chunks
      return super.parseContent(content);
    }

    // Use parent implementation for normal parsing
    return super.parseContent(content);
  }

  /**
   * Determine if chunking should be used for the given content
   */
  protected shouldUseChunking(content: string, options?: ChunkedParseOptions): boolean {
    if (options?.enableChunking === false) {
      return false;
    }

    const chunkSize = options?.chunkSize || this.DEFAULT_CHUNK_SIZE;
    return content.length > chunkSize;
  }

  /**
   * Utility method to remove duplicate symbols across chunks
   */
  protected removeDuplicateSymbols(symbols: ParsedSymbol[]): ParsedSymbol[] {
    const seen = new Map<string, ParsedSymbol>();

    for (const symbol of symbols) {
      const key = `${symbol.name}:${symbol.symbol_type}:${symbol.start_line}`;

      if (!seen.has(key) || this.isMoreCompleteSymbol(symbol, seen.get(key)!)) {
        seen.set(key, symbol);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Determine if one symbol is more complete than another (used for deduplication)
   */
  protected isMoreCompleteSymbol(symbol1: ParsedSymbol, symbol2: ParsedSymbol): boolean {
    // Prefer symbols with signatures
    if (symbol1.signature && !symbol2.signature) return true;
    if (!symbol1.signature && symbol2.signature) return false;

    // Prefer exported symbols
    if (symbol1.is_exported && !symbol2.is_exported) return true;
    if (!symbol1.is_exported && symbol2.is_exported) return false;

    // Prefer symbols with better line coverage
    const coverage1 = symbol1.end_line - symbol1.start_line;
    const coverage2 = symbol2.end_line - symbol2.start_line;

    return coverage1 > coverage2;
  }

  /**
   * Utility method to remove duplicate dependencies across chunks
   */
  protected removeDuplicateDependencies(dependencies: ParsedDependency[]): ParsedDependency[] {
    const seen = new Set<string>();
    const result: ParsedDependency[] = [];

    for (const dep of dependencies) {
      const key = `${dep.from_symbol}:${dep.to_symbol}:${dep.dependency_type}`;

      if (!seen.has(key)) {
        seen.add(key);
        result.push(dep);
      }
    }

    return result;
  }
}