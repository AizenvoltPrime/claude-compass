import type { Knex } from 'knex';
import { getDatabaseConnection } from '../database/connection';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('community-detector');

export interface Module {
  id: string;
  name: string;
  symbols: number[];
  internalEdges: number;
  externalEdges: number;
  modularity: number;
  files: string[];
  frameworks: string[];
}

export interface CommunityDetectionResult {
  modules: Module[];
  totalModularity: number;
  executionTimeMs: number;
}

/**
 * CommunityDetector implements the Louvain algorithm for discovering
 * architectural modules in codebases. It identifies clusters of symbols
 * that work closely together, representing natural boundaries like
 * "Authentication", "Payment Processing", or "API Routing".
 *
 * The Louvain algorithm is a hierarchical clustering method that optimizes
 * modularity by iteratively moving nodes between communities. It's particularly
 * effective for large graphs and produces high-quality community structures.
 *
 * @example
 * ```typescript
 * const detector = new CommunityDetector();
 * const result = await detector.detectModules(repoId, {
 *   minModuleSize: 5,      // Minimum symbols per module
 *   resolution: 1.2        // Higher = more granular modules
 * });
 *
 * console.log(`Found ${result.modules.length} modules`);
 * console.log(`Total modularity: ${result.totalModularity}`);
 * ```
 */
export class CommunityDetector {
  private static readonly DEFAULT_MIN_MODULE_SIZE = 3;
  private static readonly DEFAULT_RESOLUTION = 1.0;
  private static readonly MAX_LOUVAIN_ITERATIONS = 10;

  private db: Knex;

  constructor() {
    this.db = getDatabaseConnection();
  }

  /**
   * Detect modules using the Louvain community detection algorithm.
   *
   * This method analyzes the dependency graph of a repository and identifies
   * clusters of symbols that are densely connected internally but loosely
   * connected externally. Each cluster represents an architectural module.
   *
   * @param repoId - Database ID of the repository to analyze
   * @param options - Configuration options for module detection
   * @param options.minModuleSize - Minimum number of symbols required per module (default: 3).
   *                                 Smaller modules are filtered out as noise.
   * @param options.resolution - Resolution parameter for the Louvain algorithm (default: 1.0).
   *                            Higher values (>1.0) produce more granular modules,
   *                            lower values (<1.0) produce fewer, larger modules.
   * @returns Detection results including modules, modularity score, and execution time
   */
  async detectModules(repoId: number, options?: {
    minModuleSize?: number;
    resolution?: number;
  }): Promise<CommunityDetectionResult> {
    const startTime = Date.now();
    const minModuleSize = options?.minModuleSize || CommunityDetector.DEFAULT_MIN_MODULE_SIZE;
    const resolution = options?.resolution || CommunityDetector.DEFAULT_RESOLUTION;

    logger.info('Starting community detection', { repoId, minModuleSize, resolution });

    const graph = await this.buildAdjacencyGraph(repoId);
    const communities = this.louvainCommunityDetection(graph, resolution);
    const modules = await this.enrichCommunities(communities, graph, repoId);
    const totalModularity = this.calculateModularity(graph, communities);
    const filteredModules = modules.filter(m => m.symbols.length >= minModuleSize);

    logger.info('Community detection complete', {
      modulesFound: filteredModules.length,
      modularity: totalModularity,
      executionTimeMs: Date.now() - startTime,
    });

    return {
      modules: filteredModules,
      totalModularity,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Build adjacency graph from database dependencies
   */
  private async buildAdjacencyGraph(repoId: number): Promise<Map<number, Set<number>>> {
    const dependencies = await this.db('dependencies')
      .join('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .join('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
      .join('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .join('files as to_files', 'to_symbols.file_id', 'to_files.id')
      .where('from_files.repo_id', repoId)
      .where('to_files.repo_id', repoId)
      .select('dependencies.from_symbol_id', 'dependencies.to_symbol_id');

    const graph = new Map<number, Set<number>>();

    for (const dep of dependencies) {
      if (!graph.has(dep.from_symbol_id)) {
        graph.set(dep.from_symbol_id, new Set());
      }
      if (!graph.has(dep.to_symbol_id)) {
        graph.set(dep.to_symbol_id, new Set());
      }

      graph.get(dep.from_symbol_id)!.add(dep.to_symbol_id);
      graph.get(dep.to_symbol_id)!.add(dep.from_symbol_id);
    }

    logger.debug('Adjacency graph built', {
      nodes: graph.size,
      edges: dependencies.length,
    });

    return graph;
  }

  /**
   * Louvain community detection algorithm
   * This is a simplified implementation - for production use, consider using a library like graphology
   */
  private louvainCommunityDetection(
    graph: Map<number, Set<number>>,
    resolution: number
  ): Map<number, number> {
    const communities = new Map<number, number>();

    let communityId = 0;
    for (const node of graph.keys()) {
      communities.set(node, communityId++);
    }

    let improved = true;
    let iteration = 0;
    const maxIterations = CommunityDetector.MAX_LOUVAIN_ITERATIONS;

    while (improved && iteration < maxIterations) {
      improved = false;
      iteration++;

      for (const node of graph.keys()) {
        const currentCommunity = communities.get(node)!;
        const neighborCommunities = this.getNeighborCommunities(node, graph, communities);

        let bestCommunity = currentCommunity;
        let bestModularityGain = 0;

        for (const [neighborCommunity, _] of neighborCommunities) {
          const modularityGain = this.calculateModularityGain(
            node,
            currentCommunity,
            neighborCommunity,
            graph,
            communities,
            resolution
          );

          if (modularityGain > bestModularityGain) {
            bestModularityGain = modularityGain;
            bestCommunity = neighborCommunity;
          }
        }

        if (bestCommunity !== currentCommunity) {
          communities.set(node, bestCommunity);
          improved = true;
        }
      }

      logger.debug('Louvain iteration complete', { iteration, improved });
    }

    return this.normalizeCommunityIds(communities);
  }

  /**
   * Get neighboring communities for a node
   */
  private getNeighborCommunities(
    node: number,
    graph: Map<number, Set<number>>,
    communities: Map<number, number>
  ): Map<number, number> {
    const neighborCommunities = new Map<number, number>();
    const neighbors = graph.get(node) || new Set();

    for (const neighbor of neighbors) {
      const community = communities.get(neighbor)!;
      neighborCommunities.set(community, (neighborCommunities.get(community) || 0) + 1);
    }

    return neighborCommunities;
  }

  /**
   * Calculate modularity gain from moving a node to a different community
   * Simplified version of the Newman-Girvan modularity metric
   */
  private calculateModularityGain(
    node: number,
    fromCommunity: number,
    toCommunity: number,
    graph: Map<number, Set<number>>,
    communities: Map<number, number>,
    resolution: number
  ): number {
    if (fromCommunity === toCommunity) {
      return 0;
    }

    const neighbors = graph.get(node) || new Set();
    let internalEdges = 0;
    let externalEdges = 0;

    for (const neighbor of neighbors) {
      const neighborCommunity = communities.get(neighbor)!;
      if (neighborCommunity === toCommunity) {
        internalEdges++;
      } else if (neighborCommunity === fromCommunity) {
        externalEdges++;
      }
    }

    const gain = (internalEdges - externalEdges) * resolution;
    return gain;
  }

  /**
   * Calculate overall modularity of the community structure
   */
  private calculateModularity(
    graph: Map<number, Set<number>>,
    communities: Map<number, number>
  ): number {
    const totalEdges = Array.from(graph.values()).reduce(
      (sum, neighbors) => sum + neighbors.size,
      0
    ) / 2;

    if (totalEdges === 0) {
      return 0;
    }

    let modularity = 0;
    const communityGroups = new Map<number, Set<number>>();

    for (const [node, community] of communities) {
      if (!communityGroups.has(community)) {
        communityGroups.set(community, new Set());
      }
      communityGroups.get(community)!.add(node);
    }

    for (const nodes of communityGroups.values()) {
      let internalEdges = 0;
      let totalDegree = 0;

      for (const node of nodes) {
        const neighbors = graph.get(node) || new Set();
        totalDegree += neighbors.size;

        for (const neighbor of neighbors) {
          if (nodes.has(neighbor)) {
            internalEdges++;
          }
        }
      }

      internalEdges /= 2;
      const expectedEdges = (totalDegree * totalDegree) / (4 * totalEdges);
      modularity += (internalEdges - expectedEdges) / totalEdges;
    }

    return modularity;
  }

  /**
   * Normalize community IDs to be sequential starting from 0
   */
  private normalizeCommunityIds(communities: Map<number, number>): Map<number, number> {
    const uniqueCommunities = new Set(communities.values());
    const communityMapping = new Map<number, number>();

    let newId = 0;
    for (const oldId of uniqueCommunities) {
      communityMapping.set(oldId, newId++);
    }

    const normalized = new Map<number, number>();
    for (const [node, oldCommunity] of communities) {
      normalized.set(node, communityMapping.get(oldCommunity)!);
    }

    return normalized;
  }

  /**
   * Enrich communities with metadata (files, frameworks, names)
   */
  private async enrichCommunities(
    communities: Map<number, number>,
    graph: Map<number, Set<number>>,
    repoId: number
  ): Promise<Module[]> {
    const communityGroups = new Map<number, Set<number>>();
    for (const [symbolId, communityId] of communities) {
      if (!communityGroups.has(communityId)) {
        communityGroups.set(communityId, new Set());
      }
      communityGroups.get(communityId)!.add(symbolId);
    }

    const modules: Module[] = [];

    for (const [communityId, symbolIds] of communityGroups) {
      const symbols = await this.db('symbols')
        .join('files', 'symbols.file_id', 'files.id')
        .whereIn('symbols.id', Array.from(symbolIds))
        .select('symbols.id', 'symbols.name', 'files.path', 'files.language');

      if (symbols.length === 0) {
        logger.warn('No symbols found for community', {
          communityId,
          symbolIds: Array.from(symbolIds)
        });
        continue;
      }

      const { internalEdges, externalEdges } = this.calculateEdgeStats(
        symbolIds,
        graph,
        communities
      );

      const moduleName = this.inferModuleName(symbols);
      const files = [...new Set(symbols.map(s => s.path))];
      const frameworks = this.detectFrameworks(files);

      modules.push({
        id: `module_${communityId}`,
        name: moduleName,
        symbols: Array.from(symbolIds),
        internalEdges,
        externalEdges,
        modularity: internalEdges / (internalEdges + externalEdges || 1),
        files,
        frameworks,
      });
    }

    return modules;
  }

  /**
   * Calculate internal and external edges for a community
   */
  private calculateEdgeStats(
    symbolIds: Set<number>,
    graph: Map<number, Set<number>>,
    communities: Map<number, number>
  ): { internalEdges: number; externalEdges: number } {
    let internalEdges = 0;
    let externalEdges = 0;

    for (const symbolId of symbolIds) {
      const neighbors = graph.get(symbolId) || new Set();
      for (const neighbor of neighbors) {
        if (symbolIds.has(neighbor)) {
          internalEdges++;
        } else {
          externalEdges++;
        }
      }
    }

    return { internalEdges: internalEdges / 2, externalEdges };
  }

  /**
   * Infer module name from common path patterns
   */
  private inferModuleName(symbols: any[]): string {
    if (symbols.length === 0) {
      return 'Unknown Module';
    }

    const paths = symbols.map(s => s.path);
    const commonPath = this.findCommonPath(paths);

    if (commonPath) {
      const parts = commonPath.split(/[/\\]/);
      const meaningfulPart = parts.find(p =>
        ['Controllers', 'Services', 'Models', 'Components', 'Utils', 'Helpers'].some(
          keyword => p.includes(keyword)
        )
      );

      if (meaningfulPart) {
        return meaningfulPart.replace(/Controllers?|Services?|Models?|Components?/, '').trim() || meaningfulPart;
      }

      return parts[parts.length - 1] || 'Module';
    }

    // Fallback: use most common symbol name prefix
    const names = symbols.map(s => s.name);
    const commonPrefix = this.findCommonPrefix(names);

    return commonPrefix || 'Module';
  }

  /**
   * Find common path prefix among file paths
   */
  private findCommonPath(paths: string[]): string {
    if (paths.length === 0) return '';
    if (paths.length === 1) return paths[0];

    const splitPaths = paths.map(p => p.split(/[/\\]/));
    const commonParts: string[] = [];

    for (let i = 0; i < splitPaths[0].length; i++) {
      const part = splitPaths[0][i];
      if (splitPaths.every(p => p[i] === part)) {
        commonParts.push(part);
      } else {
        break;
      }
    }

    return commonParts.join('/');
  }

  /**
   * Find common prefix among symbol names
   */
  private findCommonPrefix(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];

    let prefix = names[0];
    for (let i = 1; i < names.length; i++) {
      while (names[i].indexOf(prefix) !== 0) {
        prefix = prefix.substring(0, prefix.length - 1);
        if (prefix === '') return '';
      }
    }

    return prefix.length > 2 ? prefix : '';
  }

  /**
   * Detect frameworks from file paths
   */
  private detectFrameworks(paths: string[]): string[] {
    const frameworks = new Set<string>();

    for (const path of paths) {
      if (path.includes('/Controllers/') || path.includes('/Models/')) {
        frameworks.add('laravel');
      }
      if (path.endsWith('.vue')) {
        frameworks.add('vue');
      }
      if (path.includes('/Components/') && path.endsWith('.tsx')) {
        frameworks.add('react');
      }
      if (path.endsWith('.cs')) {
        frameworks.add('csharp');
      }
    }

    return Array.from(frameworks);
  }
}

// Export singleton instance
export const communityDetector = new CommunityDetector();
