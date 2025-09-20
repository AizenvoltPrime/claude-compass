import Parser from 'tree-sitter';
import { php as PHP } from 'tree-sitter-php';
import { createTestParser, cleanupTestParser, cleanupAllTestParsers } from '../utils/tree-sitter-factory';

describe('Tree-sitter PHP Integration', () => {
  // Clean up all test parsers after the entire suite
  afterAll(() => {
    cleanupAllTestParsers();
  });

  // Helper function to create a fresh parser for each test
  const createFreshParser = (): Parser => {
    // Force garbage collection
    if (global.gc) {
      global.gc();
    }

    // Clear ALL tree-sitter related modules from cache to force completely fresh load
    const moduleKeys = Object.keys(require.cache).filter(key =>
      key.includes('tree-sitter') || key.includes('php') || key.includes('javascript')
    );

    moduleKeys.forEach(key => {
      delete require.cache[key];
    });

    // Create a completely independent parser with fresh modules
    const Parser = require('tree-sitter');
    const { php: PHP } = require('tree-sitter-php');

    const freshParser = new Parser();
    freshParser.setLanguage(PHP);

    return freshParser;
  };

  // Helper function to safely parse and validate the result
  const parseAndValidate = (code: string) => {
    // Create a fresh parser for this specific parsing operation
    const parser = createFreshParser();

    const tree = parser.parse(code);

    if (!tree) {
      throw new Error('Parser returned null/undefined tree');
    }

    if (!tree.rootNode) {
      throw new Error('Parser tree has no rootNode property (contamination issue)');
    }

    return tree;
  };

  it('should parse basic PHP class', () => {
    const code = `<?php
class TestClass {
    public function testMethod() {
        return "Hello World";
    }
}`;

    const tree = parseAndValidate(code);
    expect(tree.rootNode.type).toBe('program');

    // Verify PHP-specific nodes are parsed correctly
    const phpTag = tree.rootNode.child(0);
    expect(phpTag?.type).toBe('php_tag');

    const classNode = tree.rootNode.child(1);
    expect(classNode?.type).toBe('class_declaration');
  });

  it('should parse PHP namespace declaration', () => {
    const code = `<?php
namespace App\\Http\\Controllers;

use Illuminate\\Http\\Request;

class UserController {
    // Class content
}`;

    const tree = parseAndValidate(code);
    expect(tree.rootNode.type).toBe('program');

    // Check for namespace declaration
    const namespaceNode = tree.rootNode.children.find(child => child.type === 'namespace_definition');
    expect(namespaceNode).toBeTruthy();

    // Check for use statement
    const useNode = tree.rootNode.children.find(child => child.type === 'namespace_use_declaration');
    expect(useNode).toBeTruthy();
  });

  it('should parse PHP function with parameters', () => {
    const code = `<?php
function processUser($userId, $data) {
    return $data['name'];
}`;

    const tree = parseAndValidate(code);
    expect(tree.rootNode.type).toBe('program');

    const functionNode = tree.rootNode.children.find(child => child.type === 'function_definition');
    expect(functionNode).toBeTruthy();
    expect(functionNode?.children.some(child => child.type === 'formal_parameters')).toBe(true);
  });

  it('should handle parsing errors gracefully', () => {
    const invalidCode = `<?php
class InvalidSyntax {
    public function missingBrace() {
        return "incomplete
}`;

    const tree = parseAndValidate(invalidCode);
    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.hasError).toBe(true);
  });

  it('should parse Laravel-style class structure', () => {
    const code = `<?php

namespace App\\Http\\Controllers;

use Illuminate\\Http\\Request;
use Illuminate\\Http\\Response;

class UserController extends Controller
{
    public function index(Request $request): Response
    {
        return response()->json(['users' => []]);
    }

    public function store(Request $request): Response
    {
        // Store logic
        return response()->json(['message' => 'Created']);
    }
}`;

    const tree = parseAndValidate(code);
    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.hasError).toBe(false);

    // Verify class extends another class
    const classNode = tree.rootNode.children.find(child => child.type === 'class_declaration');
    expect(classNode).toBeTruthy();

    // Check for methods - they are inside the declaration_list
    const declarationList = classNode?.children.find(child => child.type === 'declaration_list');
    const methods = declarationList?.children.filter(child => child.type === 'method_declaration') || [];
    expect(methods.length).toBeGreaterThan(0);
  });
});