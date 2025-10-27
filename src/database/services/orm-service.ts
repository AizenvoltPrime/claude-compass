import type { Knex } from 'knex';
import type {
  ORMEntity,
  ORMRepository,
  CreateORMEntity,
  CreateORMRepository,
  ORMType,
} from '../models';

export async function createORMEntity(db: Knex, data: CreateORMEntity): Promise<ORMEntity> {
  const [ormEntity] = await db('orm_entities').insert(data).returning('*');
  return ormEntity as ORMEntity;
}

export async function getORMEntity(db: Knex, id: number): Promise<ORMEntity | null> {
  const ormEntity = await db('orm_entities').where({ id }).first();
  return (ormEntity as ORMEntity) || null;
}

export async function getORMEntitiesByRepository(
  db: Knex,
  repoId: number
): Promise<ORMEntity[]> {
  const ormEntities = await db('orm_entities')
    .where({ repo_id: repoId })
    .orderBy('entity_name');
  return ormEntities as ORMEntity[];
}

export async function getORMEntitiesByType(
  db: Knex,
  repoId: number,
  ormType: ORMType
): Promise<ORMEntity[]> {
  const ormEntities = await db('orm_entities')
    .where({ repo_id: repoId, orm_type: ormType })
    .orderBy('entity_name');
  return ormEntities as ORMEntity[];
}

export async function findORMEntityByName(
  db: Knex,
  repoId: number,
  entityName: string
): Promise<ORMEntity | null> {
  const ormEntity = await db('orm_entities')
    .where({ repo_id: repoId, entity_name: entityName })
    .first();
  return (ormEntity as ORMEntity) || null;
}

export async function createORMRepository(
  db: Knex,
  data: CreateORMRepository
): Promise<ORMRepository> {
  const [ormRepository] = await db('orm_repositories').insert(data).returning('*');
  return ormRepository as ORMRepository;
}

export async function getORMRepository(db: Knex, id: number): Promise<ORMRepository | null> {
  const ormRepository = await db('orm_repositories').where({ id }).first();
  return (ormRepository as ORMRepository) || null;
}

export async function getORMRepositoriesByEntity(
  db: Knex,
  entityId: number
): Promise<ORMRepository[]> {
  const ormRepositories = await db('orm_repositories')
    .where({ entity_id: entityId })
    .orderBy('repository_type');
  return ormRepositories as ORMRepository[];
}
