import { CSharpParser } from '../../src/parsers/csharp';
import { DependencyType } from '../../src/database/models';
import { ParsedDependency } from '../../src/parsers/base';

describe('C# Field Resolution', () => {
  let parser: CSharpParser;

  beforeEach(() => {
    parser = new CSharpParser();
  });

  describe('field type resolution', () => {
    test('should extract and resolve field types through dependencies', async () => {
      const content = `
        public class CardManager {
          private IHandManager _handManager;
          private GameState gameState;
          public string PlayerName;

          public void TestMethod() {
            _handManager?.SetPositions();
            gameState?.Reset();
          }
        }
      `;

      const result = await parser.parseFile('test.cs', content);

      const handManagerDep = result.dependencies.find(d =>
        d.to_symbol.includes('HandManager.SetPositions')
      );
      const gameStateDep = result.dependencies.find(d =>
        d.to_symbol.includes('GameState.Reset')
      );

      expect(handManagerDep).toBeDefined();
      expect(handManagerDep?.resolved_class).toBe('HandManager');
      expect(gameStateDep).toBeDefined();
      expect(gameStateDep?.resolved_class).toBe('GameState');
    });

    test('should handle interface to class mapping in resolved types', async () => {
      const content = `
        public class ServiceManager {
          private IUserService _userService;
          private ILogService _logService;
          private DataManager dataManager;

          public void Initialize() {
            _userService?.LoadUsers();
            _logService?.Log();
            dataManager?.Initialize();
          }
        }
      `;

      const result = await parser.parseFile('test.cs', content);

      const userServiceDep = result.dependencies.find(d =>
        d.to_symbol.includes('UserService.LoadUsers')
      );
      const logServiceDep = result.dependencies.find(d =>
        d.to_symbol.includes('LogService.Log')
      );
      const dataManagerDep = result.dependencies.find(d =>
        d.to_symbol.includes('DataManager.Initialize')
      );

      expect(userServiceDep?.resolved_class).toBe('UserService');
      expect(logServiceDep?.resolved_class).toBe('LogService');
      expect(dataManagerDep?.resolved_class).toBe('DataManager');
    });

    test('should handle generic field types', async () => {
      const content = `
        public class GenericManager {
          private List<string> _items;
          private Dictionary<int, User> _userMap;

          public void Process() {
            _items?.Add("test");
            _userMap?.Clear();
          }
        }
      `;

      const result = await parser.parseFile('test.cs', content);

      const itemsDep = result.dependencies.find(d =>
        d.to_symbol.includes('List') && d.to_symbol.includes('Add')
      );
      const userMapDep = result.dependencies.find(d =>
        d.to_symbol.includes('Dictionary') && d.to_symbol.includes('Clear')
      );

      expect(itemsDep).toBeDefined();
      expect(userMapDep).toBeDefined();
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

      const fieldBasedDep = result.dependencies.find(d =>
        d.to_symbol.includes('HandManager.SetHandPositions')
      );

      expect(fieldBasedDep).toBeDefined();
      expect(fieldBasedDep?.from_symbol).toBe('CardManager.SetHandPositions');
      expect(fieldBasedDep?.dependency_type).toBe(DependencyType.CALLS);
      expect(fieldBasedDep?.calling_object).toBe('_handManager');
      expect(fieldBasedDep?.resolved_class).toBe('HandManager');
      expect(fieldBasedDep?.qualified_context).toBe('HandManager._handManager->SetHandPositions');
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

      const handManagerDep = result.dependencies.find(d =>
        d.to_symbol.includes('HandManager.SetHandPositions')
      );
      const gameStateDep = result.dependencies.find(d =>
        d.to_symbol.includes('GameState.Reset')
      );

      expect(handManagerDep).toBeDefined();
      expect(handManagerDep?.qualified_context).toBe('HandManager._handManager->SetHandPositions');
      expect(handManagerDep?.calling_object).toBe('_handManager');
      expect(handManagerDep?.resolved_class).toBe('HandManager');

      expect(gameStateDep).toBeDefined();
      expect(gameStateDep?.qualified_context).toBe('GameState.gameState->Reset');
      expect(gameStateDep?.calling_object).toBe('gameState');
      expect(gameStateDep?.resolved_class).toBe('GameState');
    });

    test('should handle the specific reported CardManager -> HandManager issue', async () => {
      const content = `
        public class CardManager {
          private IHandManager _handManager;

          public void SetHandPositions(Vector3 playerHandPosition, Vector3 opponentHandPosition) {
            _handManager?.SetHandPositions(playerHandPosition, opponentHandPosition);
          }
        }
      `;

      const result = await parser.parseFile('CardManager.cs', content);

      const targetDep = result.dependencies.find(d =>
        d.from_symbol === 'CardManager.SetHandPositions' &&
        d.to_symbol.includes('HandManager.SetHandPositions')
      );

      expect(targetDep).toBeDefined();
      expect(targetDep?.dependency_type).toBe(DependencyType.CALLS);
      expect(targetDep?.line_number).toBeGreaterThan(0);
      expect(targetDep?.calling_object).toBe('_handManager');
      expect(targetDep?.resolved_class).toBe('HandManager');
      expect(targetDep?.qualified_context).toBe('HandManager._handManager->SetHandPositions');
      expect(targetDep?.parameter_context).toBe('playerHandPosition, opponentHandPosition');
      expect(targetDep?.parameter_types).toEqual(['Vector3', 'Vector3']);
    });
  });
});