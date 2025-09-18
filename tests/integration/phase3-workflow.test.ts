import { DatabaseService } from '../../src/database/services';
import { BackgroundJobParser } from '../../src/parsers/background-job';
import { TestFrameworkParser } from '../../src/parsers/test-framework';
import { ORMParser } from '../../src/parsers/orm';
import { PackageManagerParser } from '../../src/parsers/package-manager';
import { TransitiveAnalyzer } from '../../src/graph/transitive-analyzer';
import { MCPServer } from '../../src/mcp/server';
import { Repository, SymbolType, DependencyType } from '../../src/database/models';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Comprehensive End-to-End Workflow Tests for Phase 3
 *
 * Tests the complete workflow from parsing to MCP tool responses
 * for all Phase 3 components working together in realistic scenarios.
 */
describe('Phase 3 End-to-End Workflow', () => {
  let dbService: DatabaseService;
  let transitiveAnalyzer: TransitiveAnalyzer;
  let mcpServer: MCPServer;
  let testRepoPath: string;
  let testRepository: Repository;

  beforeAll(async () => {
    dbService = new DatabaseService();
    transitiveAnalyzer = new TransitiveAnalyzer();
    mcpServer = new MCPServer();

    // Create temporary test repository
    testRepoPath = join(tmpdir(), `phase3-test-${Date.now()}`);
    mkdirSync(testRepoPath, { recursive: true });

    await setupTestRepository();
    await createTestRepository();
  });

  afterAll(async () => {
    // Cleanup
    if (testRepository) {
      await dbService.deleteRepositoryCompletely(testRepository.id);
    }
    await dbService.close();

    // Remove test directory
    try {
      rmSync(testRepoPath, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup test directory:', error);
    }
  });

  async function setupTestRepository() {
    // Create realistic test files for all Phase 3 components

    // Package.json with dependencies
    const packageJson = {
      name: 'phase3-test-app',
      version: '1.0.0',
      dependencies: {
        'bull': '^4.10.0',
        'jest': '^29.0.0',
        'prisma': '^5.0.0',
        'express': '^4.18.0'
      },
      devDependencies: {
        'vitest': '^0.34.0',
        'cypress': '^13.0.0'
      },
      workspaces: [
        'packages/*'
      ]
    };
    writeFileSync(join(testRepoPath, 'package.json'), JSON.stringify(packageJson, null, 2));

    // Nx workspace configuration
    const nxJson = {
      version: 2,
      projects: {
        'api': 'packages/api',
        'web': 'packages/web'
      }
    };
    writeFileSync(join(testRepoPath, 'nx.json'), JSON.stringify(nxJson, null, 2));

    // Background job files
    mkdirSync(join(testRepoPath, 'jobs'), { recursive: true });
    const jobFile = `
import Bull from 'bull';
import { sendEmail } from '../services/emailService';

const emailQueue = new Bull('email processing', {
  redis: { port: 6379, host: '127.0.0.1' }
});

emailQueue.process('send-welcome', async (job) => {
  const { userId, email } = job.data;
  await sendEmail(email, 'Welcome!');
  return { success: true };
});

export const addWelcomeEmailJob = (userId: string, email: string) => {
  return emailQueue.add('send-welcome', { userId, email }, {
    delay: 5000,
    attempts: 3
  });
};
`;
    writeFileSync(join(testRepoPath, 'jobs', 'emailJob.ts'), jobFile);

    // Test files
    mkdirSync(join(testRepoPath, 'tests'), { recursive: true });
    const testFile = `
import { describe, it, expect } from 'vitest';
import { addWelcomeEmailJob } from '../jobs/emailJob';
import { sendEmail } from '../services/emailService';

jest.mock('../services/emailService');

describe('Email Job', () => {
  it('should send welcome email', async () => {
    const mockSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
    mockSendEmail.mockResolvedValue(true);

    await addWelcomeEmailJob('user123', 'test@example.com');

    expect(mockSendEmail).toHaveBeenCalledWith('test@example.com', 'Welcome!');
  });

  it('should handle email sending errors', async () => {
    const mockSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
    mockSendEmail.mockRejectedValue(new Error('SMTP failed'));

    await expect(addWelcomeEmailJob('user123', 'invalid@example.com'))
      .rejects.toThrow('SMTP failed');
  });
});
`;
    writeFileSync(join(testRepoPath, 'tests', 'emailJob.test.ts'), testFile);

    // ORM model files
    mkdirSync(join(testRepoPath, 'models'), { recursive: true });
    const userModel = `
import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Order } from './Order';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  email: string;

  @Column()
  name: string;

  @OneToMany(() => Order, order => order.user)
  orders: Order[];

  async sendWelcomeEmail() {
    const { addWelcomeEmailJob } = await import('../jobs/emailJob');
    return addWelcomeEmailJob(this.id.toString(), this.email);
  }
}
`;
    writeFileSync(join(testRepoPath, 'models', 'User.ts'), userModel);

    const orderModel = `
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { User } from './User';

@Entity()
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('decimal')
  amount: number;

  @ManyToOne(() => User, user => user.orders)
  user: User;
}
`;
    writeFileSync(join(testRepoPath, 'models', 'Order.ts'), orderModel);

    // Service file that ties everything together
    mkdirSync(join(testRepoPath, 'services'), { recursive: true });
    const emailService = `
import { createTransporter } from '../config/mailer';

export async function sendEmail(to: string, subject: string, body?: string): Promise<boolean> {
  try {
    const transporter = createTransporter();
    await transporter.sendMail({ to, subject, text: body });
    return true;
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
}
`;
    writeFileSync(join(testRepoPath, 'services', 'emailService.ts'), emailService);

    // Prisma schema
    const prismaSchema = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id      Int     @id @default(autoincrement())
  email   String  @unique
  name    String
  orders  Order[]

  @@map("users")
}

model Order {
  id     Int    @id @default(autoincrement())
  amount Float
  userId Int
  user   User   @relation(fields: [userId], references: [id])

  @@map("orders")
}
`;
    mkdirSync(join(testRepoPath, 'prisma'), { recursive: true });
    writeFileSync(join(testRepoPath, 'prisma', 'schema.prisma'), prismaSchema);

    // Monorepo package structure
    mkdirSync(join(testRepoPath, 'packages', 'api'), { recursive: true });
    mkdirSync(join(testRepoPath, 'packages', 'web'), { recursive: true });

    const apiPackageJson = {
      name: '@test/api',
      version: '1.0.0',
      dependencies: {
        '@test/shared': 'workspace:*'
      }
    };
    writeFileSync(join(testRepoPath, 'packages', 'api', 'package.json'), JSON.stringify(apiPackageJson, null, 2));

    const webPackageJson = {
      name: '@test/web',
      version: '1.0.0',
      dependencies: {
        '@test/api': 'workspace:*'
      }
    };
    writeFileSync(join(testRepoPath, 'packages', 'web', 'package.json'), JSON.stringify(webPackageJson, null, 2));
  }

  async function createTestRepository() {
    testRepository = await dbService.createRepository({
      name: 'phase3-test-repo',
      path: testRepoPath,
      language_primary: 'typescript',
      framework_stack: ['node', 'express'],
      last_indexed: new Date(),
      git_hash: 'test-hash-123'
    });
  }

  describe('Background Job Workflow', () => {
    it('should parse, store, and query background jobs end-to-end', async () => {
      const parser = new BackgroundJobParser();

      // Parse job files
      const jobFilePath = join(testRepoPath, 'jobs', 'emailJob.ts');
      const fileContent = readFileSync(jobFilePath, 'utf-8');
      const parseResult = await parser.parseFile(jobFilePath, fileContent);

      expect(parseResult.success).toBe(true);
      expect(parseResult.symbols.length).toBeGreaterThan(0);
      expect(parseResult.frameworkEntities.length).toBeGreaterThan(0);

      // Store in database
      const file = await dbService.createFile({
        repo_id: testRepository.id,
        path: 'jobs/emailJob.ts',
        language: 'typescript',
        size: fileContent.length,
        last_modified: new Date(),
        git_hash: 'file-hash-123',
        is_generated: false,
        is_test: false
      });

      for (const symbol of parseResult.symbols) {
        await dbService.createSymbol({
          ...symbol,
          file_id: file.id
        });
      }

      for (const entity of parseResult.frameworkEntities) {
        await dbService.createFrameworkEntity({
          ...entity,
          repo_id: testRepository.id
        });
      }

      // Query via MCP tools
      const searchResults = await dbService.searchSymbols('emailQueue', { repo_id: testRepository.id });
      expect(searchResults.length).toBeGreaterThan(0);

      const jobSymbol = searchResults.find(s => s.name === 'emailQueue');
      expect(jobSymbol).toBeDefined();
      expect(jobSymbol?.symbol_type).toBe(SymbolType.VARIABLE);
    });
  });

  describe('Test Framework Workflow', () => {
    it('should parse test files and establish test-to-code links', async () => {
      const parser = new TestFrameworkParser();

      // Parse test file
      const testFilePath = join(testRepoPath, 'tests', 'emailJob.test.ts');
      const fileContent = readFileSync(testFilePath, 'utf-8');
      const parseResult = await parser.parseFile(testFilePath, fileContent);

      expect(parseResult.success).toBe(true);
      expect(parseResult.symbols.length).toBeGreaterThan(0);
      expect(parseResult.dependencies.length).toBeGreaterThan(0);

      // Store test file
      const file = await dbService.createFile({
        repo_id: testRepository.id,
        path: 'tests/emailJob.test.ts',
        language: 'typescript',
        size: fileContent.length,
        last_modified: new Date(),
        git_hash: 'test-file-hash-123',
        is_generated: false,
        is_test: true
      });

      const symbols = [];
      for (const symbol of parseResult.symbols) {
        const createdSymbol = await dbService.createSymbol({
          ...symbol,
          file_id: file.id
        });
        symbols.push(createdSymbol);
      }

      // Check for TEST_COVERS dependencies
      const testDependencies = parseResult.dependencies.filter(
        dep => dep.dependency_type === DependencyType.TEST_COVERS
      );
      expect(testDependencies.length).toBeGreaterThan(0);
    });
  });

  describe('ORM Relationship Workflow', () => {
    it('should parse ORM models and establish entity relationships', async () => {
      const parser = new ORMParser();

      // Parse User model
      const userFilePath = join(testRepoPath, 'models', 'User.ts');
      const userContent = readFileSync(userFilePath, 'utf-8');
      const userResult = await parser.parseFile(userFilePath, userContent);

      expect(userResult.success).toBe(true);
      expect(userResult.symbols.length).toBeGreaterThan(0);
      expect(userResult.frameworkEntities.length).toBeGreaterThan(0);

      // Parse Order model
      const orderFilePath = join(testRepoPath, 'models', 'Order.ts');
      const orderContent = readFileSync(orderFilePath, 'utf-8');
      const orderResult = await parser.parseFile(orderFilePath, orderContent);

      expect(orderResult.success).toBe(true);

      // Store both models
      const userFile = await dbService.createFile({
        repo_id: testRepository.id,
        path: 'models/User.ts',
        language: 'typescript',
        size: userContent.length,
        last_modified: new Date(),
        git_hash: 'user-model-hash',
        is_generated: false,
        is_test: false
      });

      const orderFile = await dbService.createFile({
        repo_id: testRepository.id,
        path: 'models/Order.ts',
        language: 'typescript',
        size: orderContent.length,
        last_modified: new Date(),
        git_hash: 'order-model-hash',
        is_generated: false,
        is_test: false
      });

      // Store symbols and relationships
      for (const symbol of [...userResult.symbols, ...orderResult.symbols]) {
        await dbService.createSymbol({
          ...symbol,
          file_id: symbol.file_id || (symbol.name.includes('User') ? userFile.id : orderFile.id)
        });
      }

      // Check for ORM relationship dependencies
      const ormDependencies = [...userResult.dependencies, ...orderResult.dependencies].filter(
        dep => [DependencyType.HAS_MANY, DependencyType.BELONGS_TO].includes(dep.dependency_type)
      );
      expect(ormDependencies.length).toBeGreaterThan(0);
    });
  });

  describe('Package Manager Workflow', () => {
    it('should parse package.json and detect workspace structure', async () => {
      const parser = new PackageManagerParser();

      // Parse root package.json
      const packagePath = join(testRepoPath, 'package.json');
      const packageContent = readFileSync(packagePath, 'utf-8');
      const parseResult = await parser.parseFile(packagePath, packageContent);

      expect(parseResult.success).toBe(true);
      expect(parseResult.symbols.length).toBeGreaterThan(0);
      expect(parseResult.frameworkEntities.length).toBeGreaterThan(0);

      // Should detect workspace configuration
      const workspaceEntities = parseResult.frameworkEntities.filter(
        entity => entity.entity_type === 'workspace'
      );
      expect(workspaceEntities.length).toBeGreaterThan(0);

      // Parse nx.json for monorepo structure
      const nxPath = join(testRepoPath, 'nx.json');
      const nxContent = readFileSync(nxPath, 'utf-8');
      const nxResult = await parser.parseFile(nxPath, nxContent);

      expect(nxResult.success).toBe(true);

      // Should detect project relationships
      const projectDependencies = nxResult.dependencies.filter(
        dep => dep.dependency_type === DependencyType.WORKSPACE_DEPENDENCY
      );
      expect(projectDependencies.length).toBeGreaterThan(0);
    });
  });

  describe('Transitive Analysis Workflow', () => {
    it('should perform end-to-end transitive analysis across all Phase 3 components', async () => {
      // First, set up all the data by parsing all files
      await setupCompleteRepository();

      // Find a symbol that should have transitive relationships
      const symbols = await dbService.searchSymbols('sendWelcomeEmail', { repo_id: testRepository.id });
      expect(symbols.length).toBeGreaterThan(0);

      const userMethodSymbol = symbols.find(s => s.name === 'sendWelcomeEmail');
      expect(userMethodSymbol).toBeDefined();

      // Perform transitive dependency analysis
      const dependencyResult = await transitiveAnalyzer.getTransitiveDependencies(
        userMethodSymbol!.id,
        { maxDepth: 5 }
      );

      expect(dependencyResult.results.length).toBeGreaterThan(0);
      expect(dependencyResult.executionTimeMs).toBeLessThan(5000);

      // Should trace through: User.sendWelcomeEmail -> addWelcomeEmailJob -> emailQueue -> Bull
      const transitiveSymbols = dependencyResult.results.map(r => r.symbolId);
      const allSymbols = await Promise.all(
        transitiveSymbols.map(id => dbService.getSymbolById(id))
      );

      const symbolNames = allSymbols.filter(s => s).map(s => s!.name);
      expect(symbolNames).toContain('addWelcomeEmailJob');

      // Perform transitive caller analysis
      const emailJobSymbols = await dbService.searchSymbols('addWelcomeEmailJob', { repo_id: testRepository.id });
      const emailJobSymbol = emailJobSymbols[0];

      const callerResult = await transitiveAnalyzer.getTransitiveCallers(
        emailJobSymbol.id,
        { maxDepth: 5 }
      );

      expect(callerResult.results.length).toBeGreaterThan(0);
    });
  });

  describe('Cross-Component Integration', () => {
    it('should handle complex scenarios with jobs, tests, ORM, and packages working together', async () => {
      await setupCompleteRepository();

      // Search for test coverage of job functionality
      const testSymbols = await dbService.searchSymbols('', {
        repo_id: testRepository.id,
        symbol_types: [SymbolType.TEST_SUITE]
      });

      expect(testSymbols.length).toBeGreaterThan(0);

      // Find dependencies between tests and job code
      const testSymbol = testSymbols[0];
      const testDependencies = await dbService.getDependencies(testSymbol.id);

      const testCoversDeps = testDependencies.filter(
        dep => dep.dependency_type === DependencyType.TEST_COVERS
      );
      expect(testCoversDeps.length).toBeGreaterThan(0);

      // Verify ORM to job integration
      const userSymbols = await dbService.searchSymbols('User', {
        repo_id: testRepository.id,
        symbol_types: [SymbolType.CLASS]
      });

      expect(userSymbols.length).toBeGreaterThan(0);

      const userSymbol = userSymbols[0];
      const userDependencies = await dbService.getDependencies(userSymbol.id);

      // Should have dependencies to job system
      const jobDeps = userDependencies.filter(dep =>
        dep.to_symbol?.name?.includes('emailJob') || dep.to_symbol?.name?.includes('Email')
      );
      expect(jobDeps.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and Scale', () => {
    it('should handle moderate-scale analysis efficiently', async () => {
      await setupCompleteRepository();

      // Test bulk operations
      const startTime = Date.now();

      const allSymbols = await dbService.searchSymbols('', { repo_id: testRepository.id });
      expect(allSymbols.length).toBeGreaterThan(10);

      // Test transitive analysis on multiple symbols
      const analysisPromises = allSymbols.slice(0, 5).map(symbol =>
        transitiveAnalyzer.getTransitiveDependencies(symbol.id, { maxDepth: 3 })
      );

      const results = await Promise.all(analysisPromises);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(10000); // Should complete within 10 seconds
      expect(results.every(r => r.results !== undefined)).toBe(true);
    });
  });

  // Helper function to set up complete repository with all parsers
  async function setupCompleteRepository() {
    const parsers = {
      job: new BackgroundJobParser(),
      test: new TestFrameworkParser(),
      orm: new ORMParser(),
      package: new PackageManagerParser()
    };

    const filesToParse = [
      { path: 'jobs/emailJob.ts', parser: 'job', isTest: false },
      { path: 'tests/emailJob.test.ts', parser: 'test', isTest: true },
      { path: 'models/User.ts', parser: 'orm', isTest: false },
      { path: 'models/Order.ts', parser: 'orm', isTest: false },
      { path: 'package.json', parser: 'package', isTest: false },
      { path: 'nx.json', parser: 'package', isTest: false }
    ];

    for (const fileInfo of filesToParse) {
      const fullPath = join(testRepoPath, fileInfo.path);
      const content = readFileSync(fullPath, 'utf-8');
      const parser = parsers[fileInfo.parser as keyof typeof parsers];

      const parseResult = await parser.parseFile(fullPath, content);

      if (parseResult.success) {
        // Create file record
        const file = await dbService.createFile({
          repo_id: testRepository.id,
          path: fileInfo.path,
          language: fileInfo.path.endsWith('.json') ? 'json' : 'typescript',
          size: content.length,
          last_modified: new Date(),
          git_hash: `hash-${fileInfo.path}`,
          is_generated: false,
          is_test: fileInfo.isTest
        });

        // Create symbols
        for (const symbol of parseResult.symbols) {
          await dbService.createSymbol({
            ...symbol,
            file_id: file.id
          });
        }

        // Create framework entities
        for (const entity of parseResult.frameworkEntities) {
          await dbService.createFrameworkEntity({
            ...entity,
            repo_id: testRepository.id
          });
        }

        // Create dependencies (we'll resolve symbol IDs later)
        for (const dependency of parseResult.dependencies) {
          try {
            await dbService.createDependency(dependency);
          } catch (error) {
            // Some dependencies might fail due to missing symbols, which is expected
            console.debug('Dependency creation failed (expected):', error.message);
          }
        }
      }
    }
  }
});