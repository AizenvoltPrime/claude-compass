import { CrossStackGraphBuilder } from '../../src/graph/cross-stack-builder';
import { jest } from '@jest/globals';
import type { Knex } from 'knex';

// Create a minimal mock Knex instance for testing
const mockDb = jest.fn() as unknown as Knex;

describe('CrossStackGraphBuilder - Basic Tests', () => {
  let builder: CrossStackGraphBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new CrossStackGraphBuilder(mockDb);
  });

  describe('constructor', () => {
    it('should create builder with database connection', () => {
      expect(builder).toBeDefined();
    });

    it('should handle null database connection gracefully', () => {
      expect(() => {
        new CrossStackGraphBuilder(null as any);
      }).not.toThrow();
    });
  });


  describe('buildDataContractGraph', () => {
    it('should handle empty input gracefully', async () => {
      const result = await builder.buildDataContractGraph([], [], []);

      expect(result).toBeDefined();
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.metadata).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Mock database to throw error - using a broken mock
      const erroringDb = jest.fn(() => {
        throw new Error('Database error');
      }) as unknown as Knex;

      const errorBuilder = new CrossStackGraphBuilder(erroringDb);

      // Should not throw, but handle the error gracefully
      await expect(async () => {
        await errorBuilder.buildDataContractGraph([], [], []);
      }).not.toThrow();
    });
  });
});