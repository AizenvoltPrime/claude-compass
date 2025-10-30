import { SymbolType, Visibility } from '../../../database/models';
import { FrameworkSymbol } from '../core/interfaces';

/**
 * Initialize JavaScript built-in objects and methods
 */
export function initializeJavaScriptBuiltins(): FrameworkSymbol[] {
  const symbols: FrameworkSymbol[] = [];

  // Array methods
  const arrayMethods = [
    'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat',
    'join', 'reverse', 'sort', 'indexOf', 'lastIndexOf', 'includes',
    'find', 'findIndex', 'filter', 'map', 'reduce', 'reduceRight',
    'forEach', 'some', 'every', 'fill', 'copyWithin', 'entries',
    'keys', 'values', 'flat', 'flatMap'
  ];

  for (const method of arrayMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'JavaScript',
      context: 'Array',
      description: `Array.prototype.${method}`
    });
  }

  // String methods
  const stringMethods = [
    'charAt', 'charCodeAt', 'concat', 'indexOf', 'lastIndexOf',
    'slice', 'substring', 'substr', 'toLowerCase', 'toUpperCase',
    'trim', 'trimStart', 'trimEnd', 'replace', 'replaceAll', 'split',
    'match', 'search', 'includes', 'startsWith', 'endsWith',
    'padStart', 'padEnd', 'repeat', 'localeCompare'
  ];

  for (const method of stringMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'JavaScript',
      context: 'String',
      description: `String.prototype.${method}`
    });
  }

  // Object methods
  const objectMethods = [
    'keys', 'values', 'entries', 'assign', 'create', 'defineProperty',
    'freeze', 'seal', 'hasOwnProperty', 'isPrototypeOf', 'toString',
    'valueOf', 'getOwnPropertyNames', 'getOwnPropertyDescriptor'
  ];

  for (const method of objectMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'JavaScript',
      context: 'Object',
      description: `Object.${method} or Object.prototype.${method}`
    });
  }

  // Global functions
  const globalFunctions = [
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI',
    'decodeURI', 'encodeURIComponent', 'decodeURIComponent'
  ];

  for (const func of globalFunctions) {
    symbols.push({
      name: func,
      symbol_type: SymbolType.FUNCTION,
      visibility: Visibility.PUBLIC,
      framework: 'JavaScript',
      context: 'global',
      description: `Global function: ${func}`
    });
  }

  // JSON methods
  symbols.push({
    name: 'stringify',
    symbol_type: SymbolType.METHOD,
    visibility: Visibility.PUBLIC,
    framework: 'JavaScript',
    context: 'JSON',
    description: 'JSON.stringify'
  });

  symbols.push({
    name: 'parse',
    symbol_type: SymbolType.METHOD,
    visibility: Visibility.PUBLIC,
    framework: 'JavaScript',
    context: 'JSON',
    description: 'JSON.parse'
  });

  // Console methods
  const consoleMethods = ['log', 'error', 'warn', 'info', 'debug', 'trace'];
  for (const method of consoleMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'JavaScript',
      context: 'console',
      description: `console.${method}`
    });
  }

  // RegExp methods
  const regexpMethods = ['test', 'exec', 'match', 'replace', 'search'];
  for (const method of regexpMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'JavaScript',
      context: 'RegExp',
      description: `RegExp.prototype.${method} or String.prototype.${method}`
    });
  }

  return symbols;
}
