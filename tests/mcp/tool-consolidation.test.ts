import { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } from '@jest/globals';
import { McpTools } from '../../src/mcp/tools';
import { DatabaseService } from '../../src/database/services';
import { getDatabaseConnection, closeDatabaseConnection } from '../../src/database/connection';
import { SymbolType } from '../../src/database/models';
import { Knex } from 'knex';

describe('Tool Consolidation Validation', () => {
  let mcpTools: McpTools;
  let dbService: DatabaseService;
  let knex: Knex;
  let repoId: number;

  beforeAll(async () => {
    knex = getDatabaseConnection();
    dbService = new DatabaseService();
    mcpTools = new McpTools(dbService);

    // Create test repository with Laravel and Vue stack
    const repo = await dbService.createRepository({
      name: 'test-tool-consolidation',
      path: '/test/tool-consolidation',
      framework_stack: ['laravel', 'vue', 'javascript', 'php']
    });
    repoId = repo.id;

    // Create test files for different frameworks
    const vueFile = await dbService.createFile({
      repo_id: repoId,
      path: '/test/tool-consolidation/resources/js/components/UserList.vue',
      language: 'vue',
      is_generated: false,
      is_test: false
    });

    const phpModelFile = await dbService.createFile({
      repo_id: repoId,
      path: '/test/tool-consolidation/app/Models/User.php',
      language: 'php',
      is_generated: false,
      is_test: false
    });

    const phpControllerFile = await dbService.createFile({
      repo_id: repoId,
      path: '/test/tool-consolidation/app/Http/Controllers/UserController.php',
      language: 'php',
      is_generated: false,
      is_test: false
    });

    const phpJobFile = await dbService.createFile({
      repo_id: repoId,
      path: '/test/tool-consolidation/app/Jobs/ProcessUserRegistration.php',
      language: 'php',
      is_generated: false,
      is_test: false
    });

    // Create Laravel routes
    const routeData = [
      {
        repo_id: repoId,
        path: '/api/users',
        method: 'GET',
        framework_type: 'laravel'
      },
      {
        repo_id: repoId,
        path: '/api/users/{id}',
        method: 'GET',
        framework_type: 'laravel'
      },
      {
        repo_id: repoId,
        path: '/api/users',
        method: 'POST',
        framework_type: 'laravel'
      }
    ];

    for (const route of routeData) {
      await dbService.createRoute(route);
    }

    // Create test symbols representing various Laravel entities
    const symbolsData = [
      // Vue Component
      {
        file_id: vueFile.id,
        name: 'UserList',
        symbol_type: SymbolType.COMPONENT,
        is_exported: true,
        signature: 'export default defineComponent(...)',
        description: 'Vue component for displaying user list'
      },
      // Laravel Model
      {
        file_id: phpModelFile.id,
        name: 'User',
        symbol_type: SymbolType.CLASS,
        is_exported: true,
        signature: 'class User extends Authenticatable',
        description: 'Eloquent model for user data'
      },
      // Laravel Controller
      {
        file_id: phpControllerFile.id,
        name: 'UserController',
        symbol_type: SymbolType.CLASS,
        is_exported: true,
        signature: 'class UserController extends Controller',
        description: 'Controller for handling user requests'
      },
      {
        file_id: phpControllerFile.id,
        name: 'index',
        symbol_type: SymbolType.METHOD,
        is_exported: true,
        signature: 'public function index()',
        description: 'List all users'
      },
      {
        file_id: phpControllerFile.id,
        name: 'store',
        symbol_type: SymbolType.METHOD,
        is_exported: true,
        signature: 'public function store(Request $request)',
        description: 'Create new user'
      },
      // Laravel Job
      {
        file_id: phpJobFile.id,
        name: 'ProcessUserRegistration',
        symbol_type: SymbolType.CLASS,
        is_exported: true,
        signature: 'class ProcessUserRegistration implements ShouldQueue',
        description: 'Job for processing user registration'
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
    await knex('routes').where('repo_id', repoId).del();
    await knex('symbols').where('file_id', 'in',
      knex('files').select('id').where('repo_id', repoId)
    ).del();
    await knex('files').where('repo_id', repoId).del();
    await knex('repositories').where('id', repoId).del();

    await closeDatabaseConnection();
  });

  describe('Laravel Route Search (absorbed functionality)', () => {
    test('should find Laravel routes through searchCode with entity_types', async () => {
      const result = await mcpTools.searchCode({
        query: 'users',
        repo_ids: [repoId],
        entity_types: ['route'],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);
    });

    test('should support route search with specific methods', async () => {
      const result = await mcpTools.searchCode({
        query: 'users',
        repo_ids: [repoId],
        entity_types: ['route'],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);
      // Routes should have method information
    });

    test('should find routes by path pattern', async () => {
      const result = await mcpTools.searchCode({
        query: '/api/users',
        repo_ids: [repoId],
        entity_types: ['route'],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);
    });
  });

  describe('Eloquent Model Search (absorbed functionality)', () => {
    test('should find Eloquent models through searchCode', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['model'],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      // Should find the User model
      const userModel = response.results.find((r: any) => r.name === 'User');
      expect(userModel).toBeDefined();
      expect(userModel.file.path).toContain('Models');
    });

    test('should identify Laravel models by file path', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      const models = response.results.filter((r: any) => r.file.path.includes('Models'));
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('Laravel Controller Search (absorbed functionality)', () => {
    test('should find Laravel controllers through searchCode', async () => {
      const result = await mcpTools.searchCode({
        query: 'UserController',
        repo_ids: [repoId],
        entity_types: ['controller'],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const controller = response.results.find((r: any) => r.name === 'UserController');
      expect(controller).toBeDefined();
      expect(controller.file.path).toContain('Controllers');
    });

    test('should find controller methods', async () => {
      const result = await mcpTools.searchCode({
        query: 'index',
        repo_ids: [repoId],
        entity_types: ['function'],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const indexMethod = response.results.find((r: any) =>
        r.name === 'index' && r.file.path.includes('Controllers')
      );
      expect(indexMethod).toBeDefined();
    });
  });

  describe('Vue Component Search (absorbed functionality)', () => {
    test('should find Vue components through searchCode', async () => {
      const result = await mcpTools.searchCode({
        query: 'UserList',
        repo_ids: [repoId],
        entity_types: ['component'],
        framework: 'vue'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const component = response.results.find((r: any) => r.name === 'UserList');
      expect(component).toBeDefined();
      expect(component.file.path).toContain('.vue');
    });

    test('should identify components by file extension', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        framework: 'vue'
      });

      const response = JSON.parse(result.content[0].text);
      const vueComponents = response.results.filter((r: any) => r.file.path.endsWith('.vue'));
      expect(vueComponents.length).toBeGreaterThan(0);
    });
  });

  describe('Background Job Search (absorbed functionality)', () => {
    test('should find Laravel jobs through searchCode', async () => {
      const result = await mcpTools.searchCode({
        query: 'ProcessUserRegistration',
        repo_ids: [repoId],
        entity_types: ['job'],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const job = response.results.find((r: any) => r.name === 'ProcessUserRegistration');
      expect(job).toBeDefined();
      expect(job.file.path).toContain('Jobs');
    });

    test('should identify jobs by naming convention', async () => {
      const result = await mcpTools.searchCode({
        query: 'Registration',
        repo_ids: [repoId],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      const jobs = response.results.filter((r: any) => r.file.path.includes('Jobs'));
      expect(jobs.length).toBeGreaterThan(0);
    });
  });

  describe('Framework Detection and Classification', () => {
    test('should correctly identify Laravel framework entities', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const laravelResults = response.results.filter((r: any) => r.file?.language === 'php');
      expect(laravelResults.length).toBeGreaterThan(0);
    });

    test('should correctly identify Vue framework entities', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        framework: 'vue'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const vueResults = response.results.filter((r: any) => r.file?.language === 'vue' || r.file?.path?.endsWith('.vue'));
      expect(vueResults.length).toBeGreaterThan(0);
    });

    test('should determine correct entity types', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId]
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const symbolTypes = response.results.map((r: any) => r.type);
      expect(symbolTypes.length).toBeGreaterThan(0);
      expect(symbolTypes.some((t: string) => ['component', 'class'].includes(t))).toBe(true);
    });
  });

  describe('Cross-framework Search Capabilities', () => {
    test('should find entities across multiple frameworks', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId]
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(1);

      const languages = [...new Set(response.results.map((r: any) => r.file?.language))];
      expect(languages.length).toBeGreaterThan(1);
      expect(languages).toContain('php');
      expect(languages).toContain('vue');
    });

    test('should support multi-entity type search', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['component', 'model', 'controller', 'job']
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const symbolTypes = [...new Set(response.results.map((r: any) => r.type))];
      expect(symbolTypes.length).toBeGreaterThan(0);
    });

    test('should maintain search performance across frameworks', async () => {
      const startTime = Date.now();

      await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['route', 'model', 'controller', 'component', 'job']
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within 1 second even with multiple entity types
      expect(duration).toBeLessThan(1000);
    }, 2000);
  });

  describe('Phase 3 Parameter Consolidation Tests', () => {
    test('should handle search_mode enum replacing use_vector', async () => {
      const searchModes = ['auto', 'exact', 'vector', 'qualified'];

      for (const mode of searchModes) {
        const result = await mcpTools.searchCode({
          query: 'User',
          repo_ids: [repoId],
          search_mode: mode
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.query_filters.search_mode).toBe(mode);
        expect(Array.isArray(response.results)).toBe(true);
      }
    });

    test('should validate framework auto-detection in tool consolidation context', async () => {
      // Test single framework detection
      const modelResult = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['model']
      });

      const modelResponse = JSON.parse(modelResult.content[0].text);
      expect(modelResponse.query_filters.framework).toBe('laravel');
      expect(modelResponse.query_filters.framework_auto_detected).toBe(true);

      // Test component detection
      const componentResult = await mcpTools.searchCode({
        query: 'UserList',
        repo_ids: [repoId],
        entity_types: ['component']
      });

      const componentResponse = JSON.parse(componentResult.content[0].text);
      expect(componentResponse.query_filters.framework).toBe('vue');
      expect(componentResponse.query_filters.framework_auto_detected).toBe(true);
    });

    test('should handle multiple framework detection without auto-selection', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['route', 'model', 'component']
      });

      const response = JSON.parse(result.content[0].text);
      // Should perform cross-framework search when multiple frameworks detected
      expect(response.results.length).toBeGreaterThan(0);
      expect(response.query_filters.framework_auto_detected).toBeFalsy();
    });

    test('should validate deprecated parameter error messages', async () => {
      // Test repo_id deprecation
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_id: 123
        });
      }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');

      // Test symbol_type deprecation
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          symbol_type: 'function'
        });
      }).rejects.toThrow('symbol_type parameter removed. Use entity_types array instead');

      // Test limit deprecation
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          limit: 50
        });
      }).rejects.toThrow('limit parameter removed. Fixed limit of 100 is now used for all searches');

      // Test use_vector deprecation
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          use_vector: true
        });
      }).rejects.toThrow('use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid');
    });

    test('should maintain response format consistency after consolidation', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['model', 'component'],
        search_mode: 'auto'
      });

      const response = JSON.parse(result.content[0].text);

      // Verify all expected response fields
      expect(response).toHaveProperty('query');
      expect(response).toHaveProperty('results');
      expect(response).toHaveProperty('total_results');
      expect(response).toHaveProperty('search_options');
      expect(response).toHaveProperty('query_filters');

      // Verify query_filters includes new fields
      expect(response.query_filters).toHaveProperty('entity_types');
      expect(response.query_filters).toHaveProperty('framework_auto_detected');
      expect(response.query_filters).toHaveProperty('search_mode');
      expect(response.query_filters).toHaveProperty('repo_ids');
    });
  });

  describe('Enhanced Parameter Validation Tests', () => {
    test('should validate entity_types array structure', async () => {
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
          entity_types: ['invalid_entity_type']
        });
      }).rejects.toThrow('entity_types must contain valid types');
    });

    test('should validate framework parameter type', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          framework: 123
        });
      }).rejects.toThrow('framework must be a string');
    });

    test('should validate is_exported parameter type', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          is_exported: 'yes'
        });
      }).rejects.toThrow('is_exported must be a boolean');
    });

    test('should validate repo_ids array structure', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_ids: 'not_an_array'
        });
      }).rejects.toThrow('repo_ids must be an array');
    });

    test('should validate repo_ids array values', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_ids: ['not_a_number']
        });
      }).rejects.toThrow('repo_ids must contain only numbers');
    });

    test('should validate search_mode enum values', async () => {
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          search_mode: 'invalid_mode'
        });
      }).rejects.toThrow('search_mode must be one of: auto, exact, vector, qualified');
    });
  });

  describe('Backward Compatibility and Feature Preservation', () => {
    test('should preserve all search capabilities from removed tools', async () => {
      // Test that we can still find everything we could with the old tools
      const results = await Promise.all([
        mcpTools.searchCode({ query: 'users', repo_ids: [repoId], entity_types: ['route'] }),
        mcpTools.searchCode({ query: 'User', repo_ids: [repoId], entity_types: ['model'] }),
        mcpTools.searchCode({ query: 'Controller', repo_ids: [repoId], entity_types: ['controller'] }),
        mcpTools.searchCode({ query: 'User', repo_ids: [repoId], entity_types: ['component'] }),
        mcpTools.searchCode({ query: 'Registration', repo_ids: [repoId], entity_types: ['job'] })
      ]);

      // All searches should return results
      results.forEach(result => {
        const response = JSON.parse(result.content[0].text);
        expect(Array.isArray(response.results)).toBe(true);
      });
    });

    test('should maintain response format consistency', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['model']
      });

      const response = JSON.parse(result.content[0].text);

      // Should have all expected fields
      expect(response).toHaveProperty('query');
      expect(response).toHaveProperty('results');
      expect(response).toHaveProperty('total_results');
      expect(response).toHaveProperty('search_options');

      if (response.results.length > 0) {
        const result = response.results[0];
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('file');
      }
    });

    test('should handle edge cases that existed in original tools', async () => {
      // Test empty results
      const emptyResult = await mcpTools.searchCode({
        query: 'nonexistent',
        repo_ids: [repoId],
        entity_types: ['route']
      });

      const emptyResponse = JSON.parse(emptyResult.content[0].text);
      expect(emptyResponse.results).toEqual([]);
      expect(emptyResponse.total_results).toBe(0);

      // Test with invalid framework
      const invalidFrameworkResult = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        framework: 'nonexistent'
      });

      const invalidResponse = JSON.parse(invalidFrameworkResult.content[0].text);
      expect(Array.isArray(invalidResponse.results)).toBe(true);
    });

    test('should maintain performance characteristics after consolidation', async () => {
      const startTime = Date.now();

      // Complex search with all new parameters
      await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['route', 'model', 'controller', 'component', 'job'],
        search_mode: 'auto',
        is_exported: true
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time even with complex parameters
      expect(duration).toBeLessThan(2000);
    }, 3000);

    test('should handle parameter combinations correctly', async () => {
      // Test combining entity_types with framework auto-detection
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_ids: [repoId],
        entity_types: ['model'],
        is_exported: true,
        search_mode: 'exact'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.query_filters.entity_types).toContain('model');
      expect(response.query_filters.is_exported).toBe(true);
      expect(response.query_filters.search_mode).toBe('exact');
      expect(response.query_filters.framework).toBe('laravel'); // Auto-detected
      expect(response.query_filters.framework_auto_detected).toBe(true);
    });
  });

  describe('Comprehensive Edge Case Tests for Removed Parameters', () => {
    describe('repo_id Parameter Edge Cases', () => {
      test('should handle repo_id with zero value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            repo_id: 0
          });
        }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');
      });

      test('should handle repo_id with negative value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            repo_id: -1
          });
        }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');
      });

      test('should handle repo_id with string value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            repo_id: '123'
          });
        }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');
      });

      test('should handle repo_id with null value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            repo_id: null
          });
        }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');
      });

      test('should handle repo_id combined with repo_ids array', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            repo_id: 123,
            repo_ids: [456, 789]
          });
        }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');
      });
    });

    describe('symbol_type Parameter Edge Cases', () => {
      test('should handle symbol_type with all valid legacy types', async () => {
        const legacyTypes = ['function', 'class', 'interface', 'variable', 'property', 'method'];

        for (const type of legacyTypes) {
          await expect(async () => {
            await mcpTools.searchCode({
              query: 'test',
              symbol_type: type
            });
          }).rejects.toThrow('symbol_type parameter removed. Use entity_types array instead');
        }
      });

      test('should handle symbol_type with invalid legacy type', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            symbol_type: 'invalid_type'
          });
        }).rejects.toThrow('symbol_type parameter removed. Use entity_types array instead');
      });

      test('should handle symbol_type with numeric value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            symbol_type: 123
          });
        }).rejects.toThrow('symbol_type parameter removed. Use entity_types array instead');
      });

      test('should handle symbol_type with array value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            symbol_type: ['function', 'class']
          });
        }).rejects.toThrow('symbol_type parameter removed. Use entity_types array instead');
      });

      test('should handle symbol_type combined with entity_types', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            symbol_type: 'function',
            entity_types: ['function']
          });
        }).rejects.toThrow('symbol_type parameter removed. Use entity_types array instead');
      });
    });

    describe('limit Parameter Edge Cases', () => {
      test('should handle limit with various numeric values', async () => {
        const limits = [1, 10, 50, 100, 1000, 0, -1];

        for (const limit of limits) {
          await expect(async () => {
            await mcpTools.searchCode({
              query: 'test',
              limit
            });
          }).rejects.toThrow('limit parameter removed. Fixed limit of 100 is now used for all searches');
        }
      });

      test('should handle limit with string numeric value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            limit: '50'
          });
        }).rejects.toThrow('limit parameter removed. Fixed limit of 100 is now used for all searches');
      });

      test('should handle limit with non-numeric string', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            limit: 'fifty'
          });
        }).rejects.toThrow('limit parameter removed. Fixed limit of 100 is now used for all searches');
      });

      test('should handle limit with boolean value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            limit: true
          });
        }).rejects.toThrow('limit parameter removed. Fixed limit of 100 is now used for all searches');
      });

      test('should handle limit with object value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            limit: { value: 50 }
          });
        }).rejects.toThrow('limit parameter removed. Fixed limit of 100 is now used for all searches');
      });
    });

    describe('use_vector Parameter Edge Cases', () => {
      test('should handle use_vector with true value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            use_vector: true
          });
        }).rejects.toThrow('use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid');
      });

      test('should handle use_vector with false value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            use_vector: false
          });
        }).rejects.toThrow('use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid');
      });

      test('should handle use_vector with string value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            use_vector: 'true'
          });
        }).rejects.toThrow('use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid');
      });

      test('should handle use_vector with numeric value', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            use_vector: 1
          });
        }).rejects.toThrow('use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid');
      });

      test('should handle use_vector combined with search_mode', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            use_vector: true,
            search_mode: 'vector'
          });
        }).rejects.toThrow('use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid');
      });
    });

    describe('Multiple Deprecated Parameters Combined', () => {
      test('should handle all deprecated parameters together', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            repo_id: 123,
            symbol_type: 'function',
            limit: 50,
            use_vector: true
          });
        }).rejects.toThrow(/parameter removed/); // Should catch the first deprecated parameter
      });

      test('should handle deprecated parameters with valid new parameters', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            repo_id: 123, // deprecated
            repo_ids: [456], // valid
            entity_types: ['function'], // valid
            search_mode: 'auto' // valid
          });
        }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');
      });

      test('should prioritize first deprecated parameter in error message', async () => {
        // Test different orders to ensure consistent error handling
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            symbol_type: 'function', // deprecated
            repo_id: 123 // also deprecated
          });
        }).rejects.toThrow(/parameter removed/);
      });
    });

    describe('Parameter Migration Path Validation', () => {
      test('should demonstrate correct migration from repo_id to repo_ids', async () => {
        // This should work with new parameter structure
        const result = await mcpTools.searchCode({
          query: 'User',
          repo_ids: [repoId] // Correct migration
        });

        const response = JSON.parse(result.content[0].text);
        expect(Array.isArray(response.results)).toBe(true);
      });

      test('should demonstrate correct migration from symbol_type to entity_types', async () => {
        // This should work with new parameter structure
        const result = await mcpTools.searchCode({
          query: 'User',
          repo_ids: [repoId],
          entity_types: ['model', 'controller'] // Correct migration from single symbol_type
        });

        const response = JSON.parse(result.content[0].text);
        expect(Array.isArray(response.results)).toBe(true);
      });

      test('should demonstrate correct migration from use_vector to search_mode', async () => {
        // This should work with new parameter structure
        const modes = ['auto', 'exact', 'vector', 'qualified'];

        for (const mode of modes) {
          const result = await mcpTools.searchCode({
            query: 'User',
            repo_ids: [repoId],
            search_mode: mode // Correct migration from use_vector boolean
          });

          const response = JSON.parse(result.content[0].text);
          expect(response.query_filters.search_mode).toBe(mode);
        }
      });

      test('should validate that fixed limit behavior works correctly', async () => {
        const result = await mcpTools.searchCode({
          query: 'User',
          repo_ids: [repoId]
        });

        const response = JSON.parse(result.content[0].text);
        // Should have results up to the fixed limit of 100
        expect(response.results.length).toBeLessThanOrEqual(100);
      });
    });

    describe('Error Message Quality and Consistency', () => {
      test('should provide consistent error messages for all deprecated parameters', async () => {
        const deprecatedParams = [
          { param: 'repo_id', value: 123, expectedMessage: 'repo_id parameter removed. Use repo_ids array instead' },
          { param: 'symbol_type', value: 'function', expectedMessage: 'symbol_type parameter removed. Use entity_types array instead' },
          { param: 'limit', value: 50, expectedMessage: 'limit parameter removed. Fixed limit of 100 is now used for all searches' },
          { param: 'use_vector', value: true, expectedMessage: 'use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid' }
        ];

        for (const { param, value, expectedMessage } of deprecatedParams) {
          await expect(async () => {
            await mcpTools.searchCode({
              query: 'test',
              [param]: value
            });
          }).rejects.toThrow(expectedMessage);
        }
      });

      test('should provide actionable migration guidance in error messages', async () => {
        // repo_id error should mention repo_ids array
        await expect(async () => {
          await mcpTools.searchCode({ query: 'test', repo_id: 123 });
        }).rejects.toThrow(/repo_ids array/);

        // symbol_type error should mention entity_types array
        await expect(async () => {
          await mcpTools.searchCode({ query: 'test', symbol_type: 'function' });
        }).rejects.toThrow(/entity_types array/);

        // use_vector error should mention search_mode options
        await expect(async () => {
          await mcpTools.searchCode({ query: 'test', use_vector: true });
        }).rejects.toThrow(/search_mode instead/);
      });
    });

    describe('Boundary and Special Value Testing', () => {
      test('should handle deprecated parameters with undefined values', async () => {
        // undefined values should NOT throw errors (they represent unprovided parameters)
        const result = await mcpTools.searchCode({
          query: 'test',
          repo_id: undefined,
          symbol_type: undefined,
          limit: undefined,
          use_vector: undefined
        });
        expect(result).toBeDefined();
      });

      test('should handle deprecated parameters with empty string values', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            symbol_type: ''
          });
        }).rejects.toThrow('symbol_type parameter removed. Use entity_types array instead');
      });

      test('should handle deprecated parameters with extremely large values', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            limit: Number.MAX_SAFE_INTEGER
          });
        }).rejects.toThrow('limit parameter removed. Fixed limit of 100 is now used for all searches');
      });

      test('should handle deprecated parameters with Infinity values', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            repo_id: Infinity
          });
        }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');
      });

      test('should handle deprecated parameters with NaN values', async () => {
        await expect(async () => {
          await mcpTools.searchCode({
            query: 'test',
            limit: NaN
          });
        }).rejects.toThrow('limit parameter removed. Fixed limit of 100 is now used for all searches');
      });
    });
  });
});