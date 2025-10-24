import Parser from 'tree-sitter';
import {
  MAX_VARIABLE_VALUE_LENGTH,
  MAX_CALL_SIGNATURE_LENGTH,
  MAX_ARGUMENT_TEXT_LENGTH,
  ELLIPSIS_LENGTH,
  MODIFIER_KEYWORDS,
} from './types';

export function extractFunctionSignature(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  const nameNode = node.childForFieldName('name');
  const parametersNode = node.childForFieldName('parameters');

  let signature = '';
  if (nameNode) {
    signature += getNodeText(nameNode, content);
  }

  if (parametersNode) {
    signature += getNodeText(parametersNode, content);
  }

  return signature;
}

export function buildArrowFunctionSignature(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  let signature = '';

  for (const child of node.children) {
    if (child.type === 'async') {
      signature += 'async ';
      break;
    }
  }

  const paramsNode = node.childForFieldName('parameters');
  if (paramsNode) {
    signature += getNodeText(paramsNode, content);
  } else {
    for (const child of node.children) {
      if (child.type === 'identifier') {
        signature += getNodeText(child, content);
        break;
      }
    }
  }

  signature += ' => ';

  const bodyNode = node.childForFieldName('body');
  if (bodyNode) {
    if (bodyNode.type === 'statement_block') {
      signature += '{...}';
    } else {
      signature += '...';
    }
  }

  return signature;
}

export function buildFunctionExpressionSignature(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  let signature = '';

  for (const child of node.children) {
    if (child.type === 'async') {
      signature += 'async ';
      break;
    }
  }

  signature += 'function';

  const nameNode = node.childForFieldName('name');
  if (nameNode) {
    signature += ' ' + getNodeText(nameNode, content);
  }

  const paramsNode = node.childForFieldName('parameters');
  if (paramsNode) {
    signature += getNodeText(paramsNode, content);
  }

  return signature;
}

export function buildCallExpressionSignature(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string,
  maxLength: number = MAX_CALL_SIGNATURE_LENGTH
): string {
  const functionNode = node.childForFieldName('function');
  if (!functionNode) return '';

  let signature = getNodeText(functionNode, content);
  signature += '(';

  const argsNode = node.childForFieldName('arguments');
  if (argsNode) {
    const args: string[] = [];
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const arg = argsNode.namedChild(i);
      if (arg) {
        const argText = getNodeText(arg, content);
        if (argText.length > MAX_ARGUMENT_TEXT_LENGTH) {
          if (arg.type === 'string') {
            args.push('"..."');
          } else if (arg.type === 'object') {
            args.push('{...}');
          } else if (arg.type === 'array') {
            args.push('[...]');
          } else {
            args.push('...');
          }
        } else {
          args.push(argText);
        }
      }
    }
    signature += args.join(', ');
  }

  signature += ')';

  if (signature.length > maxLength) {
    signature = signature.substring(0, maxLength - ELLIPSIS_LENGTH) + '...';
  }

  return signature;
}

export function extractModifiers(node: Parser.SyntaxNode): string[] {
  const modifiers: string[] = [];

  for (const child of node.children) {
    if (MODIFIER_KEYWORDS.has(child.type)) {
      modifiers.push(child.type);
    }
  }

  return modifiers;
}

export function buildMethodSignature(name: string, modifiers: string[], params: string): string {
  const modifierString = modifiers.length > 0 ? modifiers.join(' ') + ' ' : '';
  return `${modifierString}${name}${params}`;
}

export function buildVariableSignature(
  valueNode: Parser.SyntaxNode | null,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string | undefined {
  if (!valueNode) return undefined;

  if (valueNode.type === 'arrow_function') {
    return buildArrowFunctionSignature(valueNode, content, getNodeText);
  } else if (valueNode.type === 'function_expression') {
    return buildFunctionExpressionSignature(valueNode, content, getNodeText);
  } else if (valueNode.type === 'call_expression') {
    return buildCallExpressionSignature(valueNode, content, getNodeText);
  } else if (valueNode.type === 'object') {
    return '{...}';
  } else if (valueNode.type === 'array') {
    return '[...]';
  } else {
    const valueText = getNodeText(valueNode, content);
    return valueText.length > MAX_VARIABLE_VALUE_LENGTH
      ? valueText.substring(0, MAX_VARIABLE_VALUE_LENGTH) + '...'
      : valueText;
  }
}
