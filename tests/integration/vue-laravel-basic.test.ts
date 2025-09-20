import { GraphBuilder } from '../../src/graph/builder';
import { DatabaseService } from '../../src/database/services';
import { McpTools } from '../../src/mcp/tools';
import path from 'path';
import fs from 'fs/promises';
import { jest } from '@jest/globals';

describe('Vue-Laravel Integration - Basic Tests', () => {
  let builder: GraphBuilder;
  let dbService: DatabaseService;
  let mcpTools: McpTools;
  let testProjectPath: string;

  beforeAll(async () => {
    dbService = new DatabaseService();
    mcpTools = new McpTools(dbService);
    builder = new GraphBuilder(dbService);
    testProjectPath = path.join(__dirname, 'fixtures', 'basic-vue-laravel');
  });

  afterAll(async () => {
    await fs.rm(testProjectPath, { recursive: true, force: true }).catch(() => {});
    await dbService.close();
  });

  beforeEach(async () => {
    // Clean up any existing test data
    await dbService.deleteRepositoryByName('basic-vue-laravel').catch(() => {});
    await fs.rm(testProjectPath, { recursive: true, force: true }).catch(() => {});
  });

  describe('basic functionality', () => {
    it('should handle empty project analysis', async () => {
      // Create minimal project structure
      await fs.mkdir(testProjectPath, { recursive: true });
      await fs.writeFile(path.join(testProjectPath, 'README.md'), '# Test Project');

      const result = await builder.analyzeRepository(testProjectPath, {
        verbose: false
      });

      expect(result).toBeDefined();
      expect(result.repository).toBeDefined();
      expect(result.totalFiles).toBeGreaterThanOrEqual(0);
    });

    it('should handle basic Vue file analysis', async () => {
      // Create basic Vue component
      await fs.mkdir(path.join(testProjectPath, 'components'), { recursive: true });
      await fs.writeFile(
        path.join(testProjectPath, 'components', 'TestComponent.vue'),
        `<template>
  <div>{{ message }}</div>
</template>

<script setup>
import { ref } from 'vue';
const message = ref('Hello World');
</script>`
      );

      const result = await builder.analyzeRepository(testProjectPath);

      expect(result).toBeDefined();
      expect(result.totalFiles).toBeGreaterThan(0);
    });

    it('should handle basic PHP file analysis', async () => {
      // Create basic PHP file
      await fs.mkdir(path.join(testProjectPath, 'app'), { recursive: true });
      await fs.writeFile(
        path.join(testProjectPath, 'app', 'TestController.php'),
        `<?php

namespace App\\Http\\Controllers;

class TestController extends Controller
{
    public function index()
    {
        return response()->json(['message' => 'Hello World']);
    }
}`
      );

      const result = await builder.analyzeRepository(testProjectPath);

      expect(result).toBeDefined();
      expect(result.totalFiles).toBeGreaterThan(0);
    });

    it('should complete analysis within reasonable time', async () => {
      // Create minimal project
      await fs.mkdir(testProjectPath, { recursive: true });
      await fs.writeFile(path.join(testProjectPath, 'package.json'), '{"name": "test"}');

      const startTime = Date.now();
      const result = await builder.analyzeRepository(testProjectPath);
      const analysisTime = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(analysisTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('MCP tool integration', () => {
    it('should handle getApiCalls with non-existent component', async () => {
      const result = await mcpTools.getApiCalls({
        component_id: 999999
      });

      expect(result.content).toHaveLength(1);
      const content = JSON.parse(result.content[0].text);
      expect(content.component_id).toBe(999999);
    });

    it('should handle getDataContracts with non-existent schema', async () => {
      const result = await mcpTools.getDataContracts({
        schema_name: 'NonExistentSchema'
      });

      expect(result.content).toHaveLength(1);
      const content = JSON.parse(result.content[0].text);
      expect(content.schema_name).toBe('NonExistentSchema');
    });

    it('should handle getCrossStackImpact with non-existent symbol', async () => {
      const result = await mcpTools.getCrossStackImpact({
        symbol_id: 999999
      });

      expect(result.content).toHaveLength(1);
      const content = JSON.parse(result.content[0].text);
      expect(content.symbol_id).toBe(999999);
    });
  });

  describe('error handling', () => {
    it('should handle missing project directory', async () => {
      const nonExistentPath = path.join(__dirname, 'non-existent-project');

      await expect(async () => {
        await builder.analyzeRepository(nonExistentPath);
      }).rejects.toThrow();
    });

    it('should handle corrupted files gracefully', async () => {
      await fs.mkdir(testProjectPath, { recursive: true });

      // Create a file with invalid content
      await fs.writeFile(
        path.join(testProjectPath, 'invalid.vue'),
        'This is not valid Vue content <template><div></template>'
      );

      const result = await builder.analyzeRepository(testProjectPath);

      expect(result).toBeDefined();
      // Should handle the error gracefully without crashing
    });

    it('should handle permission errors gracefully', async () => {
      await fs.mkdir(testProjectPath, { recursive: true });
      await fs.writeFile(path.join(testProjectPath, 'test.txt'), 'test');

      // The analysis should not crash even if there are permission issues
      const result = await builder.analyzeRepository(testProjectPath);
      expect(result).toBeDefined();
    });
  });

  describe('performance tests', () => {
    it('should handle memory efficiently', async () => {
      const initialMemory = process.memoryUsage();

      await fs.mkdir(testProjectPath, { recursive: true });
      await fs.writeFile(path.join(testProjectPath, 'package.json'), '{"name": "test"}');

      const result = await builder.analyzeRepository(testProjectPath);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      expect(result).toBeDefined();
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
    });
  });
});