import Parser from 'tree-sitter';

/**
 * Extract XML documentation comment preceding a node
 */
export function extractXmlDocComment(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string | undefined {
  const parent = node.parent;
  if (!parent) return undefined;

  const nodeIndex = parent.children.indexOf(node);
  if (nodeIndex <= 0) return undefined;

  const xmlCommentLines: string[] = [];

  for (let i = nodeIndex - 1; i >= 0; i--) {
    const sibling = parent.children[i];

    if (sibling.type === '\n' || sibling.type === 'whitespace') continue;

    if (sibling.type !== 'comment') break;

    const commentText = getNodeTextFn(sibling, content);

    if (commentText.trim().startsWith('///')) {
      xmlCommentLines.unshift(commentText);
    } else {
      break;
    }
  }

  if (xmlCommentLines.length === 0) return undefined;

  const xmlText = xmlCommentLines.join('\n');
  return extractXmlSummary(xmlText);
}

/**
 * Extract summary text from XML documentation
 */
export function extractXmlSummary(xmlText: string): string | undefined {
  const cleaned = xmlText
    .split('\n')
    .map(line => line.replace(/^\s*\/\/\/\s?/, ''))
    .join('\n');

  const summaryMatch = cleaned.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/i);
  if (!summaryMatch) return undefined;

  return summaryMatch[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();
}
