import { JavaScriptParser } from '../../src/parsers/javascript';
import { SymbolType, DependencyType } from '../../src/database/models';

describe('JavaScriptParser', () => {
  let parser: JavaScriptParser;

  beforeEach(() => {
    parser = new JavaScriptParser();
  });

  describe('getSupportedExtensions', () => {
    it('should return correct JavaScript extensions', () => {
      const extensions = parser.getSupportedExtensions();
      expect(extensions).toEqual(['.js', '.jsx', '.mjs', '.cjs']);
    });
  });

  describe('canParseFile', () => {
    it('should return true for JavaScript files', () => {
      expect(parser.canParseFile('test.js')).toBe(true);
      expect(parser.canParseFile('component.jsx')).toBe(true);
      expect(parser.canParseFile('module.mjs')).toBe(true);
      expect(parser.canParseFile('config.cjs')).toBe(true);
    });

    it('should return false for non-JavaScript files', () => {
      expect(parser.canParseFile('test.ts')).toBe(false);
      expect(parser.canParseFile('style.css')).toBe(false);
      expect(parser.canParseFile('README.md')).toBe(false);
    });
  });

  describe('parseFile', () => {
    it('should parse simple function declaration', async () => {
      const content = `
        function hello(name) {
        }
      `;

      const result = await parser.parseFile('test.js', content);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0]).toMatchObject({
        name: 'hello',
        symbol_type: SymbolType.FUNCTION,
        is_exported: false,
        start_line: 2,
      });
    });

    it('should parse arrow function assigned to variable', async () => {
      const content = `
        const greet = (name) => {
          return 'Hello, ' + name;
        };
      `;

      const result = await parser.parseFile('test.js', content);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0]).toMatchObject({
        name: 'greet',
        symbol_type: SymbolType.FUNCTION,
      });
    });

    it('should parse class declaration', async () => {
      const content = `
        class User {
          constructor(name) {
            this.name = name;
          }

          getName() {
            return this.name;
          }
        }
      `;

      const result = await parser.parseFile('test.js', content);

      expect(result.symbols).toHaveLength(2); // class + method
      expect(result.symbols[0]).toMatchObject({
        name: 'User',
        symbol_type: SymbolType.CLASS,
      });
      expect(result.symbols[1]).toMatchObject({
        name: 'getName',
        symbol_type: SymbolType.METHOD,
      });
    });

    it('should parse ES6 imports', async () => {
      const content = `
        import React from 'react';
        import { useState, useEffect } from 'react';
        import * as utils from './utils';
        import './styles.css';
      `;

      const result = await parser.parseFile('test.js', content);

      expect(result.imports).toHaveLength(4);

      expect(result.imports[0]).toMatchObject({
        source: 'react',
        import_type: 'default',
        imported_names: ['React'],
        is_dynamic: false,
      });

      expect(result.imports[1]).toMatchObject({
        source: 'react',
        import_type: 'named',
        imported_names: ['useState', 'useEffect'],
        is_dynamic: false,
      });

      expect(result.imports[2]).toMatchObject({
        source: './utils',
        import_type: 'namespace',
        imported_names: ['utils'],
        is_dynamic: false,
      });

      expect(result.imports[3]).toMatchObject({
        source: './styles.css',
        import_type: 'side_effect',
        imported_names: [],
        is_dynamic: false,
      });
    });

    it('should parse CommonJS require calls', async () => {
      const content = `
        const fs = require('fs');
        const path = require('path');
        const utils = require('./utils');
      `;

      const result = await parser.parseFile('test.js', content);

      expect(result.imports).toHaveLength(3);

      result.imports.forEach(importInfo => {
        expect(importInfo.import_type).toBe('default');
        expect(importInfo.is_dynamic).toBe(false);
      });

      expect(result.imports[0].source).toBe('fs');
      expect(result.imports[1].source).toBe('path');
      expect(result.imports[2].source).toBe('./utils');
    });

    it('should parse dynamic imports', async () => {
      const content = `
        async function loadModule() {
          const module = await import('./dynamic-module');
          return module.default;
        }
      `;

      const result = await parser.parseFile('test.js', content);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]).toMatchObject({
        source: './dynamic-module',
        import_type: 'default',
        is_dynamic: true,
      });
    });

    it('should handle parse errors gracefully', async () => {
      const content = `
        function incomplete( {
      `;

      const result = await parser.parseFile('test.js', content);

      // Parser should not throw but may return limited results
      expect(result).toBeDefined();
      expect(Array.isArray(result.symbols)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should respect file size limits', async () => {
      const largeContent = 'const x = 1;\n'.repeat(100000); // Large file

      const result = await parser.parseFile('test.js', largeContent, {
        maxFileSize: 1000, // Small limit
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('too large');
    });
  });

  describe('Signature Extraction', () => {
    describe('Arrow Function Signatures', () => {
      it('should extract simple arrow function signature', async () => {
        const content = 'const foo = () => {};';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('() => {...}');
      });

      it('should extract async arrow function signature', async () => {
        const content = 'const foo = async () => {};';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('async () => {...}');
      });

      it('should extract arrow function with parameters', async () => {
        const content = 'const foo = (a, b) => { return a + b; };';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('(a, b) => {...}');
      });

      it('should extract async arrow function with parameters', async () => {
        const content = 'const foo = async (x, y) => { return x * y; };';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('async (x, y) => {...}');
      });

      it('should extract single param arrow function without parens', async () => {
        const content = 'const foo = x => x * 2;';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('x => ...');
      });

      it('should extract arrow function with expression body', async () => {
        const content = 'const square = n => n * n;';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('n => ...');
      });
    });

    describe('Function Expression Signatures', () => {
      it('should extract anonymous function expression', async () => {
        const content = 'const foo = function() {};';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('function()');
      });

      it('should extract named function expression', async () => {
        const content = 'const foo = function bar() {};';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('function bar()');
      });

      it('should extract async function expression', async () => {
        const content = 'const foo = async function() {};';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('async function()');
      });

      it('should extract async named function expression', async () => {
        const content = 'const foo = async function baz() {};';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('async function baz()');
      });
    });

    describe('Call Expression Signatures', () => {
      it('should extract defineStore call signature', async () => {
        const content = `
          const store = defineStore('personnel', {
            state: () => ({ items: [] }),
            actions: { load() {} }
          });
        `;
        const result = await parser.parseFile('test.js', content);

        const storeSymbol = result.symbols.find(s => s.name === 'store');
        expect(storeSymbol).toBeDefined();
        expect(storeSymbol?.signature).toContain('defineStore');
        expect(storeSymbol?.signature).toContain("'personnel'");
        expect(storeSymbol?.signature).not.toContain('state:');
        expect(storeSymbol?.signature?.length).toBeLessThan(150);
      });

      it('should truncate long call expressions', async () => {
        const content = `
          const config = createConfig({
            option1: 'very long value that should be truncated',
            option2: 'another very long value that should be truncated',
            option3: 'yet another very long value that should be truncated'
          });
        `;
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toContain('createConfig');
        expect(result.symbols[0].signature?.length).toBeLessThan(150);
      });
    });

    describe('Object and Array Literal Signatures', () => {
      it('should use {...} for object literals', async () => {
        const content = 'const obj = { prop1: 1, prop2: 2, prop3: 3 };';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('{...}');
      });

      it('should use [...] for array literals', async () => {
        const content = 'const arr = [1, 2, 3, 4, 5];';
        const result = await parser.parseFile('test.js', content);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].signature).toBe('[...]');
      });
    });

    describe('Complex Real-World Cases', () => {
      it('should handle Pinia store definition correctly', async () => {
        const content = `
          export const usePersonnelStore = defineStore('personnel', {
            state: () => ({
              personnel: [],
              isLoading: false,
              error: null
            }),
            actions: {
              async fetchPersonnel() {
                this.isLoading = true;
                const response = await api.get('/personnel');
                this.personnel = response.data;
                this.isLoading = false;
              }
            }
          });
        `;
        const result = await parser.parseFile('test.js', content);

        const storeSymbol = result.symbols.find(s => s.name === 'usePersonnelStore');
        expect(storeSymbol).toBeDefined();
        expect(storeSymbol?.signature).toContain('defineStore');
        expect(storeSymbol?.signature).not.toContain('state:');
        expect(storeSymbol?.signature).not.toContain('actions:');
        expect(storeSymbol?.signature?.length).toBeLessThan(150);
      });

      it('should handle Vue composition API correctly', async () => {
        const content = `
          const submitForm = async () => {
            if (isSubmitting.value) return;
            const isValid = await handleFormValidation();
            if (!isValid) return;
            try {
              isSubmitting.value = true;
              await store.createPersonnel(formData.value);
              showSuccess.value = true;
            } catch (error) {
              console.error('Error:', error);
              showError.value = true;
            } finally {
              isSubmitting.value = false;
            }
          };
        `;
        const result = await parser.parseFile('test.js', content);

        const submitFormSymbol = result.symbols.find(s => s.name === 'submitForm');
        expect(submitFormSymbol).toBeDefined();
        expect(submitFormSymbol?.signature).toBe('async () => {...}');
        expect(submitFormSymbol?.signature?.length).toBeLessThan(50);
      });
    });

    describe('Method Signatures with Modifiers', () => {
      it('should include async modifier in method signature', async () => {
        const content = `
          class Store {
            async fetchData() {
              return await api.get('/data');
            }
          }
        `;
        const result = await parser.parseFile('test.js', content);

        const methodSymbol = result.symbols.find(s => s.name === 'fetchData');
        expect(methodSymbol).toBeDefined();
        expect(methodSymbol?.signature).toBe('async fetchData()');
      });

      it('should include static modifier in method signature', async () => {
        const content = `
          class Utils {
            static formatDate(date) {
              return date.toISOString();
            }
          }
        `;
        const result = await parser.parseFile('test.js', content);

        const methodSymbol = result.symbols.find(s => s.name === 'formatDate');
        expect(methodSymbol).toBeDefined();
        expect(methodSymbol?.signature).toBe('static formatDate(date)');
      });

      it('should include async static modifier in method signature', async () => {
        const content = `
          class API {
            static async request(url) {
              return await fetch(url);
            }
          }
        `;
        const result = await parser.parseFile('test.js', content);

        const methodSymbol = result.symbols.find(s => s.name === 'request');
        expect(methodSymbol).toBeDefined();
        expect(methodSymbol?.signature).toBe('static async request(url)');
      });

      it('should include get modifier for getter methods', async () => {
        const content = `
          class Person {
            get fullName() {
              return this.firstName + ' ' + this.lastName;
            }
          }
        `;
        const result = await parser.parseFile('test.js', content);

        const methodSymbol = result.symbols.find(s => s.name === 'fullName');
        expect(methodSymbol).toBeDefined();
        expect(methodSymbol?.signature).toBe('get fullName()');
      });

      it('should include set modifier for setter methods', async () => {
        const content = `
          class Person {
            set fullName(value) {
              const parts = value.split(' ');
              this.firstName = parts[0];
              this.lastName = parts[1];
            }
          }
        `;
        const result = await parser.parseFile('test.js', content);

        const methodSymbol = result.symbols.find(s => s.name === 'fullName');
        expect(methodSymbol).toBeDefined();
        expect(methodSymbol?.signature).toBe('set fullName(value)');
      });
    });
  });
});