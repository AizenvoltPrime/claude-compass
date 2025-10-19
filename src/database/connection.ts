import knex from 'knex';
import type { Knex } from 'knex';
import { createComponentLogger } from '../utils/logger';
import { findProjectRoot } from '../utils/project-root';
import process from 'process';
import path from 'path';

const logger = createComponentLogger('database');

let db: Knex | null = null;

// Helper function to process JSONB fields
function processJsonbFields(row: any): any {
  if (!row || typeof row !== 'object') {
    return row;
  }

  // Define JSONB field names that need processing
  const jsonbFields = [
    'middleware', 'dynamic_segments', 'props', 'emits', 'slots', 'hooks',
    'template_dependencies', 'returns', 'dependencies', 'reactive_refs',
    'dependency_array', 'metadata', 'config_data', 'fields'
  ];

  const processedRow = { ...row };

  for (const field of jsonbFields) {
    if (processedRow[field] && typeof processedRow[field] === 'string') {
      try {
        processedRow[field] = JSON.parse(processedRow[field]);
      } catch (e) {
        // If parsing fails, keep the original value
      }
    }
  }

  return processedRow;
}

export function createDatabaseConnection(): Knex {
  if (db) {
    return db;
  }

  const projectRoot = findProjectRoot();
  const knexfilePath = path.join(projectRoot, 'knexfile.js');
  const knexfile = require(knexfilePath);
  const environment = process.env.NODE_ENV || 'development';
  const baseConfig = knexfile[environment];

  if (!baseConfig) {
    throw new Error(`No knexfile configuration found for environment: ${environment}`);
  }

  const connectionConfig: Knex.Config = {
    ...baseConfig,
    pool: {
      min: process.env.NODE_ENV === 'test' ? 1 : 2,
      max: process.env.NODE_ENV === 'test' ? 5 : 10,
      acquireTimeoutMillis: 60000,
      idleTimeoutMillis: process.env.NODE_ENV === 'test' ? 60000 : 600000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
      propagateCreateError: false
    },
    debug: false,
    postProcessResponse: (result: any) => {
      if (Array.isArray(result)) {
        return result.map((row: any) => processJsonbFields(row));
      } else if (result && typeof result === 'object') {
        return processJsonbFields(result);
      }
      return result;
    },
    wrapIdentifier: (value: string, origImpl: (value: string) => string) => {
      return origImpl(value);
    }
  };

  db = knex(connectionConfig);

  return db;
}

export function getDatabaseConnection(): Knex {
  if (!db) {
    return createDatabaseConnection();
  }
  return db;
}

export async function testDatabaseConnection(): Promise<void> {
  const connection = getDatabaseConnection();
  try {
    await connection.raw('SELECT 1');
    logger.info('Database connection established successfully');
  } catch (err) {
    logger.error('Failed to establish database connection:', err);
    throw err;
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  if (db) {
    logger.info('Closing database connection');
    await db.destroy();
    db = null;
  }
}

// Note: Graceful shutdown handling is now managed by individual applications
// rather than globally in the connection module to avoid interfering with
// CLI tools and other applications that need to manage their own lifecycle