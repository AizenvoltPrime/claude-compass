import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { CSharpParser } from '../../src/parsers/csharp';
import { ParseResult } from '../../src/parsers/base';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('C# Method Call Detection Tests', () => {
  let parser: CSharpParser;
  let tempDir: string;

  beforeEach(async () => {
    parser = new CSharpParser();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'csharp-method-calls-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Conditional Access Expressions', () => {
    test('should detect null-conditional method calls (?.)', async () => {
      const content = `
using System;

namespace Game.Cards {
    public class CardManager {
        private HandManager handManager;

        public void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition) {
            handManager?.SetHandPositions(playerHandPosition, opponentHandPosition);
            handManager?.UpdatePositions();
            handManager?.ValidateLayout();
        }
    }

    public class HandManager {
        public void SetHandPositions(Node3D player, Node3D opponent) { }
        public void UpdatePositions() { }
        public void ValidateLayout() { }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      // Verify all conditional access method calls are detected
      const methodCalls = result.dependencies.filter(d => d.dependency_type === 'calls');

      const setHandPositionsCall = methodCalls.find(d => d.to_symbol === 'SetHandPositions');
      const updatePositionsCall = methodCalls.find(d => d.to_symbol === 'UpdatePositions');
      const validateLayoutCall = methodCalls.find(d => d.to_symbol === 'ValidateLayout');

      expect(setHandPositionsCall).toBeDefined();
      expect(updatePositionsCall).toBeDefined();
      expect(validateLayoutCall).toBeDefined();

      // Verify caller context is correctly identified
      expect(setHandPositionsCall?.from_symbol).toContain('SetHandPositions');
      expect(updatePositionsCall?.from_symbol).toContain('SetHandPositions');
      expect(validateLayoutCall?.from_symbol).toContain('SetHandPositions');

      // Verify high confidence for conditional access calls
      expect(setHandPositionsCall?.confidence).toBeGreaterThan(0.8);
      expect(updatePositionsCall?.confidence).toBeGreaterThan(0.8);
      expect(validateLayoutCall?.confidence).toBeGreaterThan(0.8);
    });

    test('should detect chained conditional access calls', async () => {
      const content = `
namespace Game {
    public class GameController {
        private CardManager cardManager;

        public void InitializeGame() {
            cardManager?.GetHandManager()?.SetHandPositions(null, null);
            cardManager?.GetDeckController()?.ShuffleDeck()?.DealCards();
        }
    }

    public class CardManager {
        public HandManager GetHandManager() => new HandManager();
        public DeckController GetDeckController() => new DeckController();
    }

    public class HandManager {
        public void SetHandPositions(object player, object opponent) { }
    }

    public class DeckController {
        public DeckController ShuffleDeck() => this;
        public void DealCards() { }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d => d.dependency_type === 'calls');

      // Verify chained method calls are detected
      const getHandManagerCall = methodCalls.find(d => d.to_symbol === 'GetHandManager');
      const setHandPositionsCall = methodCalls.find(d => d.to_symbol === 'SetHandPositions');
      const getDeckControllerCall = methodCalls.find(d => d.to_symbol === 'GetDeckController');
      const shuffleDeckCall = methodCalls.find(d => d.to_symbol === 'ShuffleDeck');
      const dealCardsCall = methodCalls.find(d => d.to_symbol === 'DealCards');

      expect(getHandManagerCall).toBeDefined();
      expect(setHandPositionsCall).toBeDefined();
      expect(getDeckControllerCall).toBeDefined();
      expect(shuffleDeckCall).toBeDefined();
      expect(dealCardsCall).toBeDefined();
    });

    test('should detect conditional access on properties', async () => {
      const content = `
namespace Game {
    public class Player {
        public Inventory Inventory { get; set; }

        public void UseItem(string itemName) {
            Inventory?.GetItem(itemName)?.Use();
            Inventory?.RemoveItem(itemName);
        }
    }

    public class Inventory {
        public Item GetItem(string name) => new Item();
        public void RemoveItem(string name) { }
    }

    public class Item {
        public void Use() { }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d => d.dependency_type === 'calls');

      const getItemCall = methodCalls.find(d => d.to_symbol === 'GetItem');
      const useCall = methodCalls.find(d => d.to_symbol === 'Use');
      const removeItemCall = methodCalls.find(d => d.to_symbol === 'RemoveItem');

      expect(getItemCall).toBeDefined();
      expect(useCall).toBeDefined();
      expect(removeItemCall).toBeDefined();
    });
  });

  describe('Regular Method Call Patterns', () => {
    test('should detect all standard method call patterns', async () => {
      const content = `
using System;
using System.Collections.Generic;

namespace Game {
    public class GameLogic {
        private List<Player> players = new List<Player>();

        public void ProcessTurn() {
            // Simple method call
            InitializeRound();

            // Method call on field
            players.Clear();
            players.Add(new Player());

            // Static method call
            Console.WriteLine("Turn processed");

            // Generic method call
            CreateInstance<Player>();

            // Method call on this
            this.UpdateScore(100);

            // Method call with complex expressions
            GetCurrentPlayer().TakeTurn();
            players[0].UpdateStatus();
        }

        private void InitializeRound() { }
        private T CreateInstance<T>() where T : new() => new T();
        private void UpdateScore(int points) { }
        private Player GetCurrentPlayer() => players[0];
    }

    public class Player {
        public void TakeTurn() { }
        public void UpdateStatus() { }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d => d.dependency_type === 'calls');

      // Verify all method call types are detected
      const expectedCalls = [
        'InitializeRound',
        'Clear',
        'Add',
        'WriteLine',
        'UpdateScore',
        'TakeTurn',
        'UpdateStatus',
        'GetCurrentPlayer'
      ];

      for (const expectedCall of expectedCalls) {
        const found = methodCalls.find(d => d.to_symbol === expectedCall);
        expect(found).toBeDefined();
      }

      // Check for generic method call (may include type parameters)
      const createInstanceCall = methodCalls.find(d => d.to_symbol.startsWith('CreateInstance'));
      expect(createInstanceCall).toBeDefined();

      // Verify caller context
      const initializeCall = methodCalls.find(d => d.to_symbol === 'InitializeRound');
      expect(initializeCall?.from_symbol).toContain('ProcessTurn');
    });

    test('should detect method calls in property accessors', async () => {
      const content = `
namespace Game {
    public class ScoreManager {
        private int score;
        private EventLogger logger;

        public int Score {
            get {
                logger?.LogAccess("Score accessed");
                return score;
            }
            set {
                logger?.LogChange("Score changed", score, value);
                ValidateScore(value);
                score = value;
                NotifyScoreChanged();
            }
        }

        private void ValidateScore(int newScore) { }
        private void NotifyScoreChanged() { }
    }

    public class EventLogger {
        public void LogAccess(string message) { }
        public void LogChange(string message, int oldValue, int newValue) { }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d => d.dependency_type === 'calls');

      const logAccessCall = methodCalls.find(d => d.to_symbol === 'LogAccess');
      const logChangeCall = methodCalls.find(d => d.to_symbol === 'LogChange');
      const validateScoreCall = methodCalls.find(d => d.to_symbol === 'ValidateScore');
      const notifyScoreChangedCall = methodCalls.find(d => d.to_symbol === 'NotifyScoreChanged');

      expect(logAccessCall).toBeDefined();
      expect(logChangeCall).toBeDefined();
      expect(validateScoreCall).toBeDefined();
      expect(notifyScoreChangedCall).toBeDefined();

      // Verify property accessor context
      expect(logAccessCall?.from_symbol).toContain('Score');
      expect(logChangeCall?.from_symbol).toContain('Score');
    });

    test('should detect method calls in constructors', async () => {
      const content = `
namespace Game {
    public class Player {
        private Inventory inventory;
        private Stats stats;

        public Player(string name) {
            InitializeDefaults();
            SetupInventory();
            stats = CreateStats(name);
            ValidatePlayerSetup();
        }

        private void InitializeDefaults() { }
        private void SetupInventory() { }
        private Stats CreateStats(string name) => new Stats();
        private void ValidatePlayerSetup() { }
    }

    public class Stats { }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d => d.dependency_type === 'calls');

      const initializeCall = methodCalls.find(d => d.to_symbol === 'InitializeDefaults');
      const setupCall = methodCalls.find(d => d.to_symbol === 'SetupInventory');
      const createStatsCall = methodCalls.find(d => d.to_symbol === 'CreateStats');
      const validateCall = methodCalls.find(d => d.to_symbol === 'ValidatePlayerSetup');

      expect(initializeCall).toBeDefined();
      expect(setupCall).toBeDefined();
      expect(createStatsCall).toBeDefined();
      expect(validateCall).toBeDefined();

      // Verify constructor context
      expect(initializeCall?.from_symbol).toContain('.ctor');
    });
  });

  describe('SetHandPositions Regression Test', () => {
    test('should detect all SetHandPositions method calls from the original issue', async () => {
      const content = `
using Godot;

namespace Game.Cards {
    public class DeckController : Node {
        private CardManager _cardManager;
        private Node3D _handPosition;

        public void InitializeServices() {
            // First call site - line 226 equivalent
            _cardManager.SetHandPositions(_handPosition, null);
        }

        public void SetupPlayerPositions() {
            var playerHandPos = GetNode3D("PlayerHand");

            // Second call site - line 242 equivalent
            _cardManager.SetHandPositions(playerHandPos, _handPosition);
        }
    }

    public class CardManager : Node {
        private HandManager _handManager;

        public void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition) {
            // Internal delegation - line 242 equivalent
            _handManager?.SetHandPositions(playerHandPosition, opponentHandPosition);
        }
    }

    public class HandManager : Node {
        public void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition) {
            // Implementation
        }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d =>
        d.dependency_type === 'calls' && d.to_symbol === 'SetHandPositions'
      );

      // Should find all 3 SetHandPositions calls:
      // 1. DeckController.InitializeServices -> CardManager.SetHandPositions
      // 2. DeckController.SetupPlayerPositions -> CardManager.SetHandPositions
      // 3. CardManager.SetHandPositions -> HandManager.SetHandPositions (conditional access)
      expect(methodCalls.length).toBeGreaterThanOrEqual(3);

      // Verify all caller contexts are correctly identified
      const callers = methodCalls.map(call => call.from_symbol);

      expect(callers.some(caller => caller.includes('InitializeServices'))).toBe(true);
      expect(callers.some(caller => caller.includes('SetupPlayerPositions'))).toBe(true);
      expect(callers.some(caller => caller.includes('CardManager') && caller.includes('SetHandPositions'))).toBe(true);

      // Verify the conditional access call has appropriate confidence
      const conditionalAccessCall = methodCalls.find(call =>
        call.from_symbol.includes('CardManager') && call.from_symbol.includes('SetHandPositions')
      );
      expect(conditionalAccessCall?.confidence).toBeGreaterThan(0.8);
    });
  });

  describe('Edge Cases', () => {
    test('should handle async method calls', async () => {
      const content = `
using System.Threading.Tasks;

namespace Game {
    public class AsyncGameLogic {
        public async Task ProcessGameAsync() {
            await InitializeAsync();
            await LoadDataAsync()?.ContinueWith(t => CompleteLoading());
        }

        private async Task InitializeAsync() { }
        private Task LoadDataAsync() => Task.CompletedTask;
        private void CompleteLoading() { }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d => d.dependency_type === 'calls');

      const initializeCall = methodCalls.find(d => d.to_symbol === 'InitializeAsync');
      const loadDataCall = methodCalls.find(d => d.to_symbol === 'LoadDataAsync');
      const continueWithCall = methodCalls.find(d => d.to_symbol === 'ContinueWith');

      expect(initializeCall).toBeDefined();
      expect(loadDataCall).toBeDefined();
      expect(continueWithCall).toBeDefined();
    });

    test('should handle lambda expressions', async () => {
      const content = `
using System;
using System.Linq;
using System.Collections.Generic;

namespace Game {
    public class PlayerManager {
        private List<Player> players = new List<Player>();

        public void ProcessPlayers() {
            players.Where(p => p.IsActive())
                   .Select(p => p.GetScore())
                   .ForEach(score => UpdateLeaderboard(score));
        }

        private void UpdateLeaderboard(int score) { }
    }

    public class Player {
        public bool IsActive() => true;
        public int GetScore() => 100;
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d => d.dependency_type === 'calls');

      const whereCall = methodCalls.find(d => d.to_symbol === 'Where');
      const selectCall = methodCalls.find(d => d.to_symbol === 'Select');
      const isActiveCall = methodCalls.find(d => d.to_symbol === 'IsActive');
      const getScoreCall = methodCalls.find(d => d.to_symbol === 'GetScore');

      expect(whereCall).toBeDefined();
      expect(selectCall).toBeDefined();
      expect(isActiveCall).toBeDefined();
      expect(getScoreCall).toBeDefined();
    });
  });

  describe('Conditional Block Parsing (REPRODUCTION CASE)', () => {
    test('should detect method calls in both if and else branches - EXACT GODOT REPRODUCTION', async () => {
      const content = `
using Godot;

namespace Game.Cards {
    public class DeckController : Node {
        private CardManager _cardManager;
        private Node3D _handPosition;

        public void SetHandPositions() {
            var playerHandPos = GetNode3D("PlayerHand");

            if (playerHandPos != null) {
                // Line 226 equivalent - should be detected ✅
                _cardManager.SetHandPositions(_handPosition, null);
            } else {
                // Line 242 equivalent - should be detected but ISN'T ❌
                _cardManager.SetHandPositions(playerHandPos, _handPosition);
            }
        }
    }

    public class CardManager : Node {
        public void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition) {
            // Implementation
        }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d =>
        d.dependency_type === 'calls' && d.to_symbol === 'SetHandPositions'
      );

      // This test should FAIL initially - demonstrating the bug
      // We expect 2 SetHandPositions calls but currently only get 1 (if block only)
      console.log('Found SetHandPositions calls:', methodCalls.length);
      console.log('Method calls:', methodCalls.map(call => ({
        from: call.from_symbol,
        to: call.to_symbol,
        line: call.line_number,
        confidence: call.confidence
      })));

      // This assertion should FAIL initially, proving the issue exists
      expect(methodCalls.length).toBe(2); // We expect both if and else calls

      // Verify we have both the if block call and else block call
      const ifBlockCall = methodCalls.find(call => call.line_number === 14); // if block line
      const elseBlockCall = methodCalls.find(call => call.line_number === 17); // else block line

      expect(ifBlockCall).toBeDefined(); // This should pass (if block works)
      expect(elseBlockCall).toBeDefined(); // This should FAIL (else block doesn't work)

      // Verify both calls have the correct caller context
      expect(ifBlockCall?.from_symbol).toContain('SetHandPositions');
      expect(elseBlockCall?.from_symbol).toContain('SetHandPositions');
    });

    test('should detect method calls in if-else-if chains', async () => {
      const content = `
namespace Game {
    public class ConditionalTest {
        private CardManager _cardManager;

        public void TestMethod() {
            int condition = 1;

            if (condition == 1) {
                _cardManager.Method1();
            } else if (condition == 2) {
                _cardManager.Method2();
            } else {
                _cardManager.Method3();
            }
        }
    }

    public class CardManager {
        public void Method1() { }
        public void Method2() { }
        public void Method3() { }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d => d.dependency_type === 'calls');

      const method1Call = methodCalls.find(d => d.to_symbol === 'Method1');
      const method2Call = methodCalls.find(d => d.to_symbol === 'Method2');
      const method3Call = methodCalls.find(d => d.to_symbol === 'Method3');

      // These should all be detected if conditional block parsing works correctly
      expect(method1Call).toBeDefined(); // if block
      expect(method2Call).toBeDefined(); // else if block
      expect(method3Call).toBeDefined(); // else block
    });
  });
});