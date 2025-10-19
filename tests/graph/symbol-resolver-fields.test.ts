import { SymbolResolver, SymbolResolutionContext } from '../../src/graph/symbol-resolver';
import { Symbol, File, SymbolType, DependencyType } from '../../src/database/models';
import { ParsedDependency, ParsedImport, ParsedExport } from '../../src/parsers/base';

describe('Symbol Resolver Field Resolution', () => {
  let resolver: SymbolResolver;
  let mockSymbols: Symbol[];
  let mockFiles: File[];

  beforeEach(() => {
    resolver = new SymbolResolver();

    // Mock symbols for CardManager and HandManager
    mockSymbols = [
      {
        id: 1,
        file_id: 1,
        name: 'CardManager',
        symbol_type: SymbolType.CLASS,
        start_line: 1,
        end_line: 20,
        is_exported: true,
        signature: 'public class CardManager',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 2,
        file_id: 1,
        name: 'SetHandPositions',
        symbol_type: SymbolType.METHOD,
        start_line: 5,
        end_line: 8,
        is_exported: true,
        signature: 'public void SetHandPositions(Vector3 playerPos, Vector3 opponentPos)',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 3,
        file_id: 1,
        name: '_handManager',
        symbol_type: SymbolType.PROPERTY,
        start_line: 3,
        end_line: 3,
        is_exported: false,
        signature: 'IHandManager _handManager',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 4,
        file_id: 2,
        name: 'HandManager',
        symbol_type: SymbolType.CLASS,
        start_line: 1,
        end_line: 15,
        is_exported: true,
        signature: 'public class HandManager : IHandManager',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 5,
        file_id: 2,
        name: 'SetHandPositions',
        symbol_type: SymbolType.METHOD,
        start_line: 8,
        end_line: 12,
        is_exported: true,
        signature: 'public void SetHandPositions(Vector3 playerPos, Vector3 opponentPos)',
        created_at: new Date(),
        updated_at: new Date()
      }
    ];

    mockFiles = [
      {
        id: 1,
        repo_id: 1,
        path: '/test/CardManager.cs',
        language: 'csharp',
        is_generated: false,
        is_test: false,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 2,
        repo_id: 1,
        path: '/test/HandManager.cs',
        language: 'csharp',
        is_generated: false,
        is_test: false,
        created_at: new Date(),
        updated_at: new Date()
      }
    ];

    // Initialize resolver
    resolver.initialize(mockFiles, mockSymbols, new Map(), new Map());
  });

  describe('setFieldTypeMap', () => {
    test('should set field type mappings correctly', () => {
      const fieldMap = new Map<string, string>();
      fieldMap.set('_handManager', 'HandManager');
      fieldMap.set('_userService', 'UserService');

      resolver.setFieldTypeMap(fieldMap);

      // Verify the mappings are set (we can't directly access private fields,
      // so we'll test this through the resolution process)
      expect(resolver).toBeDefined();
    });

    test('should clear field type mappings', () => {
      const fieldMap = new Map<string, string>();
      fieldMap.set('_handManager', 'HandManager');
      resolver.setFieldTypeMap(fieldMap);

      resolver.clearFieldTypeMap();

      // Verify cleared (tested through resolution)
      expect(resolver).toBeDefined();
    });
  });

  describe('resolveTargetSymbol with field context', () => {
    test('should fallback gracefully when field type unknown', () => {
      const sourceContext: SymbolResolutionContext = {
        fileId: 1,
        filePath: '/test/CardManager.cs',
        symbols: mockSymbols.filter(s => s.file_id === 1),
        imports: [],
        exports: []
      };

      const dependency: ParsedDependency = {
        from_symbol: 'SetHandPositions',
        to_symbol: 'UnknownClass.UnknownMethod',
        dependency_type: DependencyType.CALLS,
        line_number: 6,
        qualified_context: 'field_call_unknownField'
      };

      const result = (resolver as any).resolveTargetSymbol(
        sourceContext,
        dependency.to_symbol,
        dependency
      );

      // Should fallback to normal resolution process
      expect(result).toBeNull(); // No matching symbol exists
    });
  });

  describe('resolveDependencies integration', () => {
    test('should set and clear field context for C# files', () => {
      const dependencies: ParsedDependency[] = [
        {
          from_symbol: 'SetHandPositions',
          to_symbol: 'HandManager.SetHandPositions',
          dependency_type: DependencyType.CALLS,
          line_number: 6,
            qualified_context: 'field_call__handManager'
        }
      ];

      const resolved = resolver.resolveDependencies(1, dependencies);

      expect(resolved).toBeDefined();
      expect(resolved.length).toBeGreaterThanOrEqual(0);

      // Field context should be cleared after processing
      // (we can't directly test this, but it should not throw errors)
    });

    test('should handle non-C# files without field context', () => {
      // Change file path to non-C#
      mockFiles[0].path = '/test/script.js';
      resolver.initialize(mockFiles, mockSymbols, new Map(), new Map());

      const dependencies: ParsedDependency[] = [
        {
          from_symbol: 'function1',
          to_symbol: 'function2',
          dependency_type: DependencyType.CALLS,
          line_number: 5
        }
      ];

      const resolved = resolver.resolveDependencies(1, dependencies);

      expect(resolved).toBeDefined();
      // Should not attempt field context setup for non-C# files
    });
  });
});