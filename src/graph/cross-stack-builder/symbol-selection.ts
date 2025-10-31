/**
 * Symbol selection utilities for cross-stack graph builder
 */

import type { Knex } from 'knex';
import { SymbolWithFile } from '../../database/models';
import * as ApiCallService from '../../database/services/api-call-service';

/**
 * Select best matching symbol from candidates
 */
export function selectBestMatchingSymbol(
  candidates: SymbolWithFile[],
  apiCallFilePath?: string
): SymbolWithFile | null {
  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const frontendPatterns = [
    '/resources/ts/',
    '/resources/js/',
    '.vue',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
  ];

  const getFilePath = (symbol: SymbolWithFile): string | undefined => {
    return (symbol as any).file_path || symbol.file?.path;
  };

  const isFrontendFile = (filePath: string | undefined): boolean => {
    if (!filePath) return false;
    return frontendPatterns.some(pattern => filePath.includes(pattern));
  };

  const frontendCandidates = candidates.filter(s => isFrontendFile(getFilePath(s)));

  if (frontendCandidates.length === 0) {
    return null;
  }

  if (apiCallFilePath) {
    const sameFileCandidates = frontendCandidates.filter(s => getFilePath(s) === apiCallFilePath);

    if (sameFileCandidates.length > 0) {
      return sameFileCandidates[0];
    }
  }

  const callableCandidates = frontendCandidates.filter(
    s => s.symbol_type === 'function' || s.symbol_type === 'method'
  );

  if (callableCandidates.length > 0) {
    return callableCandidates[0];
  }

  return frontendCandidates[0];
}

/**
 * Check if repository contains multi-framework project
 */
export async function isMultiFrameworkProject(
  db: Knex,
  repoId: number,
  frameworks: string[]
): Promise<boolean> {
  try {
    const detectedFrameworks = await ApiCallService.getRepositoryFrameworks(db, repoId);
    return frameworks.every(framework => detectedFrameworks.includes(framework));
  } catch (error) {
    return false;
  }
}
