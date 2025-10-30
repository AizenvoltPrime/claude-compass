import { SymbolType, Visibility } from '../../../database/models';

/**
 * Interface for framework-provided symbols
 */
export interface FrameworkSymbol {
  name: string;
  symbol_type: SymbolType;
  visibility: Visibility;
  signature?: string;
  description?: string;
  framework: string;
  context?: string; // Additional context (e.g., 'test', 'validation', etc.)
}
