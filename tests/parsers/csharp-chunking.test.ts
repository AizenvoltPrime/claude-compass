import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { CSharpParser } from '../../src/parsers/csharp';
import { ParseResult } from '../../src/parsers/base';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('C# Chunking Tests', () => {
  let parser: CSharpParser;
  let tempDir: string;

  beforeEach(async () => {
    parser = new CSharpParser();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'csharp-chunk-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Large File Processing', () => {
    test('should handle CardManager.cs-style files (35KB)', async () => {
      const largeFile = generateLargeCSharpFile(35000);
      const testFilePath = path.join(tempDir, 'CardManager.cs');
      await fs.writeFile(testFilePath, largeFile);

      const result = await parser.parseFile(testFilePath, largeFile);

      // Verify critical symbols are found
      expect(result.symbols.find(s => s.name === 'CardManager')).toBeDefined();
      expect(result.symbols.find(s => s.name === 'SetHandPositions')).toBeDefined();
      expect(result.symbols.find(s => s.name === 'InitializeCards')).toBeDefined();

      // Should have minimal errors
      expect(result.errors.length).toBeLessThan(5);
    });

    test('should handle multiple large classes in one file', async () => {
      const content = generateMultiClassFile(40000);
      const testFilePath = path.join(tempDir, 'MultiClass.cs');
      await fs.writeFile(testFilePath, content);

      const result = await parser.parseFile(testFilePath, content);

      // Verify all classes are found
      expect(result.symbols.find(s => s.name === 'GameManager')).toBeDefined();
      expect(result.symbols.find(s => s.name === 'PlayerController')).toBeDefined();
      expect(result.symbols.find(s => s.name === 'EnemyController')).toBeDefined();

      // Check for inheritance relationships
      const inherits = result.dependencies.filter(d => d.dependency_type === 'inherits');
      expect(inherits.length).toBeGreaterThan(0);
    });

    test('should handle files exceeding chunk size (>28KB)', async () => {
      const content = generateLargeCSharpFile(30000); // Just over 28KB threshold
      const testFilePath = path.join(tempDir, 'LargeFile.cs');
      await fs.writeFile(testFilePath, content);

      const result = await parser.parseFile(testFilePath, content);

      // Verify chunking was triggered and handled properly
      expect(result.symbols.length).toBeGreaterThan(10);
      expect(result.errors.length).toBeLessThan(10);
    });
  });

  describe('Boundary Detection', () => {
    test('should not split using statements', async () => {
      const content = `
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Godot;

namespace Game {
    public class TestClass {
        public void Method1() {
            Console.WriteLine("Test");
        }
    }
}`;
      const result = await parser.parseFile('test.cs', content + '\n'.repeat(2000));

      // Check that all using directives are captured
      const namespaceImports = result.imports.filter(i => i.import_type === 'namespace');
      expect(namespaceImports.length).toBeGreaterThanOrEqual(5);
    });

    test('should preserve class inheritance context', async () => {
      const content = generateInheritanceChain(35000);
      const result = await parser.parseFile('inheritance.cs', content);

      // Verify inheritance relationships are preserved
      const baseClass = result.symbols.find(s => s.name === 'BaseEntity');
      const derivedClass = result.symbols.find(s => s.name === 'Player');

      expect(baseClass).toBeDefined();
      expect(derivedClass).toBeDefined();

      // Check direct inheritance dependency (Player inherits from Character)
      const directInheritance = result.dependencies.find(d =>
        d.from_symbol === 'Player' &&
        d.to_symbol === 'Character' &&
        d.dependency_type === 'inherits'
      );
      expect(directInheritance).toBeDefined();

      // Check transitive inheritance (Character inherits from BaseEntity)
      const transitiveInheritance = result.dependencies.find(d =>
        d.from_symbol === 'Character' &&
        d.to_symbol === 'BaseEntity' &&
        d.dependency_type === 'inherits'
      );
      expect(transitiveInheritance).toBeDefined();
    });

    test('should handle partial classes correctly', async () => {
      const content = `
namespace Game {
    public partial class GameManager {
        private int score;

        public void UpdateScore(int points) {
            score += points;
        }
    }

    ${generatePadding(30000)}

    public partial class GameManager {
        private string playerName;

        public void SetPlayerName(string name) {
            playerName = name;
        }
    }
}`;
      const result = await parser.parseFile('partial.cs', content);

      const gameManagerSymbols = result.symbols.filter(s => s.name === 'GameManager');
      expect(gameManagerSymbols.length).toBe(1);

      expect(gameManagerSymbols[0].qualified_name).toBe('Game.GameManager');

      expect(gameManagerSymbols[0].start_line).toBeLessThanOrEqual(122);
      expect(gameManagerSymbols[0].end_line).toBeGreaterThanOrEqual(138);

      expect(result.symbols.find(s => s.name === 'UpdateScore')).toBeDefined();
      expect(result.symbols.find(s => s.name === 'SetPlayerName')).toBeDefined();
    });

    test('should not split method bodies', async () => {
      const content = generateMethodWithLongBody(30000);
      const result = await parser.parseFile('method.cs', content);

      // Verify method is properly captured
      const longMethod = result.symbols.find(s => s.name === 'ProcessGameLogic');
      expect(longMethod).toBeDefined();

      // Should not have syntax errors from split methods
      const syntaxErrors = result.errors.filter(e => e.message.includes('syntax'));
      expect(syntaxErrors.length).toBe(0);
    });
  });

  describe('Context Preservation', () => {
    test('should preserve using directives across chunks', async () => {
      const content = generateFileWithManyUsings(35000);
      const result = await parser.parseFile('usings.cs', content);

      // Verify using directives are available
      const systemImports = result.imports.filter(i => i.source.startsWith('System'));
      expect(systemImports.length).toBeGreaterThan(0);
    });

    test('should maintain namespace context', async () => {
      const content = generateNestedNamespaces(35000);
      const result = await parser.parseFile('namespaces.cs', content);

      // Check that classes in different namespaces are properly identified
      // The generateNestedNamespaces function creates CoreSystem, UIManager, etc.
      const coreSystemClass = result.symbols.find(s =>
        s.symbol_type === 'class' && s.name === 'CoreSystem'
      );
      const uiManagerClass = result.symbols.find(s =>
        s.symbol_type === 'class' && s.name === 'UIManager'
      );

      expect(coreSystemClass).toBeDefined();
      expect(uiManagerClass).toBeDefined();

      // Verify that classes from different namespaces are both found
      const classCount = result.symbols.filter(s => s.symbol_type === 'class').length;
      expect(classCount).toBeGreaterThan(1);
    });

    test('should preserve interface implementations', async () => {
      const content = generateInterfaceImplementations(35000);
      const result = await parser.parseFile('interfaces.cs', content);

      // Verify interface and implementations are found
      const iPlayerInterface = result.symbols.find(s =>
        s.name === 'IPlayer' && s.symbol_type === 'interface'
      );
      expect(iPlayerInterface).toBeDefined();

      const playerClass = result.symbols.find(s =>
        s.name === 'Player' && s.symbol_type === 'class'
      );
      expect(playerClass).toBeDefined();

      // Check implementation dependency
      const implementsDep = result.dependencies.find(d =>
        d.from_symbol === 'Player' &&
        d.to_symbol === 'IPlayer' &&
        d.dependency_type === 'implements'
      );
      expect(implementsDep).toBeDefined();
    });
  });

  describe('Syntax-Aware Chunking', () => {
    test('should handle nested classes and structures', async () => {
      const content = generateNestedStructures(35000);
      const result = await parser.parseFile('nested.cs', content);

      // Verify nested classes are found
      expect(result.symbols.find(s => s.name === 'OuterClass')).toBeDefined();
      expect(result.symbols.find(s => s.name === 'InnerClass')).toBeDefined();
      expect(result.symbols.find(s => s.name === 'NestedStruct')).toBeDefined();
    });

    test('should handle generic types correctly', async () => {
      const content = generateGenericClasses(30000);
      const result = await parser.parseFile('generics.cs', content);

      // Verify generic classes are properly parsed
      const genericClass = result.symbols.find(s => s.name === 'Repository');
      expect(genericClass).toBeDefined();
      expect(genericClass?.signature).toContain('<T>');
    });

    test('should handle async/await patterns', async () => {
      const content = generateAsyncMethods(30000);
      const result = await parser.parseFile('async.cs', content);

      // Verify async methods are found
      const asyncMethod = result.symbols.find(s => s.name === 'LoadDataAsync');
      expect(asyncMethod).toBeDefined();
      expect(asyncMethod?.signature).toContain('async');
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed chunks gracefully', async () => {
      const content = generateMalformedCode(30000);
      const result = await parser.parseFile('malformed.cs', content);

      // Should still extract valid symbols
      expect(result.symbols.length).toBeGreaterThan(0);

      // Errors should be reported but not crash
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toBeDefined();
    });

    test('should recover from chunk boundary errors', async () => {
      const content = generateCodeWithComplexNesting(35000);
      const result = await parser.parseFile('complex.cs', content);

      // Should still process the file
      expect(result.symbols.length).toBeGreaterThan(0);

      // Main structures should be found
      expect(result.symbols.find(s => s.name === 'MainClass')).toBeDefined();
    });
  });

  describe('Performance', () => {
    test('should complete within reasonable time for 50KB file', async () => {
      const content = generateLargeCSharpFile(50000);
      const startTime = Date.now();

      const result = await parser.parseFile('large.cs', content);

      const endTime = Date.now();
      const elapsedTime = endTime - startTime;

      // Should complete within 10 seconds (improved from 17.4s baseline)
      expect(elapsedTime).toBeLessThan(10000);

      // Should still extract symbols
      expect(result.symbols.length).toBeGreaterThan(0);
    });
  });
});

// Helper functions to generate test content

function generateLargeCSharpFile(targetSize: number): string {
  let content = `using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Godot;

namespace Game.Cards {
    public partial class CardManager : Node {
        private List<Card> deck = new List<Card>();
        private HandManager handManager;
        private DeckController deckController;

        public void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition) {
            if (handManager != null) {
                handManager.SetHandPositions(playerHandPosition, opponentHandPosition);
            }
        }

        public void InitializeCards() {
            for (int i = 0; i < 52; i++) {
                var card = new Card {
                    Id = i,
                    Name = $"Card_{i}",
                    Value = i % 13 + 1,
                    Suit = (CardSuit)(i / 13)
                };
                deck.Add(card);
            }
        }
`;

  // Add methods until we reach target size
  let methodIndex = 0;
  while (content.length < targetSize) {
    content += `
        public void Method${methodIndex}() {
            // Complex game logic here
            var result = CalculateScore(${methodIndex});
            for (int i = 0; i < 100; i++) {
                ProcessCard(deck[i % deck.Count]);
                UpdateGameState();
                CheckWinCondition();
            }
            Console.WriteLine($"Method ${methodIndex} completed with result: {result}");
        }

        private int CalculateScore(int seed) {
            return seed * 42 + deck.Count;
        }
`;
    methodIndex++;
  }

  content += `
    }

    public enum CardSuit {
        Hearts,
        Diamonds,
        Clubs,
        Spades
    }

    public class Card {
        public int Id { get; set; }
        public string Name { get; set; }
        public int Value { get; set; }
        public CardSuit Suit { get; set; }
    }
}`;

  return content;
}

function generateMultiClassFile(targetSize: number): string {
  let content = `using System;
using System.Collections.Generic;
using UnityEngine;

namespace Game {
    public abstract class BaseEntity {
        public int Id { get; set; }
        public string Name { get; set; }
        public abstract void Update(float deltaTime);
    }

    public class GameManager : MonoBehaviour {
        private static GameManager instance;
        public static GameManager Instance => instance;

        void Awake() {
            instance = this;
        }
`;

  // Add content to GameManager
  for (let i = 0; i < 20; i++) {
    content += `
        public void GameMethod${i}() {
            Debug.Log("Executing game method ${i}");
        }
`;
  }

  content += `
    }

    public class PlayerController : BaseEntity {
        private float health = 100f;
        private Vector3 position;

        public override void Update(float deltaTime) {
            // Player update logic
            position += Vector3.forward * deltaTime;
        }
`;

  // Add content to PlayerController
  for (let i = 0; i < 20; i++) {
    content += `
        public void PlayerAction${i}() {
            health -= ${i} * 0.1f;
            Console.WriteLine($"Player action ${i} executed");
        }
`;
  }

  content += `
    }

    public class EnemyController : BaseEntity {
        private float attackPower = 10f;

        public override void Update(float deltaTime) {
            // Enemy AI logic
            AttackPlayer(deltaTime);
        }

        private void AttackPlayer(float deltaTime) {
            // Attack implementation
        }
`;

  // Add padding to reach target size
  while (content.length < targetSize) {
    content += `
        // Additional game logic and comments to increase file size
        // This simulates a large, complex game file with multiple classes
        private void ProcessAI() { /* AI Logic */ }
`;
  }

  content += `
    }
}`;

  return content;
}

function generateInheritanceChain(targetSize: number): string {
  let content = `using System;

namespace Game {
    public interface IEntity {
        int Id { get; }
        void Update(float deltaTime);
    }

    public interface IDamageable {
        float Health { get; set; }
        void TakeDamage(float amount);
    }

    public abstract class BaseEntity : IEntity {
        public int Id { get; private set; }

        protected BaseEntity(int id) {
            Id = id;
        }

        public abstract void Update(float deltaTime);
    }

    public class Character : BaseEntity, IDamageable {
        public float Health { get; set; }

        public Character(int id) : base(id) {
            Health = 100f;
        }

        public override void Update(float deltaTime) {
            // Character update
        }

        public void TakeDamage(float amount) {
            Health -= amount;
        }
    }

    public class Player : Character {
        public string PlayerName { get; set; }

        public Player(int id, string name) : base(id) {
            PlayerName = name;
        }
`;

  // Add methods to reach target size
  while (content.length < targetSize) {
    content += `
        public void PlayerMethod() {
            // Player-specific logic
            Console.WriteLine("Player action");
        }
`;
  }

  content += `
    }
}`;

  return content;
}

function generatePadding(size: number): string {
  let padding = '';
  while (padding.length < size) {
    padding += `
    // Padding comment to increase file size
    // This simulates a large file with multiple sections
    public class PaddingClass${padding.length} {
        public void Method() { }
    }
`;
  }
  return padding;
}

function generateMethodWithLongBody(targetSize: number): string {
  let content = `using System;

namespace Game {
    public class GameLogic {
        public void ProcessGameLogic() {
`;

  // Generate a very long method body
  for (let i = 0; content.length < targetSize - 500; i++) {
    content += `
            // Step ${i} of game logic
            var value${i} = CalculateValue(${i});
            if (value${i} > 100) {
                Console.WriteLine($"High value: {value${i}}");
                ProcessHighValue(value${i});
            } else {
                Console.WriteLine($"Low value: {value${i}}");
                ProcessLowValue(value${i});
            }
`;
  }

  content += `
        }

        private int CalculateValue(int input) => input * 42;
        private void ProcessHighValue(int value) { }
        private void ProcessLowValue(int value) { }
    }
}`;

  return content;
}

function generateFileWithManyUsings(targetSize: number): string {
  let content = `using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Reflection;
using System.Runtime.CompilerServices;
using UnityEngine;
using UnityEngine.UI;
using Godot;

namespace Game {
    public class ComplexClass {
`;

  while (content.length < targetSize) {
    content += `
        public async Task<string> AsyncMethod() {
            using (var client = new HttpClient()) {
                return await client.GetStringAsync("http://example.com");
            }
        }
`;
  }

  content += `
    }
}`;

  return content;
}

function generateNestedNamespaces(targetSize: number): string {
  let content = `using System;

namespace Game {
    namespace Core {
        public class CoreSystem {
            public void Initialize() { }
        }
    }

    namespace UI {
        public class UIManager {
            public void ShowMenu() { }
        }
    }

    namespace Physics {
        public class PhysicsEngine {
            public void Simulate(float deltaTime) { }
        }
`;

  while (content.length < targetSize) {
    content += `
            public void PhysicsMethod() {
                // Physics calculations
            }
`;
  }

  content += `
        }
    }
}`;

  return content;
}

function generateInterfaceImplementations(targetSize: number): string {
  let content = `using System;

namespace Game {
    public interface IPlayer {
        string Name { get; set; }
        void Move(float x, float y);
        void Attack();
    }

    public interface IPowerUp {
        void Apply(IPlayer player);
    }

    public class Player : IPlayer {
        public string Name { get; set; }

        public void Move(float x, float y) {
            // Movement implementation
        }

        public void Attack() {
            // Attack implementation
        }
`;

  while (content.length < targetSize) {
    content += `
        public void AdditionalMethod() {
            // Additional player logic
        }
`;
  }

  content += `
    }

    public class SpeedBoost : IPowerUp {
        public void Apply(IPlayer player) {
            // Speed boost implementation
        }
    }
}`;

  return content;
}

function generateNestedStructures(targetSize: number): string {
  let content = `using System;

namespace Game {
    public class OuterClass {
        public class InnerClass {
            public struct NestedStruct {
                public int Value;
                public string Name;
            }

            public void InnerMethod() {
                var nested = new NestedStruct { Value = 42, Name = "Test" };
            }
        }

        private InnerClass inner = new InnerClass();
`;

  while (content.length < targetSize) {
    content += `
        public void OuterMethod() {
            inner.InnerMethod();
        }
`;
  }

  content += `
    }
}`;

  return content;
}

function generateGenericClasses(targetSize: number): string {
  let content = `using System;
using System.Collections.Generic;

namespace Game {
    public class Repository<T> where T : class, new() {
        private List<T> items = new List<T>();

        public void Add(T item) {
            items.Add(item);
        }

        public T Get(int index) {
            return items[index];
        }

        public IEnumerable<T> GetAll() {
            return items;
        }
`;

  while (content.length < targetSize) {
    content += `
        public void Process<U>(U value) where U : struct {
            Console.WriteLine($"Processing: {value}");
        }
`;
  }

  content += `
    }

    public class DataStore<TKey, TValue> : Repository<TValue> where TValue : class, new() {
        private Dictionary<TKey, TValue> store = new Dictionary<TKey, TValue>();
    }
}`;

  return content;
}

function generateAsyncMethods(targetSize: number): string {
  let content = `using System;
using System.Threading.Tasks;

namespace Game {
    public class AsyncService {
        public async Task<string> LoadDataAsync() {
            await Task.Delay(100);
            return "Data loaded";
        }

        public async Task ProcessAsync() {
            var data = await LoadDataAsync();
            await Task.Run(() => {
                Console.WriteLine($"Processing: {data}");
            });
        }
`;

  while (content.length < targetSize) {
    content += `
        public async ValueTask<int> CalculateAsync(int value) {
            await Task.Yield();
            return value * 42;
        }
`;
  }

  content += `
    }
}`;

  return content;
}

function generateMalformedCode(targetSize: number): string {
  let content = `using System;

namespace Game {
    public class ValidClass {
        public void ValidMethod() {
            Console.WriteLine("Valid code");
        }
    }

    // Intentionally malformed section
    public class BrokenClass {
        public void Method1() {
            // Missing closing brace intentionally
            if (true) {
                Console.WriteLine("Test");
            // Missing }
        }
`;

  // Add some valid code after the malformed section
  content += `
    public class AnotherValidClass {
        public void AnotherMethod() {
            Console.WriteLine("More valid code");
        }
    }
`;

  while (content.length < targetSize) {
    content += `
        // Padding
        public void Padding() { }
`;
  }

  content += `
}`;

  return content;
}

function generateCodeWithComplexNesting(targetSize: number): string {
  let content = `using System;

namespace Game {
    public class MainClass {
        public void ComplexMethod() {
            for (int i = 0; i < 10; i++) {
                if (i % 2 == 0) {
                    try {
                        using (var resource = new Resource()) {
                            while (resource.HasMore()) {
                                switch (resource.GetType()) {
                                    case ResourceType.A:
                                        {
                                            var lambda = (int x) => {
                                                return x * 2;
                                            };
                                            ProcessA(lambda(i));
                                        }
                                        break;
                                    case ResourceType.B:
                                        ProcessB(i);
                                        break;
                                }
                            }
                        }
                    } catch (Exception ex) {
                        Console.WriteLine(ex.Message);
                    } finally {
                        Cleanup();
                    }
                }
            }
        }
`;

  while (content.length < targetSize) {
    content += `
        private void ProcessA(int value) { }
        private void ProcessB(int value) { }
        private void Cleanup() { }
`;
  }

  content += `
    }

    public class Resource : IDisposable {
        public bool HasMore() => false;
        public ResourceType GetType() => ResourceType.A;
        public void Dispose() { }
    }

    public enum ResourceType {
        A, B
    }
}`;

  return content;
}