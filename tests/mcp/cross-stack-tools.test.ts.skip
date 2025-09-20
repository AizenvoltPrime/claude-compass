import { McpTools } from '../../src/mcp/tools';
import { DatabaseService } from '../../src/database/services';
import {
  ApiCall,
  DataContract,
  Symbol,
  SymbolType,
  DependencyType,
  DependencyWithSymbols
} from '../../src/database/models';
import { jest } from '@jest/globals';

// Mock the database service with cross-stack methods
const mockDatabaseService = {
  // Existing methods
  getFileWithRepository: jest.fn(),
  getSymbolWithFile: jest.fn(),
  getSymbol: jest.fn(),
  getSymbolsByFile: jest.fn(),
  getDependenciesFrom: jest.fn(),
  getDependenciesTo: jest.fn(),
  searchSymbols: jest.fn(),

  // Cross-stack methods
  getApiCallsByComponent: jest.fn(),
  getDataContractsBySchema: jest.fn(),
} as unknown as DatabaseService;

// Mock the import for transitive analyzer
jest.mock('../../src/graph/transitive-analyzer', () => ({
  transitiveAnalyzer: {
    getCrossStackTransitiveImpact: jest.fn(),
  }
}));

// Import the mocked module
import { transitiveAnalyzer as mockTransitiveAnalyzer } from '../../src/graph/transitive-analyzer';

describe('Cross-Stack MCP Tools', () => {
  let mcpTools: McpTools;

  beforeEach(() => {
    jest.clearAllMocks();
    // Set default mock return values
    (mockDatabaseService.getDependenciesFrom as any).mockResolvedValue([]);
    (mockDatabaseService.getDependenciesTo as any).mockResolvedValue([]);
    mcpTools = new McpTools(mockDatabaseService);
  });

  describe('getApiCalls', () => {
    it('should return correct API call relationships', async () => {
      const mockApiCalls: ApiCall[] = [
        {
          id: 1,
          repo_id: 1,
          frontend_symbol_id: 1,
          backend_route_id: 2,
          method: 'GET',
          url_pattern: '/api/users',
          request_schema: null,
          response_schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                name: { type: 'string' },
                email: { type: 'string' }
              }
            }
          },
          confidence: 0.95,
          created_at: new Date('2024-01-01')
        },
        {
          id: 2,
          repo_id: 1,
          frontend_symbol_id: 1,
          backend_route_id: 3,
          method: 'POST',
          url_pattern: '/api/users',
          request_schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' }
            },
            required: ['name', 'email']
          },
          response_schema: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              email: { type: 'string' }
            }
          },
          confidence: 0.88,
          created_at: new Date('2024-01-02')
        }
      ];

      (mockDatabaseService.getApiCallsByComponent as any).mockResolvedValue(mockApiCalls);

      const result = await mcpTools.getApiCalls({
        component_id: 1,
        include_response_schemas: false
      });

      expect(mockDatabaseService.getApiCallsByComponent).toHaveBeenCalledWith(1);
      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.component_id).toBe(1);
      expect(content.api_calls).toHaveLength(2);
      expect(content.total_calls).toBe(2);
      expect(content.api_calls[0].url_pattern).toBe('/api/users');
      expect(content.api_calls[0].confidence).toBe(0.95);
    });

    it('should include response schemas when requested', async () => {
      const mockApiCalls: ApiCall[] = [
        {
          id: 1,
          repo_id: 1,
          frontend_symbol_id: 1,
          backend_route_id: 2,
          method: 'GET',
          url_pattern: '/api/users/{id}',
          request_schema: null,
          response_schema: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              email: { type: 'string' },
              profile: {
                type: 'object',
                properties: {
                  avatar: { type: 'string' },
                  bio: { type: 'string' }
                }
              }
            }
          },
          confidence: 0.92,
          created_at: new Date('2024-01-01')
        }
      ];

      (mockDatabaseService.getApiCallsByComponent as any).mockResolvedValue(mockApiCalls);

      const result = await mcpTools.getApiCalls({
        component_id: 1,
        include_response_schemas: true
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.api_calls[0].response_schema).toBeDefined();
      expect(content.api_calls[0].response_schema.properties.profile).toBeDefined();
    });

    it('should handle component with no API calls', async () => {
      (mockDatabaseService.getApiCallsByComponent as any).mockResolvedValue([]);

      const result = await mcpTools.getApiCalls({
        component_id: 999
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.component_id).toBe(999);
      expect(content.api_calls).toHaveLength(0);
      expect(content.total_calls).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      (mockDatabaseService.getApiCallsByComponent as any).mockRejectedValue(
        new Error('Database connection failed')
      );

      const result = await mcpTools.getApiCalls({
        component_id: 1
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain('Database connection failed');
      expect(content.component_id).toBe(1);
    });
  });

  describe('getDataContracts', () => {
    it('should return data contracts for schema name', async () => {
      const mockSymbols: Symbol[] = [
        {
          id: 1,
          name: 'User',
          symbol_type: SymbolType.INTERFACE,
          file_id: 1,
          start_line: 1,
          end_line: 10,
          is_exported: true,
          signature: 'interface User { id: number; name: string; email: string; }',
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      const mockDataContracts: DataContract[] = [
        {
          id: 1,
          repo_id: 1,
          name: 'User',
          frontend_type_id: 1,
          backend_type_id: 2,
          schema_definition: {
            fields: [
              { name: 'id', frontendType: 'number', backendType: 'int', compatible: true },
              { name: 'name', frontendType: 'string', backendType: 'string', compatible: true },
              { name: 'email', frontendType: 'string', backendType: 'string', compatible: true }
            ],
            compatibility_score: 1.0
          },
          drift_detected: false,
          last_verified: new Date('2024-01-01')
        }
      ];

      (mockDatabaseService.searchSymbols as any).mockResolvedValue(mockSymbols);
      (mockDatabaseService.getDataContractsBySchema as any).mockResolvedValue(mockDataContracts);

      const result = await mcpTools.getDataContracts({
        schema_name: 'User',
        include_drift_analysis: false
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.schema_name).toBe('User');
      expect(content.data_contracts).toHaveLength(1);
      expect(content.data_contracts[0].name).toBe('User');
      expect(content.data_contracts[0].drift_detected).toBe(false);
    });

    it('should include drift analysis when requested', async () => {
      const mockSymbols: Symbol[] = [
        {
          id: 1,
          name: 'UserProfile',
          symbol_type: SymbolType.INTERFACE,
          file_id: 1,
          start_line: 1,
          end_line: 15,
          is_exported: true,
          signature: 'interface UserProfile { id: number; name: string; email: string; avatar?: string; }',
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      const mockDataContracts: DataContract[] = [
        {
          id: 1,
          repo_id: 1,
          name: 'UserProfile',
          frontend_type_id: 1,
          backend_type_id: 2,
          schema_definition: {
            fields: [
              { name: 'id', frontendType: 'number', backendType: 'int', compatible: true },
              { name: 'name', frontendType: 'string', backendType: 'string', compatible: true },
              { name: 'email', frontendType: 'string', backendType: 'string', compatible: true },
              { name: 'avatar', frontendType: 'string', backendType: 'missing', compatible: false }
            ],
            compatibility_score: 0.75
          },
          drift_detected: true,
          last_verified: new Date('2024-01-01')
        }
      ];

      (mockDatabaseService.searchSymbols as any).mockResolvedValue(mockSymbols);
      (mockDatabaseService.getDataContractsBySchema as any).mockResolvedValue(mockDataContracts);

      const result = await mcpTools.getDataContracts({
        schema_name: 'UserProfile',
        include_drift_analysis: true
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.drift_analysis).toBeDefined();
      expect(content.data_contracts[0].drift_detected).toBe(true);
      expect(content.data_contracts[0].schema_definition.compatibility_score).toBe(0.75);
    });

    it('should handle schema not found', async () => {
      (mockDatabaseService.searchSymbols as any).mockResolvedValue([]);

      const result = await mcpTools.getDataContracts({
        schema_name: 'NonExistentSchema'
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.schema_name).toBe('NonExistentSchema');
      expect(content.data_contracts).toHaveLength(0);
      expect(content.error).toContain('No symbols found');
    });
  });

  describe('getCrossStackImpact', () => {
    it('should calculate cross-stack impact analysis', async () => {
      const mockImpactResult = {
        symbolId: 1,
        frontendImpact: [
          {
            symbolId: 2,
            path: [
              { symbolId: 1, name: 'UserController@index', confidence: 1.0 },
              { symbolId: 2, name: 'UserList.vue', confidence: 0.9 }
            ],
            totalConfidence: 0.9,
            relationshipTypes: [DependencyType.API_CALL]
          }
        ],
        backendImpact: [
          {
            symbolId: 3,
            path: [
              { symbolId: 1, name: 'UserController@index', confidence: 1.0 },
              { symbolId: 3, name: 'User.php', confidence: 0.95 }
            ],
            totalConfidence: 0.95,
            relationshipTypes: [DependencyType.CALLS]
          }
        ],
        crossStackRelationships: [
          {
            fromSymbolId: 2,
            toSymbolId: 1,
            relationshipType: DependencyType.API_CALL,
            confidence: 0.9
          }
        ],
        totalImpactedSymbols: 2,
        executionTimeMs: 150
      };

      (mockTransitiveAnalyzer.getCrossStackTransitiveImpact as any).mockResolvedValue(mockImpactResult);

      const result = await mcpTools.getCrossStackImpact({
        symbol_id: 1,
        include_transitive: true,
        max_depth: 5
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.symbol_id).toBe(1);
      expect(content.cross_stack_impact).toBeDefined();
      expect(content.analysis_depth).toBe('transitive');
      expect(content.cross_stack_impact.totalImpactedSymbols).toBe(2);
      expect(content.cross_stack_impact.executionTimeMs).toBe(150);
    });

    it('should handle direct impact analysis without transitive', async () => {
      // Mock cross-stack dependencies for direct analysis
      const mockCrossStackDependencies = [
        {
          id: 1,
          from_symbol_id: 1,
          to_symbol_id: 3,
          dependency_type: DependencyType.API_CALL,
          line_number: 10,
          confidence: 0.95,
          created_at: new Date(),
          updated_at: new Date(),
          from_symbol: null,
          to_symbol: {
            id: 3,
            name: 'User.php',
            symbol_type: 'class',
            file: { path: '/backend/User.php' }
          }
        }
      ];

      const mockCrossStackCallers = [
        {
          id: 2,
          from_symbol_id: 2,
          to_symbol_id: 1,
          dependency_type: DependencyType.API_CALL,
          line_number: 5,
          confidence: 0.9,
          created_at: new Date(),
          updated_at: new Date(),
          from_symbol: {
            id: 2,
            name: 'UserList.vue',
            symbol_type: 'component',
            file: { path: '/frontend/UserList.vue' }
          },
          to_symbol: null
        }
      ];

      (mockDatabaseService.getDependenciesFrom as any).mockResolvedValue(mockCrossStackDependencies);
      (mockDatabaseService.getDependenciesTo as any).mockResolvedValue(mockCrossStackCallers);

      const result = await mcpTools.getCrossStackImpact({
        symbol_id: 1,
        include_transitive: false
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.analysis_depth).toBe('direct');
      expect(content.cross_stack_impact.directCallers).toHaveLength(1);
      expect(content.cross_stack_impact.crossStackRelationships).toHaveLength(2);
    });

    it('should handle symbols with no cross-stack impact', async () => {
      const mockEmptyImpact = {
        symbolId: 999,
        frontendImpact: [],
        backendImpact: [],
        crossStackRelationships: [],
        totalImpactedSymbols: 0,
        executionTimeMs: 50
      };

      (mockTransitiveAnalyzer.getCrossStackTransitiveImpact as any).mockResolvedValue(mockEmptyImpact);

      const result = await mcpTools.getCrossStackImpact({
        symbol_id: 999,
        include_transitive: true
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.cross_stack_impact.totalImpactedSymbols).toBe(0);
      expect(content.cross_stack_impact.frontendImpact).toHaveLength(0);
      expect(content.cross_stack_impact.backendImpact).toHaveLength(0);
    });

    it('should respect max_depth parameter', async () => {
      const result = await mcpTools.getCrossStackImpact({
        symbol_id: 1,
        include_transitive: true,
        max_depth: 3
      });

      expect(mockTransitiveAnalyzer.getCrossStackTransitiveImpact).toHaveBeenCalledWith(1, {
        maxDepth: 3,
        includeTransitive: true,
        confidenceThreshold: 0.7
      });
    });

    it('should use default confidence threshold when not specified', async () => {
      const result = await mcpTools.getCrossStackImpact({
        symbol_id: 1,
        include_transitive: true
      });

      expect(mockTransitiveAnalyzer.getCrossStackTransitiveImpact).toHaveBeenCalledWith(1, {
        maxDepth: 10,
        includeTransitive: true,
        confidenceThreshold: 0.7
      });
    });

    it('should handle errors in transitive analysis', async () => {
      (mockTransitiveAnalyzer.getCrossStackTransitiveImpact as any).mockRejectedValue(
        new Error('Transitive analysis failed')
      );

      const result = await mcpTools.getCrossStackImpact({
        symbol_id: 1,
        include_transitive: true
      });

      expect(result.content).toHaveLength(1);

      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain('Transitive analysis failed');
      expect(content.symbol_id).toBe(1);
    });
  });

  describe('result formatting', () => {
    it('should format API call results consistently', async () => {
      const mockApiCalls: ApiCall[] = [
        {
          id: 1,
          repo_id: 1,
          frontend_symbol_id: 1,
          backend_route_id: 2,
          method: 'GET',
          url_pattern: '/api/users',
          request_schema: null,
          response_schema: { type: 'array' },
          confidence: 0.95,
          created_at: new Date('2024-01-01T00:00:00Z')
        }
      ];

      (mockDatabaseService.getApiCallsByComponent as any).mockResolvedValue(mockApiCalls);

      const result = await mcpTools.getApiCalls({ component_id: 1 });
      const content = JSON.parse(result.content[0].text);

      expect(content).toHaveProperty('component_id');
      expect(content).toHaveProperty('api_calls');
      expect(content).toHaveProperty('total_calls');
      expect(content.api_calls[0]).toHaveProperty('id');
      expect(content.api_calls[0]).toHaveProperty('method');
      expect(content.api_calls[0]).toHaveProperty('url_pattern');
      expect(content.api_calls[0]).toHaveProperty('confidence');
    });

    it('should format data contract results consistently', async () => {
      const mockSymbols: Symbol[] = [
        { id: 1, name: 'User', symbol_type: SymbolType.INTERFACE, file_id: 1, start_line: 1, end_line: 10, is_exported: true, signature: 'interface User {}', created_at: new Date(), updated_at: new Date() }
      ];
      const mockDataContracts: DataContract[] = [
        {
          id: 1, repo_id: 1, name: 'User', frontend_type_id: 1, backend_type_id: 2,
          schema_definition: {}, drift_detected: false, last_verified: new Date('2024-01-01T00:00:00Z')
        }
      ];

      (mockDatabaseService.searchSymbols as any).mockResolvedValue(mockSymbols);
      (mockDatabaseService.getDataContractsBySchema as any).mockResolvedValue(mockDataContracts);

      const result = await mcpTools.getDataContracts({ schema_name: 'User' });
      const content = JSON.parse(result.content[0].text);

      expect(content).toHaveProperty('schema_name');
      expect(content).toHaveProperty('data_contracts');
      expect(content.data_contracts[0]).toHaveProperty('id');
      expect(content.data_contracts[0]).toHaveProperty('name');
      expect(content.data_contracts[0]).toHaveProperty('drift_detected');
    });

    it('should format cross-stack impact results consistently', async () => {
      const mockImpactResult = {
        symbolId: 1,
        frontendImpact: [],
        backendImpact: [],
        crossStackRelationships: [],
        totalImpactedSymbols: 0,
        executionTimeMs: 100
      };

      (mockTransitiveAnalyzer.getCrossStackTransitiveImpact as any).mockResolvedValue(mockImpactResult);

      const result = await mcpTools.getCrossStackImpact({ symbol_id: 1 });
      const content = JSON.parse(result.content[0].text);

      expect(content).toHaveProperty('symbol_id');
      expect(content).toHaveProperty('cross_stack_impact');
      expect(content).toHaveProperty('analysis_depth');
      expect(content.cross_stack_impact).toHaveProperty('symbolId');
      expect(content.cross_stack_impact).toHaveProperty('totalImpactedSymbols');
      expect(content.cross_stack_impact).toHaveProperty('executionTimeMs');
    });
  });

  describe('input validation', () => {
    it('should validate getApiCalls arguments', async () => {
      // Test missing component_id
      await expect(mcpTools.getApiCalls({})).rejects.toThrow();

      // Test invalid component_id type
      await expect(mcpTools.getApiCalls({ component_id: 'invalid' })).rejects.toThrow();

      // Test negative component_id
      await expect(mcpTools.getApiCalls({ component_id: -1 })).rejects.toThrow();
    });

    it('should validate getDataContracts arguments', async () => {
      // Test missing schema_name
      await expect(mcpTools.getDataContracts({})).rejects.toThrow();

      // Test empty schema_name
      await expect(mcpTools.getDataContracts({ schema_name: '' })).rejects.toThrow();

      // Test invalid include_drift_analysis type
      await expect(mcpTools.getDataContracts({
        schema_name: 'User',
        include_drift_analysis: 'invalid'
      })).rejects.toThrow();
    });

    it('should validate getCrossStackImpact arguments', async () => {
      // Test missing symbol_id
      await expect(mcpTools.getCrossStackImpact({})).rejects.toThrow();

      // Test invalid symbol_id type
      await expect(mcpTools.getCrossStackImpact({ symbol_id: 'invalid' })).rejects.toThrow();

      // Test invalid max_depth
      await expect(mcpTools.getCrossStackImpact({
        symbol_id: 1,
        max_depth: -1
      })).rejects.toThrow();

      // Test invalid include_transitive type
      await expect(mcpTools.getCrossStackImpact({
        symbol_id: 1,
        include_transitive: 'invalid'
      })).rejects.toThrow();
    });
  });
});