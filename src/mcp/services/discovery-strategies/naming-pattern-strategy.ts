/**
 * Naming Pattern Strategy
 *
 * Discovers symbols that match naming patterns derived from the feature name.
 * This catches symbols that may not be directly connected in the dependency graph
 * but are conceptually part of the same feature.
 *
 * Examples:
 * - Feature: "VehicleCameraAlert"
 * - Matches: "VehicleCameraAlertController", "createVehicleCameraAlert",
 *            "CameraAlert*", "getCameraAlerts", etc.
 */

import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';
import { DEFAULT_SEARCH_LIMIT, FUNCTION_SAMPLE_SIZE_FOR_VERBS } from './constants';

const logger = createComponentLogger('naming-pattern-strategy');

export class NamingPatternStrategy implements DiscoveryStrategy {
  readonly name = 'naming-pattern';
  readonly description = 'Symbol discovery via naming pattern matching';
  readonly priority = 20; // Run after dependency traversal

  private suffixCache = new Map<number, { suffixes: string[]; verbs: string[] }>();

  constructor(private dbService: DatabaseService) {}

  /**
   * Run on first iteration only - naming patterns don't change.
   */
  shouldRun(context: DiscoveryContext): boolean {
    return context.iteration === 0;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { featureName, repoId, options } = context;

    // Auto-detect naming patterns from repository
    const detected = await this.detectCommonPatterns(repoId);
    const patterns = this.generateNamingPatterns(
      featureName,
      options.namingDepth,
      detected
    );

    logger.debug('Starting naming pattern search', {
      featureName,
      patterns: patterns.length,
      depth: options.namingDepth,
      detectedSuffixes: detected.suffixes.length,
      detectedVerbs: detected.verbs.length,
    });

    const related = new Set<number>();

    for (const pattern of patterns) {
      const symbols = await this.dbService.searchSymbols(pattern, repoId, {
        limit: DEFAULT_SEARCH_LIMIT,
        symbolTypes: [],
      });
      symbols.forEach(s => related.add(s.id));
    }

    // Convert to relevance map (all naming-discovered symbols get same score)
    const result = new Map<number, number>();
    related.forEach(id => result.set(id, 0.7));

    logger.debug('Naming pattern search complete', {
      discovered: result.size,
      patterns: patterns.length,
    });

    return result;
  }

  /**
   * Auto-detect common naming patterns from the repository.
   * Analyzes existing symbols to find suffixes and verb prefixes.
   */
  private async detectCommonPatterns(
    repoId: number
  ): Promise<{ suffixes: string[]; verbs: string[] }> {
    // Check cache first
    if (this.suffixCache.has(repoId)) {
      return this.suffixCache.get(repoId)!;
    }

    const db = this.dbService.knex;

    // 1. Detect suffixes from entity_types
    const entityTypes = await db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .whereNotNull('symbols.entity_type')
      .distinct('symbols.entity_type')
      .pluck('entity_type');

    const suffixes = new Set<string>();
    for (const entityType of entityTypes) {
      // Capitalize (e.g., "controller" → "Controller")
      const capitalized = entityType.charAt(0).toUpperCase() + entityType.slice(1);
      suffixes.add(capitalized);
    }

    // 2. Detect common verb prefixes from function/method names
    const functionNames: { name: string }[] = await db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .whereIn('symbols.symbol_type', ['function', 'method'])
      .select('symbols.name')
      .limit(FUNCTION_SAMPLE_SIZE_FOR_VERBS); // Sample to avoid huge queries

    const verbs = new Set<string>();
    const verbPattern = /^(create|get|update|delete|handle|process|fetch|load|save|remove|add|set|check|validate|build|generate|find|make|show|edit|destroy|store|index|search|filter|sort|toggle|enable|disable|register|unregister|start|stop|run|execute|invoke|trigger|emit|dispatch|subscribe|unsubscribe|watch|unwatch|mount|unmount|render|draw|spawn|despawn|initialize|cleanup)/i;

    for (const { name } of functionNames) {
      const match = name.match(verbPattern);
      if (match) {
        verbs.add(match[1].toLowerCase());
      }
    }

    const result = {
      suffixes: Array.from(suffixes),
      verbs: Array.from(verbs),
    };

    this.suffixCache.set(repoId, result);

    logger.debug('Auto-detected naming patterns', {
      repoId,
      suffixes: result.suffixes.length,
      verbs: result.verbs.length,
      sampleSuffixes: result.suffixes.slice(0, 5),
      sampleVerbs: result.verbs.slice(0, 5),
    });

    return result;
  }

  /**
   * Extract partial names from CamelCase strings (framework-agnostic).
   * E.g., "VehicleCameraAlert" → ["CameraAlert", "Alert"]
   *      "CardManager" → ["Manager"]
   *      "getUserData" → ["UserData", "Data"]
   */
  private extractPartialNames(name: string): string[] {
    const words = name.split(/(?=[A-Z])/);
    const partials: string[] = [];

    for (let i = 1; i < words.length; i++) {
      partials.push(words.slice(i).join(''));
    }

    return partials;
  }

  /**
   * Generate naming patterns based on feature name and auto-detected patterns.
   *
   * Depth 1: Detected suffixes + common verbs
   * Depth 2: Add plurals and partial name variations
   * Depth 3: Add "use" prefix for composables/hooks
   */
  private generateNamingPatterns(
    featureName: string,
    depth: number,
    detected: { suffixes: string[]; verbs: string[] }
  ): string[] {
    const patterns = [featureName];

    // Extract partial feature names using CamelCase parsing
    const partials = this.extractPartialNames(featureName);

    if (depth >= 1) {
      // Add suffix patterns from detected entity types
      for (const suffix of detected.suffixes) {
        patterns.push(`${featureName}${suffix}`);
      }

      // Add verb prefix patterns from detected common verbs
      for (const verb of detected.verbs) {
        patterns.push(`${verb}${featureName}`);
      }

      // Add patterns for partial names
      for (const partial of partials) {
        patterns.push(partial);

        // Add detected suffixes to partials
        for (const suffix of detected.suffixes.slice(0, 5)) {
          patterns.push(`${partial}${suffix}`);
        }

        // Add common verbs to partials
        for (const verb of detected.verbs.slice(0, 3)) {
          patterns.push(`${verb}${partial}`);
        }
      }
    }

    if (depth >= 2) {
      // Add plural forms
      patterns.push(`${featureName}s`);

      for (const partial of partials) {
        patterns.push(`${partial}s`);
      }

      // Add plural + suffix combinations
      for (const suffix of detected.suffixes.slice(0, 3)) {
        patterns.push(`${featureName}s${suffix}`);
      }
    }

    if (depth >= 3) {
      // Add "use" prefix for composables/hooks
      patterns.push(`use${featureName}`);

      for (const partial of partials) {
        patterns.push(`use${partial}`);
      }
    }

    return patterns;
  }

  /**
   * Reset internal caches to prevent memory leaks.
   */
  reset(): void {
    this.suffixCache.clear();
  }
}
