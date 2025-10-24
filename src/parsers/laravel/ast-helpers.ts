import { SyntaxNode } from 'tree-sitter';

export function traverseNode(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
  callback(node);
  for (const child of node.children) {
    traverseNode(child, callback);
  }
}

export function traverseGroupChildren(
  node: SyntaxNode,
  callback: (node: SyntaxNode) => boolean
): void {
  const shouldContinue = callback(node);
  if (shouldContinue) {
    for (const child of node.children) {
      traverseGroupChildren(child, callback);
    }
  }
}

export function findArgumentsNode(node: SyntaxNode): SyntaxNode | null {
  for (const child of node.children) {
    if (child.type === 'arguments') {
      return child;
    }
  }
  return null;
}

export function getArrayElements(arrayNode: SyntaxNode, content: string): string[] {
  const elements: string[] = [];

  for (const child of arrayNode.children) {
    if (child.type === 'array_element_initializer') {
      const elementText = child.text;

      if (elementText.includes('::class')) {
        const className = elementText.replace('::class', '');
        elements.push(className);
      } else if (elementText.startsWith("'") && elementText.endsWith("'")) {
        elements.push(elementText.slice(1, -1));
      } else if (elementText.startsWith('"') && elementText.endsWith('"')) {
        elements.push(elementText.slice(1, -1));
      } else {
        elements.push(elementText);
      }
    }
  }

  return elements;
}

export function getClassName(node: SyntaxNode, content: string): string | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;
  return content.slice(nameNode.startIndex, nameNode.endIndex);
}

export function findNodesByType(node: SyntaxNode, type: string): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];

  const traverse = (currentNode: SyntaxNode) => {
    if (currentNode.type === type) {
      nodes.push(currentNode);
    }

    for (let i = 0; i < currentNode.childCount; i++) {
      const child = currentNode.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(node);
  return nodes;
}

export function findMethodByName(node: SyntaxNode, methodName: string): SyntaxNode | null {
  if (node.type === 'method_declaration') {
    const nameNode = node.childForFieldName('name');
    if (nameNode?.text === methodName) {
      return node;
    }
  }

  for (const child of node.children) {
    const result = findMethodByName(child, methodName);
    if (result) return result;
  }

  return null;
}

export function findReturnStatement(methodNode: SyntaxNode): SyntaxNode | null {
  const body = methodNode.childForFieldName('body');
  if (!body) return null;

  for (const child of body.children) {
    if (child.type === 'return_statement') {
      return child;
    }
    const nested = findReturnStatement(child);
    if (nested) return nested;
  }

  return null;
}

export function findChildByType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.children) {
    if (child.type === type) return child;
    const nested = findChildByType(child, type);
    if (nested) return nested;
  }
  return null;
}

export function extractLaravelStringLiteral(node: SyntaxNode, content: string): string {
  const text = content.substring(node.startIndex, node.endIndex);
  return text.replace(/^['"]|['"]$/g, '');
}

export function getClassNamespace(content: string): string | null {
  const namespaceMatch = content.match(/namespace\s+([^;]+);/);
  return namespaceMatch ? namespaceMatch[1] : null;
}

export function getMethodName(node: SyntaxNode, content: string): string | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;
  return content.slice(nameNode.startIndex, nameNode.endIndex);
}

export function isPublicMethod(node: SyntaxNode, content: string): boolean {
  // Check for explicit visibility modifiers
  for (const child of node.children) {
    if (child.type === 'visibility_modifier') {
      const modifier = content.slice(child.startIndex, child.endIndex);
      return modifier === 'public';
    }
  }

  // If no explicit modifier, PHP defaults to public for methods
  return true;
}
