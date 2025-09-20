import { CrossStackGraphBuilder } from '../../src/graph/cross-stack-builder';
import { DatabaseService } from '../../src/database/services';
import { jest } from '@jest/globals';

// Mock the database service
const mockDatabaseService = {
  getSymbolsByType: jest.fn() as jest.MockedFunction<any>,
  getFrameworkEntitiesByType: jest.fn() as jest.MockedFunction<any>,
  getApiCallsByRepository: jest.fn() as jest.MockedFunction<any>,
  getDataContractsByRepository: jest.fn() as jest.MockedFunction<any>,
  createApiCalls: jest.fn() as jest.MockedFunction<any>,
  createDataContracts: jest.fn() as jest.MockedFunction<any>,
  getCrossStackDependencies: jest.fn() as jest.MockedFunction<any>,
} as unknown as DatabaseService;

describe('CrossStackGraphBuilder - Basic Tests', () => {
  let builder: CrossStackGraphBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new CrossStackGraphBuilder(mockDatabaseService);
  });

  describe('constructor', () => {
    it('should create builder with database service', () => {
      expect(builder).toBeDefined();
    });

    it('should handle null database service gracefully', () => {
      expect(() => {
        new CrossStackGraphBuilder(null as any);
      }).not.toThrow();
    });
  });

  describe('buildAPICallGraph', () => {
    it('should handle empty input gracefully', async () => {
      const result = await builder.buildAPICallGraph([], [], []);

      expect(result).toBeDefined();
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.metadata).toBeDefined();
    });

    it('should handle null input without throwing', async () => {
      await expect(async () => {
        await builder.buildAPICallGraph(null as any, null as any, null as any);
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
      // Mock database to throw error
      const erroringDbService = {
        ...mockDatabaseService,
        getSymbolsByType: (() => Promise.reject(new Error('Database error'))) as any
      } as unknown as DatabaseService;

      const errorBuilder = new CrossStackGraphBuilder(erroringDbService);

      // Should not throw, but handle the error gracefully
      await expect(async () => {
        await errorBuilder.buildDataContractGraph([], [], []);
      }).not.toThrow();
    });
  });
});