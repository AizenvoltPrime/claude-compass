import { SymbolEdge } from './types';

export function parseQualifiedName(name: string): { qualifier?: string; memberName: string } {
  const lastDotIndex = name.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return { memberName: name };
  }
  return {
    qualifier: name.substring(0, lastDotIndex),
    memberName: name.substring(lastDotIndex + 1)
  };
}

export function stripGenericParameters(name: string): string {
  const genericStart = name.indexOf('<');
  if (genericStart === -1) {
    return name;
  }
  return name.substring(0, genericStart);
}

export function removeDuplicateEdges(edges: SymbolEdge[]): SymbolEdge[] {
  const seen = new Set<string>();
  const uniqueEdges: SymbolEdge[] = [];

  for (const edge of edges) {
    const key = `${edge.from}-${edge.to}-${edge.type}-${edge.lineNumber}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEdges.push(edge);
    }
  }

  return uniqueEdges;
}
