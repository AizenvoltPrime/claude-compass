/**
 * Godot Autoload Strategy
 *
 * Discovers global singleton autoloads and their usage patterns.
 * Autoloads are accessed globally across the game.
 */

import type { Knex } from 'knex';
import * as SymbolService from '../../../../database/services/symbol-service';
import {
  DiscoveryStrategy,
  DiscoveryContext,
  DiscoveryResult,
} from '../common/types';
import { GodotSymbolInfo } from './symbol-classifier';

interface AutoloadInfo {
  id: number;
  autoload_name: string;
  script_path: string;
  symbol_id: number | null;
}

export class AutoloadStrategy implements DiscoveryStrategy {
  readonly name = 'godot-autoload';
  readonly description = 'Discovers global autoload singletons and their callers';
  readonly priority = 9;

  constructor(private db: Knex) {}

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const discovered = new Map<number, number>();
    const { currentSymbols, repoId, options, iteration } = context;
    const maxDepth = options.maxDepth;
    const relevance = 1.0 - (iteration + 1) / (maxDepth + 1);

    for (const symbolId of currentSymbols) {
      try {
        const symbol = await SymbolService.getSymbol(this.db, symbolId);
        if (!symbol) continue;

        const autoload = await this.findAutoloadForSymbol(symbolId, repoId);
        if (autoload && autoload.symbol_id) {
          discovered.set(autoload.symbol_id, relevance);

          const autoloadCallers = await this.findAutoloadCallers(autoload.symbol_id, repoId);
          // Autoload callers: 0.9x relevance (indirect - calling through global singleton)
          autoloadCallers.forEach(caller => discovered.set(caller.id, relevance * 0.9));
        }

        const referencedAutoloads = await this.findReferencedAutoloads(symbolId, repoId);
        referencedAutoloads.forEach(autoloadSym => {
          if (autoloadSym.symbol_id) {
            discovered.set(autoloadSym.symbol_id, relevance);
          }
        });
      } catch (error) {
        console.error(`[godot-autoload] Error processing symbol ${symbolId}:`, error);
        continue;
      }
    }

    return discovered;
  }

  private async findAutoloadForSymbol(
    symbolId: number,
    repoId: number
  ): Promise<AutoloadInfo | null> {
    const result = await this.db('godot_autoloads')
      .select('id', 'autoload_name', 'script_path', 'symbol_id')
      .where('symbol_id', symbolId)
      .where('repo_id', repoId)
      .first();

    return result || null;
  }

  private async findAutoloadCallers(
    autoloadSymbolId: number,
    repoId: number
  ): Promise<GodotSymbolInfo[]> {
    const results = await this.db('dependencies as d')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .join('files as f', 's.file_id', 'f.id')
      .select('s.id', 's.name', 's.symbol_type', 's.entity_type', 's.file_id')
      .where('d.to_symbol_id', autoloadSymbolId)
      .where('f.repo_id', repoId)
      .whereIn('d.dependency_type', ['calls', 'references']);

    return results;
  }

  private async findReferencedAutoloads(
    callerSymbolId: number,
    repoId: number
  ): Promise<AutoloadInfo[]> {
    const results = await this.db('dependencies as d')
      .join('godot_autoloads as ga', 'd.to_symbol_id', 'ga.symbol_id')
      .select('ga.id', 'ga.autoload_name', 'ga.script_path', 'ga.symbol_id')
      .where('d.from_symbol_id', callerSymbolId)
      .where('ga.repo_id', repoId)
      .whereIn('d.dependency_type', ['calls', 'references']);

    return results;
  }
}
