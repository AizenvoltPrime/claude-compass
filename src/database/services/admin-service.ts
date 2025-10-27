import type { Knex } from 'knex';
import { getDatabaseConnection, closeDatabaseConnection } from '../connection';

export async function runMigrations(): Promise<void> {
  const db = getDatabaseConnection();
  await db.migrate.latest();
}

export async function rollbackMigrations(): Promise<void> {
  const db = getDatabaseConnection();
  await db.migrate.rollback();
}

export async function close(): Promise<void> {
  await closeDatabaseConnection();
}
