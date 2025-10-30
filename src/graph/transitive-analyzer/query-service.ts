import type { Knex } from 'knex';
import { getDatabaseConnection } from '../../database/connection';
import { DependencyType, DependencyWithSymbols } from '../../database/models';
import { TransitiveAnalysisOptions, CrossStackRelationship } from './types';

export async function getDirectCallers(
  symbolId: number,
  options: TransitiveAnalysisOptions,
  db: Knex = getDatabaseConnection()
): Promise<DependencyWithSymbols[]> {
  let query = db('dependencies')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
    .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
    .where('dependencies.to_symbol_id', symbolId)
    .select(
      'dependencies.*',
      'from_symbols.id as from_symbol_id',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_files.path as from_file_path',
      'to_symbols.id as to_symbol_id',
      'to_symbols.name as to_symbol_name',
      'to_symbols.symbol_type as to_symbol_type',
      'to_files.path as to_file_path'
    );

  if (options.includeTypes && options.includeTypes.length > 0) {
    query = query.whereIn('dependencies.dependency_type', options.includeTypes);
  }

  if (options.excludeTypes && options.excludeTypes.length > 0) {
    query = query.whereNotIn('dependencies.dependency_type', options.excludeTypes);
  }

  const results = await query;

  return results.map(row => ({
    id: row.id,
    from_symbol_id: row.from_symbol_id,
    to_symbol_id: row.to_symbol_id,
    dependency_type: row.dependency_type,
    line_number: row.line_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
    from_symbol: row.from_symbol_id
      ? {
          id: row.from_symbol_id,
          name: row.from_symbol_name,
          symbol_type: row.from_symbol_type,
          file: row.from_file_path
            ? {
                path: row.from_file_path,
              }
            : undefined,
        }
      : undefined,
    to_symbol: row.to_symbol_id
      ? {
          id: row.to_symbol_id,
          name: row.to_symbol_name,
          symbol_type: row.to_symbol_type,
          file: row.to_file_path
            ? {
                path: row.to_file_path,
              }
            : undefined,
        }
      : undefined,
  })) as DependencyWithSymbols[];
}

export async function getDirectDependencies(
  symbolId: number,
  options: TransitiveAnalysisOptions,
  db: Knex = getDatabaseConnection()
): Promise<DependencyWithSymbols[]> {
  let depsQuery = db('dependencies')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
    .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
    .where('dependencies.from_symbol_id', symbolId)
    .select(
      'dependencies.*',
      'from_symbols.id as from_symbol_id',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_files.path as from_file_path',
      'to_symbols.id as to_symbol_id',
      'to_symbols.name as to_symbol_name',
      'to_symbols.symbol_type as to_symbol_type',
      'to_files.path as to_file_path'
    );

  if (options.includeTypes && options.includeTypes.length > 0) {
    depsQuery = depsQuery.whereIn('dependencies.dependency_type', options.includeTypes);
  }

  if (options.excludeTypes && options.excludeTypes.length > 0) {
    depsQuery = depsQuery.whereNotIn('dependencies.dependency_type', options.excludeTypes);
  }

  const shouldIncludeApiCalls =
    options.includeCrossStack ||
    (options.includeTypes && options.includeTypes.includes(DependencyType.API_CALL));

  let apiCallsResults: any[] = [];
  if (shouldIncludeApiCalls) {
    const apiCallsQuery = db('api_calls')
      .leftJoin('symbols as caller_symbols', 'api_calls.caller_symbol_id', 'caller_symbols.id')
      .leftJoin('files as caller_files', 'caller_symbols.file_id', 'caller_files.id')
      .leftJoin('symbols as endpoint_symbols', 'api_calls.endpoint_symbol_id', 'endpoint_symbols.id')
      .leftJoin('files as endpoint_files', 'endpoint_symbols.file_id', 'endpoint_files.id')
      .where('api_calls.caller_symbol_id', symbolId)
      .select(
        'api_calls.id',
        'api_calls.caller_symbol_id as from_symbol_id',
        'api_calls.endpoint_symbol_id as to_symbol_id',
        'api_calls.line_number',
        'api_calls.created_at',
        'api_calls.updated_at',
        'caller_symbols.name as from_symbol_name',
        'caller_symbols.symbol_type as from_symbol_type',
        'caller_files.path as from_file_path',
        'endpoint_symbols.name as to_symbol_name',
        'endpoint_symbols.symbol_type as to_symbol_type',
        'endpoint_files.path as to_file_path'
      );

    apiCallsResults = await apiCallsQuery;
  }

  const depsResults = await depsQuery;

  const depsFormatted = depsResults.map(row => ({
    id: row.id,
    from_symbol_id: row.from_symbol_id,
    to_symbol_id: row.to_symbol_id,
    dependency_type: row.dependency_type,
    line_number: row.line_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
    from_symbol: row.from_symbol_id
      ? {
          id: row.from_symbol_id,
          name: row.from_symbol_name,
          symbol_type: row.from_symbol_type,
          file: row.from_file_path
            ? {
                path: row.from_file_path,
              }
            : undefined,
        }
      : undefined,
    to_symbol: row.to_symbol_id
      ? {
          id: row.to_symbol_id,
          name: row.to_symbol_name,
          symbol_type: row.to_symbol_type,
          file: row.to_file_path
            ? {
                path: row.to_file_path,
              }
            : undefined,
        }
      : undefined,
  }));

  const apiCallsFormatted = apiCallsResults.map(row => ({
    id: row.id,
    from_symbol_id: row.from_symbol_id,
    to_symbol_id: row.to_symbol_id,
    dependency_type: DependencyType.API_CALL,
    line_number: row.line_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
    from_symbol: row.from_symbol_id
      ? {
          id: row.from_symbol_id,
          name: row.from_symbol_name,
          symbol_type: row.from_symbol_type,
          file: row.from_file_path
            ? {
                path: row.from_file_path,
              }
            : undefined,
        }
      : undefined,
    to_symbol: row.to_symbol_id
      ? {
          id: row.to_symbol_id,
          name: row.to_symbol_name,
          symbol_type: row.to_symbol_type,
          file: row.to_file_path
            ? {
                path: row.to_file_path,
              }
            : undefined,
        }
      : undefined,
  }));

  return [...depsFormatted, ...apiCallsFormatted] as DependencyWithSymbols[];
}

export async function getCrossStackCallers(
  symbolId: number,
  db: Knex = getDatabaseConnection()
): Promise<DependencyWithSymbols[]> {
  const depsQuery = db('dependencies')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
    .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
    .where('dependencies.to_symbol_id', symbolId)
    .whereIn('dependencies.dependency_type', [
      DependencyType.API_CALL,
      DependencyType.SHARES_SCHEMA,
      DependencyType.FRONTEND_BACKEND,
    ])
    .select(
      'dependencies.*',
      'from_symbols.id as from_symbol_id',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_files.path as from_file_path',
      'from_files.language as from_language',
      'to_symbols.id as to_symbol_id',
      'to_symbols.name as to_symbol_name',
      'to_symbols.symbol_type as to_symbol_type',
      'to_files.path as to_file_path',
      'to_files.language as to_language'
    )
    .orderBy('dependencies.id', 'desc');

  const apiCallsQuery = db('api_calls')
    .leftJoin('symbols as caller_symbols', 'api_calls.caller_symbol_id', 'caller_symbols.id')
    .leftJoin('files as caller_files', 'caller_symbols.file_id', 'caller_files.id')
    .leftJoin('symbols as endpoint_symbols', 'api_calls.endpoint_symbol_id', 'endpoint_symbols.id')
    .leftJoin('files as endpoint_files', 'endpoint_symbols.file_id', 'endpoint_files.id')
    .where('api_calls.endpoint_symbol_id', symbolId)
    .select(
      'api_calls.id',
      'api_calls.caller_symbol_id as from_symbol_id',
      'api_calls.endpoint_symbol_id as to_symbol_id',
      'api_calls.line_number',
      'api_calls.created_at',
      'api_calls.updated_at',
      'caller_symbols.name as from_symbol_name',
      'caller_symbols.symbol_type as from_symbol_type',
      'caller_files.path as from_file_path',
      'caller_files.language as from_language',
      'endpoint_symbols.name as to_symbol_name',
      'endpoint_symbols.symbol_type as to_symbol_type',
      'endpoint_files.path as to_file_path',
      'endpoint_files.language as to_language'
    );

  const [depsResults, apiCallsResults] = await Promise.all([depsQuery, apiCallsQuery]);

  const depsFormatted = depsResults.map(row => ({
    id: row.id,
    from_symbol_id: row.from_symbol_id,
    to_symbol_id: row.to_symbol_id,
    dependency_type: row.dependency_type,
    line_number: row.line_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
    from_symbol: row.from_symbol_id
      ? {
          id: row.from_symbol_id,
          name: row.from_symbol_name,
          symbol_type: row.from_symbol_type,
          file: row.from_file_path
            ? {
                path: row.from_file_path,
                language: row.from_language,
              }
            : undefined,
        }
      : undefined,
    to_symbol: row.to_symbol_id
      ? {
          id: row.to_symbol_id,
          name: row.to_symbol_name,
          symbol_type: row.to_symbol_type,
          file: row.to_file_path
            ? {
                path: row.to_file_path,
                language: row.to_language,
              }
            : undefined,
        }
      : undefined,
  }));

  const apiCallsFormatted = apiCallsResults.map(row => ({
    id: row.id,
    from_symbol_id: row.from_symbol_id,
    to_symbol_id: row.to_symbol_id,
    dependency_type: DependencyType.API_CALL,
    line_number: row.line_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
    from_symbol: row.from_symbol_id
      ? {
          id: row.from_symbol_id,
          name: row.from_symbol_name,
          symbol_type: row.from_symbol_type,
          file: row.from_file_path
            ? {
                path: row.from_file_path,
                language: row.from_language,
              }
            : undefined,
        }
      : undefined,
    to_symbol: row.to_symbol_id
      ? {
          id: row.to_symbol_id,
          name: row.to_symbol_name,
          symbol_type: row.to_symbol_type,
          file: row.to_file_path
            ? {
                path: row.to_file_path,
                language: row.to_language,
              }
            : undefined,
        }
      : undefined,
  }));

  return [...depsFormatted, ...apiCallsFormatted] as DependencyWithSymbols[];
}

export async function getCrossStackRelationships(
  symbolId: number,
  db: Knex = getDatabaseConnection()
): Promise<CrossStackRelationship[]> {
  const query = db('dependencies')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
    .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
    .where(function () {
      this.where('dependencies.from_symbol_id', symbolId).orWhere('dependencies.to_symbol_id', symbolId);
    })
    .whereIn('dependencies.dependency_type', [
      DependencyType.API_CALL,
      DependencyType.SHARES_SCHEMA,
      DependencyType.FRONTEND_BACKEND,
    ])
    .select(
      'dependencies.*',
      'from_symbols.id as from_symbol_id',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_files.path as from_file_path',
      'from_files.language as from_language',
      'to_symbols.id as to_symbol_id',
      'to_symbols.name as to_symbol_name',
      'to_symbols.symbol_type as to_symbol_type',
      'to_files.path as to_file_path',
      'to_files.language as to_language'
    );

  const results = await query;

  return results.map(row => ({
    fromSymbol: {
      id: row.from_symbol_id,
      name: row.from_symbol_name,
      type: row.from_symbol_type,
      language: row.from_language || 'unknown',
    },
    toSymbol: {
      id: row.to_symbol_id,
      name: row.to_symbol_name,
      type: row.to_symbol_type,
      language: row.to_language || 'unknown',
    },
    relationshipType: row.dependency_type,
    path: [],
  }));
}
