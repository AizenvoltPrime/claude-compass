import { MultiParser } from '../../src/parsers/multi-parser';
import { FrameworkDetector } from '../../src/parsers/framework-detector';
import { ParserFactory, BaseParser } from '../../src/parsers/base';
import { BaseFrameworkParser } from '../../src/parsers/base-framework';
import { VueParser } from '../../src/parsers/vue';
import { ReactParser } from '../../src/parsers/react';
import { JavaScriptParser } from '../../src/parsers/javascript';
import { SymbolType } from '../../src/database/models';
import { jest } from '@jest/globals';
// Import parsers to ensure registration
import '../../src/parsers/index';

// Mock the parsers and detector
jest.mock('../../src/parsers/framework-detector');

const MockFrameworkDetector = FrameworkDetector as jest.MockedClass<typeof FrameworkDetector>;

describe('MultiParser', () => {
  let multiParser: MultiParser;
  let mockDetector: jest.Mocked<FrameworkDetector>;
  let mockVueParser: jest.Mocked<VueParser>;
  let mockReactParser: jest.Mocked<ReactParser>;
  let mockJSParser: jest.Mocked<JavaScriptParser>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock detector
    mockDetector = {
      detectFrameworks: jest.fn(),
      getApplicableFrameworks: jest.fn()
    } as any;
    MockFrameworkDetector.mockImplementation(() => mockDetector);

    // Create mock parsers that extend the correct base classes
    mockVueParser = Object.create(BaseFrameworkParser.prototype);
    mockVueParser.parseFile = jest.fn();

    mockReactParser = Object.create(BaseFrameworkParser.prototype);
    mockReactParser.parseFile = jest.fn();

    mockJSParser = Object.create(BaseParser.prototype);
    mockJSParser.parseFile = jest.fn();

    // Mock ParserFactory to return our mock parsers
    ParserFactory.getParser = jest.fn((name: string) => {
      switch (name) {
        case 'javascript': return mockJSParser as any;
        case 'typescript': return mockJSParser as any; // Use JS parser for TS in tests
        case 'vue': return mockVueParser as any;
        case 'react': return mockReactParser as any;
        case 'nodejs': return mockJSParser as any; // Use JS parser for Node.js in tests
        case 'nextjs': return mockReactParser as any; // Use React parser for Next.js in tests
        default: return null;
      }
    });

    multiParser = new MultiParser();
  });

  describe('parseFile', () => {
    it('should parse Vue SFC with multiple parsers', async () => {
      const mockDetectionResult = {
        frameworks: [
        ],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      };

      mockDetector.getApplicableFrameworks.mockReturnValue(['javascript', 'vue']);

      mockJSParser.parseFile.mockResolvedValue({
        symbols: [{
          name: 'setup',
          symbol_type: SymbolType.FUNCTION,
          start_line: 10,
          end_line: 10,
          is_exported: false
        }],
        dependencies: [],
        imports: [{
          source: 'vue',
          imported_names: ['ref'],
          import_type: 'named',
          line_number: 1,
          is_dynamic: false
        }],
        exports: [],
        errors: []
      });

      mockVueParser.parseFile.mockResolvedValue({
        filePath: '/src/App.vue',
        symbols: [{
          name: 'MyComponent',
          symbol_type: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 1,
          is_exported: true
        }],
        dependencies: [],
        imports: [],
        exports: [{
          exported_names: ['MyComponent'],
          export_type: 'default',
          line_number: 1
        }],
        errors: [],
        frameworkEntities: [{
          type: 'component',
          name: 'MyComponent',
          filePath: '/src/App.vue',
          metadata: {
            props: ['title'],
            emits: ['click']
          }
        }],
        metadata: {
          framework: 'vue',
          isFrameworkSpecific: true,
          fileType: 'vue-sfc'
        }
      });

      const content = `
<template>
  <div>{{ title }}</div>
</template>

<script setup>
import { ref } from 'vue'
const title = ref('Hello')
</script>
      `;

      const result = await multiParser.parseFile(content, '/src/App.vue', {}, mockDetectionResult);

      expect(result.parsers).toEqual(['javascript', 'vue']);
      expect(result.primaryParser).toBe('vue');
      expect(result.symbols).toHaveLength(2); // Both JS and Vue symbols
      expect(result.frameworkEntities).toHaveLength(1);
      expect(result.frameworkEntities![0].type).toBe('component');
    });

    it('should handle React component with TypeScript', async () => {
      mockDetector.getApplicableFrameworks.mockReturnValue(['typescript', 'react']);
      mockDetector.detectFrameworks.mockResolvedValue({
        frameworks: [
        ],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: false, directoryStructure: [] }
      });

      // Use the universal mock setup from beforeEach

      // Configure JavaScript parser to return TypeScript-like results
      mockJSParser.parseFile.mockResolvedValue({
        symbols: [{
          name: 'Button',
          symbol_type: SymbolType.FUNCTION,
          start_line: 3,
          end_line: 3,
          is_exported: true
        }],
        dependencies: [],
        imports: [{
          source: 'react',
          imported_names: ['useState'],
          import_type: 'named',
          line_number: 1,
          is_dynamic: false
        }],
        exports: [{
          exported_names: ['Button'],
          export_type: 'default',
          line_number: 3
        }],
        errors: []
      });

      mockReactParser.parseFile.mockResolvedValue({
        filePath: '/src/Button.tsx',
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [{
          type: 'component',
          name: 'Button',
          filePath: '/src/Button.tsx',
          metadata: {
            hooks: ['useState'],
            isForwardRef: false
          }
        }],
        metadata: {
          framework: 'react',
          isFrameworkSpecific: true,
          fileType: 'component'
        }
      });

      const content = `
import React, { useState } from 'react';

export default function Button() {
  const [clicked, setClicked] = useState(false);
  return <button onClick={() => setClicked(true)}>Click me</button>;
}
      `;

      const result = await multiParser.parseFile(content, '/src/Button.tsx');

      expect(result.primaryParser).toBe('react');
      expect(result.frameworkEntities).toHaveLength(1);
      expect(result.frameworkEntities![0].metadata.hooks).toContain('useState');
    });

    it('should fall back to default parsers when no frameworks detected', async () => {
      mockDetector.detectFrameworks.mockResolvedValue({
        frameworks: [],
        metadata: { hasPackageJson: false, hasComposerJson: false, hasConfigFiles: false, directoryStructure: [] }
      });

      // Use the universal mock setup from beforeEach

      mockJSParser.parseFile.mockResolvedValue({
        symbols: [{
          name: 'myFunction',
          symbol_type: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 1,
          is_exported: true
        }],
        dependencies: [],
        imports: [],
        exports: [],
        errors: []
      });

      const content = 'export function myFunction() { return "hello"; }';
      const result = await multiParser.parseFile(content, '/src/utils.js');

      expect(result.parsers).toEqual(['javascript']);
      expect(result.primaryParser).toBe('javascript');
      expect(result.symbols).toHaveLength(1);
    });

    it('should handle parser errors gracefully', async () => {
      mockDetector.getApplicableFrameworks.mockReturnValue(['javascript', 'vue']);

      mockJSParser.parseFile.mockResolvedValue({
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: []
      });

      // Vue parser throws an error
      mockVueParser.parseFile.mockRejectedValue(new Error('Parse error'));

      const result = await multiParser.parseFile('content', '/src/App.vue', {}, {
        frameworks: [],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      });

      // Should still succeed with JS parser
      expect(result.parsers).toEqual(['javascript', 'vue']);
      expect(result.primaryParser).toBe('javascript');
    });

    it('should prioritize framework parsers over base parsers', async () => {
      mockDetector.getApplicableFrameworks.mockReturnValue(['javascript', 'react']);

      mockJSParser.parseFile.mockResolvedValue({
        symbols: [{
          name: 'Component',
          symbol_type: SymbolType.FUNCTION,
          start_line: 1,
          end_line: 1,
          is_exported: true
        }],
        dependencies: [],
        imports: [],
        exports: [],
        errors: []
      });

      mockReactParser.parseFile.mockResolvedValue({
        filePath: '/src/Component.jsx',
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [{
          type: 'component',
          name: 'Component',
          filePath: '/src/Component.jsx',
          metadata: {}
        }],
        metadata: {
          framework: 'react',
          isFrameworkSpecific: true
        }
      });

      const result = await multiParser.parseFile('content', '/src/Component.jsx', {}, {
        frameworks: [],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      });

      expect(result.primaryParser).toBe('react');
      expect(result.frameworkEntities).toHaveLength(1);
    });
  });

  describe('parseFiles', () => {
    it('should parse multiple files with shared framework detection', async () => {
      mockDetector.detectFrameworks.mockResolvedValue({
        frameworks: [
        ],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      });

      mockDetector.getApplicableFrameworks
        .mockReturnValueOnce(['javascript', 'vue'])
        .mockReturnValueOnce(['javascript']);

      mockJSParser.parseFile
        .mockResolvedValueOnce({
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: []
        })
        .mockResolvedValueOnce({
          symbols: [{
            name: 'helper',
            symbol_type: SymbolType.FUNCTION,
            start_line: 1,
            end_line: 1,
            is_exported: true
          }],
          dependencies: [],
          imports: [],
          exports: [],
          errors: []
        });

      mockVueParser.parseFile.mockResolvedValue({
        filePath: '/src/App.vue',
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [{
          type: 'component',
          name: 'App',
          filePath: '/src/App.vue',
          metadata: {}
        }],
        metadata: {
          framework: 'vue',
          isFrameworkSpecific: true
        }
      });

      const files = [
        { content: '<template><div>App</div></template>', filePath: '/src/App.vue' },
        { content: 'export const helper = () => {}', filePath: '/src/utils.js' }
      ];

      const results = await multiParser.parseFiles(files, '/project');

      expect(results).toHaveLength(2);
      expect(results[0].primaryParser).toBe('vue');
      expect(results[1].primaryParser).toBe('javascript');
      expect(mockDetector.detectFrameworks).toHaveBeenCalledTimes(1);
    });
  });

  describe('utility methods', () => {
    it('should detect frameworks for project', async () => {
      const mockResult = {
        frameworks: [],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      };

      mockDetector.detectFrameworks.mockResolvedValue(mockResult);

      const result = await multiParser.detectFrameworks('/project');

      expect(result).toEqual(mockResult);
      expect(mockDetector.detectFrameworks).toHaveBeenCalledWith('/project');
    });

    it('should get applicable frameworks for file', () => {
      const detectionResult = {
        frameworks: [],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      };

      mockDetector.getApplicableFrameworks.mockReturnValue(['javascript', 'vue']);

      const frameworks = multiParser.getApplicableFrameworks('/src/App.vue', detectionResult);

      expect(frameworks).toEqual(['javascript', 'vue']);
    });
  });

  describe('edge cases', () => {
    it('should handle empty file content', async () => {
      mockDetector.getApplicableFrameworks.mockReturnValue(['javascript']);

      mockJSParser.parseFile.mockResolvedValue({
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: []
      });

      const result = await multiParser.parseFile('', '/src/empty.js');

      expect(result.symbols).toHaveLength(0);
      expect(result.parsers).toEqual(['javascript']);
    });

    it('should handle files with no applicable parsers', async () => {
      mockDetector.getApplicableFrameworks.mockReturnValue([]);
      mockDetector.detectFrameworks.mockResolvedValue({
        frameworks: [],
        metadata: { hasPackageJson: false, hasComposerJson: false, hasConfigFiles: false, directoryStructure: [] }
      });

      const result = await multiParser.parseFile('content', '/src/unknown.xyz');

      expect(result.parsers).toEqual([]);
      expect(result.primaryParser).toBe('unknown');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('All parsers failed');
    });

    it('should handle missing parsers gracefully', async () => {
      mockDetector.detectFrameworks.mockResolvedValue({
        frameworks: [],
        metadata: { hasPackageJson: false, hasComposerJson: false, hasConfigFiles: false, directoryStructure: [] }
      });
      mockDetector.getApplicableFrameworks.mockReturnValue(['nonexistent']);

      const result = await multiParser.parseFile('content', '/src/file.js');

      expect(result.parsers).toEqual(['nonexistent']);
      expect(result.errors).toHaveLength(1);
    });
  });
});