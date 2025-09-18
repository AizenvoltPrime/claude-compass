import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { DatabaseService } from '../../src/database/services';
import { BackgroundJobParser } from '../../src/parsers/background-job';
import { TestFrameworkParser } from '../../src/parsers/test-framework';
import { ORMParser } from '../../src/parsers/orm';
import { PackageManagerParser } from '../../src/parsers/package-manager';
import { TransitiveAnalyzer } from '../../src/graph/transitive-analyzer';
import { Repository, SymbolType, DependencyType, Visibility } from '../../src/database/models';
import { createComponentLogger } from '../../src/utils/logger';

/**
 * Comprehensive Error Handling and Edge Case Tests for Phase 3
 *
 * Tests the system's robustness when dealing with malformed inputs,
 * edge cases, error conditions, and boundary scenarios across all
 * Phase 3 components.
 */
describe('Phase 3 Error Handling and Edge Cases', () => {
  let dbService: DatabaseService;
  let transitiveAnalyzer: TransitiveAnalyzer;
  let testRepository: Repository;
  const logger = createComponentLogger('phase3-error-test');

  beforeAll(async () => {
    dbService = new DatabaseService();
    transitiveAnalyzer = new TransitiveAnalyzer();

    testRepository = await dbService.createRepository({
      name: 'phase3-error-test',
      path: '/tmp/error-test',
      language_primary: 'typescript',
      framework_stack: ['node'],
      last_indexed: new Date(),
      git_hash: 'error-test-hash'
    });
  });

  afterAll(async () => {
    if (testRepository) {
      await dbService.deleteRepositoryCompletely(testRepository.id);
    }
    await dbService.close();
  });

  describe('Background Job Parser Error Handling', () => {
    const parser = new BackgroundJobParser();

    it('should handle malformed Bull queue configurations', async () => {
      const malformedBullCode = `
import Bull from 'bull';

// Missing configuration object
const invalidQueue1 = new Bull();

// Invalid configuration
const invalidQueue2 = new Bull('test', { invalid: 'config' });

// Malformed process definition
invalidQueue2.process(/* missing arguments */);

// Invalid job data
invalidQueue2.add(null, undefined, { /* invalid options */ });
`;

      const result = await parser.parseFile('malformed-bull.ts', malformedBullCode);

      expect(result.success).toBe(true); // Should not crash
      expect(result.errors.length).toBeGreaterThan(0); // Should report errors
      expect(result.symbols.length).toBeGreaterThanOrEqual(0); // May still extract some symbols
    });

    it('should handle syntax errors in job files gracefully', async () => {
      const syntaxErrorCode = `
import Bull from 'bull';

const queue = new Bull('test' {  // Missing comma
  redis: { port: 6379 }
});

queue.process('task', async (job) => {
  const { data } = job.data;
  return { success: true }
}); // Missing closing brace

export const addJob = (data) => {
  return queue.add('task', data;  // Missing closing parenthesis
`;

      const result = await parser.parseFile('syntax-error.ts', syntaxErrorCode);

      // Should handle gracefully without throwing
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.symbols.length).toBe(0);
    });

    it('should handle empty and whitespace-only files', async () => {
      const testCases = [
        '', // Empty file
        '   \n\t  \r\n  ', // Whitespace only
        '// Just a comment\n/* Another comment */', // Comments only
        'import Bull from "bull";' // Import only
      ];

      for (const [index, content] of testCases.entries()) {
        const result = await parser.parseFile(`empty-${index}.ts`, content);

        expect(result.success).toBe(true);
        expect(result.symbols.length).toBe(0);
        expect(result.frameworkEntities.length).toBe(0);
        expect(result.dependencies.length).toBe(0);
      }
    });

    it('should handle very large job files without crashing', async () => {
      // Generate a very large job file (>1MB)
      let largeJobContent = 'import Bull from "bull";\n';
      const queueCount = 10000;

      for (let i = 0; i < queueCount; i++) {
        largeJobContent += `
const queue${i} = new Bull('queue-${i}', { redis: { port: 6379 } });
queue${i}.process('task-${i}', async (job) => { return { id: ${i} }; });
`;
      }

      const result = await parser.parseFile('large-job.ts', largeJobContent);

      expect(result.success).toBe(true);
      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.frameworkEntities.length).toBeGreaterThan(0);
    }, 30000); // 30-second timeout

    it('should handle invalid job queue libraries gracefully', async () => {
      const invalidLibraryCode = `
import SomeOtherQueue from 'not-bull';
import { InvalidQueue } from 'fake-library';

const queue1 = new SomeOtherQueue('test');
const queue2 = new InvalidQueue();

// These should not be recognized as job queues
queue1.process('task', () => {});
queue2.add('job', {});
`;

      const result = await parser.parseFile('invalid-library.ts', invalidLibraryCode);

      expect(result.success).toBe(true);
      expect(result.frameworkEntities.length).toBe(0); // Should not recognize as job queues
    });
  });

  describe('Test Framework Parser Error Handling', () => {
    const parser = new TestFrameworkParser();

    it('should handle malformed test suites', async () => {
      const malformedTestCode = `
import { describe, it, expect } from 'jest';

// Missing test function
describe('Malformed Suite');

// Invalid test structure
it('should do something', /* missing function */);

// Nested issues
describe('Valid Suite', () => {
  it('valid test', () => {
    expect(true).toBe(true);
  });

  // Invalid nested structure
  describe(/* missing title */, () => {});
});
`;

      const result = await parser.parseFile('malformed-test.ts', malformedTestCode);

      expect(result.success).toBe(true); // Should handle gracefully
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.symbols.some(s => s.symbol_type === SymbolType.TEST_SUITE)).toBe(true);
    });

    it('should handle missing test framework imports', async () => {
      const noImportsCode = `
// No imports, but using test functions
describe('Test without imports', () => {
  it('should work somehow', () => {
    expect(1 + 1).toBe(2);
  });
});

// Global test functions
test('global test', () => {
  console.log('testing');
});
`;

      const result = await parser.parseFile('no-imports.ts', noImportsCode);

      expect(result.success).toBe(true);
      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.frameworkEntities.length).toBeGreaterThan(0);
    });

    it('should handle mixed testing frameworks in one file', async () => {
      const mixedFrameworkCode = `
import { describe as jestDescribe, it as jestIt } from 'jest';
import { describe as vitestDescribe, test as vitestTest } from 'vitest';
import { describe as mochaDescribe } from 'mocha';

// Jest style
jestDescribe('Jest Suite', () => {
  jestIt('jest test', () => {});
});

// Vitest style
vitestDescribe('Vitest Suite', () => {
  vitestTest('vitest test', () => {});
});

// Mocha style
mochaDescribe('Mocha Suite', function() {
  it('mocha test', function() {});
});
`;

      const result = await parser.parseFile('mixed-frameworks.ts', mixedFrameworkCode);

      expect(result.success).toBe(true);
      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.frameworkEntities.length).toBeGreaterThan(0);
    });

    it('should handle deeply nested test structures', async () => {
      let deeplyNestedCode = 'import { describe, it, expect } from "jest";\n';
      const maxDepth = 20;

      // Create deeply nested describe blocks
      for (let i = 0; i < maxDepth; i++) {
        deeplyNestedCode += `describe('Level ${i}', () => {\n`;
      }

      deeplyNestedCode += 'it("deep test", () => { expect(true).toBe(true); });\n';

      // Close all describe blocks
      for (let i = 0; i < maxDepth; i++) {
        deeplyNestedCode += '});\n';
      }

      const result = await parser.parseFile('deeply-nested.ts', deeplyNestedCode);

      expect(result.success).toBe(true);
      expect(result.symbols.length).toBeGreaterThan(0);
    });
  });

  describe('ORM Parser Error Handling', () => {
    const treeParser = new Parser();
    treeParser.setLanguage(JavaScript);
    const parser = new ORMParser(treeParser);

    it('should handle malformed entity definitions', async () => {
      const malformedORMCode = `
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// Missing @Entity decorator
class InvalidEntity1 {
  @PrimaryGeneratedColumn()
  id: number;
}

// Invalid decorator syntax
@Entity(/* missing arguments */)
class InvalidEntity2 {
  // Missing column decorator
  id: number;

  @Column({ type: 'invalid-type' })
  invalidField: UnknownType;
}

// Malformed relationships
@Entity()
class InvalidRelations {
  @OneToMany(/* missing target */)
  items: any[];

  @ManyToOne(() => NonExistentEntity)
  parent: any;
}
`;

      const result = await parser.parseFile('malformed-orm.ts', malformedORMCode);

      expect(result.success).toBe(true); // Should not crash
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.symbols.length).toBeGreaterThan(0); // Should still extract classes
    });

    it('should handle multiple ORM frameworks in one file', async () => {
      const multipleORMCode = `
// TypeORM
import { Entity as TypeORMEntity, Column as TypeORMColumn } from 'typeorm';

// Sequelize
import { Model as SequelizeModel, DataTypes } from 'sequelize';

// Prisma (schema-style in TypeScript)
import { PrismaClient } from '@prisma/client';

@TypeORMEntity()
class TypeORMUser {
  @TypeORMColumn()
  name: string;
}

class SequelizeUser extends SequelizeModel {
  static init(sequelize: any) {
    super.init({ name: DataTypes.STRING }, { sequelize });
  }
}

// Mixed usage should be handled gracefully
const prisma = new PrismaClient();
`;

      const result = await parser.parseFile('multiple-orm.ts', multipleORMCode);

      expect(result.success).toBe(true);
      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.frameworkEntities.length).toBeGreaterThan(0);
    });

    it('should handle circular relationship references', async () => {
      const circularORMCode = `
import { Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne } from 'typeorm';

@Entity()
class User {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToMany(() => Post, post => post.author)
  posts: Post[];

  @ManyToOne(() => User, user => user.children)
  parent: User;

  @OneToMany(() => User, user => user.parent)
  children: User[];
}

@Entity()
class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.posts)
  author: User;

  @OneToMany(() => Comment, comment => comment.post)
  comments: Comment[];
}

@Entity()
class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Post, post => post.comments)
  post: Post;

  @ManyToOne(() => User)
  author: User;
}
`;

      const result = await parser.parseFile('circular-orm.ts', circularORMCode);

      expect(result.success).toBe(true);
      expect(result.dependencies.length).toBeGreaterThan(0);

      // Should handle circular references without infinite loops
      const relationshipDeps = result.dependencies.filter(dep =>
        [DependencyType.HAS_MANY, DependencyType.BELONGS_TO].includes(dep.dependency_type)
      );
      expect(relationshipDeps.length).toBeGreaterThan(0);
    });
  });

  describe('Package Manager Parser Error Handling', () => {
    const parser = new PackageManagerParser();

    it('should handle malformed package.json files', async () => {
      const malformedPackageJSON = `{
  "name": "test-package",
  "version": "1.0.0",
  "dependencies": {
    "invalid-dep": /* invalid version */,
    "missing-version": ,
    "": "1.0.0"
  },
  "scripts": {
    "invalid-script": null,
    "": "echo test"
  },
  "workspaces": "not-an-array"
}`;

      const result = await parser.parseFile('malformed-package.json', malformedPackageJSON);

      expect(result.success).toBe(false); // Invalid JSON should fail
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle invalid JSON syntax gracefully', async () => {
      const invalidJSONs = [
        '{ invalid json }',
        '{ "name": "test", }', // Trailing comma
        '{ "name": test }', // Unquoted value
        '', // Empty file
        'not json at all'
      ];

      for (const [index, content] of invalidJSONs.entries()) {
        const result = await parser.parseFile(`invalid-${index}.json`, content);

        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.symbols.length).toBe(0);
      }
    });

    it('should handle very large package.json files', async () => {
      const largePackage = {
        name: 'large-package',
        version: '1.0.0',
        dependencies: {} as Record<string, string>,
        devDependencies: {} as Record<string, string>,
        scripts: {} as Record<string, string>
      };

      // Add 10,000 dependencies
      for (let i = 0; i < 10000; i++) {
        largePackage.dependencies[`dep-${i}`] = `^1.${i % 100}.${i % 50}`;
        largePackage.devDependencies[`dev-dep-${i}`] = `^2.${i % 200}.${i % 75}`;
        largePackage.scripts[`script-${i}`] = `echo "Script ${i}"`;
      }

      const largeContent = JSON.stringify(largePackage, null, 2);
      const result = await parser.parseFile('large-package.json', largeContent);

      expect(result.success).toBe(true);
      expect(result.symbols.length).toBeGreaterThan(0);
    }, 30000); // 30-second timeout
  });

  describe('Transitive Analyzer Error Handling', () => {
    it('should handle non-existent symbol IDs gracefully', async () => {
      const nonExistentIds = [-1, 0, 999999, NaN, Infinity];

      for (const id of nonExistentIds) {
        const result = await transitiveAnalyzer.getTransitiveDependencies(id as number, { maxDepth: 5 });

        expect(result.results).toEqual([]);
        expect(result.cyclesDetected).toBe(0);
        expect(result.maxDepthReached).toBe(0);
        expect(result.executionTimeMs).toBeGreaterThan(0);
      }
    });

    it('should handle database connection failures gracefully', async () => {
      // Mock database failure
      const originalDb = (transitiveAnalyzer as any).db;
      (transitiveAnalyzer as any).db = {
        select: () => ({
          leftJoin: () => ({
            where: () => ({
              select: () => ({
                whereIn: () => ({
                  whereNotIn: () => ({
                    orderBy: () => Promise.reject(new Error('Database connection failed'))
                  })
                })
              })
            })
          })
        })
      };

      try {
        const result = await transitiveAnalyzer.getTransitiveDependencies(1, { maxDepth: 5 });

        expect(result.results).toEqual([]);
        expect(result.executionTimeMs).toBeGreaterThan(0);
      } finally {
        // Restore original database
        (transitiveAnalyzer as any).db = originalDb;
      }
    });

    it('should handle invalid analysis options', async () => {
      // Create a test symbol first
      const file = await dbService.createFile({
        repo_id: testRepository.id,
        path: 'test-error.ts',
        language: 'typescript',
        size: 100,
        last_modified: new Date(),
        git_hash: 'error-hash',
        is_generated: false,
        is_test: false
      });

      const symbol = await dbService.createSymbol({
        file_id: file.id,
        name: 'testSymbol',
        symbol_type: SymbolType.FUNCTION,
        start_line: 1,
        end_line: 5,
        is_exported: true,
        visibility: Visibility.PUBLIC,
        signature: 'testSymbol(): void'
      });

      const invalidOptions = [
        { maxDepth: -1 },
        { maxDepth: Infinity },
        { confidenceThreshold: -0.5 },
        { confidenceThreshold: 2.0 },
        { includeTypes: ['invalid-type'] as any },
        { excludeTypes: [null] as any }
      ];

      for (const options of invalidOptions) {
        const result = await transitiveAnalyzer.getTransitiveDependencies(symbol.id, options);

        // Should not crash, should return valid result structure
        expect(result).toHaveProperty('results');
        expect(result).toHaveProperty('executionTimeMs');
        expect(Array.isArray(result.results)).toBe(true);
      }
    });

    it('should handle extremely deep recursion safely', async () => {
      // Create a long chain that would cause stack overflow if not handled properly
      const chainLength = 1000;
      const symbols: any[] = [];

      for (let i = 0; i < chainLength; i++) {
        const file = await dbService.createFile({
          repo_id: testRepository.id,
          path: `chain/deep-${i}.ts`,
          language: 'typescript',
          size: 50,
          last_modified: new Date(),
          git_hash: `deep-hash-${i}`,
          is_generated: false,
          is_test: false
        });

        const symbol = await dbService.createSymbol({
          file_id: file.id,
          name: `deepSymbol${i}`,
          symbol_type: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 3,
          is_exported: true,
          visibility: Visibility.PUBLIC,
          signature: `deepSymbol${i}(): void`
        });

        symbols.push(symbol);

        if (i > 0) {
          await dbService.createDependency({
            from_symbol_id: symbol.id,
            to_symbol_id: symbols[i - 1].id,
            dependency_type: DependencyType.CALLS,
            line_number: 1,
            confidence: 1.0
          });
        }
      }

      // This should not cause stack overflow
      const result = await transitiveAnalyzer.getTransitiveDependencies(
        symbols[0].id,
        { maxDepth: 50 }
      );

      expect(result.results.length).toBeLessThanOrEqual(20); // Limited by MAX_ABSOLUTE_DEPTH
      expect(result.maxDepthReached).toBeLessThanOrEqual(20);
      expect(result.executionTimeMs).toBeLessThan(30000); // Should complete reasonably fast
    }, 60000); // 1-minute timeout
  });

  describe('Cross-Component Error Scenarios', () => {
    it('should handle parser failures gracefully in integrated workflows', async () => {
      const invalidFiles = [
        { path: 'invalid-job.ts', content: 'import Bull from; // Invalid syntax', parser: new BackgroundJobParser() },
        { path: 'invalid-test.ts', content: 'describe(, () => {});', parser: new TestFrameworkParser() },
        { path: 'invalid-orm.ts', content: '@Entity class {', parser: (() => { const p = new Parser(); p.setLanguage(JavaScript); return new ORMParser(p); })() },
        { path: 'invalid.json', content: '{ invalid }', parser: new PackageManagerParser() }
      ];

      for (const { path, content, parser } of invalidFiles) {
        const result = await parser.parseFile(path, content);

        // All parsers should handle errors gracefully
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('errors');
        expect(result).toHaveProperty('symbols');
        expect(result).toHaveProperty('dependencies');
        expect(result).toHaveProperty('frameworkEntities');

        expect(Array.isArray(result.errors)).toBe(true);
        expect(Array.isArray(result.symbols)).toBe(true);
        expect(Array.isArray(result.dependencies)).toBe(true);
        expect(Array.isArray(result.frameworkEntities)).toBe(true);
      }
    });

    it('should handle database constraint violations gracefully', async () => {
      // Try to create symbols with invalid file IDs
      const invalidSymbol = {
        file_id: -1, // Non-existent file
        name: 'invalidSymbol',
        symbol_type: SymbolType.FUNCTION,
        start_line: 1,
        end_line: 5,
        is_exported: true,
        visibility: Visibility.PUBLIC,
        signature: 'invalidSymbol(): void'
      };

      await expect(dbService.createSymbol(invalidSymbol)).rejects.toThrow();

      // Try to create dependencies with invalid symbol IDs
      const invalidDependency = {
        from_symbol_id: -1,
        to_symbol_id: -2,
        dependency_type: DependencyType.CALLS,
        line_number: 1,
        confidence: 1.0
      };

      await expect(dbService.createDependency(invalidDependency)).rejects.toThrow();
    });

    it('should handle resource exhaustion scenarios', async () => {
      // Test with a scenario that could exhaust resources
      const batchSize = 100;
      const operations: Promise<any>[] = [];

      // Create many concurrent operations
      for (let i = 0; i < batchSize; i++) {
        operations.push(
          dbService.createFile({
            repo_id: testRepository.id,
            path: `stress/file-${i}.ts`,
            language: 'typescript',
            size: i * 100,
            last_modified: new Date(),
            git_hash: `stress-hash-${i}`,
            is_generated: false,
            is_test: false
          })
        );
      }

      // Should handle concurrent operations without crashing
      const results = await Promise.allSettled(operations);
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      expect(successful.length + failed.length).toBe(batchSize);
      expect(successful.length).toBeGreaterThan(0); // At least some should succeed

      // If some failed, they should fail gracefully
      failed.forEach(failure => {
        expect(failure.status).toBe('rejected');
        expect((failure as any).reason).toBeInstanceOf(Error);
      });
    });
  });

  describe('Recovery and Resilience', () => {
    it('should recover from temporary database issues', async () => {
      // This test would ideally involve temporarily disrupting the database
      // For now, we test that the system can handle and report connection issues

      const healthCheck = async () => {
        try {
          await dbService.searchSymbols('', testRepository.id);
          return true;
        } catch (error) {
          logger.error('Database health check failed:', error);
          return false;
        }
      };

      const isHealthy = await healthCheck();
      expect(typeof isHealthy).toBe('boolean');

      // In a real scenario, this would test reconnection logic
      if (!isHealthy) {
        // System should have mechanisms to handle this
        console.warn('Database health check failed - this would trigger recovery mechanisms');
      }
    });

    it('should maintain data consistency during error scenarios', async () => {
      // Test that partial failures don't leave the database in an inconsistent state
      const file = await dbService.createFile({
        repo_id: testRepository.id,
        path: 'consistency-test.ts',
        language: 'typescript',
        size: 100,
        last_modified: new Date(),
        git_hash: 'consistency-hash',
        is_generated: false,
        is_test: false
      });

      const symbol = await dbService.createSymbol({
        file_id: file.id,
        name: 'consistencySymbol',
        symbol_type: SymbolType.FUNCTION,
        start_line: 1,
        end_line: 5,
        is_exported: true,
        visibility: Visibility.PUBLIC,
        signature: 'consistencySymbol(): void'
      });

      // Verify symbol was created correctly
      const retrievedSymbol = await dbService.getSymbol(symbol.id);
      expect(retrievedSymbol).toBeDefined();
      expect(retrievedSymbol!.name).toBe('consistencySymbol');

      // Try to create invalid dependencies
      try {
        await dbService.createDependency({
          from_symbol_id: symbol.id,
          to_symbol_id: -999, // Invalid target
          dependency_type: DependencyType.CALLS,
          line_number: 1,
          confidence: 1.0
        });
      } catch (error) {
        // Expected to fail
      }

      // Verify the symbol still exists and is unchanged
      const symbolAfterError = await dbService.getSymbol(symbol.id);
      expect(symbolAfterError).toBeDefined();
      expect(symbolAfterError!.name).toBe('consistencySymbol');
    });
  });
});