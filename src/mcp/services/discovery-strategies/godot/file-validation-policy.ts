/**
 * Godot File Validation Policy
 *
 * Determines file-level validation for symbols in Godot game architecture.
 * Only includes symbols from files containing validated architectural entities
 * at deep depths, preventing pollution from utility files.
 *
 * Key concept: At depth > 1, only include symbols from files that contain
 * architectural components (handlers, managers, services) to avoid pulling in
 * generic utilities and shared infrastructure methods.
 */

import type { GodotSymbolInfo } from './symbol-classifier';
import type { GodotTraversalState } from './traversal-state';
import type { GodotSymbolGraphQueries } from './symbol-graph-queries';
import {
  FILE_VALIDATING_ENTITIES,
  FEATURE_SCOPED_ENTITIES,
} from './godot-constants';

export class GodotFileValidationPolicy {

  constructor(private readonly state: GodotTraversalState) {}

  /**
   * Should validate symbol by checking if its file contains architectural entities.
   *
   * Rules:
   * - Depth 0-1: Always allow (direct feature symbols)
   * - Depth 2+: Only allow if from validated architectural file OR is itself validated entity
   */
  shouldValidateByFile(symbol: GodotSymbolInfo, depth: number): boolean {
    // Depth 0-1: always allow
    if (depth <= 1) {
      return true;
    }

    if (!symbol.file_id) {
      return true;
    }

    // If it's a validated entity type, always allow
    const isValidatedEntity = this.isValidatedEntityType(symbol.entity_type);
    if (isValidatedEntity) {
      return true;
    }

    // Nodes are like models - data entities that should be included
    if (symbol.symbol_type === 'class' && symbol.entity_type === 'node') {
      return true;
    }

    // Otherwise, file must be validated
    return this.state.isFileValidated(symbol.file_id);
  }

  /**
   * Should pre-validate parent file for architectural methods.
   *
   * If a method is from an unvalidated file but its parent is feature-scoped
   * (handler, event_channel), validate the file before filtering.
   */
  async shouldPreValidateParentFile(
    symbol: GodotSymbolInfo,
    depth: number,
    queries: GodotSymbolGraphQueries
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

    return FEATURE_SCOPED_ENTITIES.includes(parentEntityType);
  }

  /**
   * Should skip non-architectural method from unvalidated file.
   *
   * This catches utility methods and shared infrastructure.
   */
  async shouldSkipNonArchitecturalMethod(
    symbol: GodotSymbolInfo,
    depth: number,
    queries: GodotSymbolGraphQueries
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

    return !FEATURE_SCOPED_ENTITIES.includes(parentEntityType);
  }

  /**
   * Is this a validated entity type?
   */
  isValidatedEntityType(entityType: string | undefined): boolean {
    if (!entityType) {
      return false;
    }
    return FILE_VALIDATING_ENTITIES.includes(entityType);
  }

  /**
   * Should add this symbol's file to validated files set?
   *
   * Only architectural entities validate their files.
   * Nodes don't validate (they're data entities, not architectural).
   */
  shouldAddToValidatedFiles(symbol: GodotSymbolInfo): boolean {
    if (!this.isValidatedEntityType(symbol.entity_type)) {
      return false;
    }

    // Nodes and resources don't validate files (they're data, not architecture)
    if (symbol.entity_type === 'node' || symbol.entity_type === 'resource') {
      return false;
    }

    return true;
  }
}
