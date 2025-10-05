import { CSharpParser } from '../../src/parsers/csharp';
import { DependencyType } from '../../src/database/models';
import { ParsedDependency } from '../../src/parsers/base';

describe('C# Field Resolution', () => {
  let parser: CSharpParser;

  beforeEach(() => {
    parser = new CSharpParser();
  });

  describe('extractFieldDeclarations', () => {
    test('should extract field declarations correctly', () => {
      const content = `
        public class CardManager {
          private IHandManager _handManager;
          private GameState gameState;
          public string PlayerName;
        }
      `;

      const tree = (parser as any).parser.parse(content);
      // Access the private method using type assertion
      const fieldMap = (parser as any).extractFieldDeclarations(tree.rootNode);

      expect(fieldMap.size).toBe(3);
      expect(fieldMap.get('_handManager')).toBe('HandManager'); // Interface converted to class
      expect(fieldMap.get('gameState')).toBe('GameState');
      expect(fieldMap.get('PlayerName')).toBe('string');
    });

    test('should handle interface to class mapping', () => {
      const content = `
        public class ServiceManager {
          private IUserService _userService;
          private ILogService _logService;
          private DataManager dataManager;
        }
      `;

      const tree = (parser as any).parser.parse(content);
      const fieldMap = (parser as any).extractFieldDeclarations(tree.rootNode);

      expect(fieldMap.size).toBe(3);
      expect(fieldMap.get('_userService')).toBe('UserService');
      expect(fieldMap.get('_logService')).toBe('LogService');
      expect(fieldMap.get('dataManager')).toBe('DataManager');
    });

    test('should handle generic types', () => {
      const content = `
        public class GenericManager {
          private List<string> _items;
          private Dictionary<int, User> _userMap;
        }
      `;

      const tree = (parser as any).parser.parse(content);
      const fieldMap = (parser as any).extractFieldDeclarations(tree.rootNode);

      expect(fieldMap.size).toBe(2);
      expect(fieldMap.get('_items')).toBe('List<string>');
      expect(fieldMap.get('_userMap')).toBe('Dictionary<int, User>');
    });
  });

  describe('extractConditionalAccessDependencies', () => {
    test('should resolve conditional access calls with field context', async () => {
      const content = `
        public class CardManager {
          private IHandManager _handManager;

          public void SetHandPositions() {
            _handManager?.SetHandPositions(pos1, pos2);
          }
        }
      `;

      const result = await parser.parseFile('test.cs', content);

      // Look for the field-based dependency
      const fieldBasedDep = result.dependencies.find(d =>
        d.to_symbol.includes('HandManager.SetHandPositions') &&
        d.qualified_context === 'field_call__handManager'
      );

      expect(fieldBasedDep).toBeDefined();
      expect(fieldBasedDep?.from_symbol).toBe('CardManager.SetHandPositions'); // From qualified method name
      expect(fieldBasedDep?.dependency_type).toBe(DependencyType.CALLS);
    });

    test('should handle chained conditional access calls', async () => {
      const content = `
        public class GameController {
          private IPlayerManager _playerManager;

          public void UpdatePlayer() {
            _playerManager?.GetPlayer()?.UpdateStats();
          }
        }
      `;

      const result = await parser.parseFile('test.cs', content);

      // Should find GetPlayer with field context
      const getPlayerDep = result.dependencies.find(d =>
        d.to_symbol.includes('PlayerManager.GetPlayer')
      );

      // Should find UpdateStats without field context (it's chained)
      const updateStatsDep = result.dependencies.find(d =>
        d.to_symbol.includes('UpdateStats')
      );

      expect(getPlayerDep).toBeDefined();
      expect(updateStatsDep).toBeDefined();
    });

    test('should fallback gracefully when field type unknown', async () => {
      const content = `
        public class UnknownManager {
          public void DoWork() {
            unknownField?.DoSomething();
          }
        }
      `;

      const result = await parser.parseFile('test.cs', content);

      // Should find fallback dependency for unknown field

      // Should still create dependency but without class context
      const fallbackDep = result.dependencies.find(d =>
        d.to_symbol.includes('DoSomething')
      );

      expect(fallbackDep).toBeDefined();
    });
  });

  describe('integration with main extractDependencies', () => {
    test('should extract field mappings during dependency extraction', async () => {
      const content = `
        public class CardManager {
          private IHandManager _handManager;
          private GameState gameState;

          public void InitializeServices() {
            _handManager?.SetHandPositions(pos1, pos2);
            gameState?.Reset();
          }
        }
      `;

      const result = await parser.parseFile('test.cs', content);

      // Check for field-based dependencies
      const handManagerDep = result.dependencies.find(d =>
        d.to_symbol.includes('HandManager.SetHandPositions')
      );
      const gameStateDep = result.dependencies.find(d =>
        d.to_symbol.includes('GameState.Reset')
      );

      expect(handManagerDep).toBeDefined();
      expect(handManagerDep?.qualified_context).toBe('field_call__handManager');
      expect(gameStateDep).toBeDefined();
      expect(gameStateDep?.qualified_context).toBe('field_call_gameState');
    });

    test('should handle the specific reported CardManager -> HandManager issue', async () => {
      // This is the exact pattern from the issue report
      const content = `
        public class CardManager {
          private IHandManager _handManager;

          public void SetHandPositions(Vector3 playerHandPosition, Vector3 opponentHandPosition) {
            _handManager?.SetHandPositions(playerHandPosition, opponentHandPosition);
          }
        }
      `;

      const result = await parser.parseFile('CardManager.cs', content);

      // Should find the field-based dependency
      const targetDep = result.dependencies.find(d =>
        d.from_symbol === 'CardManager.SetHandPositions' &&
        d.to_symbol.includes('HandManager.SetHandPositions') &&
        d.qualified_context === 'field_call__handManager'
      );

      expect(targetDep).toBeDefined();
      expect(targetDep?.dependency_type).toBe(DependencyType.CALLS);
      expect(targetDep?.line_number).toBeGreaterThan(0);
    });
  });
});