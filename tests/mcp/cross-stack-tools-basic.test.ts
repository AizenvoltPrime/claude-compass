import { McpTools } from '../../src/mcp/tools';
import { DatabaseService } from '../../src/database/services';
import {
  ApiCall,
  DataContract,
  SymbolWithFile
} from '../../src/database/models';
import { CrossStackImpactResult } from '../../src/graph/transitive-analyzer';
import { jest } from '@jest/globals';

// Mock the database service
const mockDatabaseService = {
  getFileWithRepository: jest.fn(),
  getSymbolWithFile: jest.fn(),
  getSymbol: jest.fn(),
  getSymbolsByFile: jest.fn(),
  getDependenciesFrom: jest.fn(),
  getDependenciesTo: jest.fn(),
  searchSymbols: jest.fn(),
  getApiCallsByComponent: jest.fn(),
  getDataContractsBySchema: jest.fn(),
} as unknown as DatabaseService;

describe('Cross-Stack MCP Tools - Basic Tests', () => {
  let mcpTools: McpTools;

  beforeEach(() => {
    jest.clearAllMocks();
    mcpTools = new McpTools(mockDatabaseService);
  });

  describe('getApiCalls', () => {
    it('should handle valid component ID', async () => {
      (mockDatabaseService.getApiCallsByComponent as any).mockResolvedValue([]);

      const result = await mcpTools.getApiCalls({
        component_id: 1
      });

      expect(result.content).toHaveLength(1);
      expect(mockDatabaseService.getApiCallsByComponent).toHaveBeenCalledWith(1);
    });

    it('should handle missing component_id', async () => {
      await expect(mcpTools.getApiCalls({})).rejects.toThrow();
    });

    it('should handle invalid component_id type', async () => {
      await expect(mcpTools.getApiCalls({ component_id: 'invalid' })).rejects.toThrow();
    });

    it('should handle database errors gracefully', async () => {
      (mockDatabaseService.getApiCallsByComponent as any).mockRejectedValue(
        new Error('Database error')
      );

      const result = await mcpTools.getApiCalls({ component_id: 1 });
      const content = JSON.parse(result.content[0].text);

      expect(content.error).toBeDefined();
    });
  });

  describe('getDataContracts', () => {
    it('should handle valid schema name', async () => {
      (mockDatabaseService.searchSymbols as any).mockResolvedValue([
        { id: 1, name: 'User' }
      ]);
      (mockDatabaseService.getDataContractsBySchema as any).mockResolvedValue([]);

      const result = await mcpTools.getDataContracts({
        schema_name: 'User'
      });

      expect(result.content).toHaveLength(1);
      expect(mockDatabaseService.searchSymbols).toHaveBeenCalledWith('User', undefined);
    });

    it('should handle missing schema_name', async () => {
      await expect(mcpTools.getDataContracts({})).rejects.toThrow();
    });

    it('should handle empty schema_name', async () => {
      await expect(mcpTools.getDataContracts({ schema_name: '' })).rejects.toThrow();
    });
  });

  describe('getCrossStackImpact', () => {
    it('should handle valid symbol ID', async () => {
      // Mock the import since we can't easily mock ES modules
      const mockTransitiveAnalyzer = {
        getCrossStackTransitiveImpact: (jest.fn() as any).mockResolvedValue({
          symbolId: 1,
          frontendImpact: [],
          backendImpact: [],
          crossStackRelationships: [],
          totalImpactedSymbols: 0,
          executionTimeMs: 100
        })
      };

      // Override the import
      jest.mock('../../src/graph/transitive-analyzer', () => ({
        transitiveAnalyzer: mockTransitiveAnalyzer
      }));

      const result = await mcpTools.getCrossStackImpact({
        symbol_id: 1
      });

      expect(result.content).toHaveLength(1);
    });

    it('should handle missing symbol_id', async () => {
      await expect(mcpTools.getCrossStackImpact({})).rejects.toThrow();
    });

    it('should handle invalid symbol_id type', async () => {
      await expect(mcpTools.getCrossStackImpact({ symbol_id: 'invalid' })).rejects.toThrow();
    });
  });

  describe('input validation', () => {
    it('should validate numeric IDs', async () => {
      await expect(mcpTools.getApiCalls({ component_id: -1 })).rejects.toThrow();
      await expect(mcpTools.getCrossStackImpact({ symbol_id: 0 })).rejects.toThrow();
    });

    it('should validate string inputs', async () => {
      await expect(mcpTools.getDataContracts({ schema_name: '   ' })).rejects.toThrow();
    });

    it('should validate boolean inputs', async () => {
      await expect(mcpTools.getApiCalls({
        component_id: 1,
        include_response_schemas: 'invalid' as any
      })).rejects.toThrow();
    });
  });
});