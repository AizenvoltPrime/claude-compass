import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { CSharpParser } from '../../src/parsers/csharp';
import { ParseResult } from '../../src/parsers/base';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('C# Parameter Context Enhancement Tests', () => {
  let parser: CSharpParser;
  let tempDir: string;

  beforeEach(async () => {
    parser = new CSharpParser();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'csharp-parameter-context-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Parameter Context Extraction', () => {
    test('should capture parameter expressions from method calls', async () => {
      const content = `
using System;

namespace Game.Cards {
    public class DeckController {
        private CardManager _cardManager;
        private Node3D _handPosition;

        public void _Ready() {
            InitializeServices();
        }

        private void InitializeServices() {
            // Two different calls to same method with different parameters
            _cardManager.SetHandPositions(_handPosition, null);

            var playerHandPos = GetPlayerHandPosition();
            _cardManager.SetHandPositions(playerHandPos, _handPosition);
        }

        private Node3D GetPlayerHandPosition() {
            return new Node3D();
        }
    }

    public class CardManager {
        public void SetHandPositions(Node3D playerPos, Node3D opponentPos) {
            // Implementation
        }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      // Find SetHandPositions method calls
      const setHandPositionsCalls = result.dependencies.filter(d =>
        d.dependency_type === 'calls' && d.to_symbol.includes('SetHandPositions')
      );

      expect(setHandPositionsCalls).toHaveLength(2);

      // Verify first call has parameter context
      const firstCall = setHandPositionsCalls[0];
      expect(firstCall.parameter_context).toBe('_handPosition, null');
      expect(firstCall.call_instance_id).toBeDefined();
      expect(firstCall.call_instance_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Verify second call has different parameter context
      const secondCall = setHandPositionsCalls[1];
      expect(secondCall.parameter_context).toBe('playerHandPos, _handPosition');
      expect(secondCall.call_instance_id).toBeDefined();
      expect(secondCall.call_instance_id).not.toBe(firstCall.call_instance_id);

      // Verify parameter types are inferred when possible
      expect(firstCall.parameter_types).toEqual(['var', 'null']);
      expect(secondCall.parameter_types).toEqual(['var', 'var']);
    });

    test('should handle method calls with various parameter types', async () => {
      const content = `
using System;

namespace Test {
    public class TestClass {
        public void TestMethod() {
            // Various parameter types
            SomeMethod(42, "hello", true, null);
            SomeMethod(3.14f, "world", false, new Object());
        }

        public void SomeMethod(int num, string text, bool flag, object obj) {
            // Implementation
        }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d =>
        d.dependency_type === 'calls' && d.to_symbol.includes('SomeMethod')
      );

      expect(methodCalls).toHaveLength(2);

      // First call
      expect(methodCalls[0].parameter_context).toBe('42, "hello", true, null');
      expect(methodCalls[0].parameter_types).toEqual(['int', 'string', 'bool', 'null']);

      // Second call
      expect(methodCalls[1].parameter_context).toBe('3.14f, "world", false, new Object()');
      expect(methodCalls[1].parameter_types).toEqual(['float', 'string', 'bool', 'Object']);
    });

    test('should handle no-parameter method calls gracefully', async () => {
      const content = `
using System;

namespace Test {
    public class TestClass {
        public void TestMethod() {
            NoParamMethod();
        }

        public void NoParamMethod() {
            // Implementation
        }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d =>
        d.dependency_type === 'calls' && d.to_symbol.includes('NoParamMethod')
      );

      expect(methodCalls).toHaveLength(1);

      // Should have empty parameter context
      expect(methodCalls[0].parameter_context).toBeUndefined();
      expect(methodCalls[0].call_instance_id).toBeUndefined();
      expect(methodCalls[0].parameter_types).toBeUndefined();
    });

    test('should generate unique call instance IDs for multiple calls to same method', async () => {
      const content = `
using System;

namespace Test {
    public class TestClass {
        public void TestMethod() {
            // Multiple calls to same method
            SomeMethod(1);
            SomeMethod(2);
            SomeMethod(3);
        }

        public void SomeMethod(int value) {
            // Implementation
        }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d =>
        d.dependency_type === 'calls' && d.to_symbol.includes('SomeMethod')
      );

      expect(methodCalls).toHaveLength(3);

      // All should have unique call instance IDs
      const callInstanceIds = methodCalls.map(call => call.call_instance_id);
      const uniqueIds = new Set(callInstanceIds);
      expect(uniqueIds.size).toBe(3);

      // Verify parameter contexts are different
      const parameterContexts = methodCalls.map(call => call.parameter_context);
      expect(parameterContexts).toEqual(['1', '2', '3']);
    });
  });

  describe('Godot Game Engine Use Case', () => {
    test('should correctly parse SetHandPositions calls as mentioned in the plan', async () => {
      const content = `
using Godot;

namespace Game.Cards {
    public partial class DeckController : Node3D {
        private CardManager _cardManager;
        private Node3D _handPosition;

        public override void _Ready() {
            InitializeServices();
        }

        private void InitializeServices() {
            // The specific use case from the plan
            _cardManager.SetHandPositions(_handPosition, null); // Line 226 equivalent

            var playerHandPos = GetPlayerHandPosition();
            _cardManager.SetHandPositions(playerHandPos, _handPosition); // Line 242 equivalent
        }

        private Node3D GetPlayerHandPosition() {
            return new Node3D();
        }
    }

    public partial class CardManager : Node {
        public void SetHandPositions(Node3D playerPosition, Node3D opponentPosition) {
            // Card positioning logic
        }
    }
}`;

      const result = await parser.parseFile('DeckController.cs', content);

      // Verify the specific SetHandPositions calls mentioned in the plan
      const setHandPositionsCalls = result.dependencies.filter(d =>
        d.dependency_type === 'calls' && d.to_symbol.includes('SetHandPositions')
      );

      expect(setHandPositionsCalls).toHaveLength(2);

      // Verify the specific parameter patterns mentioned in the plan
      const call1 = setHandPositionsCalls.find(call =>
        call.parameter_context?.includes('_handPosition, null')
      );
      const call2 = setHandPositionsCalls.find(call =>
        call.parameter_context?.includes('playerHandPos, _handPosition')
      );

      expect(call1).toBeDefined();
      expect(call2).toBeDefined();

      // Verify they have different call instance IDs
      expect(call1!.call_instance_id).not.toBe(call2!.call_instance_id);

      // Verify calling context
      expect(call1!.calling_object).toBe('_cardManager');
      expect(call2!.calling_object).toBe('_cardManager');
    });

    test('should not create duplicate dependencies for same method call', async () => {
      const content = `
namespace Game {
    public class DeckController {
        public void InitializeServices() {
            var manager = new GameManager();
            manager.SetHandPositions();
        }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const setHandPositionsCalls = result.dependencies.filter(d =>
        d.to_symbol.includes('SetHandPositions')
      );

      expect(setHandPositionsCalls).toHaveLength(1);

      expect(setHandPositionsCalls[0].from_symbol).toContain('InitializeServices');
      expect(setHandPositionsCalls[0].from_symbol).not.toBe('DeckController');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle complex parameter expressions', async () => {
      const content = `
using System;

namespace Test {
    public class TestClass {
        public void TestMethod() {
            // Complex parameter expressions
            SomeMethod(obj.Property, CalculateValue() + 10, items[index], new { Name = "test" });
        }

        public void SomeMethod(string prop, int calc, object item, object anon) {
            // Implementation
        }

        private int CalculateValue() { return 5; }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      const methodCalls = result.dependencies.filter(d =>
        d.dependency_type === 'calls' && d.to_symbol.includes('SomeMethod')
      );

      expect(methodCalls).toHaveLength(1);

      // Should capture complex parameter expressions
      const call = methodCalls[0];
      expect(call.parameter_context).toContain('obj.Property');
      expect(call.parameter_context).toContain('CalculateValue() + 10');
      expect(call.parameter_context).toContain('items[index]');
      expect(call.parameter_context).toContain('new { Name = "test" }');
    });

    test('should not break on malformed parameter expressions', async () => {
      const content = `
using System;

namespace Test {
    public class TestClass {
        public void TestMethod() {
            // This should not break the parser even if malformed
            try {
                SomeMethod(validParam);
            } catch {
                // Error handling
            }
        }

        public void SomeMethod(string param) {
            // Implementation
        }
    }
}`;

      const result = await parser.parseFile('test.cs', content);

      // Should still parse successfully
      expect(result.errors).toHaveLength(0);

      const methodCalls = result.dependencies.filter(d =>
        d.dependency_type === 'calls' && d.to_symbol.includes('SomeMethod')
      );

      expect(methodCalls).toHaveLength(1);
      expect(methodCalls[0].parameter_context).toBe('validParam');
    });
  });
});