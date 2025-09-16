import { Symbol, CreateDependency, DependencyType, SymbolType } from '../database/models';
import { ParsedSymbol, ParsedDependency } from '../parsers/base';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('symbol-graph');

export interface SymbolNode {
  id: number;
  name: string;
  type: SymbolType;
  fileId: number;
  startLine: number;
  endLine: number;
  isExported: boolean;
  visibility?: 'public' | 'private' | 'protected';
  signature?: string;
}

export interface SymbolEdge {
  from: number;
  to: number;
  type: DependencyType;
  lineNumber: number;
  confidence: number;
}

export interface SymbolGraphData {
  nodes: SymbolNode[];
  edges: SymbolEdge[];
}

export interface CallChain {
  symbols: SymbolNode[];
  depth: number;
}

export class SymbolGraphBuilder {
  private logger: any;

  constructor() {
    this.logger = logger;
  }

  /**
   * Build symbol graph from parsed symbols and dependencies
   */
  async buildSymbolGraph(
    symbols: Symbol[],
    dependenciesMap: Map<number, ParsedDependency[]>
  ): Promise<SymbolGraphData> {
    this.logger.info('Building symbol graph', {
      symbolCount: symbols.length
    });

    const nodes = this.createSymbolNodes(symbols);
    const edges = this.createSymbolEdges(symbols, dependenciesMap, nodes);

    this.logger.info('Symbol graph built', {
      nodeCount: nodes.length,
      edgeCount: edges.length
    });

    return { nodes, edges };
  }

  /**
   * Create dependencies for database storage
   */
  createSymbolDependencies(symbolGraph: SymbolGraphData): CreateDependency[] {
    // Get all valid symbol IDs from the graph nodes
    const validSymbolIds = new Set(symbolGraph.nodes.map(node => node.id));

    return symbolGraph.edges
      .filter(edge => {
        // Only include dependencies where both symbols exist in the graph
        const isValid = validSymbolIds.has(edge.from) && validSymbolIds.has(edge.to);
        if (!isValid) {
          this.logger.warn('Filtering out dependency with invalid symbol reference', {
            from: edge.from,
            to: edge.to,
            type: edge.type
          });
        }
        return isValid;
      })
      .map(edge => ({
        from_symbol_id: edge.from,
        to_symbol_id: edge.to,
        dependency_type: edge.type,
        line_number: edge.lineNumber,
        confidence: edge.confidence
      }));
  }

  /**
   * Find all symbols that call a specific symbol
   */
  getCallers(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
    const callerIds = symbolGraph.edges
      .filter(edge => edge.to === symbolId && edge.type === DependencyType.CALLS)
      .map(edge => edge.from);

    return symbolGraph.nodes.filter(node => callerIds.includes(node.id));
  }

  /**
   * Find all symbols that a specific symbol calls
   */
  getCalls(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
    const callIds = symbolGraph.edges
      .filter(edge => edge.from === symbolId && edge.type === DependencyType.CALLS)
      .map(edge => edge.to);

    return symbolGraph.nodes.filter(node => callIds.includes(node.id));
  }

  /**
   * Find all symbols that inherit from or implement a specific symbol
   */
  getImplementations(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
    const implementationIds = symbolGraph.edges
      .filter(edge =>
        edge.to === symbolId &&
        (edge.type === DependencyType.INHERITS || edge.type === DependencyType.IMPLEMENTS)
      )
      .map(edge => edge.from);

    return symbolGraph.nodes.filter(node => implementationIds.includes(node.id));
  }

  /**
   * Find all symbols that a specific symbol inherits from or implements
   */
  getParents(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
    const parentIds = symbolGraph.edges
      .filter(edge =>
        edge.from === symbolId &&
        (edge.type === DependencyType.INHERITS || edge.type === DependencyType.IMPLEMENTS)
      )
      .map(edge => edge.to);

    return symbolGraph.nodes.filter(node => parentIds.includes(node.id));
  }

  /**
   * Calculate the call chain depth from a starting symbol
   */
  calculateCallDepth(symbolId: number, symbolGraph: SymbolGraphData): number {
    const visited = new Set<number>();
    const stack = [{ id: symbolId, depth: 0 }];
    let maxDepth = 0;

    while (stack.length > 0) {
      const { id, depth } = stack.pop()!;

      if (visited.has(id)) continue;
      visited.add(id);

      maxDepth = Math.max(maxDepth, depth);

      const calls = this.getCalls(id, symbolGraph);
      for (const call of calls) {
        if (!visited.has(call.id)) {
          stack.push({ id: call.id, depth: depth + 1 });
        }
      }
    }

    return maxDepth;
  }

  /**
   * Find the complete call chain starting from a symbol
   */
  getCallChain(symbolId: number, symbolGraph: SymbolGraphData, maxDepth: number = 10): CallChain[] {
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

      const calls = this.getCalls(currentId, symbolGraph);

      if (calls.length === 0) {
        // End of chain
        chains.push({
          symbols: newChain,
          depth: depth
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

  /**
   * Find recursive call patterns
   */
  findRecursiveCalls(symbolGraph: SymbolGraphData): SymbolNode[] {
    const recursiveSymbols: SymbolNode[] = [];

    for (const node of symbolGraph.nodes) {
      const calls = this.getCalls(node.id, symbolGraph);
      if (calls.some(call => call.id === node.id)) {
        recursiveSymbols.push(node);
      }
    }

    return recursiveSymbols;
  }

  /**
   * Find circular dependencies between symbols
   */
  findCircularDependencies(symbolGraph: SymbolGraphData): SymbolNode[][] {
    const cycles: SymbolNode[][] = [];
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    const dfs = (nodeId: number, path: SymbolNode[]): void => {
      if (recursionStack.has(nodeId)) {
        // Found a cycle
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

      const calls = this.getCalls(nodeId, symbolGraph);
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

  /**
   * Find unused symbols (symbols that are not called by anything)
   */
  findUnusedSymbols(symbolGraph: SymbolGraphData): SymbolNode[] {
    const calledSymbolIds = new Set(
      symbolGraph.edges
        .filter(edge => edge.type === DependencyType.CALLS)
        .map(edge => edge.to)
    );

    return symbolGraph.nodes.filter(node =>
      !calledSymbolIds.has(node.id) &&
      !node.isExported && // Exported symbols might be used externally
      node.type === SymbolType.FUNCTION
    );
  }

  /**
   * Calculate symbol complexity based on dependencies
   */
  calculateComplexity(symbolId: number, symbolGraph: SymbolGraphData): number {
    const symbol = symbolGraph.nodes.find(n => n.id === symbolId);
    if (!symbol) return 0;

    let complexity = 1; // Base complexity

    // Add complexity for each call made
    const calls = this.getCalls(symbolId, symbolGraph);
    complexity += calls.length;

    // Add complexity for each caller (high fan-in indicates complexity)
    const callers = this.getCallers(symbolId, symbolGraph);
    complexity += Math.floor(callers.length / 2);

    // Add complexity for inheritance relationships
    const parents = this.getParents(symbolId, symbolGraph);
    complexity += parents.length * 2;

    return complexity;
  }

  private createSymbolNodes(symbols: Symbol[]): SymbolNode[] {
    return symbols.map(symbol => ({
      id: symbol.id,
      name: symbol.name,
      type: symbol.symbol_type,
      fileId: symbol.file_id,
      startLine: symbol.start_line || 0,
      endLine: symbol.end_line || 0,
      isExported: symbol.is_exported,
      visibility: symbol.visibility,
      signature: symbol.signature
    }));
  }

  private createSymbolEdges(
    symbols: Symbol[],
    dependenciesMap: Map<number, ParsedDependency[]>,
    nodes: SymbolNode[]
  ): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    const nameToSymbolMap = this.createNameToSymbolMap(nodes);

    for (const symbol of symbols) {
      const dependencies = dependenciesMap.get(symbol.id) || [];

      for (const dep of dependencies) {
        // Find the target symbol by name
        const targetSymbols = nameToSymbolMap.get(dep.to_symbol) || [];

        for (const targetSymbol of targetSymbols) {
          // Skip self-references unless it's a recursive call
          if (symbol.id === targetSymbol.id && dep.dependency_type !== DependencyType.CALLS) {
            continue;
          }

          edges.push({
            from: symbol.id,
            to: targetSymbol.id,
            type: dep.dependency_type,
            lineNumber: dep.line_number,
            confidence: dep.confidence
          });
        }
      }
    }

    return this.removeDuplicateEdges(edges);
  }

  private createNameToSymbolMap(nodes: SymbolNode[]): Map<string, SymbolNode[]> {
    const map = new Map<string, SymbolNode[]>();

    for (const node of nodes) {
      const existing = map.get(node.name) || [];
      existing.push(node);
      map.set(node.name, existing);
    }

    return map;
  }

  private removeDuplicateEdges(edges: SymbolEdge[]): SymbolEdge[] {
    const seen = new Set<string>();
    const uniqueEdges: SymbolEdge[] = [];

    for (const edge of edges) {
      const key = `${edge.from}-${edge.to}-${edge.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEdges.push(edge);
      }
    }

    return uniqueEdges;
  }
}