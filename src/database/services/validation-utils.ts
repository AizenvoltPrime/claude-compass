import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('validation-utils');

/**
 * Validate embedding vector before database insertion.
 * Prevents mysterious pgvector query failures from dimension mismatches.
 */
export function validateEmbedding(embedding: number[] | undefined, expectedDim: number = 1024): boolean {
  if (!embedding) return false;

  return (
    Array.isArray(embedding) &&
    embedding.length === expectedDim &&
    embedding.every(v => typeof v === 'number' && !isNaN(v) && isFinite(v))
  );
}

/**
 * Safely parse parameter_types field from database.
 * Handles both JSON arrays and legacy comma-separated strings.
 */
export function safeParseParameterTypes(parameterTypes: any): string[] | undefined {
  if (!parameterTypes) return undefined;

  // If it's already an array, return it directly
  if (Array.isArray(parameterTypes)) {
    return parameterTypes;
  }

  // If it's a string, try to parse it
  if (typeof parameterTypes === 'string') {
    try {
      // Try parsing as JSON array first
      const parsed = JSON.parse(parameterTypes);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      // If not an array, fall back to string splitting
      return parameterTypes.split(',').map(s => s.trim());
    } catch (error) {
      // Fall back to comma-separated string parsing
      logger.warn('Failed to parse parameter_types as JSON', {
        error: error instanceof Error ? error.message : String(error),
      });
      return parameterTypes.split(',').map(s => s.trim());
    }
  }

  // If it's neither array nor string, return undefined
  logger.warn('Unexpected parameter_types type', { parameterTypes, type: typeof parameterTypes });
  return undefined;
}
