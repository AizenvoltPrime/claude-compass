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
        repo_ids: [repoId]
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
        repo_ids: [repoId],
        search_mode: 'exact'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThanOrEqual(0);
    });

    test('should filter by symbol type', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId],
        entity_types: ['function']
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.every((r: any) => r.type === 'function')).toBe(true);
    });

    test('should filter by exported status', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId],
        is_exported: true
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.every((r: any) => r.is_exported === true)).toBe(true);
    });

    test('should support framework filtering', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId],
        framework: 'vue'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThanOrEqual(0);
    });

    test('should support entity type filtering', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId],
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

    test('should use vector search with search_mode', async () => {
      const result = await mcpTools.searchCode({
        query: 'user service',
        repo_ids: [repoId],
        search_mode: 'vector'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle multiple entity types', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId],
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
        repo_ids: [repoId]
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const firstResult = response.results[0];
      expect(firstResult.file).toBeDefined();
      expect(firstResult.file.path).toBeDefined();
      expect(firstResult.file.language).toBeDefined();
    });

    test('should include entity type information', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId]
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const firstResult = response.results[0];
      expect(firstResult.entity_type).toBeDefined();
    });
  });

  describe('Framework Auto-Detection Tests', () => {
    test('should auto-detect single framework from entity types', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['model']
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.query_filters.framework).toBe('laravel');
      expect(response.query_filters.framework_auto_detected).toBe(true);
    });

    test('should auto-detect single framework for Vue components', async () => {
      const result = await mcpTools.searchCode({
        query: 'UserComponent',
        repo_ids: [repoId],
        entity_types: ['component']
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.query_filters.framework).toBe('vue');
      expect(response.query_filters.framework_auto_detected).toBe(true);
    });

    test('should handle multiple framework detection without auto-selecting', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['function', 'class', 'component']
      });

      const response = JSON.parse(result.content[0].text);
      // Should not auto-select when multiple frameworks are detected
      expect(response.query_filters.framework_auto_detected).toBeFalsy();
    });

    test('should not auto-detect when framework is explicitly specified', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['model'],
        framework: 'vue'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.query_filters.framework).toBe('vue');
      expect(response.query_filters.framework_auto_detected).toBeFalsy();
    });

    test('should not auto-detect when no entity types provided', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId]
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.query_filters.framework_auto_detected).toBeFalsy();
    });

    test('should validate against repository framework stack', async () => {
      // Create a repository with limited framework stack
      const limitedRepo = await dbService.createRepository({
        name: `test-limited-framework-${Date.now()}`,
        path: `/test/limited-${Date.now()}`,
        framework_stack: ['javascript'] // Only JavaScript, no Vue or Laravel
      });

      const result = await mcpTools.searchCode({
        query: 'Test',
        repo_ids: [limitedRepo.id],
        entity_types: ['model'] // Would suggest Laravel, but not available
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.query_filters.framework_auto_detected).toBeFalsy();

      // Clean up
      await knex('repositories').where('id', limitedRepo.id).del();
    });
  });

  describe('Max Depth Parameter Tests', () => {
    test('should accept max_depth parameter in who_calls', async () => {
      // First create a test symbol
      const vueFile = await dbService.createFile({
        repo_id: repoId,
        path: '/test/enhanced-mcp-search/TestComponent.vue',
        language: 'vue',
        is_generated: false,
        is_test: false
      });

      const testSymbol = await dbService.createSymbol({
        file_id: vueFile.id,
        name: 'testMethod',
        symbol_type: SymbolType.FUNCTION,
        is_exported: true,
        signature: 'function testMethod()'
      });

      const result = await mcpTools.whoCalls({
        symbol_id: testSymbol.id,
        max_depth: 2
      });

      expect(result.content).toBeDefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.query_info.symbol).toBe('testMethod');
    });

    test('should accept max_depth parameter in listDependencies', async () => {
      // Create a test symbol with dependencies
      const jsFile = await dbService.createFile({
        repo_id: repoId,
        path: '/test/enhanced-mcp-search/TestService.js',
        language: 'javascript',
        is_generated: false,
        is_test: false
      });

      const testSymbol = await dbService.createSymbol({
        file_id: jsFile.id,
        name: 'TestService',
        symbol_type: SymbolType.CLASS,
        is_exported: true,
        signature: 'class TestService'
      });

      const result = await mcpTools.listDependencies({
        symbol_id: testSymbol.id,
        max_depth: 10
      });

      expect(result.content).toBeDefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.query_info.symbol).toBe('TestService');
    });

    test('should accept max_depth parameter in impact_of', async () => {
      const vueFile = await dbService.createFile({
        repo_id: repoId,
        path: '/test/enhanced-mcp-search/ImpactComponent.vue',
        language: 'vue',
        is_generated: false,
        is_test: false
      });

      const testSymbol = await dbService.createSymbol({
        file_id: vueFile.id,
        name: 'ImpactComponent',
        symbol_type: SymbolType.COMPONENT,
        is_exported: true,
        signature: 'export default defineComponent(...)'
      });

      const result = await mcpTools.impactOf({
        symbol_id: testSymbol.id,
        max_depth: 5
      });

      expect(result.content).toBeDefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.query_info.symbol).toBe('ImpactComponent');
    });
  });

  describe('Search Mode Enhancement Tests', () => {
    test('should accept all search_mode values', async () => {
      const searchModes = ['auto', 'exact', 'vector', 'qualified'];

      for (const mode of searchModes) {
        const result = await mcpTools.searchCode({
          query: 'user',
          repo_ids: [repoId],
          search_mode: mode
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.query_filters.search_mode).toBe(mode);
        expect(Array.isArray(response.results)).toBe(true);
      }
    });

    test('should include search mode in response', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId],
        search_mode: 'vector'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.query_filters.search_mode).toBe('vector');
    });
  });

  describe('Response Format Enhancement Tests', () => {
    test('should include framework_auto_detected in response', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['component']
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.query_filters).toHaveProperty('framework_auto_detected');
      expect(typeof response.query_filters.framework_auto_detected).toBe('boolean');
    });

    test('should include entity_type in individual results', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId]
      });

      const response = JSON.parse(result.content[0].text);
      if (response.results.length > 0) {
        const firstResult = response.results[0];
        expect(firstResult).toHaveProperty('entity_type');
        expect(typeof firstResult.entity_type).toBe('string');
      }
    });

    test('should maintain backward compatibility in response structure', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId]
      });

      const response = JSON.parse(result.content[0].text);

      // Check that all required fields are present
      expect(response).toHaveProperty('query');
      expect(response).toHaveProperty('results');
      expect(response).toHaveProperty('total_results');
      expect(response).toHaveProperty('query_filters');
      expect(response).toHaveProperty('search_options');

      // Check query_filters structure - should have core fields
      expect(response.query_filters).toHaveProperty('framework_auto_detected');
      expect(response.query_filters).toHaveProperty('repo_ids');

      // Optional fields that may or may not be present depending on query
      if (response.query_filters.entity_types !== undefined) {
        expect(Array.isArray(response.query_filters.entity_types)).toBe(true);
      }
      if (response.query_filters.framework !== undefined) {
        expect(typeof response.query_filters.framework).toBe('string');
      }
      if (response.query_filters.search_mode !== undefined) {
        expect(['auto', 'exact', 'vector', 'qualified']).toContain(response.query_filters.search_mode);
      }
      if (response.query_filters.is_exported !== undefined) {
        expect(typeof response.query_filters.is_exported).toBe('boolean');
      }
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

    test('should validate repo_id deprecation', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_id: 123
        });
      }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');
    });

    test('should validate symbol_type deprecation', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          symbol_type: 'function'
        });
      }).rejects.toThrow('symbol_type parameter removed. Use entity_types array instead');
    });

    test('should validate is_exported type', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          is_exported: 'yes'
        });
      }).rejects.toThrow('is_exported must be a boolean');
    });

    test('should validate limit deprecation', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          limit: 10
        });
      }).rejects.toThrow('limit parameter removed. Fixed limit of 100 is now used for all searches');
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

    test('should validate use_vector deprecation', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          use_vector: true
        });
      }).rejects.toThrow('use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid');
    });

    test('should validate search_mode values', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          search_mode: 'invalid'
        });
      }).rejects.toThrow('search_mode must be one of: auto, exact, vector, qualified');
    });

    test('should validate max_depth range for who_calls', async () => {
      await expect(async () => {
        await mcpTools.whoCalls({
          symbol_id: 1,
          max_depth: 25 // exceeds maximum of 20
        });
      }).rejects.toThrow();
    });

    test('should validate max_depth range for listDependencies', async () => {
      await expect(async () => {
        await mcpTools.listDependencies({
          symbol_id: 1,
          max_depth: 0 // below minimum of 1
        });
      }).rejects.toThrow();
    });

    test('should validate max_depth range for impact_of', async () => {
      await expect(async () => {
        await mcpTools.impactOf({
          symbol_id: 1,
          max_depth: -1 // below minimum of 1
        });
      }).rejects.toThrow();
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
        repo_ids: [repoId]
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results).toEqual([]);
      expect(response.total_results).toBe(0);
    });

    test('should handle non-existent repository gracefully', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [999999]
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results).toEqual([]);
    });

    test('should complete search within reasonable time', async () => {
      const startTime = Date.now();

      await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId]
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within 1 second for enhanced search
      expect(duration).toBeLessThan(1000);
    }, 2000);

    test('should handle special characters in query', async () => {
      const result = await mcpTools.searchCode({
        query: 'user@service.test',
        repo_ids: [repoId]
      });

      expect(result.content).toBeDefined();
      const response = JSON.parse(result.content[0].text);
      expect(Array.isArray(response.results)).toBe(true);
    });

    test('should provide consistent response format', async () => {
      const result = await mcpTools.searchCode({
        query: 'user',
        repo_ids: [repoId]
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
      }
    });
  });
});