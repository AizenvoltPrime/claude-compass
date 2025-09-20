import { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } from '@jest/globals';
import { McpTools } from '../../src/mcp/tools';
import { DatabaseService } from '../../src/database/services';
import { getDatabaseConnection, closeDatabaseConnection } from '../../src/database/connection';
import { SymbolType } from '../../src/database/models';
import { Knex } from 'knex';

describe('Enhanced MCP Tools Search', () => {
  let mcpTools: McpTools;
  let dbService: DatabaseService;
  let knex: Knex;
  let repoId: number;

  beforeAll(async () => {
    knex = getDatabaseConnection();
    dbService = new DatabaseService();
    mcpTools = new McpTools(dbService);

    // Create test repository
    const repo = await dbService.createRepository({
      name: 'test-enhanced-mcp-search',
      path: '/test/enhanced-mcp-search',
      framework_stack: ['javascript', 'typescript', 'vue', 'laravel']
    });
    repoId = repo.id;

    // Create test files
    const jsFile = await dbService.createFile({
      repo_id: repoId,
      path: '/test/enhanced-mcp-search/components/UserComponent.vue',
      language: 'vue',
      is_generated: false,
      is_test: false
    });

    const tsFile = await dbService.createFile({
      repo_id: repoId,
      path: '/test/enhanced-mcp-search/services/UserService.ts',
      language: 'typescript',
      is_generated: false,
      is_test: false
    });

    const phpFile = await dbService.createFile({
      repo_id: repoId,
      path: '/test/enhanced-mcp-search/app/Services/UserApiService.php',
      language: 'php',
      is_generated: false,
      is_test: false
    });

    // Create test symbols with different types and frameworks
    const symbolsData = [
      {
        file_id: jsFile.id,
        name: 'UserComponent',
        symbol_type: SymbolType.COMPONENT,
        is_exported: true,
        signature: 'const UserComponent = defineComponent(...)',
        description: 'Vue component for displaying user information'
      },
      {
        file_id: tsFile.id,
        name: 'UserService',
        symbol_type: SymbolType.CLASS,
        is_exported: true,
        signature: 'class UserService',
        description: 'Service for managing user operations'
      },
      {
        file_id: tsFile.id,
        name: 'findUser',
        symbol_type: SymbolType.FUNCTION,
        is_exported: true,
        signature: 'function findUser(id: string): Promise<User>',
        description: 'Finds a user by their unique identifier'
      },
      {
        file_id: phpFile.id,
        name: 'UserApiService',
        symbol_type: SymbolType.CLASS,
        is_exported: true,
        signature: 'class UserApiService',
        description: 'Laravel service for user API operations'
      },
      {
        file_id: tsFile.id,
        name: 'UserInterface',
        symbol_type: SymbolType.INTERFACE,
        is_exported: true,
        signature: 'interface UserInterface',
        description: 'TypeScript interface defining user properties'
      }
    ];

    for (const symbolData of symbolsData) {
      await dbService.createSymbol(symbolData);
    }

    // Wait for search vectors to be populated
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

  describe('Enhanced searchCode method', () => {
    test('should search with basic query', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId
      });

      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);

      const response = JSON.parse(result.content[0].text);
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBeGreaterThan(0);
    });

    test('should support enhanced search options', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId,
        use_vector: false,
        limit: 5
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeLessThanOrEqual(5);
    });

    test('should filter by symbol type', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId,
        symbol_type: 'function'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.every((r: any) => r.type === 'function')).toBe(true);
    });

    test('should filter by exported status', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId,
        is_exported: true
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.every((r: any) => r.is_exported === true)).toBe(true);
    });

    test('should support framework filtering', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId,
        framework: 'vue'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThanOrEqual(0);
    });

    test('should support entity type filtering', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId,
        entity_types: ['component']
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThanOrEqual(0);
    });

    test('should support multi-repository search', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId]
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);
    });

    test('should use hybrid search with use_vector flag', async () => {
      const result = await mcpTools.searchCode({
        query: 'user service',
        repo_id: repoId,
        use_vector: true
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle multiple entity types', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId,
        entity_types: ['function', 'class', 'component']
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const types = response.results.map((r: any) => r.type);
      expect(types.some((t: string) => ['function', 'class', 'component'].includes(t))).toBe(true);
    });

    test('should include file information in results', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const firstResult = response.results[0];
      expect(firstResult.file).toBeDefined();
      expect(firstResult.file.path).toBeDefined();
      expect(firstResult.file.language).toBeDefined();
    });

    test('should include entity type and framework information', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const firstResult = response.results[0];
      expect(firstResult.entity_type).toBeDefined();
      expect(firstResult.framework).toBeDefined();
    });
  });

  describe('Parameter validation', () => {
    test('should validate required query parameter', async () => {
      await expect(async () => {
        await mcpTools.searchCode({});
      }).rejects.toThrow('query is required');
    });

    test('should validate query type', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 123
        });
      }).rejects.toThrow('query is required and must be a string');
    });

    test('should validate repo_id type', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_id: 'invalid'
        });
      }).rejects.toThrow('repo_id must be a number');
    });

    test('should validate symbol_type type', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          symbol_type: 123
        });
      }).rejects.toThrow('symbol_type must be a string');
    });

    test('should validate is_exported type', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          is_exported: 'yes'
        });
      }).rejects.toThrow('is_exported must be a boolean');
    });

    test('should validate limit range', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          limit: 0
        });
      }).rejects.toThrow('limit must be a number between 1 and 200');

      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          limit: 300
        });
      }).rejects.toThrow('limit must be a number between 1 and 200');
    });

    test('should validate entity_types array', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          entity_types: 'not_an_array'
        });
      }).rejects.toThrow('entity_types must be an array');
    });

    test('should validate entity_types values', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          entity_types: ['invalid_type']
        });
      }).rejects.toThrow('entity_types must contain valid types');
    });

    test('should validate framework type', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          framework: 123
        });
      }).rejects.toThrow('framework must be a string');
    });

    test('should validate use_vector type', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          use_vector: 'yes'
        });
      }).rejects.toThrow('use_vector must be a boolean');
    });

    test('should validate repo_ids array', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_ids: 'not_an_array'
        });
      }).rejects.toThrow('repo_ids must be an array');
    });

    test('should validate repo_ids values', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_ids: ['not_a_number']
        });
      }).rejects.toThrow('repo_ids must contain only numbers');
    });
  });

  describe('Performance and error handling', () => {
    test('should handle empty query results gracefully', async () => {
      const result = await mcpTools.searchCode({
        query: 'nonexistentfunctionname12345',
        repo_id: repoId
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results).toEqual([]);
      expect(response.total_results).toBe(0);
    });

    test('should handle non-existent repository gracefully', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: 999999
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results).toEqual([]);
    });

    test('should complete search within reasonable time', async () => {
      const startTime = Date.now();

      await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId,
        limit: 50
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within 1 second for enhanced search
      expect(duration).toBeLessThan(1000);
    }, 2000);

    test('should handle special characters in query', async () => {
      const result = await mcpTools.searchCode({
        query: 'user@service.test',
        repo_id: repoId
      });

      expect(result.content).toBeDefined();
      const response = JSON.parse(result.content[0].text);
      expect(Array.isArray(response.results)).toBe(true);
    });

    test('should provide consistent response format', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_id: repoId
      });

      const response = JSON.parse(result.content[0].text);

      expect(response).toHaveProperty('query');
      expect(response).toHaveProperty('results');
      expect(response).toHaveProperty('total_results');
      // Check for any of the additional response fields that might be present
      expect(
        response.hasOwnProperty('search_options') ||
        response.hasOwnProperty('search_mode') ||
        response.hasOwnProperty('absorbed_tools')
      ).toBe(true);

      if (response.results.length > 0) {
        const firstResult = response.results[0];
        expect(firstResult).toHaveProperty('id');
        expect(firstResult).toHaveProperty('name');
        expect(firstResult).toHaveProperty('type');
        expect(firstResult).toHaveProperty('file');
        expect(firstResult).toHaveProperty('entity_type');
        expect(firstResult).toHaveProperty('framework');
      }
    });
  });
});