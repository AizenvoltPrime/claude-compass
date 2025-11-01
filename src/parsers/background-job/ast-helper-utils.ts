import Parser from 'tree-sitter';
import { ParsedSymbol, ParsedDependency } from '../base';
import { SymbolType, DependencyType } from '../../database/models';

export function getFunctionNameFromCall(node: Parser.SyntaxNode, content: string): string | null {
  if (node.type !== 'call_expression') return null;
  const functionNode = node.children.find(
    child => child.type === 'identifier' || child.type === 'member_expression'
  );
  if (!functionNode) return null;

  const fullName = getNodeText(functionNode, content);
  // Extract method name from member expressions like 'queue.add'
  const parts = fullName.split('.');
  return parts[parts.length - 1];
}

export function getCallArguments(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const argumentsNode = node.children.find(child => child.type === 'arguments');
  if (!argumentsNode) return [];
  return argumentsNode.children.filter(
    child => child.type !== '(' && child.type !== ')' && child.type !== ','
  );
}

export function getStringLiteral(node: Parser.SyntaxNode, content: string): string | null {
  if (node.type !== 'string') return null;
  const text = getNodeText(node, content);
  return text.slice(1, -1); // Remove quotes
}

export function getNodeText(node: Parser.SyntaxNode, content: string): string {
  return content.substring(node.startIndex, node.endIndex);
}

export function getLineNumber(index: number, content: string): number {
  return content.substring(0, index).split('\n').length;
}

export function extractFunctionSymbol(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  getLineNumberFn: (index: number, content: string) => number
): ParsedSymbol | null {
  const nameNode = node.children.find(child => child.type === 'identifier');
  if (!nameNode) return null;

  const name = getNodeTextFn(nameNode, content);
  return {
    name,
    symbol_type: SymbolType.FUNCTION,
    start_line: getLineNumberFn(node.startIndex, content),
    end_line: getLineNumberFn(node.endIndex, content),
    is_exported: false,
    signature: `function ${name}(...)`,
  };
}

export function extractVariableSymbol(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  getLineNumberFn: (index: number, content: string) => number
): ParsedSymbol | null {
  const nameNode = node.children.find(child => child.type === 'identifier');
  if (!nameNode) return null;

  const name = getNodeTextFn(nameNode, content);
  return {
    name,
    symbol_type: SymbolType.VARIABLE,
    start_line: getLineNumberFn(node.startIndex, content),
    end_line: getLineNumberFn(node.endIndex, content),
    is_exported: false,
    signature: `var ${name}`,
  };
}

export function extractCallDependency(
  node: Parser.SyntaxNode,
  content: string,
  getFunctionNameFromCallFn: (node: Parser.SyntaxNode, content: string) => string | null,
  getLineNumberFn: (index: number, content: string) => number
): ParsedDependency | null {
  const functionName = getFunctionNameFromCallFn(node, content);
  if (!functionName) return null;

  return {
    from_symbol: 'current_function',
    to_symbol: functionName,
    dependency_type: DependencyType.CALLS,
    line_number: getLineNumberFn(node.startIndex, content),
  };
}

export function extractImportInfo(
  node: Parser.SyntaxNode,
  content: string,
  getLineNumberFn: (index: number, content: string) => number
): any {
  return {
    source: 'unknown',
    imported_names: [],
    import_type: 'named',
    line_number: getLineNumberFn(node.startIndex, content),
    is_dynamic: false,
  };
}

export function extractExportInfo(
  node: Parser.SyntaxNode,
  content: string,
  getLineNumberFn: (index: number, content: string) => number
): any {
  return {
    exported_names: [],
    export_type: 'named',
    line_number: getLineNumberFn(node.startIndex, content),
  };
}
