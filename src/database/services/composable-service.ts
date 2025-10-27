import type { Knex } from 'knex';
import type { Composable, CreateComposable } from '../models';

export async function createComposable(db: Knex, data: CreateComposable): Promise<Composable> {
  const [composable] = await db('composables').insert(data).returning('*');

  return composable as Composable;
}

export async function getComposable(db: Knex, id: number): Promise<Composable | null> {
  const composable = await db('composables').where({ id }).first();
  return (composable as Composable) || null;
}

export async function getComposablesByType(
  db: Knex,
  repoId: number,
  type: string
): Promise<Composable[]> {
  const composables = await db('composables')
    .where({ repo_id: repoId, composable_type: type })
    .orderBy('id');
  return composables as Composable[];
}

export async function getComposablesByRepository(
  db: Knex,
  repoId: number
): Promise<Composable[]> {
  const composables = await db('composables')
    .where({ repo_id: repoId })
    .orderBy(['composable_type', 'id']);
  return composables as Composable[];
}
