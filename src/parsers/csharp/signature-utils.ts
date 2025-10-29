import Parser from 'tree-sitter';
import { Visibility } from '../../database/models';
import { ParameterInfo, MODIFIER_KEYWORDS } from './types';
import { isInsideInterface } from './traversal-utils';

/**
 * Extract modifiers from a declaration node
 */
export function extractModifiers(node: Parser.SyntaxNode): string[] {
  const modifiers: string[] = [];

  for (const child of node.children) {
    if (child.type === 'modifier' && child.childCount > 0) {
      const modifierType = child.child(0)?.type;
      if (modifierType && MODIFIER_KEYWORDS.has(modifierType)) {
        modifiers.push(modifierType);
      }
    } else if (MODIFIER_KEYWORDS.has(child.type)) {
      modifiers.push(child.type);
    }
  }

  return modifiers;
}

/**
 * Determine visibility from modifiers and context
 */
export function getVisibility(modifiers: string[], node?: Parser.SyntaxNode): Visibility {
  // Interface members are implicitly public in C#
  if (node && isInsideInterface(node)) {
    return Visibility.PUBLIC;
  }

  if (modifiers.includes('public')) return Visibility.PUBLIC;
  if (modifiers.includes('protected')) return Visibility.PROTECTED;
  if (modifiers.includes('internal')) return Visibility.PUBLIC; // Map internal to public for now
  return Visibility.PRIVATE;
}

/**
 * Extract base types from node
 */
export function extractBaseTypes(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string[] {
  const baseList = node.children.find(child => child.type === 'base_list');
  if (!baseList) return [];

  return extractBaseTypesFromList(baseList, content, getNodeTextFn);
}

/**
 * Extract base types from base_list node
 */
export function extractBaseTypesFromList(
  baseList: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string[] {
  const baseTypes: string[] = [];

  for (const child of baseList.children) {
    if (child.type === 'identifier' || child.type === 'qualified_name') {
      const typeName = getNodeTextFn(child, content).trim();
      if (typeName) baseTypes.push(typeName);
    }
  }

  return baseTypes;
}

/**
 * Extract return type from method declaration
 */
export function extractReturnType(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string {
  const typeNode = node.children.find(
    child =>
      child.type === 'predefined_type' ||
      child.type === 'identifier' ||
      child.type === 'qualified_name' ||
      child.type === 'generic_name' ||
      child.type === 'array_type' ||
      child.type === 'nullable_type'
  );

  return typeNode ? getNodeTextFn(typeNode, content) : 'void';
}

/**
 * Extract parameters from method/constructor declaration
 */
export function extractParameters(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): ParameterInfo[] {
  const parameters: ParameterInfo[] = [];
  const parameterList = node.childForFieldName('parameters');

  if (!parameterList) return parameters;

  for (let i = 0; i < parameterList.childCount; i++) {
    const child = parameterList.child(i);
    if (child?.type === 'parameter') {
      const typeNode = child.childForFieldName('type');
      const nameNode = child.childForFieldName('name');

      if (typeNode && nameNode) {
        const paramText = getNodeTextFn(child, content);
        parameters.push({
          name: getNodeTextFn(nameNode, content),
          type: getNodeTextFn(typeNode, content),
          isRef: paramText.includes('ref '),
          isOut: paramText.includes('out '),
          isParams: paramText.includes('params '),
        });
      }
    }
  }

  return parameters;
}

/**
 * Extract explicit interface qualifier from method declaration
 */
export function extractExplicitInterfaceQualifier(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string | null {
  const declarationText = getNodeTextFn(node, content);
  const explicitInterfacePattern = /\b(I[A-Z]\w+)\s*\.\s*\w+\s*\(/;
  const match = declarationText.match(explicitInterfacePattern);
  return match ? match[1] : null;
}

/**
 * Build class signature string
 */
export function buildClassSignature(name: string, modifiers: string[], baseTypes: string[]): string {
  const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
  const inheritance = baseTypes.length > 0 ? ` : ${baseTypes.join(', ')}` : '';
  return `${modifierString}class ${name}${inheritance}`;
}

/**
 * Build interface signature string
 */
export function buildInterfaceSignature(name: string, modifiers: string[], baseTypes: string[]): string {
  const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
  const inheritance = baseTypes.length > 0 ? ` : ${baseTypes.join(', ')}` : '';
  return `${modifierString}interface ${name}${inheritance}`;
}

/**
 * Build method signature string
 */
export function buildMethodSignature(
  name: string,
  modifiers: string[],
  returnType: string,
  parameters: ParameterInfo[]
): string {
  const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
  const paramString = parameters.map(p => `${p.type} ${p.name}`).join(', ');
  return `${modifierString}${returnType} ${name}(${paramString})`;
}

/**
 * Build constructor signature string
 */
export function buildConstructorSignature(
  name: string,
  modifiers: string[],
  parameters: ParameterInfo[]
): string {
  const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
  const paramString = parameters.map(p => `${p.type} ${p.name}`).join(', ');
  return `${modifierString}${name}(${paramString})`;
}
