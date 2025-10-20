/**
 * Cross-Stack Strategy
 *
 * Discovers backend endpoints that are called by frontend code,
 * bridging the Vue/React → Laravel/Express API boundary.
 *
 * Uses the api_calls table which tracks API endpoint relationships
 * extracted during parsing (e.g., axios.get('/api/vehicles/camera-alerts')).
 */

import { DatabaseService } from '../../../database/services';
import { createComponentLogger } from '../../../utils/logger';
import { DiscoveryStrategy, DiscoveryContext, DiscoveryResult } from './types';

const logger = createComponentLogger('cross-stack-strategy');

export class CrossStackStrategy implements DiscoveryStrategy {
  readonly name = 'cross-stack';
  readonly description = 'Discover backend endpoints called by frontend';
  readonly priority = 40; // Run after forward deps

  private frontendLanguagesCache = new Map<number, string[]>();

  constructor(private dbService: DatabaseService) {}

  /**
   * Run every iteration to catch new frontend → backend connections.
   */
  shouldRun(context: DiscoveryContext): boolean {
    return true;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const { currentSymbols, repoId } = context;
    const db = this.dbService.knex;

    logger.debug('Starting cross-stack discovery', {
      currentSymbolsCount: currentSymbols.length,
    });

    // Auto-detect frontend languages
    const frontendLanguages = await this.detectFrontendLanguages(repoId);

    // Find frontend symbols using detected languages
    const frontendSymbols = await db('symbols')
      .whereIn('symbols.id', currentSymbols)
      .join('files', 'symbols.file_id', 'files.id')
      .whereIn('files.language', frontendLanguages)
      .select('symbols.id');

    const frontendIds = frontendSymbols.map((s: { id: number }) => s.id);

    if (frontendIds.length === 0) {
      logger.debug('No frontend symbols found', {
        detectedLanguages: frontendLanguages,
      });
      return new Map();
    }

    // Find backend endpoints these frontend symbols call
    const apiCalls = await db('api_calls')
      .whereIn('caller_symbol_id', frontendIds)
      .select('endpoint_symbol_id');

    const backendEndpointIds = apiCalls
      .map((ac: { endpoint_symbol_id: number | null }) => ac.endpoint_symbol_id)
      .filter((id): id is number => id !== null);

    // Convert to relevance map
    const result = new Map<number, number>();
    backendEndpointIds.forEach(id => result.set(id, 0.8));

    logger.debug('Cross-stack discovery complete', {
      frontendSymbols: frontendIds.length,
      backendEndpoints: result.size,
      frontendLanguages,
    });

    return result;
  }

  /**
   * Auto-detect frontend languages from repository metadata.
   * Analyzes frameworks to determine which languages are frontend vs backend.
   */
  private async detectFrontendLanguages(repoId: number): Promise<string[]> {
    // Check cache first
    const cached = this.frontendLanguagesCache.get(repoId);
    if (cached !== undefined) {
      return cached;
    }

    const db = this.dbService.knex;

    // Get repository frameworks
    const repo = await db('repositories')
      .where('id', repoId)
      .select('framework_stack', 'language_primary')
      .first();

    if (!repo) {
      return [];
    }

    const frameworks: string[] = repo.framework_stack || [];
    const frontendLanguages = new Set<string>();

    // Map frameworks to their frontend languages
    const frameworkLanguageMap: Record<string, string[]> = {
      vue: ['vue', 'javascript', 'typescript'],
      react: ['jsx', 'tsx', 'javascript', 'typescript'],
      angular: ['typescript', 'javascript'],
      svelte: ['svelte', 'javascript', 'typescript'],
      ember: ['javascript', 'typescript'],
      nextjs: ['jsx', 'tsx', 'javascript', 'typescript'],
      nuxt: ['vue', 'javascript', 'typescript'],
    };

    // Add languages from detected frameworks
    for (const framework of frameworks) {
      const languages = frameworkLanguageMap[framework.toLowerCase()];
      if (languages) {
        languages.forEach(lang => frontendLanguages.add(lang));
      }
    }

    // If no frameworks detected, check files table for language patterns
    if (frontendLanguages.size === 0) {
      const languages: string[] = await db('files')
        .where('repository_id', repoId)
        .distinct('language')
        .pluck('language');

      // Classify languages as frontend based on common patterns
      const commonFrontendLanguages = [
        'vue',
        'jsx',
        'tsx',
        'svelte',
        'typescript',
        'javascript',
      ];

      for (const lang of languages) {
        if (commonFrontendLanguages.includes(lang)) {
          frontendLanguages.add(lang);
        }
      }
    }

    const result = Array.from(frontendLanguages);
    this.frontendLanguagesCache.set(repoId, result);

    logger.debug('Auto-detected frontend languages', {
      repoId,
      frameworks,
      languages: result,
    });

    return result;
  }

  /**
   * Reset internal caches to prevent memory leaks.
   */
  reset(): void {
    this.frontendLanguagesCache.clear();
  }
}
