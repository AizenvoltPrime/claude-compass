import {
  PhpParseState,
  updateParseState,
  canCreateBoundaryAt,
  isStartOfUseStatement,
  findNextSignificantLine,
  chooseBestBoundary,
  findFallbackBoundary,
  isWhitespace,
} from './';

/**
 * Find optimal chunk boundaries for PHP content using syntax-aware boundary detection
 */
export function getChunkBoundaries(content: string, maxChunkSize: number): number[] {
  const boundaries: number[] = [];
  const targetChunkSize = Math.floor(maxChunkSize * 0.85);

  let position = 0;
  let lastBoundary = 0;

  while (position < content.length) {
    const chunkStart = lastBoundary;
    const searchLimit = chunkStart + targetChunkSize;

    if (searchLimit >= content.length) {
      // Remaining content fits in one chunk
      break;
    }

    const boundary = findNextSafeBoundary(content, chunkStart, searchLimit, maxChunkSize);

    if (boundary > chunkStart) {
      // Accept any valid boundary, even if it creates a small chunk
      // Small chunks are better than syntax errors
      boundaries.push(boundary);
      lastBoundary = boundary;
      position = boundary;
    } else {
      // No safe boundary found, use fallback
      const fallbackBoundary = findFallbackBoundary(content, chunkStart, searchLimit);
      if (fallbackBoundary > chunkStart) {
        boundaries.push(fallbackBoundary);
        lastBoundary = fallbackBoundary;
        position = fallbackBoundary;
      } else {
        // Emergency break to avoid infinite loop
        break;
      }
    }
  }

  return boundaries;
}

/**
 * Find the next safe boundary position using syntax-aware parsing
 */
export function findNextSafeBoundary(
  content: string,
  startPos: number,
  searchLimit: number,
  maxChunkSize: number
): number {
  const state: PhpParseState = {
    inString: 'none',
    stringDelimiter: '',
    heredocIdentifier: '',
    inComment: 'none',
    braceLevel: 0,
    parenLevel: 0,
    bracketLevel: 0,
    inPhpTag: false,
    classLevel: 0,
    methodLevel: 0,
    topLevelBraceLevel: 0,
    lastStatementEnd: -1,
    lastBlockEnd: -1,
    lastSafeWhitespace: -1,
    lastUseBlockEnd: -1,
    lastMethodEnd: -1,
    lastClassEnd: -1,
  };

  let useBlockStarted = false;
  let consecutiveUseStatements = 0;

  for (
    let i = startPos;
    i < Math.min(content.length, startPos + Math.floor(maxChunkSize * 1.2));
    i++
  ) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : '';
    const nextChar = i < content.length - 1 ? content[i + 1] : '';

    // Update state based on current character
    updateParseState(state, char, prevChar, nextChar, content, i);

    // Track use statements
    if (isStartOfUseStatement(content, i, state)) {
      if (!useBlockStarted) {
        useBlockStarted = true;
        consecutiveUseStatements = 1;
      } else {
        consecutiveUseStatements++;
      }
    }

    // Check for end of use block
    if (
      useBlockStarted &&
      char === ';' &&
      state.inString === 'none' &&
      state.inComment === 'none'
    ) {
      // Check if next non-whitespace/comment line is not a use statement
      const nextLineStart = findNextSignificantLine(content, i + 1);
      const isNextUse =
        nextLineStart !== -1 && isStartOfUseStatement(content, nextLineStart, state);

      if (!isNextUse) {
        state.lastUseBlockEnd = i + 1;
        useBlockStarted = false;
        consecutiveUseStatements = 0;
      }
    }

    // Track safe boundary points with improved structure awareness
    if (canCreateBoundaryAt(state, i)) {
      if (char === ';') {
        // Only record statement boundaries when at top level or after use statements
        if (state.classLevel === 0 && state.methodLevel === 0) {
          state.lastStatementEnd = i + 1;
        }
      } else if (char === '}') {
        state.lastBlockEnd = i + 1;
        // Method and class end boundaries are already tracked in updateParseState
      } else if (isWhitespace(char)) {
        state.lastSafeWhitespace = i;
      }
    }

    // Check if we should create a boundary
    if (i >= searchLimit) {
      return chooseBestBoundary(state, searchLimit, startPos);
    }
  }

  // Reached end of content
  return -1;
}
