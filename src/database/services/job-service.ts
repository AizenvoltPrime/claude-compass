import type { Knex } from 'knex';
import type {
  JobQueue,
  JobDefinition,
  WorkerThread,
  CreateJobQueue,
  CreateJobDefinition,
  CreateWorkerThread,
  JobQueueType,
} from '../models';

export async function createJobQueue(db: Knex, data: CreateJobQueue): Promise<JobQueue> {
  const [jobQueue] = await db('job_queues').insert(data).returning('*');
  return jobQueue as JobQueue;
}

export async function getJobQueue(db: Knex, id: number): Promise<JobQueue | null> {
  const jobQueue = await db('job_queues').where({ id }).first();
  return (jobQueue as JobQueue) || null;
}

export async function getJobQueuesByRepository(db: Knex, repoId: number): Promise<JobQueue[]> {
  const jobQueues = await db('job_queues').where({ repo_id: repoId }).orderBy('name');
  return jobQueues as JobQueue[];
}

export async function getJobQueuesByType(
  db: Knex,
  repoId: number,
  queueType: JobQueueType
): Promise<JobQueue[]> {
  const jobQueues = await db('job_queues')
    .where({ repo_id: repoId, queue_type: queueType })
    .orderBy('name');
  return jobQueues as JobQueue[];
}

export async function createJobDefinition(
  db: Knex,
  data: CreateJobDefinition
): Promise<JobDefinition> {
  const [jobDefinition] = await db('job_definitions').insert(data).returning('*');
  return jobDefinition as JobDefinition;
}

export async function getJobDefinition(db: Knex, id: number): Promise<JobDefinition | null> {
  const jobDefinition = await db('job_definitions').where({ id }).first();
  return (jobDefinition as JobDefinition) || null;
}

export async function getJobDefinitionsByQueue(
  db: Knex,
  queueId: number
): Promise<JobDefinition[]> {
  const jobDefinitions = await db('job_definitions')
    .where({ queue_id: queueId })
    .orderBy('job_name');
  return jobDefinitions as JobDefinition[];
}

export async function getJobDefinitionsByRepository(
  db: Knex,
  repoId: number
): Promise<JobDefinition[]> {
  const jobDefinitions = await db('job_definitions')
    .where({ repo_id: repoId })
    .orderBy('job_name');
  return jobDefinitions as JobDefinition[];
}

export async function createWorkerThread(db: Knex, data: CreateWorkerThread): Promise<WorkerThread> {
  const [workerThread] = await db('worker_threads').insert(data).returning('*');
  return workerThread as WorkerThread;
}

export async function getWorkerThread(db: Knex, id: number): Promise<WorkerThread | null> {
  const workerThread = await db('worker_threads').where({ id }).first();
  return (workerThread as WorkerThread) || null;
}

export async function getWorkerThreadsByRepository(
  db: Knex,
  repoId: number
): Promise<WorkerThread[]> {
  const workerThreads = await db('worker_threads')
    .where({ repo_id: repoId })
    .orderBy('worker_type');
  return workerThreads as WorkerThread[];
}
