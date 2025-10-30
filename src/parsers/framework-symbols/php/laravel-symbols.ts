import { SymbolType, Visibility } from '../../../database/models';
import { FrameworkSymbol } from '../core/interfaces';

/**
 * Initialize Laravel framework symbols
 */
export function initializeLaravelSymbols(): FrameworkSymbol[] {
  const symbols: FrameworkSymbol[] = [];

  // Laravel Validator methods
  const validatorMethods = [
    'errors', 'failed', 'fails', 'passes', 'valid', 'invalid',
    'sometimes', 'after', 'getMessageBag', 'setMessageBag',
    'getRules', 'setRules', 'getPresenceVerifier'
  ];

  for (const method of validatorMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Laravel',
      context: 'validation',
      description: `Laravel Validator method: ${method}`
    });
  }

  // Laravel MessageBag methods (returned by validator->errors())
  const messageBagMethods = [
    'add', 'merge', 'has', 'hasAny', 'first', 'get', 'all', 'keys',
    'isEmpty', 'isNotEmpty', 'count', 'toArray', 'toJson', 'jsonSerialize'
  ];

  for (const method of messageBagMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Laravel',
      context: 'message_bag',
      description: `Laravel MessageBag method: ${method}`
    });
  }

  // Laravel Request methods
  const requestMethods = [
    'all', 'input', 'only', 'except', 'has', 'hasAny', 'filled', 'missing',
    'validate', 'validateWithBag', 'rules', 'messages', 'attributes',
    'merge', 'replace', 'flash', 'flashOnly', 'flashExcept'
  ];

  for (const method of requestMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Laravel',
      context: 'request',
      description: `Laravel Request method: ${method}`
    });
  }

  // Laravel Collection methods (commonly used)
  const collectionMethods = [
    'map', 'filter', 'reduce', 'each', 'collect', 'pluck', 'where',
    'first', 'last', 'push', 'pop', 'shift', 'unshift', 'slice',
    'take', 'skip', 'chunk', 'groupBy', 'sortBy', 'reverse', 'unique',
    'values', 'keys', 'flatten', 'flip', 'transform', 'tap'
  ];

  for (const method of collectionMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Laravel',
      context: 'collection',
      description: `Laravel Collection method: ${method}`
    });
  }

  return symbols;
}
