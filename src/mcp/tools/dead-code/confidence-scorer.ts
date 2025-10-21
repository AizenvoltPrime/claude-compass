import {
  DeadCodeSymbol,
  DeadCodeCategory,
  ConfidenceLevel,
} from './types.js';
import { FalsePositiveFilter } from './filters.js';

/// <summary>
/// Calculates confidence levels for dead code findings
/// </summary>
export class ConfidenceScorer {
  constructor(private filter: FalsePositiveFilter) {}

  /// <summary>
  /// Calculate confidence level based on symbol characteristics and category
  /// </summary>
  calculateConfidence(
    symbol: DeadCodeSymbol,
    category: DeadCodeCategory
  ): ConfidenceLevel {
    // High confidence categories
    if (this.isHighConfidenceCategory(category, symbol)) {
      return 'high';
    }

    // Low confidence indicators
    if (this.hasLowConfidenceIndicators(symbol, category)) {
      return 'low';
    }

    // Default to medium confidence
    return 'medium';
  }

  /// <summary>
  /// Check if category and symbol characteristics indicate high confidence
  /// </summary>
  private isHighConfidenceCategory(
    category: DeadCodeCategory,
    symbol: DeadCodeSymbol
  ): boolean {
    // Private methods with zero callers are definitely dead
    if (category === 'dead_private_method') {
      return true;
    }

    // Interface bloat with confirmed unused implementation
    if (category === 'interface_bloat') {
      return true;
    }

    // Public methods that are not exported and not overrides
    if (
      category === 'dead_public_method' &&
      !this.filter.isExported(symbol.id) &&
      !this.filter.isOverride(symbol.id)
    ) {
      return true;
    }

    // Dead classes with no inheritance
    if (category === 'dead_class' && !this.filter.isOverride(symbol.id)) {
      return true;
    }

    return false;
  }

  /// <summary>
  /// Check for indicators that suggest lower confidence
  /// </summary>
  private hasLowConfidenceIndicators(
    symbol: DeadCodeSymbol,
    category: DeadCodeCategory
  ): boolean {
    // Exported symbols might be used externally
    if (category === 'unused_export') {
      return true;
    }

    // Symbols that implement interfaces/extend classes might be called polymorphically
    if (this.filter.isOverride(symbol.id)) {
      return true;
    }

    // Exported public methods have lower confidence
    if (this.filter.isExported(symbol.id)) {
      return true;
    }

    // Symbols with very generic names might be false positives
    if (this.hasGenericName(symbol.name)) {
      return true;
    }

    return false;
  }

  /// <summary>
  /// Check if symbol name is very generic (might be called dynamically)
  /// </summary>
  private hasGenericName(name: string): boolean {
    const genericPatterns = [
      /^execute$/i,
      /^run$/i,
      /^invoke$/i,
      /^call$/i,
      /^apply$/i,
      /^process$/i,
      /^handle$/i,
    ];

    return genericPatterns.some(pattern => pattern.test(name));
  }
}
