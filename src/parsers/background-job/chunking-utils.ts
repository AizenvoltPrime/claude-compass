import { ParseResult, ParsedSymbol, ParsedDependency, ParseError } from '../base';

export function getChunkBoundaries(content: string, maxChunkSize: number): number[] {
  const lines = content.split('\n');
  const boundaries: number[] = [0];
  let currentSize = 0;
  let currentPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineSize = lines[i].length + 1;

    if (currentSize + lineSize > maxChunkSize && currentSize > 0) {
      // Try to break at job/queue boundaries
      const line = lines[i];
      if (/^\s*(queue\.|\.define\(|\.process\(|\.add\()/.test(line)) {
        boundaries.push(currentPos);
        currentSize = lineSize;
      } else {
        currentSize += lineSize;
      }
    } else {
      currentSize += lineSize;
    }

    currentPos += lineSize;
  }

  if (boundaries[boundaries.length - 1] !== currentPos) {
    boundaries.push(currentPos);
  }

  return boundaries;
}

export function mergeChunkResults(chunks: ParseResult[], chunkMetadata: any[]): any {
  const merged = {
    symbols: [] as ParsedSymbol[],
    dependencies: [] as ParsedDependency[],
    imports: [] as any[],
    exports: [] as any[],
    errors: [] as ParseError[],
    chunksProcessed: chunks.length,
    metadata: {
      totalChunks: chunks.length,
      duplicatesRemoved: 0,
      crossChunkReferencesFound: 0,
    },
  };

  const seenSymbols = new Set<string>();
  const seenDependencies = new Set<string>();

  for (const chunk of chunks) {
    // Merge symbols, avoiding duplicates
    for (const symbol of chunk.symbols) {
      const key = `${symbol.name}:${symbol.start_line}`;
      if (!seenSymbols.has(key)) {
        seenSymbols.add(key);
        merged.symbols.push(symbol);
      } else {
        merged.metadata.duplicatesRemoved++;
      }
    }

    // Merge dependencies, avoiding duplicates
    for (const dep of chunk.dependencies) {
      const key = `${dep.from_symbol}:${dep.to_symbol}:${dep.line_number}`;
      if (!seenDependencies.has(key)) {
        seenDependencies.add(key);
        merged.dependencies.push(dep);
      } else {
        merged.metadata.duplicatesRemoved++;
      }
    }

    merged.imports.push(...chunk.imports);
    merged.exports.push(...chunk.exports);
    merged.errors.push(...chunk.errors);
  }

  return merged;
}
