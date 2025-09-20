import { DatabaseService } from '../../src/database/services';
import {
  CreateRepository,
  CreateFile,
  CreateSymbol,
  SymbolType,
  CreateRoute,
  CreateComponent,
  CreateComposable,
  CreateFrameworkMetadata,
  ComponentType,
  ComposableType,
} from '../../src/database/models';

// Mock the database connection for unit tests
jest.mock('../../src/database/connection', () => ({
  getDatabaseConnection: jest.fn(),
}));

describe('DatabaseService', () => {
  let dbService: DatabaseService;
  let mockDb: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create a fresh mock database function for each test
    mockDb = jest.fn() as any;

    // Add static methods that are accessed directly on the db object
    mockDb.migrate = {
      latest: jest.fn().mockResolvedValue({}),
      rollback: jest.fn().mockResolvedValue({}),
    };
    mockDb.raw = jest.fn().mockResolvedValue({});
    mockDb.transaction = jest.fn();
    mockDb.destroy = jest.fn().mockResolvedValue(undefined);

    // Mock the getDatabaseConnection to return our mock
    const { getDatabaseConnection } = require('../../src/database/connection');
    (getDatabaseConnection as jest.Mock).mockReturnValue(mockDb);

    dbService = new DatabaseService();
  });

  describe('Repository operations', () => {
    it('should create a repository', async () => {
      const repositoryData: CreateRepository = {
        name: 'test-repo',
        path: '/path/to/repo',
        language_primary: 'javascript',
        framework_stack: ['react', 'nextjs'],
      };

      const mockRepository = {
        id: 1,
        ...repositoryData,
        // Simulate database storage: framework_stack is stored as JSON string
        framework_stack: JSON.stringify(repositoryData.framework_stack),
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Mock the database call
      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'repositories') {
          return {
            insert: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockRepository]),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.createRepository(repositoryData);

      // The result should have framework_stack parsed back to array
      const expectedResult = {
        ...mockRepository,
        framework_stack: repositoryData.framework_stack, // Should be parsed back to array
      };

      expect(result).toEqual(expectedResult);
    });

    it('should get a repository by ID', async () => {
      const mockRepository = {
        id: 1,
        name: 'test-repo',
        path: '/path/to/repo',
      };

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'repositories') {
          return {
            where: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue(mockRepository),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.getRepository(1);

      expect(result).toEqual(mockRepository);
    });

    it('should return null for non-existent repository', async () => {
      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'repositories') {
          return {
            where: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue(undefined),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.getRepository(999);

      expect(result).toBeNull();
    });
  });

  describe('File operations', () => {
    it('should create a file', async () => {
      const fileData: CreateFile = {
        repo_id: 1,
        path: '/path/to/file.js',
        language: 'javascript',
        size: 1024,
        last_modified: new Date(),
      };

      const mockFile = {
        id: 1,
        ...fileData,
        is_generated: false,
        is_test: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Mock for both the existence check and insert operations
      let callCount = 0;
      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'files') {
          if (callCount === 0) {
            callCount++;
            // First call: check for existing file (returns undefined = no existing file)
            return {
              where: jest.fn().mockReturnValue({
                first: jest.fn().mockResolvedValue(undefined),
              }),
            };
          } else {
            // Second call: insert new file
            return {
              insert: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([mockFile]),
              }),
            };
          }
        }
        return mockDb;
      });

      const result = await dbService.createFile(fileData);

      expect(result).toEqual(mockFile);
    });

    it('should get files by repository', async () => {
      const mockFiles = [
        { id: 1, repo_id: 1, path: '/path/to/file1.js' },
        { id: 2, repo_id: 1, path: '/path/to/file2.js' },
      ];

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'files') {
          return {
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockFiles),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.getFilesByRepository(1);

      expect(result).toEqual(mockFiles);
    });
  });

  describe('Symbol operations', () => {
    it('should create a symbol', async () => {
      const symbolData: CreateSymbol = {
        file_id: 1,
        name: 'testFunction',
        symbol_type: SymbolType.FUNCTION,
        start_line: 1,
        end_line: 10,
        is_exported: true,
        signature: 'function testFunction() {}',
      };

      const mockSymbol = {
        id: 1,
        ...symbolData,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'symbols') {
          return {
            insert: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockSymbol]),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.createSymbol(symbolData);

      expect(result).toEqual(mockSymbol);
    });

    it('should create multiple symbols in batch', async () => {
      const symbolsData: CreateSymbol[] = [
        {
          file_id: 1,
          name: 'function1',
          symbol_type: SymbolType.FUNCTION,
        },
        {
          file_id: 1,
          name: 'function2',
          symbol_type: SymbolType.FUNCTION,
        },
      ];

      const mockSymbols = symbolsData.map((data, index) => ({
        id: index + 1,
        ...data,
        start_line: undefined,
        end_line: undefined,
        is_exported: false,
        visibility: undefined,
        signature: undefined,
        created_at: new Date(),
        updated_at: new Date(),
      }));

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'symbols') {
          return {
            insert: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue(mockSymbols),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.createSymbols(symbolsData);

      expect(result).toEqual(mockSymbols);
      expect(result).toHaveLength(2);
    });

    it('should handle empty symbol array', async () => {
      const result = await dbService.createSymbols([]);
      expect(result).toEqual([]);
    });

    it('should search symbols by query', async () => {
      const mockSymbols = [
        {
          id: 1,
          name: 'testFunction',
          symbol_type: SymbolType.FUNCTION,
          file_path: '/path/to/file.js',
          file_language: 'javascript',
        },
      ];

      // Enhanced mock to handle both fulltext search (with raw SQL) and lexical search fallback
      mockDb.mockImplementation(() => ({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        orderByRaw: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockSymbols),
      }));

      // Mock the raw method to simulate PostgreSQL fulltext search failure
      // This will trigger the fallback to lexical search
      mockDb.raw = jest.fn().mockImplementation(() => {
        throw new Error('PostgreSQL function not available in mock');
      });

      const result = await dbService.searchSymbols('test', 1); // Provide repo ID for test

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'testFunction',
        symbol_type: SymbolType.FUNCTION,
      });
    });
  });

  describe('Migration operations', () => {
    it('should run migrations', async () => {
      const migrateMock = jest.fn().mockResolvedValue({});
      mockDb.migrate = { latest: migrateMock };

      await dbService.runMigrations();

      expect(migrateMock).toHaveBeenCalled();
    });

    it('should rollback migrations', async () => {
      const rollbackMock = jest.fn().mockResolvedValue({});
      mockDb.migrate = { rollback: rollbackMock };

      await dbService.rollbackMigrations();

      expect(rollbackMock).toHaveBeenCalled();
    });
  });

  // Framework-specific operation tests
  describe('Framework Route operations', () => {
    it('should create a route', async () => {
      const routeData: CreateRoute = {
        repo_id: 1,
        path: '/api/users/[id]',
        method: 'GET',
        framework_type: 'nextjs',
        middleware: ['auth', 'validation'],
        dynamic_segments: ['id'],
        auth_required: true,
      };

      const mockRoute = {
        id: 1,
        ...routeData,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'routes') {
          return {
            insert: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockRoute]),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.createRoute(routeData);

      expect(result).toEqual(mockRoute);
    });

    it('should get routes by framework', async () => {
      const mockRoutes = [
        { id: 1, repo_id: 1, path: '/api/users', framework_type: 'nextjs', method: 'GET' },
        { id: 2, repo_id: 1, path: '/api/posts', framework_type: 'nextjs', method: 'POST' },
      ];

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'routes') {
          return {
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockRoutes),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.getRoutesByFramework(1, 'nextjs');

      expect(result).toEqual(mockRoutes);
    });

    it('should find route by path and method', async () => {
      const mockRoute = {
        id: 1,
        repo_id: 1,
        path: '/api/users',
        method: 'GET',
        framework_type: 'express',
      };

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'routes') {
          return {
            where: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue(mockRoute),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.findRouteByPath(1, '/api/users', 'GET');

      expect(result).toEqual(mockRoute);
    });

    it('should search routes by query', async () => {
      const mockRoutes = [
        { id: 1, path: '/api/users', method: 'GET', framework_type: 'express' },
        { id: 2, path: '/api/user-profiles', method: 'POST', framework_type: 'express' },
      ];

      mockDb.mockImplementation(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockRoutes),
      }));

      const result = await dbService.searchRoutes({
        query: 'user',
        repo_id: 1,
        framework: 'express',
        limit: 10,
      });

      expect(result).toEqual(mockRoutes);
    });
  });

  describe('Framework Component operations', () => {
    it('should create a component', async () => {
      const componentData: CreateComponent = {
        repo_id: 1,
        symbol_id: 1,
        component_type: ComponentType.VUE,
        props: [
          {
            name: 'title',
            type: 'string',
            required: true,
            description: 'Component title',
          },
        ],
        emits: ['update', 'close'],
        slots: ['default', 'header'],
        template_dependencies: ['UserCard', 'Button'],
      };

      const mockComponent = {
        id: 1,
        ...componentData,
        hooks: [],
        parent_component_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'components') {
          return {
            insert: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockComponent]),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.createComponent(componentData);

      expect(result).toEqual(mockComponent);
    });

    it('should get components by type', async () => {
      const mockComponents = [
        { id: 1, repo_id: 1, component_type: ComponentType.REACT, symbol_id: 1 },
        { id: 2, repo_id: 1, component_type: ComponentType.REACT, symbol_id: 2 },
      ];

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'components') {
          return {
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockComponents),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.getComponentsByType(1, ComponentType.REACT);

      expect(result).toEqual(mockComponents);
    });

    it('should find component by name', async () => {
      const mockComponent = {
        id: 1,
        repo_id: 1,
        symbol_id: 1,
        component_type: ComponentType.VUE,
      };

      mockDb.mockImplementation(() => ({
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(mockComponent),
      }));

      const result = await dbService.findComponentByName(1, 'UserProfile');

      expect(result).toEqual(mockComponent);
    });

    it('should search components with options', async () => {
      const mockComponents = [
        { id: 1, component_type: ComponentType.VUE, symbol_id: 1 },
        { id: 2, component_type: ComponentType.VUE, symbol_id: 2 },
      ];

      mockDb.mockImplementation(() => ({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockComponents),
      }));

      const result = await dbService.searchComponents({
        query: 'User',
        component_type: ComponentType.VUE,
        repo_id: 1,
        limit: 20,
      });

      expect(result).toEqual(mockComponents);
    });
  });

  describe('Framework Composable operations', () => {
    it('should create a composable', async () => {
      const composableData: CreateComposable = {
        repo_id: 1,
        symbol_id: 1,
        composable_type: ComposableType.VUE_COMPOSABLE,
        returns: ['count', 'increment', 'decrement'],
        dependencies: ['ref', 'computed'],
        reactive_refs: ['count'],
      };

      const mockComposable = {
        id: 1,
        ...composableData,
        dependency_array: [],
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'composables') {
          return {
            insert: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockComposable]),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.createComposable(composableData);

      expect(result).toEqual(mockComposable);
    });

    it('should get composables by type', async () => {
      const mockComposables = [
        { id: 1, composable_type: ComposableType.REACT_HOOK, symbol_id: 1 },
        { id: 2, composable_type: ComposableType.REACT_HOOK, symbol_id: 2 },
      ];

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'composables') {
          return {
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockComposables),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.getComposablesByType(1, ComposableType.REACT_HOOK);

      expect(result).toEqual(mockComposables);
    });

    it('should search composables with filters', async () => {
      const mockComposables = [
        { id: 1, composable_type: ComposableType.VUE_COMPOSABLE, symbol_id: 1 },
        { id: 2, composable_type: ComposableType.VUE_COMPOSABLE, symbol_id: 2 },
      ];

      mockDb.mockImplementation(() => ({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockComposables),
      }));

      const result = await dbService.searchComposables({
        query: 'use',
        composable_type: ComposableType.VUE_COMPOSABLE,
        repo_id: 1,
      });

      expect(result).toEqual(mockComposables);
    });
  });

  describe('Framework Metadata operations', () => {
    it('should store framework metadata', async () => {
      const metadataData: CreateFrameworkMetadata = {
        repo_id: 1,
        framework_type: 'vue',
        version: '3.3.0',
        config_path: 'vue.config.js',
        metadata: {
          plugins: ['vue-router', 'pinia'],
          buildTool: 'vite',
        },
      };

      const mockMetadata = {
        id: 1,
        ...metadataData,
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Mock first call to check for existing metadata (returns undefined)
      // Then mock insert call
      let callCount = 0;
      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'framework_metadata') {
          if (callCount === 0) {
            callCount++;
            return {
              where: jest.fn().mockReturnValue({
                first: jest.fn().mockResolvedValue(undefined),
              }),
            };
          } else {
            return {
              insert: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([mockMetadata]),
              }),
            };
          }
        }
        return mockDb;
      });

      const result = await dbService.storeFrameworkMetadata(metadataData);

      expect(result).toEqual(mockMetadata);
    });

    it('should update existing framework metadata', async () => {
      const metadataData: CreateFrameworkMetadata = {
        repo_id: 1,
        framework_type: 'nextjs',
        version: '14.0.0',
        config_path: 'next.config.js',
        metadata: {
          features: ['app-router', 'server-actions'],
        },
      };

      const existingMetadata = { id: 1, ...metadataData };
      const updatedMetadata = { ...existingMetadata, updated_at: new Date() };

      // Mock first call to return existing metadata
      // Then mock update call
      let callCount = 0;
      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'framework_metadata') {
          if (callCount === 0) {
            callCount++;
            return {
              where: jest.fn().mockReturnValue({
                first: jest.fn().mockResolvedValue(existingMetadata),
              }),
            };
          } else {
            return {
              where: jest.fn().mockReturnValue({
                update: jest.fn().mockReturnValue({
                  returning: jest.fn().mockResolvedValue([updatedMetadata]),
                }),
              }),
            };
          }
        }
        return mockDb;
      });

      const result = await dbService.storeFrameworkMetadata(metadataData);

      expect(result).toEqual(updatedMetadata);
    });

    it('should get framework stack for repository', async () => {
      const mockMetadata = [
        { id: 1, framework_type: 'vue', version: '3.3.0' },
        { id: 2, framework_type: 'nextjs', version: '14.0.0' },
      ];

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'framework_metadata') {
          return {
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockMetadata),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.getFrameworkStack(1);

      expect(result).toEqual(mockMetadata);
    });

    it('should get specific framework metadata', async () => {
      const mockMetadata = {
        id: 1,
        repo_id: 1,
        framework_type: 'react',
        version: '18.2.0',
        metadata: { strict: true },
      };

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'framework_metadata') {
          return {
            where: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue(mockMetadata),
            }),
          };
        }
        return mockDb;
      });

      const result = await dbService.getFrameworkMetadata(1, 'react');

      expect(result).toEqual(mockMetadata);
    });
  });

  describe('Enhanced Symbol operations', () => {
    it('should find symbol by name in repository', async () => {
      const mockSymbol = {
        id: 1,
        name: 'useAuth',
        symbol_type: SymbolType.FUNCTION,
        file_id: 1,
        file_path: '/composables/useAuth.js',
        file_language: 'javascript',
      };

      mockDb.mockImplementation(() => ({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(mockSymbol),
      }));

      const result = await dbService.findSymbolByName(1, 'useAuth');

      expect(result).toMatchObject({
        id: 1,
        name: 'useAuth',
        symbol_type: SymbolType.FUNCTION,
        file: {
          id: 1,
          path: '/composables/useAuth.js',
          language: 'javascript',
        },
      });
    });

    it('should return null for non-existent symbol', async () => {
      mockDb.mockImplementation(() => ({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(undefined),
      }));

      const result = await dbService.findSymbolByName(1, 'nonExistentFunction');

      expect(result).toBeNull();
    });
  });
});