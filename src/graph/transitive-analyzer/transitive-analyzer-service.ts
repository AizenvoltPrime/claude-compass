import type { Knex } from 'knex';
import { getDatabaseConnection } from '../../database/connection';
import { DependencyType } from '../../database/models';
import {
  TransitiveAnalysisOptions,
  TransitiveAnalysisResult,
  TransitiveResult,
  CrossStackOptions,
  CrossStackImpactResult,
} from './types';
import { enhanceResultsWithCallChains, formatCallChain } from './call-chain-formatter';
import { getCrossStackRelationships } from './query-service';
import {
  traverseCallers,
  traverseCallersWithCrossStackSupport,
  traverseDependencies,
} from './traversal-algorithms';
import { findShortestPath, findAllPaths } from './pathfinding-algorithms';

/**
 * TransitiveAnalyzer provides efficient algorithms for analyzing transitive dependencies
 * and callers in the symbol dependency graph. It implements cycle detection,
 * traversal algorithms, and performance optimization for large codebases.
 */
export class TransitiveAnalyzer {
  private db: Knex;
  private cache: Map<string, TransitiveResult[]> = new Map();
  private readonly MAX_ABSOLUTE_DEPTH = 20;
  private readonly DEFAULT_MAX_DEPTH = 10;

  constructor() {
    this.db = getDatabaseConnection();
  }

  async getTransitiveCallers(
    symbolId: number,
    options: TransitiveAnalysisOptions = {}
  ): Promise<TransitiveAnalysisResult> {
    const maxDepth = Math.min(
      options.maxDepth || this.DEFAULT_MAX_DEPTH,
      this.MAX_ABSOLUTE_DEPTH
    );
    const includeCrossStack = options.includeCrossStack || false;

    if (includeCrossStack) {
      return this.traverseCallersWithCrossStack(symbolId, options);
    } else {
      return this.traverseCallersOriginal(symbolId, options);
    }
  }

  private async traverseCallersOriginal(
    symbolId: number,
    options: TransitiveAnalysisOptions
  ): Promise<TransitiveAnalysisResult> {
    const startTime = Date.now();
    const maxDepth = Math.min(
      options.maxDepth || this.DEFAULT_MAX_DEPTH,
      this.MAX_ABSOLUTE_DEPTH
    );

    const visited = new Set<number>();
    const cycles = new Set<string>();
    const results: TransitiveResult[] = [];
    let maxDepthReached = 0;

    await traverseCallers(
      symbolId,
      [],
      0,
      maxDepth,
      visited,
      cycles,
      results,
      options,
      this.db
    );

    maxDepthReached = Math.max(...results.map(r => r.depth), 0);

    const enhancedResults = await enhanceResultsWithCallChains(
      results,
      options.showCallChains || false,
      this.db
    );

    return {
      results: enhancedResults,
      maxDepthReached,
      totalPaths: enhancedResults.length,
      cyclesDetected: cycles.size,
      executionTimeMs: Date.now() - startTime,
    };
  }

  private async traverseCallersWithCrossStack(
    symbolId: number,
    options: TransitiveAnalysisOptions
  ): Promise<TransitiveAnalysisResult> {
    const startTime = Date.now();
    const maxDepth = Math.min(
      options.maxDepth || this.DEFAULT_MAX_DEPTH,
      this.MAX_ABSOLUTE_DEPTH
    );

    const visited = new Set<number>();
    const cycles = new Set<string>();
    const results: TransitiveResult[] = [];
    let maxDepthReached = 0;

    const enhancedOptions: TransitiveAnalysisOptions = {
      ...options,
      includeTypes: options.includeTypes
        ? [
            ...options.includeTypes,
            DependencyType.API_CALL,
            DependencyType.SHARES_SCHEMA,
            DependencyType.FRONTEND_BACKEND,
          ]
        : undefined,
    };

    await traverseCallersWithCrossStackSupport(
      symbolId,
      [],
      0,
      maxDepth,
      visited,
      cycles,
      results,
      enhancedOptions,
      this.db
    );

    maxDepthReached = Math.max(...results.map(r => r.depth), 0);

    const enhancedResults = await enhanceResultsWithCallChains(
      results,
      options.showCallChains || false,
      this.db
    );

    return {
      results: enhancedResults,
      maxDepthReached,
      totalPaths: enhancedResults.length,
      cyclesDetected: cycles.size,
      executionTimeMs: Date.now() - startTime,
    };
  }

  async getTransitiveDependencies(
    symbolId: number,
    options: TransitiveAnalysisOptions = {}
  ): Promise<TransitiveAnalysisResult> {
    const startTime = Date.now();
    const maxDepth = Math.min(
      options.maxDepth || this.DEFAULT_MAX_DEPTH,
      this.MAX_ABSOLUTE_DEPTH
    );

    const visited = new Set<number>();
    const cycles = new Set<string>();
    const results: TransitiveResult[] = [];
    let maxDepthReached = 0;

    await traverseDependencies(
      symbolId,
      [],
      0,
      maxDepth,
      visited,
      cycles,
      results,
      options,
      this.db
    );

    maxDepthReached = Math.max(...results.map(r => r.depth), 0);

    const enhancedResults = await enhanceResultsWithCallChains(
      results,
      options.showCallChains || false,
      this.db
    );

    return {
      results: enhancedResults,
      maxDepthReached,
      totalPaths: enhancedResults.length,
      cyclesDetected: cycles.size,
      executionTimeMs: Date.now() - startTime,
    };
  }

  async getCrossStackTransitiveImpact(
    symbolId: number,
    options: CrossStackOptions = {}
  ): Promise<CrossStackImpactResult> {
    const startTime = Date.now();
    const maxDepth = Math.min(
      options.maxDepth || this.DEFAULT_MAX_DEPTH,
      this.MAX_ABSOLUTE_DEPTH
    );

    const frontendOptions: TransitiveAnalysisOptions = {
      maxDepth,
      includeCrossStack: true,
      includeTypes: [
        DependencyType.API_CALL,
        DependencyType.SHARES_SCHEMA,
        DependencyType.FRONTEND_BACKEND,
      ],
    };

    const frontendImpactResult = options.includeTransitive
      ? await this.getTransitiveCallers(symbolId, frontendOptions)
      : { results: [], maxDepthReached: 0, totalPaths: 0, cyclesDetected: 0, executionTimeMs: 0 };

    const backendOptions: TransitiveAnalysisOptions = {
      maxDepth,
      includeCrossStack: true,
      includeTypes: [
        DependencyType.API_CALL,
        DependencyType.SHARES_SCHEMA,
        DependencyType.FRONTEND_BACKEND,
      ],
    };

    const backendImpactResult = options.includeTransitive
      ? await this.getTransitiveDependencies(symbolId, backendOptions)
      : { results: [], maxDepthReached: 0, totalPaths: 0, cyclesDetected: 0, executionTimeMs: 0 };

    const crossStackRelationships = await getCrossStackRelationships(symbolId, this.db);

    const executionTime = Date.now() - startTime;

    return {
      symbolId,
      frontendImpact: frontendImpactResult.results,
      backendImpact: backendImpactResult.results,
      crossStackRelationships,
      totalImpactedSymbols:
        frontendImpactResult.results.length + backendImpactResult.results.length,
      executionTimeMs: executionTime,
    };
  }

  async formatCallChain(path: number[]): Promise<string> {
    return formatCallChain(path, this.db);
  }

  async findShortestPath(
    startSymbolId: number,
    endSymbolId: number,
    options: TransitiveAnalysisOptions = {}
  ): Promise<{ path: number[]; distance: number } | null> {
    return findShortestPath(startSymbolId, endSymbolId, options, this.db);
  }

  async findAllPaths(
    startSymbolId: number,
    endSymbolId: number,
    maxDepth: number = 10,
    options: TransitiveAnalysisOptions = {}
  ): Promise<number[][]> {
    return findAllPaths(startSymbolId, endSymbolId, maxDepth, options, this.db);
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export const transitiveAnalyzer = new TransitiveAnalyzer();
