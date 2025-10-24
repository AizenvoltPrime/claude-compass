import { describe, beforeAll, afterAll, test, expect } from '@jest/globals';
import { McpTools } from '../../src/mcp/tools';
import { DatabaseService } from '../../src/database/services';
import { getDatabaseConnection, closeDatabaseConnection } from '../../src/database/connection';
import { SymbolType } from '../../src/database/models';
import { Knex } from 'knex';

describe('Feature Discovery - Structural Parents', () => {
  let mcpTools: McpTools;
  let dbService: DatabaseService;
  let knex: Knex;
  let repoId: number;

  beforeAll(async () => {
    knex = getDatabaseConnection();
    dbService = new DatabaseService();
    mcpTools = new McpTools(dbService);

    const repo = await dbService.createRepository({
      name: 'test-structural-parents',
      path: '/test/structural-parents',
      framework_stack: ['vue', 'typescript']
    });
    repoId = repo.id;

    const storeFile = await dbService.createFile({
      repo_id: repoId,
      path: '/test/stores/personnelStore.ts',
      language: 'typescript',
      is_generated: false,
      is_test: false
    });

    const componentFile = await dbService.createFile({
      repo_id: repoId,
      path: '/test/components/PersonnelForm.vue',
      language: 'vue',
      is_generated: false,
      is_test: false
    });

    const storeSymbol = await dbService.createSymbol({
      file_id: storeFile.id,
      name: 'usePersonnelStore',
      symbol_type: SymbolType.FUNCTION,
      entity_type: 'store',
      is_exported: true,
      signature: 'const usePersonnelStore = defineStore(...)',
      start_line: 12,
      end_line: 107
    });

    const createMethodSymbol = await dbService.createSymbol({
      file_id: storeFile.id,
      name: 'createPersonnel',
      symbol_type: SymbolType.FUNCTION,
      entity_type: 'method',
      is_exported: false,
      signature: 'async createPersonnel(data: Personnel)',
      start_line: 45,
      end_line: 52
    });

    const updateMethodSymbol = await dbService.createSymbol({
      file_id: storeFile.id,
      name: 'updatePersonnel',
      symbol_type: SymbolType.FUNCTION,
      entity_type: 'method',
      is_exported: false,
      signature: 'async updatePersonnel(id: number, data: Personnel)',
      start_line: 54,
      end_line: 61
    });

    const componentSymbol = await dbService.createSymbol({
      file_id: componentFile.id,
      name: 'PersonnelForm',
      symbol_type: SymbolType.COMPONENT,
      entity_type: 'component',
      is_exported: true,
      signature: 'export default defineComponent(...)',
      start_line: 1,
      end_line: 150
    });

    await knex('dependencies').insert({
      from_symbol_id: storeSymbol.id,
      to_symbol_id: createMethodSymbol.id,
      dependency_type: 'contains',
      file_id: storeFile.id
    });

    await knex('dependencies').insert({
      from_symbol_id: storeSymbol.id,
      to_symbol_id: updateMethodSymbol.id,
      dependency_type: 'contains',
      file_id: storeFile.id
    });

    await knex('dependencies').insert({
      from_symbol_id: componentSymbol.id,
      to_symbol_id: createMethodSymbol.id,
      dependency_type: 'calls',
      file_id: componentFile.id
    });

    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    await knex('dependencies').where('file_id', 'in',
      knex('files').select('id').where('repo_id', repoId)
    ).del();
    await knex('symbols').where('file_id', 'in',
      knex('files').select('id').where('repo_id', repoId)
    ).del();
    await knex('files').where('repo_id', repoId).del();
    await knex('repositories').where('id', repoId).del();

    await closeDatabaseConnection();
  });

  test('should discover structural parent (store) when starting from method', async () => {
    const symbols = await dbService.searchSymbols('createPersonnel', repoId);
    const createMethod = symbols.find(s => s.name === 'createPersonnel');
    expect(createMethod).toBeDefined();

    const result = await mcpTools.discoverFeature({
      symbol_id: createMethod!.id,
      max_depth: 5
    });

    expect(result.content).toBeDefined();
    const response = JSON.parse(result.content[0].text);

    expect(response.frontend.stores.length).toBe(1);
    const store = response.frontend.stores[0];
    expect(store.name).toBe('usePersonnelStore');
    expect(store.entity_type).toBe('store');
  });

  test('should NOT discover updatePersonnel (noise) when starting from createPersonnel', async () => {
    const symbols = await dbService.searchSymbols('createPersonnel', repoId);
    const createMethod = symbols.find(s => s.name === 'createPersonnel');
    expect(createMethod).toBeDefined();

    const result = await mcpTools.discoverFeature({
      symbol_id: createMethod!.id,
      max_depth: 5
    });

    const response = JSON.parse(result.content[0].text);

    const allSymbols = [
      ...response.frontend.components,
      ...response.frontend.stores,
      ...response.frontend.composables,
      ...response.backend.controllers,
      ...response.backend.services,
      ...response.backend.models
    ];

    const updateMethod = allSymbols.find((s: any) => s.name === 'updatePersonnel');
    expect(updateMethod).toBeUndefined();
  });

  test('should discover exactly 1 component (no noise from store traversal)', async () => {
    const symbols = await dbService.searchSymbols('createPersonnel', repoId);
    const createMethod = symbols.find(s => s.name === 'createPersonnel');
    expect(createMethod).toBeDefined();

    const result = await mcpTools.discoverFeature({
      symbol_id: createMethod!.id,
      max_depth: 5
    });

    const response = JSON.parse(result.content[0].text);

    expect(response.frontend.components.length).toBe(1);
    const component = response.frontend.components[0];
    expect(component.name).toBe('PersonnelForm');
  });

  test('should assign high relevance (1.0) to structural parent store', async () => {
    const symbols = await dbService.searchSymbols('createPersonnel', repoId);
    const createMethod = symbols.find(s => s.name === 'createPersonnel');
    expect(createMethod).toBeDefined();

    const result = await mcpTools.discoverFeature({
      symbol_id: createMethod!.id,
      max_depth: 5
    });

    const response = JSON.parse(result.content[0].text);

    const store = response.frontend.stores[0];
    expect(store.relevance).toBe(1.0);
  });

  test('should include store in results but not expand its other methods', async () => {
    const symbols = await dbService.searchSymbols('createPersonnel', repoId);
    const createMethod = symbols.find(s => s.name === 'createPersonnel');
    expect(createMethod).toBeDefined();

    const result = await mcpTools.discoverFeature({
      symbol_id: createMethod!.id,
      max_depth: 5
    });

    const response = JSON.parse(result.content[0].text);

    expect(response.frontend.stores.length).toBe(1);

    const allSymbols = [
      ...response.frontend.components,
      ...response.frontend.stores,
      ...response.frontend.composables
    ];

    expect(allSymbols.length).toBe(2);
    const symbolNames = allSymbols.map((s: any) => s.name);
    expect(symbolNames).toContain('PersonnelForm');
    expect(symbolNames).toContain('usePersonnelStore');
    expect(symbolNames).not.toContain('updatePersonnel');
  });
});
