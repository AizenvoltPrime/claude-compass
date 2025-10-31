import { Symbol, CreateDependency, File } from '../../database/models';
import { ParsedDependency, ParsedImport, ParsedExport } from '../../parsers/base';
import { createComponentLogger } from '../../utils/logger';
import { SymbolResolver } from '../symbol-resolver';
import { SymbolNode, SymbolGraphData, CallChain } from './types';
import { createSymbolEdges } from './edge-builder';
import { extractVirtualSymbolNodes } from './virtual-symbol-handler';
import {
  getCallers,
  getCalls,
  getImplementations,
  getParents,
  calculateCallDepth
} from './dependency-queries';
import {
  getCallChain,
  findRecursiveCalls,
  findCircularDependencies,
  findUnusedSymbols,
  calculateComplexity
} from './graph-analysis';

const logger = createComponentLogger('symbol-graph');

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

    const fileIdToPath = new Map<number, string>();
    files.forEach(f => fileIdToPath.set(f.id, f.path));

    if (files.length > 0) {
      this.symbolResolver.initialize(files, symbols, importsMap, exportsMap, dependenciesMap);

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

    const suppressedCounters = {
      value: this.suppressedExternalCount
    };
    const suppressedAmbiguousCounters = {
      value: this.suppressedAmbiguousCount
    };

    const edges = createSymbolEdges(
      symbols,
      dependenciesMap,
      nodes,
      files.length > 0,
      fileIdToPath,
      this.symbolResolver,
      this.seenExternalPatterns,
      suppressedCounters,
      suppressedAmbiguousCounters,
      this.logger
    );

    this.suppressedExternalCount = suppressedCounters.value;
    this.suppressedAmbiguousCount = suppressedAmbiguousCounters.value;

    const virtualSymbolNodes = extractVirtualSymbolNodes(edges, nodes, this.symbolResolver);
    nodes.push(...virtualSymbolNodes);

    this.logResolutionSummary();

    return { nodes, edges };
  }

  createSymbolDependencies(symbolGraph: SymbolGraphData): CreateDependency[] {
    const validSymbolIds = new Set(symbolGraph.nodes.map(node => node.id));

    const symbolIdToQualifiedName = new Map<number, string | undefined>();
    symbolGraph.nodes.forEach(node => {
      symbolIdToQualifiedName.set(node.id, node.qualifiedName);
    });

    return symbolGraph.edges
      .filter(edge => {
        return validSymbolIds.has(edge.from) && validSymbolIds.has(edge.to);
      })
      .map(edge => ({
        from_symbol_id: edge.from,
        to_symbol_id: edge.to,
        to_qualified_name: edge.to_qualified_name || symbolIdToQualifiedName.get(edge.to),
        dependency_type: edge.type,
        line_number: edge.lineNumber,
        parameter_context: edge.parameter_context,
        call_instance_id: edge.call_instance_id,
        parameter_types: edge.parameter_types,
        calling_object: edge.calling_object,
        qualified_context: edge.qualified_context,
        resolved_class: edge.resolved_class,
      }));
  }

  getCallers(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
    return getCallers(symbolId, symbolGraph);
  }

  getCalls(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
    return getCalls(symbolId, symbolGraph);
  }

  getImplementations(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
    return getImplementations(symbolId, symbolGraph);
  }

  getParents(symbolId: number, symbolGraph: SymbolGraphData): SymbolNode[] {
    return getParents(symbolId, symbolGraph);
  }

  calculateCallDepth(symbolId: number, symbolGraph: SymbolGraphData): number {
    return calculateCallDepth(symbolId, symbolGraph);
  }

  getCallChain(symbolId: number, symbolGraph: SymbolGraphData, maxDepth: number = 10): CallChain[] {
    return getCallChain(symbolId, symbolGraph, maxDepth);
  }

  findRecursiveCalls(symbolGraph: SymbolGraphData): SymbolNode[] {
    return findRecursiveCalls(symbolGraph);
  }

  findCircularDependencies(symbolGraph: SymbolGraphData): SymbolNode[][] {
    return findCircularDependencies(symbolGraph);
  }

  findUnusedSymbols(symbolGraph: SymbolGraphData): SymbolNode[] {
    return findUnusedSymbols(symbolGraph);
  }

  calculateComplexity(symbolId: number, symbolGraph: SymbolGraphData): number {
    return calculateComplexity(symbolId, symbolGraph);
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
}
