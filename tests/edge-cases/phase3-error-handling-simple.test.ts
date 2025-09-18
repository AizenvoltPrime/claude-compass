import { DatabaseService } from '../../src/database/services';
import { TransitiveAnalyzer } from '../../src/graph/transitive-analyzer';
import { Repository, SymbolType, DependencyType, Visibility } from '../../src/database/models';

/**
 * Simplified Error Handling Tests for Phase 3
 * Focus on core functionality without complex parser testing
 */
describe('Phase 3 Error Handling (Simplified)', () => {
  let dbService: DatabaseService;
  let transitiveAnalyzer: TransitiveAnalyzer;
  let testRepository: Repository;

  beforeAll(async () => {
    dbService = new DatabaseService();
    transitiveAnalyzer = new TransitiveAnalyzer();

    testRepository = await dbService.createRepository({
      name: 'phase3-error-test-simple',
      path: '/tmp/error-test-simple',
      language_primary: 'typescript',
      framework_stack: ['node'],
      last_indexed: new Date(),
      git_hash: 'error-test-hash-simple'
    });
  });

  afterAll(async () => {
    if (testRepository) {
      await dbService.deleteRepositoryCompletely(testRepository.id);
    }
    await dbService.close();
  });

  describe('Transitive Analyzer Error Handling', () => {
    it('should handle non-existent symbol IDs gracefully', async () => {
      const nonExistentIds = [-1, 0, 999999];

      for (const id of nonExistentIds) {
        const result = await transitiveAnalyzer.getTransitiveDependencies(id, { maxDepth: 5 });

        expect(result.results).toEqual([]);
        expect(result.cyclesDetected).toBe(0);
        expect(result.maxDepthReached).toBe(0);
        expect(result.executionTimeMs).toBeGreaterThan(0);
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
        { confidenceThreshold: -0.5 },
        { confidenceThreshold: 2.0 }
      ];

      for (const options of invalidOptions) {
        const result = await transitiveAnalyzer.getTransitiveDependencies(symbol.id, options);

        // Should not crash, should return valid result structure
        expect(result).toHaveProperty('results');
        expect(result).toHaveProperty('executionTimeMs');
        expect(Array.isArray(result.results)).toBe(true);
      }
    });

    it('should handle cycles in dependency graphs', async () => {
      // Create symbols that form a cycle
      const file1 = await dbService.createFile({
        repo_id: testRepository.id,
        path: 'cycle1.ts',
        language: 'typescript',
        size: 100,
        last_modified: new Date(),
        git_hash: 'cycle-hash-1',
        is_generated: false,
        is_test: false
      });

      const file2 = await dbService.createFile({
        repo_id: testRepository.id,
        path: 'cycle2.ts',
        language: 'typescript',
        size: 100,
        last_modified: new Date(),
        git_hash: 'cycle-hash-2',
        is_generated: false,
        is_test: false
      });

      const symbol1 = await dbService.createSymbol({
        file_id: file1.id,
        name: 'symbolA',
        symbol_type: SymbolType.FUNCTION,
        start_line: 1,
        end_line: 5,
        is_exported: true,
        visibility: Visibility.PUBLIC,
        signature: 'symbolA(): void'
      });

      const symbol2 = await dbService.createSymbol({
        file_id: file2.id,
        name: 'symbolB',
        symbol_type: SymbolType.FUNCTION,
        start_line: 1,
        end_line: 5,
        is_exported: true,
        visibility: Visibility.PUBLIC,
        signature: 'symbolB(): void'
      });

      // Create circular dependencies: A -> B -> A
      await dbService.createDependency({
        from_symbol_id: symbol1.id,
        to_symbol_id: symbol2.id,
        dependency_type: DependencyType.CALLS,
        line_number: 1,
        confidence: 1.0
      });

      await dbService.createDependency({
        from_symbol_id: symbol2.id,
        to_symbol_id: symbol1.id,
        dependency_type: DependencyType.CALLS,
        line_number: 1,
        confidence: 1.0
      });

      const result = await transitiveAnalyzer.getTransitiveDependencies(symbol1.id, { maxDepth: 5 });

      expect(result.cyclesDetected).toBeGreaterThan(0);
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.executionTimeMs).toBeLessThan(5000);
    });

    it('should respect depth limits', async () => {
      const chainLength = 10;
      const symbols: any[] = [];

      // Create a chain of dependencies
      for (let i = 0; i < chainLength; i++) {
        const file = await dbService.createFile({
          repo_id: testRepository.id,
          path: `chain/symbol${i}.ts`,
          language: 'typescript',
          size: 50,
          last_modified: new Date(),
          git_hash: `chain-hash-${i}`,
          is_generated: false,
          is_test: false
        });

        const symbol = await dbService.createSymbol({
          file_id: file.id,
          name: `chainSymbol${i}`,
          symbol_type: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 3,
          is_exported: true,
          visibility: Visibility.PUBLIC,
          signature: `chainSymbol${i}(): void`
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

      // Test with limited depth
      const result = await transitiveAnalyzer.getTransitiveDependencies(
        symbols[0].id,
        { maxDepth: 3 }
      );

      expect(result.maxDepthReached).toBeLessThanOrEqual(3);
      expect(result.results.every(r => r.depth <= 3)).toBe(true);
    });
  });

  describe('Database Error Handling', () => {
    it('should handle constraint violations gracefully', async () => {
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

  describe('Performance Edge Cases', () => {
    it('should handle multiple concurrent operations', async () => {
      const operationCount = 50;
      const operations: Promise<any>[] = [];

      // Create many concurrent file operations
      for (let i = 0; i < operationCount; i++) {
        operations.push(
          dbService.createFile({
            repo_id: testRepository.id,
            path: `concurrent/file-${i}.ts`,
            language: 'typescript',
            size: i * 10,
            last_modified: new Date(),
            git_hash: `concurrent-hash-${i}`,
            is_generated: false,
            is_test: false
          })
        );
      }

      // Should handle concurrent operations without crashing
      const results = await Promise.allSettled(operations);
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      expect(successful.length + failed.length).toBe(operationCount);
      expect(successful.length).toBeGreaterThan(0); // At least some should succeed

      // Log any failures for debugging
      if (failed.length > 0) {
        console.log(`${failed.length} concurrent operations failed (this may be expected under high load)`);
      }
    });

    it('should complete transitive analysis within reasonable time', async () => {
      // Create a moderately complex dependency graph
      const nodeCount = 20;
      const symbols: any[] = [];

      // Create symbols
      for (let i = 0; i < nodeCount; i++) {
        const file = await dbService.createFile({
          repo_id: testRepository.id,
          path: `perf/node${i}.ts`,
          language: 'typescript',
          size: 500,
          last_modified: new Date(),
          git_hash: `perf-hash-${i}`,
          is_generated: false,
          is_test: false
        });

        const symbol = await dbService.createSymbol({
          file_id: file.id,
          name: `perfNode${i}`,
          symbol_type: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 5,
          is_exported: true,
          visibility: Visibility.PUBLIC,
          signature: `perfNode${i}(): void`
        });

        symbols.push(symbol);
      }

      // Create dependencies (each node depends on the next 2-3 nodes)
      for (let i = 0; i < nodeCount; i++) {
        const dependencyCount = Math.min(3, nodeCount - i - 1);
        for (let j = 1; j <= dependencyCount; j++) {
          const targetIndex = (i + j) % nodeCount;

          try {
            await dbService.createDependency({
              from_symbol_id: symbols[i].id,
              to_symbol_id: symbols[targetIndex].id,
              dependency_type: DependencyType.CALLS,
              line_number: j,
              confidence: 0.8
            });
          } catch (error) {
            // Ignore duplicate dependencies
          }
        }
      }

      // Test transitive analysis performance
      const startTime = Date.now();
      const result = await transitiveAnalyzer.getTransitiveDependencies(
        symbols[0].id,
        { maxDepth: 5 }
      );
      const endTime = Date.now();

      const duration = endTime - startTime;

      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.executionTimeMs).toBeLessThan(5000);

      console.log(`Transitive analysis of ${nodeCount} nodes completed in ${duration}ms`);
    });
  });
});