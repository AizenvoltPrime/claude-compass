import knex from 'knex';
import type { Knex } from 'knex';
import { config } from '../utils/config';
import { createComponentLogger } from '../utils/logger';
import process from 'process';

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
        logger.debug(`Failed to parse JSONB field ${field}:`, processedRow[field]);
      }
    }
  }

  return processedRow;
}

export function createDatabaseConnection(): Knex {
  if (db) {
    return db;
  }

  const connectionConfig: Knex.Config = {
    client: 'postgresql',
    connection: config.database.url || {
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
    },
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 600000,
    },
    migrations: {
      directory: './dist/src/database/migrations',
      tableName: 'knex_migrations',
      extension: 'js',
      loadExtensions: ['.js']
    },
    debug: false, // Disable SQL query logging to reduce noise
    postProcessResponse: (result: any) => {
      // Handle JSONB fields - PostgreSQL returns them as strings, but we want objects
      if (Array.isArray(result)) {
        return result.map((row: any) => processJsonbFields(row));
      } else if (result && typeof result === 'object') {
        return processJsonbFields(result);
      }
      return result;
    },
    wrapIdentifier: (value: string, origImpl: (value: string) => string) => {
      // Keep identifiers as-is for PostgreSQL
      return origImpl(value);
    }
  };

  db = knex(connectionConfig);

  // Test the connection
  db.raw('SELECT 1')
    .then(() => {
      logger.info('Database connection established successfully');
    })
    .catch((err) => {
      logger.error('Failed to establish database connection:', err);
      process.exit(1);
    });

  return db;
}

export function getDatabaseConnection(): Knex {
  if (!db) {
    return createDatabaseConnection();
  }
  return db;
}

export async function closeDatabaseConnection(): Promise<void> {
  if (db) {
    logger.info('Closing database connection');
    await db.destroy();
    db = null;
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await closeDatabaseConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDatabaseConnection();
  process.exit(0);
});