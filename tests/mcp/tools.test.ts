import { McpTools } from '../../src/mcp/tools';
import { DatabaseService } from '../../src/database/services';
import { SymbolType } from '../../src/database/models';

// Mock the database service
const mockDatabaseService = {
  getFileWithRepository: jest.fn(),
  getFileByPath: jest.fn(),
  getSymbolWithFile: jest.fn(),
  getSymbol: jest.fn(),
  getSymbolsByFile: jest.fn(),
  getDependenciesFrom: jest.fn(),
  getDependenciesTo: jest.fn(),
  getDependenciesToWithContext: jest.fn(),
  searchSymbols: jest.fn(),
  fulltextSearchSymbols: jest.fn(),
  getRepository: jest.fn(),
  vectorSearchSymbols: jest.fn(),
  searchQualifiedContext: jest.fn(),
  groupCallsByParameterContext: jest.fn(),
  lexicalSearchSymbols: jest.fn(),
  searchMethodSignatures: jest.fn(),
} as unknown as DatabaseService;

describe('McpTools', () => {
  let mcpTools: McpTools;

  beforeEach(() => {
    jest.clearAllMocks();
    mcpTools = new McpTools(mockDatabaseService);

    // Setup default mock returns for the new methods
    (mockDatabaseService.lexicalSearchSymbols as jest.Mock).mockResolvedValue([]);
    (mockDatabaseService.searchMethodSignatures as jest.Mock).mockResolvedValue([]);
    (mockDatabaseService.groupCallsByParameterContext as jest.Mock).mockResolvedValue({ totalCalls: 0, variations: [] });
  });

  describe('getFile', () => {
    it('should get file by ID with symbols', async () => {
      const mockFile = {
        id: 1,
        path: '/test/file.js',
        language: 'javascript',
        size: 1000,
        last_modified: new Date(),
        is_test: false,
        is_generated: false,
        repository: {
          name: 'test-repo',
          path: '/test',
        },
      };

      const mockSymbols = [
        {
          id: 1,
          name: 'testFunction',
          entity_types: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 5,
          is_exported: true,
          signature: 'function testFunction() {}',
        },
      ];

      (mockDatabaseService.getFileWithRepository as jest.Mock).mockResolvedValue(mockFile);
      (mockDatabaseService.getSymbolsByFile as jest.Mock).mockResolvedValue(mockSymbols);

      const result = await mcpTools.getFile({ file_id: 1 });

      expect(mockDatabaseService.getFileWithRepository).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getSymbolsByFile).toHaveBeenCalledWith(1);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const data = JSON.parse(result.content[0].text);
      expect(data.file.id).toBe(1);
      expect(data.file.path).toBe('/test/file.js');
      expect(data.symbols).toHaveLength(1);
      expect(data.symbols[0].name).toBe('testFunction');
      expect(data.symbol_count).toBe(1);
    });


    it('should throw error when file not found', async () => {
      (mockDatabaseService.getFileWithRepository as jest.Mock).mockResolvedValue(null);

      await expect(mcpTools.getFile({ file_id: 999 })).rejects.toThrow('File not found');
    });

    it('should throw error when neither file_id nor file_path provided', async () => {
      await expect(mcpTools.getFile({})).rejects.toThrow('Either file_id or file_path must be provided');
    });

    it('should get file by path', async () => {
      const mockFile = {
        id: 1,
        repo_id: 1,
        path: '/test.js',
        language: 'javascript',
        repository: { id: 1, name: 'test-repo', path: '/test' }
      };

      (mockDatabaseService.getFileByPath as jest.Mock).mockResolvedValue(mockFile);

      const result = await mcpTools.getFile({ file_path: '/test.js' });

      expect(mockDatabaseService.getFileByPath).toHaveBeenCalledWith('/test.js');

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const data = JSON.parse(result.content[0].text);
      expect(data.file.id).toBe(1);
      expect(data.file.path).toBe('/test.js');
    });

    it('should throw error for file not found by path', async () => {
      (mockDatabaseService.getFileByPath as jest.Mock).mockResolvedValue(null);

      await expect(mcpTools.getFile({ file_path: '/nonexistent.js' })).rejects.toThrow('File not found');
    });
  });

  describe('getSymbol', () => {
    it('should get symbol with dependencies and callers', async () => {
      const mockSymbol = {
        id: 1,
        name: 'testFunction',
        entity_types: SymbolType.FUNCTION,
        start_line: 1,
        end_line: 10,
        is_exported: true,
        signature: 'function testFunction() {}',
        file: {
          id: 1,
          path: '/test/file.js',
          language: 'javascript',
          repository: {
            name: 'test-repo',
            path: '/test',
          },
        },
      };

      const mockDependencies = [
        {
          id: 1,
          dependency_type: 'calls',
          line_number: 5,
          to_symbol: {
            id: 2,
            name: 'helperFunction',
            entity_types: SymbolType.FUNCTION,
            file: {
              path: '/test/utils.js',
            },
          },
        },
      ];

      const mockCallers = [
        {
          id: 2,
          dependency_type: 'calls',
          line_number: 12,
          from_symbol: {
            id: 3,
            name: 'mainFunction',
            entity_types: SymbolType.FUNCTION,
            file: {
              path: '/test/main.js',
            },
          },
        },
      ];

      (mockDatabaseService.getSymbolWithFile as jest.Mock).mockResolvedValue(mockSymbol);
      (mockDatabaseService.getDependenciesFrom as jest.Mock).mockResolvedValue(mockDependencies);
      (mockDatabaseService.getDependenciesTo as jest.Mock).mockResolvedValue(mockCallers);

      const result = await mcpTools.getSymbol({
        symbol_id: 1
      });

      expect(mockDatabaseService.getSymbolWithFile).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getDependenciesFrom).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getDependenciesTo).toHaveBeenCalledWith(1);

      const data = JSON.parse(result.content[0].text);
      expect(data.symbol.name).toBe('testFunction');

      // Results are now grouped by line number (per PARAMETER_REDUNDANCY_ANALYSIS)
      expect(typeof data.dependencies).toBe('object');
      expect(data.dependencies.line_5).toBeDefined();
      expect(data.dependencies.line_5.calls[0].target).toBe('utils.helperFunction');

      expect(typeof data.callers).toBe('object');
      expect(data.callers.line_12).toBeDefined();
      expect(data.callers.line_12.calls[0].target).toBe('main.mainFunction');
    });

    it('should throw error when symbol not found', async () => {
      (mockDatabaseService.getSymbolWithFile as jest.Mock).mockResolvedValue(null);

      await expect(mcpTools.getSymbol({ symbol_id: 999 })).rejects.toThrow('Symbol not found');
    });
  });

  describe('searchCode', () => {
    it('should search symbols with filters', async () => {
      // Only return symbols that match the filters (function type and exported)
      const mockSymbols = [
        {
          id: 1,
          name: 'testFunction',
          entity_types: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 10,
          is_exported: true,
          file: {
            id: 1,
            path: '/test/file.js',
            language: 'javascript',
          },
        },
      ];

      // Mock vector search to fail so it falls back to fulltext search
      (mockDatabaseService.vectorSearchSymbols as jest.Mock).mockRejectedValue(new Error('Vector search not available'));
      (mockDatabaseService.fulltextSearchSymbols as jest.Mock).mockResolvedValue(mockSymbols);

      const result = await mcpTools.searchCode({
        query: 'test',
        entity_types: ['function'],
        is_exported: true,
      });

      // Should try vector search first, then fallback to fulltext search
      expect(mockDatabaseService.vectorSearchSymbols).toHaveBeenCalled();
      expect(mockDatabaseService.fulltextSearchSymbols).toHaveBeenCalled();
      const callArgs = (mockDatabaseService.fulltextSearchSymbols as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe('test'); // query
      expect(callArgs[2]).toMatchObject({
        isExported: true,
        limit: 100
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.query).toBe('test');
      expect(data.results).toHaveLength(1); // Only the function should pass the filters
      expect(data.results[0].name).toBe('testFunction');
      expect(data.query_filters.entity_types).toEqual(['function']);
      expect(data.query_filters.is_exported).toBe(true);
    });

    it('should apply limit to results', async () => {
      const mockSymbols = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `function${i}`,
        entity_types: SymbolType.FUNCTION,
        start_line: 1,
        end_line: 5,
        is_exported: true,
        file: {
          id: 1,
          path: '/test/file.js',
          language: 'javascript',
        },
      }));

      // Mock vector search to fail so it falls back to fulltext search
      (mockDatabaseService.vectorSearchSymbols as jest.Mock).mockRejectedValue(new Error('Vector search not available'));
      (mockDatabaseService.fulltextSearchSymbols as jest.Mock).mockResolvedValue(mockSymbols);

      const result = await mcpTools.searchCode({
        query: 'function',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.results).toHaveLength(100); // Fixed limit of 100 is applied
    });
  });

  describe('whoCalls', () => {
    it('should find callers of a symbol', async () => {
      const mockSymbol = {
        id: 1,
        name: 'targetFunction',
        entity_types: SymbolType.FUNCTION,
      };

      const mockCallers = [
        {
          id: 1,
          dependency_type: 'calls',
          line_number: 10,
          from_symbol: {
            id: 2,
            name: 'caller1',
            entity_types: SymbolType.FUNCTION,
            file: {
              path: '/test/caller.js',
            },
          },
        },
      ];

      (mockDatabaseService.getSymbol as jest.Mock).mockResolvedValue(mockSymbol);
      (mockDatabaseService.getDependenciesToWithContext as jest.Mock).mockResolvedValue(mockCallers);

      const result = await mcpTools.whoCalls({ symbol_id: 1 });

      expect(mockDatabaseService.getSymbol).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getDependenciesToWithContext).toHaveBeenCalledWith(1);

      const data = JSON.parse(result.content[0].text);
      expect(data.query_info.symbol).toBe('targetFunction');

      // Results are now in dependencies array format
      expect(Array.isArray(data.dependencies)).toBe(true);
      expect(data.total_count).toBeGreaterThan(0);
      expect(data.dependencies[0].from).toBe('caller1');
      expect(data.dependencies[0].to).toBe('targetFunction');
      expect(data.dependencies[0].type).toBe('calls');
    });
  });

  describe('listDependencies', () => {
    it('should list dependencies of a symbol', async () => {
      const mockSymbol = {
        id: 1,
        name: 'sourceFunction',
        entity_types: SymbolType.FUNCTION,
      };

      const mockDependencies = [
        {
          id: 1,
          dependency_type: 'calls',
          line_number: 5,
          to_symbol: {
            id: 2,
            name: 'dependency1',
            entity_types: SymbolType.FUNCTION,
            file: {
              path: '/test/utils.js',
            },
          },
        },
      ];

      (mockDatabaseService.getSymbol as jest.Mock).mockResolvedValue(mockSymbol);
      (mockDatabaseService.getDependenciesFrom as jest.Mock).mockResolvedValue(mockDependencies);

      const result = await mcpTools.listDependencies({ symbol_id: 1 });

      expect(mockDatabaseService.getSymbol).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getDependenciesFrom).toHaveBeenCalledWith(1);

      const data = JSON.parse(result.content[0].text);
      expect(data.query_info.symbol).toBe('sourceFunction');

      // Results are now in dependencies array format
      expect(Array.isArray(data.dependencies)).toBe(true);
      expect(data.total_count).toBeGreaterThan(0);
      expect(data.dependencies[0].from).toBe('sourceFunction');
      expect(data.dependencies[0].to).toBeDefined();
      expect(data.dependencies[0].type).toBe('calls');
    });

    it('should handle analysis_type parameter', async () => {
      const mockSymbol = {
        id: 1,
        name: 'testFunction',
        entity_types: SymbolType.FUNCTION,
      };

      (mockDatabaseService.getSymbol as jest.Mock).mockResolvedValue(mockSymbol);
      (mockDatabaseService.getDependenciesFrom as jest.Mock).mockResolvedValue([]);

      const result = await mcpTools.listDependencies({
        symbol_id: 1,
        analysis_type: 'quick'
      });

      expect(mockDatabaseService.getSymbol).toHaveBeenCalledWith(1);
      const data = JSON.parse(result.content[0].text);
      expect(data.query_info.symbol).toBe('testFunction');
    });

    it('should validate analysis_type parameter values', async () => {
      await expect(async () => {
        await mcpTools.listDependencies({
          symbol_id: 1,
          analysis_type: 'invalid'
        });
      }).rejects.toThrow();
    });
  });

  describe('whoCalls with analysis_type', () => {
    it('should handle analysis_type parameter', async () => {
      const mockSymbol = {
        id: 1,
        name: 'targetFunction',
        entity_types: SymbolType.FUNCTION,
      };

      const mockCallers = [
        {
          id: 1,
          dependency_type: 'calls',
          line_number: 10,
          from_symbol: {
            id: 2,
            name: 'caller1',
            entity_types: SymbolType.FUNCTION,
            file: {
              path: '/test/caller.js',
            },
          },
        },
      ];

      (mockDatabaseService.getSymbol as jest.Mock).mockResolvedValue(mockSymbol);
      (mockDatabaseService.getDependenciesToWithContext as jest.Mock).mockResolvedValue(mockCallers);

      const result = await mcpTools.whoCalls({
        symbol_id: 1,
        analysis_type: 'comprehensive'
      });

      expect(mockDatabaseService.getSymbol).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getDependenciesToWithContext).toHaveBeenCalledWith(1);

      const data = JSON.parse(result.content[0].text);
      expect(data.query_info.symbol).toBe('targetFunction');

      // Results are now in dependencies array format
      expect(Array.isArray(data.dependencies)).toBe(true);
      expect(data.total_count).toBeGreaterThan(0);
      expect(data.dependencies[0].from).toBeDefined();
      expect(data.dependencies[0].to).toBe('targetFunction');
    });

    it('should validate analysis_type parameter values for whoCalls', async () => {
      await expect(async () => {
        await mcpTools.whoCalls({
          symbol_id: 1,
          analysis_type: 'invalid'
        });
      }).rejects.toThrow();
    });
  });

  describe('searchCode parameter validation', () => {
    it('should reject removed parameters with helpful error messages', async () => {
      // The removed parameters (repo_id, symbol_type, limit, use_vector) now throw helpful errors
      // This guides users to use the new parameter names per PARAMETER_REDUNDANCY_ANALYSIS

      const mockSymbols = [
        {
          id: 1,
          name: 'testFunction',
          entity_types: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 10,
          is_exported: true,
          file: {
            id: 1,
            path: '/test/file.js',
            language: 'javascript',
            repository: {
              name: 'test-repo',
              path: '/test',
            },
          },
        },
      ];

      (mockDatabaseService.vectorSearchSymbols as jest.Mock).mockRejectedValue(new Error('Vector search not available'));
      (mockDatabaseService.fulltextSearchSymbols as jest.Mock).mockResolvedValue(mockSymbols);

      // These parameters should throw errors with helpful messages
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_id: 123
        });
      }).rejects.toThrow('repo_id parameter removed. Use repo_ids array instead');
    });

    it('should validate new parameter types', async () => {
      const mockSymbols = [
        {
          id: 1,
          name: 'testFunction',
          entity_types: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 10,
          is_exported: true,
          file: {
            id: 1,
            path: '/test/file.js',
            language: 'javascript',
          },
        },
      ];

      (mockDatabaseService.fulltextSearchSymbols as jest.Mock).mockResolvedValue(mockSymbols);

      // Mock the getDefaultRepoId method
      (mcpTools as any).getDefaultRepoId = jest.fn().mockResolvedValue(1);

      // Valid parameters should work
      await expect(mcpTools.searchCode({
        query: 'test',
        entity_types: ['function'],
        search_mode: 'exact',
        is_exported: true,
        repo_ids: [1]
      })).resolves.toBeDefined();

      // Invalid entity_types should fail
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          entity_types: 'not_an_array'
        });
      }).rejects.toThrow('entity_types must be an array');

      // Invalid entity_types values should fail
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          entity_types: ['invalid_type']
        });
      }).rejects.toThrow('entity_types must contain valid types');

      // Invalid search_mode should fail
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          search_mode: 'invalid'
        });
      }).rejects.toThrow('search_mode must be one of: auto, exact, vector, qualified');

      // Invalid repo_ids should fail
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_ids: 'not_an_array'
        });
      }).rejects.toThrow('repo_ids must be an array');

      // Invalid repo_ids values should fail
      await expect(async () => {
        await mcpTools.searchCode({
          query: 'test',
          repo_ids: ['not_a_number']
        });
      }).rejects.toThrow('repo_ids must contain only numbers');
    });
  });
});