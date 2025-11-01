import { JobQueueType, WorkerType } from '../../database/models';

export interface JobQueue {
  name: string;
  queueType: JobQueueType;
  filePath: string;
  jobs: JobDefinition[];
  processors: JobProcessor[];
  config: JobQueueConfig;
}

export interface JobDefinition {
  name: string;
  jobType: 'scheduled' | 'triggered' | 'repeatable' | 'delayed';
  schedule?: string;
  retries?: number;
  timeout?: number;
  priority?: number;
  startLine: number;
  endLine: number;
  dependencies: string[];
}

export interface JobProcessor {
  name: string;
  queueName: string;
  concurrency?: number;
  filePath: string;
  startLine: number;
  endLine: number;
  handledJobs: string[];
}

export interface JobQueueConfig {
  redis?: {
    host?: string;
    port?: number;
    db?: number;
  };
  defaultJobOptions?: {
    removeOnComplete?: number;
    removeOnFail?: number;
    delay?: number;
    attempts?: number;
  };
}

export interface WorkerThread {
  name: string;
  filePath: string;
  threadFile?: string;
  data?: any;
  startLine: number;
  endLine: number;
  isMainThread: boolean;
}
