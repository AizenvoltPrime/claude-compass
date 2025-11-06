/**
 * File Validation Policy
 *
 * Determines file-level validation for symbols. Only includes symbols from
 * files containing validated entities at deep depths, preventing pollution
 * from unrelated utility files.
 */

import type { SymbolInfo } from './symbol-classifier';
import type { TraversalState } from './traversal-state';
import type { SymbolGraphQueries } from './symbol-graph-queries';

export class FileValidationPolicy {
  private static readonly VALIDATED_ENTITY_TYPES = [
    'store',
    'service',
    'controller',
    'component',
    'request',
    'composable',
  ];

  private static readonly ARCHITECTURAL_ENTITY_TYPES = [
    'controller',
    'service',
    'store',
  ];

  constructor(private readonly state: TraversalState) {}

  shouldValidateByFile(symbol: SymbolInfo, depth: number): boolean {
    if (depth <= 1) {
      return true;
    }

    if (!symbol.file_id) {
      return true;
    }

    const isValidatedEntity = this.isValidatedEntityType(symbol.entity_type);
    if (isValidatedEntity) {
      return true;
    }

    if (symbol.symbol_type === 'class' && symbol.entity_type === 'model') {
      return true;
    }

    return this.state.isFileValidated(symbol.file_id);
  }

  async shouldPreValidateParentFile(
    symbol: SymbolInfo,
    depth: number,
    queries: SymbolGraphQueries
  ): Promise<boolean> {
    if (depth < 1) {
      return false;
    }

    if (symbol.symbol_type !== 'method') {
      return false;
    }

    if (!symbol.file_id) {
      return false;
    }

    if (this.state.isFileValidated(symbol.file_id)) {
      return false;
    }

    const parentContainerId = await queries.getParentContainer(symbol.id);
    if (!parentContainerId) {
      return false;
    }

    const parentEntityType = await queries.getParentEntityType(parentContainerId);
    if (!parentEntityType) {
      return false;
    }

    return FileValidationPolicy.ARCHITECTURAL_ENTITY_TYPES.includes(parentEntityType);
  }

  async shouldSkipNonArchitecturalMethod(
    symbol: SymbolInfo,
    depth: number,
    queries: SymbolGraphQueries
  ): Promise<boolean> {
    if (depth < 1) {
      return false;
    }

    if (symbol.symbol_type !== 'method') {
      return false;
    }

    if (!symbol.file_id) {
      return false;
    }

    if (this.state.isFileValidated(symbol.file_id)) {
      return false;
    }

    const parentContainerId = await queries.getParentContainer(symbol.id);
    if (!parentContainerId) {
      return true;
    }

    const parentEntityType = await queries.getParentEntityType(parentContainerId);
    if (!parentEntityType) {
      return true;
    }

    return !FileValidationPolicy.ARCHITECTURAL_ENTITY_TYPES.includes(parentEntityType);
  }

  isValidatedEntityType(entityType: string | undefined): boolean {
    if (!entityType) {
      return false;
    }
    return FileValidationPolicy.VALIDATED_ENTITY_TYPES.includes(entityType);
  }

  shouldAddToValidatedFiles(symbol: SymbolInfo): boolean {
    if (!this.isValidatedEntityType(symbol.entity_type)) {
      return false;
    }

    if (symbol.entity_type === 'model') {
      return false;
    }

    return true;
  }
}
