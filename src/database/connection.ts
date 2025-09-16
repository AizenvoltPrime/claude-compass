import knex from 'knex';
import type { Knex } from 'knex';
import { config } from '../utils/config';
import { createComponentLogger } from '../utils/logger';
import process from 'process';

const logger = createComponentLogger('database');

let db: Knex | null = null;

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
      directory: './src/database/migrations',
      tableName: 'knex_migrations',
    },
    debug: false, // Disable SQL query logging to reduce noise
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