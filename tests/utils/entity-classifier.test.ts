import { jest } from '@jest/globals';

// Mock fs BEFORE importing EntityTypeClassifier
jest.mock('fs', () => {
  const EventEmitter = require('events');
  const mockStream = new EventEmitter();
  (mockStream as any).write = jest.fn();
  (mockStream as any).end = jest.fn();

  return {
    existsSync: jest.fn().mockReturnValue(true),
    readdirSync: jest.fn().mockReturnValue(['default.json']),
    statSync: jest.fn().mockReturnValue({ isFile: () => true }),
    readFileSync: jest.fn().mockReturnValue(JSON.stringify({ default: { default: {} } })),
    stat: jest.fn((path: any, callback: any) => callback(null, { isFile: () => true })) as any,
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    createWriteStream: jest.fn(() => mockStream),
    promises: {
      stat: jest.fn(() => Promise.resolve({ isFile: () => true } as any)) as any,
      readFile: jest.fn(),
      writeFile: jest.fn(),
      mkdir: jest.fn(),
    },
  };
});

import * as fs from 'fs';
import { EntityTypeClassifier } from '../../src/utils/entity-classifier';

const mockFs = fs as jest.Mocked<typeof fs>;

describe('EntityTypeClassifier', () => {
  const mockConfigPath = '/mock/config/entity-classification';

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default mocks after each test
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(['default.json'] as any);
    mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ default: { default: {} } }) as any);
  });

  describe('Rule Loading', () => {
    it('should load all framework rules successfully', () => {
      const mockLaravelRules = {
        laravel: {
          class: {
            baseClassRules: {
              Controller: { priority: 1, entityType: 'controller' },
              Model: { priority: 1, entityType: 'model' },
            },
          },
        },
      };

      const mockVueRules = {
        vue: {
          default: {
            fileExtensionRules: [{ extension: '.vue', priority: 20, entityType: 'component' }],
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['laravel.json', 'vue.json'] as any);
      mockFs.statSync.mockImplementation((filePath: any) => ({
        isFile: () => true,
      } as any));

      mockFs.readFileSync.mockImplementation((filePath: any) => {
        if (filePath.includes('laravel.json')) {
          return JSON.stringify(mockLaravelRules) as any;
        }
        if (filePath.includes('vue.json')) {
          return JSON.stringify(mockVueRules) as any;
        }
        throw new Error('File not found');
      });

      const classifier = new EntityTypeClassifier(mockConfigPath);
      const frameworks = classifier.getSupportedFrameworks();

      expect(frameworks).toContain('laravel');
      expect(frameworks).toContain('vue');
      expect(frameworks).toHaveLength(2);
    });

    it('should throw error when directory not found', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() => new EntityTypeClassifier(mockConfigPath)).toThrow(
        'Classification rules directory not found'
      );
    });

    it('should throw error when no JSON files found', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([]);

      expect(() => new EntityTypeClassifier(mockConfigPath)).toThrow('No JSON files found');
    });

    it('should throw error when JSON is malformed', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['invalid.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockReturnValue('{ invalid json }' as any);

      expect(() => new EntityTypeClassifier(mockConfigPath)).toThrow(
        'Critical error loading classification rules'
      );
    });

    it('should filter out directories and only process JSON files', () => {
      const mockRules = {
        react: {
          function: {
            namePatterns: {
              prefix: [{ pattern: '^[A-Z]', priority: 10, entityType: 'component' }],
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['react.json', 'README.md', 'subdirectory'] as any);
      mockFs.statSync.mockImplementation((filePath: any) => ({
        isFile: () => !filePath.includes('subdirectory'),
      } as any));
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockRules) as any);

      const classifier = new EntityTypeClassifier(mockConfigPath);
      const frameworks = classifier.getSupportedFrameworks();

      expect(frameworks).toContain('react');
      expect(frameworks).toHaveLength(1);
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('Validation', () => {
    it('should throw error for duplicate framework definitions', () => {
      const mockRules1 = {
        laravel: { class: { baseClassRules: {} } },
      };

      const mockRules2 = {
        laravel: { class: { baseClassRules: {} } },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['file1.json', 'file2.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockImplementation((filePath: any) => {
        if (filePath.includes('file1.json')) return JSON.stringify(mockRules1) as any;
        if (filePath.includes('file2.json')) return JSON.stringify(mockRules2) as any;
        throw new Error('File not found');
      });

      expect(() => new EntityTypeClassifier(mockConfigPath)).toThrow(
        'Duplicate framework "laravel" found'
      );
    });

    it('should throw error for invalid rule format (not an object)', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['invalid.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(['not', 'an', 'object']));

      expect(() => new EntityTypeClassifier(mockConfigPath)).toThrow(
        'Invalid rule format in invalid.json: expected object'
      );
    });

    it('should throw error for missing priority in rule', () => {
      const mockRules = {
        laravel: {
          class: {
            baseClassRules: {
              Controller: { entityType: 'controller' }, // Missing priority
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['laravel.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockRules) as any);

      expect(() => new EntityTypeClassifier(mockConfigPath)).toThrow(
        'Invalid priority at laravel.json:laravel.class.baseClassRules.Controller'
      );
    });

    it('should throw error for missing entityType in rule', () => {
      const mockRules = {
        laravel: {
          class: {
            baseClassRules: {
              Controller: { priority: 1 }, // Missing entityType
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['laravel.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockRules) as any);

      expect(() => new EntityTypeClassifier(mockConfigPath)).toThrow(
        'Invalid entityType at laravel.json:laravel.class.baseClassRules.Controller'
      );
    });

    it('should throw error for missing pattern in name pattern rule', () => {
      const mockRules = {
        react: {
          function: {
            namePatterns: {
              prefix: [
                { priority: 10, entityType: 'component' }, // Missing pattern
              ],
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['react.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockRules) as any);

      expect(() => new EntityTypeClassifier(mockConfigPath)).toThrow(
        'Invalid pattern at react.json:react.function.namePatterns.prefix[0]'
      );
    });

    it('should throw error for invalid namePatterns structure', () => {
      const mockRules = {
        react: {
          function: {
            namePatterns: 'not-an-object', // Should be an object
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['react.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockRules) as any);

      expect(() => new EntityTypeClassifier(mockConfigPath)).toThrow(
        'Invalid namePatterns in react.json for "react.function"'
      );
    });
  });

  describe('Classification', () => {
    let classifier: EntityTypeClassifier;

    beforeEach(() => {
      const mockLaravelRules = {
        laravel: {
          class: {
            baseClassRules: {
              Controller: { priority: 1, entityType: 'controller' },
              Model: { priority: 1, entityType: 'model' },
            },
            namePatterns: {
              suffix: [
                { pattern: 'Controller', priority: 10, entityType: 'controller' },
                { pattern: 'Service', priority: 10, entityType: 'service' },
              ],
            },
            directoryRules: [
              { path: '/app/Http/Controllers/', priority: 5, entityType: 'controller' },
              { path: '/app/Models/', priority: 5, entityType: 'model' },
            ],
          },
        },
      };

      const mockVueRules = {
        vue: {
          default: {
            fileExtensionRules: [{ extension: '.vue', priority: 20, entityType: 'component' }],
          },
        },
      };

      const mockReactRules = {
        react: {
          function: {
            namePatterns: {
              prefix: [
                {
                  pattern: '^use[A-Z]',
                  priority: 15,
                  entityType: 'hook',
                  fileExtensions: ['.jsx', '.tsx'],
                },
                {
                  pattern: '^[A-Z]',
                  priority: 10,
                  entityType: 'component',
                  fileExtensions: ['.jsx', '.tsx'],
                },
              ],
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['laravel.json', 'vue.json', 'react.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockImplementation((filePath: any) => {
        if (filePath.includes('laravel.json')) return JSON.stringify(mockLaravelRules) as any;
        if (filePath.includes('vue.json')) return JSON.stringify(mockVueRules) as any;
        if (filePath.includes('react.json')) return JSON.stringify(mockReactRules) as any;
        return JSON.stringify({ default: { default: {} } }) as any;
      });

      classifier = new EntityTypeClassifier(mockConfigPath);
    });

    describe('Laravel Classification', () => {
      it('should classify Laravel controller by base class', () => {
        const result = classifier.classify(
          'class',
          'UserController',
          ['Controller'],
          '/app/Http/Controllers/UserController.php',
          'laravel'
        );

        expect(result.entityType).toBe('controller');
        expect(result.baseClass).toBe('Controller');
        // Name suffix rule wins (priority 10 > base class priority 1)
        expect(result.matchedRule).toBe('name suffix: Controller');
      });

      it('should classify Laravel controller by name suffix', () => {
        const result = classifier.classify(
          'class',
          'ApiController',
          [],
          '/app/Http/Controllers/ApiController.php',
          'laravel'
        );

        expect(result.entityType).toBe('controller');
        expect(result.matchedRule).toContain('name suffix: Controller');
      });

      it('should classify Laravel model by base class', () => {
        const result = classifier.classify(
          'class',
          'User',
          ['Model'],
          '/app/Models/User.php',
          'laravel'
        );

        expect(result.entityType).toBe('model');
        expect(result.baseClass).toBe('Model');
      });

      it('should classify by directory when no other rules match', () => {
        const result = classifier.classify(
          'class',
          'CustomEntity',
          [],
          '/app/Models/CustomEntity.php',
          'laravel'
        );

        expect(result.entityType).toBe('model');
        expect(result.matchedRule).toContain('directory');
      });

      it('should prefer higher priority rules', () => {
        const result = classifier.classify(
          'class',
          'UserController',
          [],
          '/app/Services/UserController.php',
          'laravel'
        );

        expect(result.entityType).toBe('controller');
        expect(result.matchedRule).toContain('name suffix');
      });
    });

    describe('Vue Classification', () => {
      it('should classify .vue files as components', () => {
        const result = classifier.classify(
          'default',
          'App',
          [],
          '/src/components/App.vue',
          'vue'
        );

        expect(result.entityType).toBe('component');
        expect(result.matchedRule).toContain('file extension');
      });
    });

    describe('React Classification', () => {
      it('should classify React hooks with higher priority than components', () => {
        const result = classifier.classify(
          'function',
          'useAuth',
          [],
          '/src/hooks/useAuth.tsx',
          'react'
        );

        expect(result.entityType).toBe('hook');
        expect(result.matchedRule).toContain('name prefix: ^use[A-Z]');
      });

      it('should classify capitalized functions as components', () => {
        const result = classifier.classify(
          'function',
          'Button',
          [],
          '/src/components/Button.tsx',
          'react'
        );

        expect(result.entityType).toBe('component');
        expect(result.matchedRule).toContain('name prefix: ^[A-Z]');
      });

      it('should not classify React patterns in non-JSX/TSX files', () => {
        const result = classifier.classify(
          'function',
          'Button',
          [],
          '/src/utils/Button.ts', // Not .tsx
          'react'
        );

        expect(result.entityType).toBe('function');
        expect(result.matchedRule).toBe('fallback (no matching rules)');
      });
    });

    describe('Fallback Behavior', () => {
      it('should return symbol type when no rules match', () => {
        const result = classifier.classify(
          'function',
          'helper',
          [],
          '/src/utils/helper.js',
          'laravel'
        );

        expect(result.entityType).toBe('function');
        expect(result.matchedRule).toBe('default (no rules)');
      });

      it('should return default when framework has no rules for symbol type', () => {
        const result = classifier.classify(
          'interface',
          'IUser',
          [],
          '/src/types/IUser.ts',
          'laravel'
        );

        expect(result.entityType).toBe('interface');
        expect(result.matchedRule).toContain('default (no rules)');
      });

      it('should handle undefined framework gracefully', () => {
        const result = classifier.classify(
          'class',
          'MyClass',
          [],
          '/src/MyClass.php'
        );

        expect(result.entityType).toBe('class');
        expect(result.matchedRule).toContain('default (no rules)');
      });
    });
  });

  describe('Framework Detection', () => {
    let classifier: EntityTypeClassifier;

    beforeEach(() => {
      const mockRules = {
        vue: { default: {} },
        laravel: { class: {} },
        react: { function: {} },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['rules.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockRules) as any);

      classifier = new EntityTypeClassifier(mockConfigPath);
    });

    it('should detect Vue by .vue extension', () => {
      const result = classifier.classify(
        'default',
        'App',
        [],
        '/src/App.vue'
      );

      expect(result.framework).toBe('vue');
    });

    it('should detect Laravel by Illuminate namespace', () => {
      const result = classifier.classify(
        'class',
        'UserController',
        ['Illuminate\\Routing\\Controller'],
        '/app/Http/Controllers/UserController.php',
        undefined,
        'App\\Http\\Controllers'
      );

      expect(result.framework).toBe('laravel');
    });

    it('should return undefined for PHP without Laravel namespace', () => {
      const result = classifier.classify(
        'class',
        'MyClass',
        [],
        '/src/MyClass.php'
      );

      expect(result.framework).toBeUndefined();
    });

    it('should detect React from repo frameworks for .tsx files', () => {
      const result = classifier.classify(
        'function',
        'Button',
        [],
        '/src/Button.tsx',
        undefined,
        undefined,
        ['react']
      );

      expect(result.framework).toBe('react');
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['test.json'] as any);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ test: { default: {} } }));

      const instance1 = EntityTypeClassifier.getInstance();
      const instance2 = EntityTypeClassifier.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Rule Reloading', () => {
    it('should reload rules when requested', () => {
      const mockLaravelRules = { laravel: { class: {} } };
      const mockVueRules = { vue: { default: {} } };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as any);

      // First load - only Laravel
      mockFs.readdirSync.mockReturnValueOnce(['laravel.json'] as any);
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify(mockLaravelRules) as any);

      const classifier = new EntityTypeClassifier(mockConfigPath);
      expect(classifier.getSupportedFrameworks()).toHaveLength(1);
      expect(classifier.getSupportedFrameworks()).toContain('laravel');

      // Reload with additional framework (Laravel + Vue)
      mockFs.readdirSync.mockReturnValueOnce(['laravel.json', 'vue.json'] as any);
      mockFs.readFileSync.mockImplementation((filePath: any) => {
        if (filePath.includes('laravel.json')) return JSON.stringify(mockLaravelRules) as any;
        if (filePath.includes('vue.json')) return JSON.stringify(mockVueRules) as any;
        return JSON.stringify({ default: { default: {} } }) as any;
      });

      classifier.reloadRules(mockConfigPath);
      expect(classifier.getSupportedFrameworks()).toHaveLength(2);
      expect(classifier.getSupportedFrameworks()).toContain('laravel');
      expect(classifier.getSupportedFrameworks()).toContain('vue');
    });
  });
});
