import Parser from 'tree-sitter';
import { Visibility } from '../../database/models';
import { PHP_CALL_PATTERNS } from './types';

/**
 * Extract visibility modifier from a node
 */
export function extractVisibility(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string,
  findNodesOfType: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): Visibility {
  // Look for visibility modifiers in the node
  const modifiers = findNodesOfType(node, 'visibility_modifier');
  for (const modifier of modifiers) {
    const modifierText = getNodeText(modifier, content);
    switch (modifierText) {
      case 'private':
        return Visibility.PRIVATE;
      case 'protected':
        return Visibility.PROTECTED;
      case 'public':
        return Visibility.PUBLIC;
    }
  }

  // Default to public if no modifier found
  return Visibility.PUBLIC;
}

/**
 * Extract base classes from a class declaration
 */
export function extractBaseClasses(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string[] {
  const baseClasses: string[] = [];

  /**
   * Manual iteration required because Tree-sitter's PHP grammar doesn't expose
   * base_clause as a named field. The childForFieldName('base_clause') approach
   * doesn't work - we must iterate through namedChildren to find nodes with
   * type === 'base_clause'. This is a limitation of the php-tree-sitter grammar.
   */
  let baseClauseNode: Parser.SyntaxNode | null = null;
  for (const child of node.namedChildren) {
    if (child.type === 'base_clause') {
      baseClauseNode = child;
      break;
    }
  }

  if (baseClauseNode) {
    // Iterate through children to find class name nodes
    for (const child of baseClauseNode.children) {
      if (child.type === 'name' || child.type === 'qualified_name' || child.type === 'namespace_name') {
        const className = getNodeText(child, content).trim();
        if (className) {
          baseClasses.push(className);
        }
      }
    }

    // Fallback: if no named children found, get the full text and clean it
    if (baseClasses.length === 0) {
      const fullText = getNodeText(baseClauseNode, content).replace(/^extends\s+/, '').trim();
      if (fullText) {
        baseClasses.push(fullText);
      }
    }
  }

  return baseClasses;
}

/**
 * Extract parent class from a class node
 */
export function extractParentClass(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string | null {
  const baseClauseNode = node.childForFieldName('base_clause');
  if (!baseClauseNode) return null;

  const nameNode = baseClauseNode.childForFieldName('name');
  if (!nameNode) return null;

  return getNodeText(nameNode, content);
}

/**
 * Find the containing function or method for a node
 */
export function findContainingFunction(
  callNode: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  let parent = callNode.parent;

  while (parent) {
    if (parent.type === 'function_definition' || parent.type === 'method_declaration') {
      const nameNode = parent.childForFieldName('name');
      if (nameNode) return getNodeText(nameNode, content);
    }
    parent = parent.parent;
  }

  return 'global';
}

/**
 * Extract calling object from a member call expression
 */
export function extractCallingObject(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  const objectNode = node.childForFieldName('object');
  if (!objectNode) return '';

  return getNodeText(objectNode, content);
}

/**
 * Generate qualified context for a method call
 */
export function generateQualifiedContext(
  namespace: string | null,
  currentClass: string | null,
  callingObject: string,
  methodName: string
): string {
  const { namespaceOperator, staticAccessOperator, instanceAccessOperator, newOperator, staticCallSuffix } = PHP_CALL_PATTERNS;

  let context = '';

  if (namespace && currentClass) {
    context = `${namespace}${namespaceOperator}${currentClass}`;
  } else if (currentClass) {
    context = currentClass;
  }

  if (callingObject && callingObject.trim()) {
    const cleanedObject = callingObject.trim();

    if (cleanedObject === newOperator) {
      return methodName ? `${newOperator} ${methodName}` : newOperator;
    }

    if (cleanedObject.endsWith(staticCallSuffix)) {
      const staticClass = cleanedObject.slice(0, -staticCallSuffix.length);
      return methodName ? `${staticClass}${staticAccessOperator}${methodName}` : staticClass;
    }
    else if (isInstanceCall(cleanedObject)) {
      if (context) {
        return `${context}${staticAccessOperator}${cleanedObject}${instanceAccessOperator}${methodName}`;
      } else {
        return `${cleanedObject}${instanceAccessOperator}${methodName}`;
      }
    }
    else {
      if (context) {
        return `${context}${staticAccessOperator}${cleanedObject}${staticAccessOperator}${methodName}`;
      } else {
        return `${cleanedObject}${staticAccessOperator}${methodName}`;
      }
    }
  }

  if (methodName && !callingObject) {
    if (context) {
      return `${context}${staticAccessOperator}${methodName}`;
    } else {
      return methodName;
    }
  }

  return context;
}

/**
 * Check if calling object represents an instance call
 */
export function isInstanceCall(callingObject: string): boolean {
  const { instanceCallPrefixes, instanceAccessOperator } = PHP_CALL_PATTERNS;

  return instanceCallPrefixes.some(prefix => callingObject.startsWith(prefix)) ||
         callingObject.includes(instanceAccessOperator);
}

/**
 * Generate unique call instance ID
 */
export function generateCallInstanceId(
  currentClass: string | null,
  methodName: string,
  row: number,
  column: number
): string {
  const className = currentClass || 'global';
  return `${className}_${methodName}_${row}_${column}`;
}
