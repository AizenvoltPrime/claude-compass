import { JobQueueType, WorkerType } from '../../database/models';

export function containsJobPatterns(content: string): boolean {
  const jobPatterns = [
    // Bull/BullMQ patterns
    /import.*bull/i,
    /require.*bull/i,
    /new Bull\(/,
    /new Queue\(/,
    /\.add\(/,
    /\.process\(/,
    /\.on\(['"]completed['"]|['"]failed['"]|['"]progress['"]\)/,

    // Agenda patterns
    /import.*agenda/i,
    /require.*agenda/i,
    /new Agenda\(/,
    /\.define\(/,
    /\.every\(/,
    /\.schedule\(/,
    /\.now\(/,
    /\.start\(/,

    // Worker threads patterns
    /worker_threads/,
    /new Worker\(/,
    /isMainThread/,
    /parentPort/,
    /workerData/,

    // Bee-Queue patterns
    /bee-queue/i,
    /new Queue\(/,

    // Kue patterns
    /import.*kue/i,
    /require.*kue/i,
    /kue\.createQueue/,

    // General job patterns
    /job.*queue/i,
    /background.*job/i,
    /task.*queue/i,
    /\.enqueue\(/,
    /\.dequeue\(/,
  ];

  return jobPatterns.some(pattern => pattern.test(content));
}

export function detectJobSystems(content: string): (JobQueueType | WorkerType)[] {
  const systems: (JobQueueType | WorkerType)[] = [];

  // Bull/BullMQ
  if (/import.*bull|require.*bull|new Bull\(|new Queue\(/i.test(content)) {
    if (content.includes('bullmq') || content.includes('bull-mq')) {
      systems.push(JobQueueType.BULLMQ);
    } else {
      systems.push(JobQueueType.BULL);
    }
  }

  // Agenda
  if (/import.*agenda|require.*agenda|new Agenda\(/i.test(content)) {
    systems.push(JobQueueType.AGENDA);
  }

  // Bee-Queue
  if (/bee-queue/i.test(content)) {
    systems.push(JobQueueType.BEE);
  }

  // Kue
  if (/import.*kue|require.*kue|kue\.createQueue/i.test(content)) {
    systems.push(JobQueueType.KUE);
  }

  // Worker Threads
  if (/worker_threads|new Worker\(|isMainThread|parentPort|workerData/.test(content)) {
    systems.push(WorkerType.WORKER_THREADS);
  }

  return systems;
}

export function getFrameworkPatterns(): any[] {
  return [
    {
      name: 'bull-queue',
      pattern: /import.*bull|require.*bull|new Bull\(|new Queue\(/i,
      fileExtensions: ['.js', '.ts'],
      priority: 10,
    },
    {
      name: 'agenda-jobs',
      pattern: /import.*agenda|require.*agenda|new Agenda\(/i,
      fileExtensions: ['.js', '.ts'],
      priority: 9,
    },
    {
      name: 'worker-threads',
      pattern: /worker_threads|new Worker\(|isMainThread|parentPort/,
      fileExtensions: ['.js', '.ts'],
      priority: 8,
    },
    {
      name: 'bee-queue',
      pattern: /bee-queue/i,
      fileExtensions: ['.js', '.ts'],
      priority: 7,
    },
    {
      name: 'kue-jobs',
      pattern: /import.*kue|require.*kue|kue\.createQueue/i,
      fileExtensions: ['.js', '.ts'],
      priority: 6,
    },
  ];
}
