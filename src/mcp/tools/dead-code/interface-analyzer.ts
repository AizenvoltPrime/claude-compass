import { DeadCodeSymbol, InterfaceImplementationPair } from './types.js';

/// <summary>
/// Analyzes interface/implementation relationships to detect interface bloat
/// </summary>
export class InterfaceAnalyzer {
  private implementationPairs: Map<number, InterfaceImplementationPair[]>;
  private deadSymbolIds: Set<number>;

  constructor(
    implementationPairs: InterfaceImplementationPair[],
    deadCandidates: DeadCodeSymbol[]
  ) {
    // Group implementation pairs by implementation symbol ID for fast lookup
    this.implementationPairs = new Map();
    for (const pair of implementationPairs) {
      const existing = this.implementationPairs.get(
        pair.implementation_symbol_id
      ) || [];
      existing.push(pair);
      this.implementationPairs.set(pair.implementation_symbol_id, existing);
    }

    // Create set of dead candidate IDs for fast lookup
    this.deadSymbolIds = new Set(deadCandidates.map(s => s.id));
  }

  /// <summary>
  /// Check if a symbol is an interface method with an unused implementation
  /// </summary>
  isInterfaceBloat(symbolId: number): boolean {
    const pairs = this.implementationPairs.get(symbolId);
    if (!pairs || pairs.length === 0) {
      return false;
    }

    // If this symbol implements an interface and has zero callers, it's interface bloat
    return this.deadSymbolIds.has(symbolId);
  }

  /// <summary>
  /// Get interface information for a symbol
  /// </summary>
  getInterfaceInfo(
    symbolId: number
  ): { interfaceName: string; implementationClass: string } | null {
    const pairs = this.implementationPairs.get(symbolId);
    if (!pairs || pairs.length === 0) {
      return null;
    }

    // Return the first pair (usually there's only one interface per method)
    return {
      interfaceName: pairs[0].interface_name,
      implementationClass: pairs[0].implementation_class,
    };
  }

  /// <summary>
  /// Check if a symbol implements any interface
  /// </summary>
  implementsInterface(symbolId: number): boolean {
    return this.implementationPairs.has(symbolId);
  }

  /// <summary>
  /// Get all interface bloat candidates from the dead symbols
  /// </summary>
  getInterfaceBloatCandidates(): number[] {
    const bloatIds: number[] = [];

    for (const symbolId of this.deadSymbolIds) {
      if (this.isInterfaceBloat(symbolId)) {
        bloatIds.push(symbolId);
      }
    }

    return bloatIds;
  }
}
