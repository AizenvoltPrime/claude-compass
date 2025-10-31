import { DependencyType } from '../../database/models';
import { SymbolNode, SymbolGraphData } from './types';

export function getCallers(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
  const callerIds = symbolGraph.edges
    .filter(edge => edge.to === symbolId && edge.type === DependencyType.CALLS)
    .map(edge => edge.from);

  return symbolGraph.nodes.filter(node => callerIds.includes(node.id));
}

export function getCalls(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
  const callIds = symbolGraph.edges
    .filter(edge => edge.from === symbolId && edge.type === DependencyType.CALLS)
    .map(edge => edge.to);

  return symbolGraph.nodes.filter(node => callIds.includes(node.id));
}

export function getImplementations(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
  const implementationIds = symbolGraph.edges
    .filter(
      edge =>
        edge.to === symbolId &&
        (edge.type === DependencyType.INHERITS || edge.type === DependencyType.IMPLEMENTS)
    )
    .map(edge => edge.from);

  return symbolGraph.nodes.filter(node => implementationIds.includes(node.id));
}

export function getParents(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
  const parentIds = symbolGraph.edges
    .filter(
      edge =>
        edge.from === symbolId &&
        (edge.type === DependencyType.INHERITS || edge.type === DependencyType.IMPLEMENTS)
    )
    .map(edge => edge.to);

  return symbolGraph.nodes.filter(node => parentIds.includes(node.id));
}

export function calculateCallDepth(symbolId: number, symbolGraph: SymbolGraphData): number {
  const visited = new Set<number>();
  const stack = [{ id: symbolId, depth: 0 }];
  let maxDepth = 0;

  while (stack.length > 0) {
    const { id, depth } = stack.pop()!;

    if (visited.has(id)) continue;
    visited.add(id);

    maxDepth = Math.max(maxDepth, depth);

    const calls = getCalls(id, symbolGraph);
    for (const call of calls) {
      if (!visited.has(call.id)) {
        stack.push({ id: call.id, depth: depth + 1 });
      }
    }
  }

  return maxDepth;
}
