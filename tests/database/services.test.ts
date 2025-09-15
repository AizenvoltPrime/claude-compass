import { DatabaseService } from '../../src/database/services';
import { CreateRepository, CreateFile, CreateSymbol, SymbolType } from '../../src/database/models';

// Mock the database connection for unit tests
jest.mock('../../src/database/connection', () => ({
  getDatabaseConnection: jest.fn(() => ({
    // Mock Knex instance
    raw: jest.fn().mockResolvedValue({}),
    migrate: {
      latest: jest.fn().mockResolvedValue({}),
      rollback: jest.fn().mockResolvedValue({}),
    },
    // Mock table methods
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
  })),
}));

describe('DatabaseService', () => {
  let dbService: DatabaseService;
  let mockDb: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    dbService = new DatabaseService();
    mockDb = (dbService as any).db;
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

      expect(result).toEqual(mockRepository);
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

      mockDb.mockImplementation((tableName: string) => {
        if (tableName === 'files') {
          return {
            insert: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockFile]),
            }),
          };
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

      mockDb.mockImplementation(() => ({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockSymbols),
      }));

      const result = await dbService.searchSymbols('test');

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
});