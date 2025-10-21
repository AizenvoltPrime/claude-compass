import {
  DeadCodeFinding,
  DeadCodeResult,
  DeadCodeSummary,
  FileGroup,
  CategoryGroup,
  DeadCodeCategory,
  ConfidenceLevel,
} from './types.js';

/// <summary>
/// Formats dead code findings grouped by file → category → confidence
/// </summary>
export class DeadCodeFormatter {
  /// <summary>
  /// Format findings into the final result structure
  /// </summary>
  format(
    repository: { id: number; name: string; path: string },
    findings: DeadCodeFinding[],
    totalSymbolsAnalyzed: number
  ): DeadCodeResult {
    // Generate summary statistics
    const summary = this.generateSummary(findings, totalSymbolsAnalyzed);

    // Group by file → category → confidence
    const findingsByFile = this.groupByFile(findings);

    // Generate helpful notes
    const notes = this.generateNotes(findings);

    return {
      repository,
      summary,
      findings_by_file: findingsByFile,
      notes,
    };
  }

  /// <summary>
  /// Generate summary statistics
  /// </summary>
  private generateSummary(
    findings: DeadCodeFinding[],
    totalSymbolsAnalyzed: number
  ): DeadCodeSummary {
    const byCategory: Record<DeadCodeCategory, number> = {
      interface_bloat: 0,
      dead_class: 0,
      dead_public_method: 0,
      dead_private_method: 0,
      dead_function: 0,
      unused_export: 0,
      orphaned_implementation: 0,
    };

    const byConfidence: Record<ConfidenceLevel, number> = {
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const finding of findings) {
      byCategory[finding.category]++;
      byConfidence[finding.confidence]++;
    }

    return {
      total_symbols_analyzed: totalSymbolsAnalyzed,
      dead_code_found: findings.length,
      by_category: byCategory,
      by_confidence: byConfidence,
    };
  }

  /// <summary>
  /// Group findings by file path
  /// </summary>
  private groupByFile(findings: DeadCodeFinding[]): FileGroup[] {
    // Group findings by their file
    const fileMap = new Map<string, { fileId: number; findings: DeadCodeFinding[] }>();

    for (const finding of findings) {
      // Extract file path from finding (we'll need to track this in the finding)
      // For now, we'll need to pass this through from the detector
      const filePath = (finding as any).file_path || 'unknown';
      const fileId = (finding as any).file_id || 0;

      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, { fileId, findings: [] });
      }

      fileMap.get(filePath)!.findings.push(finding);
    }

    // Convert to FileGroup array
    const fileGroups: FileGroup[] = [];

    for (const [filePath, { fileId, findings: fileFindings }] of fileMap) {
      const byCategory = this.groupByCategory(fileFindings);

      fileGroups.push({
        file_path: filePath,
        file_id: fileId,
        dead_symbols_count: fileFindings.length,
        by_category: byCategory,
      });
    }

    // Sort by file path for consistent output
    fileGroups.sort((a, b) => a.file_path.localeCompare(b.file_path));

    return fileGroups;
  }

  /// <summary>
  /// Group findings by category, then by confidence
  /// </summary>
  private groupByCategory(findings: DeadCodeFinding[]): CategoryGroup[] {
    // Group by category first
    const categoryMap = new Map<DeadCodeCategory, DeadCodeFinding[]>();

    for (const finding of findings) {
      if (!categoryMap.has(finding.category)) {
        categoryMap.set(finding.category, []);
      }
      categoryMap.get(finding.category)!.push(finding);
    }

    // Convert to CategoryGroup array with confidence-based sorting
    const categoryGroups: CategoryGroup[] = [];

    const confidenceOrder: ConfidenceLevel[] = ['high', 'medium', 'low'];

    for (const [category, categoryFindings] of categoryMap) {
      // Group by confidence within this category
      const byConfidence = new Map<ConfidenceLevel, DeadCodeFinding[]>();

      for (const finding of categoryFindings) {
        if (!byConfidence.has(finding.confidence)) {
          byConfidence.set(finding.confidence, []);
        }
        byConfidence.get(finding.confidence)!.push(finding);
      }

      // Create a CategoryGroup for each confidence level
      for (const confidence of confidenceOrder) {
        const symbols = byConfidence.get(confidence) || [];
        if (symbols.length > 0) {
          categoryGroups.push({
            category,
            confidence,
            symbols,
          });
        }
      }
    }

    // Sort category groups by: category priority, then confidence
    const categoryPriority: Record<DeadCodeCategory, number> = {
      interface_bloat: 1,
      dead_private_method: 2,
      dead_public_method: 3,
      dead_function: 4,
      dead_class: 5,
      unused_export: 6,
      orphaned_implementation: 7,
    };

    categoryGroups.sort((a, b) => {
      const catDiff = categoryPriority[a.category] - categoryPriority[b.category];
      if (catDiff !== 0) return catDiff;

      const confA = confidenceOrder.indexOf(a.confidence);
      const confB = confidenceOrder.indexOf(b.confidence);
      return confA - confB;
    });

    return categoryGroups;
  }

  /// <summary>
  /// Generate helpful notes about the analysis
  /// </summary>
  private generateNotes(findings: DeadCodeFinding[]): string[] {
    const notes: string[] = [];

    // Always include the reflection disclaimer
    notes.push(
      'Does not detect reflection-based calls or dynamic invocations'
    );

    // Note about exports if any found
    const hasExports = findings.some(f => f.category === 'unused_export');
    if (hasExports) {
      notes.push(
        "Exported symbols flagged as 'low confidence' - verify they are not used by external consumers"
      );
    }

    // Note about overrides if any found
    const hasOverrides = findings.some(f => f.evidence.is_override);
    if (hasOverrides) {
      notes.push(
        'Override methods excluded if base class/interface is actively used'
      );
    }

    // Note about interface bloat if found
    const hasInterfaceBloat = findings.some(
      f => f.category === 'interface_bloat'
    );
    if (hasInterfaceBloat) {
      notes.push(
        'Interface bloat detected - consider removing unused interface methods and their implementations'
      );
    }

    return notes;
  }
}
