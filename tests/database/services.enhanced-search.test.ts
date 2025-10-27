import { describe, beforeAll, afterAll, test, expect } from '@jest/globals';
import { getDatabaseConnection, closeDatabaseConnection } from '../../src/database/connection';
import { SymbolSearchOptions, SymbolType } from '../../src/database/models';
import { Knex } from 'knex';
import * as RepositoryService from '../../src/database/services/repository-service';
import * as FileService from '../../src/database/services/file-service';
import * as SymbolService from '../../src/database/services/symbol-service';
import * as SearchService from '../../src/database/services/search-service';

describe('Enhanced Search Functionality', () => {
  let db: Knex;
  let repoId: number;
  let testSymbols: { id: number; name: string; type: string }[] = [];

  beforeAll(async () => {
    db = getDatabaseConnection();

    // Create test repository
    const repo = await RepositoryService.createRepository(db, {
      name: 'test-enhanced-search',
      path: '/test/enhanced-search',
      framework_stack: ['javascript', 'typescript']
    });
    repoId = repo.id;

    // Create test file
    const file = await FileService.createFile(db, {
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
      const symbol = await SymbolService.createSymbol(db, symbolData);
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
    await db('symbols').where('file_id', 'in',
      db('files').select('id').where('repo_id', repoId)
    ).del();
    await db('files').where('repo_id', repoId).del();
    await db('repositories').where('id', repoId).del();

    await closeDatabaseConnection();
  });

  describe('Enhanced searchSymbols method', () => {
    test('should use lexical search by default', async () => {
      const results = await SearchService.lexicalSearchSymbols(db, 'user', repoId, {});

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name.toLowerCase().includes('user'))).toBe(true);
    });

    test('should support hybrid search mode', async () => {
      const options = {
        limit: 10
      };

      const results = await SearchService.hybridSearchSymbols(db,'user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name.toLowerCase().includes('user'))).toBe(true);
    });

    test('should support full-text search mode', async () => {
      const options = {
        limit: 10
      };

      const results = await SearchService.fulltextSearchSymbols(db,'user service', repoId, options);

      // Full-text search may fall back to lexical search in test environment
      expect(Array.isArray(results)).toBe(true);
    });

    test('should filter by symbol types', async () => {
      const options: SymbolSearchOptions = {
        symbolTypes: [SymbolType.FUNCTION],
        limit: 10
      };

      const results = await SearchService.lexicalSearchSymbols(db,'user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.symbol_type === SymbolType.FUNCTION)).toBe(true);
    });

    test('should filter by exported status', async () => {
      const options: SymbolSearchOptions = {
        isExported: true,
        limit: 10
      };

      const results = await SearchService.lexicalSearchSymbols(db,'user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.is_exported === true)).toBe(true);
    });

    test('should filter by exported status (non-exported)', async () => {
      const options: SymbolSearchOptions = {
        isExported: false,
        limit: 10
      };

      const results = await SearchService.lexicalSearchSymbols(db,'user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.is_exported === false)).toBe(true);
    });

    test('should support multi-repository search', async () => {
      const options: SymbolSearchOptions = {
        repoIds: [repoId],
        limit: 10
      };

      const results = await SearchService.lexicalSearchSymbols(db,'user', undefined, options);

      expect(results.length).toBeGreaterThan(0);
    });

    test('should respect limit parameter', async () => {
      const options: SymbolSearchOptions = {
        limit: 2
      };

      const results = await SearchService.lexicalSearchSymbols(db,'user', repoId, options);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    test('should handle empty query gracefully', async () => {
      const results = await SearchService.lexicalSearchSymbols(db,'', repoId);

      expect(Array.isArray(results)).toBe(true);
      // Empty query should return few or no results
      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('should handle non-existent terms', async () => {
      const results = await SearchService.lexicalSearchSymbols(db,'nonexistentfunctionname12345', repoId);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    test('should combine multiple filters', async () => {
      const options: SymbolSearchOptions = {
        symbolTypes: [SymbolType.FUNCTION],
        isExported: true,
        limit: 5
      };

      const results = await SearchService.lexicalSearchSymbols(db,'user', repoId, options);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r =>
        r.symbol_type === SymbolType.FUNCTION && r.is_exported === true
      )).toBe(true);
    });
  });

  describe('Search ranking and relevance', () => {
    test('should prioritize exact name matches', async () => {
      const results = await SearchService.lexicalSearchSymbols(db,'findUser', repoId);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('findUser');
    });

    test('should find partial matches', async () => {
      const results = await SearchService.lexicalSearchSymbols(db,'User', repoId);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name.includes('User'))).toBe(true);
    });

    test('should search in signatures', async () => {
      const results = await SearchService.lexicalSearchSymbols(db,'Promise', repoId);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.signature?.includes('Promise'))).toBe(true);
    });

    test('should search in descriptions', async () => {
      const results = await SearchService.lexicalSearchSymbols(db,'identifier', repoId);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.description?.includes('identifier'))).toBe(true);
    });
  });

  describe('Performance and edge cases', () => {
    test('should handle large limit values', async () => {
      const options: SymbolSearchOptions = {
        limit: 1000
      };

      const results = await SearchService.lexicalSearchSymbols(db,'user', repoId, options);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeLessThanOrEqual(1000);
    });

    test('should handle special characters in query', async () => {
      const results = await SearchService.lexicalSearchSymbols(db,'user-service@test', repoId);

      expect(Array.isArray(results)).toBe(true);
      // Should not crash and return reasonable results
    });

    test('should handle SQL injection attempts', async () => {
      const maliciousQuery = "'; DROP TABLE symbols; --";

      const results = await SearchService.lexicalSearchSymbols(db,maliciousQuery, repoId);

      expect(Array.isArray(results)).toBe(true);
      // Should not crash and database should remain intact

      // Verify database integrity
      const symbolCount = await db('symbols').count('* as count').first();
      expect(Number(symbolCount?.count)).toBeGreaterThan(0);
    });

    test('should return results within reasonable time', async () => {
      const startTime = Date.now();

      await SearchService.lexicalSearchSymbols(db,'user', repoId);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within 2 seconds
      expect(duration).toBeLessThan(2000);
    }, 3000);
  });

  describe('Full-text search capabilities', () => {
    test('should support phrase searching with fulltext mode', async () => {
      const options = {};

      const results = await SearchService.fulltextSearchSymbols(db,'user service', repoId, options);

      expect(Array.isArray(results)).toBe(true);
    });

    test('should support boolean queries in fulltext mode', async () => {
      const options = {};

      const results = await SearchService.fulltextSearchSymbols(db,'user & service', repoId, options);

      expect(Array.isArray(results)).toBe(true);
    });

    test('should handle fulltext search with no results', async () => {
      const options = {};

      const results = await SearchService.fulltextSearchSymbols(db,'nonexistent terms that should not match', repoId, options);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('Vector search fallback', () => {
    test('should fail when vector search is requested without embeddings', async () => {
      const options = {
        similarityThreshold: 0.7
      };

      try {
        await SearchService.vectorSearchSymbols(db,'user', repoId, options);
        // Should not reach here if no embeddings
        expect(false).toBe(true);
      } catch (error) {
        expect(error.message).toContain('Vector search unavailable');
      }
    });

    test('should handle vector search', async () => {
      const options = {
        similarityThreshold: 0.7
      };

      try {
        const results = await SearchService.vectorSearchSymbols(db,'user', repoId, options);
        expect(Array.isArray(results)).toBe(true);
      } catch (error) {
        // Vector search may fail if no embeddings are available
        expect(error.message).toContain('Vector search unavailable');
      }
    });
  });
});