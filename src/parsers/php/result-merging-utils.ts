import { ParseResult, ParseError, ParsedSymbol, ParsedDependency, ParsedImport, ParsedExport } from '../base';
import { MergedParseResult, ChunkResult } from '../chunked-parser';
import {
  removeDuplicateSymbols,
  removeDuplicateDependencies,
  removeDuplicateImports,
  removeDuplicateExports,
} from './';

/**
 * Merge results from multiple chunks
 */
export function mergeChunkResults(
  chunks: ParseResult[],
  chunkMetadata: ChunkResult[]
): MergedParseResult {
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

  const mergedSymbols = removeDuplicateSymbols(allSymbols);
  const mergedDependencies = removeDuplicateDependencies(allDependencies);
  const mergedImports = removeDuplicateImports(allImports);
  const mergedExports = removeDuplicateExports(allExports);

  return {
    symbols: mergedSymbols,
    dependencies: mergedDependencies,
    imports: mergedImports,
    exports: mergedExports,
    errors: allErrors,
    chunksProcessed: chunks.length,
    metadata: {
      totalChunks: chunkMetadata.length,
      duplicatesRemoved:
        allSymbols.length -
        mergedSymbols.length +
        (allDependencies.length - mergedDependencies.length),
      crossChunkReferencesFound: 0,
    },
  };
}

/**
 * Convert merged result to standard parse result
 */
export function convertMergedResult(mergedResult: MergedParseResult): ParseResult {
  return {
    symbols: mergedResult.symbols,
    dependencies: mergedResult.dependencies,
    imports: mergedResult.imports,
    exports: mergedResult.exports,
    errors: mergedResult.errors,
  };
}
