import Parser from 'tree-sitter';

export function extractJSDocComment(node: Parser.SyntaxNode, content: string): string | undefined {
  let targetNode = node;

  // If node is inside an export_statement, look at export's siblings instead
  if (node.parent?.type === 'export_statement') {
    targetNode = node.parent;
  } else if (node.parent?.parent?.type === 'export_statement') {
    // Handle export const/let/var where node is inside lexical_declaration/variable_declaration
    targetNode = node.parent.parent;
  }

  const parent = targetNode.parent;
  if (!parent) return undefined;

  const nodeIndex = parent.children.indexOf(targetNode);
  if (nodeIndex <= 0) return undefined;

  for (let i = nodeIndex - 1; i >= 0; i--) {
    const sibling = parent.children[i];

    if (sibling.type === '\n' || sibling.type === 'whitespace') continue;

    if (sibling.type !== 'comment') break;

    const commentText = content.slice(sibling.startIndex, sibling.endIndex);

    if (commentText.trim().startsWith('/**')) {
      return cleanJSDocComment(commentText);
    }

    break;
  }

  return undefined;
}

export function cleanJSDocComment(commentText: string): string {
  let cleaned = commentText
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .trim();

  const lines = cleaned.split('\n').map(line => {
    return line.replace(/^\s*\*?\s?/, '');
  });

  return lines.join('\n').trim();
}
