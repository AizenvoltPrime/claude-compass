import { FrameworkSymbol } from './interfaces';
import { initializePHPUnitSymbols } from '../php/phpunit-symbols';
import { initializeLaravelSymbols } from '../php/laravel-symbols';
import { initializePHPBuiltins } from '../php/php-builtin-symbols';
import { initializeVueSymbols } from '../javascript/vue-symbols';
import { initializeJavaScriptBuiltins } from '../javascript/js-builtin-symbols';
import { initializeDOMSymbols } from '../javascript/dom-symbols';
import { initializeDotNetFrameworkSymbols } from '../dotnet/dotnet-framework-symbols';
import { initializeGodotSymbols } from '../godot/godot-engine-symbols';

/**
 * Registry of framework-provided symbols that should be available
 * in specific contexts but aren't explicitly declared in user files
 */
export class FrameworkSymbolRegistry {
  private symbols: Map<string, FrameworkSymbol[]> = new Map();
  private phpUnitSymbols: FrameworkSymbol[] = [];
  private laravelSymbols: FrameworkSymbol[] = [];
  private phpBuiltinSymbols: FrameworkSymbol[] = [];
  private vueSymbols: FrameworkSymbol[] = [];
  private jsBuiltinSymbols: FrameworkSymbol[] = [];
  private domSymbols: FrameworkSymbol[] = [];
  private dotnetSymbols: FrameworkSymbol[] = [];
  private godotSymbols: FrameworkSymbol[] = [];

  constructor() {
    this.phpUnitSymbols = initializePHPUnitSymbols();
    this.laravelSymbols = initializeLaravelSymbols();
    this.phpBuiltinSymbols = initializePHPBuiltins();
    this.vueSymbols = initializeVueSymbols();
    this.jsBuiltinSymbols = initializeJavaScriptBuiltins();
    this.domSymbols = initializeDOMSymbols();
    this.dotnetSymbols = initializeDotNetFrameworkSymbols();
    this.godotSymbols = initializeGodotSymbols();
    this.buildIndex();
  }

  /**
   * Build searchable index of all framework symbols
   */
  private buildIndex(): void {
    // Index PHPUnit symbols
    for (const symbol of this.phpUnitSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index Laravel symbols
    for (const symbol of this.laravelSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index PHP built-in symbols
    for (const symbol of this.phpBuiltinSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index Vue symbols
    for (const symbol of this.vueSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index JavaScript built-in symbols
    for (const symbol of this.jsBuiltinSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index DOM symbols
    for (const symbol of this.domSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index .NET symbols
    for (const symbol of this.dotnetSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index Godot symbols
    for (const symbol of this.godotSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }
  }

  /**
   * Check if a symbol is available in a given context
   */
  public isFrameworkSymbolAvailable(symbolName: string, context: string, filePath?: string): FrameworkSymbol | null {
    const candidates = this.symbols.get(symbolName);
    if (!candidates || candidates.length === 0) {
      return null;
    }

    // For test files, prioritize PHPUnit symbols
    if (this.isTestFile(filePath)) {
      const phpunitSymbol = candidates.find(s => s.framework === 'PHPUnit');
      if (phpunitSymbol) {
        return phpunitSymbol;
      }
    }

    // For Vue files, prioritize Vue symbols
    if (this.isVueFile(filePath)) {
      const vueSymbol = candidates.find(s => s.framework === 'Vue');
      if (vueSymbol) {
        return vueSymbol;
      }
    }

    // For C# files, prioritize Godot symbols first, then .NET symbols
    if (this.isCSharpFile(filePath)) {
      const godotSymbol = candidates.find(s => s.framework === 'Godot');
      if (godotSymbol) {
        return godotSymbol;
      }

      const dotnetSymbol = candidates.find(s =>
        s.framework.startsWith('System') || s.framework === '.NET'
      );
      if (dotnetSymbol) {
        return dotnetSymbol;
      }
    }

    // For JavaScript/TypeScript files, check for JS built-ins and DOM
    if (this.isJavaScriptFile(filePath)) {
      // Prioritize framework-specific symbols first
      const jsBuiltinSymbol = candidates.find(s => s.framework === 'JavaScript');
      if (jsBuiltinSymbol) {
        return jsBuiltinSymbol;
      }

      const domSymbol = candidates.find(s => s.framework === 'DOM');
      if (domSymbol) {
        return domSymbol;
      }
    }

    // For Laravel files, check context-specific symbols
    if (this.isLaravelFile(filePath)) {
      // Check for context-specific matches first
      const contextSpecificSymbol = candidates.find(s =>
        s.framework === 'Laravel' &&
        (s.context === context || this.isCompatibleContext(context, s.context))
      );
      if (contextSpecificSymbol) {
        return contextSpecificSymbol;
      }

      // Fallback to any Laravel symbol
      const laravelSymbol = candidates.find(s => s.framework === 'Laravel');
      if (laravelSymbol) {
        return laravelSymbol;
      }
    }

    // Return the first available symbol as fallback
    return candidates[0];
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.includes('/tests/') ||
           filePath.includes('/test/') ||
           filePath.toLowerCase().includes('test.php') ||
           filePath.toLowerCase().includes('spec.php');
  }

  /**
   * Check if file is part of a Laravel project
   */
  private isLaravelFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.includes('/app/') ||
           filePath.includes('/resources/') ||
           filePath.includes('/routes/') ||
           filePath.includes('artisan') ||
           filePath.includes('Laravel') ||
           filePath.includes('Illuminate');
  }

  /**
   * Check if file is a Vue file
   */
  private isVueFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.endsWith('.vue') ||
           filePath.includes('/vue/') ||
           filePath.includes('Vue') ||
           (filePath.includes('/Composables/') && filePath.endsWith('.ts'));
  }

  /**
   * Check if file is JavaScript/TypeScript
   */
  private isJavaScriptFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.endsWith('.js') ||
           filePath.endsWith('.ts') ||
           filePath.endsWith('.jsx') ||
           filePath.endsWith('.tsx') ||
           filePath.endsWith('.mjs') ||
           filePath.endsWith('.cjs') ||
           filePath.endsWith('.vue');
  }

  /**
   * Check if file is a C# file
   */
  private isCSharpFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.endsWith('.cs');
  }

  /**
   * Check if contexts are compatible (e.g., validation context can access message_bag methods)
   */
  private isCompatibleContext(requestedContext: string, symbolContext?: string): boolean {
    if (!symbolContext) return true;

    const compatibilityMap: Record<string, string[]> = {
      'validation': ['message_bag', 'request'],
      'test': ['validation', 'request', 'collection'],
      'request': ['validation', 'collection']
    };

    const compatibleContexts = compatibilityMap[requestedContext] || [];
    return compatibleContexts.includes(symbolContext);
  }

  /**
   * Get all symbols for a given framework
   */
  public getFrameworkSymbols(framework: string): FrameworkSymbol[] {
    switch (framework.toLowerCase()) {
      case 'phpunit':
        return this.phpUnitSymbols;
      case 'laravel':
        return this.laravelSymbols;
      case 'vue':
        return this.vueSymbols;
      case 'javascript':
        return this.jsBuiltinSymbols;
      case 'dom':
        return this.domSymbols;
      case 'dotnet':
      case '.net':
      case 'system':
        return this.dotnetSymbols;
      case 'godot':
        return this.godotSymbols;
      default:
        return [];
    }
  }

  /**
   * Get all available symbol names
   */
  public getAllSymbolNames(): string[] {
    return Array.from(this.symbols.keys());
  }
}
