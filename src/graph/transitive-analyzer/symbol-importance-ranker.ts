import type { Knex } from 'knex';
import { getDatabaseConnection } from '../../database/connection';
import { ImportanceRankingConfig, DEFAULT_IMPORTANCE_CONFIG, SymbolForRanking } from './types';
import {
  calculateBetweennessCentrality,
  calculateDegreeCentrality,
  calculateEigenvectorCentrality,
  calculateClosenessCentrality,
  clearCentralityCache,
} from './centrality-metrics';

/**
 * SymbolImportanceRanker calculates importance scores for symbols using
 * graph centrality metrics combined with semantic analysis. This helps AI
 * agents prioritize critical code paths over noise (logging, error handling).
 *
 * The scoring methodology combines four centrality metrics with semantic analysis:
 * - **Betweenness Centrality**: Measures bridge symbols connecting different modules
 * - **Degree Centrality**: Counts direct dependencies (in-degree weighted 1.5x)
 * - **Eigenvector Centrality**: Considers importance of callers (PageRank-style)
 * - **Closeness Centrality**: Measures reachability within the dependency graph
 * - **Semantic Weight**: Boosts core business logic, penalizes utilities/logging
 *
 * Each metric is normalized to 0-1 and weighted according to the configuration.
 * The final score ranges from 0 (unimportant) to 1 (critical).
 */
export class SymbolImportanceRanker {
  private db: Knex;
  private config: ImportanceRankingConfig;

  constructor(config: ImportanceRankingConfig = DEFAULT_IMPORTANCE_CONFIG) {
    this.db = getDatabaseConnection();
    this.config = config;
  }

  async calculateImportance(symbol: SymbolForRanking): Promise<number> {
    const semantic = this.calculateSemanticWeight(symbol);
    const betweenness = await calculateBetweennessCentrality(symbol.id, this.db);
    const degree = await calculateDegreeCentrality(symbol.id, this.db);
    const eigenvector = await calculateEigenvectorCentrality(symbol.id, this.db);
    const closeness = await calculateClosenessCentrality(symbol.id, this.db);

    let compositeScore =
      this.config.betweennessWeight * betweenness +
      this.config.degreeWeight * degree +
      this.config.eigenvectorWeight * eigenvector +
      this.config.closenessWeight * closeness +
      this.config.semanticWeight * semantic;

    const isDatabaseOp = this.isDatabaseOperation(symbol);
    if (isDatabaseOp) {
      compositeScore *= 2.5;

      const depthPenalty = (symbol.depth || 0) * 0.02;
      compositeScore = Math.max(compositeScore - depthPenalty, 0);
    }

    return Math.min(compositeScore, 1.0);
  }

  async rankSymbols(
    symbols: SymbolForRanking[]
  ): Promise<Array<SymbolForRanking & { importance_score: number }>> {
    const rankedSymbols = await Promise.all(
      symbols.map(async symbol => ({
        ...symbol,
        importance_score: await this.calculateImportance(symbol),
      }))
    );

    return rankedSymbols.sort((a, b) => b.importance_score - a.importance_score);
  }

  private isDatabaseOperation(symbol: SymbolForRanking): boolean {
    const name = symbol.name.toLowerCase();
    const filePath = symbol.file_path?.toLowerCase() || '';
    const qualifiedName = symbol.qualified_name || symbol.name;

    let language = this.detectLanguage(filePath);

    if (language === 'unknown' && qualifiedName !== symbol.name) {
      language = this.detectLanguageFromQualifiedName(qualifiedName);
    }

    const dbOperations = /\b(create|insert|update|save|persist|delete|remove|destroy|upsert)\b/i;

    if (!dbOperations.test(name)) {
      return false;
    }

    switch (language) {
      case 'php':
        return (
          /::(create|insert|update|save|delete|destroy|upsert)\b/i.test(qualifiedName) ||
          /\\models\\/i.test(qualifiedName) ||
          /\/models\//i.test(filePath) ||
          /\b(eloquent|repository)\b/i.test(filePath) ||
          name.includes('repository')
        );

      case 'csharp':
        return (
          /\b(savechanges|add|update|remove|delete|insert|executesql|execute)\b/i.test(name) ||
          /\b(repository|dbcontext|database|entity)\b/i.test(filePath) ||
          name.includes('repository') ||
          name.includes('db')
        );

      case 'typescript':
      case 'javascript':
        return (
          name.includes('repository') ||
          name.includes('prisma') ||
          name.includes('orm') ||
          /\b(model|schema|entity|collection)\b/i.test(filePath)
        );

      case 'gdscript':
        return (
          /(save|load)_(resource|scene|config|data|game)/i.test(name) ||
          /resource_?saver|config_?file/i.test(name)
        );

      default:
        return (
          name.includes('repository') ||
          name.includes('db') ||
          name.includes('database') ||
          name.includes('persist')
        );
    }
  }

  private detectLanguage(filePath: string): string {
    if (/\.php$/i.test(filePath)) return 'php';
    if (/\.cs$/i.test(filePath)) return 'csharp';
    if (/\.ts$/i.test(filePath)) return 'typescript';
    if (/\.js$/i.test(filePath)) return 'javascript';
    if (/\.gd$/i.test(filePath)) return 'gdscript';
    return 'unknown';
  }

  private detectLanguageFromQualifiedName(qualifiedName: string): string {
    if (qualifiedName.includes('\\')) {
      return 'php';
    }

    if (
      /^[A-Z][a-zA-Z0-9]*(\.[A-Z][a-zA-Z0-9]*)+/.test(qualifiedName) &&
      !qualifiedName.includes('::')
    ) {
      return 'csharp';
    }

    if (/^[a-z]+(\.[a-z]+)+\.[A-Z]/.test(qualifiedName)) {
      return 'java';
    }

    if (qualifiedName.includes('@/') || qualifiedName.includes('../')) {
      return 'typescript';
    }

    return 'unknown';
  }

  private calculateSemanticWeight(symbol: SymbolForRanking): number {
    let score = 0;

    const typeWeights: Record<string, number> = {
      method: 0.6,
      function: 0.6,
      class: 0.7,
      interface: 0.5,
      variable: 0.3,
      property: 0.3,
    };
    score += typeWeights[symbol.symbol_type] || 0.5;

    const name = symbol.name.toLowerCase();

    if (/\b(create|insert|update|save|persist|delete|remove|destroy|upsert)\b/.test(name)) {
      score += 0.4;
    }

    if (/\b(process|calculate|validate|transform|handle|execute|perform)\b/.test(name)) {
      score += 0.3;
    }

    if (symbol.file_path?.includes('/Service') || symbol.file_path?.includes('/Controller')) {
      score += 0.2;
    }

    if (/\b(log|logger|debug|trace|info|warn|error)\b/i.test(name)) {
      score -= 0.5;
    }

    if (/^(response|json|getMessage|getDetails|getResourceName|print|console)\b/i.test(name)) {
      score -= 0.3;
    }

    if (symbol.depth !== undefined) {
      score += Math.max(0, (1 - symbol.depth / 5) * 0.2);
    }

    return Math.max(0, Math.min(1, score));
  }

  clearCache(): void {
    clearCentralityCache();
  }

  updateConfig(config: Partial<ImportanceRankingConfig>): void {
    this.config = { ...this.config, ...config };
    clearCentralityCache();
  }
}

export const symbolImportanceRanker = new SymbolImportanceRanker();
