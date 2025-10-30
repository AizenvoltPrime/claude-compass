// Core types and interfaces
export * from './core/interfaces';

// Framework symbol registry
export { FrameworkSymbolRegistry } from './core/framework-symbol-registry';

// PHP framework symbols
export { initializePHPUnitSymbols } from './php/phpunit-symbols';
export { initializeLaravelSymbols } from './php/laravel-symbols';
export { initializePHPBuiltins } from './php/php-builtin-symbols';

// JavaScript framework symbols
export { initializeVueSymbols } from './javascript/vue-symbols';
export { initializeJavaScriptBuiltins } from './javascript/js-builtin-symbols';
export { initializeDOMSymbols } from './javascript/dom-symbols';

// .NET framework symbols
export { initializeDotNetFrameworkSymbols } from './dotnet/dotnet-framework-symbols';

// Godot Engine symbols
export { initializeGodotSymbols } from './godot/godot-engine-symbols';

// Export singleton instance
import { FrameworkSymbolRegistry } from './core/framework-symbol-registry';
export const frameworkSymbolRegistry = new FrameworkSymbolRegistry();
