/**
 * File chunking and line number utilities
 * Handles splitting large files into chunks and calculating line numbers
 */

export function getChunkBoundaries(content: string, maxChunkSize: number): number[] {
  const lines = content.split('\n');
  const boundaries: number[] = [0];
  let currentSize = 0;
  let currentPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLength = line.length + 1; // +1 for newline

    if (currentSize + lineLength > maxChunkSize && currentSize > 0) {
      boundaries.push(currentPos);
      currentSize = 0;
    }

    currentSize += lineLength;
    currentPos += lineLength;
  }

  if (currentPos > 0 && !boundaries.includes(currentPos)) {
    boundaries.push(currentPos);
  }

  return boundaries;
}

export function mergeChunkResults(chunks: any[], chunkMetadata: any[]): any {
  const merged = {
    symbols: [],
    dependencies: [],
    imports: [],
    exports: [],
    errors: [],
    chunksProcessed: chunks.length,
  };

  for (const chunk of chunks) {
    if (chunk.symbols) merged.symbols.push(...chunk.symbols);
    if (chunk.dependencies) merged.dependencies.push(...chunk.dependencies);
    if (chunk.imports) merged.imports.push(...chunk.imports);
    if (chunk.exports) merged.exports.push(...chunk.exports);
    if (chunk.errors) merged.errors.push(...chunk.errors);
  }

  return merged;
}

export function getLineNumber(position: number, content: string): number {
  return content.substring(0, position).split('\n').length;
}
