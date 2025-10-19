import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { TransitiveAnalyzer, transitiveAnalyzer } from '../../src/graph/transitive-analyzer';
import { DatabaseService } from '../../src/database/services';
import { getDatabaseConnection } from '../../src/database/connection';
import type { Knex } from 'knex';

// Mock database for testing - creates a chainable query builder mock
const createMockQueryBuilder = () => {
  const mock: any = {
    select: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    where: jest.fn(function(this: any, ...args: any[]) {
      // Handle function argument for nested where clauses
      if (typeof args[0] === 'function') {
        const nestedBuilder = createMockQueryBuilder();
        args[0].call(nestedBuilder);
      }
      return this;
    }),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    then: jest.fn((onFulfilled: Function) => Promise.resolve(onFulfilled([])))
  };
  return mock;
};

// Create specific mock for symbols table query used by resolveSymbolNames
const createSymbolsQueryMock = (testData: any[]) => {
  const mock: any = {
    leftJoin: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    select: jest.fn(function(this: any) {
      // Return a thenable that resolves with testData
      return {
        then: (onFulfilled: Function) => Promise.resolve(onFulfilled(testData))
      };
    })
  };
  return mock;
};

const mockDb = jest.fn((tableName?: string) => {
  if (tableName === 'symbols') {
    // Return a specific mock for symbols table that resolves with test data
    return createSymbolsQueryMock([]);
  }
  return createMockQueryBuilder();
}) as any;
Object.assign(mockDb, createMockQueryBuilder());

describe('Call Chain Formatting Tests', () => {
  let analyzer: TransitiveAnalyzer;

  beforeEach(() => {
    analyzer = new TransitiveAnalyzer();
    // Replace the database connection with our mock for testing
    (analyzer as any).db = mockDb;

    // Reset mocks
    jest.clearAllMocks();

    // Reset the mock database function
    mockDb.mockClear();
    const queryBuilder = createMockQueryBuilder();
    mockDb.mockReturnValue(queryBuilder);
  });

  describe('formatCallChain', () => {
    test('should format simple call chain', async () => {
      // Configure the symbols query mock with test data
      const testSymbolData = [
        { id: 1, name: '_Ready', symbol_type: 'method', signature: 'public void _Ready()', file_path: 'DeckController.cs' },
        { id: 2, name: 'InitializeServices', symbol_type: 'method', signature: 'private void InitializeServices()', file_path: 'DeckController.cs' },
        { id: 3, name: 'SetHandPositions', symbol_type: 'method', signature: 'public void SetHandPositions(Node3D, Node3D)', file_path: 'CardManager.cs' }
      ];

      mockDb.mockImplementation((tableName?: string) => {
        if (tableName === 'symbols') {
          return createSymbolsQueryMock(testSymbolData);
        }
        return createMockQueryBuilder();
      });

      const path = [1, 2, 3];
      const result = await analyzer.formatCallChain(path);

      expect(result).toBe('_Ready() → InitializeServices() → SetHandPositions() (CardManager.cs)');
    });

    test('should format call chain with comprehensive data', async () => {
      // Configure the symbols query mock with test data
      const testSymbolData = [
        { id: 1, name: '_Ready', symbol_type: 'method', signature: '', file_path: 'DeckController.cs' },
        { id: 2, name: 'InitializeServices', symbol_type: 'method', signature: '', file_path: 'DeckController.cs' }
      ];

      mockDb.mockImplementation((tableName?: string) => {
        if (tableName === 'symbols') {
          return createSymbolsQueryMock(testSymbolData);
        }
        return createMockQueryBuilder();
      });

      const path = [1, 2];
      const result = await analyzer.formatCallChain(path);

      expect(result).toBe('_Ready() → InitializeServices()');
    });

    test('should show cross-file context', async () => {
      // Configure the symbols query mock with test data having different file paths (longer path to test shortening)
      const testSymbolData = [
        { id: 1, name: 'InitializeServices', symbol_type: 'method', signature: '', file_path: 'src/Game/Controllers/DeckController.cs' },
        { id: 2, name: 'SetHandPositions', symbol_type: 'method', signature: '', file_path: 'src/Game/Managers/CardManager.cs' }
      ];

      mockDb.mockImplementation((tableName?: string) => {
        if (tableName === 'symbols') {
          return createSymbolsQueryMock(testSymbolData);
        }
        return createMockQueryBuilder();
      });

      const path = [1, 2];
      const result = await analyzer.formatCallChain(path);

      expect(result).toBe('InitializeServices() → SetHandPositions() (.../Managers/CardManager.cs)');
    });

    test('should handle class context for methods', async () => {
      // Configure the symbols query mock with test data having class information in signature
      const testSymbolData = [
        { id: 1, name: 'SetHandPositions', symbol_type: 'method', signature: 'class CardManager public void SetHandPositions()', file_path: 'CardManager.cs' }
      ];

      mockDb.mockImplementation((tableName?: string) => {
        if (tableName === 'symbols') {
          return createSymbolsQueryMock(testSymbolData);
        }
        return createMockQueryBuilder();
      });

      const path = [1];
      const result = await analyzer.formatCallChain(path);

      expect(result).toBe('CardManager.SetHandPositions()');
    });

    test('should handle non-callable symbols', async () => {
      // Configure the symbols query mock with test data having properties and variables
      const testSymbolData = [
        { id: 1, name: 'PlayerCount', symbol_type: 'property', signature: '', file_path: 'GameState.cs' },
        { id: 2, name: 'maxPlayers', symbol_type: 'variable', signature: '', file_path: 'GameState.cs' }
      ];

      mockDb.mockImplementation((tableName?: string) => {
        if (tableName === 'symbols') {
          return createSymbolsQueryMock(testSymbolData);
        }
        return createMockQueryBuilder();
      });

      const path = [1, 2];
      const result = await analyzer.formatCallChain(path);

      expect(result).toBe('PlayerCount → maxPlayers');
    });

    test('should handle empty path gracefully', async () => {
      const result = await analyzer.formatCallChain([]);
      expect(result).toBe('');
    });

    test('should handle missing symbols gracefully', async () => {
      // Configure the symbols query mock with test data having missing symbol
      const testSymbolData = [
        { id: 1, name: '_Ready', symbol_type: 'method', signature: '', file_path: 'DeckController.cs' }
        // Symbol 2 is missing
      ];

      mockDb.mockImplementation((tableName?: string) => {
        if (tableName === 'symbols') {
          return createSymbolsQueryMock(testSymbolData);
        }
        return createMockQueryBuilder();
      });

      const path = [1, 2];
      const result = await analyzer.formatCallChain(path);

      expect(result).toBe('_Ready() → Symbol(2)');
    });

    test('should handle database errors gracefully', async () => {
      // Configure the symbols query mock to reject with an error
      mockDb.mockImplementation((tableName?: string) => {
        if (tableName === 'symbols') {
          return {
            leftJoin: jest.fn().mockReturnThis(),
            whereIn: jest.fn().mockReturnThis(),
            select: jest.fn().mockRejectedValue(new Error('Database connection failed'))
          };
        }
        return createMockQueryBuilder();
      });

      const path = [1, 2, 3];
      const result = await analyzer.formatCallChain(path);

      expect(result).toBe('Call chain [1 → 2 → 3]');
    });
  });

  describe('enhanceResultsWithCallChains', () => {
    test('should enhance transitive results with call chains', async () => {
      // Configure the symbols query mock with test data
      const testSymbolData = [
        { id: 1, name: '_Ready', symbol_type: 'method', signature: '', file_path: 'DeckController.cs' },
        { id: 2, name: 'InitializeServices', symbol_type: 'method', signature: '', file_path: 'DeckController.cs' },
        { id: 3, name: 'SetHandPositions', symbol_type: 'method', signature: '', file_path: 'CardManager.cs' }
      ];

      mockDb.mockImplementation((tableName?: string) => {
        if (tableName === 'symbols') {
          return createSymbolsQueryMock(testSymbolData);
        }
        return createMockQueryBuilder();
      });

      const results = [
        {
          symbolId: 3,
          path: [1, 2],
          depth: 2,
          dependencies: []
        }
      ];

      const enhancedResults = await (analyzer as any).enhanceResultsWithCallChains(results, true);

      expect(enhancedResults).toHaveLength(1);
      expect(enhancedResults[0].call_chain).toBe('_Ready() → InitializeServices() → SetHandPositions() (CardManager.cs)');
      expect(enhancedResults[0].symbolId).toBe(3);
    });

    test('should not enhance results when showCallChains is false', async () => {
      const results = [
        {
          symbolId: 3,
          path: [1, 2],
          depth: 2,
          dependencies: []
        }
      ];

      const enhancedResults = await (analyzer as any).enhanceResultsWithCallChains(results, false);

      expect(enhancedResults).toEqual(results);
      expect(enhancedResults[0].call_chain).toBeUndefined();
    });

    test('should handle empty results gracefully', async () => {
      const results: any[] = [];
      const enhancedResults = await (analyzer as any).enhanceResultsWithCallChains(results, true);

      expect(enhancedResults).toEqual([]);
    });
  });

  describe('getShortFilePath', () => {
    test('should shorten long file paths', () => {
      const longPath = '/very/long/path/to/project/src/Game/Controllers/DeckController.cs';
      const shortPath = (analyzer as any).getShortFilePath(longPath);

      expect(shortPath).toBe('.../Controllers/DeckController.cs');
    });

    test('should keep short paths unchanged', () => {
      const shortPath = 'Game/DeckController.cs';
      const result = (analyzer as any).getShortFilePath(shortPath);

      expect(result).toBe('Game/DeckController.cs');
    });

    test('should handle single filename', () => {
      const filename = 'DeckController.cs';
      const result = (analyzer as any).getShortFilePath(filename);

      expect(result).toBe('DeckController.cs');
    });

    test('should handle Windows-style paths', () => {
      const windowsPath = 'C:\\Project\\src\\Game\\Controllers\\DeckController.cs';
      const result = (analyzer as any).getShortFilePath(windowsPath);

      expect(result).toBe('.../Controllers/DeckController.cs');
    });
  });

  describe('Integration with TransitiveAnalysisOptions', () => {
    test('should respect showCallChains option in getTransitiveCallers', async () => {
      // This is more of a contract test to ensure the option is properly handled
      const options = {
        maxDepth: 5,
        showCallChains: true,
        maxResults: 100
      };

      // Mock the database methods that would be called
      (analyzer as any).getDirectCallers = jest.fn().mockResolvedValue([]);
      (analyzer as any).enhanceResultsWithCallChains = jest.fn().mockResolvedValue([]);

      try {
        await analyzer.getTransitiveCallers(1, options);
      } catch (error) {
        // Expected to fail due to mocking, but we're testing that enhanceResultsWithCallChains is called
      }

      expect((analyzer as any).enhanceResultsWithCallChains).toHaveBeenCalledWith([], true);
    });
  });
});