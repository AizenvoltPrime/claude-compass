import { Symbol, CreateDependency, DependencyType, SymbolType, File } from '../database/models';
import { ParsedDependency, ParsedImport, ParsedExport } from '../parsers/base';
import { createComponentLogger } from '../utils/logger';
import { SymbolResolver, ResolvedDependency } from './symbol-resolver';

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
  parameter_context?: string;
  call_instance_id?: string;
  parameter_types?: string[];
  calling_object?: string;
  qualified_context?: string;
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
  private symbolResolver: SymbolResolver;

  constructor() {
    this.logger = logger;
    this.symbolResolver = new SymbolResolver();
  }

  /**
   * Build symbol graph from parsed symbols and dependencies
   */
  async buildSymbolGraph(
    symbols: Symbol[],
    dependenciesMap: Map<number, ParsedDependency[]>,
    files: File[] = [],
    importsMap: Map<number, ParsedImport[]> = new Map(),
    exportsMap: Map<number, ParsedExport[]> = new Map()
  ): Promise<SymbolGraphData> {
    this.logger.info('Building symbol graph', {
      symbolCount: symbols.length,
      fileCount: files.length,
    });

    const nodes = this.createSymbolNodes(symbols);

    // Initialize symbol resolver with file context if available
    if (files.length > 0) {
      this.symbolResolver.initialize(files, symbols, importsMap, exportsMap);
      const stats = this.symbolResolver.getResolutionStats();
      this.logger.info('Symbol resolver initialized', stats);
    }

    const edges = this.createSymbolEdges(symbols, dependenciesMap, nodes, files.length > 0);

    this.logger.info('Symbol graph built', {
      nodeCount: nodes.length,
      edgeCount: edges.length,
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
            type: edge.type,
          });
        }
        return isValid;
      })
      .map(edge => ({
        from_symbol_id: edge.from,
        to_symbol_id: edge.to,
        dependency_type: edge.type,
        line_number: edge.lineNumber,
        // comprehensive relationship data (Phase 3)
        // Include parameter context fields from SymbolEdge
        parameter_context: edge.parameter_context,
        call_instance_id: edge.call_instance_id,
        parameter_types: edge.parameter_types,
        calling_object: edge.calling_object,
        qualified_context: edge.qualified_context,
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
      .filter(
        edge =>
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
      .filter(
        edge =>
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
      symbolGraph.edges.filter(edge => edge.type === DependencyType.CALLS).map(edge => edge.to)
    );

    return symbolGraph.nodes.filter(
      node =>
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
      signature: symbol.signature,
    }));
  }

  private createSymbolEdges(
    symbols: Symbol[],
    dependenciesMap: Map<number, ParsedDependency[]>,
    nodes: SymbolNode[],
    useFileAwareResolution: boolean = false
  ): SymbolEdge[] {
    const edges: SymbolEdge[] = [];

    if (useFileAwareResolution) {
      // Use file-aware symbol resolution
      this.logger.info('Using file-aware symbol resolution');

      // Group dependencies by file to resolve them with proper context
      const dependenciesByFile = new Map<
        number,
        { symbol: Symbol; dependencies: ParsedDependency[] }[]
      >();

      for (const symbol of symbols) {
        const dependencies = dependenciesMap.get(symbol.id) || [];
        if (dependencies.length > 0) {
          const fileList = dependenciesByFile.get(symbol.file_id) || [];
          fileList.push({ symbol, dependencies });
          dependenciesByFile.set(symbol.file_id, fileList);
        }
      }

      // Resolve dependencies for each file
      const nameToSymbolMap = this.createNameToSymbolMap(nodes);

      for (const [fileId, symbolDeps] of dependenciesByFile) {
        const allDepsForFile = symbolDeps.flatMap(sd => sd.dependencies);

        const resolved = this.symbolResolver.resolveDependencies(fileId, allDepsForFile);

        // Track which dependencies were resolved to avoid duplicates in fallback
        const resolvedDependencies = new Set<string>();

        for (const resolution of resolved) {
          // Skip self-references for non-call dependencies
          if (
            resolution.fromSymbol.id === resolution.toSymbol.id &&
            resolution.originalDependency.dependency_type !== DependencyType.CALLS
          ) {
            continue;
          }

          edges.push({
            from: resolution.fromSymbol.id,
            to: resolution.toSymbol.id,
            type: resolution.originalDependency.dependency_type,
            lineNumber: resolution.originalDependency.line_number,
            // comprehensive relationship data (Phase 3)
            // Preserve parameter context fields
            parameter_context: resolution.originalDependency.parameter_context,
            call_instance_id: resolution.originalDependency.call_instance_id,
            parameter_types: resolution.originalDependency.parameter_types,
            calling_object: resolution.originalDependency.calling_object,
            qualified_context: resolution.originalDependency.qualified_context,
          });

          // Mark this dependency as resolved (include line number to handle multiple calls on different lines)
          const depKey = `${resolution.fromSymbol.id}->${resolution.originalDependency.to_symbol}:${resolution.originalDependency.line_number}`;
          resolvedDependencies.add(depKey);
        }

        // Fallback for unresolved dependencies - especially important for external calls like Laravel models
        for (const { symbol, dependencies } of symbolDeps) {
          for (const dep of dependencies) {
            const depKey = `${symbol.id}->${dep.to_symbol}:${dep.line_number}`;

            // Skip if already resolved by the symbol resolver
            if (resolvedDependencies.has(depKey)) {
              continue;
            }

            // Try to find target symbols using name-based lookup
            const targetSymbols = nameToSymbolMap.get(dep.to_symbol) || [];

            if (targetSymbols.length > 0) {
              // Found target symbols, create edges
              for (const targetSymbol of targetSymbols) {
                if (symbol.id === targetSymbol.id && dep.dependency_type !== DependencyType.CALLS) {
                  continue;
                }

                edges.push({
                  from: symbol.id,
                  to: targetSymbol.id,
                  type: dep.dependency_type,
                  lineNumber: dep.line_number,
                  // comprehensive relationship data (Phase 3)
                  // Preserve parameter context fields from fallback resolution
                  parameter_context: dep.parameter_context,
                  call_instance_id: dep.call_instance_id,
                  parameter_types: dep.parameter_types,
                  calling_object: dep.calling_object,
                  qualified_context: dep.qualified_context,
                });
              }
            } else {
              // No target symbol found - log this for potential file dependency creation
              // This is especially important for Laravel static method calls like User::all, User::create
              if (dep.dependency_type === DependencyType.CALLS) {
                // These unresolved calls will be handled as file dependencies in the GraphBuilder
              }
            }
          }
        }
      }

      this.logger.info('File-aware resolution completed', {
        filesProcessed: dependenciesByFile.size,
        edgesCreated: edges.length,
      });
    } else {
      // Fallback to legacy name-based resolution (with warnings)
      this.logger.warn(
        'Using legacy name-based symbol resolution - may produce false dependencies'
      );

      const nameToSymbolMap = this.createNameToSymbolMap(nodes);

      for (const symbol of symbols) {
        const dependencies = dependenciesMap.get(symbol.id) || [];

        for (const dep of dependencies) {
          const targetSymbols = nameToSymbolMap.get(dep.to_symbol) || [];

          // Warn about potential false positives when multiple symbols match
          if (targetSymbols.length > 1) {
            this.logger.warn('Multiple symbols found for dependency - potential false positive', {
              symbolName: dep.to_symbol,
              matchCount: targetSymbols.length,
              sourceFile: symbol.file_id,
            });
          }

          for (const targetSymbol of targetSymbols) {
            if (symbol.id === targetSymbol.id && dep.dependency_type !== DependencyType.CALLS) {
              continue;
            }

            edges.push({
              from: symbol.id,
              to: targetSymbol.id,
              type: dep.dependency_type,
              lineNumber: dep.line_number,
              // comprehensive relationship data (Phase 3)
              // Preserve parameter context fields from legacy resolution
              parameter_context: dep.parameter_context,
              call_instance_id: dep.call_instance_id,
              parameter_types: dep.parameter_types,
              calling_object: dep.calling_object,
              qualified_context: dep.qualified_context,
            });
          }
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
      // Include line number in the key to allow multiple calls on different lines
      const key = `${edge.from}-${edge.to}-${edge.type}-${edge.lineNumber}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEdges.push(edge);
      }
    }

    return uniqueEdges;
  }
}
