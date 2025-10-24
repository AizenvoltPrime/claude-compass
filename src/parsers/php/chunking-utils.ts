import {
  PhpParseState,
  CHUNK_BOUNDARY_CONFIG,
  CLASS_PATTERNS,
  CLASS_BRACE_PATTERNS,
  FUNCTION_PATTERNS,
  FUNCTION_BRACE_PATTERNS,
} from './types';

export function createInitialParseState(): PhpParseState {
  return {
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
    lastClassEnd: -1
  };
}

export function updateParseState(
  state: PhpParseState,
  char: string,
  prevChar: string,
  nextChar: string,
  content: string,
  position: number
): void {
  if (state.inString === 'none' && state.inComment === 'none') {
    if (char === '<' && content.substr(position, 5) === '<?php') {
      state.inPhpTag = true;
      return;
    } else if (char === '?' && nextChar === '>' && state.inPhpTag) {
      state.inPhpTag = false;
      return;
    }
  }

  if (!state.inPhpTag) return;

  if (state.inComment === 'none' && state.inString === 'none') {
    if (char === '/' && nextChar === '/') {
      state.inComment = 'single';
      return;
    } else if (char === '/' && nextChar === '*') {
      state.inComment = 'multi';
      return;
    }
  }

  if (state.inComment === 'single' && char === '\n') {
    state.inComment = 'none';
    return;
  } else if (state.inComment === 'multi' && char === '*' && nextChar === '/') {
    state.inComment = 'none';
    return;
  }

  if (state.inComment !== 'none') return;

  if (state.inString === 'none') {
    if (char === '"') {
      state.inString = 'double';
      state.stringDelimiter = '"';
    } else if (char === "'") {
      state.inString = 'single';
      state.stringDelimiter = "'";
    } else if (char === '<' && content.substr(position, 3) === '<<<') {
      const heredocMatch = content.substr(position).match(/^<<<\s*['"]?(\w+)['"]?\s*\n/);
      if (heredocMatch) {
        state.inString = heredocMatch[0].includes("'") ? 'nowdoc' : 'heredoc';
        state.heredocIdentifier = heredocMatch[1];
      }
    }
  } else {
    if (state.inString === 'single' || state.inString === 'double') {
      if (char === '\\') {
        return;
      } else if (char === state.stringDelimiter && prevChar !== '\\') {
        state.inString = 'none';
        state.stringDelimiter = '';
      }
    } else if (state.inString === 'heredoc' || state.inString === 'nowdoc') {
      if (char === '\n') {
        const lineStart = position + 1;
        if (content.substr(lineStart).startsWith(state.heredocIdentifier)) {
          const afterIdentifier = lineStart + state.heredocIdentifier.length;
          if (afterIdentifier >= content.length || content[afterIdentifier] === ';' || content[afterIdentifier] === '\n') {
            state.inString = 'none';
            state.heredocIdentifier = '';
          }
        }
      }
    }
  }

  if (state.inString !== 'none') return;

  if (char === '{') {
    state.braceLevel++;

    const isClass = isAtStartOfClassOrInterface(content, position, state);
    const isMethod = isAtStartOfMethodOrFunction(content, position, state);

    if (isClass) {
      state.classLevel++;
      state.topLevelBraceLevel++;
    } else if (isMethod) {
      state.methodLevel++;
      if (state.classLevel === 0) {
        state.topLevelBraceLevel++;
      }
    }
  } else if (char === '}') {
    const wasTopLevel = (state.classLevel === 0) || (state.methodLevel > 0 && state.classLevel === 0);

    state.braceLevel--;

    if (state.methodLevel > 0) {
      state.methodLevel--;
      if (state.methodLevel === 0) {
        state.lastMethodEnd = position + 1;
        if (state.classLevel === 0) {
          state.topLevelBraceLevel--;
        }
      }
    } else if (state.classLevel > 0) {
      state.classLevel--;
      if (state.classLevel === 0) {
        state.lastClassEnd = position + 1;
        state.topLevelBraceLevel--;
      }
    } else if (wasTopLevel) {
      state.topLevelBraceLevel--;
    }
  } else if (char === '(') {
    state.parenLevel++;
  } else if (char === ')') {
    state.parenLevel--;
  } else if (char === '[') {
    state.bracketLevel++;
  } else if (char === ']') {
    state.bracketLevel--;
  }
}

export function canCreateBoundaryAt(state: PhpParseState, _position: number): boolean {
  return state.inString === 'none' &&
         state.inComment === 'none' &&
         state.braceLevel >= 0 &&
         state.parenLevel >= 0 &&
         state.bracketLevel >= 0 &&
         state.inPhpTag;
}

export function isAtStartOfClassOrInterface(content: string, position: number, state: PhpParseState): boolean {
  if (!canCreateBoundaryAt(state, position)) return false;

  const searchStart = Math.max(0, position - 300);
  const searchText = content.substring(searchStart, position + 1);

  if (content[position] === '{') {
    const beforeBrace = content.substring(searchStart, position).replace(/\s+$/, '');

    if (CLASS_BRACE_PATTERNS.some(pattern => pattern.test(beforeBrace))) {
      return true;
    }
  }

  return CLASS_PATTERNS.some(pattern => pattern.test(searchText));
}

export function isAtStartOfMethodOrFunction(content: string, position: number, state: PhpParseState): boolean {
  if (!canCreateBoundaryAt(state, position)) return false;

  const searchStart = Math.max(0, position - 500);
  const searchText = content.substring(searchStart, position + 1);

  if (content[position] === '{') {
    const beforeBrace = content.substring(searchStart, position).replace(/\s+$/, '');

    if (FUNCTION_BRACE_PATTERNS.some(pattern => pattern.test(beforeBrace))) {
      return true;
    }
  }

  return FUNCTION_PATTERNS.some(pattern => pattern.test(searchText));
}

export function isStartOfUseStatement(content: string, position: number, state: PhpParseState): boolean {
  if (!canCreateBoundaryAt(state, position)) return false;

  let lineStart = position;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') {
    lineStart--;
  }

  const lineContent = content.substr(lineStart).replace(/^\s+/, '');
  const isUseLine = lineContent.startsWith('use ') && !lineContent.startsWith('use function ') && !lineContent.startsWith('use const ');

  if (isUseLine) {
    const trimmedLineStart = lineContent.length - lineContent.replace(/^\s+/, '').length;
    const useStatementStart = lineStart + trimmedLineStart;

    return position >= useStatementStart && position <= useStatementStart + 10;
  }

  return false;
}

export function findNextSignificantLine(content: string, startPos: number): number {
  let pos = startPos;
  let foundNewline = false;

  while (pos < content.length) {
    const char = content[pos];

    if (char === '\n') {
      foundNewline = true;
      pos++;
      continue;
    }

    if (foundNewline && !isWhitespace(char)) {
      if (char === '/' && pos + 1 < content.length && content[pos + 1] === '/') {
        while (pos < content.length && content[pos] !== '\n') {
          pos++;
        }
        continue;
      } else if (char === '/' && pos + 1 < content.length && content[pos + 1] === '*') {
        pos += 2;
        while (pos + 1 < content.length) {
          if (content[pos] === '*' && content[pos + 1] === '/') {
            pos += 2;
            break;
          }
          pos++;
        }
        continue;
      }

      return pos;
    }

    if (foundNewline && isWhitespace(char)) {
      pos++;
      continue;
    }

    if (!foundNewline) {
      pos++;
      continue;
    }

    break;
  }

  return -1;
}

export function chooseBestBoundary(state: PhpParseState, searchLimit: number, startPos: number): number {
  const candidates = [
    { pos: state.lastUseBlockEnd, priority: 1 },
    { pos: state.lastClassEnd, priority: 2 },
    { pos: state.lastMethodEnd, priority: 3 },
    { pos: state.lastStatementEnd, priority: 4 },
    { pos: state.lastBlockEnd, priority: 5 },
    { pos: state.lastSafeWhitespace, priority: 6 }
  ].filter(candidate => candidate.pos > startPos && candidate.pos <= searchLimit);

  if (candidates.length === 0) {
    return -1;
  }

  candidates.sort((a, b) => a.priority - b.priority);

  return candidates[0].pos;
}

export function findFallbackBoundary(content: string, startPos: number, searchLimit: number): number {
  for (let i = Math.min(searchLimit, content.length - 1); i > startPos; i--) {
    if (isWhitespace(content[i]) && content[i - 1] !== '\\') {
      return i;
    }
  }

  return Math.min(searchLimit, content.length);
}

export function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}
