import { DependencyType, SymbolType } from '../../database/models';
import { SymbolNode, SymbolGraphData, CallChain } from './types';
import { getCallers, getCalls, getParents } from './dependency-queries';

export function getCallChain(symbolId: number, symbolGraph: SymbolGraphData, maxDepth: number = 10): CallChain[] {
  const chains: CallChain[] = [];
  const visited = new Set<number>();

  const dfs = (currentId: number, currentChain: SymbolNode[], depth: number): void => {
    if (depth >= maxDepth || visited.has(currentId)) {
      return;
    }

    const currentSymbol = symbolGraph.nodes.find(n => n.id === currentId);
    if (!currentSymbol) return;

    const newChain = [...currentChain, currentSymbol];
    visited.add(currentId);

    const calls = getCalls(currentId, symbolGraph);

    if (calls.length === 0) {
      chains.push({
        symbols: newChain,
        depth: depth,
      });
    } else {
      for (const call of calls) {
        dfs(call.id, newChain, depth + 1);
      }
    }

    visited.delete(currentId);
  };

  dfs(symbolId, [], 0);
  return chains;
}

export function findRecursiveCalls(symbolGraph: SymbolGraphData): SymbolNode[] {
  const recursiveSymbols: SymbolNode[] = [];

  for (const node of symbolGraph.nodes) {
    const calls = getCalls(node.id, symbolGraph);
    if (calls.some(call => call.id === node.id)) {
      recursiveSymbols.push(node);
    }
  }

  return recursiveSymbols;
}

export function findCircularDependencies(symbolGraph: SymbolGraphData): SymbolNode[][] {
  const cycles: SymbolNode[][] = [];
  const visited = new Set<number>();
  const recursionStack = new Set<number>();

  const dfs = (nodeId: number, path: SymbolNode[]): void => {
    if (recursionStack.has(nodeId)) {
      const node = symbolGraph.nodes.find(n => n.id === nodeId);
      if (node) {
        const cycleStart = path.findIndex(n => n.id === nodeId);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
      }
      return;
    }

    if (visited.has(nodeId)) return;

    const node = symbolGraph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    visited.add(nodeId);
    recursionStack.add(nodeId);

    const calls = getCalls(nodeId, symbolGraph);
    for (const call of calls) {
      dfs(call.id, [...path, node]);
    }

    recursionStack.delete(nodeId);
  };

  for (const node of symbolGraph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }

  return cycles;
}

export function findUnusedSymbols(symbolGraph: SymbolGraphData): SymbolNode[] {
  const calledSymbolIds = new Set(
    symbolGraph.edges.filter(edge => edge.type === DependencyType.CALLS).map(edge => edge.to)
  );

  return symbolGraph.nodes.filter(
    node =>
      !calledSymbolIds.has(node.id) &&
      !node.isExported &&
      node.type === SymbolType.FUNCTION
  );
}

export function calculateComplexity(symbolId: number, symbolGraph: SymbolGraphData): number {
  const symbol = symbolGraph.nodes.find(n => n.id === symbolId);
  if (!symbol) return 0;

  let complexity = 1;

  const calls = getCalls(symbolId, symbolGraph);
  complexity += calls.length;

  const callers = getCallers(symbolId, symbolGraph);
  complexity += Math.floor(callers.length / 2);

  const parents = getParents(symbolId, symbolGraph);
  complexity += parents.length * 2;

  return complexity;
}
