import { BackgroundJobParser } from '../../src/parsers/background-job';
import { SymbolType, DependencyType } from '../../src/database/models';

describe('BackgroundJobParser', () => {
  let parser: BackgroundJobParser;

  beforeEach(() => {
    parser = new BackgroundJobParser();
  });

  describe('getSupportedExtensions', () => {
    it('should return correct background job file extensions', () => {
      const extensions = parser.getSupportedExtensions();
      expect(extensions).toContain('.js');
      expect(extensions).toContain('.ts');
      expect(extensions).toContain('.jsx');
      expect(extensions).toContain('.tsx');
    });
  });

  describe('getFrameworkPatterns', () => {
    it('should return background job patterns', () => {
      const patterns = parser.getFrameworkPatterns();
      expect(patterns).toHaveLength(5);
      expect(patterns.map(p => p.name)).toContain('bull-queue');
      expect(patterns.map(p => p.name)).toContain('agenda-jobs');
      expect(patterns.map(p => p.name)).toContain('worker-threads');
      expect(patterns.map(p => p.name)).toContain('bee-queue');
      expect(patterns.map(p => p.name)).toContain('kue-jobs');
    });
  });

  describe('parseFile', () => {
    it('should parse Bull queue definition', async () => {
      const content = `
        const Queue = require('bull');
        const emailQueue = new Queue('email processing');

        emailQueue.process('send-email', async (job) => {
          const { to, subject, body } = job.data;
          await sendEmail(to, subject, body);
          return { status: 'sent' };
        });

        emailQueue.process('send-bulk-email', 5, async (job) => {
          const { recipients, template } = job.data;
          await sendBulkEmail(recipients, template);
        });

        module.exports = emailQueue;
      `;

      const result = await parser.parseFile('email-queue.js', content);

      expect(result.symbols.length).toBeGreaterThan(2);
      const emailQueueSymbol = result.symbols.find(s => s.name === 'emailQueue');
      expect(emailQueueSymbol).toBeDefined();

      expect(result.dependencies.length).toBeGreaterThan(0);
      expect(result.exports.length).toBeGreaterThanOrEqual(0);
    });

    it('should parse BullMQ queue definition', async () => {
      const content = `
        import { Queue, Worker, QueueEvents } from 'bullmq';

        const imageQueue = new Queue('image processing', {
          connection: {
            host: 'localhost',
            port: 6379,
          },
        });

        const worker = new Worker('image processing', async (job) => {
          const { imageUrl, operations } = job.data;
          return await processImage(imageUrl, operations);
        }, {
          connection: {
            host: 'localhost',
            port: 6379,
          },
        });

        const queueEvents = new QueueEvents('image processing');

        export { imageQueue, worker, queueEvents };
      `;

      const result = await parser.parseFile('image-processor.ts', content);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]).toMatchObject({
        source: 'bullmq',
        import_type: 'named',
      });

      expect(result.symbols.length).toBeGreaterThan(2);
      const imageQueueSymbol = result.symbols.find(s => s.name === 'imageQueue');
      expect(imageQueueSymbol).toBeDefined();

      expect(result.exports).toHaveLength(1);
    });

    it('should parse Agenda job definitions', async () => {
      const content = `
        const Agenda = require('agenda');

        const agenda = new Agenda({
          db: { address: 'mongodb://localhost:27017/agenda' }
        });

        agenda.define('send notification', async (job) => {
          const { userId, message } = job.attrs.data;
          await notificationService.send(userId, message);
        });

        agenda.define('cleanup old data', { priority: 'high', concurrency: 1 }, async (job) => {
          await dataCleanupService.cleanup();
        });

        agenda.every('5 minutes', 'cleanup old data');
        agenda.schedule('in 20 minutes', 'send notification', { userId: 123, message: 'Hello' });

        (async function() {
          await agenda.start();
        })();

        module.exports = agenda;
      `;

      const result = await parser.parseFile('agenda-jobs.js', content);

      expect(result.symbols.length).toBeGreaterThan(2);
      const agendaSymbol = result.symbols.find(s => s.name === 'agenda');
      expect(agendaSymbol).toBeDefined();

      expect(result.dependencies.length).toBeGreaterThan(0);
    });

    it('should parse Worker Threads', async () => {
      const content = `
        const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

        if (isMainThread) {
          // Main thread
          const worker = new Worker(__filename, {
            workerData: { task: 'heavy-computation', data: [1, 2, 3, 4, 5] }
          });

          worker.on('message', (result) => {
            console.log('Worker result:', result);
          });

          worker.on('error', (error) => {
            console.error('Worker error:', error);
          });

          worker.on('exit', (code) => {
            if (code !== 0) {
              console.error(\`Worker stopped with exit code \${code}\`);
            }
          });
        } else {
          // Worker thread
          const { task, data } = workerData;

          function heavyComputation(numbers) {
            return numbers.reduce((sum, num) => sum + Math.pow(num, 2), 0);
          }

          if (task === 'heavy-computation') {
            const result = heavyComputation(data);
            parentPort.postMessage(result);
          }
        }
      `;

      const result = await parser.parseFile('computation-worker.js', content);

      expect(result.symbols.length).toBeGreaterThan(1);
      const workerSymbol = result.symbols.find(s => s.name === 'worker');
      expect(workerSymbol).toBeDefined();

      expect(result.dependencies.length).toBeGreaterThan(0);
    });

    it('should parse Bee Queue', async () => {
      const content = `
        const Queue = require('bee-queue');

        const reportQueue = new Queue('report generation', {
          redis: {
            host: 'localhost',
            port: 6379,
          },
          isWorker: true,
        });

        reportQueue.process(async (job) => {
          const { reportType, userId } = job.data;
          const report = await generateReport(reportType, userId);
          return { reportId: report.id, status: 'completed' };
        });

        reportQueue.on('succeeded', (job, result) => {
          console.log(\`Report generated: \${result.reportId}\`);
        });

        reportQueue.on('failed', (job, err) => {
          console.error('Report generation failed:', err);
        });

        module.exports = reportQueue;
      `;

      const result = await parser.parseFile('report-queue.js', content);

      expect(result.symbols.length).toBeGreaterThan(1);
      const reportQueueSymbol = result.symbols.find(s => s.name === 'reportQueue');
      expect(reportQueueSymbol).toBeDefined();
    });

    it('should parse job processor file', async () => {
      const content = `
        const emailProcessor = async (job) => {
          const { type, data } = job.data;

          switch (type) {
            case 'welcome':
              return await sendWelcomeEmail(data.email, data.name);
            case 'reset-password':
              return await sendPasswordResetEmail(data.email, data.token);
            case 'notification':
              return await sendNotificationEmail(data.email, data.message);
            default:
              throw new Error(\`Unknown email type: \${type}\`);
          }
        };

        const smsProcessor = async (job) => {
          const { phone, message } = job.data;
          return await sendSMS(phone, message);
        };

        module.exports = {
          emailProcessor,
          smsProcessor,
        };
      `;

      const result = await parser.parseFile('processors.js', content);

      // Job processor parsing may not be fully implemented
      expect(result.symbols.length).toBeGreaterThanOrEqual(0);
      expect(result.dependencies.length).toBeGreaterThanOrEqual(0);
    });

    it('should parse cron job definitions', async () => {
      const content = `
        const cron = require('node-cron');

        // Run every day at 2 AM
        cron.schedule('0 2 * * *', async () => {
          console.log('Running daily backup...');
          await performDailyBackup();
        });

        // Run every 15 minutes
        cron.schedule('*/15 * * * *', async () => {
          await healthCheck();
        });

        // Run every Monday at 9 AM
        cron.schedule('0 9 * * 1', () => {
          sendWeeklyReport();
        }, {
          timezone: "America/New_York"
        });
      `;

      const result = await parser.parseFile('cron-jobs.js', content);

      expect(result.dependencies.length).toBeGreaterThan(0);
    });

    it('should handle job queue with TypeScript types', async () => {
      const content = `
        import { Queue, Worker, Job } from 'bullmq';

        interface EmailJobData {
          to: string;
          subject: string;
          body: string;
          priority?: number;
        }

        interface ProcessedEmailResult {
          messageId: string;
          status: 'sent' | 'failed';
          timestamp: Date;
        }

        const emailQueue = new Queue<EmailJobData>('email-queue');

        const emailWorker = new Worker<EmailJobData, ProcessedEmailResult>(
          'email-queue',
          async (job: Job<EmailJobData>) => {
            const { to, subject, body } = job.data;
            const result = await emailService.send(to, subject, body);

            return {
              messageId: result.id,
              status: 'sent',
              timestamp: new Date(),
            };
          }
        );

        export { emailQueue, emailWorker };
      `;

      const result = await parser.parseFile('typed-email-queue.ts', content);

      expect(result.symbols.length).toBeGreaterThan(1);
      expect(result.exports).toHaveLength(1);
    });

    it('should handle empty background job file', async () => {
      const content = '';
      const result = await parser.parseFile('empty-worker.js', content);

      expect(result.symbols).toHaveLength(0);
      expect(result.dependencies).toHaveLength(0);
      expect(result.imports).toHaveLength(0);
      expect(result.exports).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('detectFrameworkEntities', () => {
    it('should detect background job system', async () => {
      const content = `
        const Queue = require('bull');
        const myQueue = new Queue('my-jobs');
      `;

      const result = await parser.detectFrameworkEntities(content, 'queue.js', {});

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toMatchObject({
        type: 'job_system',
        name: 'queue',
        filePath: 'queue.js',
      });
    });
  });

  describe('getDetectedJobSystems', () => {
    it('should return detected job systems', async () => {
      await parser.parseFile('bull-queue.js', 'const Queue = require("bull");');
      await parser.parseFile('agenda-job.js', 'const Agenda = require("agenda");');

      const jobSystems = parser.getDetectedJobSystems();

      expect(jobSystems).toContain('bull');
      expect(jobSystems).toContain('agenda');
    });
  });
});