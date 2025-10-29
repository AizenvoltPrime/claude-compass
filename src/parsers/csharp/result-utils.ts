import { ParseResult, ParseOptions } from '../base';
import { MergedParseResult } from '../chunked-parser';
import { Visibility } from '../../database/models';
import type { Logger } from 'winston';

/**
 * Create an error result with a single error message
 */
export function createErrorResult(message: string): ParseResult {
  return {
    symbols: [],
    dependencies: [],
    imports: [],
    exports: [],
    errors: [
      {
        message,
        line: 0,
        column: 0,
        severity: 'error',
      },
    ],
  };
}

/**
 * Finalize parse result by filtering private symbols if requested
 * and logging parsing statistics
 */
export function finalizeResult(
  result: ParseResult,
  options: ParseOptions | undefined,
  logger: Logger
): ParseResult {
  if (options?.includePrivateSymbols === false) {
    result.symbols = result.symbols.filter(
      s => s.is_exported || s.visibility !== Visibility.PRIVATE
    );
  }

  logger.debug('Parsing complete', {
    symbols: result.symbols.length,
    dependencies: result.dependencies.length,
    imports: result.imports.length,
    exports: result.exports.length,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Convert merged result from chunked parsing to standard parse result
 */
export function convertMergedResult(mergedResult: MergedParseResult): ParseResult {
  return {
    symbols: mergedResult.symbols,
    dependencies: mergedResult.dependencies,
    imports: mergedResult.imports,
    exports: mergedResult.exports,
    errors: mergedResult.errors,
  };
}
