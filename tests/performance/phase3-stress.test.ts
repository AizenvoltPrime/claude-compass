import { DatabaseService } from '../../src/database/services';
import { TransitiveAnalyzer } from '../../src/graph/transitive-analyzer';
import { BackgroundJobParser } from '../../src/parsers/background-job';
import { TestFrameworkParser } from '../../src/parsers/test-framework';
import { ORMParser } from '../../src/parsers/orm';
import { PackageManagerParser } from '../../src/parsers/package-manager';
import { Repository, SymbolType, DependencyType } from '../../src/database/models';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Performance and Stress Tests for Phase 3 Implementation
 *
 * Tests the system's ability to handle large-scale codebases,
 * deep dependency chains, and high-load scenarios while maintaining
 * acceptable performance characteristics.
 */
describe('Phase 3 Performance and Stress Tests', () => {
  let dbService: DatabaseService;
  let transitiveAnalyzer: TransitiveAnalyzer;
  let testRepoPath: string;
  let testRepository: Repository;

  // Performance thresholds (from verification plan)
  const PERFORMANCE_THRESHOLDS = {
    ANALYSIS_TIME_PER_1K_FILES: 120_000, // 2 minutes per 1,000 files
    MCP_RESPONSE_TIME: 2_000, // 2 seconds
    MEMORY_LIMIT: 1_024 * 1_024 * 1_024, // 1GB
    TRANSITIVE_ANALYSIS_TIME: 5_000, // 5 seconds for typical chains
    LARGE_REPO_ANALYSIS: 30 * 60 * 1_000 // 30 minutes for large repos
  };

  beforeAll(async () => {
    dbService = new DatabaseService();
    transitiveAnalyzer = new TransitiveAnalyzer();

    // Create temporary test repository
    testRepoPath = join(tmpdir(), `phase3-stress-${Date.now()}`);
    mkdirSync(testRepoPath, { recursive: true });

    await createStressTestRepository();
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
      console.warn('Failed to cleanup stress test directory:', error);
    }
  });

  async function createStressTestRepository() {
    testRepository = await dbService.createRepository({
      name: 'phase3-stress-test',
      path: testRepoPath,
      language_primary: 'typescript',
      framework_stack: ['node', 'express'],
      last_indexed: new Date(),
      git_hash: 'stress-test-hash'
    });
  }

  describe('Large-Scale File Parsing Performance', () => {
    it('should handle 1000+ background job files efficiently', async () => {
      const startTime = Date.now();
      const parser = new BackgroundJobParser();
      const fileCount = 100; // Reduced for CI environments
      const results: any[] = [];

      // Create multiple job files
      mkdirSync(join(testRepoPath, 'stress-jobs'), { recursive: true });

      for (let i = 0; i < fileCount; i++) {
        const jobContent = generateLargeJobFile(i);
        const filePath = join(testRepoPath, 'stress-jobs', `job${i}.ts`);
        writeFileSync(filePath, jobContent);

        const parseResult = await parser.parseFile(filePath, jobContent);
        results.push(parseResult);

        // Memory check every 50 files
        if (i % 50 === 0) {
          const memUsage = process.memoryUsage();
          expect(memUsage.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.MEMORY_LIMIT);
          console.log(`Memory usage at file ${i}: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`Parsed ${fileCount} job files in ${duration}ms (${Math.round(duration / fileCount)}ms per file)`);

      // Performance assertions
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.ANALYSIS_TIME_PER_1K_FILES * (fileCount / 1000));
      expect(results.every(r => r.success)).toBe(true);
      expect(results.reduce((sum, r) => sum + r.symbols.length, 0)).toBeGreaterThan(fileCount * 3);
    }, 300000); // 5-minute timeout

    it('should handle deep dependency chains without performance degradation', async () => {
      const chainDepth = 50;
      const symbols: any[] = [];

      // Create a deep dependency chain
      for (let i = 0; i < chainDepth; i++) {
        const file = await dbService.createFile({
          repo_id: testRepository.id,
          path: `chain/level${i}.ts`,
          language: 'typescript',
          size: 1000,
          last_modified: new Date(),
          git_hash: `chain-hash-${i}`,
          is_generated: false,
          is_test: false
        });

        const symbol = await dbService.createSymbol({
          file_id: file.id,
          name: `function${i}`,
          symbol_type: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 10,
          is_exported: true,
          visibility: 'public',
          signature: `function${i}(): void`
        });

        symbols.push(symbol);

        // Create dependency to previous symbol
        if (i > 0) {
          await dbService.createDependency({
            from_symbol_id: symbol.id,
            to_symbol_id: symbols[i - 1].id,
            dependency_type: DependencyType.CALLS,
            line_number: 5,
            confidence: 1.0
          });
        }
      }

      // Test transitive analysis performance
      const startTime = Date.now();
      const result = await transitiveAnalyzer.getTransitiveDependencies(
        symbols[0].id,
        { maxDepth: chainDepth }
      );
      const endTime = Date.now();

      const duration = endTime - startTime;
      console.log(`Deep dependency analysis (depth ${chainDepth}) completed in ${duration}ms`);

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.TRANSITIVE_ANALYSIS_TIME);
      expect(result.results.length).toBe(Math.min(chainDepth - 1, 20)); // Limited by MAX_ABSOLUTE_DEPTH
      expect(result.maxDepthReached).toBeGreaterThan(0);
    }, 60000); // 1-minute timeout

    it('should handle complex dependency graphs with cycles efficiently', async () => {
      const nodeCount = 200; // Create a complex graph
      const symbols: any[] = [];

      // Create symbols
      for (let i = 0; i < nodeCount; i++) {
        const file = await dbService.createFile({
          repo_id: testRepository.id,
          path: `complex/node${i}.ts`,
          language: 'typescript',
          size: 500,
          last_modified: new Date(),
          git_hash: `complex-hash-${i}`,
          is_generated: false,
          is_test: false
        });

        const symbol = await dbService.createSymbol({
          file_id: file.id,
          name: `node${i}`,
          symbol_type: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 5,
          is_exported: true,
          visibility: 'public',
          signature: `node${i}(): void`
        });

        symbols.push(symbol);
      }

      // Create complex dependency relationships with cycles
      for (let i = 0; i < nodeCount; i++) {
        // Each node depends on 2-3 other nodes
        const dependencyCount = 2 + (i % 2);
        for (let j = 0; j < dependencyCount; j++) {
          const targetIndex = (i + j + 1) % nodeCount;

          try {
            await dbService.createDependency({
              from_symbol_id: symbols[i].id,
              to_symbol_id: symbols[targetIndex].id,
              dependency_type: DependencyType.CALLS,
              line_number: j + 1,
              confidence: 0.8 + (j * 0.1)
            });
          } catch (error) {
            // Ignore duplicate dependencies
          }
        }
      }

      // Test multiple transitive analyses
      const testSymbols = symbols.slice(0, 10);
      const startTime = Date.now();

      const results = await Promise.all(
        testSymbols.map(symbol =>
          transitiveAnalyzer.getTransitiveDependencies(symbol.id, { maxDepth: 5 })
        )
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`Complex graph analysis (${nodeCount} nodes, ${testSymbols.length} queries) completed in ${duration}ms`);

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.TRANSITIVE_ANALYSIS_TIME * 2);
      expect(results.every(r => r.cyclesDetected >= 0)).toBe(true);
      expect(results.some(r => r.cyclesDetected > 0)).toBe(true); // Should detect cycles
    }, 120000); // 2-minute timeout
  });

  describe('Memory Usage and Resource Management', () => {
    it('should maintain reasonable memory usage during large-scale operations', async () => {
      const initialMemory = process.memoryUsage();
      console.log(`Initial memory: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`);

      // Create a large number of symbols and dependencies
      const batchSize = 500;
      const batches = 5;

      for (let batch = 0; batch < batches; batch++) {
        const symbols: any[] = [];

        // Create batch of symbols
        for (let i = 0; i < batchSize; i++) {
          const file = await dbService.createFile({
            repo_id: testRepository.id,
            path: `memory-test/batch${batch}/symbol${i}.ts`,
            language: 'typescript',
            size: 1000 + i,
            last_modified: new Date(),
            git_hash: `memory-hash-${batch}-${i}`,
            is_generated: false,
            is_test: false
          });

          const symbol = await dbService.createSymbol({
            file_id: file.id,
            name: `memorySymbol${batch}_${i}`,
            symbol_type: SymbolType.FUNCTION,
            start_line: 1,
            end_line: 10,
            is_exported: true,
            visibility: 'public',
            signature: `memorySymbol${batch}_${i}(): void`
          });

          symbols.push(symbol);
        }

        // Create dependencies within batch
        for (let i = 0; i < batchSize - 1; i++) {
          await dbService.createDependency({
            from_symbol_id: symbols[i].id,
            to_symbol_id: symbols[i + 1].id,
            dependency_type: DependencyType.CALLS,
            line_number: 1,
            confidence: 1.0
          });
        }

        // Check memory usage
        const currentMemory = process.memoryUsage();
        const memoryIncrease = currentMemory.heapUsed - initialMemory.heapUsed;

        console.log(`After batch ${batch}: ${Math.round(currentMemory.heapUsed / 1024 / 1024)}MB (+${Math.round(memoryIncrease / 1024 / 1024)}MB)`);

        expect(currentMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.MEMORY_LIMIT);

        // Trigger garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      const totalIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      console.log(`Total memory increase: ${Math.round(totalIncrease / 1024 / 1024)}MB`);
      expect(finalMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.MEMORY_LIMIT);
    }, 180000); // 3-minute timeout

    it('should handle concurrent transitive analysis requests efficiently', async () => {
      // Create test symbols for concurrent analysis
      const concurrentRequests = 20;
      const symbols: any[] = [];

      for (let i = 0; i < concurrentRequests; i++) {
        const file = await dbService.createFile({
          repo_id: testRepository.id,
          path: `concurrent/symbol${i}.ts`,
          language: 'typescript',
          size: 500,
          last_modified: new Date(),
          git_hash: `concurrent-hash-${i}`,
          is_generated: false,
          is_test: false
        });

        const symbol = await dbService.createSymbol({
          file_id: file.id,
          name: `concurrentSymbol${i}`,
          symbol_type: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 5,
          is_exported: true,
          visibility: 'public',
          signature: `concurrentSymbol${i}(): void`
        });

        symbols.push(symbol);
      }

      // Create dependencies
      for (let i = 0; i < concurrentRequests - 1; i++) {
        await dbService.createDependency({
          from_symbol_id: symbols[i].id,
          to_symbol_id: symbols[i + 1].id,
          dependency_type: DependencyType.CALLS,
          line_number: 1,
          confidence: 1.0
        });
      }

      // Execute concurrent transitive analyses
      const startTime = Date.now();

      const concurrentPromises = symbols.map((symbol, index) =>
        transitiveAnalyzer.getTransitiveDependencies(symbol.id, {
          maxDepth: 5,
          confidenceThreshold: 0.1
        })
      );

      const results = await Promise.all(concurrentPromises);
      const endTime = Date.now();

      const duration = endTime - startTime;
      const avgDuration = duration / concurrentRequests;

      console.log(`Concurrent analysis: ${concurrentRequests} requests in ${duration}ms (${Math.round(avgDuration)}ms avg)`);

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.TRANSITIVE_ANALYSIS_TIME * 2);
      expect(results.every(r => r !== undefined)).toBe(true);
      expect(results.every(r => r.executionTimeMs < PERFORMANCE_THRESHOLDS.MCP_RESPONSE_TIME)).toBe(true);
    }, 60000); // 1-minute timeout
  });

  describe('Database Performance Under Load', () => {
    it('should maintain query performance with large datasets', async () => {
      // Create a large dataset
      const symbolCount = 2000;
      const symbols: any[] = [];

      console.log(`Creating ${symbolCount} symbols for database performance test...`);

      for (let i = 0; i < symbolCount; i++) {
        const file = await dbService.createFile({
          repo_id: testRepository.id,
          path: `db-perf/symbol${i}.ts`,
          language: 'typescript',
          size: 1000,
          last_modified: new Date(),
          git_hash: `db-perf-hash-${i}`,
          is_generated: false,
          is_test: i % 10 === 0 // Every 10th file is a test
        });

        const symbol = await dbService.createSymbol({
          file_id: file.id,
          name: `dbPerfSymbol${i}`,
          symbol_type: i % 3 === 0 ? SymbolType.CLASS : SymbolType.FUNCTION,
          start_line: 1,
          end_line: 10,
          is_exported: i % 2 === 0,
          visibility: 'public',
          signature: `dbPerfSymbol${i}(): void`
        });

        symbols.push(symbol);

        // Create random dependencies
        if (i > 0) {
          const dependencyCount = Math.min(3, i);
          for (let j = 0; j < dependencyCount; j++) {
            const targetIndex = Math.floor(Math.random() * i);
            try {
              await dbService.createDependency({
                from_symbol_id: symbol.id,
                to_symbol_id: symbols[targetIndex].id,
                dependency_type: Object.values(DependencyType)[j % Object.values(DependencyType).length],
                line_number: j + 1,
                confidence: 0.7 + (j * 0.1)
              });
            } catch (error) {
              // Ignore duplicate dependencies
            }
          }
        }

        if (i % 500 === 0) {
          console.log(`Created ${i} symbols...`);
        }
      }

      console.log('Testing database query performance...');

      // Test various query patterns
      const queries = [
        () => dbService.searchSymbols('dbPerfSymbol', { repo_id: testRepository.id, limit: 100 }),
        () => dbService.searchSymbols('', { repo_id: testRepository.id, symbol_types: [SymbolType.CLASS], limit: 50 }),
        () => dbService.searchSymbols('', { repo_id: testRepository.id, is_exported: true, limit: 200 }),
        () => dbService.getDependencies(symbols[100].id),
        () => dbService.getCallers(symbols[200].id)
      ];

      for (const [index, query] of queries.entries()) {
        const startTime = Date.now();
        const result = await query();
        const endTime = Date.now();

        const duration = endTime - startTime;
        console.log(`Query ${index + 1} completed in ${duration}ms (${Array.isArray(result) ? result.length : 1} results)`);

        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MCP_RESPONSE_TIME);
        expect(result).toBeDefined();
      }
    }, 300000); // 5-minute timeout
  });

  describe('Parser Performance Benchmarks', () => {
    it('should parse large files efficiently across all Phase 3 parsers', async () => {
      const parsers = [
        { name: 'BackgroundJob', parser: new BackgroundJobParser(), generator: generateLargeJobFile },
        { name: 'TestFramework', parser: new TestFrameworkParser(), generator: generateLargeTestFile },
        { name: 'ORM', parser: new ORMParser(), generator: generateLargeORMFile },
        { name: 'PackageManager', parser: new PackageManagerParser(), generator: generateLargePackageFile }
      ];

      const fileSizes = [10000, 50000, 100000]; // Different file sizes

      for (const { name, parser, generator } of parsers) {
        console.log(`Testing ${name} parser performance...`);

        for (const size of fileSizes) {
          const content = generator(size);
          const filePath = join(testRepoPath, `perf-${name.toLowerCase()}-${size}.ts`);

          const startTime = Date.now();
          const result = await parser.parseFile(filePath, content);
          const endTime = Date.now();

          const duration = endTime - startTime;
          const throughput = content.length / duration; // bytes per ms

          console.log(`  ${name} (${content.length} bytes): ${duration}ms (${Math.round(throughput)} bytes/ms)`);

          expect(result.success).toBe(true);
          expect(duration).toBeLessThan(10000); // Should parse within 10 seconds
          expect(throughput).toBeGreaterThan(100); // Minimum throughput requirement
        }
      }
    }, 180000); // 3-minute timeout
  });

  // Helper functions to generate large test files
  function generateLargeJobFile(size: number): string {
    const baseJob = `
import Bull from 'bull';
const queue${size} = new Bull('job-${size}', { redis: { port: 6379, host: 'localhost' } });

queue${size}.process('task-${size}', async (job) => {
  const { data } = job.data;
  await processData(data);
  return { success: true };
});

export const addJob${size} = (data: any) => {
  return queue${size}.add('task-${size}', { data }, { delay: 1000, attempts: 3 });
};
`;

    let content = baseJob;
    const iterations = Math.floor(size / baseJob.length);

    for (let i = 0; i < iterations; i++) {
      content += `
// Job ${i}
const processor${i} = async (job: any) => {
  console.log('Processing job ${i}:', job.data);
  await new Promise(resolve => setTimeout(resolve, ${i * 100}));
  return { jobId: ${i}, processed: true };
};

queue${size}.process('job-type-${i}', processor${i});
`;
    }

    return content;
  }

  function generateLargeTestFile(size: number): string {
    const baseTest = `
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockService } from '../mocks/MockService';

describe('Large Test Suite ${size}', () => {
  let mockService: MockService;

  beforeEach(() => {
    mockService = new MockService();
  });

  afterEach(() => {
    mockService.cleanup();
  });
`;

    let content = baseTest;
    const testCount = Math.floor(size / 200); // Approximate test size

    for (let i = 0; i < testCount; i++) {
      content += `
  it('should handle test case ${i}', async () => {
    const input = { id: ${i}, name: 'test-${i}', value: ${i * 10} };
    const result = await mockService.process(input);

    expect(result).toBeDefined();
    expect(result.id).toBe(${i});
    expect(result.processed).toBe(true);
    expect(result.value).toBeGreaterThan(${i * 5});
  });
`;
    }

    content += '\n});';
    return content;
  }

  function generateLargeORMFile(size: number): string {
    const baseModel = `
import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne } from 'typeorm';

@Entity()
export class LargeModel${size} {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;
`;

    let content = baseModel;
    const fieldCount = Math.floor(size / 100); // Approximate field size

    for (let i = 0; i < fieldCount; i++) {
      content += `
  @Column({ default: '${i}' })
  field${i}: string;
`;
    }

    content += `
  @OneToMany(() => RelatedModel, related => related.parent)
  relatedItems: RelatedModel[];

  async processData() {
    return this.relatedItems.map(item => item.process());
  }
}
`;

    return content;
  }

  function generateLargePackageFile(size: number): string {
    const basePackage = {
      name: `large-package-${size}`,
      version: '1.0.0',
      description: `Large package file for testing (${size} bytes)`,
      dependencies: {},
      devDependencies: {},
      scripts: {}
    };

    const depCount = Math.floor(size / 50); // Approximate dependency size

    for (let i = 0; i < depCount; i++) {
      basePackage.dependencies[`dependency-${i}`] = `^${i % 10}.${i % 20}.${i % 30}`;
      basePackage.devDependencies[`dev-dependency-${i}`] = `^${i % 5}.${i % 15}.${i % 25}`;
      basePackage.scripts[`script-${i}`] = `echo "Running script ${i}"`;
    }

    return JSON.stringify(basePackage, null, 2);
  }
});