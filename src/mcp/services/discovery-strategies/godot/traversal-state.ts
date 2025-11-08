/**
 * Godot Traversal State
 *
 * Manages state during BFS traversal in Godot feature discovery.
 * Tracks visited symbols, discovered symbols with relevance scores,
 * and validated files to prevent pollution.
 */

import type { DiscoveryResult } from '../common/types';
import type { GodotSymbolInfo } from './symbol-classifier';

export class GodotTraversalState {
  private visited = new Set<number>();
  private discovered = new Map<number, number>();
  private validatedFiles = new Set<number>();

  /**
   * Mark symbol as visited to avoid re-processing.
   */
  markVisited(symbolId: number): void {
    this.visited.add(symbolId);
  }

  /**
   * Check if symbol has been visited.
   */
  isVisited(symbolId: number): boolean {
    return this.visited.has(symbolId);
  }

  /**
   * Add discovered symbol with relevance score.
   */
  addDiscovered(symbolId: number, relevance: number): void {
    const existingRelevance = this.discovered.get(symbolId);
    if (existingRelevance === undefined || relevance > existingRelevance) {
      this.discovered.set(symbolId, relevance);
    }
  }

  /**
   * Check if symbol has been discovered.
   */
  isDiscovered(symbolId: number): boolean {
    return this.discovered.has(symbolId);
  }

  /**
   * Mark file as validated (contains architectural entities).
   */
  addValidatedFile(fileId: number): void {
    this.validatedFiles.add(fileId);
  }

  /**
   * Check if file has been validated.
   */
  isFileValidated(fileId: number): boolean {
    return this.validatedFiles.has(fileId);
  }

  /**
   * Initialize state from starting symbols.
   */
  initializeFromSymbols(symbols: Map<number, GodotSymbolInfo>): void {
    symbols.forEach((symbol, id) => {
      this.markVisited(id);
      this.addDiscovered(id, 1.0);
      if (symbol.file_id) {
        this.addValidatedFile(symbol.file_id);
      }
    });
  }

  /**
   * Check if visited nodes limit exceeded.
   */
  hasExceededLimits(maxVisitedNodes: number): boolean {
    return this.visited.size >= maxVisitedNodes;
  }

  /**
   * Get current state size for logging.
   */
  getSize(): { visited: number; discovered: number; validatedFiles: number } {
    return {
      visited: this.visited.size,
      discovered: this.discovered.size,
      validatedFiles: this.validatedFiles.size,
    };
  }

  /**
   * Get discovery results.
   */
  getResults(): DiscoveryResult {
    return this.discovered;
  }
}
