import Parser from 'tree-sitter';
import { ASTContext } from './types';

/**
 * Find child node by type (recursive search)
 */
export function findChildByType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === type) {
      return child;
    }
    // Recursively search in children
    const found = findChildByType(child!, type);
    if (found) return found;
  }
  return null;
}

/**
 * Find first node of given type (non-recursive, direct children only)
 */
export function findNodeOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) return child;
  }
  return null;
}

/**
 * Find all nodes of given type (recursive search)
 */
export function findNodesOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
  const nodes: Parser.SyntaxNode[] = [];

  const traverse = (n: Parser.SyntaxNode) => {
    if (n.type === type) {
      nodes.push(n);
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) traverse(child);
    }
  };

  traverse(node);
  return nodes;
}

/**
 * Find the containing method/constructor/property for a given node
 */
export function findContainingMethod(
  node: Parser.SyntaxNode,
  context: ASTContext,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  buildQualifiedNameFn: (context: ASTContext, name: string) => string
): string {
  let parent = node.parent;

  while (parent) {
    if (
      parent.type === 'method_declaration' ||
      parent.type === 'constructor_declaration' ||
      parent.type === 'property_declaration'
    ) {
      const nameNode = parent.childForFieldName('name');
      if (nameNode) {
        const methodName = getNodeTextFn(nameNode, content);
        return buildQualifiedNameFn(context, methodName);
      }
    }
    parent = parent.parent;
  }

  return '';
}

/**
 * Find parent class/interface/struct declaration
 */
export function findParentDeclaration(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let parent = node.parent;

  while (parent) {
    if (
      parent.type === 'class_declaration' ||
      parent.type === 'interface_declaration' ||
      parent.type === 'struct_declaration'
    ) {
      return parent;
    }
    parent = parent.parent;
  }

  return null;
}

/**
 * Check if node is inside an interface declaration
 */
export function isInsideInterface(node: Parser.SyntaxNode): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'interface_declaration') {
      return true;
    }
    // Stop at class or struct declarations
    if (current.type === 'class_declaration' || current.type === 'struct_declaration') {
      return false;
    }
    current = current.parent;
  }
  return false;
}
