import { ParsedImport } from '../base';
import { FrameworkParseOptions } from '../base-framework';

export interface PhpParseState {
  inString: 'none' | 'single' | 'double' | 'heredoc' | 'nowdoc';
  stringDelimiter: string;
  heredocIdentifier: string;
  inComment: 'none' | 'single' | 'multi';
  braceLevel: number;
  parenLevel: number;
  bracketLevel: number;
  inPhpTag: boolean;
  classLevel: number;
  methodLevel: number;
  topLevelBraceLevel: number;
  lastStatementEnd: number;
  lastBlockEnd: number;
  lastSafeWhitespace: number;
  lastUseBlockEnd: number;
  lastMethodEnd: number;
  lastClassEnd: number;
}

export interface PHPParsingContext {
  currentNamespace: string | null;
  currentClass: string | null;
  typeMap: Map<string, string>;
  parentClass: string | null;
  filePath: string;
  useStatements: ParsedImport[];
  options?: FrameworkParseOptions;
  relationshipRegistry: Map<string, Map<string, string>>;
}

export const PHP_CLOSURE_NODE_TYPES = new Set([
  'anonymous_function',
  'arrow_function',
]);

export const PHP_CALL_PATTERNS = {
  instanceCallPrefixes: ['$this->', '$'],
  staticCallSuffix: '::',
  instanceAccessOperator: '->',
  staticAccessOperator: '::',
  namespaceOperator: '\\',
  newOperator: 'new',
} as const;

export const MAX_PARAMETER_LENGTH = 200;

export const CHUNK_BOUNDARY_CONFIG = {
  MIN_CHUNK_SIZE: 1000,
  SAFE_BOUNDARY_BUFFER: 100,
  MAX_NESTING_DEPTH: 50,
  STRING_CONTEXT_SIZE: 200
};

export const CLASS_PATTERNS = [
  /\b(?:class|interface|trait)\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*(?:\{|\s*$)/m,
  /\b(?:abstract\s+)?class\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*(?:\{|\s*$)/m,
  /\bfinal\s+class\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*(?:\{|\s*$)/m,
];

export const CLASS_BRACE_PATTERNS = [
  /\b(?:class|interface|trait)\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*$/,
  /\b(?:abstract\s+)?class\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*$/,
  /\bfinal\s+class\s+\w+(?:\s+extends\s+[\w\\]+)?(?:\s+implements\s+[\w\\,\s]+)?\s*$/,
];

export const FUNCTION_PATTERNS = [
  /\bfunction\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
  /\b(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
  /\b(?:public|private|protected)\s+static\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
  /\bstatic\s+(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
  /\bstatic\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*(?:\{|\s*$)/m,
  /\babstract\s+(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?;?\s*$/m,
];

export const FUNCTION_BRACE_PATTERNS = [
  /\bfunction\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
  /\b(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
  /\b(?:public|private|protected)\s+static\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
  /\bstatic\s+(?:public|private|protected)\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
  /\bstatic\s+function\s+\w+\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*$/,
];

export const MODIFIER_KEYWORDS = new Set([
  'public',
  'protected',
  'private',
  'static',
  'abstract',
  'final',
]);

export const CLOSURE_SYMBOL_PREFIX = '<closure:line_';

export function createClosureSymbolName(lineNumber: number): string {
  return `${CLOSURE_SYMBOL_PREFIX}${lineNumber}>`;
}

export function isClosureSymbolName(name: string): boolean {
  return name.startsWith(CLOSURE_SYMBOL_PREFIX);
}
