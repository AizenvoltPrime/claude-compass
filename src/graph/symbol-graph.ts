import { Symbol, CreateDependency, DependencyType, SymbolType, File } from '../database/models';
import { ParsedDependency, ParsedImport, ParsedExport } from '../parsers/base';
import { createComponentLogger } from '../utils/logger';
import { SymbolResolver, ResolvedDependency } from './symbol-resolver';

const logger = createComponentLogger('symbol-graph');

export interface SymbolNode {
  id: number;
  name: string;
  qualifiedName?: string;
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
  to_qualified_name?: string;
  parameter_context?: string;
  call_instance_id?: string;
  parameter_types?: string[];
  calling_object?: string;
  qualified_context?: string;
  resolved_class?: string; // C# resolved class name (e.g., "CardManager")
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
  private seenExternalPatterns: Set<string>;
  private suppressedExternalCount: number;
  private suppressedAmbiguousCount: number;

  constructor() {
    this.logger = logger;
    this.symbolResolver = new SymbolResolver();
    this.seenExternalPatterns = new Set();
    this.suppressedExternalCount = 0;
    this.suppressedAmbiguousCount = 0;
  }

  /**
   * Build symbol graph from parsed symbols and dependencies
   */
  async buildSymbolGraph(
    symbols: Symbol[],
    dependenciesMap: Map<number, ParsedDependency[]>,
    files: File[] = [],
    importsMap: Map<number, ParsedImport[]> = new Map(),
    exportsMap: Map<number, ParsedExport[]> = new Map(),
    repositoryPath?: string
  ): Promise<SymbolGraphData> {
    this.resetLogDeduplication();
    const nodes = this.createSymbolNodes(symbols);

    // Build file ID to path mapping for class name extraction
    const fileIdToPath = new Map<number, string>();
    files.forEach(f => fileIdToPath.set(f.id, f.path));

    // Initialize symbol resolver with file context if available
    if (files.length > 0) {
      this.symbolResolver.initialize(files, symbols, importsMap, exportsMap);

      if (repositoryPath) {
        await this.symbolResolver.buildGlobalSymbolIndex(files, symbols);
        await this.symbolResolver.registerAutoloaderConfig(repositoryPath);
        logger.info('Global symbol index and autoloader configs initialized', {
          repositoryPath,
          symbolCount: symbols.length,
          fileCount: files.length
        });
      }

      this.symbolResolver.getResolutionStats();
    }

    const edges = this.createSymbolEdges(symbols, dependenciesMap, nodes, files.length > 0, fileIdToPath);

    // Extract virtual framework symbols from edges and add them to nodes
    const virtualSymbolNodes = this.extractVirtualSymbolNodes(edges, nodes);
    nodes.push(...virtualSymbolNodes);

    this.logResolutionSummary();

    return { nodes, edges };
  }

  /**
   * Create dependencies for database storage
   */
  createSymbolDependencies(symbolGraph: SymbolGraphData): CreateDependency[] {
    // Get all valid symbol IDs from the graph nodes
    const validSymbolIds = new Set(symbolGraph.nodes.map(node => node.id));

    // Create a map from symbol ID to qualified name for stable references (fallback)
    const symbolIdToQualifiedName = new Map<number, string | undefined>();
    symbolGraph.nodes.forEach(node => {
      symbolIdToQualifiedName.set(node.id, node.qualifiedName);
    });

    return symbolGraph.edges
      .filter(edge => {
        // Only include dependencies where both symbols exist in the graph
        return validSymbolIds.has(edge.from) && validSymbolIds.has(edge.to);
      })
      .map(edge => ({
        from_symbol_id: edge.from,
        to_symbol_id: edge.to,
        to_qualified_name: edge.to_qualified_name || symbolIdToQualifiedName.get(edge.to),
        dependency_type: edge.type,
        line_number: edge.lineNumber,
        // comprehensive relationship data (Phase 3)
        // Include parameter context fields from SymbolEdge
        parameter_context: edge.parameter_context,
        call_instance_id: edge.call_instance_id,
        parameter_types: edge.parameter_types,
        calling_object: edge.calling_object,
        qualified_context: edge.qualified_context,
        resolved_class: edge.resolved_class, // C# class resolution
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

  private isImportStrategy(strategy: string): boolean {
    return strategy.includes(':imports') ||
           strategy.includes(':exports') ||
           strategy === 'imports' ||
           strategy === 'exports';
  }

  private resetLogDeduplication(): void {
    this.seenExternalPatterns.clear();
    this.suppressedExternalCount = 0;
    this.suppressedAmbiguousCount = 0;
  }

  private logResolutionSummary(): void {
    if (this.suppressedExternalCount > 0 || this.suppressedAmbiguousCount > 0) {
      this.logger.info('Symbol resolution summary', {
        uniqueExternalPatterns: this.seenExternalPatterns.size,
        suppressedExternalLogs: this.suppressedExternalCount,
        suppressedAmbiguousLogs: this.suppressedAmbiguousCount
      });
    }
  }

  private createSymbolNodes(symbols: Symbol[]): SymbolNode[] {
    return symbols.map(symbol => ({
      id: symbol.id,
      name: symbol.name,
      qualifiedName: symbol.qualified_name,
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
    useFileAwareResolution: boolean = false,
    fileIdToPath: Map<number, string> = new Map()
  ): SymbolEdge[] {
    const edges: SymbolEdge[] = [];

    if (useFileAwareResolution) {
      // Use file-aware symbol resolution

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

      // Build interface-to-implementation mapping for enhanced symbol resolution
      const interfaceMap = this.buildInterfaceToImplementationMap(nodes, edges);

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
            to_qualified_name: resolution.originalDependency.to_qualified_name,
            // comprehensive relationship data (Phase 3)
            // Preserve parameter context fields
            parameter_context: resolution.originalDependency.parameter_context,
            call_instance_id: resolution.originalDependency.call_instance_id,
            parameter_types: resolution.originalDependency.parameter_types,
            calling_object: resolution.originalDependency.calling_object,
            qualified_context: resolution.originalDependency.qualified_context,
            resolved_class: resolution.originalDependency.resolved_class,
          });

          // Create additional IMPORTS edge if resolution came via imports
          if (resolution.resolutionStrategy && this.isImportStrategy(resolution.resolutionStrategy)) {
            edges.push({
              from: resolution.fromSymbol.id,
              to: resolution.toSymbol.id,
              type: DependencyType.IMPORTS,
              lineNumber: resolution.originalDependency.line_number,
              to_qualified_name: resolution.originalDependency.to_qualified_name,
            });
          }

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

            // Try to find target symbols using enhanced qualified name lookup
            const targetSymbols = this.enhancedSymbolLookup(dep.to_symbol, nameToSymbolMap, interfaceMap);


            if (targetSymbols.length > 0) {
              // For method calls with multiple matches, try to disambiguate using context
              let finalTargets = targetSymbols;
              if (dep.dependency_type === DependencyType.CALLS && targetSymbols.length > 1) {
                // Try to use resolved_class, qualified_context, or calling_object to pick the right implementation
                const contextInfo = dep.resolved_class || dep.qualified_context;

                if (contextInfo) {
                  // resolved_class is "CardManager", qualified_context might be "field_call__cardManager"
                  const contextMatch = targetSymbols.filter(ts => {
                    // For resolved_class, it's already the class name
                    let className = contextInfo;

                    // For qualified_context patterns, extract class name
                    if (contextInfo.includes('.')) {
                      const qualifierParts = contextInfo.split('.');
                      className = qualifierParts[0];
                    }
                    if (contextInfo.startsWith('field_call_')) {
                      className = contextInfo.replace('field_call_', '').replace(/^_/, '');
                      // Capitalize first letter (e.g., "cardManager" -> "CardManager")
                      className = className.charAt(0).toUpperCase() + className.slice(1);
                    }

                    // Match by checking if the symbol belongs to this class
                    const symbolClassName = this.getSymbolClassName(ts, nodes, fileIdToPath);
                    const isMatch = symbolClassName.toLowerCase() === className.toLowerCase();

                    return isMatch;
                  });

                  if (contextMatch.length > 0) {
                    finalTargets = contextMatch;
                  }
                }

                // If still ambiguous after context matching:
                // - If we have context info (resolved_class), take the first match (most specific)
                // - If we have NO context info, skip to avoid false positives
                if (finalTargets.length > 1) {
                  if (contextInfo) {
                    // We tried to disambiguate with context but still have multiple matches
                    // Take the first one as the best guess (most specific match)
                    finalTargets = [finalTargets[0]];
                    this.logger?.debug('Multiple matches after disambiguation, using first match', {
                      from_symbol: symbol.name,
                      to_symbol: dep.to_symbol,
                      selected: finalTargets[0].name,
                      resolved_class: dep.resolved_class
                    });
                  } else {
                    // No context info and multiple matches - skip to avoid false positives
                    this.logger?.warn('Skipping ambiguous method call dependency (no context)', {
                      from_symbol: symbol.name,
                      to_symbol: dep.to_symbol,
                      matches: finalTargets.length
                    });
                    continue;
                  }
                }
              }

              // Found target symbols, create edges
              for (const targetSymbol of finalTargets) {
                if (symbol.id === targetSymbol.id && dep.dependency_type !== DependencyType.CALLS) {
                  continue;
                }

                edges.push({
                  from: symbol.id,
                  to: targetSymbol.id,
                  type: dep.dependency_type,
                  lineNumber: dep.line_number,
                  to_qualified_name: dep.to_qualified_name,
                  // comprehensive relationship data (Phase 3)
                  // Preserve parameter context fields from fallback resolution
                  parameter_context: dep.parameter_context,
                  call_instance_id: dep.call_instance_id,
                  parameter_types: dep.parameter_types,
                  calling_object: dep.calling_object,
                  qualified_context: dep.qualified_context,
                  resolved_class: dep.resolved_class,
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

    } else {
      // Use enhanced symbol resolution without file-aware context
      const nameToSymbolMap = this.createNameToSymbolMap(nodes);
      const interfaceMap = this.buildInterfaceToImplementationMap(nodes, edges);

      for (const symbol of symbols) {
        const dependencies = dependenciesMap.get(symbol.id) || [];

        for (const dep of dependencies) {
          const targetSymbols = this.enhancedSymbolLookup(dep.to_symbol, nameToSymbolMap, interfaceMap);

          // For method calls with multiple matches, try to disambiguate using context
          let finalTargets = targetSymbols;
          if (dep.dependency_type === DependencyType.CALLS && targetSymbols.length > 1) {
            // Try to use resolved_class, qualified_context, or calling_object to pick the right implementation
            const contextInfo = dep.resolved_class || dep.qualified_context;

            if (contextInfo) {
              const contextMatch = targetSymbols.filter(ts => {
                let className = contextInfo;

                if (contextInfo.includes('.')) {
                  const qualifierParts = contextInfo.split('.');
                  className = qualifierParts[0];
                }
                if (contextInfo.startsWith('field_call_')) {
                  className = contextInfo.replace('field_call_', '').replace(/^_/, '');
                  className = className.charAt(0).toUpperCase() + className.slice(1);
                }

                const symbolClassName = this.getSymbolClassName(ts, nodes, fileIdToPath);
                return symbolClassName.toLowerCase() === className.toLowerCase();
              });

              if (contextMatch.length > 0) {
                finalTargets = contextMatch;
              }
            }

            // If still ambiguous after context matching:
            // - If we have context info, take the first match (most specific)
            // - If we have NO context info, skip to avoid false positives
            if (finalTargets.length > 1) {
              if (contextInfo) {
                // Take the first match as the best guess
                finalTargets = [finalTargets[0]];
                this.logger?.debug('Multiple matches after disambiguation (non-file-aware), using first match', {
                  from_symbol: symbol.name,
                  to_symbol: dep.to_symbol,
                  selected: finalTargets[0].name,
                  resolved_class: dep.resolved_class
                });
              } else {
                // No context info and multiple matches - skip to avoid false positives
                this.logger?.warn('Skipping ambiguous method call dependency (non-file-aware, no context)', {
                  from_symbol: symbol.name,
                  to_symbol: dep.to_symbol,
                  matches: finalTargets.length
                });
                continue;
              }
            }
          }

          for (const targetSymbol of finalTargets) {
            if (symbol.id === targetSymbol.id && dep.dependency_type !== DependencyType.CALLS) {
              continue;
            }

            edges.push({
              from: symbol.id,
              to: targetSymbol.id,
              type: dep.dependency_type,
              lineNumber: dep.line_number,
              to_qualified_name: dep.to_qualified_name,
              // comprehensive relationship data (Phase 3)
              // Preserve parameter context fields from legacy resolution
              parameter_context: dep.parameter_context,
              call_instance_id: dep.call_instance_id,
              parameter_types: dep.parameter_types,
              calling_object: dep.calling_object,
              qualified_context: dep.qualified_context,
              resolved_class: dep.resolved_class,
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

  /**
   * Parse qualified names like "IHandManager.SetHandPositions" into components
   */
  private parseQualifiedName(name: string): { qualifier?: string; memberName: string } {
    const lastDotIndex = name.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return { memberName: name };
    }
    return {
      qualifier: name.substring(0, lastDotIndex),
      memberName: name.substring(lastDotIndex + 1)
    };
  }

  /**
   * Get the class name that a symbol belongs to by finding the class node in the same file
   */
  private getSymbolClassName(symbol: SymbolNode, allNodes: SymbolNode[], fileIdToPath: Map<number, string> = new Map()): string {
    // Find class symbols in the same file that contain this symbol
    const classNodes = allNodes.filter(n =>
      n.type === 'class' &&
      n.fileId === symbol.fileId &&
      n.startLine <= symbol.startLine &&
      n.endLine >= symbol.endLine
    );


    // Return the most specific (innermost) class
    if (classNodes.length > 0) {
      // Sort by line range (smaller range = more specific)
      classNodes.sort((a, b) => (b.endLine - b.startLine) - (a.endLine - a.startLine));
      return classNodes[classNodes.length - 1].name;
    }

    return '';
  }

  /**
   * Build mapping from interfaces to their concrete implementations
   */
  private buildInterfaceToImplementationMap(
    nodes: SymbolNode[],
    edges: SymbolEdge[]
  ): Map<string, SymbolNode[]> {
    const interfaceMap = new Map<string, SymbolNode[]>();
    const nodeMap = new Map<number, SymbolNode>();

    // Create node lookup by ID
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // Find inheritance and implementation relationships
    const inheritanceEdges = edges.filter(edge =>
      edge.type === DependencyType.INHERITS || edge.type === DependencyType.IMPLEMENTS
    );

    for (const edge of inheritanceEdges) {
      const implementingClass = nodeMap.get(edge.from);
      const interfaceOrBase = nodeMap.get(edge.to);

      if (implementingClass && interfaceOrBase) {
        // Map interface/base class name to implementing class
        const existing = interfaceMap.get(interfaceOrBase.name) || [];
        existing.push(implementingClass);
        interfaceMap.set(interfaceOrBase.name, existing);

        this.logger.debug('Interface mapping created', {
          interface: interfaceOrBase.name,
          implementation: implementingClass.name,
          edgeType: edge.type
        });
      }
    }

    return interfaceMap;
  }

  /**
   * Enhanced symbol lookup with qualified name resolution and interface mapping
   */
  private enhancedSymbolLookup(
    targetName: string,
    nameToSymbolMap: Map<string, SymbolNode[]>,
    interfaceMap: Map<string, SymbolNode[]>
  ): SymbolNode[] {
    const strippedName = this.stripGenericParameters(targetName);
    const isExternal = this.isExternalReference(strippedName);
    const isInstanceAccess = this.isInstanceMemberAccess(strippedName);

    const parsed = this.parseQualifiedName(strippedName);

    // Handle qualified names (e.g., "IHandManager.SetHandPositions")
    if (parsed.qualifier) {
      const attemptKey = `attempt:${parsed.qualifier}.${parsed.memberName}`;
      if (!this.seenExternalPatterns.has(attemptKey)) {
        this.logger.debug('Attempting qualified name resolution', {
          targetName,
          qualifier: parsed.qualifier,
          memberName: parsed.memberName
        });
        this.seenExternalPatterns.add(attemptKey);
      } else {
        this.suppressedExternalCount++;
      }

      // Step 1: Try exact qualified match by finding class/interface/enum and its members
      const qualifierSymbols = nameToSymbolMap.get(parsed.qualifier) || [];
      const memberSymbols = nameToSymbolMap.get(parsed.memberName) || [];

      // Find member symbols that belong to the qualifier class/interface/enum
      const qualifiedMatches: SymbolNode[] = [];
      for (const qualifierSymbol of qualifierSymbols) {
        // Handle class and interface qualifiers
        if (qualifierSymbol.type === 'class' || qualifierSymbol.type === 'interface') {
          // Enhanced class-member association using multiple strategies
          const classMembers = this.findClassMembers(
            qualifierSymbol,
            memberSymbols,
            parsed.memberName
          );
          qualifiedMatches.push(...classMembers);
        }

        // Handle enum qualifiers - find enum members by qualified_name
        if (qualifierSymbol.type === 'enum') {
          const enumMembers = this.findEnumMembers(
            parsed.qualifier,
            parsed.memberName,
            memberSymbols
          );
          qualifiedMatches.push(...enumMembers);
        }
      }

      if (qualifiedMatches.length > 0) {
        this.logger.debug('Qualified name resolution successful', {
          targetName,
          qualifier: parsed.qualifier,
          memberName: parsed.memberName,
          matchCount: qualifiedMatches.length
        });

        return qualifiedMatches;
      }

      // Step 2: Try interface-to-implementation mapping
      const implementingClasses = interfaceMap.get(parsed.qualifier) || [];

      if (implementingClasses.length > 0) {
        this.logger.debug('Attempting interface-to-implementation resolution', {
          interface: parsed.qualifier,
          implementationCount: implementingClasses.length
        });

        const interfaceResolutionMatches: SymbolNode[] = [];
        for (const implementingClass of implementingClasses) {
          // Only consider actual class implementations
          if (implementingClass.type === 'class') {
            const memberSymbols = nameToSymbolMap.get(parsed.memberName) || [];
            // Use enhanced class-member association for interface implementations
            const classMembers = this.findClassMembers(
              implementingClass,
              memberSymbols,
              parsed.memberName
            );
            interfaceResolutionMatches.push(...classMembers);

          }
        }

        if (interfaceResolutionMatches.length > 0) {
          this.logger.debug('Interface-to-implementation resolution successful', {
            targetName,
            interface: parsed.qualifier,
            matchCount: interfaceResolutionMatches.length
          });

          return interfaceResolutionMatches;
        }
      }

      const fallbackMatches = nameToSymbolMap.get(parsed.memberName) || [];
      const patternKey = `${parsed.qualifier}.${parsed.memberName}`;
      const shouldLog = !this.seenExternalPatterns.has(patternKey);

      if (fallbackMatches.length > 0) {
        if (isExternal || isInstanceAccess) {
          if (shouldLog) {
            this.logger.debug('External/instance reference - qualified resolution failed, skipping fallback', {
              targetName,
              qualifier: parsed.qualifier,
              memberName: parsed.memberName,
              isExternal,
              isInstanceAccess,
              potentialMatches: fallbackMatches.length
            });
            this.seenExternalPatterns.add(patternKey);
          } else {
            this.suppressedExternalCount++;
          }
          return [];
        }

        if (shouldLog) {
          this.logger.debug('Qualified name resolution failed, using simple name fallback', {
            targetName,
            qualifier: parsed.qualifier,
            memberName: parsed.memberName,
            fallbackMatchCount: fallbackMatches.length
          });
          this.seenExternalPatterns.add(patternKey);
        } else {
          this.suppressedExternalCount++;
        }

        return fallbackMatches;
      }

      if (shouldLog) {
        const logLevel = isExternal || isInstanceAccess ? 'debug' : 'warn';
        this.logger[logLevel]('Qualified name resolution failed, no fallback matches found', {
          targetName,
          qualifier: parsed.qualifier,
          memberName: parsed.memberName,
          isExternal,
          isInstanceAccess
        });
        this.seenExternalPatterns.add(patternKey);
      } else {
        this.suppressedExternalCount++;
      }

      return [];
    }

    // Handle simple names (e.g., "SetHandPositions") - exact match only
    const simpleMatches = nameToSymbolMap.get(parsed.memberName) || [];

    this.logger.debug('Simple name resolution', {
      targetName,
      matchCount: simpleMatches.length
    });

    return simpleMatches;
  }

  /**
   * Enhanced class-member association using multiple strategies instead of fragile line-based containment
   */
  private findClassMembers(
    classSymbol: SymbolNode,
    memberSymbols: SymbolNode[],
    memberName: string
  ): SymbolNode[] {
    const matches: SymbolNode[] = [];

    // Strategy 1: File-based grouping with signature analysis
    const fileMemberSymbols = memberSymbols.filter(member =>
      member.fileId === classSymbol.fileId && member.name === memberName
    );

    for (const memberSymbol of fileMemberSymbols) {
      // Strategy 1a: Signature-based class context detection
      if (this.isSignatureClassMember(memberSymbol, classSymbol.name)) {
        matches.push(memberSymbol);
        continue;
      }

      // Strategy 1b: Improved spatial relationship (more lenient than previous logic)
      // Only require the member to be declared after the class starts (not perfect containment)
      if (memberSymbol.startLine >= classSymbol.startLine) {
        matches.push(memberSymbol);
        continue;
      }

      // Strategy 1c: For partial classes - if the member is in the same file and has matching name,
      // assume it belongs to the class (C# partial classes can have complex line relationships)
      if (classSymbol.type === 'class' && this.isLikelyPartialClassMember(memberSymbol, classSymbol)) {
        matches.push(memberSymbol);
      }
    }


    return matches;
  }

  /**
   * Find enum members that belong to a specific enum
   */
  private findEnumMembers(
    enumName: string,
    memberName: string,
    memberSymbols: SymbolNode[]
  ): SymbolNode[] {
    const matches: SymbolNode[] = [];
    const expectedQualifiedName = `${enumName}.${memberName}`;

    for (const memberSymbol of memberSymbols) {
      // Match by qualified_name (primary method)
      if (memberSymbol.signature === expectedQualifiedName) {
        matches.push(memberSymbol);
        continue;
      }

      // Also check if name matches and type is CONSTANT (enum members are stored as constants)
      if (memberSymbol.name === memberName && memberSymbol.type === 'constant') {
        matches.push(memberSymbol);
      }
    }

    return matches;
  }

  /**
   * Check if a member symbol's signature indicates it belongs to a specific class
   */
  private isSignatureClassMember(memberSymbol: SymbolNode, _className: string): boolean {
    if (!memberSymbol.signature) {
      return false;
    }

    // For C# methods, check if the signature contains class context
    // Examples: "public void SetHandPositions(...)" in CardManager.cs file
    // The signature might not always contain the class name explicitly,
    // but we can infer membership from file context and visibility patterns

    // Check for C# method patterns that indicate class membership
    const isMethodInClass =
      memberSymbol.type === 'method' &&
      (memberSymbol.visibility === 'public' ||
       memberSymbol.visibility === 'private' ||
       memberSymbol.visibility === 'protected');

    return isMethodInClass;
  }

  /**
   * Determine if a member likely belongs to a partial class
   */
  private isLikelyPartialClassMember(memberSymbol: SymbolNode, classSymbol: SymbolNode): boolean {
    // For C# partial classes, members in the same file with matching context
    // are likely to belong to the class even if line ranges don't perfectly align

    return (
      memberSymbol.fileId === classSymbol.fileId &&
      memberSymbol.type === 'method' &&
      classSymbol.type === 'class' &&
      // Additional heuristic: if the member has a visibility modifier, it's likely a class member
      (memberSymbol.visibility === 'public' ||
       memberSymbol.visibility === 'private' ||
       memberSymbol.visibility === 'protected')
    );
  }

  private stripGenericParameters(name: string): string {
    const genericStart = name.indexOf('<');
    if (genericStart === -1) {
      return name;
    }
    return name.substring(0, genericStart);
  }

  private isInstanceMemberAccess(name: string): boolean {
    if (!name.includes('.')) {
      return false;
    }

    const dotIndex = name.indexOf('.');
    const firstPart = name.substring(0, dotIndex);

    return firstPart.length > 0 && (
      firstPart[0] === firstPart[0].toLowerCase() ||
      firstPart.startsWith('_')
    );
  }

  private isExternalReference(name: string): boolean {
    const externalNamespaces = [
      'Godot', 'System', 'Variant', 'FileAccess', 'Json', 'Error',
      'SceneTree', 'List', 'Dictionary', 'HashSet', 'Queue', 'Stack',
      'Exception', 'ArgumentException', 'InvalidOperationException',
      'DateTime', 'TimeSpan', 'Guid', 'Uri', 'Task', 'Thread',
      'Node', 'Node2D', 'Node3D', 'Control', 'Resource', 'Object',
      'Vector2', 'Vector3', 'Color', 'Transform2D', 'Transform3D',
      'AnimationPlayer', 'AnimationTree', 'AudioStreamPlayer', 'AudioStreamPlayer2D', 'AudioStreamPlayer3D',
      'Camera2D', 'Camera3D', 'CollisionShape2D', 'CollisionShape3D',
      'Label', 'Button', 'TextureRect', 'Sprite2D', 'Sprite3D',
      'Timer', 'Area2D', 'Area3D', 'CharacterBody2D', 'CharacterBody3D',
      'RigidBody2D', 'RigidBody3D', 'StaticBody2D', 'StaticBody3D',
      'TileMap', 'NavigationAgent2D', 'NavigationAgent3D'
    ];

    const strippedName = this.stripGenericParameters(name);

    if (!strippedName.includes('.')) {
      return externalNamespaces.includes(strippedName);
    }

    const parts = strippedName.split('.');
    const firstPart = parts[0];

    return externalNamespaces.includes(firstPart) ||
           parts.some(part => part === 'Type' || part === 'ModeFlags' || part === 'SignalName');
  }

  private extractVirtualSymbolNodes(edges: SymbolEdge[], existingNodes: SymbolNode[]): SymbolNode[] {
    const existingIds = new Set(existingNodes.map(n => n.id));
    const virtualSymbols = this.symbolResolver.getVirtualSymbols();
    const virtualNodes: SymbolNode[] = [];

    for (const symbol of virtualSymbols) {
      if (!existingIds.has(symbol.id)) {
        virtualNodes.push({
          id: symbol.id,
          name: symbol.name,
          type: symbol.symbol_type,
          fileId: symbol.file_id,
          startLine: symbol.start_line || 1,
          endLine: symbol.end_line || 1,
          isExported: symbol.is_exported || true,
          visibility: symbol.visibility,
          signature: symbol.signature,
        });
      }
    }

    return virtualNodes;
  }
}
