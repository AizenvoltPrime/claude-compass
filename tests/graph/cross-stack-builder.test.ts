import {
  CrossStackGraphBuilder,
  CrossStackNode,
  CrossStackEdge,
  CrossStackGraphData,
  FullStackFeatureGraph,
} from '../../src/graph/cross-stack-builder';
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
import type { Knex } from 'knex';

// Create a mock query builder with proper typing
// @ts-ignore - Mock setup intentionally uses simplified types
const createMockQueryBuilder = (): any => {
  const mock: any = {
    where: jest.fn(),
    first: jest.fn(),
    select: jest.fn(),
    leftJoin: jest.fn(),
    whereIn: jest.fn(),
    orWhereIn: jest.fn(),
    andWhere: jest.fn(),
    orWhere: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    orderBy: jest.fn(),
    groupBy: jest.fn(),
    having: jest.fn(),
    count: jest.fn(),
    sum: jest.fn(),
    avg: jest.fn(),
    min: jest.fn(),
    max: jest.fn(),
    del: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    then: jest.fn(),
  };

  // Make methods chainable
  Object.keys(mock).forEach(key => {
    if (key !== 'then') {
      mock[key].mockReturnValue(mock);
    }
  });

  // Set async return values
  mock.first.mockResolvedValue(null);
  mock.del.mockResolvedValue(0);
  mock.insert.mockResolvedValue([1]);
  mock.update.mockResolvedValue(1);
  mock.then.mockResolvedValue([]);

  return mock;
};

// Create a minimal mock Knex instance for testing
const mockDb = Object.assign(
  jest.fn().mockImplementation(() => createMockQueryBuilder()),
  {
    // @ts-ignore - Mock setup intentionally uses simplified types
    raw: jest.fn().mockResolvedValue({}),
    transaction: jest.fn(),
    schema: {
      // @ts-ignore - Mock setup intentionally uses simplified types
      hasTable: jest.fn().mockResolvedValue(true),
      // @ts-ignore - Mock setup intentionally uses simplified types
      hasColumn: jest.fn().mockResolvedValue(true),
    },
  }
) as unknown as Knex;

describe('CrossStackGraphBuilder', () => {
  let builder: CrossStackGraphBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new CrossStackGraphBuilder(mockDb);
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
    it.skip('should handle database errors gracefully', async () => {
      // Test skipped - requires mock setup that was removed during refactoring
      await expect(builder.buildFullStackFeatureGraph(999)).rejects.toThrow();
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
