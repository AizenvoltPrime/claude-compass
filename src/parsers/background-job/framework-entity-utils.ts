import * as path from 'path';
import { FrameworkEntity, ParseResult } from '../base';
import { JobQueueType, WorkerType } from '../../database/models';
import { JobQueue, WorkerThread } from './types';

export function createJobFrameworkEntities(
  filePath: string,
  jobSystems: (JobQueueType | WorkerType)[],
  jobQueues: JobQueue[],
  workerThreads: WorkerThread[]
): FrameworkEntity[] {
  const entities: FrameworkEntity[] = [];

  if (jobSystems.length === 0) return entities;

  const fileName = path.basename(filePath, path.extname(filePath));

  entities.push({
    type: 'job_system',
    name: fileName,
    filePath,
    metadata: {
      jobSystems,
      queues: jobQueues.filter(q => q.filePath === filePath),
      workers: workerThreads.filter(w => w.filePath === filePath),
      detectedAt: new Date().toISOString(),
    },
  });

  return entities;
}

export function analyzeFrameworkEntitiesFromResult(
  result: ParseResult,
  content: string,
  filePath: string,
  detectJobSystems: (content: string) => (JobQueueType | WorkerType)[],
  jobQueues: JobQueue[],
  workerThreads: WorkerThread[]
): FrameworkEntity[] {
  try {
    const jobSystems = detectJobSystems(content);
    return createJobFrameworkEntities(filePath, jobSystems, jobQueues, workerThreads);
  } catch (error) {
    return [];
  }
}
