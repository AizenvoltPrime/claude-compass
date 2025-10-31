/**
 * API call extraction from frontend files
 */

import type { Knex } from 'knex';
import { File as DbFile } from '../../database/models';
import * as FileService from '../../database/services/file-service';
import { ApiCallExtractor } from '../../parsers/utils/api-call-extractor';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('api-call-extraction');

/**
 * Get frontend files that potentially contain API calls
 */
export async function getFrontendFilesWithApiCalls(
  db: Knex,
  repoId: number
): Promise<DbFile[]> {
  const allFiles = await FileService.getFilesByRepository(db, repoId);

  const frontendFiles = allFiles.filter(file => {
    const path = file.path.toLowerCase();

    if (!path.endsWith('.ts') && !path.endsWith('.js') && !path.endsWith('.vue')) {
      return false;
    }

    if (path.endsWith('.d.ts')) {
      return false;
    }

    if (path.includes('.test.') || path.includes('.spec.')) {
      return false;
    }

    if (path.includes('/node_modules/') || path.includes('/dist/') || path.includes('/build/')) {
      return false;
    }

    return true;
  });

  logger.info('Found frontend files to scan for API calls', {
    count: frontendFiles.length,
    samplePaths: frontendFiles.slice(0, 5).map(f => f.path),
  });

  return frontendFiles;
}

/**
 * Extract API calls from all frontend files
 */
export async function extractApiCallsFromFrontendFiles(
  db: Knex,
  repoId: number,
  apiCallExtractor: ApiCallExtractor
): Promise<any[]> {
  const frontendFiles = await getFrontendFilesWithApiCalls(db, repoId);
  const apiCalls: any[] = [];
  let filesWithApiCalls = 0;

  for (const file of frontendFiles) {
    try {
      const fs = await import('fs/promises');

      const fileContent = await fs.readFile(file.path, 'utf-8');

      const exportName = await extractExportNameFromContent(db, fileContent, file.path);

      const extractedCalls = extractFetchCallsFromContent(
        fileContent,
        file.path,
        exportName,
        apiCallExtractor
      );

      if (extractedCalls.length > 0) {
        filesWithApiCalls++;
        apiCalls.push(...extractedCalls);
      }
    } catch (error) {
      logger.warn('Failed to extract API calls from file', {
        path: file.path,
        error: error.message,
      });
    }
  }

  logger.info('API call extraction complete', {
    totalFilesScanned: frontendFiles.length,
    filesWithApiCalls,
    totalApiCalls: apiCalls.length,
    sampleUrls: apiCalls
      .slice(0, 5)
      .map(c => ({ url: c.url, method: c.method, file: c.componentName })),
  });

  return apiCalls;
}

/**
 * Extract export name from file content
 */
export async function extractExportNameFromContent(
  db: Knex,
  content: string,
  filePath: string
): Promise<string> {
  const path = require('path');
  const fileName = path.basename(filePath, path.extname(filePath));

  try {
    let symbols = await db('symbols')
      .join('files', 'symbols.file_id', '=', 'files.id')
      .where('files.path', filePath)
      .andWhere('symbols.is_exported', true)
      .select('symbols.name', 'symbols.symbol_type', 'symbols.is_exported')
      .orderByRaw(
        "CASE WHEN symbols.symbol_type = 'variable' AND symbols.name LIKE 'use%Store' THEN 0 WHEN symbols.symbol_type IN ('function', 'class') THEN 1 ELSE 2 END"
      )
      .limit(1);

    if (symbols.length > 0 && symbols[0].name) {
      return symbols[0].name;
    }

    logger.debug('No exported symbols found, searching for any symbol', { filePath });

    symbols = await db('symbols')
      .join('files', 'symbols.file_id', '=', 'files.id')
      .where('files.path', filePath)
      .whereIn('symbols.symbol_type', ['variable', 'function', 'class', 'component', 'method'])
      .select('symbols.name', 'symbols.symbol_type')
      .orderByRaw(
        "CASE WHEN symbols.symbol_type = 'variable' AND symbols.name LIKE 'use%Store' THEN 0 WHEN symbols.symbol_type IN ('function', 'class', 'method') THEN 1 ELSE 2 END"
      )
      .limit(1);

    if (symbols.length > 0 && symbols[0].name) {
      logger.debug('Using non-exported symbol name', {
        filePath,
        symbolName: symbols[0].name,
        symbolType: symbols[0].symbol_type,
      });
      return symbols[0].name;
    }

    logger.warn(
      'File has no symbols in database, API calls from this file will be dropped',
      {
        filePath,
        fileName,
      }
    );

    return fileName;
  } catch (error) {
    logger.error('Database error while extracting export name', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to query component name from database: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extract fetch calls from file content
 */
export function extractFetchCallsFromContent(
  content: string,
  filePath: string,
  componentName: string,
  apiCallExtractor: ApiCallExtractor
): any[] {
  const language =
    filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.vue')
      ? 'typescript'
      : 'javascript';

  const extractedCalls = apiCallExtractor.extractFromContent(content, filePath, language);

  return extractedCalls.map(call => ({
    url: call.url,
    normalizedUrl: call.url,
    method: call.method,
    location: {
      line: call.line,
      column: call.column,
    },
    filePath: call.filePath || filePath,
    componentName: call.callerName || componentName,
  }));
}
