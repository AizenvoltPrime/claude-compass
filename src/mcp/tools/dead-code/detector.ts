import { Knex } from 'knex';
import {
  DetectDeadCodeParams,
  DeadCodeResult,
  DeadCodeFinding,
  DeadCodeEvidence,
  ConfidenceLevel,
} from './types.js';
import { DeadCodeQueryBuilder } from './query-builder.js';
import { FalsePositiveFilter } from './filters.js';
import { InterfaceAnalyzer } from './interface-analyzer.js';
import { DeadCodeCategorizer } from './categorizer.js';
import { ConfidenceScorer } from './confidence-scorer.js';
import { DeadCodeFormatter } from './formatter.js';
import { createComponentLogger } from '../../../utils/logger.js';

const logger = createComponentLogger('dead-code-detector');

/// <summary>
/// Main orchestrator for dead code detection
/// </summary>
export class DeadCodeDetector {
  private queryBuilder: DeadCodeQueryBuilder;

  constructor(private db: Knex) {
    this.queryBuilder = new DeadCodeQueryBuilder(db);
  }

  /// <summary>
  /// Detect dead code in a repository
  /// </summary>
  async detect(params: DetectDeadCodeParams, repoId?: number): Promise<DeadCodeResult> {
    logger.info('Starting dead code detection', { params, repoId });

    // Step 1: Determine repository to analyze
    const repository = await this.getRepository(repoId);
    if (!repository) {
      throw new Error(
        repoId
          ? `Repository with id ${repoId} not found`
          : 'No repositories found. Please analyze a codebase first.'
      );
    }

    logger.info('Analyzing repository', { repository });

    // Step 2: Query for zero-caller candidates
    const candidates = await this.queryBuilder.findZeroCallerCandidates(
      repository.id,
      params.include_tests ?? false,
      params.file_pattern
    );

    logger.info(`Found ${candidates.length} zero-caller candidates`);

    // Step 3: Get additional context (overrides, exports, interface implementations)
    const [overrideSymbols, exportedSymbols, interfaceImplementations] =
      await Promise.all([
        this.queryBuilder.findOverrideSymbols(repository.id),
        this.queryBuilder.findExportedSymbols(repository.id),
        this.queryBuilder.findInterfaceImplementations(repository.id),
      ]);

    logger.info('Context gathered', {
      overrides: overrideSymbols.size,
      exports: exportedSymbols.size,
      interfacePairs: interfaceImplementations.length,
    });

    // Step 4: Initialize analyzers and filters
    const filter = new FalsePositiveFilter(overrideSymbols, exportedSymbols);
    const interfaceAnalyzer = new InterfaceAnalyzer(
      interfaceImplementations,
      candidates
    );
    const categorizer = new DeadCodeCategorizer(interfaceAnalyzer, filter);
    const scorer = new ConfidenceScorer(filter);

    // Step 5: Filter out false positives
    const includeExports = params.include_exports ?? false;
    const filtered = filter.filterCandidates(candidates, includeExports);

    logger.info(
      `After filtering: ${filtered.length} candidates (${candidates.length - filtered.length} false positives removed)`
    );

    // Step 6: Categorize and score each symbol
    const findings: Array<DeadCodeFinding & { file_path: string; file_id: number }> = [];

    for (const symbol of filtered) {
      const category = categorizer.categorize(symbol);
      const confidence = scorer.calculateConfidence(symbol, category);

      // Filter by confidence threshold if specified
      if (params.confidence_threshold) {
        if (!this.meetsConfidenceThreshold(confidence, params.confidence_threshold)) {
          continue;
        }
      }

      const reason = categorizer.generateReason(symbol, category);

      // Build evidence
      const evidence: DeadCodeEvidence = {
        caller_count: symbol.caller_count,
        is_public: this.isPublic(symbol),
        is_exported: filter.isExported(symbol.id),
        is_private: this.isPrivate(symbol),
        is_override: filter.isOverride(symbol.id),
        implementation_used: false,
        implements_interface: interfaceAnalyzer.implementsInterface(symbol.id),
      };

      // Add interface info if applicable
      const interfaceInfo = interfaceAnalyzer.getInterfaceInfo(symbol.id);
      if (interfaceInfo) {
        evidence.interface_name = interfaceInfo.interfaceName;
      }

      findings.push({
        symbol_id: symbol.id,
        name: symbol.name,
        symbol_type: symbol.symbol_type,
        entity_type: symbol.entity_type,
        line_range: {
          start: symbol.start_line,
          end: symbol.end_line,
        },
        category,
        confidence,
        reason,
        evidence,
        file_path: symbol.file_path,
        file_id: symbol.file_id,
      });
    }

    logger.info(`Generated ${findings.length} findings`);

    // Step 8: Apply max results limit
    let limitedFindings = findings;
    if (params.max_results && findings.length > params.max_results) {
      // Prioritize high confidence findings
      limitedFindings = findings
        .sort((a, b) => {
          const confidenceOrder = { high: 0, medium: 1, low: 2 };
          return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
        })
        .slice(0, params.max_results);

      logger.info(
        `Limited to ${params.max_results} results (from ${findings.length})`
      );
    }

    // Step 9: Get total symbols count for summary
    const totalSymbols = await this.queryBuilder.countTotalSymbols(
      repository.id,
      params.include_tests ?? false,
      params.file_pattern
    );

    // Step 10: Format results
    const formatter = new DeadCodeFormatter();
    const result = formatter.format(repository, limitedFindings, totalSymbols);

    logger.info('Dead code detection complete', {
      total_found: result.summary.dead_code_found,
      by_confidence: result.summary.by_confidence,
    });

    return result;
  }

  /// <summary>
  /// Get repository by ID or most recent
  /// </summary>
  private async getRepository(
    repoId?: number
  ): Promise<{ id: number; name: string; path: string } | null> {
    if (repoId) {
      return await this.queryBuilder.getRepository(repoId);
    }
    return await this.queryBuilder.getMostRecentRepository();
  }

  /// <summary>
  /// Check if confidence level meets threshold
  /// </summary>
  private meetsConfidenceThreshold(
    confidence: ConfidenceLevel,
    threshold: ConfidenceLevel
  ): boolean {
    const levels: ConfidenceLevel[] = ['high', 'medium', 'low'];
    const confidenceRank = levels.indexOf(confidence);
    const thresholdRank = levels.indexOf(threshold);

    // If threshold is 'medium', include 'high' and 'medium'
    // If threshold is 'low', include all
    return confidenceRank <= thresholdRank;
  }

  /// <summary>
  /// Determine if symbol is public
  /// </summary>
  private isPublic(symbol: { signature?: string | null }): boolean {
    if (!symbol.signature) return true; // Default to public
    return /\bpublic\b/.test(symbol.signature);
  }

  /// <summary>
  /// Determine if symbol is private
  /// </summary>
  private isPrivate(symbol: { signature?: string | null; name: string }): boolean {
    if (symbol.signature) {
      if (/\bprivate\b/.test(symbol.signature)) return true;
      if (/\bprotected\b/.test(symbol.signature)) return true;
    }

    // Check naming conventions
    if (symbol.name.startsWith('#') || symbol.name.startsWith('_')) {
      return true;
    }

    return false;
  }
}
