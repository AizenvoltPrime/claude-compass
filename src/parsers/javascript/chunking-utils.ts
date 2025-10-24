import { ParseResult, ParseError } from '../base';
import { MergedParseResult, ChunkResult } from '../chunked-parser';
import { BOUNDARY_PATTERNS } from './types';
import { removeDuplicateImports, removeDuplicateExports, filterFalsePositiveErrors, detectCrossChunkReferences } from './helper-utils';

export function getChunkBoundaries(content: string, maxChunkSize: number): number[] {
  const boundaries: number[] = [];

  const searchLimit = Math.floor(maxChunkSize * 0.85);
  const searchContent = content.substring(0, Math.min(searchLimit, content.length));

  for (const pattern of BOUNDARY_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(searchContent)) !== null) {
      const position = match.index + match[0].length;
      if (position > 100 && position < searchLimit) {
        boundaries.push(position);
      }
    }
  }

  return [...new Set(boundaries)].sort((a, b) => b - a);
}

export function mergeChunkResults(
  chunks: ParseResult[],
  chunkMetadata: ChunkResult[],
  removeDuplicateSymbols: (symbols: any[]) => any[],
  removeDuplicateDependencies: (dependencies: any[]) => any[]
): MergedParseResult {
  const allSymbols: any[] = [];
  const allDependencies: any[] = [];
  const allImports: any[] = [];
  const allExports: any[] = [];
  const allErrors: ParseError[] = [];

  for (const chunk of chunks) {
    allSymbols.push(...chunk.symbols);
    allDependencies.push(...chunk.dependencies);
    allImports.push(...chunk.imports);
    allExports.push(...chunk.exports);
    const filteredErrors = filterFalsePositiveErrors(chunk.errors);
    allErrors.push(...filteredErrors);
  }

  const mergedSymbols = removeDuplicateSymbols(allSymbols);
  const mergedDependencies = removeDuplicateDependencies(allDependencies);
  const mergedImports = removeDuplicateImports(allImports);
  const mergedExports = removeDuplicateExports(allExports);

  const crossChunkReferences = detectCrossChunkReferences(
    mergedSymbols,
    mergedDependencies,
    chunkMetadata
  );

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
      crossChunkReferencesFound: crossChunkReferences,
    },
  };
}

export function convertMergedResult(mergedResult: MergedParseResult): ParseResult {
  return {
    symbols: mergedResult.symbols,
    dependencies: mergedResult.dependencies,
    imports: mergedResult.imports,
    exports: mergedResult.exports,
    errors: mergedResult.errors,
  };
}
