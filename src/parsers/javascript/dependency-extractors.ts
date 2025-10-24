import Parser from 'tree-sitter';
import { ParsedDependency, ParsedSymbol } from '../base';
import { DependencyType } from '../../database/models';
import { COMPONENT_RENDER_FUNCTIONS } from './types';
import { extractComponentReference, findContainingFunction } from './helper-utils';

export function extractCallDependency(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedDependency | null {
  const functionNode = node.childForFieldName('function');
  if (!functionNode) return null;

  let functionName: string;

  if (functionNode.type === 'identifier') {
    functionName = getNodeText(functionNode, content);

    if (COMPONENT_RENDER_FUNCTIONS.has(functionName)) {
      const componentRef = extractComponentReference(node, content, getNodeText);
      if (componentRef) {
        const callerName = findContainingFunction(node, getNodeText);
        return {
          from_symbol: callerName,
          to_symbol: componentRef.name,
          dependency_type: DependencyType.REFERENCES,
          line_number: componentRef.lineNumber,
        };
      }
    }
  } else if (functionNode.type === 'member_expression') {
    const objectNode = functionNode.childForFieldName('object');
    const propertyNode = functionNode.childForFieldName('property');

    if (objectNode && propertyNode) {
      const objectName = getNodeText(objectNode, content);
      const propertyName = getNodeText(propertyNode, content);

      if (objectName === 'React' && propertyName === 'createElement') {
        const componentRef = extractComponentReference(node, content, getNodeText);
        if (componentRef) {
          const callerName = findContainingFunction(node, getNodeText);
          return {
            from_symbol: callerName,
            to_symbol: componentRef.name,
            dependency_type: DependencyType.REFERENCES,
            line_number: componentRef.lineNumber,
          };
        }
      }
    }

    if (!propertyNode) return null;

    functionName = getNodeText(functionNode, content);
  } else {
    return null;
  }

  const callerName = findContainingFunction(node, getNodeText);

  return {
    from_symbol: callerName,
    to_symbol: functionName,
    dependency_type: DependencyType.CALLS,
    line_number: node.startPosition.row + 1,
  };
}

export function extractContainmentDependencies(symbols: ParsedSymbol[]): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  const childCandidates = symbols.filter(
    s => s.symbol_type === 'function' || s.symbol_type === 'method'
  );

  const parentCandidates = symbols.filter(
    s => s.symbol_type === 'function' ||
         s.symbol_type === 'method' ||
         s.symbol_type === 'class' ||
         s.entity_type === 'store' ||
         s.entity_type === 'composable' ||
         s.entity_type === 'component'
  );

  if (childCandidates.length === 0 || parentCandidates.length === 0) return dependencies;

  for (const child of childCandidates) {
    for (const parent of parentCandidates) {
      if (child === parent) continue;

      if (!child.start_line || !child.end_line || !parent.start_line || !parent.end_line) {
        continue;
      }

      const isContained =
        parent.start_line < child.start_line &&
        parent.end_line > child.end_line;

      if (isContained) {
        const hasIntermediateParent = parentCandidates.some(intermediate => {
          if (intermediate === parent || intermediate === child) return false;
          if (!intermediate.start_line || !intermediate.end_line) return false;

          const intermediateContainsChild =
            intermediate.start_line < child.start_line &&
            intermediate.end_line > child.end_line;

          const parentContainsIntermediate =
            parent.start_line < intermediate.start_line &&
            parent.end_line > intermediate.end_line;

          return intermediateContainsChild && parentContainsIntermediate;
        });

        if (!hasIntermediateParent) {
          dependencies.push({
            from_symbol: parent.name,
            to_symbol: child.name,
            dependency_type: DependencyType.CONTAINS,
            line_number: child.start_line,
          });
        }
      }
    }
  }

  return dependencies;
}
