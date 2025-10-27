import type { Knex } from 'knex';
import type {
  Route,
  CreateRoute,
  RouteWithSymbol,
  Symbol,
  SymbolWithFile,
  Repository,
} from '../models';
import { createComponentLogger } from '../../utils/logger';
import { getEmbeddingService } from '../../services/embedding-service';
import * as ValidationUtils from './validation-utils';

const logger = createComponentLogger('route-service');

let embeddingFailureCounter = 0;
let embeddingTotalAttempts = 0;
let lastFailureRateWarning = 0;

function trackEmbeddingFailure(context: string): void {
  embeddingTotalAttempts++;
  embeddingFailureCounter++;

  const failureRate = embeddingFailureCounter / embeddingTotalAttempts;
  const now = Date.now();

  if (
    failureRate > 0.1 &&
    embeddingTotalAttempts >= 10 &&
    now - lastFailureRateWarning > 60000
  ) {
    logger.error('High embedding failure rate detected - check service availability', {
      failureRate: `${(failureRate * 100).toFixed(1)}%`,
      totalFailures: embeddingFailureCounter,
      totalAttempts: embeddingTotalAttempts,
      context,
    });
    lastFailureRateWarning = now;
  }
}

function trackEmbeddingSuccess(): void {
  embeddingTotalAttempts++;
}

export async function createRoute(db: Knex, data: CreateRoute): Promise<Route> {
  let pathEmbedding: number[] | undefined;
  if (!data.path_embedding && data.path) {
    try {
      const embeddingService = getEmbeddingService();
      await embeddingService.initialize();
      const pathText = data.method ? `${data.method} ${data.path}` : data.path;
      pathEmbedding = await embeddingService.generateEmbedding(pathText);

      if (!ValidationUtils.validateEmbedding(pathEmbedding)) {
        logger.error('Invalid embedding dimensions for route', {
          path: data.path,
          expected: 1024,
          actual: pathEmbedding?.length,
          hasNaN: pathEmbedding?.some(v => isNaN(v)),
        });
        pathEmbedding = undefined;
      } else {
        trackEmbeddingSuccess();
      }
    } catch (error) {
      trackEmbeddingFailure('route_creation');
      logger.warn('Failed to generate route path embedding', {
        path: data.path,
        error: (error as Error).message,
        failureRate: `${((embeddingFailureCounter / embeddingTotalAttempts) * 100).toFixed(1)}%`,
      });
    }
  }

  const insertData = {
    ...data,
    middleware: data.middleware ? JSON.stringify(data.middleware) : '[]',
    dynamic_segments: data.dynamic_segments ? JSON.stringify(data.dynamic_segments) : '[]',
    path_embedding: pathEmbedding
      ? JSON.stringify(pathEmbedding)
      : data.path_embedding
        ? JSON.stringify(data.path_embedding)
        : null,
  };

  const [route] = await db('routes').insert(insertData).returning('*');

  return route as Route;
}

export async function getRoute(db: Knex, id: number): Promise<Route | null> {
  const route = await db('routes').where({ id }).first();
  return (route as Route) || null;
}

export async function getRouteWithSymbol(
  db: Knex,
  id: number
): Promise<RouteWithSymbol | null> {
  const result = await db('routes')
    .leftJoin('symbols', 'routes.handler_symbol_id', 'symbols.id')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .leftJoin('repositories', 'routes.repo_id', 'repositories.id')
    .select(
      'routes.*',
      'symbols.id as symbol_id',
      'symbols.name as symbol_name',
      'symbols.signature as symbol_signature',
      'symbols.start_line as symbol_start_line',
      'files.path as file_path',
      'files.language as file_language',
      'repositories.name as repo_name',
      'repositories.path as repo_path'
    )
    .where('routes.id', id)
    .first();

  if (!result) return null;

  const route = {
    id: result.id,
    repo_id: result.repo_id,
    path: result.path,
    method: result.method,
    handler_symbol_id: result.handler_symbol_id,
    framework_type: result.framework_type,
    middleware: result.middleware,
    dynamic_segments: result.dynamic_segments,
    auth_required: result.auth_required,
    created_at: result.created_at,
    updated_at: result.updated_at,
  } as RouteWithSymbol;

  if (result.symbol_id) {
    route.handler_symbol = {
      id: result.symbol_id,
      file_id: result.file_id,
      name: result.symbol_name,
      signature: result.symbol_signature,
      start_line: result.symbol_start_line,
      file: {
        id: result.file_id,
        path: result.file_path,
        language: result.file_language,
      },
    } as SymbolWithFile;
  }

  if (result.repo_name) {
    route.repository = {
      id: result.repo_id,
      name: result.repo_name,
      path: result.repo_path,
    } as Repository;
  }

  return route;
}

export async function getRoutesByFramework(
  db: Knex,
  repoId: number,
  framework: string
): Promise<Route[]> {
  const routes = await db('routes')
    .where({ repo_id: repoId, framework_type: framework })
    .orderBy('path');
  return routes as Route[];
}

export async function getRoutesByRepository(db: Knex, repoId: number): Promise<Route[]> {
  const routes = await db('routes')
    .where({ repo_id: repoId })
    .orderBy(['framework_type', 'path']);
  return routes as Route[];
}

export async function getAllRoutes(db: Knex, repoId?: number): Promise<Route[]> {
  let query = db('routes').orderBy(['repo_id', 'framework_type', 'path']);

  if (repoId) {
    query = query.where({ repo_id: repoId });
  }

  const routes = await query;
  return routes as Route[];
}

export async function findRouteByPath(
  db: Knex,
  repoId: number,
  path: string,
  method: string
): Promise<Route | null> {
  const route = await db('routes').where({ repo_id: repoId, path, method }).first();
  return (route as Route) || null;
}

export async function findMethodByQualifiedName(
  db: Knex,
  repoId: number,
  qualifiedName: string
): Promise<Symbol | null> {
  const result = await db('symbols')
    .join('files', 'symbols.file_id', 'files.id')
    .where('files.repo_id', repoId)
    .where('symbols.qualified_name', qualifiedName)
    .where('symbols.symbol_type', 'method')
    .first();

  return result || null;
}

export async function findMethodInController(
  db: Knex,
  repoId: number,
  controllerClass: string,
  methodName: string
): Promise<Symbol | null> {
  const qualifiedPatterns = [
    `${controllerClass}::${methodName}`,
    `App\\Http\\Controllers\\${controllerClass}::${methodName}`,
  ];

  for (const pattern of qualifiedPatterns) {
    const result = await db('symbols')
      .select('symbols.*')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .where('files.language', 'php')
      .where('symbols.qualified_name', pattern)
      .where('symbols.symbol_type', 'method')
      .first();

    if (result) {
      logger.info('Found method via qualified pattern', {
        controllerClass,
        methodName,
        pattern,
        symbolId: result.id,
      });
      return result as Symbol;
    }
  }

  const controllerSymbol = await db('symbols')
    .select('symbols.*')
    .join('files', 'symbols.file_id', 'files.id')
    .where('files.repo_id', repoId)
    .where('files.language', 'php')
    .where('symbols.symbol_type', 'class')
    .where(function () {
      this.where('symbols.name', controllerClass).orWhere(
        'symbols.qualified_name',
        'like',
        `%${controllerClass}`
      );
    })
    .first();

  if (!controllerSymbol) {
    logger.warn('Controller class not found', {
      controllerClass,
      methodName,
      repoId,
    });
    return null;
  }

  const methodSymbol = await db('symbols')
    .where('parent_symbol_id', controllerSymbol.id)
    .where('name', methodName)
    .where('symbol_type', 'method')
    .first();

  if (methodSymbol) {
    logger.info('Found method via fallback query', {
      controllerClass,
      methodName,
      controllerSymbolId: controllerSymbol.id,
      methodSymbolId: methodSymbol.id,
    });
  } else {
    logger.warn('Method not found in controller', {
      controllerClass,
      methodName,
      controllerSymbolId: controllerSymbol.id,
    });
  }

  return (methodSymbol as Symbol) || null;
}

export async function updateRouteHandlerSymbolId(
  db: Knex,
  routeId: number,
  handlerSymbolId: number
): Promise<void> {
  await db('routes').where({ id: routeId }).update({ handler_symbol_id: handlerSymbolId });
}

export async function updateSymbolParent(
  db: Knex,
  symbolId: number,
  parentSymbolId: number
): Promise<void> {
  await db('symbols').where({ id: symbolId }).update({ parent_symbol_id: parentSymbolId });
}
