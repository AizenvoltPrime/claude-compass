import {
  CrossStackGraphBuilder,
  CrossStackNode,
  CrossStackEdge,
  CrossStackGraphData,
  FullStackFeatureGraph,
} from '../../src/graph/cross-stack-builder';
import { DatabaseService } from '../../src/database/services';
import {
  ApiCall,
  DataContract,
  Symbol,
  SymbolType,
  DependencyType,
  CreateApiCall,
  CreateDataContract,
  Repository,
  File,
} from '../../src/database/models';
import { FrameworkEntity, FrameworkEntityType } from '../../src/parsers/base';
import { jest } from '@jest/globals';

// Mock the DatabaseService
const mockDatabaseService = {
  // Core symbol and entity methods
  getSymbol: jest.fn() as jest.MockedFunction<any>,
  getSymbolsByType: jest.fn() as jest.MockedFunction<any>,
  getSymbolsByRepository: jest.fn() as jest.MockedFunction<any>,
  getFrameworkEntitiesByType: jest.fn() as jest.MockedFunction<any>,
  getFrameworkEntityById: jest.fn() as jest.MockedFunction<any>,
  searchSymbols: jest.fn() as jest.MockedFunction<any>,

  // Repository methods
  getRepository: jest.fn() as jest.MockedFunction<any>,
  getRepositoryFrameworks: jest.fn() as jest.MockedFunction<any>,
  getFilesByRepository: jest.fn() as jest.MockedFunction<any>,

  // API call and data contract methods
  getApiCallsByRepository: jest.fn() as jest.MockedFunction<any>,
  getDataContractsByRepository: jest.fn() as jest.MockedFunction<any>,
  createApiCalls: jest.fn() as jest.MockedFunction<any>,
  createDataContracts: jest.fn() as jest.MockedFunction<any>,
  getCrossStackDependencies: jest.fn() as jest.MockedFunction<any>,

  // Framework-specific methods
  getComponentsByType: jest.fn() as jest.MockedFunction<any>,
  getRoutesByFramework: jest.fn() as jest.MockedFunction<any>,

  // Streaming method for large datasets
  streamCrossStackData: jest.fn() as jest.MockedFunction<any>,
} as unknown as DatabaseService;

describe('CrossStackGraphBuilder', () => {
  let builder: CrossStackGraphBuilder;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock implementations
    (mockDatabaseService.getSymbol as jest.MockedFunction<any>).mockImplementation(
      (symbolId: number) => {
        // Return mock symbols for test data - Match original test expectations
        const mockSymbols = {
          1: {
            id: 1,
            name: 'UserList',
            symbol_type: 'component',
            file_id: 1,
            start_line: 1,
            end_line: 10,
            is_exported: true,
            signature: 'export default UserList',
            created_at: new Date(),
            updated_at: new Date(),
          },
          2: {
            id: 2,
            name: 'UserProfile',
            symbol_type: 'component',
            file_id: 2,
            start_line: 1,
            end_line: 20,
            is_exported: true,
            signature: 'export default UserProfile',
            created_at: new Date(),
            updated_at: new Date(),
          },
          3: {
            id: 3,
            name: 'User',
            symbol_type: 'class',
            file_id: 3,
            start_line: 5,
            end_line: 25,
            is_exported: true,
            signature: 'class User extends Model',
            created_at: new Date(),
            updated_at: new Date(),
          },
        };
        return Promise.resolve(mockSymbols[symbolId] || null);
      }
    );

    (mockDatabaseService.getFrameworkEntityById as jest.MockedFunction<any>).mockImplementation(
      (entityId: number) => {
        // Return mock framework entities - Match original test expectations
        const mockEntities = {
          1: {
            id: 1,
            name: 'users.index',
            type: 'route',
            filePath: '/backend/routes/api.php',
            metadata: {
              id: 1,
              path: '/api/users',
              method: 'GET',
              controller: 'UserController@index',
            },
          },
          2: {
            id: 2,
            name: 'users.show',
            type: 'route',
            filePath: '/backend/routes/api.php',
            metadata: {
              id: 2,
              path: '/api/users/{id}',
              method: 'GET',
              controller: 'UserController@show',
            },
          },
        };
        return Promise.resolve(mockEntities[entityId] || null);
      }
    );

    // Mock other commonly called methods with empty defaults
    (mockDatabaseService.getFilesByRepository as jest.MockedFunction<any>).mockResolvedValue([]);
    (mockDatabaseService.searchSymbols as jest.MockedFunction<any>).mockResolvedValue([]);
    (mockDatabaseService.getRepositoryFrameworks as jest.MockedFunction<any>).mockResolvedValue([
      'vue',
      'laravel',
    ]);
    (mockDatabaseService.createApiCalls as jest.MockedFunction<any>).mockResolvedValue([]);
    (mockDatabaseService.createDataContracts as jest.MockedFunction<any>).mockResolvedValue([]);

    // Mock framework-specific methods
    (mockDatabaseService.getComponentsByType as jest.MockedFunction<any>).mockResolvedValue([]);
    (mockDatabaseService.getRoutesByFramework as jest.MockedFunction<any>).mockResolvedValue([]);
    (mockDatabaseService.getSymbolsByType as jest.MockedFunction<any>).mockResolvedValue([]);

    builder = new CrossStackGraphBuilder(mockDatabaseService);
  });


  describe('buildDataContractGraph', () => {
    it('should build data contract graphs correctly', async () => {
      const typescriptInterfaces: Symbol[] = [
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
          updated_at: new Date(),
        },
        {
          id: 2,
          name: 'CreateUserRequest',
          symbol_type: SymbolType.INTERFACE,
          file_id: 2,
          start_line: 1,
          end_line: 8,
          is_exported: true,
          signature: 'interface CreateUserRequest { name: string; email: string; }',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const phpDtos: Symbol[] = [
        {
          id: 3,
          name: 'User',
          symbol_type: SymbolType.CLASS,
          file_id: 3,
          start_line: 5,
          end_line: 25,
          is_exported: true,
          signature: 'class User extends Model',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const dataContracts: DataContract[] = [
        {
          id: 1,
          repo_id: 1,
          name: 'User',
          frontend_type_id: 1,
          backend_type_id: 3,
          schema_definition: {
            fields: [
              { name: 'id', frontendType: 'number', backendType: 'int', compatible: true },
              { name: 'name', frontendType: 'string', backendType: 'string', compatible: true },
              { name: 'email', frontendType: 'string', backendType: 'string', compatible: true },
            ],
          },
          drift_detected: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const result = await builder.buildDataContractGraph(
        typescriptInterfaces,
        phpDtos,
        dataContracts
      );

      expect(result).toBeDefined();
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);

      // Check TypeScript interface nodes
      const tsInterfaceNodes = result.nodes.filter(node => node.type === 'typescript_interface');
      expect(tsInterfaceNodes).toHaveLength(2);

      // Check PHP DTO nodes
      const phpDtoNodes = result.nodes.filter(node => node.type === 'php_dto');
      expect(phpDtoNodes).toHaveLength(1);

      // Check data contract edges
      const dataContractEdges = result.edges.filter(
        edge => edge.relationshipType === 'shares_schema'
      );
      expect(dataContractEdges).toHaveLength(1);
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle database errors gracefully', async () => {
      (mockDatabaseService.getCrossStackDependencies as jest.MockedFunction<any>).mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(builder.buildFullStackFeatureGraph(999)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should handle missing schema definitions', async () => {
      const interfacesWithoutProperties: Symbol[] = [
        {
          id: 1,
          name: 'EmptyInterface',
          symbol_type: SymbolType.INTERFACE,
          file_id: 1,
          start_line: 1,
          end_line: 2,
          is_exported: true,
          signature: 'interface EmptyInterface {}',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const dtosWithoutProperties: Symbol[] = [
        {
          id: 2,
          name: 'EmptyDto',
          symbol_type: SymbolType.CLASS,
          file_id: 2,
          start_line: 1,
          end_line: 2,
          is_exported: true,
          signature: 'class EmptyDto {}',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      expect(async () => {
        await builder.buildDataContractGraph(
          interfacesWithoutProperties,
          dtosWithoutProperties,
          []
        );
      }).not.toThrow();
    });

  });
});
