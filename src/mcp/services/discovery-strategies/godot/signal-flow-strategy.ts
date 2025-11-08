/**
 * Godot Signal Flow Strategy
 *
 * Discovers methods connected via Godot's signal system.
 * Follows both signal emissions (EmitSignal) and connections (Connect).
 */

import type { Knex } from 'knex';
import * as SymbolService from '../../../../database/services/symbol-service';
import {
  DiscoveryStrategy,
  DiscoveryContext,
  DiscoveryResult,
} from '../common/types';
import { GodotSymbolInfo } from './symbol-classifier';

export class SignalFlowStrategy implements DiscoveryStrategy {
  readonly name = 'godot-signal-flow';
  readonly description = 'Follows signal-slot connections in Godot event system';
  readonly priority = 7;

  constructor(private db: Knex) {}

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const discovered = new Map<number, number>();
    const { currentSymbols, repoId, options, iteration } = context;
    const maxDepth = options.maxDepth;
    const relevance = 1.0 - (iteration + 1) / (maxDepth + 1);

    for (const symbolId of currentSymbols) {
      try {
        const symbol = await SymbolService.getSymbol(this.db, symbolId);
        if (!symbol || !['method', 'function'].includes(symbol.symbol_type)) continue;

        const connectedMethods = await this.findSignalConnections(symbolId, repoId);
        connectedMethods.forEach(method => discovered.set(method.id, relevance));

        const emittingMethods = await this.findSignalEmitters(symbolId, repoId);
        emittingMethods.forEach(method => discovered.set(method.id, relevance));
      } catch (error) {
        console.error(`[godot-signal-flow] Error processing symbol ${symbolId}:`, error);
        continue;
      }
    }

    return discovered;
  }

  private async findSignalConnections(
    methodSymbolId: number,
    repoId: number
  ): Promise<GodotSymbolInfo[]> {
    const results = await this.db('dependencies as d')
      .join('symbols as s', 'd.to_symbol_id', 's.id')
      .join('files as f', 's.file_id', 'f.id')
      .select('s.id', 's.name', 's.symbol_type', 's.entity_type', 's.file_id')
      .where('d.from_symbol_id', methodSymbolId)
      .where('d.dependency_type', 'signal_connection')
      .where('f.repo_id', repoId);

    return results;
  }

  private async findSignalEmitters(
    methodSymbolId: number,
    repoId: number
  ): Promise<GodotSymbolInfo[]> {
    const results = await this.db('dependencies as d')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .join('files as f', 's.file_id', 'f.id')
      .select('s.id', 's.name', 's.symbol_type', 's.entity_type', 's.file_id')
      .where('d.to_symbol_id', methodSymbolId)
      .where('d.dependency_type', 'signal_connection')
      .where('f.repo_id', repoId);

    return results;
  }
}
