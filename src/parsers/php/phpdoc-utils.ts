import Parser from 'tree-sitter';

/**
 * Clean PHPDoc comment by removing delimiters and asterisks
 */
export function cleanPhpDocComment(commentText: string): string {
  let cleaned = commentText
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .trim();

  const lines = cleaned.split('\n').map(line => {
    return line.replace(/^\s*\*?\s?/, '');
  });

  return lines.join('\n').trim();
}

/**
 * Extract PHPDoc comment from a node
 */
export function extractPhpDocComment(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string | undefined {
  const parent = node.parent;
  if (!parent) return undefined;

  const nodeIndex = parent.children.indexOf(node);
  if (nodeIndex <= 0) return undefined;

  for (let i = nodeIndex - 1; i >= 0; i--) {
    const sibling = parent.children[i];

    if (sibling.type === '\n' || sibling.type === 'whitespace') continue;

    if (sibling.type !== 'comment') break;

    const commentText = getNodeText(sibling, content);

    if (commentText.trim().startsWith('/**')) {
      return cleanPhpDocComment(commentText);
    }

    break;
  }

  return undefined;
}
