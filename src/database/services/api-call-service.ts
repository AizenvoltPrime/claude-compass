import type { Knex } from 'knex';
import type {
  ApiCall,
  DataContract,
  CreateApiCall,
  CreateDataContract,
  Route,
  Component,
  Composable,
  EnhancedDependencyWithSymbols,
} from '../models';
import { createComponentLogger } from '../../utils/logger';
import { getEmbeddingService } from '../../services/embedding-service';
import { validateEmbedding } from './validation-utils';

const logger = createComponentLogger('api-call-service');

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

/**
 * Deduplicate data contracts by keeping the first entry
 * for each unique combination matching the database unique constraint:
 * (frontend_type_id, backend_type_id, name)
 */
function deduplicateDataContracts(
  contracts: CreateDataContract[]
): CreateDataContract[] {
  const uniqueMap = new Map<string, CreateDataContract>();

  for (const contract of contracts) {
    const key = `${contract.frontend_type_id}-${contract.backend_type_id}-${contract.name}`;
    const existing = uniqueMap.get(key);

    // Keep the first entry
    if (!existing) {
      uniqueMap.set(key, contract);
    }
  }

  return Array.from(uniqueMap.values());
}

export async function getCrossStackDependencies(
  db: Knex,
  repoId: number
): Promise<{ apiCalls: ApiCall[]; dataContracts: DataContract[] }> {
  const apiCalls = await db('api_calls')
    .where({ repo_id: repoId })
    .orderBy('created_at', 'desc');

  const dataContracts = await db('data_contracts')
    .where({ repo_id: repoId })
    .orderBy('created_at', 'desc');

  return {
    apiCalls: apiCalls as ApiCall[],
    dataContracts: dataContracts as DataContract[],
  };
}

export async function getApiCallsByEndpoint(
  db: Knex,
  repoId: number,
  endpointPath: string,
  httpMethod: string
): Promise<ApiCall[]> {
  const apiCalls = await db('api_calls')
    .where({
      repo_id: repoId,
      endpoint_path: endpointPath,
      http_method: httpMethod,
    })
    .orderBy('created_at', 'desc');

  return apiCalls as ApiCall[];
}

export async function getFrameworkEntityById(
  db: Knex,
  id: number
): Promise<Route | Component | Composable | null> {
  const route = await db('routes').where({ id }).first();
  if (route) return route as Route;

  const component = await db('components').where({ id }).first();
  if (component) return component as Component;

  const composable = await db('composables').where({ id }).first();
  if (composable) return composable as Composable;

  return null;
}

export async function createApiCalls(db: Knex, data: CreateApiCall[]): Promise<ApiCall[]> {
  if (data.length === 0) return [];

  const itemsNeedingEmbeddings = data.filter(item => !item.endpoint_embedding && item.endpoint_path);

  try {
    if (itemsNeedingEmbeddings.length > 0) {
      const embeddingService = getEmbeddingService();
      await embeddingService.initialize();

      const endpointTexts = itemsNeedingEmbeddings.map(
        item => item.http_method ? `${item.http_method} ${item.endpoint_path}` : item.endpoint_path
      );

      const embeddings = await embeddingService.generateBatchEmbeddings(endpointTexts);

      itemsNeedingEmbeddings.forEach((item, idx) => {
        const embedding = embeddings[idx];

        if (!validateEmbedding(embedding)) {
          logger.error('Invalid embedding dimensions for API call', {
            endpoint: item.endpoint_path,
            method: item.http_method,
            expected: 1024,
            actual: embedding?.length,
            hasNaN: embedding?.some(v => isNaN(v)),
          });
        } else {
          item.endpoint_embedding = embedding;
          trackEmbeddingSuccess();
        }
      });

      logger.info('Generated embeddings for API calls', {
        count: itemsNeedingEmbeddings.length,
      });
    }
  } catch (error) {
    itemsNeedingEmbeddings.forEach(() => trackEmbeddingFailure('api_call_creation'));

    logger.warn('Failed to generate API call embeddings', {
      error: (error as Error).message,
      count: itemsNeedingEmbeddings.length,
      failureRate: `${((embeddingFailureCounter / embeddingTotalAttempts) * 100).toFixed(1)}%`,
    });
  }

  const BATCH_SIZE = 100;
  const results: ApiCall[] = [];
  let totalSkipped = 0;

  try {
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const batch = data.slice(i, i + BATCH_SIZE);

      const insertBatch = batch.map(item => ({
        ...item,
        endpoint_embedding: item.endpoint_embedding ? JSON.stringify(item.endpoint_embedding) : null,
      }));

      const batchResults = await db('api_calls')
        .insert(insertBatch)
        .onConflict([
          'caller_symbol_id',
          'endpoint_symbol_id',
          'line_number',
          'http_method',
          'endpoint_path',
        ])
        .ignore()
        .returning('*');

      const skipped = batch.length - batchResults.length;
      totalSkipped += skipped;

      if (skipped > 0) {
        const keyCounts = new Map<string, { count: number; item: CreateApiCall }>();

        for (const item of batch) {
          const key = `${item.caller_symbol_id}|${item.endpoint_symbol_id}|${item.line_number}|${item.http_method}|${item.endpoint_path}`;
          const existing = keyCounts.get(key);
          if (existing) {
            existing.count++;
          } else {
            keyCounts.set(key, { count: 1, item });
          }
        }

        const duplicateKeys = Array.from(keyCounts.entries())
          .filter(([_, value]) => value.count > 1)
          .map(([key, value]) => ({
            key,
            count: value.count,
            sample: {
              caller_symbol_id: value.item.caller_symbol_id,
              endpoint_symbol_id: value.item.endpoint_symbol_id,
              line_number: value.item.line_number,
              http_method: value.item.http_method,
              endpoint_path: value.item.endpoint_path,
            },
          }));

        // Log at debug level if all are duplicates (expected in incremental analysis)
        const isAllDuplicates = skipped === batch.length;
        const logLevel = isAllDuplicates ? 'debug' : 'warn';

        logger[logLevel]('Duplicate API calls skipped by UNIQUE constraint', {
          batchNumber: Math.floor(i / BATCH_SIZE) + 1,
          batchSize: batch.length,
          inserted: batchResults.length,
          skipped,
          skipRate: `${((skipped / batch.length) * 100).toFixed(1)}%`,
          duplicatesFoundInBatch: duplicateKeys.length,
          duplicateDetails: isAllDuplicates ? [] : duplicateKeys, // Don't log details if all duplicates
        });
      }

      results.push(...(batchResults as ApiCall[]));
    }

    if (totalSkipped > 0) {
      const overallSkipRate = ((totalSkipped / data.length) * 100).toFixed(1);
      const skipRatio = totalSkipped / data.length;

      // Log at appropriate level based on skip rate
      if (skipRatio === 1.0) {
        // 100% duplicates is expected during incremental analysis with no changes
        logger.debug('All API calls already exist in database (incremental analysis)', {
          totalAttempted: data.length,
          totalInserted: results.length,
          totalSkipped,
          overallSkipRate: `${overallSkipRate}%`,
        });
      } else {
        logger.info('API call insertion complete with duplicates skipped', {
          totalAttempted: data.length,
          totalInserted: results.length,
          totalSkipped,
          overallSkipRate: `${overallSkipRate}%`,
        });

        // Only warn if skip rate is high but not 100% (partial duplicates suggest issues)
        if (skipRatio > 0.1 && skipRatio < 1.0) {
          logger.warn(
            'High duplicate rate detected - investigate if analysis is running multiple times',
            {
              skipRate: `${overallSkipRate}%`,
              threshold: '10%',
            }
          );
        }
      }
    }

    return results;
  } catch (error: any) {
    logger.error('Failed to create API calls', {
      error: error.message,
      stack: error.stack,
      count: data.length,
      sampleData: data.slice(0, 2),
    });
    throw error;
  }
}

export async function createDataContracts(
  db: Knex,
  data: CreateDataContract[]
): Promise<DataContract[]> {
  if (data.length === 0) return [];

  // Deduplicate before processing to prevent constraint violations
  const uniqueContracts = deduplicateDataContracts(data);

  if (uniqueContracts.length !== data.length) {
    logger.debug('Removed duplicate data contracts from batch', {
      original: data.length,
      unique: uniqueContracts.length,
      duplicatesRemoved: data.length - uniqueContracts.length,
    });
  }

  const BATCH_SIZE = 100;
  const results: DataContract[] = [];

  try {
    for (let i = 0; i < uniqueContracts.length; i += BATCH_SIZE) {
      const batch = uniqueContracts.slice(i, i + BATCH_SIZE);

      const batchResults = await db('data_contracts')
        .insert(batch)
        .onConflict(['frontend_type_id', 'backend_type_id', 'name'])
        .merge(['schema_definition', 'drift_detected', 'updated_at'])
        .returning('*');

      results.push(...(batchResults as DataContract[]));
    }

    if (results.length < uniqueContracts.length) {
      // Some contracts were updated rather than inserted (expected during incremental analysis)
      logger.debug('Data contract upsert complete', {
        totalAttempted: uniqueContracts.length,
        totalReturned: results.length,
        updated: uniqueContracts.length - results.length,
      });
    }

    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    // Check if this is a duplicate key error (expected during incremental analysis)
    const isDuplicateError = errorMessage.includes('duplicate key') ||
                             errorMessage.includes('unique constraint');

    if (isDuplicateError) {
      // For duplicates, query and return the existing records
      logger.debug('Data contracts already exist, retrieving existing records', {
        count: uniqueContracts.length,
      });

      try {
        const existingContracts: DataContract[] = [];
        for (const contract of uniqueContracts) {
          const whereClause: any = {
            frontend_type_id: contract.frontend_type_id,
            backend_type_id: contract.backend_type_id,
            name: contract.name,
          };

          const existing = await db('data_contracts')
            .where(whereClause)
            .first();

          if (existing) {
            existingContracts.push(existing);
          }
        }
        return existingContracts;
      } catch (queryError) {
        const queryErrorMsg = queryError instanceof Error ? queryError.message : String(queryError);
        logger.warn('Failed to query existing data contracts after duplicate error', {
          error: queryErrorMsg,
          originalError: errorMessage,
        });
        // Return empty array rather than failing completely
        return [];
      }
    }

    // For non-duplicate errors, throw to fail fast
    logger.error('Failed to create data contracts', {
      error: errorMessage,
      stack,
      count: uniqueContracts.length,
      sampleData: uniqueContracts.slice(0, 2),
    });
    throw error;
  }
}

export async function getApiCallsByComponent(db: Knex, componentId: number): Promise<ApiCall[]> {
  const apiCalls = await db('api_calls')
    .where({ caller_symbol_id: componentId })
    .orderBy('created_at', 'desc');

  return apiCalls as ApiCall[];
}

export async function getDataContractsBySchema(
  db: Knex,
  schemaName: string
): Promise<DataContract[]> {
  const dataContracts = await db('data_contracts')
    .where({ name: schemaName })
    .orderBy('created_at', 'desc');

  return dataContracts as DataContract[];
}

export async function getRepositoryFrameworks(db: Knex, repoId: number): Promise<string[]> {
  const metadata = await db('framework_metadata')
    .where({ repo_id: repoId })
    .select('framework_type')
    .distinct();

  return metadata.map(m => m.framework_type);
}

export async function streamCrossStackData(
  db: Knex,
  repoId: number
): Promise<AsyncIterable<{ type: 'apiCall' | 'dataContract'; data: any }>> {
  const stream = async function* (database: Knex) {
    const apiCalls = await database('api_calls')
      .where({ repo_id: repoId })
      .orderBy('created_at', 'desc');

    for (const apiCall of apiCalls) {
      yield { type: 'apiCall' as const, data: apiCall };
    }

    const dataContracts = await database('data_contracts')
      .where({ repo_id: repoId })
      .orderBy('created_at', 'desc');

    for (const dataContract of dataContracts) {
      yield { type: 'dataContract' as const, data: dataContract };
    }
  };

  return stream(db);
}

export async function performCrossStackHealthCheck(
  db: Knex,
  repoId: number
): Promise<{
  status: 'pass' | 'fail';
  healthy: boolean;
  issues: string[];
  recommendations: string[];
  checks: Array<{
    name: string;
    status: 'pass' | 'fail';
    message: string;
  }>;
}> {
  const issues: string[] = [];
  const recommendations: string[] = [];
  const checks: Array<{ name: string; status: 'pass' | 'fail'; message: string }> = [];

  try {
    const crossStackData = await getCrossStackDependencies(db, repoId);

    const orphanedApiCalls = crossStackData.apiCalls.filter(
      call => !call.caller_symbol_id || !call.endpoint_symbol_id
    );

    if (orphanedApiCalls.length > 0) {
      issues.push(`Found ${orphanedApiCalls.length} orphaned API calls with missing references`);
      recommendations.push(
        'Review and clean up API calls with missing frontend or backend references'
      );
      checks.push({
        name: 'API Call References',
        status: 'fail',
        message: `${orphanedApiCalls.length} orphaned API calls found`,
      });
    } else {
      checks.push({
        name: 'API Call References',
        status: 'pass',
        message: 'All API calls have valid references',
      });
    }

    const driftedContracts = crossStackData.dataContracts.filter(
      contract => contract.drift_detected
    );

    if (driftedContracts.length > 0) {
      issues.push(`Found ${driftedContracts.length} data contracts with detected schema drift`);
      recommendations.push('Review and update data contracts to resolve schema drift');
      checks.push({
        name: 'Schema Drift Detection',
        status: 'fail',
        message: `${driftedContracts.length} contracts with schema drift`,
      });
    } else {
      checks.push({
        name: 'Schema Drift Detection',
        status: 'pass',
        message: 'No schema drift detected in data contracts',
      });
    }

    const healthy = issues.length === 0;

    return {
      status: healthy ? 'pass' : 'fail',
      healthy,
      issues,
      recommendations,
      checks,
    };
  } catch (error: any) {
    logger.error('Cross-stack health check failed', { repoId, error });
    return {
      status: 'fail',
      healthy: false,
      issues: ['Health check failed due to database error'],
      recommendations: ['Check database connectivity and table structure'],
      checks: [
        {
          name: 'Database Connectivity',
          status: 'fail',
          message: 'Failed to connect to database or execute queries',
        },
      ],
    };
  }
}

export async function getCrossStackHealth(
  db: Knex,
  repoId: number
): Promise<{
  status: 'healthy' | 'warning' | 'error';
  lastChecked: Date;
  summary: {
    totalApiCalls: number;
    totalDataContracts: number;
    driftDetected: number;
  };
}> {
  try {
    const crossStackData = await getCrossStackDependencies(db, repoId);

    const totalApiCalls = crossStackData.apiCalls.length;
    const totalDataContracts = crossStackData.dataContracts.length;

    const driftDetected = crossStackData.dataContracts.filter(
      contract => contract.drift_detected
    ).length;

    let status: 'healthy' | 'warning' | 'error' = 'healthy';

    if (driftDetected > 0) {
      status = 'error';
    }

    return {
      status,
      lastChecked: new Date(),
      summary: {
        totalApiCalls,
        totalDataContracts,
        driftDetected,
      },
    };
  } catch (error: any) {
    logger.error('Failed to get cross-stack health status', { repoId, error });
    return {
      status: 'error',
      lastChecked: new Date(),
      summary: {
        totalApiCalls: 0,
        totalDataContracts: 0,
        driftDetected: 0,
      },
    };
  }
}

export async function getCrossStackApiCallers(
  db: Knex,
  symbolId: number
): Promise<EnhancedDependencyWithSymbols[]> {
  const results = await db('api_calls')
    .join('symbols as endpoint_symbol', 'api_calls.endpoint_symbol_id', 'endpoint_symbol.id')
    .join('symbols as caller_symbol', 'api_calls.caller_symbol_id', 'caller_symbol.id')
    .leftJoin('files as caller_files', 'caller_symbol.file_id', 'caller_files.id')
    .where('api_calls.endpoint_symbol_id', symbolId)
    .select(
      'api_calls.id as dependency_id',
      'api_calls.caller_symbol_id as from_symbol_id',
      'api_calls.endpoint_symbol_id as to_symbol_id',
      'api_calls.http_method',
      'api_calls.endpoint_path',
      'api_calls.line_number',
      'caller_symbol.name as from_symbol_name',
      'caller_symbol.symbol_type as from_symbol_type',
      'caller_files.path as from_file_path',
      'caller_files.id as from_file_id'
    )
    .distinct();

  return results.map(result => ({
    id: result.dependency_id,
    from_symbol_id: result.from_symbol_id,
    to_symbol_id: result.to_symbol_id,
    dependency_type: 'api_call' as any,
    line_number: result.line_number,
    created_at: new Date(),
    updated_at: new Date(),
    from_symbol: {
      id: result.from_symbol_id,
      name: result.from_symbol_name,
      symbol_type: result.from_symbol_type,
      file: {
        id: result.from_file_id,
        path: result.from_file_path,
      },
    },
    http_method: result.http_method,
    endpoint_path: result.endpoint_path,
    is_cross_stack: true,
  })) as any;
}

export async function getCrossStackApiDependencies(
  db: Knex,
  symbolId: number
): Promise<EnhancedDependencyWithSymbols[]> {
  const results = await db('api_calls')
    .join('symbols as caller_symbol', 'api_calls.caller_symbol_id', 'caller_symbol.id')
    .join('symbols as endpoint_symbol', 'api_calls.endpoint_symbol_id', 'endpoint_symbol.id')
    .leftJoin('files as caller_files', 'caller_symbol.file_id', 'caller_files.id')
    .leftJoin('files as endpoint_files', 'endpoint_symbol.file_id', 'endpoint_files.id')
    .where('api_calls.caller_symbol_id', symbolId)
    .select(
      'api_calls.id as dependency_id',
      'api_calls.caller_symbol_id as from_symbol_id',
      'api_calls.endpoint_symbol_id as to_symbol_id',
      'api_calls.http_method',
      'api_calls.endpoint_path',
      'api_calls.line_number',
      'caller_symbol.name as from_symbol_name',
      'caller_symbol.symbol_type as from_symbol_type',
      'caller_files.path as from_file_path',
      'caller_files.id as from_file_id',
      'endpoint_symbol.name as to_symbol_name',
      'endpoint_symbol.symbol_type as to_symbol_type',
      'endpoint_files.path as to_file_path',
      'endpoint_files.id as to_file_id'
    )
    .distinct();

  return results.map(result => ({
    id: result.dependency_id,
    from_symbol_id: result.from_symbol_id,
    to_symbol_id: result.to_symbol_id,
    dependency_type: 'api_call' as any,
    line_number: result.line_number,
    created_at: new Date(),
    updated_at: new Date(),
    from_symbol: {
      id: result.from_symbol_id,
      name: result.from_symbol_name,
      symbol_type: result.from_symbol_type,
      file: {
        id: result.from_file_id,
        path: result.from_file_path,
      },
    },
    to_symbol: {
      id: result.to_symbol_id,
      name: result.to_symbol_name,
      symbol_type: result.to_symbol_type,
      file: {
        id: result.to_file_id,
        path: result.to_file_path,
      },
    },
    http_method: result.http_method,
    endpoint_path: result.endpoint_path,
    is_cross_stack: true,
  })) as any;
}
