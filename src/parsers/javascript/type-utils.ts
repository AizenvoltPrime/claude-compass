import Parser from 'tree-sitter';
import { ParsedDependency } from '../base';
import { DependencyType } from '../../database/models';

export function extractStateFieldTypes(
  defineStoreNode: Parser.SyntaxNode,
  storeName: string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  const argsNode = defineStoreNode.children.find(c => c.type === 'arguments');
  if (!argsNode) return dependencies;

  const optionsArg = argsNode.namedChildren[1];
  if (!optionsArg || optionsArg.type !== 'object') {
    return dependencies;
  }

  for (const prop of optionsArg.namedChildren) {
    if (prop.type !== 'pair') continue;

    const key = prop.child(0);
    if (key?.text !== 'state') continue;

    const value = prop.child(2);
    if (!value || value.type !== 'arrow_function') continue;

    const body = value.child(value.childCount - 1);
    if (!body) continue;

    const stateObject = body.type === 'parenthesized_expression'
      ? body.child(1)
      : body;

    if (stateObject?.type !== 'object') continue;

    for (const stateProp of stateObject.namedChildren) {
      if (stateProp.type !== 'pair') continue;

      const propValue = stateProp.child(2);
      if (!propValue) continue;

      const types = extractTypeAssertions(propValue);

      for (const typeName of types) {
        dependencies.push({
          from_symbol: storeName,
          to_symbol: typeName,
          dependency_type: DependencyType.REFERENCES,
          line_number: propValue.startPosition.row + 1,
        });
      }
    }
  }

  return dependencies;
}

export function extractTypeAssertions(node: Parser.SyntaxNode): string[] {
  const types: string[] = [];

  if (node.type === 'as_expression') {
    const typeNode = node.child(2);
    if (typeNode) {
      const typeName = normalizeTypeName(typeNode.text);
      if (typeName) types.push(typeName);
    }
  }

  for (const child of node.children) {
    types.push(...extractTypeAssertions(child));
  }

  return types;
}

export function normalizeTypeName(rawType: string): string | null {
  let typeName = rawType.trim();

  const builtIns = ['string', 'number', 'boolean', 'any', 'unknown', 'void', 'null', 'undefined'];
  if (builtIns.includes(typeName.toLowerCase())) {
    return null;
  }

  typeName = typeName.replace(/\[\]$/, '');

  const arrayGenericMatch = typeName.match(/^Array<(.+)>$/);
  if (arrayGenericMatch) {
    typeName = arrayGenericMatch[1];
  }

  typeName = typeName.replace(/^readonly\s+/, '');

  if (typeName.includes('|')) {
    const parts = typeName.split('|').map(p => p.trim());
    for (const part of parts) {
      if (!builtIns.includes(part.toLowerCase())) {
        typeName = part;
        break;
      }
    }
  }

  return typeName || null;
}
