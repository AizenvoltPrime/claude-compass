import { DeadCodeSymbol } from './types.js';
import { DeadCodeConfig } from './config.js';

/// <summary>
/// Filters to remove false positives from dead code detection
/// </summary>
export class FalsePositiveFilter {
  private overrideSymbols: Set<number>;
  private exportedSymbols: Set<number>;

  constructor(overrideSymbols: Set<number>, exportedSymbols: Set<number>) {
    this.overrideSymbols = overrideSymbols;
    this.exportedSymbols = exportedSymbols;
  }

  /// <summary>
  /// Apply all filters to candidate symbols
  /// </summary>
  filterCandidates(
    candidates: DeadCodeSymbol[],
    includeExports: boolean
  ): DeadCodeSymbol[] {
    return candidates.filter(symbol => {
      // Filter by exported status if requested
      if (!includeExports && this.exportedSymbols.has(symbol.id)) {
        return false;
      }

      // Exclude entry points
      if (this.isEntryPoint(symbol)) {
        return false;
      }

      // Exclude framework callbacks
      if (this.isFrameworkCallback(symbol)) {
        return false;
      }

      // Exclude test methods
      if (this.isTestMethod(symbol)) {
        return false;
      }

      // Exclude implicit call patterns (properties, getters, setters)
      if (this.isImplicitlyCallable(symbol)) {
        return false;
      }

      // Exclude signal/event handlers
      if (this.isSignalOrEvent(symbol)) {
        return false;
      }

      // Exclude API compatibility markers
      if (this.isApiCompatibility(symbol)) {
        return false;
      }

      // Exclude C# explicit interface implementations
      if (this.isExplicitInterfaceImplementation(symbol)) {
        return false;
      }

      return true;
    });
  }

  /// <summary>
  /// Check if symbol is an entry point (main, constructors, lifecycle methods)
  /// </summary>
  private isEntryPoint(symbol: DeadCodeSymbol): boolean {
    // Check symbol types
    const entryPointTypes = ['constructor', 'destructor'];
    if (entryPointTypes.includes(symbol.symbol_type)) {
      return true;
    }

    // Check entity types
    const entryPointEntities = ['controller', 'route', 'middleware', 'command', 'listener'];
    if (symbol.entity_type && entryPointEntities.includes(symbol.entity_type)) {
      return true;
    }

    // Check name patterns across all frameworks
    const allPatterns = [
      ...DeadCodeConfig.CSHARP_GODOT_PATTERNS.namePatterns,
      ...DeadCodeConfig.JAVASCRIPT_TYPESCRIPT_PATTERNS.namePatterns,
      ...DeadCodeConfig.PHP_LARAVEL_PATTERNS.namePatterns,
    ];

    return allPatterns.some(pattern => pattern.test(symbol.name));
  }

  /// <summary>
  /// Check if symbol is a framework callback
  /// </summary>
  private isFrameworkCallback(symbol: DeadCodeSymbol): boolean {
    if (!symbol.signature) {
      return false;
    }

    const allSignaturePatterns = [
      ...DeadCodeConfig.CSHARP_GODOT_PATTERNS.signaturePatterns,
      ...DeadCodeConfig.JAVASCRIPT_TYPESCRIPT_PATTERNS.signaturePatterns,
      ...DeadCodeConfig.PHP_LARAVEL_PATTERNS.signaturePatterns,
    ];

    return allSignaturePatterns.some(pattern => pattern.test(symbol.signature!));
  }

  /// <summary>
  /// Check if symbol is a test method
  /// </summary>
  private isTestMethod(symbol: DeadCodeSymbol): boolean {
    // Check if file is a test file
    if (DeadCodeConfig.isTestFile(symbol.file_path)) {
      return true;
    }

    // Check name patterns
    const nameMatch = DeadCodeConfig.TEST_PATTERNS.namePatterns.some(pattern =>
      pattern.test(symbol.name)
    );

    if (nameMatch) {
      return true;
    }

    // Check signature for test annotations
    if (symbol.signature) {
      return DeadCodeConfig.TEST_PATTERNS.signaturePatterns.some(pattern =>
        pattern.test(symbol.signature!)
      );
    }

    return false;
  }

  /// <summary>
  /// Check if symbol is implicitly callable (properties, getters, setters)
  /// </summary>
  private isImplicitlyCallable(symbol: DeadCodeSymbol): boolean {
    // Check symbol types
    if (
      DeadCodeConfig.IMPLICIT_CALL_PATTERNS.symbolTypes.includes(
        symbol.symbol_type
      )
    ) {
      return true;
    }

    // Check signature for property/accessor keywords first
    // This catches C# properties: "public int Foo { get; set; }"
    if (symbol.signature) {
      const isProperty = DeadCodeConfig.IMPLICIT_CALL_PATTERNS.signaturePatterns.some(
        pattern => pattern.test(symbol.signature!)
      );
      if (isProperty) {
        return true;
      }
    }

    // For name patterns (Get*, Set*), only exclude if signature confirms it's a property
    // This prevents incorrectly filtering regular methods like GetCardPosition()
    const nameMatch = DeadCodeConfig.IMPLICIT_CALL_PATTERNS.namePatterns.some(
      pattern => pattern.test(symbol.name)
    );

    if (nameMatch && symbol.signature) {
      // Name matches Get*/Set* - check if signature indicates property syntax
      // C# properties have { get } or { set } in signature
      // Regular methods have () in signature
      const hasPropertySyntax = /\{\s*(get|set)\s*[;}]/.test(symbol.signature);
      return hasPropertySyntax;
    }

    return false;
  }

  /// <summary>
  /// Check if symbol is a signal or event handler
  /// </summary>
  private isSignalOrEvent(symbol: DeadCodeSymbol): boolean {
    // Check name patterns
    const nameMatch = DeadCodeConfig.SIGNAL_EVENT_PATTERNS.namePatterns.some(
      pattern => pattern.test(symbol.name)
    );

    if (nameMatch) {
      return true;
    }

    // Check signature for signal/event keywords
    if (symbol.signature) {
      return DeadCodeConfig.SIGNAL_EVENT_PATTERNS.signaturePatterns.some(
        pattern => pattern.test(symbol.signature!)
      );
    }

    return false;
  }

  /// <summary>
  /// Check if symbol is marked for API compatibility (deprecated, obsolete)
  /// </summary>
  private isApiCompatibility(symbol: DeadCodeSymbol): boolean {
    // Check name patterns
    const nameMatch = DeadCodeConfig.API_COMPATIBILITY_PATTERNS.namePatterns.some(
      pattern => pattern.test(symbol.name)
    );

    if (nameMatch) {
      return true;
    }

    // Check signature for deprecation markers
    if (symbol.signature) {
      return DeadCodeConfig.API_COMPATIBILITY_PATTERNS.signaturePatterns.some(
        pattern => pattern.test(symbol.signature!)
      );
    }

    return false;
  }

  /// <summary>
  /// Check if symbol is an override (might be called polymorphically)
  /// </summary>
  isOverride(symbolId: number): boolean {
    return this.overrideSymbols.has(symbolId);
  }

  /// <summary>
  /// Check if symbol is exported
  /// </summary>
  isExported(symbolId: number): boolean {
    return this.exportedSymbols.has(symbolId);
  }

  /// <summary>
  /// Check if symbol is a C# explicit interface implementation
  /// These are called through interface references, not directly
  /// </summary>
  private isExplicitInterfaceImplementation(symbol: DeadCodeSymbol): boolean {
    if (!symbol.signature) {
      return false;
    }

    return DeadCodeConfig.EXPLICIT_INTERFACE_PATTERNS.signaturePatterns.some(
      pattern => pattern.test(symbol.signature!)
    );
  }
}
