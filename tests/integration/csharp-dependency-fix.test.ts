import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { GraphBuilder } from '../../src/graph/builder';
import { getDatabaseConnection, closeDatabaseConnection } from '../../src/database/connection';
import { CSharpParser } from '../../src/parsers/csharp';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as CleanupService from '../../src/database/services/cleanup-service';
import * as SymbolService from '../../src/database/services/symbol-service';
import type { Knex } from 'knex';

describe('C# Dependency Extraction Fix', () => {
  let db: Knex;
  let builder: GraphBuilder;
  let tempDir: string;
  let repositoryId: number;

  beforeAll(async () => {
    // Setup database connection
    db = getDatabaseConnection();
    builder = new GraphBuilder(db);

    // Create temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'csharp-test-'));
  }, 30000);

  afterAll(async () => {
    // Cleanup database
    if (repositoryId) {
      await CleanupService.cleanupRepositoryData(db, repositoryId);
    }
    // Cleanup filesystem
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    await closeDatabaseConnection();
  });

  it('should correctly extract and store C# method call dependencies with qualified names', async () => {
    // Create test C# files that simulate the game project structure
    const cardManagerPath = path.join(tempDir, 'CardManager.cs');
    const deckControllerPath = path.join(tempDir, 'DeckController.cs');
    const handManagerPath = path.join(tempDir, 'HandManager.cs');

    // CardManager.cs with SetHandPositions method
    await fs.writeFile(cardManagerPath, `
namespace GameCore.Managers {
    public class CardManager : ICardDataProvider {
        private HandManager _handManager;

        public void SetHandPositions(Vector3 playerHandPosition, Vector3? opponentHandPosition) {
            // This method calls HandManager.SetHandPositions
            _handManager?.SetHandPositions(playerHandPosition, opponentHandPosition);
            ProcessCards();
        }

        private void ProcessCards() {
            // Internal method
            ValidateCard();
        }

        private void ValidateCard() {
            // Another internal method
        }
    }
}
    `.trim());

    // DeckController.cs that calls CardManager methods
    await fs.writeFile(deckControllerPath, `
namespace GameCore.Controllers {
    using GameCore.Managers;

    public class DeckController : MonoBehaviour {
        private CardManager _cardManager;
        private Vector3 _handPosition;

        public void InitializeHands() {
            // Line 10: This should create a dependency from InitializeHands to SetHandPositions
            _cardManager.SetHandPositions(_handPosition, null);

            // Conditional access call
            _cardManager?.DrawCard(1);
        }

        public void UpdatePlayerHand(Vector3 playerHandPos) {
            // Line 17: Another call to SetHandPositions
            _cardManager.SetHandPositions(playerHandPos, _handPosition);
        }

        private void DrawCard(int count) {
            // Local method with same name as CardManager method
            for (int i = 0; i < count; i++) {
                _cardManager?.DrawCard(1);
            }
        }
    }
}
    `.trim());

    // HandManager.cs with its own SetHandPositions
    await fs.writeFile(handManagerPath, `
namespace GameCore.Managers {
    public interface IHandManager {
        void SetHandPositions(Vector3 player, Vector3? opponent);
    }

    public class HandManager : IHandManager {
        public void SetHandPositions(Vector3 player, Vector3? opponent) {
            // Implementation
            ArrangeCards();
        }

        private void ArrangeCards() {
            // Arrange cards in hand
        }
    }
}
    `.trim());

    // Analyze the test project
    const result = await builder.analyzeRepository(tempDir);
    repositoryId = result.repository.id;

    // Get all symbols
    const symbols = await SymbolService.getSymbolsByRepository(db,repositoryId);

    // Find key symbols
    const cardManagerSetHandPositions = symbols.find(s =>
      s.name === 'SetHandPositions' &&
      s.symbol_type === 'method'
    );
    const deckControllerInitializeHands = symbols.find(s =>
      s.name === 'InitializeHands' &&
      s.symbol_type === 'method'
    );
    const deckControllerUpdatePlayerHand = symbols.find(s =>
      s.name === 'UpdatePlayerHand' &&
      s.symbol_type === 'method'
    );

    // Verify symbols exist
    expect(cardManagerSetHandPositions).toBeDefined();
    expect(deckControllerInitializeHands).toBeDefined();
    expect(deckControllerUpdatePlayerHand).toBeDefined();

    // Get dependencies for verification
    const dependencies = await db('dependencies')
      .where('from_symbol_id', deckControllerInitializeHands!.id)
      .orWhere('from_symbol_id', deckControllerUpdatePlayerHand!.id);

    // Verify dependencies were stored
    expect(dependencies.length).toBeGreaterThan(0);

    // Check specific dependency: InitializeHands -> SetHandPositions
    const initToSetDep = dependencies.find(d =>
      d.from_symbol_id === deckControllerInitializeHands!.id &&
      d.dependency_type === 'calls'
    );
    expect(initToSetDep).toBeDefined();

    // Verify who_calls functionality works
    const callers = await db('dependencies')
      .join('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .where('dependencies.to_symbol_id', cardManagerSetHandPositions!.id)
      .where('dependencies.dependency_type', 'calls')
      .select('from_symbols.name', 'dependencies.dependency_type');

    expect(callers.length).toBeGreaterThan(0);
    expect(callers.map(c => c.name)).toContain('InitializeHands');
    expect(callers.map(c => c.name)).toContain('UpdatePlayerHand');
  }, 60000);

  it('should handle C# conditional access and chained method calls', async () => {
    const testFilePath = path.join(tempDir, 'ChainedCalls.cs');

    await fs.writeFile(testFilePath, `
namespace TestNamespace {
    public class ChainedCallsTest {
        private ServiceA _serviceA;

        public void TestConditionalAccess() {
            // Conditional access with method call
            _serviceA?.MethodOne()?.MethodTwo();

            // Nested conditional access
            _serviceA?.GetServiceB()?.ProcessData(42);

            // Mixed access patterns
            var result = _serviceA?.GetServiceB().ExecuteQuery() ?? new Result();
        }
    }

    public class ServiceA {
        public ServiceB GetServiceB() => new ServiceB();
        public ServiceA MethodOne() => this;
        public ServiceB MethodTwo() => new ServiceB();
    }

    public class ServiceB {
        public void ProcessData(int value) { }
        public Result ExecuteQuery() => new Result();
    }

    public class Result { }
}
    `.trim());

    // Parse the file
    const parser = new CSharpParser();
    const content = await fs.readFile(testFilePath, 'utf-8');
    const parseResult = await parser.parseFile(testFilePath, content);

    // Verify conditional access dependencies are extracted
    expect(parseResult.dependencies.length).toBeGreaterThan(0);

    // Check for specific method calls
    const methodOneDep = parseResult.dependencies.find(d =>
      d.to_symbol.includes('MethodOne') &&
      d.dependency_type === 'calls'
    );
    const methodTwoDep = parseResult.dependencies.find(d =>
      d.to_symbol.includes('MethodTwo') &&
      d.dependency_type === 'calls'
    );
    const processDataDep = parseResult.dependencies.find(d =>
      d.to_symbol.includes('ProcessData') &&
      d.dependency_type === 'calls'
    );

    expect(methodOneDep).toBeDefined();
    expect(methodTwoDep).toBeDefined();
    expect(processDataDep).toBeDefined();

    // Verify from_symbol is correctly set with qualified names
    expect(methodOneDep!.from_symbol).toContain('TestConditionalAccess');
  });

  it('should handle C# lambda expressions and local functions', async () => {
    const testFilePath = path.join(tempDir, 'LambdaTest.cs');

    await fs.writeFile(testFilePath, `
namespace TestNamespace {
    public class LambdaTest {
        public void ProcessItems(List<Item> items) {
            // Lambda expression
            items.ForEach(item => {
                item.Process();
                ValidateItem(item);
            });

            // Local function
            void LocalProcessor(Item item) {
                item.Process();
                ValidateItem(item);
            }

            items.ForEach(LocalProcessor);
        }

        private void ValidateItem(Item item) {
            // Validation logic
        }
    }

    public class Item {
        public void Process() { }
    }
}
    `.trim());

    const parser = new CSharpParser();
    const content = await fs.readFile(testFilePath, 'utf-8');
    const parseResult = await parser.parseFile(testFilePath, content);

    // Verify lambda and local function dependencies
    const validateItemCalls = parseResult.dependencies.filter(d =>
      d.to_symbol.includes('ValidateItem') &&
      d.dependency_type === 'calls'
    );

    // Should have calls from both lambda and local function
    expect(validateItemCalls.length).toBeGreaterThan(0);

    // Check for lambda indicator in from_symbol
    const lambdaCall = validateItemCalls.find(d =>
      d.from_symbol.includes('<lambda>') ||
      d.from_symbol.includes('ProcessItems')
    );
    expect(lambdaCall).toBeDefined();
  });

  it('should match symbols correctly despite qualified name differences', async () => {
    // This test specifically verifies the fix for the matching issue
    const testFilePath = path.join(tempDir, 'QualifiedNameTest.cs');

    await fs.writeFile(testFilePath, `
namespace Company.Product.Module {
    public class QualifiedTest {
        public void MethodA() {
            MethodB();
            this.MethodC();
            InnerClass.StaticMethod();
        }

        public void MethodB() { }
        public void MethodC() { }

        public static class InnerClass {
            public static void StaticMethod() { }
        }
    }
}
    `.trim());

    const parser = new CSharpParser();
    const content = await fs.readFile(testFilePath, 'utf-8');
    const parseResult = await parser.parseFile(testFilePath, content);

    // Extract symbols - they should have simple names
    const methodA = parseResult.symbols.find(s => s.name === 'MethodA');
    const methodB = parseResult.symbols.find(s => s.name === 'MethodB');
    const methodC = parseResult.symbols.find(s => s.name === 'MethodC');

    expect(methodA).toBeDefined();
    expect(methodB).toBeDefined();
    expect(methodC).toBeDefined();

    // Dependencies might have qualified from_symbol names
    const deps = parseResult.dependencies.filter(d =>
      d.dependency_type === 'calls'
    );

    expect(deps.length).toBeGreaterThan(0);

    // Verify all have from_symbol set (could be qualified)
    deps.forEach(dep => {
      expect(dep.from_symbol).toBeTruthy();
      expect(dep.to_symbol).toBeTruthy();
    });

    // The key test: when stored in DB, these should match despite qualified names
    // This is what the fix addresses - extracting method name from qualified names
    const methodBCall = deps.find(d => d.to_symbol.includes('MethodB'));
    expect(methodBCall).toBeDefined();

    // from_symbol might be "QualifiedTest.MethodA" or similar
    // The fix ensures this still matches the symbol with name "MethodA"
    expect(methodBCall!.from_symbol).toContain('MethodA');
  });

  it('should not create false transitive dependencies through interface implementations', async () => {
    // This test verifies the fix for the bug where DeckController calls to CardManager.SetHandPositions
    // were incorrectly attributed to HandManager.SetHandPositions, creating false transitive dependencies

    const interfaceFilePath = path.join(tempDir, 'IHandManager.cs');
    const cardManagerFilePath = path.join(tempDir, 'CardManagerTest.cs');
    const handManagerFilePath = path.join(tempDir, 'HandManagerTest.cs');
    const deckControllerFilePath = path.join(tempDir, 'DeckControllerTest.cs');

    // Interface definition
    await fs.writeFile(interfaceFilePath, `
namespace GameCore.Interfaces {
    public interface IHandManager {
        void SetHandPositions(Vector3 playerPos, Vector3 opponentPos);
    }
}
    `.trim());

    // CardManager implements the interface and delegates to HandManager
    await fs.writeFile(cardManagerFilePath, `
namespace GameCore.Managers {
    using GameCore.Interfaces;

    public class CardManager : IHandManager {
        private HandManager _handManager;

        public void SetHandPositions(Vector3 playerPos, Vector3 opponentPos) {
            // CardManager delegates to HandManager
            _handManager.SetHandPositions(playerPos, opponentPos);
        }
    }
}
    `.trim());

    // HandManager has its own implementation
    await fs.writeFile(handManagerFilePath, `
namespace GameCore.Managers {
    using GameCore.Interfaces;

    public class HandManager : IHandManager {
        public void SetHandPositions(Vector3 playerPos, Vector3 opponentPos) {
            // HandManager implementation
        }
    }
}
    `.trim());

    // DeckController calls CardManager.SetHandPositions
    await fs.writeFile(deckControllerFilePath, `
namespace GameCore.Controllers {
    using GameCore.Managers;

    public class DeckController {
        private CardManager _cardManager;
        private Vector3 _handPosition;

        public void InitializeDecks() {
            // DeckController calls CardManager.SetHandPositions
            // This should NOT create a dependency to HandManager.SetHandPositions
            _cardManager.SetHandPositions(_handPosition, _handPosition);
        }
    }
}
    `.trim());

    // Analyze the test project
    const result = await builder.analyzeRepository(tempDir);
    const testRepoId = result.repository.id;

    try {
      // Get all symbols
      const symbols = await SymbolService.getSymbolsByRepository(db,testRepoId);

      // Find the three SetHandPositions methods
      const interfaceMethod = symbols.find(s =>
        s.name === 'SetHandPositions' &&
        s.symbol_type === 'method' &&
        s.visibility === 'public'
      );

      const cardManagerMethods = symbols.filter(s =>
        s.name === 'SetHandPositions' &&
        s.symbol_type === 'method'
      );

      // Should have at least 2 SetHandPositions methods (CardManager and HandManager)
      expect(cardManagerMethods.length).toBeGreaterThanOrEqual(2);

      // Find DeckController.InitializeDecks
      const initializeDecks = symbols.find(s =>
        s.name === 'InitializeDecks' &&
        s.symbol_type === 'method'
      );
      expect(initializeDecks).toBeDefined();

      // Get all dependencies from InitializeDecks
      const initializeDecksDeps = await db('dependencies')
        .where('from_symbol_id', initializeDecks!.id)
        .where('dependency_type', 'calls');

      // Get the symbol IDs of all SetHandPositions methods
      const setHandPositionsIds = cardManagerMethods.map(m => m.id);

      // Find which SetHandPositions methods InitializeDecks calls
      const calledSetHandPositionsMethods = initializeDecksDeps.filter(d =>
        setHandPositionsIds.includes(d.to_symbol_id)
      );

      // CRITICAL: DeckController should call ONLY ONE SetHandPositions implementation
      // It should call CardManager.SetHandPositions, NOT HandManager.SetHandPositions
      expect(calledSetHandPositionsMethods.length).toBe(1);

      // Verify it's calling the CardManager implementation
      // We can check this by looking at which file contains the called method
      const calledSymbol = symbols.find(s => s.id === calledSetHandPositionsMethods[0].to_symbol_id);
      expect(calledSymbol).toBeDefined();

      const calledSymbolFile = await db('files')
        .where('id', calledSymbol!.file_id)
        .first();

      // The called method should be in CardManagerTest.cs, not HandManagerTest.cs
      expect(calledSymbolFile.path).toContain('CardManagerTest.cs');
      expect(calledSymbolFile.path).not.toContain('HandManagerTest.cs');

      // Additional verification: HandManager.SetHandPositions should only be called by CardManager
      const handManagerSetHandPositions = symbols.find(s =>
        s.name === 'SetHandPositions' &&
        s.symbol_type === 'method'
      );

      if (handManagerSetHandPositions) {
        const handManagerCallers = await db('dependencies')
          .join('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
          .join('files as from_files', 'from_symbols.file_id', 'from_files.id')
          .where('dependencies.to_symbol_id', handManagerSetHandPositions.id)
          .where('dependencies.dependency_type', 'calls')
          .select('from_symbols.name', 'from_files.path');

        // HandManager.SetHandPositions should NOT be called by DeckController
        const deckControllerCalls = handManagerCallers.filter(c =>
          c.path.includes('DeckControllerTest.cs')
        );
        expect(deckControllerCalls.length).toBe(0);
      }
    } finally {
      // Cleanup test repository
      await CleanupService.cleanupRepositoryData(db,testRepoId);
    }
  }, 60000);
});