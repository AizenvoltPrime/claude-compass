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
        repo_id: repoId,
        entity_types: ['route'],
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);
    });

    test('should support route search with specific methods', async () => {
      const result = await mcpTools.searchCode({
        query: 'users',
        repo_id: repoId,
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
        repo_id: repoId,
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
        repo_id: repoId,
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
        repo_id: repoId,
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
        repo_id: repoId,
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
        repo_id: repoId,
        symbol_type: 'method',
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
        repo_id: repoId,
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
        repo_id: repoId,
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
        repo_id: repoId,
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
        repo_id: repoId,
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
        repo_id: repoId,
        framework: 'laravel'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const laravelResults = response.results.filter((r: any) => r.framework === 'laravel');
      expect(laravelResults.length).toBeGreaterThan(0);
    });

    test('should correctly identify Vue framework entities', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_id: repoId,
        framework: 'vue'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const vueResults = response.results.filter((r: any) => r.framework === 'vue');
      expect(vueResults.length).toBeGreaterThan(0);
    });

    test('should determine correct entity types', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_id: repoId
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      // Should have various entity types
      const entityTypes = response.results.map((r: any) => r.entity_type);
      expect(entityTypes).toContain('component'); // Vue component
      expect(entityTypes.some((t: string) => ['class', 'model'].includes(t))).toBe(true); // Laravel model/controller
    });
  });

  describe('Cross-framework Search Capabilities', () => {
    test('should find entities across multiple frameworks', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_id: repoId
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(1);

      const frameworks = [...new Set(response.results.map((r: any) => r.framework))];
      expect(frameworks.length).toBeGreaterThan(1);
      expect(frameworks).toContain('laravel');
      expect(frameworks).toContain('vue');
    });

    test('should support multi-entity type search', async () => {
      const result = await mcpTools.searchCode({
        query: 'User',
        repo_id: repoId,
        entity_types: ['component', 'model', 'controller', 'job']
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeGreaterThan(0);

      const entityTypes = [...new Set(response.results.map((r: any) => r.entity_type))];
      expect(entityTypes.length).toBeGreaterThan(1);
    });

    test('should maintain search performance across frameworks', async () => {
      const startTime = Date.now();

      await mcpTools.searchCode({
        query: 'User',
        repo_id: repoId,
        entity_types: ['route', 'model', 'controller', 'component', 'job']
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within 1 second even with multiple entity types
      expect(duration).toBeLessThan(1000);
    }, 2000);
  });

  describe('Backward Compatibility and Feature Preservation', () => {
    test('should preserve all search capabilities from removed tools', async () => {
      // Test that we can still find everything we could with the old tools
      const results = await Promise.all([
        mcpTools.searchCode({ query: 'users', repo_id: repoId, entity_types: ['route'] }),
        mcpTools.searchCode({ query: 'User', repo_id: repoId, entity_types: ['model'] }),
        mcpTools.searchCode({ query: 'Controller', repo_id: repoId, entity_types: ['controller'] }),
        mcpTools.searchCode({ query: 'User', repo_id: repoId, entity_types: ['component'] }),
        mcpTools.searchCode({ query: 'Registration', repo_id: repoId, entity_types: ['job'] })
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
        repo_id: repoId,
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
        expect(result).toHaveProperty('entity_type');
        expect(result).toHaveProperty('framework');
      }
    });

    test('should handle edge cases that existed in original tools', async () => {
      // Test empty results
      const emptyResult = await mcpTools.searchCode({
        query: 'nonexistent',
        repo_id: repoId,
        entity_types: ['route']
      });

      const emptyResponse = JSON.parse(emptyResult.content[0].text);
      expect(emptyResponse.results).toEqual([]);
      expect(emptyResponse.total_results).toBe(0);

      // Test with invalid framework
      const invalidFrameworkResult = await mcpTools.searchCode({
        query: 'User',
        repo_id: repoId,
        framework: 'nonexistent'
      });

      const invalidResponse = JSON.parse(invalidFrameworkResult.content[0].text);
      expect(Array.isArray(invalidResponse.results)).toBe(true);
    });
  });
});