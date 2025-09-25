import { FrameworkDetector } from '../../src/parsers/framework-detector';
import { jest } from '@jest/globals';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  readdir: jest.fn(),
  access: jest.fn()
}));

// Get mocked fs module after mocking
import * as fs from 'fs/promises';
const mockFs = fs as jest.Mocked<typeof fs>;

describe('FrameworkDetector', () => {
  let detector: FrameworkDetector;

  beforeEach(() => {
    detector = new FrameworkDetector();
    jest.clearAllMocks();
  });

  describe('Vue.js detection', () => {
    it('should detect Vue.js project based on dependencies', async () => {
      const mockPackageJson = {
        dependencies: {
          'vue': '^3.0.0',
          'vue-router': '^4.0.0'
        },
        devDependencies: {
          '@vue/cli-service': '^5.0.0'
        }
      };

      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('package.json')) {
          return JSON.stringify(mockPackageJson) as any;
        }
        throw new Error('File not found');
      });

      mockFs.access.mockImplementation(async (filePath: string) => {
        if (filePath.includes('vue.config.js')) {
          return Promise.resolve();
        }
        throw new Error('File not found');
      });

      mockFs.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath.includes('src')) {
          return [
            { name: 'components', isDirectory: () => true } as any,
            { name: 'App.vue', isDirectory: () => false } as any
          ];
        }
        return [
          { name: 'src', isDirectory: () => true } as any,
          { name: 'public', isDirectory: () => true } as any
        ];
      });

      const result = await detector.detectFrameworks('/mock/project');

      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0].name).toBe('vue');
      expect(result.frameworks[0].features).toContain('vue-router');
    });

    it('should detect Vue SFC files', async () => {
      const mockPackageJson = {
        dependencies: { vue: '^3.0.0' }
      };

      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('package.json')) {
          return JSON.stringify(mockPackageJson);
        }
        if (filePath.includes('.vue')) {
          return '<template><div>Hello</div></template>' as any;
        }
        throw new Error('File not found');
      });

      mockFs.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath.includes('src')) {
          return [
            { name: 'App.vue', isDirectory: () => false, isFile: () => true } as any
          ];
        }
        return [{ name: 'src', isDirectory: () => true, isFile: () => false } as any];
      });

      const result = await detector.detectFrameworks('/mock/project');

      expect(result.frameworks[0].features).toContain('sfc');
    });
  });

  describe('Next.js detection', () => {
    it('should detect Next.js project with app router', async () => {
      const mockPackageJson = {
        dependencies: {
          'next': '^13.0.0',
          'react': '^18.0.0',
          'react-dom': '^18.0.0'
        }
      };

      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('package.json')) {
          return JSON.stringify(mockPackageJson) as any;
        }
        throw new Error('File not found');
      });

      mockFs.access.mockImplementation(async (filePath: string) => {
        if (filePath.includes('next.config.js')) {
          return Promise.resolve();
        }
        throw new Error('File not found');
      });

      mockFs.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath === '/mock/project') {
          return [
            { name: 'app', isDirectory: () => true } as any,
            { name: 'public', isDirectory: () => true } as any
          ];
        }
        return [];
      });

      const result = await detector.detectFrameworks('/mock/project');

      expect(result.frameworks).toHaveLength(2); // Next.js and React
      const nextjs = result.frameworks.find(f => f.name === 'nextjs');
      expect(nextjs).toBeDefined();
      expect(nextjs!.features).toContain('app-router');
    });

    it('should detect Next.js project with pages router', async () => {
      const mockPackageJson = {
        dependencies: {
          'next': '^12.0.0',
          'react': '^17.0.0',
          'react-dom': '^17.0.0'
        }
      };

      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('package.json')) {
          return JSON.stringify(mockPackageJson) as any;
        }
        throw new Error('File not found');
      });

      mockFs.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath === '/mock/project') {
          return [
            { name: 'pages', isDirectory: () => true } as any,
            { name: 'public', isDirectory: () => true } as any
          ];
        }
        if (dirPath.includes('pages')) {
          return [
            { name: 'api', isDirectory: () => true } as any,
            { name: 'index.js', isDirectory: () => false } as any
          ];
        }
        return [];
      });

      const result = await detector.detectFrameworks('/mock/project');

      const nextjs = result.frameworks.find(f => f.name === 'nextjs');
      expect(nextjs!.features).toContain('pages-router');
      expect(nextjs!.features).toContain('api-routes');
    });
  });

  describe('React detection', () => {
    it('should detect React project', async () => {
      const mockPackageJson = {
        dependencies: {
          'react': '^18.0.0',
          'react-dom': '^18.0.0'
        },
        devDependencies: {
          '@types/react': '^18.0.0',
          'typescript': '^4.9.0'
        }
      };

      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('package.json')) {
          return JSON.stringify(mockPackageJson);
        }
        if (filePath.includes('.jsx') || filePath.includes('.tsx')) {
          return 'const MyComponent = () => { const [state, setState] = useState(0); return <div>Hello</div>; };' as any;
        }
        throw new Error('File not found');
      });

      mockFs.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath.includes('components')) {
          return [
            { name: 'MyComponent.tsx', isDirectory: () => false, isFile: () => true } as any
          ];
        }
        return [
          { name: 'src', isDirectory: () => true, isFile: () => false } as any,
          { name: 'components', isDirectory: () => true, isFile: () => false } as any
        ];
      });

      const result = await detector.detectFrameworks('/mock/project');

      const react = result.frameworks.find(f => f.name === 'react');
      expect(react).toBeDefined();
      expect(react!.features).toContain('tsx');
      expect(react!.features).toContain('hooks');
    });
  });

  describe('Node.js detection', () => {
    it('should detect Express.js project', async () => {
      const mockPackageJson = {
        dependencies: {
          'express': '^4.18.0'
        },
        devDependencies: {
          '@types/express': '^4.17.0',
          'nodemon': '^2.0.0'
        }
      };

      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('package.json')) {
          return JSON.stringify(mockPackageJson);
        }
        // Be more specific about the expected file paths
        if (filePath.endsWith('app.js') || filePath.includes('/routes/')) {
          return 'app.get("/api/users", (req, res, next) => { res.json(users); });' as any;
        }
        throw new Error('File not found');
      });

      mockFs.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath === '/mock/project') {
          return [
            { name: 'routes', isDirectory: () => true, isFile: () => false } as any,
            { name: 'app.js', isDirectory: () => false, isFile: () => true } as any
          ];
        }
        if (dirPath === '/mock/project/routes') {
          return [
            { name: 'users.js', isDirectory: () => false, isFile: () => true } as any
          ];
        }
        return [];
      });

      const result = await detector.detectFrameworks('/mock/project');

      const nodejs = result.frameworks.find(f => f.name === 'nodejs');
      expect(nodejs).toBeDefined();
      expect(nodejs!.features).toContain('express-routes');
      expect(nodejs!.features).toContain('rest-api');
      expect(nodejs!.features).toContain('middleware');
    });
  });

  describe('Multiple framework detection', () => {
    it('should detect multiple frameworks in a project', async () => {
      const mockPackageJson = {
        dependencies: {
          'next': '^13.0.0',
          'react': '^18.0.0',
          'react-dom': '^18.0.0',
          'express': '^4.18.0'
        }
      };

      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('package.json')) {
          return JSON.stringify(mockPackageJson) as any;
        }
        throw new Error('File not found');
      });

      mockFs.readdir.mockImplementation(async () => [
        { name: 'app', isDirectory: () => true } as any,
        { name: 'api', isDirectory: () => true } as any,
        { name: 'server', isDirectory: () => true } as any
      ]);

      const result = await detector.detectFrameworks('/mock/project');

      expect(result.frameworks.length).toBeGreaterThan(1);
      expect(result.frameworks.map(f => f.name)).toContain('nextjs');
      expect(result.frameworks.map(f => f.name)).toContain('react');
      expect(result.frameworks.map(f => f.name)).toContain('nodejs');
    });
  });

  describe('getApplicableFrameworks', () => {
    it('should return applicable frameworks for Vue file', () => {
      const detectionResult = {
        frameworks: [
          { name: 'vue', version: '3.0.0', evidence: [], features: [] }
        ],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      };

      const frameworks = detector.getApplicableFrameworks('/src/App.vue', detectionResult);

      expect(frameworks).toContain('javascript');
      expect(frameworks).toContain('vue');
    });

    it('should return applicable frameworks for Next.js API route', () => {
      const detectionResult = {
        frameworks: [
          { name: 'nextjs', version: '13.0.0', evidence: [], features: [] }
        ],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      };

      const frameworks = detector.getApplicableFrameworks('/pages/api/users.js', detectionResult);

      expect(frameworks).toContain('javascript');
      expect(frameworks).toContain('nextjs');
    });

    it('should return applicable frameworks for React component', () => {
      const detectionResult = {
        frameworks: [
          { name: 'react', version: '18.0.0', evidence: [], features: [] }
        ],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      };

      const frameworks = detector.getApplicableFrameworks('/src/components/Button.tsx', detectionResult);

      expect(frameworks).toContain('typescript');
      expect(frameworks).toContain('react');
    });

    it('should only include detected frameworks', () => {
      const detectionResult = {
        frameworks: [
          { name: 'react', version: '18.0.0', evidence: [], features: [] }
          // Vue not detected/included
        ],
        metadata: { hasPackageJson: true, hasComposerJson: false, hasConfigFiles: true, directoryStructure: [] }
      };

      const frameworks = detector.getApplicableFrameworks('/src/Component.jsx', detectionResult);

      expect(frameworks).not.toContain('vue');
      expect(frameworks).toContain('react');
    });
  });

  describe('error handling', () => {
    it('should handle missing package.json gracefully', async () => {
      mockFs.readFile.mockRejectedValue(new Error('File not found'));
      mockFs.readdir.mockResolvedValue([]);
      mockFs.access.mockRejectedValue(new Error('File not found')); // Mock access to prevent config file detection

      const result = await detector.detectFrameworks('/mock/project');

      expect(result.frameworks).toHaveLength(0);
      expect(result.metadata.hasPackageJson).toBe(false);
    });

    it('should handle filesystem errors gracefully', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Permission denied'));
      mockFs.readdir.mockRejectedValue(new Error('Permission denied'));
      mockFs.access.mockRejectedValue(new Error('Permission denied'));

      const result = await detector.detectFrameworks('/mock/project');

      expect(result.frameworks).toHaveLength(0);
    });
  });
});