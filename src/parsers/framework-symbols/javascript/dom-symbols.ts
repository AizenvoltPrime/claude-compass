import { SymbolType, Visibility } from '../../../database/models';
import { FrameworkSymbol } from '../core/interfaces';

/**
 * Initialize DOM API methods
 */
export function initializeDOMSymbols(): FrameworkSymbol[] {
  const symbols: FrameworkSymbol[] = [];

  // Document methods
  const documentMethods = [
    'getElementById', 'querySelector', 'querySelectorAll',
    'createElement', 'createTextNode', 'createDocumentFragment',
    'addEventListener', 'removeEventListener', 'dispatchEvent'
  ];

  for (const method of documentMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'DOM',
      context: 'document',
      description: `Document.prototype.${method}`
    });
  }

  // Element methods
  const elementMethods = [
    'appendChild', 'removeChild', 'replaceChild', 'insertBefore',
    'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute',
    'getElementsByClassName', 'getElementsByTagName', 'closest',
    'matches', 'contains', 'cloneNode', 'focus', 'blur', 'click',
    'scrollIntoView', 'getBoundingClientRect'
  ];

  for (const method of elementMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'DOM',
      context: 'element',
      description: `Element.prototype.${method}`
    });
  }

  // Window methods
  const windowMethods = [
    'alert', 'confirm', 'prompt', 'open', 'close', 'focus', 'blur',
    'scroll', 'scrollTo', 'scrollBy', 'resizeTo', 'resizeBy',
    'requestAnimationFrame', 'cancelAnimationFrame'
  ];

  for (const method of windowMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'DOM',
      context: 'window',
      description: `Window.prototype.${method}`
    });
  }

  return symbols;
}
