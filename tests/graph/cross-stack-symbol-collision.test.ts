import {
  CrossStackGraphBuilder,
} from '../../src/graph/cross-stack-builder';
import { DatabaseService } from '../../src/database/services';
import {
  SymbolWithFile,
  SymbolType,
  Repository,
} from '../../src/database/models';
import { jest } from '@jest/globals';

const mockDatabaseService = {
  getSymbol: jest.fn() as jest.MockedFunction<any>,
  searchSymbols: jest.fn() as jest.MockedFunction<any>,
  getRepository: jest.fn() as jest.MockedFunction<any>,
  getFilesByRepository: jest.fn() as jest.MockedFunction<any>,
  getApiCallsByRepository: jest.fn() as jest.MockedFunction<any>,
  createApiCalls: jest.fn() as jest.MockedFunction<any>,
  getRoutesByFramework: jest.fn() as jest.MockedFunction<any>,
  streamCrossStackData: jest.fn() as jest.MockedFunction<any>,
} as unknown as DatabaseService;

describe('CrossStackGraphBuilder - Symbol Collision Fix', () => {
  let builder: CrossStackGraphBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new CrossStackGraphBuilder(mockDatabaseService);

    (mockDatabaseService.getRepository as jest.MockedFunction<any>).mockResolvedValue({
      id: 1,
      name: 'test-repo',
      path: '/test/repo',
      created_at: new Date(),
      updated_at: new Date(),
    } as Repository);
  });

  describe('selectBestMatchingSymbol', () => {
    it('should return null for empty candidates', () => {
      const result = (builder as any).selectBestMatchingSymbol([], '/path/to/file.vue');
      expect(result).toBeNull();
    });

    it('should return single candidate when only one exists', () => {
      const candidates: SymbolWithFile[] = [
        {
          id: 1,
          file_id: 1,
          name: 'register',
          symbol_type: 'function' as SymbolType,
          is_exported: true,
          file_path: '/resources/ts/Pages/Auth/Register.vue',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
      ];

      const result = (builder as any).selectBestMatchingSymbol(
        candidates,
        '/resources/ts/Pages/Auth/Register.vue'
      );
      expect(result).toBe(candidates[0]);
    });

    it('should prefer same-file match over other frontend files', () => {
      const candidates: SymbolWithFile[] = [
        {
          id: 1,
          file_id: 1,
          name: 'register',
          symbol_type: 'method' as SymbolType,
          is_exported: true,
          file_path: '/resources/ts/Pages/Child-Components/SelectBox.vue',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
        {
          id: 2,
          file_id: 2,
          name: 'register',
          symbol_type: 'function' as SymbolType,
          is_exported: true,
          file_path: '/resources/ts/Pages/Auth/Register.vue',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
        {
          id: 3,
          file_id: 3,
          name: 'register',
          symbol_type: 'method' as SymbolType,
          is_exported: true,
          file_path: '/resources/ts/composables/useAuth.ts',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
      ];

      const result = (builder as any).selectBestMatchingSymbol(
        candidates,
        '/resources/ts/Pages/Auth/Register.vue'
      );
      expect(result).toBe(candidates[1]);
      expect(result.id).toBe(2);
    });

    it('should filter out backend symbols and return null if no frontend matches', () => {
      const candidates: SymbolWithFile[] = [
        {
          id: 1,
          file_id: 1,
          name: 'register',
          symbol_type: 'method' as SymbolType,
          is_exported: true,
          file_path: '/app/Exceptions/Handler.php',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
        {
          id: 2,
          file_id: 2,
          name: 'register',
          symbol_type: 'method' as SymbolType,
          is_exported: true,
          file_path: '/app/Providers/AppServiceProvider.php',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
        {
          id: 3,
          file_id: 3,
          name: 'register',
          symbol_type: 'method' as SymbolType,
          is_exported: true,
          file_path: '/app/Http/Controllers/Auth/AuthController.php',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
      ];

      const result = (builder as any).selectBestMatchingSymbol(
        candidates,
        '/resources/ts/Pages/Auth/Register.vue'
      );
      expect(result).toBeNull();
    });

    it('should prefer callable types (function/method) over variables', () => {
      const candidates: SymbolWithFile[] = [
        {
          id: 1,
          file_id: 1,
          name: 'update',
          symbol_type: 'variable' as SymbolType,
          is_exported: true,
          file_path: '/resources/ts/store/user.ts',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
        {
          id: 2,
          file_id: 2,
          name: 'update',
          symbol_type: 'function' as SymbolType,
          is_exported: true,
          file_path: '/resources/ts/composables/useUser.ts',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
      ];

      const result = (builder as any).selectBestMatchingSymbol(candidates, undefined);
      expect(result).toBe(candidates[1]);
      expect(result.symbol_type).toBe('function');
    });

    it('should handle 12-symbol collision case (real-world scenario)', () => {
      const candidates: SymbolWithFile[] = [];

      for (let i = 1; i <= 8; i++) {
        candidates.push({
          id: i,
          file_id: i,
          name: 'update',
          symbol_type: 'method' as SymbolType,
          is_exported: true,
          file_path: `/app/Http/Controllers/Controller${i}.php`,
          created_at: new Date(),
          updated_at: new Date(),
        } as any);
      }

      candidates.push({
        id: 9,
        file_id: 9,
        name: 'update',
        symbol_type: 'function' as SymbolType,
        is_exported: true,
        file_path: '/resources/ts/composables/useUpdate.ts',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      for (let i = 10; i <= 12; i++) {
        candidates.push({
          id: i,
          file_id: i,
          name: 'update',
          symbol_type: 'method' as SymbolType,
          is_exported: true,
          file_path: `/app/Models/Model${i}.php`,
          created_at: new Date(),
          updated_at: new Date(),
        } as any);
      }

      const result = (builder as any).selectBestMatchingSymbol(
        candidates,
        '/resources/ts/Pages/User/Edit.vue'
      );

      expect(result).not.toBeNull();
      expect(result.id).toBe(9);
      expect(result.file_path).toContain('/resources/ts/');
    });

    it('should handle mix of .vue, .ts, .tsx, .js, .jsx files', () => {
      const candidates: SymbolWithFile[] = [
        {
          id: 1,
          file_id: 1,
          name: 'validate',
          symbol_type: 'function' as SymbolType,
          is_exported: true,
          file_path: '/resources/ts/utils/validation.ts',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
        {
          id: 2,
          file_id: 2,
          name: 'validate',
          symbol_type: 'function' as SymbolType,
          is_exported: true,
          file_path: '/resources/js/legacy/validator.js',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
        {
          id: 3,
          file_id: 3,
          name: 'validate',
          symbol_type: 'function' as SymbolType,
          is_exported: true,
          file_path: '/app/Validators/Custom.php',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
      ];

      const result = (builder as any).selectBestMatchingSymbol(
        candidates,
        '/resources/ts/Pages/Form.vue'
      );

      expect(result).not.toBeNull();
      expect(result.file_path).toMatch(/\.(ts|js|vue|tsx|jsx)$/);
    });
  });
});
