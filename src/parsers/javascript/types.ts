import Parser from 'tree-sitter';

export const BOUNDARY_PATTERNS = [
  /}\s*(?:;)?\s*(?:\n\s*\n|\n\s*\/\/|\n\s*\/\*)/g,
  /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+\w+[^}]*}\s*(?:;)?\s*\n/g,
  /function\s+\w+\s*\([^)]*\)\s*{[^}]*}\s*(?:;)?\s*\n/g,
  /(?:const|let|var)\s+\w+\s*=\s*\([^)]*\)\s*=>\s*{[^}]*}\s*(?:;)?\s*\n/g,
  /class\s+\w+(?:\s+extends\s+\w+)?\s*{[^}]*}\s*\n/g,
  /(?:const|let|var)\s+\w+\s*=\s*{[^}]*}\s*(?:;)?\s*\n/g,
  /\}\s*\)\s*\(\s*[^)]*\s*\)\s*(?:;)?\s*\n/g,
  /\w+\s*:\s*function\s*\([^)]*\)\s*{[^}]*}\s*,?\s*\n/g,
  /;\s*\n\s*\n/g,
  /}\s*\n/g,
];

export const MODIFIER_KEYWORDS = new Set([
  'async',
  'static',
  'get',
  'set',
]);

export const COMPONENT_RENDER_FUNCTIONS = new Set([
  'h',
  'jsx',
  '_jsx',
  '_jsxs',
  'createElement'
]);

export const MAX_VARIABLE_VALUE_LENGTH = 100;
export const MAX_CALL_SIGNATURE_LENGTH = 100;
export const MAX_ARGUMENT_TEXT_LENGTH = 30;
export const ELLIPSIS_LENGTH = 3;

export const CONTROL_FLOW_KEYWORDS = ['if', 'else', 'catch', 'while', 'for', 'do', 'switch', 'try'];

export interface TraversalCallbacks {
  cacheNode: (type: string, node: Parser.SyntaxNode) => void;
  getNodeText: (node: Parser.SyntaxNode, content: string) => string;
  findNodesOfType: (root: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[];
}
