import type { Knex } from 'knex';
import type {
  EnhancedDependencyWithSymbols,
  SymbolWithFile,
  Route,
  Component,
  Composable,
  ORMEntity,
} from '../models';
import type { PaginationParams, PaginatedResponse } from '../pagination';
import { createPaginatedQuery } from '../pagination';
import { withCache } from '../cache';
import { safeParseParameterTypes } from './validation-utils';
import * as RouteService from './route-service';
import * as ComponentService from './component-service';
import * as ComposableService from './composable-service';
import * as OrmService from './orm-service';
import * as SymbolService from './symbol-service';

export async function groupCallsByParameterContext(
  db: Knex,
  symbolId: number
): Promise<{
  methodName: string;
  totalCalls: number;
  parameterVariations: Array<{
    parameter_context: string;
    call_instance_ids: string[];
    call_count: number;
    line_numbers: number[];
    callers: Array<{
      caller_name: string;
      file_path: string;
      line_number: number;
    }>;
    parameter_types?: string[];
  }>;
}> {
  const targetSymbol = await SymbolService.getSymbolWithFile(db, symbolId);
  if (!targetSymbol) {
    throw new Error('Symbol not found');
  }

  const calls = await db('dependencies')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .where('dependencies.to_symbol_id', symbolId)
    .whereNotNull('dependencies.parameter_context')
    .select(
      'dependencies.*',
      'from_symbols.name as caller_name',
      'from_files.path as caller_file_path'
    );

  const parameterGroups = new Map<string, any>();

  for (const call of calls) {
    const paramContext = call.parameter_context || 'no-parameters';

    if (!parameterGroups.has(paramContext)) {
      parameterGroups.set(paramContext, {
        parameter_context: paramContext,
        call_instance_ids: [],
        call_count: 0,
        line_numbers: [],
        callers: [],
        parameter_types: call.parameter_types
          ? safeParseParameterTypes(call.parameter_types)
          : undefined,
      });
    }

    const group = parameterGroups.get(paramContext);
    group.call_instance_ids.push(call.call_instance_id);
    group.call_count++;
    group.line_numbers.push(call.line_number);
    group.callers.push({
      caller_name: call.caller_name,
      file_path: call.caller_file_path,
      line_number: call.line_number,
    });
  }

  const parameterVariations = Array.from(parameterGroups.values()).map(group => ({
    ...group,
  }));

  return {
    methodName: targetSymbol.name,
    totalCalls: calls.length,
    parameterVariations,
  };
}

export async function getDependenciesToWithContextPaginated(
  db: Knex,
  symbolId: number,
  paginationParams: PaginationParams = {}
): Promise<PaginatedResponse<EnhancedDependencyWithSymbols>> {
  const distinctSubquery = db('dependencies')
    .select(
      db.raw('MIN(id) as id'),
      'from_symbol_id',
      'to_symbol_id',
      'dependency_type',
      'line_number'
    )
    .where('to_symbol_id', symbolId)
    .whereRaw('from_symbol_id != to_symbol_id')
    .groupBy('from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number');

  const baseQuery = db('dependencies')
    .join(
      db.raw(`(${distinctSubquery.toString()}) as distinct_deps`),
      'dependencies.id',
      'distinct_deps.id'
    )
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .select(
      'dependencies.*',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_files.path as from_file_path'
    )
    .orderBy('dependencies.id', 'asc');

  const countQuery = db('dependencies')
    .countDistinct(['from_symbol_id', 'to_symbol_id', 'dependency_type', 'line_number'])
    .where('dependencies.to_symbol_id', symbolId)
    .whereRaw('dependencies.from_symbol_id != dependencies.to_symbol_id');

  const result = await createPaginatedQuery<any>(
    baseQuery,
    paginationParams,
    countQuery,
    'dependencies.id'
  );

  result.data = result.data.map(row => ({
    ...row,
    from_symbol: {
      id: row.from_symbol_id,
      name: row.from_symbol_name,
      symbol_type: row.from_symbol_type,
      file: {
        id: row.from_file_id,
        path: row.from_file_path,
      },
    },
    calling_object: row.calling_object,
    resolved_class: row.resolved_class,
    qualified_context: row.qualified_context,
    method_signature: row.method_signature,
    file_context: row.file_context,
    namespace_context: row.namespace_context,
    parameter_context: row.parameter_context,
    call_instance_id: row.call_instance_id,
    parameter_types: row.parameter_types
      ? safeParseParameterTypes(row.parameter_types)
      : undefined,
  })) as EnhancedDependencyWithSymbols[];

  return result;
}

export async function getDependenciesFromWithContextPaginated(
  db: Knex,
  symbolId: number,
  paginationParams: PaginationParams = {}
): Promise<PaginatedResponse<EnhancedDependencyWithSymbols>> {
  const baseQuery = db('dependencies')
    .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
    .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
    .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
    .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
    .select(
      'dependencies.*',
      'from_symbols.name as from_symbol_name',
      'from_symbols.symbol_type as from_symbol_type',
      'from_files.path as from_file_path',
      'to_symbols.name as to_symbol_name',
      'to_symbols.symbol_type as to_symbol_type',
      'to_files.path as to_file_path'
    )
    .where('dependencies.from_symbol_id', symbolId)
    .orderBy('dependencies.id', 'asc');

  const countQuery = db('dependencies')
    .count('* as count')
    .where('dependencies.from_symbol_id', symbolId);

  const result = await createPaginatedQuery<any>(
    baseQuery,
    paginationParams,
    countQuery,
    'dependencies.id'
  );

  result.data = result.data.map(row => ({
    ...row,
    from_symbol: {
      id: row.from_symbol_id,
      name: row.from_symbol_name,
      symbol_type: row.from_symbol_type,
      file: {
        id: row.from_file_id,
        path: row.from_file_path,
      },
    },
    to_symbol: {
      id: row.to_symbol_id,
      name: row.to_symbol_name,
      symbol_type: row.to_symbol_type,
      file: {
        id: row.to_file_id,
        path: row.to_file_path,
      },
    },
    calling_object: row.calling_object,
    resolved_class: row.resolved_class,
    qualified_context: row.qualified_context,
    method_signature: row.method_signature,
    file_context: row.file_context,
    namespace_context: row.namespace_context,
    parameter_context: row.parameter_context,
    call_instance_id: row.call_instance_id,
    parameter_types: row.parameter_types
      ? safeParseParameterTypes(row.parameter_types)
      : undefined,
  })) as EnhancedDependencyWithSymbols[];

  return result;
}

export async function getSymbolCached(db: Knex, symbolId: number): Promise<SymbolWithFile | null> {
  return withCache(
    'getSymbol',
    { symbolId },
    async () => {
      const result = await db('symbols')
        .leftJoin('files', 'symbols.file_id', 'files.id')
        .select('symbols.*', 'files.path as file_path', 'files.language as file_language')
        .where('symbols.id', symbolId)
        .first();

      if (!result) return null;

      return {
        ...result,
        file: {
          id: result.file_id,
          path: result.file_path,
          language: result.file_language,
        },
      } as SymbolWithFile;
    },
    300000
  );
}

export async function getDependenciesToCached(
  db: Knex,
  symbolId: number,
  dependencyTypes?: string[]
): Promise<EnhancedDependencyWithSymbols[]> {
  return withCache(
    'getDependenciesTo',
    { symbolId, dependencyTypes },
    async () => {
      let query = db('dependencies')
        .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
        .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
        .select(
          'dependencies.*',
          'from_symbols.name as from_symbol_name',
          'from_symbols.symbol_type as from_symbol_type',
          'from_files.path as from_file_path'
        )
        .where('dependencies.to_symbol_id', symbolId);

      if (dependencyTypes && dependencyTypes.length > 0) {
        query = query.whereIn('dependencies.dependency_type', dependencyTypes);
      }

      const results = await query;

      return results.map(result => ({
        ...result,
        from_symbol: {
          id: result.from_symbol_id,
          name: result.from_symbol_name,
          symbol_type: result.from_symbol_type,
          file: {
            id: result.from_file_id,
            path: result.from_file_path,
          },
        },
        calling_object: result.calling_object,
        resolved_class: result.resolved_class,
        qualified_context: result.qualified_context,
        method_signature: result.method_signature,
        file_context: result.file_context,
        namespace_context: result.namespace_context,
        parameter_context: result.parameter_context,
        call_instance_id: result.call_instance_id,
        parameter_types: result.parameter_types
          ? safeParseParameterTypes(result.parameter_types)
          : undefined,
      })) as EnhancedDependencyWithSymbols[];
    },
    180000
  );
}

export async function getFrameworkEntitiesByType(
  db: Knex,
  repoId: number,
  entityType: string
): Promise<(Route | Component | Composable | ORMEntity)[]> {
  const results: (Route | Component | Composable | ORMEntity)[] = [];

  if (entityType === 'route' || entityType === 'all') {
    const routes = await RouteService.getRoutesByRepository(db, repoId);
    results.push(...routes);
  }

  if (entityType === 'component' || entityType === 'all') {
    const components = await ComponentService.getComponentsByRepository(db, repoId);
    results.push(...components);
  }

  if (entityType === 'composable' || entityType === 'all') {
    const composables = await ComposableService.getComposablesByRepository(db, repoId);
    results.push(...composables);
  }

  if (entityType === 'orm_entity' || entityType === 'all') {
    const ormEntities = await OrmService.getORMEntitiesByRepository(db, repoId);
    results.push(...ormEntities);
  }

  return results;
}
