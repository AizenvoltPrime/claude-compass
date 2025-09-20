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
});