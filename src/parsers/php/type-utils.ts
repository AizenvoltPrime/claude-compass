import Parser from 'tree-sitter';
import { ParsedImport } from '../base';
import { PHP_CLOSURE_NODE_TYPES, PHPParsingContext, MAX_PARAMETER_LENGTH } from './types';

/**
 * Check if type is a built-in PHP type (not a class)
 */
export function isBuiltInType(type: string): boolean {
  const builtIns = new Set([
    'string', 'int', 'float', 'bool', 'array', 'object',
    'mixed', 'void', 'null', 'callable', 'iterable',
    'self', 'parent', 'static', 'never', 'true', 'false'
  ]);
  return builtIns.has(type.toLowerCase());
}

/**
 * Resolve fully qualified name for a class using use statements and namespace context
 */
export function resolveFQN(className: string, context: PHPParsingContext): string {
  if (className.startsWith('\\')) {
    return className;
  }

  for (const useStmt of context.useStatements) {
    if (!useStmt.imported_names) continue;

    for (const imported of useStmt.imported_names) {
      const parts = imported.split('\\');
      const lastPart = parts[parts.length - 1];

      if (lastPart === className || imported === className) {
        return imported;
      }

      if (imported.endsWith(`\\${className}`)) {
        return imported;
      }
    }
  }

  if (context.currentNamespace) {
    return `${context.currentNamespace}\\${className}`;
  }

  return className;
}

/**
 * Resolve PHP type from object expression using type map
 */
export function resolvePhpType(
  objectExpression: string,
  typeMap: Map<string, string>,
  context: { parentClass: string | null; currentClass: string | null }
): string | undefined {
  if (!objectExpression) return undefined;

  const cleanedObject = objectExpression.replace(/^\$this->/, '').replace(/^\$/, '');

  if (objectExpression === '$this' || objectExpression === 'this') {
    return context.currentClass || undefined;
  }

  if (objectExpression === 'self' || objectExpression === 'static') {
    return context.currentClass || undefined;
  }

  if (objectExpression === 'parent') {
    return context.parentClass || undefined;
  }

  return typeMap.get(cleanedObject);
}

/**
 * Infer parameter type from AST node
 */
export function inferParameterType(
  node: Parser.SyntaxNode,
  content: string,
  typeMap: Map<string, string>,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  if (isClosureOrAnonymousFunction(node)) {
    return 'callable';
  }

  switch (node.type) {
    case 'integer':
      return 'int';
    case 'float':
      return 'float';
    case 'string':
    case 'encapsed_string':
      return 'string';
    case 'true':
    case 'false':
      return 'bool';
    case 'null':
      return 'null';
    case 'array_creation_expression':
      return 'array';
    case 'object_creation_expression':
      const classNode = node.childForFieldName('class');
      if (classNode) {
        return getNodeText(classNode, content);
      }
      return 'object';
    case 'variable_name':
    case 'variable':
      const varName = getNodeText(node, content).replace('$', '');
      return typeMap.get(varName) || 'mixed';
    default:
      return 'mixed';
  }
}

/**
 * Track property types from property declarations
 */
export function trackPropertyTypes(
  node: Parser.SyntaxNode,
  content: string,
  typeMap: Map<string, string>,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string,
  findNodesOfType: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[],
  extractPhpDocComment: (node: Parser.SyntaxNode, content: string) => string | undefined
): void {
  const typeNode = node.childForFieldName('type');
  const propertyElements = findNodesOfType(node, 'property_element');

  let typeName: string | null = null;
  if (typeNode) {
    typeName = getNodeText(typeNode, content);
  } else {
    const docComment = extractPhpDocComment(node, content);
    if (docComment) {
      const varMatch = docComment.match(/@var\s+([^\s]+)/);
      if (varMatch) {
        typeName = varMatch[1];
      }
    }
  }

  if (typeName) {
    for (const element of propertyElements) {
      const nameNode = element.childForFieldName('name');
      if (nameNode) {
        const propertyName = getNodeText(nameNode, content).replace('$', '');
        typeMap.set(propertyName, typeName);
      }
    }
  }
}

/**
 * Track constructor parameter types for dependency injection
 */
export function trackConstructorParameterTypes(
  node: Parser.SyntaxNode,
  content: string,
  typeMap: Map<string, string>,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): void {
  const parametersNode = node.childForFieldName('parameters');
  if (!parametersNode) return;

  for (const param of parametersNode.children) {
    if (param.type !== 'simple_parameter' && param.type !== 'property_promotion_parameter') continue;

    const typeNode = param.childForFieldName('type');
    const nameNode = param.childForFieldName('name');

    if (typeNode && nameNode) {
      const typeName = getNodeText(typeNode, content);
      const paramName = getNodeText(nameNode, content).replace('$', '');
      typeMap.set(paramName, typeName);
    }
  }
}

/**
 * Track property assignments to infer types
 */
export function trackPropertyAssignment(
  node: Parser.SyntaxNode,
  content: string,
  typeMap: Map<string, string>,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): void {
  const leftNode = node.childForFieldName('left');
  const rightNode = node.childForFieldName('right');

  if (!leftNode || !rightNode) return;

  if (leftNode.type === 'member_access_expression') {
    const objectNode = leftNode.childForFieldName('object');
    const nameNode = leftNode.childForFieldName('name');

    if (!objectNode || !nameNode) return;

    const objectText = getNodeText(objectNode, content);
    if (objectText !== '$this') return;

    const propertyName = getNodeText(nameNode, content);

    if (rightNode.type === 'object_creation_expression') {
      const classNode = rightNode.namedChild(0);
      if (classNode && (classNode.type === 'name' || classNode.type === 'qualified_name')) {
        let className = getNodeText(classNode, content);

        if (classNode.type === 'qualified_name') {
          const parts = className.split('\\');
          className = parts[parts.length - 1];
        }

        typeMap.set(propertyName, className);
      }
    }
  }
}

/**
 * Check if node is a closure or anonymous function
 */
export function isClosureOrAnonymousFunction(node: Parser.SyntaxNode): boolean {
  return PHP_CLOSURE_NODE_TYPES.has(node.type);
}

/**
 * Extract closure use clause
 */
export function extractClosureUseClause(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string | null {
  if (!PHP_CLOSURE_NODE_TYPES.has(node.type)) {
    return null;
  }

  for (const child of node.children) {
    if (child.type === 'anonymous_function_use_clause') {
      const useText = getNodeText(child, content);
      return useText.replace(/^use\s*\(\s*/, '').replace(/\s*\)\s*$/, '');
    }
  }

  return null;
}

/**
 * Find closure node within a node tree
 */
export function findClosureInNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  if (isClosureOrAnonymousFunction(node)) {
    return node;
  }

  for (const child of node.children) {
    if (isClosureOrAnonymousFunction(child)) {
      return child;
    }
  }

  return null;
}

/**
 * Get parameter representation for dependency tracking
 */
export function getParameterRepresentation(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  if (isClosureOrAnonymousFunction(node)) {
    const useClause = extractClosureUseClause(node, content, getNodeText);
    return useClause ? `function() use (${useClause})` : 'closure';
  }

  const closureChild = findClosureInNode(node);
  if (closureChild) {
    const useClause = extractClosureUseClause(closureChild, content, getNodeText);
    return useClause ? `function() use (${useClause})` : 'closure';
  }

  const value = getNodeText(node, content);

  if (value.length > MAX_PARAMETER_LENGTH) {
    return value.substring(0, MAX_PARAMETER_LENGTH) + '...';
  }

  return value;
}

/**
 * Extract call parameters with values and types
 */
export function extractCallParameters(
  node: Parser.SyntaxNode,
  content: string,
  typeMap: Map<string, string>,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): { values: string[]; types: string[] } {
  const argumentsNode = node.childForFieldName('arguments');
  const values: string[] = [];
  const types: string[] = [];

  if (!argumentsNode) return { values, types };

  for (const child of argumentsNode.children) {
    if (child.type === 'argument') {
      const valueNode = child.namedChild(0);
      if (valueNode) {
        const value = getParameterRepresentation(valueNode, content, getNodeText);
        values.push(value);

        const inferredType = inferParameterType(valueNode, content, typeMap, getNodeText);
        types.push(inferredType);
      }
    }
  }

  return { values, types };
}
