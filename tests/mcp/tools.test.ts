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
  searchSymbols: jest.fn(),
  fulltextSearchSymbols: jest.fn(),
} as unknown as DatabaseService;

describe('McpTools', () => {
  let mcpTools: McpTools;

  beforeEach(() => {
    jest.clearAllMocks();
    mcpTools = new McpTools(mockDatabaseService);
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
          symbol_type: SymbolType.FUNCTION,
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

    it('should get file without symbols when include_symbols is false', async () => {
      const mockFile = {
        id: 1,
        path: '/test/file.js',
        language: 'javascript',
        repository: null,
      };

      (mockDatabaseService.getFileWithRepository as jest.Mock).mockResolvedValue(mockFile);

      const result = await mcpTools.getFile({ file_id: 1, include_symbols: false });

      expect(mockDatabaseService.getFileWithRepository).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getSymbolsByFile).not.toHaveBeenCalled();

      const data = JSON.parse(result.content[0].text);
      expect(data.symbols).toEqual([]);
      expect(data.symbol_count).toBe(0);
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
        symbol_type: SymbolType.FUNCTION,
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
          confidence: 1.0,
          to_symbol: {
            id: 2,
            name: 'helperFunction',
            symbol_type: SymbolType.FUNCTION,
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
          confidence: 1.0,
          from_symbol: {
            id: 3,
            name: 'mainFunction',
            symbol_type: SymbolType.FUNCTION,
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
        symbol_id: 1,
        include_dependencies: true,
        include_callers: true,
      });

      expect(mockDatabaseService.getSymbolWithFile).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getDependenciesFrom).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getDependenciesTo).toHaveBeenCalledWith(1);

      const data = JSON.parse(result.content[0].text);
      expect(data.symbol.name).toBe('testFunction');
      expect(data.dependencies).toHaveLength(1);
      expect(data.dependencies[0].to_symbol.name).toBe('helperFunction');
      expect(data.callers).toHaveLength(1);
      expect(data.callers[0].from_symbol.name).toBe('mainFunction');
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
          symbol_type: SymbolType.FUNCTION,
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

      const result = await mcpTools.searchCode({
        query: 'test',
        symbol_type: 'function',
        is_exported: true,
        limit: 10,
      });

      expect(mockDatabaseService.fulltextSearchSymbols).toHaveBeenCalledWith('test', undefined, {
        symbolTypes: ['function'],
        isExported: true,
        limit: 10,
        confidenceThreshold: 0.7,
        framework: undefined,
        repoIds: []
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.query).toBe('test');
      expect(data.results).toHaveLength(1); // Only the function should pass the filters
      expect(data.results[0].name).toBe('testFunction');
      expect(data.query_filters.symbol_type).toBe('function');
      expect(data.query_filters.is_exported).toBe(true);
    });

    it('should apply limit to results', async () => {
      const mockSymbols = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `function${i}`,
        symbol_type: SymbolType.FUNCTION,
        start_line: 1,
        end_line: 5,
        is_exported: true,
        file: {
          id: 1,
          path: '/test/file.js',
          language: 'javascript',
        },
      }));

      (mockDatabaseService.fulltextSearchSymbols as jest.Mock).mockResolvedValue(mockSymbols);

      const result = await mcpTools.searchCode({
        query: 'function',
        limit: 5,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.results).toHaveLength(5);
    });
  });

  describe('whoCalls', () => {
    it('should find callers of a symbol', async () => {
      const mockSymbol = {
        id: 1,
        name: 'targetFunction',
        symbol_type: SymbolType.FUNCTION,
      };

      const mockCallers = [
        {
          id: 1,
          dependency_type: 'calls',
          line_number: 10,
          confidence: 1.0,
          from_symbol: {
            id: 2,
            name: 'caller1',
            symbol_type: SymbolType.FUNCTION,
            file: {
              path: '/test/caller.js',
            },
          },
        },
      ];

      (mockDatabaseService.getSymbol as jest.Mock).mockResolvedValue(mockSymbol);
      (mockDatabaseService.getDependenciesTo as jest.Mock).mockResolvedValue(mockCallers);

      const result = await mcpTools.whoCalls({ symbol_id: 1 });

      expect(mockDatabaseService.getSymbol).toHaveBeenCalledWith(1);
      expect(mockDatabaseService.getDependenciesTo).toHaveBeenCalledWith(1);

      const data = JSON.parse(result.content[0].text);
      expect(data.symbol.name).toBe('targetFunction');
      expect(data.callers).toHaveLength(1);
      expect(data.callers[0].from_symbol.name).toBe('caller1');
    });
  });

  describe('listDependencies', () => {
    it('should list dependencies of a symbol', async () => {
      const mockSymbol = {
        id: 1,
        name: 'sourceFunction',
        symbol_type: SymbolType.FUNCTION,
      };

      const mockDependencies = [
        {
          id: 1,
          dependency_type: 'calls',
          line_number: 5,
          confidence: 1.0,
          to_symbol: {
            id: 2,
            name: 'dependency1',
            symbol_type: SymbolType.FUNCTION,
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
      expect(data.symbol.name).toBe('sourceFunction');
      expect(data.dependencies).toHaveLength(1);
      expect(data.dependencies[0].to_symbol.name).toBe('dependency1');
    });
  });
});