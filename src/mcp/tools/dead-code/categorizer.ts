import { DeadCodeSymbol, DeadCodeCategory } from './types.js';
import { InterfaceAnalyzer } from './interface-analyzer.js';
import { FalsePositiveFilter } from './filters.js';
import { SymbolType } from '../../../database/models.js';

/// <summary>
/// Categorizes dead code symbols into specific categories
/// </summary>
export class DeadCodeCategorizer {
  constructor(
    private interfaceAnalyzer: InterfaceAnalyzer,
    private filter: FalsePositiveFilter
  ) {}

  /// <summary>
  /// Determine the category for a dead code symbol
  /// </summary>
  categorize(symbol: DeadCodeSymbol): DeadCodeCategory {
    // Check for interface bloat first (highest specificity)
    if (this.interfaceAnalyzer.isInterfaceBloat(symbol.id)) {
      return 'interface_bloat';
    }

    // Check for unused exports
    if (this.filter.isExported(symbol.id)) {
      return 'unused_export';
    }

    // Check for dead classes
    if (this.isDeadClass(symbol)) {
      return 'dead_class';
    }

    // Check for orphaned implementations
    if (this.isOrphanedImplementation(symbol)) {
      return 'orphaned_implementation';
    }

    // Determine if private or public based on signature
    const isPrivate = this.isPrivateSymbol(symbol);

    // Categorize methods vs functions
    if (this.isMethod(symbol)) {
      return isPrivate ? 'dead_private_method' : 'dead_public_method';
    }

    // Standalone functions
    return 'dead_function';
  }

  /// <summary>
  /// Check if symbol is a class with zero instantiations
  /// </summary>
  private isDeadClass(symbol: DeadCodeSymbol): boolean {
    return (
      symbol.symbol_type === SymbolType.CLASS ||
      symbol.symbol_type === SymbolType.TYPE_ALIAS ||
      symbol.symbol_type === SymbolType.STRUCT ||
      symbol.entity_type === 'class'
    );
  }

  /// <summary>
  /// Check if symbol implements an interface but the interface itself is unused
  /// </summary>
  private isOrphanedImplementation(symbol: DeadCodeSymbol): boolean {
    // This would require more complex analysis - checking if the interface
    // that this symbol implements is also dead. For now, mark as false.
    // Future enhancement: track interface usage separately
    return false;
  }

  /// <summary>
  /// Check if symbol is a method (vs standalone function)
  /// </summary>
  private isMethod(symbol: DeadCodeSymbol): boolean {
    return (
      symbol.symbol_type === SymbolType.METHOD ||
      symbol.entity_type === 'method' ||
      symbol.entity_type === 'class_method'
    );
  }

  /// <summary>
  /// Determine if symbol is private based on signature and naming conventions
  /// </summary>
  private isPrivateSymbol(symbol: DeadCodeSymbol): boolean {
    // Check signature for private keyword
    if (symbol.signature) {
      if (/\bprivate\b/.test(symbol.signature)) {
        return true;
      }
      if (/\bprotected\b/.test(symbol.signature)) {
        return true; // Treat protected as private for this analysis
      }
    }

    // Check naming conventions
    // PHP: private methods don't have special naming
    // JavaScript/TypeScript: #private or _private
    // C#: private methods don't have special naming (rely on signature)
    if (symbol.name.startsWith('#') || symbol.name.startsWith('_')) {
      return true;
    }

    // Default to public if no clear indicators
    return false;
  }

  /// <summary>
  /// Generate human-readable reason for categorization
  /// </summary>
  generateReason(symbol: DeadCodeSymbol, category: DeadCodeCategory): string {
    switch (category) {
      case 'interface_bloat':
        const interfaceInfo = this.interfaceAnalyzer.getInterfaceInfo(
          symbol.id
        );
        return `Interface method '${interfaceInfo?.interfaceName}' implemented but never called anywhere`;

      case 'dead_class':
        return `Class with zero instantiations and no references`;

      case 'dead_public_method':
        return `Public method with zero callers, not exported, not an entry point`;

      case 'dead_private_method':
        return `Private method with zero callers, likely orphaned from refactoring`;

      case 'dead_function':
        return `Function with zero callers`;

      case 'unused_export':
        return `Exported symbol with zero imports - might be used externally or truly unused`;

      case 'orphaned_implementation':
        return `Implements unused interface - consider removing interface and implementation`;

      default:
        return `Symbol with zero callers`;
    }
  }
}
