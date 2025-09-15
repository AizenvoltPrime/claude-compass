import { FileGraphBuilder } from '../../src/graph/file-graph';
import { Repository, File } from '../../src/database/models';
import { ParsedImport, ParsedExport } from '../../src/parsers/base';

describe('FileGraphBuilder', () => {
  let builder: FileGraphBuilder;

  beforeEach(() => {
    builder = new FileGraphBuilder();
  });

  describe('buildFileGraph', () => {
    it('should build a simple file graph with import relationships', async () => {
      const repository: Repository = {
        id: 1,
        name: 'test-repo',
        path: '/test/repo',
        framework_stack: [],
        last_indexed: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const files: File[] = [
        {
          id: 1,
          repo_id: 1,
          path: '/test/repo/src/main.js',
          language: 'javascript',
          size: 1000,
          is_generated: false,
          is_test: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 2,
          repo_id: 1,
          path: '/test/repo/src/utils.js',
          language: 'javascript',
          size: 500,
          is_generated: false,
          is_test: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const importsMap = new Map<number, ParsedImport[]>();
      importsMap.set(1, [
        {
          source: './utils',
          imported_names: ['helper'],
          import_type: 'named',
          line_number: 1,
          is_dynamic: false,
        },
      ]);

      const exportsMap = new Map<number, ParsedExport[]>();
      exportsMap.set(2, [
        {
          exported_names: ['helper'],
          export_type: 'named',
          line_number: 5,
        },
      ]);

      const result = await builder.buildFileGraph(repository, files, importsMap, exportsMap);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0]).toMatchObject({
        id: 1,
        path: '/test/repo/src/main.js',
        relativePath: 'src/main.js',
        language: 'javascript',
        isTest: false,
        isGenerated: false,
      });

      expect(result.nodes[1]).toMatchObject({
        id: 2,
        path: '/test/repo/src/utils.js',
        relativePath: 'src/utils.js',
        language: 'javascript',
        isTest: false,
        isGenerated: false,
      });

      // Should have one edge from main.js to utils.js
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toMatchObject({
        from: 1,
        to: 2,
        importType: 'named',
        importedSymbols: ['helper'],
        isDynamic: false,
        lineNumber: 1,
      });
    });

    it('should handle files with no imports', async () => {
      const repository: Repository = {
        id: 1,
        name: 'test-repo',
        path: '/test/repo',
        framework_stack: [],
        last_indexed: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const files: File[] = [
        {
          id: 1,
          repo_id: 1,
          path: '/test/repo/src/standalone.js',
          language: 'javascript',
          size: 200,
          is_generated: false,
          is_test: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const importsMap = new Map<number, ParsedImport[]>();
      const exportsMap = new Map<number, ParsedExport[]>();

      const result = await builder.buildFileGraph(repository, files, importsMap, exportsMap);

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
    });

    it('should identify test files correctly', async () => {
      const repository: Repository = {
        id: 1,
        name: 'test-repo',
        path: '/test/repo',
        framework_stack: [],
        last_indexed: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const files: File[] = [
        {
          id: 1,
          repo_id: 1,
          path: '/test/repo/src/component.test.js',
          language: 'javascript',
          size: 800,
          is_generated: false,
          is_test: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 2,
          repo_id: 1,
          path: '/test/repo/dist/bundle.js',
          language: 'javascript',
          size: 50000,
          is_generated: true,
          is_test: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const importsMap = new Map<number, ParsedImport[]>();
      const exportsMap = new Map<number, ParsedExport[]>();

      const result = await builder.buildFileGraph(repository, files, importsMap, exportsMap);

      expect(result.nodes[0].isTest).toBe(true);
      expect(result.nodes[0].isGenerated).toBe(false);
      expect(result.nodes[1].isTest).toBe(false);
      expect(result.nodes[1].isGenerated).toBe(true);
    });
  });

  describe('resolveModulePath', () => {
    it('should resolve relative imports', () => {
      const result = builder.resolveModulePath(
        './utils',
        '/project/src/main.js',
        '/project'
      );

      expect(result).toBe('/project/src/utils');
    });

    it('should resolve parent directory imports', () => {
      const result = builder.resolveModulePath(
        '../shared/helpers',
        '/project/src/components/Button.js',
        '/project'
      );

      expect(result).toBe('/project/src/shared/helpers');
    });

    it('should resolve absolute imports from root', () => {
      const result = builder.resolveModulePath(
        '/src/utils',
        '/project/src/main.js',
        '/project'
      );

      expect(result).toBe('/project/src/utils');
    });

    it('should handle src/ alias imports', () => {
      const result = builder.resolveModulePath(
        'src/utils/helpers',
        '/project/src/main.js',
        '/project'
      );

      expect(result).toBe('/project/src/utils/helpers');
    });

    it('should handle @ alias imports', () => {
      const result = builder.resolveModulePath(
        '@/components/Button',
        '/project/src/pages/index.js',
        '/project'
      );

      expect(result).toBe('/project/src/components/Button');
    });

    it('should return null for builtin modules', () => {
      expect(builder.resolveModulePath('fs', '/project/src/main.js', '/project')).toBeNull();
      expect(builder.resolveModulePath('path', '/project/src/main.js', '/project')).toBeNull();
      expect(builder.resolveModulePath('node:fs', '/project/src/main.js', '/project')).toBeNull();
    });

    it('should return null for npm packages', () => {
      expect(builder.resolveModulePath('react', '/project/src/main.js', '/project')).toBeNull();
      expect(builder.resolveModulePath('lodash', '/project/src/main.js', '/project')).toBeNull();
      expect(builder.resolveModulePath('@babel/core', '/project/src/main.js', '/project')).toBeNull();
    });
  });

  describe('getImporters', () => {
    it('should find files that import a specific file', () => {
      const fileGraph = {
        nodes: [
          { id: 1, path: '/main.js', relativePath: 'main.js', isTest: false, isGenerated: false },
          { id: 2, path: '/utils.js', relativePath: 'utils.js', isTest: false, isGenerated: false },
          { id: 3, path: '/helpers.js', relativePath: 'helpers.js', isTest: false, isGenerated: false },
        ],
        edges: [
          { from: 1, to: 2, importType: 'named' as const, importedSymbols: ['helper'], isDynamic: false, lineNumber: 1 },
          { from: 3, to: 2, importType: 'default' as const, importedSymbols: ['util'], isDynamic: false, lineNumber: 2 },
        ],
      };

      const importers = builder.getImporters(2, fileGraph); // Who imports utils.js?

      expect(importers).toHaveLength(2);
      expect(importers.map(f => f.id).sort()).toEqual([1, 3]);
    });

    it('should return empty array when no importers exist', () => {
      const fileGraph = {
        nodes: [
          { id: 1, path: '/main.js', relativePath: 'main.js', isTest: false, isGenerated: false },
          { id: 2, path: '/utils.js', relativePath: 'utils.js', isTest: false, isGenerated: false },
        ],
        edges: [
          { from: 1, to: 2, importType: 'named' as const, importedSymbols: [], isDynamic: false, lineNumber: 1 },
        ],
      };

      const importers = builder.getImporters(1, fileGraph); // Who imports main.js?

      expect(importers).toHaveLength(0);
    });
  });

  describe('findCircularDependencies', () => {
    it('should detect circular dependencies', () => {
      const fileGraph = {
        nodes: [
          { id: 1, path: '/a.js', relativePath: 'a.js', isTest: false, isGenerated: false },
          { id: 2, path: '/b.js', relativePath: 'b.js', isTest: false, isGenerated: false },
          { id: 3, path: '/c.js', relativePath: 'c.js', isTest: false, isGenerated: false },
        ],
        edges: [
          { from: 1, to: 2, importType: 'named' as const, importedSymbols: [], isDynamic: false, lineNumber: 1 }, // a -> b
          { from: 2, to: 3, importType: 'named' as const, importedSymbols: [], isDynamic: false, lineNumber: 1 }, // b -> c
          { from: 3, to: 1, importType: 'named' as const, importedSymbols: [], isDynamic: false, lineNumber: 1 }, // c -> a (creates cycle)
        ],
      };

      const cycles = builder.findCircularDependencies(fileGraph);

      expect(cycles.length).toBeGreaterThan(0);
      // Should detect the cycle: a -> b -> c -> a
    });

    it('should return no cycles for acyclic graph', () => {
      const fileGraph = {
        nodes: [
          { id: 1, path: '/a.js', relativePath: 'a.js', isTest: false, isGenerated: false },
          { id: 2, path: '/b.js', relativePath: 'b.js', isTest: false, isGenerated: false },
          { id: 3, path: '/c.js', relativePath: 'c.js', isTest: false, isGenerated: false },
        ],
        edges: [
          { from: 1, to: 2, importType: 'named' as const, importedSymbols: [], isDynamic: false, lineNumber: 1 }, // a -> b
          { from: 1, to: 3, importType: 'named' as const, importedSymbols: [], isDynamic: false, lineNumber: 2 }, // a -> c
        ],
      };

      const cycles = builder.findCircularDependencies(fileGraph);

      expect(cycles).toHaveLength(0);
    });
  });
});