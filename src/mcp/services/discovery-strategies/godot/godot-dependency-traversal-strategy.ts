/**
 * Godot Dependency Traversal Strategy
 *
 * Executor-centric BFS traversal for Godot game architecture.
 * Follows C# dependency graph (calls, contains, references) using Godot-specific traversal rules.
 */

import type { Knex } from 'knex';
import * as SymbolService from '../../../../database/services/symbol-service';
import {
  DiscoveryStrategy,
  DiscoveryContext,
  DiscoveryResult,
} from '../common/types';
import {
  GodotSymbolInfo,
  GodotSymbolRole,
  GodotTraversalDirection,
  classifyGodotSymbol,
  getGodotTraversalDirection,
} from './symbol-classifier';

export class GodotDependencyTraversalStrategy implements DiscoveryStrategy {
  readonly name = 'godot-dependency-traversal';
  readonly description = 'Executor-centric BFS traversal for Godot C# dependencies';
  readonly priority = 10;

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

        const role = classifyGodotSymbol(symbol);
        const direction = getGodotTraversalDirection(symbol, role);

        if (role === GodotSymbolRole.EXECUTOR) {
          const deps = await this.getExecutorDependencies(symbolId, direction, repoId);
          deps.forEach(dep => discovered.set(dep.id, relevance));
        } else if (role === GodotSymbolRole.CONTAINER) {
          const executors = await this.expandContainerToExecutors(symbolId, repoId);
          // Container expansion: 0.9x relevance (one level of indirection - container to executor)
          executors.forEach(exec => discovered.set(exec.id, relevance * 0.9));
        }
      } catch (error) {
        console.error(`[godot-dependency-traversal] Error processing symbol ${symbolId}:`, error);
        continue;
      }
    }

    return discovered;
  }

  private async getExecutorDependencies(
    symbolId: number,
    direction: GodotTraversalDirection,
    repoId: number
  ): Promise<GodotSymbolInfo[]> {
    const dependencies: GodotSymbolInfo[] = [];

    if (direction === 'forward' || direction === 'both') {
      const forward = await this.db('dependencies as d')
        .join('symbols as s', 'd.to_symbol_id', 's.id')
        .join('files as f', 's.file_id', 'f.id')
        .select('s.id', 's.name', 's.symbol_type', 's.entity_type', 's.file_id')
        .where('d.from_symbol_id', symbolId)
        .where('f.repo_id', repoId)
        .whereIn('d.dependency_type', ['calls', 'references', 'signal_connection']);

      dependencies.push(...forward);
    }

    if (direction === 'backward' || direction === 'both') {
      const backward = await this.db('dependencies as d')
        .join('symbols as s', 'd.from_symbol_id', 's.id')
        .join('files as f', 's.file_id', 'f.id')
        .select('s.id', 's.name', 's.symbol_type', 's.entity_type', 's.file_id')
        .where('d.to_symbol_id', symbolId)
        .where('f.repo_id', repoId)
        .whereIn('d.dependency_type', ['calls', 'references', 'signal_connection']);

      dependencies.push(...backward);
    }

    return dependencies;
  }

  private async expandContainerToExecutors(
    containerId: number,
    repoId: number
  ): Promise<GodotSymbolInfo[]> {
    const executors = await this.db('dependencies as d')
      .join('symbols as s', 'd.to_symbol_id', 's.id')
      .join('files as f', 's.file_id', 'f.id')
      .select('s.id', 's.name', 's.symbol_type', 's.entity_type', 's.file_id')
      .where('d.from_symbol_id', containerId)
      .where('d.dependency_type', 'contains')
      .where('f.repo_id', repoId)
      .whereIn('s.symbol_type', ['method', 'function']);

    return executors;
  }
}
