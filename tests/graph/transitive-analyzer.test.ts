import { TransitiveAnalyzer } from '../../src/graph/transitive-analyzer';
import { DependencyType } from '../../src/database/models';
import { getDatabaseConnection } from '../../src/database/connection';

// Mock the database connection
jest.mock('../../src/database/connection');
const mockDb = {
  select: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  whereIn: jest.fn().mockReturnThis(),
  whereNotIn: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  then: jest.fn()
};

(getDatabaseConnection as jest.Mock).mockReturnValue(mockDb);

/**
 * Comprehensive unit tests for TransitiveAnalyzer
 * Tests edge cases, cycle detection, confidence propagation, and error handling
 */
describe('TransitiveAnalyzer', () => {
  let analyzer: TransitiveAnalyzer;

  beforeEach(() => {
    analyzer = new TransitiveAnalyzer();
    jest.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with correct default values', () => {
      expect(analyzer).toBeDefined();
      expect(analyzer.getCacheStats().size).toBe(0);
    });

    it('should enforce maximum absolute depth limit', async () => {
      mockDb.then.mockResolvedValue([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 50 });

      // Should not exceed MAX_ABSOLUTE_DEPTH of 20
      expect(result.maxDepthReached).toBeLessThanOrEqual(20);
    });
  });

  describe('Cycle Detection', () => {
    it('should detect simple cycles in caller traversal', async () => {
      // Mock a simple cycle: A -> B -> A
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 2,
          to_symbol_id: 1,
          dependency_type: 'calls',
          confidence: 1.0,
          from_symbol_name: 'symbolB',
          from_symbol_type: 'function',
          from_file_path: '/test/b.js',
          to_symbol_name: 'symbolA',
          to_symbol_type: 'function',
          to_file_path: '/test/a.js'
        }])
        .mockResolvedValueOnce([{
          id: 2,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: 1.0,
          from_symbol_name: 'symbolA',
          from_symbol_type: 'function',
          from_file_path: '/test/a.js',
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        }]);

      const result = await analyzer.getTransitiveCallers(1, { maxDepth: 5 });

      expect(result.cyclesDetected).toBeGreaterThan(0);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should detect complex cycles in dependency traversal', async () => {
      // Mock a complex cycle: A -> B -> C -> A
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        }])
        .mockResolvedValueOnce([{
          id: 2,
          from_symbol_id: 2,
          to_symbol_id: 3,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolC',
          to_symbol_type: 'function',
          to_file_path: '/test/c.js'
        }])
        .mockResolvedValueOnce([{
          id: 3,
          from_symbol_id: 3,
          to_symbol_id: 1,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolA',
          to_symbol_type: 'function',
          to_file_path: '/test/a.js'
        }]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 10 });

      expect(result.cyclesDetected).toBeGreaterThan(0);
    });

    it('should handle self-referencing symbols', async () => {
      // Mock self-reference: A -> A
      mockDb.then.mockResolvedValue([{
        id: 1,
        from_symbol_id: 1,
        to_symbol_id: 1,
        dependency_type: 'calls',
        confidence: 1.0,
        to_symbol_name: 'symbolA',
        to_symbol_type: 'function',
        to_file_path: '/test/a.js'
      }]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      expect(result.cyclesDetected).toBeGreaterThan(0);
      expect(result.results.length).toBe(1); // Should include the self-reference once
    });
  });

  describe('Confidence Score Propagation', () => {
    it('should propagate confidence scores correctly through dependency chain', async () => {
      // Mock a chain with decreasing confidence: A (1.0) -> B (0.8) -> C (0.6)
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: 0.8,
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        }])
        .mockResolvedValueOnce([{
          id: 2,
          from_symbol_id: 2,
          to_symbol_id: 3,
          dependency_type: 'calls',
          confidence: 0.6,
          to_symbol_name: 'symbolC',
          to_symbol_type: 'function',
          to_file_path: '/test/c.js'
        }])
        .mockResolvedValueOnce([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      expect(result.results).toHaveLength(2);
      expect(result.results[0].totalConfidence).toBe(0.8); // A -> B
      expect(result.results[1].totalConfidence).toBe(0.48); // A -> B -> C (0.8 * 0.6)
    });

    it('should respect confidence threshold filtering', async () => {
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: 0.05, // Below default threshold of 0.1
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        }])
        .mockResolvedValueOnce([]);

      const result = await analyzer.getTransitiveDependencies(1, {
        maxDepth: 5,
        confidenceThreshold: 0.1
      });

      // Should not traverse further due to low confidence
      expect(result.results).toHaveLength(1);
      expect(result.results[0].totalConfidence).toBe(0.05);
    });

    it('should handle missing confidence scores by defaulting to 1.0', async () => {
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: null, // Missing confidence
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        }])
        .mockResolvedValueOnce([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].totalConfidence).toBe(1.0);
    });
  });

  describe('Depth Limiting', () => {
    it('should respect maxDepth parameter', async () => {
      // Mock a deep chain
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        }])
        .mockResolvedValueOnce([{
          id: 2,
          from_symbol_id: 2,
          to_symbol_id: 3,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolC',
          to_symbol_type: 'function',
          to_file_path: '/test/c.js'
        }])
        .mockResolvedValueOnce([{
          id: 3,
          from_symbol_id: 3,
          to_symbol_id: 4,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolD',
          to_symbol_type: 'function',
          to_file_path: '/test/d.js'
        }])
        .mockResolvedValueOnce([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 2 });

      expect(result.maxDepthReached).toBeLessThanOrEqual(2);
      expect(result.results.every(r => r.depth <= 2)).toBe(true);
    });

    it('should correctly track maximum depth reached', async () => {
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        }])
        .mockResolvedValueOnce([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      expect(result.maxDepthReached).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].depth).toBe(1);
    });
  });

  describe('Dependency Type Filtering', () => {
    it('should filter by included dependency types', async () => {
      mockDb.then.mockResolvedValue([]);

      await analyzer.getTransitiveDependencies(1, {
        includeTypes: [DependencyType.CALLS, DependencyType.IMPORTS]
      });

      expect(mockDb.whereIn).toHaveBeenCalledWith(
        'dependencies.dependency_type',
        [DependencyType.CALLS, DependencyType.IMPORTS]
      );
    });

    it('should filter by excluded dependency types', async () => {
      mockDb.then.mockResolvedValue([]);

      await analyzer.getTransitiveDependencies(1, {
        excludeTypes: [DependencyType.TEST_COVERS]
      });

      expect(mockDb.whereNotIn).toHaveBeenCalledWith(
        'dependencies.dependency_type',
        [DependencyType.TEST_COVERS]
      );
    });

    it('should apply both include and exclude filters', async () => {
      mockDb.then.mockResolvedValue([]);

      await analyzer.getTransitiveDependencies(1, {
        includeTypes: [DependencyType.CALLS, DependencyType.IMPORTS],
        excludeTypes: [DependencyType.TEST_COVERS]
      });

      expect(mockDb.whereIn).toHaveBeenCalledWith(
        'dependencies.dependency_type',
        [DependencyType.CALLS, DependencyType.IMPORTS]
      );
      expect(mockDb.whereNotIn).toHaveBeenCalledWith(
        'dependencies.dependency_type',
        [DependencyType.TEST_COVERS]
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDb.then.mockRejectedValue(new Error('Database connection failed'));

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      // Should return empty results without throwing
      expect(result.results).toEqual([]);
      expect(result.cyclesDetected).toBe(0);
      expect(result.maxDepthReached).toBe(0);
    });

    it('should handle malformed database results', async () => {
      // Mock malformed data without required fields
      mockDb.then.mockResolvedValue([{
        id: 1,
        // Missing symbol references
        dependency_type: 'calls',
        confidence: 1.0
      }]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      // Should handle gracefully without throwing
      expect(result.results).toEqual([]);
    });

    it('should handle invalid symbol IDs', async () => {
      mockDb.then.mockResolvedValue([]);

      const result = await analyzer.getTransitiveDependencies(-1, { maxDepth: 5 });

      expect(result.results).toEqual([]);
      expect(result.totalPaths).toBe(0);
    });

    it('should handle null/undefined options', async () => {
      mockDb.then.mockResolvedValue([]);

      const result = await analyzer.getTransitiveDependencies(1, null as any);

      expect(result).toBeDefined();
      expect(result.results).toEqual([]);
    });
  });

  describe('Performance Tracking', () => {
    it('should track execution time', async () => {
      mockDb.then.mockResolvedValue([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      expect(result.executionTimeMs).toBeDefined();
      expect(typeof result.executionTimeMs).toBe('number');
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    it('should track total paths correctly', async () => {
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        }])
        .mockResolvedValueOnce([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      expect(result.totalPaths).toBe(result.results.length);
      expect(result.totalPaths).toBe(1);
    });
  });

  describe('Cache Management', () => {
    it('should provide cache statistics', () => {
      const stats = analyzer.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('keys');
      expect(Array.isArray(stats.keys)).toBe(true);
    });

    it('should clear cache correctly', () => {
      analyzer.clearCache();
      const stats = analyzer.getCacheStats();

      expect(stats.size).toBe(0);
      expect(stats.keys).toEqual([]);
    });
  });

  describe('Path Tracking', () => {
    it('should correctly track dependency paths', async () => {
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        }])
        .mockResolvedValueOnce([{
          id: 2,
          from_symbol_id: 2,
          to_symbol_id: 3,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolC',
          to_symbol_type: 'function',
          to_file_path: '/test/c.js'
        }])
        .mockResolvedValueOnce([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      expect(result.results).toHaveLength(2);
      expect(result.results[0].path).toEqual([]);
      expect(result.results[1].path).toEqual([1]);
    });

    it('should track paths in caller analysis', async () => {
      mockDb.then
        .mockResolvedValueOnce([{
          id: 1,
          from_symbol_id: 3,
          to_symbol_id: 1,
          dependency_type: 'calls',
          confidence: 1.0,
          from_symbol_name: 'symbolC',
          from_symbol_type: 'function',
          from_file_path: '/test/c.js'
        }])
        .mockResolvedValueOnce([]);

      const result = await analyzer.getTransitiveCallers(1, { maxDepth: 5 });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].path).toEqual([]);
      expect(result.results[0].symbolId).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty database results', async () => {
      mockDb.then.mockResolvedValue([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      expect(result.results).toEqual([]);
      expect(result.maxDepthReached).toBe(0);
      expect(result.totalPaths).toBe(0);
      expect(result.cyclesDetected).toBe(0);
    });

    it('should handle zero maxDepth', async () => {
      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 0 });

      expect(result.results).toEqual([]);
      expect(result.maxDepthReached).toBe(0);
    });

    it('should handle zero confidence threshold', async () => {
      mockDb.then.mockResolvedValue([{
        id: 1,
        from_symbol_id: 1,
        to_symbol_id: 2,
        dependency_type: 'calls',
        confidence: 0.0,
        to_symbol_name: 'symbolB',
        to_symbol_type: 'function',
        to_file_path: '/test/b.js'
      }]);

      const result = await analyzer.getTransitiveDependencies(1, {
        maxDepth: 5,
        confidenceThreshold: 0.0
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].totalConfidence).toBe(0.0);
    });

    it('should handle very high confidence threshold', async () => {
      mockDb.then.mockResolvedValue([{
        id: 1,
        from_symbol_id: 1,
        to_symbol_id: 2,
        dependency_type: 'calls',
        confidence: 0.9,
        to_symbol_name: 'symbolB',
        to_symbol_type: 'function',
        to_file_path: '/test/b.js'
      }]);

      const result = await analyzer.getTransitiveDependencies(1, {
        maxDepth: 5,
        confidenceThreshold: 0.95
      });

      // Should stop traversal due to high threshold
      expect(result.results).toHaveLength(1);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle diamond dependency patterns', async () => {
      // A -> B, A -> C, B -> D, C -> D (diamond pattern)
      mockDb.then
        .mockResolvedValueOnce([
          {
            id: 1,
            from_symbol_id: 1,
            to_symbol_id: 2,
            dependency_type: 'calls',
            confidence: 1.0,
            to_symbol_name: 'symbolB',
            to_symbol_type: 'function',
            to_file_path: '/test/b.js'
          },
          {
            id: 2,
            from_symbol_id: 1,
            to_symbol_id: 3,
            dependency_type: 'calls',
            confidence: 1.0,
            to_symbol_name: 'symbolC',
            to_symbol_type: 'function',
            to_file_path: '/test/c.js'
          }
        ])
        .mockResolvedValueOnce([{
          id: 3,
          from_symbol_id: 2,
          to_symbol_id: 4,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolD',
          to_symbol_type: 'function',
          to_file_path: '/test/d.js'
        }])
        .mockResolvedValueOnce([{
          id: 4,
          from_symbol_id: 3,
          to_symbol_id: 4,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolD',
          to_symbol_type: 'function',
          to_file_path: '/test/d.js'
        }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await analyzer.getTransitiveDependencies(1, { maxDepth: 5 });

      // Should find all paths including multiple paths to the same symbol
      expect(result.results.length).toBeGreaterThanOrEqual(3);
      expect(result.maxDepthReached).toBe(2);
    });

    it('should handle mixed dependency types', async () => {
      mockDb.then.mockResolvedValue([
        {
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 2,
          dependency_type: 'calls',
          confidence: 1.0,
          to_symbol_name: 'symbolB',
          to_symbol_type: 'function',
          to_file_path: '/test/b.js'
        },
        {
          id: 2,
          from_symbol_id: 1,
          to_symbol_id: 3,
          dependency_type: 'imports',
          confidence: 0.9,
          to_symbol_name: 'symbolC',
          to_symbol_type: 'variable',
          to_file_path: '/test/c.js'
        }
      ]);

      const result = await analyzer.getTransitiveDependencies(1, {
        maxDepth: 5,
        includeTypes: [DependencyType.CALLS, DependencyType.IMPORTS]
      });

      expect(result.results).toHaveLength(2);
      expect(result.results.some(r => r.dependencies[0].dependency_type === 'calls')).toBe(true);
      expect(result.results.some(r => r.dependencies[0].dependency_type === 'imports')).toBe(true);
    });
  });
});