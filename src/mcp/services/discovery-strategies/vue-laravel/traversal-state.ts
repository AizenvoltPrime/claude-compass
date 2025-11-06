/**
 * Traversal State Manager
 *
 * Encapsulates all state for dependency traversal including discovered symbols,
 * visited nodes, and validated file IDs. Provides atomic operations to prevent
 * inconsistent state mutations.
 */

import type { DiscoveryResult } from '../common/types';
import type { SymbolInfo } from './symbol-classifier';

export class TraversalState {
  private discovered: Map<number, number>;
  private visited: Set<number>;
  private validatedFileIds: Set<number>;

  constructor() {
    this.discovered = new Map();
    this.visited = new Set();
    this.validatedFileIds = new Set();
  }

  addDiscovered(symbolId: number, relevance: number): boolean {
    if (this.discovered.has(symbolId)) {
      return false;
    }
    this.discovered.set(symbolId, relevance);
    return true;
  }

  isDiscovered(symbolId: number): boolean {
    return this.discovered.has(symbolId);
  }

  markVisited(symbolId: number): void {
    this.visited.add(symbolId);
  }

  isVisited(symbolId: number): boolean {
    return this.visited.has(symbolId);
  }

  addValidatedFile(fileId: number): void {
    this.validatedFileIds.add(fileId);
  }

  isFileValidated(fileId: number): boolean {
    return this.validatedFileIds.has(fileId);
  }

  initializeFromSymbols(symbols: Map<number, SymbolInfo>): void {
    for (const [_, symbol] of symbols) {
      if (symbol?.file_id) {
        this.validatedFileIds.add(symbol.file_id);
      }
    }
  }

  hasExceededLimits(maxVisitedNodes: number): boolean {
    return this.visited.size > maxVisitedNodes;
  }

  getResults(): DiscoveryResult {
    return this.discovered;
  }

  getSize(): { discovered: number; visited: number } {
    return {
      discovered: this.discovered.size,
      visited: this.visited.size,
    };
  }
}
