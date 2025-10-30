import type { Knex } from 'knex';
import { getDatabaseConnection } from '../../database/connection';
import { createComponentLogger } from '../../utils/logger';
import { TransitiveResult } from './types';

const logger = createComponentLogger('call-chain-formatter');

export async function formatCallChain(
  path: number[],
  db: Knex = getDatabaseConnection()
): Promise<string> {
  if (path.length === 0) {
    return '';
  }

  try {
    const symbolNames = await resolveSymbolNames(path, db);
    const apiCallMetadata = await resolveApiCallMetadata(path, db);
    const edgeQualifiedNames = await resolveEdgeQualifiedNames(path, db);

    const chainParts: string[] = [];

    for (let i = 0; i < path.length; i++) {
      const symbolId = path[i];
      const symbolInfo = symbolNames.get(symbolId);

      if (!symbolInfo) {
        chainParts.push(`Symbol(${symbolId})`);
        continue;
      }

      let part = symbolInfo.name;

      if (i > 0) {
        const fromSymbolId = path[i - 1];
        const edgeKey = `${fromSymbolId}->${symbolId}`;
        const qualifiedName = edgeQualifiedNames.get(edgeKey);

        if (qualifiedName) {
          part = qualifiedName;
        } else if (symbolInfo.className && symbolInfo.className !== symbolInfo.name) {
          part = `${symbolInfo.className}.${symbolInfo.name}`;
        }
      } else {
        if (symbolInfo.className && symbolInfo.className !== symbolInfo.name) {
          part = `${symbolInfo.className}.${symbolInfo.name}`;
        }
      }

      if (symbolInfo.isCallable && !part.includes('(')) {
        part += '()';
      }

      if (i > 0 && symbolInfo.filePath !== symbolNames.get(path[i - 1])?.filePath) {
        part += ` (${getShortFilePath(symbolInfo.filePath)})`;
      }

      chainParts.push(part);

      if (i < path.length - 1) {
        const fromSymbolId = symbolId;
        const toSymbolId = path[i + 1];
        const edgeKey = `${fromSymbolId}->${toSymbolId}`;
        const apiCall = apiCallMetadata.get(edgeKey);

        if (apiCall) {
          chainParts.push(`[${apiCall.httpMethod} ${apiCall.endpointPath}]`);
        }
      }
    }

    return chainParts.join(' → ');
  } catch (error) {
    logger.warn('Failed to format call chain', {
      path,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return `Call chain [${path.join(' → ')}]`;
  }
}

async function resolveApiCallMetadata(
  path: number[],
  db: Knex
): Promise<Map<string, { httpMethod: string; endpointPath: string }>> {
  const metadataMap = new Map();

  if (path.length < 2) {
    return metadataMap;
  }

  const edges: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < path.length - 1; i++) {
    edges.push({ from: path[i], to: path[i + 1] });
  }

  if (edges.length === 0) {
    return metadataMap;
  }

  let query = db('api_calls').select(
    'caller_symbol_id',
    'endpoint_symbol_id',
    'http_method',
    'endpoint_path'
  );

  query = query.where(function () {
    for (const edge of edges) {
      this.orWhere(function () {
        this.where('caller_symbol_id', edge.from).andWhere('endpoint_symbol_id', edge.to);
      });
    }
  });

  const results = await query;

  for (const row of results) {
    const edgeKey = `${row.caller_symbol_id}->${row.endpoint_symbol_id}`;
    metadataMap.set(edgeKey, {
      httpMethod: row.http_method,
      endpointPath: row.endpoint_path,
    });
  }

  return metadataMap;
}

async function resolveEdgeQualifiedNames(
  path: number[],
  db: Knex
): Promise<Map<string, string>> {
  const qualifiedNameMap = new Map();

  if (path.length < 2) {
    return qualifiedNameMap;
  }

  const edges: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < path.length - 1; i++) {
    edges.push({ from: path[i], to: path[i + 1] });
  }

  if (edges.length === 0) {
    return qualifiedNameMap;
  }

  let query = db('dependencies').select('from_symbol_id', 'to_symbol_id', 'to_qualified_name');

  query = query.where(function () {
    for (const edge of edges) {
      this.orWhere(function () {
        this.where('from_symbol_id', edge.from).andWhere('to_symbol_id', edge.to);
      });
    }
  });

  const results = await query;

  for (const row of results) {
    if (row.to_qualified_name) {
      const edgeKey = `${row.from_symbol_id}->${row.to_symbol_id}`;
      qualifiedNameMap.set(edgeKey, row.to_qualified_name);
    }
  }

  return qualifiedNameMap;
}

async function resolveSymbolNames(
  symbolIds: number[],
  db: Knex
): Promise<
  Map<
    number,
    {
      name: string;
      className?: string;
      isCallable: boolean;
      filePath: string;
    }
  >
> {
  const symbolMap = new Map();

  if (symbolIds.length === 0) {
    return symbolMap;
  }

  const query = db('symbols')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .whereIn('symbols.id', symbolIds)
    .select('symbols.id', 'symbols.name', 'symbols.symbol_type', 'symbols.signature', 'files.path as file_path');

  const results = await query;

  for (const row of results) {
    const isCallable = ['function', 'method'].includes(row.symbol_type);

    let className: string | undefined;
    if (row.symbol_type === 'method' && row.signature) {
      const match = row.signature.match(/class\s+(\w+)/);
      if (match) {
        className = match[1];
      }
    }

    symbolMap.set(row.id, {
      name: row.name,
      className,
      isCallable,
      filePath: row.file_path || 'unknown',
    });
  }

  return symbolMap;
}

function getShortFilePath(fullPath: string): string {
  const parts = fullPath.split(/[/\\]/);
  return parts.length > 3 ? `.../${parts.slice(-2).join('/')}` : fullPath;
}

export async function enhanceResultsWithCallChains(
  results: TransitiveResult[],
  showCallChains: boolean,
  db: Knex = getDatabaseConnection()
): Promise<TransitiveResult[]> {
  if (!showCallChains || results.length === 0) {
    return results;
  }

  const enhancedResults = await Promise.all(
    results.map(async result => {
      const fullPath = [...result.path, result.symbolId];
      const callChain = await formatCallChain(fullPath, db);

      return {
        ...result,
        call_chain: callChain,
      };
    })
  );

  return enhancedResults;
}
