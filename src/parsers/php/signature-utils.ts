import Parser from 'tree-sitter';
import { MODIFIER_KEYWORDS } from './types';

/**
 * Build qualified name from namespace and class context
 */
export function buildQualifiedName(
  context: { currentNamespace: string | null; currentClass: string | null },
  name: string
): string {
  const parts: string[] = [];

  if (context.currentNamespace) {
    parts.push(context.currentNamespace);
  }

  if (context.currentClass && context.currentClass !== name) {
    parts.push(context.currentClass);
  }

  parts.push(name);

  return parts.join('\\');
}

/**
 * Extract modifiers from a node
 */
export function extractModifiers(node: Parser.SyntaxNode): string[] {
  const modifiers: string[] = [];

  for (const child of node.children) {
    if (child.type === 'visibility_modifier' && child.childCount > 0) {
      const visibilityType = child.child(0)?.type;
      if (visibilityType && MODIFIER_KEYWORDS.has(visibilityType)) {
        modifiers.push(visibilityType);
      }
    } else if (MODIFIER_KEYWORDS.has(child.type)) {
      modifiers.push(child.type);
    }
  }

  return modifiers;
}

/**
 * Build method signature string
 */
export function buildMethodSignature(
  name: string,
  modifiers: string[],
  params: string,
  returnType: string | null = null
): string {
  const modifierString = modifiers.length > 0 ? modifiers.join(' ') + ' ' : '';
  const returnTypeString = returnType ? `: ${returnType}` : '';
  return `${modifierString}function ${name}${params}${returnTypeString}`;
}

/**
 * Extract class signature including extends and implements clauses
 */
export function extractClassSignature(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  const nameNode = node.childForFieldName('name');
  let signature = '';

  if (nameNode) {
    signature += getNodeText(nameNode, content);
  }

  // Check for extends clause
  const extendsNode = node.childForFieldName('base_clause');
  if (extendsNode) {
    signature += ' extends ' + getNodeText(extendsNode, content);
  }

  // Check for implements clause
  const implementsNode = node.childForFieldName('implements_clause');
  if (implementsNode) {
    signature += ' implements ' + getNodeText(implementsNode, content);
  }

  return signature;
}

/**
 * Extract function signature including parameters and return type
 */
export function extractFunctionSignature(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  const nameNode = node.childForFieldName('name');
  const parametersNode = node.childForFieldName('parameters');
  const returnTypeNode = node.childForFieldName('return_type');

  let signature = '';
  if (nameNode) {
    signature += getNodeText(nameNode, content);
  }

  if (parametersNode) {
    signature += getNodeText(parametersNode, content);
  }

  if (returnTypeNode) {
    signature += ': ' + getNodeText(returnTypeNode, content);
  }

  return signature;
}
