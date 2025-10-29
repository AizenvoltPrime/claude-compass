import Parser from 'tree-sitter';
import { ParseError } from '../base';
import { ASTContext, MethodCall, GODOT_BASE_CLASSES } from './types';
import { findNodesOfType } from './traversal-utils';

/**
 * Build qualified name from context
 */
export function buildQualifiedName(context: ASTContext, name: string): string {
  const parts: string[] = [];

  if (context.currentNamespace) {
    parts.push(context.currentNamespace);
  }

  if (context.currentClass && context.currentClass !== name) {
    parts.push(context.currentClass);
  }

  parts.push(name);

  return parts.join('.');
}

/**
 * Generate unique call instance ID for tracking multiple calls on same line
 */
export function generateCallInstanceId(
  methodName: string,
  lineNumber: number,
  callInstanceCounters: Map<string, number>
): string {
  const key = `${methodName}_${lineNumber}`;
  const counter = callInstanceCounters.get(key) || 0;
  callInstanceCounters.set(key, counter + 1);
  return `${methodName}_${lineNumber}_${counter + 1}`;
}

/**
 * Build qualified context for method calls
 */
export function buildQualifiedContext(methodCall: MethodCall): string | undefined {
  if (!methodCall.resolvedClass) return undefined;
  if (!methodCall.callingObject) {
    return `${methodCall.resolvedClass}.${methodCall.methodName}`;
  }
  return `${methodCall.resolvedClass}.${methodCall.callingObject}->${methodCall.methodName}`;
}

/**
 * Check if node has specific attribute
 */
export function hasAttribute(
  node: Parser.SyntaxNode,
  attributeName: string,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): boolean {
  const attributes = findNodesOfType(node, 'attribute');
  return attributes.some(attr => {
    const text = getNodeTextFn(attr, content);
    return text.includes(attributeName);
  });
}

/**
 * Capture parse error from ERROR node
 */
export function captureParseError(node: Parser.SyntaxNode, content: string, errors: ParseError[]): void {
  const errorType = node.type === 'ERROR' ? 'Syntax error' : 'Parse error';
  const context = getErrorContext(node, content);

  errors.push({
    message: `${errorType} detected: ${context}`,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
    severity: 'error',
  });
}

/**
 * Get error context (snippet of code around error)
 */
export function getErrorContext(node: Parser.SyntaxNode, content: string): string {
  const lines = content.split('\n');
  const errorLine = node.startPosition.row;
  const line = lines[errorLine] || '';
  return line.substring(0, 100);
}

/**
 * Check if base types include Godot classes
 */
export function isGodotClass(baseTypes: string[]): boolean {
  return baseTypes.some(type => GODOT_BASE_CLASSES.has(type));
}
