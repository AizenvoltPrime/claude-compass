import { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } from '@jest/globals';
import { DatabaseService } from '../../src/database/services';
import { getDatabaseConnection, closeDatabaseConnection } from '../../src/database/connection';
import { SymbolSearchOptions, SymbolType } from '../../src/database/models';
import { Knex } from 'knex';

describe('Enhanced Search Functionality', () => {
  let dbService: DatabaseService;
  let knex: Knex;
  let repoId: number;
  let testSymbols: { id: number; name: string; type: string }[] = [];

  beforeAll(async () => {
    knex = getDatabaseConnection();
    dbService = new DatabaseService();

    // Create test repository
    const repo = await dbService.createRepository({
      name: 'test-enhanced-search',
      path: '/test/enhanced-search',
      framework_stack: ['javascript', 'typescript']
    });
    repoId = repo.id;

    // Create test file
    const file = await dbService.createFile({
      repo_id: repoId,
      path: '/test/enhanced-search/test.ts',
      language: 'typescript',
      is_generated: false,
      is_test: false
    });

    // Create test symbols with search content
    const symbolsData = [
      {
        file_id: file.id,
        name: 'findUser',
        symbol_type: SymbolType.FUNCTION,
        is_exported: true,
        signature: 'function findUser(id: string): Promise<User>',
        description: 'Finds a user by their unique identifier'
      },
      {
        file_id: file.id,
        name: 'UserService',
        symbol_type: SymbolType.CLASS,
        is_exported: true,
        signature: 'class UserService',
        description: 'Service for managing user operations'
      },
      {
        file_id: file.id,
        name: 'createUser',
        symbol_type: SymbolType.FUNCTION,
        is_exported: false,
        signature: 'function createUser(data: UserData): Promise<User>',
        description: 'Creates a new user with provided data'
      },
      {
        file_id: file.id,
        name: 'UserInterface',
        symbol_type: SymbolType.INTERFACE,
        is_exported: true,
        signature: 'interface UserInterface',
        description: 'Interface defining user properties'
      },
      {
        file_id: file.id,
        name: 'searchUsers',
        symbol_type: SymbolType.FUNCTION,
        is_exported: true,
        signature: 'function searchUsers(query: string): Promise<User[]>',
        description: 'Searches for users matching the query'
      }
    ];

    for (const symbolData of symbolsData) {
      const symbol = await dbService.createSymbol(symbolData);
      testSymbols.push({
        id: symbol.id,
        name: symbol.name,
        type: symbol.symbol_type
      });
    }

    // Wait a bit for triggers to populate search vectors
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    // Clean up test data
    await knex('symbols').where('file_id', 'in',
      knex('files').select('id').where('repo_id', repoId)
    ).del();
    await knex('files').where('repo_id', repoId).del();
    await knex('repositories').where('id', repoId).del();

    await closeDatabaseConnection();
  });

  describe('Enhanced searchSymbols method', () => {
    test('should use lexical search by default', async () => {
      const results = await dbService.searchSymbols('user', repoId);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name.toLowerCase().includes('user'))).toBe(true);
    });

    test('should support hybrid search mode', async () => {
      const options: SymbolSearchOptions = {
        searchMode: 'hybrid',
        limit: 10
      };

      const results = await dbService.searchSymbols('user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name.toLowerCase().includes('user'))).toBe(true);
    });

    test('should support full-text search mode', async () => {
      const options: SymbolSearchOptions = {
        searchMode: 'fulltext',
        limit: 10
      };

      const results = await dbService.searchSymbols('user service', repoId, options);

      expect(results.length).toBeGreaterThan(0);
    });

    test('should filter by symbol types', async () => {
      const options: SymbolSearchOptions = {
        symbolTypes: [SymbolType.FUNCTION],
        limit: 10
      };

      const results = await dbService.searchSymbols('user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.symbol_type === SymbolType.FUNCTION)).toBe(true);
    });

    test('should filter by exported status', async () => {
      const options: SymbolSearchOptions = {
        isExported: true,
        limit: 10
      };

      const results = await dbService.searchSymbols('user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.is_exported === true)).toBe(true);
    });

    test('should filter by exported status (non-exported)', async () => {
      const options: SymbolSearchOptions = {
        isExported: false,
        limit: 10
      };

      const results = await dbService.searchSymbols('user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.is_exported === false)).toBe(true);
    });

    test('should support multi-repository search', async () => {
      const options: SymbolSearchOptions = {
        repoIds: [repoId],
        limit: 10
      };

      const results = await dbService.searchSymbols('user', undefined, options);

      expect(results.length).toBeGreaterThan(0);
    });

    test('should respect limit parameter', async () => {
      const options: SymbolSearchOptions = {
        limit: 2
      };

      const results = await dbService.searchSymbols('user', repoId, options);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    test('should handle empty query gracefully', async () => {
      const results = await dbService.searchSymbols('', repoId);

      expect(Array.isArray(results)).toBe(true);
      // Empty query should return few or no results
      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('should handle non-existent terms', async () => {
      const results = await dbService.searchSymbols('nonexistentfunctionname12345', repoId);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    test('should combine multiple filters', async () => {
      const options: SymbolSearchOptions = {
        symbolTypes: [SymbolType.FUNCTION],
        isExported: true,
        limit: 5
      };

      const results = await dbService.searchSymbols('user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r =>
        r.symbol_type === SymbolType.FUNCTION && r.is_exported === true
      )).toBe(true);
    });
  });

  describe('Search ranking and relevance', () => {
    test('should prioritize exact name matches', async () => {
      const results = await dbService.searchSymbols('findUser', repoId);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('findUser');
    });

    test('should find partial matches', async () => {
      const results = await dbService.searchSymbols('User', repoId);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name.includes('User'))).toBe(true);
    });

    test('should search in signatures', async () => {
      const results = await dbService.searchSymbols('Promise', repoId);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.signature?.includes('Promise'))).toBe(true);
    });

    test('should search in descriptions', async () => {
      const results = await dbService.searchSymbols('identifier', repoId);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.description?.includes('identifier'))).toBe(true);
    });
  });

  describe('Performance and edge cases', () => {
    test('should handle large limit values', async () => {
      const options: SymbolSearchOptions = {
        limit: 1000
      };

      const results = await dbService.searchSymbols('user', repoId, options);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeLessThanOrEqual(1000);
    });

    test('should handle special characters in query', async () => {
      const results = await dbService.searchSymbols('user-service@test', repoId);

      expect(Array.isArray(results)).toBe(true);
      // Should not crash and return reasonable results
    });

    test('should handle SQL injection attempts', async () => {
      const maliciousQuery = "'; DROP TABLE symbols; --";

      const results = await dbService.searchSymbols(maliciousQuery, repoId);

      expect(Array.isArray(results)).toBe(true);
      // Should not crash and database should remain intact

      // Verify database integrity
      const symbolCount = await knex('symbols').count('* as count').first();
      expect(Number(symbolCount?.count)).toBeGreaterThan(0);
    });

    test('should return results within reasonable time', async () => {
      const startTime = Date.now();

      await dbService.searchSymbols('user', repoId);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within 2 seconds
      expect(duration).toBeLessThan(2000);
    }, 3000);
  });

  describe('Full-text search capabilities', () => {
    test('should support phrase searching with fulltext mode', async () => {
      const options: SymbolSearchOptions = {
        searchMode: 'fulltext'
      };

      const results = await dbService.searchSymbols('user service', repoId, options);

      expect(Array.isArray(results)).toBe(true);
    });

    test('should support boolean queries in fulltext mode', async () => {
      const options: SymbolSearchOptions = {
        searchMode: 'fulltext'
      };

      const results = await dbService.searchSymbols('user & service', repoId, options);

      expect(Array.isArray(results)).toBe(true);
    });

    test('should handle fulltext search with no results', async () => {
      const options: SymbolSearchOptions = {
        searchMode: 'fulltext'
      };

      const results = await dbService.searchSymbols('nonexistent terms that should not match', repoId, options);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('Vector search fallback', () => {
    test('should fall back to fulltext when vector search is requested', async () => {
      const options: SymbolSearchOptions = {
        searchMode: 'vector'
      };

      const results = await dbService.searchSymbols('user', repoId, options);

      expect(Array.isArray(results)).toBe(true);
      // Should still return results via fallback
    });

    test('should handle use_vector option', async () => {
      const options: SymbolSearchOptions = {
        useVector: true
      };

      const results = await dbService.searchSymbols('user', repoId, options);

      expect(Array.isArray(results)).toBe(true);
      // Should return results via hybrid mode with vector fallback
    });
  });
});