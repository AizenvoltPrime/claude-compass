import Parser from 'tree-sitter';

export function extractJSDocComment(node: Parser.SyntaxNode, content: string): string | undefined {
  let targetNode = node;

  // If node is variable_declarator, move up to lexical_declaration/variable_declaration
  // JSDoc is sibling of the declaration, not the declarator
  if (node.type === 'variable_declarator' && node.parent) {
    targetNode = node.parent;
  }

  // If node is inside an export_statement, look at export's siblings instead
  if (targetNode.parent?.type === 'export_statement') {
    targetNode = targetNode.parent;
  } else if (targetNode.parent?.parent?.type === 'export_statement') {
    // Handle export const/let/var where node is inside lexical_declaration/variable_declaration
    targetNode = targetNode.parent.parent;
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

export function extractLeadingJSDocComment(rootNode: Parser.SyntaxNode, content: string): string | undefined {
  if (!rootNode || rootNode.childCount === 0) return undefined;

  for (let i = 0; i < Math.min(rootNode.childCount, 10); i++) {
    const child = rootNode.child(i);
    if (!child) continue;

    if (child.type === 'comment') {
      const commentText = content.slice(child.startIndex, child.endIndex);
      if (commentText.trim().startsWith('/**')) {
        return cleanJSDocComment(commentText);
      }
    }

    if (child.type !== 'comment' && child.type !== '\n' && child.type !== 'whitespace') {
      break;
    }
  }

  return undefined;
}

export function extractDescriptionOnly(jsdocText: string): string {
  const lines = jsdocText.split('\n');
  const descriptionLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@')) {
      break;
    }
    if (trimmed) {
      descriptionLines.push(trimmed);
    }
  }

  return descriptionLines.join(' ').trim();
}
