import { File, Symbol, CreateFileDependency, DependencyType } from '../../database/models';
import { ParseResult } from '../../parsers/base';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('file-dependency-builder');

/**
 * File Dependency Builder
 * Creates file-level dependency relationships
 */

/**
 * Create file dependencies for unresolved external calls (e.g., Laravel model calls)
 */
export function createExternalCallFileDependencies(
  parseResults: Array<ParseResult & { filePath: string }>,
  dbFiles: File[],
  symbols: Symbol[]
): CreateFileDependency[] {
  const fileDependencies: CreateFileDependency[] = [];

  // Create lookup maps for efficiency
  const pathToFileId = new Map<string, number>();
  const symbolIdToFileId = new Map<number, number>();

  // Populate file mappings
  for (const file of dbFiles) {
    pathToFileId.set(file.path, file.id);
  }

  // Populate symbol to file mapping
  for (const symbol of symbols) {
    symbolIdToFileId.set(symbol.id, symbol.file_id);
  }

  // Track existing symbol dependencies to avoid duplicates
  const existingSymbolDeps = new Set<string>();
  // Note: We'll populate this by checking if symbols were successfully resolved

  for (const parseResult of parseResults) {
    const sourceFileId = pathToFileId.get(parseResult.filePath);
    if (!sourceFileId) continue;

    // Check each dependency to see if it was resolved to a symbol dependency
    for (const dependency of parseResult.dependencies) {
      // Handle both 'calls' and 'imports' dependencies for external calls
      if (dependency.dependency_type !== 'calls' && dependency.dependency_type !== 'imports') {
        continue;
      }

      // Check if this is likely an external call
      // For calls: contains :: for static methods (User::all, User::create)
      // For imports: Laravel facades and framework calls
      const isExternalCall =
        dependency.to_symbol.includes('::') || dependency.dependency_type === 'imports';

      if (isExternalCall) {
        // Create a file dependency representing this external call
        // The "target" will be the same file for now, representing the external call
        fileDependencies.push({
          from_file_id: sourceFileId,
          to_file_id: sourceFileId, // External calls don't have a target file in our codebase
          dependency_type: dependency.dependency_type,
          line_number: dependency.line_number,
        });
      }
    }
  }

  logger.info('Created external call file dependencies', {
    count: fileDependencies.length,
  });

  return fileDependencies;
}

/**
 * Create file dependencies for external imports (e.g., Laravel facades, npm packages)
 */
export function createExternalImportFileDependencies(
  parseResults: Array<ParseResult & { filePath: string }>,
  dbFiles: File[]
): CreateFileDependency[] {
  const fileDependencies: CreateFileDependency[] = [];

  // Create lookup map for efficiency
  const pathToFileId = new Map<string, number>();
  for (const file of dbFiles) {
    pathToFileId.set(file.path, file.id);
  }

  for (const parseResult of parseResults) {
    const sourceFileId = pathToFileId.get(parseResult.filePath);
    if (!sourceFileId) continue;

    // Process imports to identify external packages
    for (const importInfo of parseResult.imports) {
      // Check if this is an external import (not relative/absolute path to local file)
      const isExternalImport =
        !importInfo.source.startsWith('./') &&
        !importInfo.source.startsWith('../') &&
        !importInfo.source.startsWith('/') &&
        !importInfo.source.startsWith('src/') &&
        !importInfo.source.startsWith('@/');

      if (isExternalImport) {
        // Create a file dependency representing this external import
        // Since we can't reference a real external file, we create a self-reference
        // The presence of this dependency with dependency_type 'imports' indicates external usage
        fileDependencies.push({
          from_file_id: sourceFileId,
          to_file_id: sourceFileId, // Self-reference to indicate external import
          dependency_type: DependencyType.IMPORTS,
          line_number: importInfo.line_number || 1,
        });
      }
    }
  }

  logger.info('Created external import file dependencies', {
    count: fileDependencies.length,
  });

  return fileDependencies;
}

/**
 * Create file dependencies from cross-file symbol dependencies
 */
export function createCrossFileFileDependencies(
  symbolDependencies: any[],
  symbols: Symbol[],
  dbFiles: File[]
): CreateFileDependency[] {
  const fileDependencies: CreateFileDependency[] = [];

  // Create lookup maps for efficiency
  const symbolIdToFileId = new Map<number, number>();
  const fileIdToPath = new Map<number, string>();
  const pathToFileId = new Map<string, number>();

  // Populate symbol to file mapping
  for (const symbol of symbols) {
    symbolIdToFileId.set(symbol.id, symbol.file_id);
  }

  // Populate file mappings
  for (const file of dbFiles) {
    fileIdToPath.set(file.id, file.path);
    pathToFileId.set(file.path, file.id);
  }

  // Process each symbol dependency
  for (const symbolDep of symbolDependencies) {
    const fromFileId = symbolIdToFileId.get(symbolDep.from_symbol_id);
    const toFileId = symbolIdToFileId.get(symbolDep.to_symbol_id);

    // Only create file dependency if symbols are in different files
    if (fromFileId && toFileId && fromFileId !== toFileId) {
      // Check if this file dependency already exists in our list
      const existingDep = fileDependencies.find(
        fd =>
          fd.from_file_id === fromFileId &&
          fd.to_file_id === toFileId &&
          fd.dependency_type === symbolDep.dependency_type
      );

      if (!existingDep) {
        fileDependencies.push({
          from_file_id: fromFileId,
          to_file_id: toFileId,
          dependency_type: symbolDep.dependency_type,
          line_number: symbolDep.line_number,
        });
      }
    }
  }

  return fileDependencies;
}
