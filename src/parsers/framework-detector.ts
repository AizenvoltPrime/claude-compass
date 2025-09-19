import * as fs from 'fs/promises';
import * as path from 'path';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('framework-detector');

/**
 * Framework detection result
 */
export interface FrameworkDetectionResult {
  frameworks: DetectedFramework[];
  confidence: number;
  metadata: {
    hasPackageJson: boolean;
    hasComposerJson: boolean;
    hasConfigFiles: boolean;
    directoryStructure: string[];
  };
}

/**
 * Individual framework detection
 */
export interface DetectedFramework {
  name: string;
  version?: string;
  confidence: number;
  evidence: FrameworkEvidence[];
  features: string[];
}

/**
 * Evidence for framework presence
 */
export interface FrameworkEvidence {
  type: 'dependency' | 'devDependency' | 'config' | 'directory' | 'file';
  source: string;
  value: string;
  confidence: number;
}

/**
 * Framework detection pattern
 */
interface FrameworkPattern {
  name: string;
  patterns: {
    dependencies?: string[];
    devDependencies?: string[];
    files?: string[];
    directories?: string[];
    configs?: string[];
    features?: string[];
  };
  baseConfidence: number;
}

/**
 * Service for detecting frameworks in a project
 */
export class FrameworkDetector {
  private patterns: FrameworkPattern[] = [
    // Vue.js
    {
      name: 'vue',
      patterns: {
        dependencies: ['vue', '@vue/core'],
        devDependencies: ['@vue/cli-service', 'vite', '@vitejs/plugin-vue'],
        files: ['vue.config.js', 'vite.config.js', 'nuxt.config.js'],
        directories: ['src/components', 'src/views', 'pages', 'components'],
        configs: ['vue.config.js', 'vite.config.js'],
        features: ['sfc', 'composition-api', 'vue-router', 'pinia', 'vuex']
      },
      baseConfidence: 0.8
    },

    // Next.js
    {
      name: 'nextjs',
      patterns: {
        dependencies: ['next', 'react', 'react-dom'],
        devDependencies: ['@types/react', '@types/react-dom'],
        files: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
        directories: ['pages', 'app', 'src/pages', 'src/app', 'public'],
        configs: ['next.config.js', 'next.config.mjs'],
        features: ['pages-router', 'app-router', 'api-routes', 'middleware', 'ssr']
      },
      baseConfidence: 0.9
    },

    // React
    {
      name: 'react',
      patterns: {
        dependencies: ['react', 'react-dom', 'react-native'],
        devDependencies: ['@types/react', '@types/react-dom', 'react-scripts'],
        files: ['package.json'],
        directories: ['src/components', 'components'],
        configs: ['craco.config.js', 'react-app-env.d.ts'],
        features: ['hooks', 'jsx', 'tsx', 'context']
      },
      baseConfidence: 0.7
    },

    // Node.js/Express
    {
      name: 'nodejs',
      patterns: {
        dependencies: ['express', 'fastify', 'koa', 'hapi'],
        devDependencies: ['@types/express', '@types/node', 'nodemon'],
        files: ['server.js', 'app.js', 'index.js'],
        directories: ['routes', 'api', 'controllers', 'middleware'],
        configs: ['nodemon.json', 'pm2.config.js'],
        features: ['express-routes', 'middleware', 'rest-api']
      },
      baseConfidence: 0.6
    },

    // Test Frameworks
    {
      name: 'test-framework',
      patterns: {
        dependencies: ['jest', 'vitest', 'cypress', 'playwright', 'mocha', 'jasmine', '@testing-library/react'],
        devDependencies: ['jest', 'vitest', 'cypress', 'playwright', 'mocha', 'jasmine', '@types/jest'],
        files: ['jest.config.js', 'vitest.config.js', 'cypress.json', 'playwright.config.js'],
        directories: ['tests', 'test', '__tests__', 'cypress', 'e2e'],
        configs: ['jest.config.js', 'vitest.config.js', 'cypress.json', 'playwright.config.js'],
        features: ['unit-tests', 'integration-tests', 'e2e-tests', 'test-coverage']
      },
      baseConfidence: 0.7
    },

    // Package Managers
    {
      name: 'package-manager',
      patterns: {
        dependencies: [],
        devDependencies: [],
        files: ['package.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'lerna.json', 'nx.json', 'turbo.json'],
        directories: ['packages', 'apps', 'libs', 'workspace'],
        configs: ['lerna.json', 'nx.json', 'turbo.json', 'pnpm-workspace.yaml'],
        features: ['workspaces', 'monorepo', 'package-management']
      },
      baseConfidence: 0.9
    },

    // Background Job Systems
    {
      name: 'background-job',
      patterns: {
        dependencies: ['bull', 'bullmq', 'agenda', 'bee-queue', 'kue', 'rsmq'],
        devDependencies: ['@types/bull', '@types/agenda'],
        files: ['worker.js', 'jobs.js', 'queue.js'],
        directories: ['jobs', 'workers', 'queues', 'background'],
        configs: ['bull.config.js', 'agenda.config.js'],
        features: ['job-queues', 'worker-threads', 'job-scheduling', 'background-processing']
      },
      baseConfidence: 0.8
    },

    // ORM Systems
    {
      name: 'orm',
      patterns: {
        dependencies: ['prisma', 'typeorm', 'sequelize', 'mongoose', 'objection', 'mikro-orm', 'bookshelf'],
        devDependencies: ['@types/sequelize', '@types/mongoose', 'prisma'],
        files: ['schema.prisma', 'ormconfig.json', 'mikro-orm.config.js'],
        directories: ['models', 'entities', 'schemas', 'prisma', 'migrations'],
        configs: ['ormconfig.json', 'mikro-orm.config.js', 'sequelize.config.js'],
        features: ['database-models', 'migrations', 'relationships', 'orm-mapping']
      },
      baseConfidence: 0.8
    },

    // Laravel Framework
    {
      name: 'laravel',
      patterns: {
        dependencies: ['laravel/framework', 'illuminate/support', 'illuminate/database'],
        devDependencies: ['phpunit/phpunit', 'mockery/mockery', 'laravel/pint', 'laravel/sail'],
        files: ['artisan', 'composer.json', '.env.example', 'server.php'],
        directories: ['app', 'routes', 'config', 'database', 'resources', 'storage', 'public', 'bootstrap'],
        configs: [
          'config/app.php',
          'config/database.php',
          'config/services.php',
          'config/auth.php',
          'routes/web.php',
          'routes/api.php'
        ],
        features: [
          'eloquent-orm',
          'blade-templates',
          'artisan-commands',
          'middleware',
          'service-providers',
          'route-model-binding',
          'dependency-injection'
        ]
      },
      baseConfidence: 0.9
    }
  ];

  /**
   * Detect frameworks in a project directory
   */
  async detectFrameworks(projectPath: string): Promise<FrameworkDetectionResult> {
    logger.debug(`Detecting frameworks in ${projectPath}`);

    try {
      const packageJson = await this.readPackageJson(projectPath);
      const composerJson = await this.readComposerJson(projectPath);
      const configFiles = await this.findConfigFiles(projectPath);
      const directoryStructure = await this.analyzeDirectoryStructure(projectPath);

      const detectedFrameworks: DetectedFramework[] = [];

      for (const pattern of this.patterns) {
        const detection = await this.detectFramework(
          pattern,
          packageJson,
          composerJson,
          configFiles,
          directoryStructure,
          projectPath
        );

        if (detection.confidence > 0.2) {
          detectedFrameworks.push(detection);
        }
      }

      // Sort by confidence
      detectedFrameworks.sort((a, b) => b.confidence - a.confidence);

      const overallConfidence = detectedFrameworks.length > 0
        ? detectedFrameworks.reduce((sum, fw) => sum + fw.confidence, 0) / detectedFrameworks.length
        : 0;

      return {
        frameworks: detectedFrameworks,
        confidence: Math.min(overallConfidence, 1.0),
        metadata: {
          hasPackageJson: packageJson !== null,
          hasComposerJson: composerJson !== null,
          hasConfigFiles: configFiles.length > 0,
          directoryStructure
        }
      };

    } catch (error) {
      logger.error(`Framework detection failed for ${projectPath}`, { error });
      return {
        frameworks: [],
        confidence: 0,
        metadata: {
          hasPackageJson: false,
          hasComposerJson: false,
          hasConfigFiles: false,
          directoryStructure: []
        }
      };
    }
  }

  /**
   * Detect specific framework based on pattern
   */
  private async detectFramework(
    pattern: FrameworkPattern,
    packageJson: any,
    composerJson: any,
    configFiles: string[],
    directoryStructure: string[],
    projectPath: string
  ): Promise<DetectedFramework> {
    const evidence: FrameworkEvidence[] = [];
    let confidence = 0;
    const features: string[] = [];

    // Check dependencies
    if (packageJson && pattern.patterns.dependencies) {
      for (const dep of pattern.patterns.dependencies) {
        if (packageJson.dependencies?.[dep]) {
          evidence.push({
            type: 'dependency',
            source: 'package.json',
            value: `${dep}@${packageJson.dependencies[dep]}`,
            confidence: 0.8
          });
          confidence += 0.8;
        }
      }
    }

    // Check dev dependencies
    if (packageJson && pattern.patterns.devDependencies) {
      for (const dep of pattern.patterns.devDependencies) {
        if (packageJson.devDependencies?.[dep]) {
          evidence.push({
            type: 'devDependency',
            source: 'package.json',
            value: `${dep}@${packageJson.devDependencies[dep]}`,
            confidence: 0.6
          });
          confidence += 0.6;
        }
      }
    }

    // Check composer.json dependencies (PHP projects)
    if (composerJson && pattern.patterns.dependencies) {
      for (const dep of pattern.patterns.dependencies) {
        if (composerJson.require?.[dep]) {
          evidence.push({
            type: 'dependency',
            source: 'composer.json',
            value: `${dep}@${composerJson.require[dep]}`,
            confidence: 0.8
          });
          confidence += 0.8;
        }
      }
    }

    // Check composer.json dev dependencies (PHP projects)
    if (composerJson && pattern.patterns.devDependencies) {
      for (const dep of pattern.patterns.devDependencies) {
        if (composerJson['require-dev']?.[dep]) {
          evidence.push({
            type: 'devDependency',
            source: 'composer.json',
            value: `${dep}@${composerJson['require-dev'][dep]}`,
            confidence: 0.6
          });
          confidence += 0.6;
        }
      }
    }

    // Check config files
    if (pattern.patterns.configs) {
      for (const configFile of pattern.patterns.configs) {
        if (configFiles.includes(configFile)) {
          evidence.push({
            type: 'config',
            source: 'filesystem',
            value: configFile,
            confidence: 0.7
          });
          confidence += 0.7;
        }
      }
    }

    // Check directories
    if (pattern.patterns.directories) {
      for (const dir of pattern.patterns.directories) {
        if (directoryStructure.some(d => d.includes(dir))) {
          evidence.push({
            type: 'directory',
            source: 'filesystem',
            value: dir,
            confidence: 0.4
          });
          confidence += 0.4;
        }
      }
    }

    // Detect framework-specific features
    if (pattern.name === 'vue') {
      features.push(...await this.detectVueFeatures(projectPath, packageJson));
    } else if (pattern.name === 'nextjs') {
      features.push(...await this.detectNextJSFeatures(projectPath, directoryStructure));
    } else if (pattern.name === 'react') {
      features.push(...await this.detectReactFeatures(projectPath, packageJson));
    } else if (pattern.name === 'nodejs') {
      features.push(...await this.detectNodeJSFeatures(projectPath, packageJson));
    }

    // Require at least one strong evidence type (dependency, devDependency, or config)
    // to avoid false positives based purely on directory structure
    const hasStrongEvidence = evidence.some(e =>
      e.type === 'dependency' || e.type === 'devDependency' || e.type === 'config'
    );

    // If no strong evidence, set confidence to 0 to filter out weak detections
    const finalConfidence = hasStrongEvidence
      ? Math.min(confidence * pattern.baseConfidence, 1.0)
      : 0;

    return {
      name: pattern.name,
      version: this.extractFrameworkVersion(pattern.name, packageJson),
      confidence: finalConfidence,
      evidence,
      features
    };
  }

  /**
   * Read and parse package.json
   */
  private async readPackageJson(projectPath: string): Promise<any | null> {
    try {
      const packagePath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packagePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Read and parse composer.json
   */
  private async readComposerJson(projectPath: string): Promise<any | null> {
    try {
      const composerPath = path.join(projectPath, 'composer.json');
      const content = await fs.readFile(composerPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Find configuration files in project
   */
  private async findConfigFiles(projectPath: string): Promise<string[]> {
    const configPatterns = [
      'vue.config.js', 'vite.config.js', 'vite.config.ts',
      'next.config.js', 'next.config.mjs', 'next.config.ts',
      'nuxt.config.js', 'nuxt.config.ts',
      'react-app-env.d.ts', 'craco.config.js',
      'nodemon.json', 'pm2.config.js',
      'tailwind.config.js', 'webpack.config.js'
    ];

    const foundFiles: string[] = [];

    for (const pattern of configPatterns) {
      try {
        const filePath = path.join(projectPath, pattern);
        await fs.access(filePath);
        foundFiles.push(pattern);
      } catch (error) {
        // File doesn't exist, continue
      }
    }

    return foundFiles;
  }

  /**
   * Analyze directory structure
   */
  private async analyzeDirectoryStructure(projectPath: string, maxDepth: number = 3): Promise<string[]> {
    const directories: string[] = [];

    const scanDirectory = async (dirPath: string, currentDepth: number = 0): Promise<void> => {
      if (currentDepth >= maxDepth) return;

      try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
          if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
            const relativePath = path.relative(projectPath, path.join(dirPath, item.name));
            directories.push(relativePath);

            // Recursively scan subdirectories
            await scanDirectory(path.join(dirPath, item.name), currentDepth + 1);
          }
        }
      } catch (error) {
        // Directory not accessible, skip
      }
    };

    await scanDirectory(projectPath);
    return directories;
  }

  /**
   * Detect Vue.js specific features
   */
  private async detectVueFeatures(projectPath: string, packageJson: any): Promise<string[]> {
    const features: string[] = [];

    // Check for Vue Router
    if (packageJson?.dependencies?.['vue-router']) {
      features.push('vue-router');
    }

    // Check for Pinia/Vuex
    if (packageJson?.dependencies?.['pinia']) {
      features.push('pinia');
    }
    if (packageJson?.dependencies?.['vuex']) {
      features.push('vuex');
    }

    // Check for SFCs
    try {
      const hasVueFiles = await this.hasFileExtension(projectPath, '.vue');
      if (hasVueFiles) {
        features.push('sfc');
      }
    } catch (error) {
      // Ignore
    }

    return features;
  }

  /**
   * Detect Next.js specific features
   */
  private async detectNextJSFeatures(projectPath: string, directoryStructure: string[]): Promise<string[]> {
    const features: string[] = [];

    // Check for app router vs pages router
    if (directoryStructure.some(dir => dir === 'app' || dir === 'src/app')) {
      features.push('app-router');
    }
    if (directoryStructure.some(dir => dir === 'pages' || dir === 'src/pages')) {
      features.push('pages-router');
    }

    // Check for API routes
    if (directoryStructure.some(dir => dir.includes('api'))) {
      features.push('api-routes');
    }

    // Check for middleware
    try {
      const middlewarePath = path.join(projectPath, 'middleware.js');
      await fs.access(middlewarePath);
      features.push('middleware');
    } catch (error) {
      try {
        const middlewarePath = path.join(projectPath, 'middleware.ts');
        await fs.access(middlewarePath);
        features.push('middleware');
      } catch (error) {
        // No middleware
      }
    }

    return features;
  }

  /**
   * Detect React specific features
   */
  private async detectReactFeatures(projectPath: string, packageJson: any): Promise<string[]> {
    const features: string[] = [];

    // Check for TypeScript - TypeScript React projects support both JSX and TSX
    if (packageJson?.devDependencies?.['typescript']) {
      features.push('tsx');
      features.push('jsx'); // TypeScript projects can also use JSX files
    } else {
      features.push('jsx');
    }

    // Check for common React patterns
    try {
      const hasHooks = await this.hasCodePattern(projectPath, /use[A-Z]/);
      if (hasHooks) {
        features.push('hooks');
      }

      const hasContext = await this.hasCodePattern(projectPath, /createContext|useContext/);
      if (hasContext) {
        features.push('context');
      }
    } catch (error) {
      // Ignore
    }

    return features;
  }

  /**
   * Detect Node.js specific features
   */
  private async detectNodeJSFeatures(projectPath: string, packageJson: any): Promise<string[]> {
    const features: string[] = [];

    // Check for Express
    if (packageJson?.dependencies?.['express']) {
      features.push('express-routes');
    }

    // Check for API patterns
    try {
      const hasRoutes = await this.hasCodePattern(projectPath, /router\.|app\.(get|post|put|delete)/);
      if (hasRoutes) {
        features.push('rest-api');
      }

      const hasMiddleware = await this.hasCodePattern(projectPath, /\(req,\s*res,\s*next\)/);
      if (hasMiddleware) {
        features.push('middleware');
      }
    } catch (error) {
      // Ignore
    }

    return features;
  }

  /**
   * Check if project has files with specific extension
   */
  private async hasFileExtension(projectPath: string, extension: string): Promise<boolean> {
    const checkDirectory = async (dirPath: string, depth: number = 0): Promise<boolean> => {
      if (depth > 3) return false;

      try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
          if (item.isFile() && item.name.endsWith(extension)) {
            return true;
          }

          if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
            const found = await checkDirectory(path.join(dirPath, item.name), depth + 1);
            if (found) return true;
          }
        }
      } catch (error) {
        // Directory not accessible
      }

      return false;
    };

    return checkDirectory(projectPath);
  }

  /**
   * Check if project contains specific code patterns
   */
  private async hasCodePattern(projectPath: string, pattern: RegExp): Promise<boolean> {
    const checkDirectory = async (dirPath: string, depth: number = 0): Promise<boolean> => {
      if (depth > 2) return false;

      try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
          if (item.isFile() && /\.(js|ts|jsx|tsx)$/.test(item.name)) {
            try {
              const content = await fs.readFile(path.join(dirPath, item.name), 'utf-8');
              if (pattern.test(content)) {
                return true;
              }
            } catch (error) {
              // File read error, continue
            }
          }

          if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
            const found = await checkDirectory(path.join(dirPath, item.name), depth + 1);
            if (found) return true;
          }
        }
      } catch (error) {
        // Directory not accessible
      }

      return false;
    };

    return checkDirectory(projectPath);
  }

  /**
   * Extract framework version from package.json
   */
  private extractFrameworkVersion(frameworkName: string, packageJson: any): string | undefined {
    if (!packageJson) return undefined;

    const dependencyMappings: Record<string, string> = {
      'vue': 'vue',
      'nextjs': 'next',
      'react': 'react',
      'nodejs': 'express'
    };

    const packageName = dependencyMappings[frameworkName];
    if (!packageName) return undefined;

    const version = packageJson.dependencies?.[packageName] ||
                   packageJson.devDependencies?.[packageName];

    if (version) {
      // Clean version string (remove ^, ~, etc.)
      return version.replace(/^[\^~]/, '');
    }

    return undefined;
  }

  /**
   * Get frameworks that should be used for parsing a specific file
   */
  getApplicableFrameworks(filePath: string, detectionResult: FrameworkDetectionResult): string[] {
    const ext = path.extname(filePath);
    const frameworks: string[] = [];

    // Always include base language parsing
    if (['.js', '.jsx'].includes(ext)) {
      frameworks.push('javascript');
    } else if (['.ts', '.tsx'].includes(ext)) {
      frameworks.push('typescript');
    } else if (ext === '.vue') {
      // Vue SFCs contain JavaScript/TypeScript that needs base language parsing
      frameworks.push('javascript');
    } else if (['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'].includes(ext)) {
      // PHP files need base PHP parsing
      frameworks.push('php');
    }

    // Add framework-specific parsers based on detection and file type
    for (const framework of detectionResult.frameworks) {
      if (framework.confidence < 0.3) continue;

      switch (framework.name) {
        case 'vue':
          if (ext === '.vue' ||
              (ext === '.js' || ext === '.ts') &&
              (filePath.includes('/composables/') || filePath.includes('/stores/'))) {
            frameworks.push('vue');
          }
          break;

        case 'nextjs':
          if ((ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx') &&
              (filePath.includes('/pages/') || filePath.includes('/app/') ||
               filePath.includes('/api/'))) {
            frameworks.push('nextjs');
          }
          break;

        case 'react':
          if ((ext === '.jsx' || ext === '.tsx') ||
              (ext === '.js' || ext === '.ts') &&
              (filePath.includes('/components/') || filePath.includes('/hooks/'))) {
            frameworks.push('react');
          }
          break;

        case 'nodejs':
          if ((ext === '.js' || ext === '.ts') &&
              (filePath.includes('/routes/') || filePath.includes('/api/') ||
               filePath.includes('/controllers/') || filePath.includes('/middleware/'))) {
            frameworks.push('nodejs');
          }
          break;

        case 'test-framework':
          const fileName = path.basename(filePath);
          const relativeToProject = this.getProjectRelativePath(filePath, detectionResult);

          // Check filename patterns for test files
          const hasTestFilename = fileName.includes('.test.') || fileName.includes('.spec.') || fileName.includes('.e2e.');

          // Check if file is in a test directory relative to the project root (not absolute path)
          const isInTestDirectory = relativeToProject.includes('/tests/') || relativeToProject.includes('/test/') ||
                                   relativeToProject.includes('/__tests__/') || relativeToProject.includes('/cypress/') ||
                                   relativeToProject.includes('/e2e/');

          if (hasTestFilename || isInTestDirectory) {
            frameworks.push('test-framework');
          }
          break;

        case 'package-manager':
          if (path.basename(filePath) === 'package.json' ||
              filePath.includes('lerna.json') || filePath.includes('nx.json') || filePath.includes('turbo.json') ||
              filePath.includes('pnpm-workspace.yaml')) {
            frameworks.push('package-manager');
          }
          break;

        case 'background-job':
          if ((ext === '.js' || ext === '.ts') &&
              (filePath.includes('worker') || filePath.includes('job') || filePath.includes('queue') ||
               filePath.includes('/workers/') || filePath.includes('/jobs/') || filePath.includes('/queues/'))) {
            frameworks.push('background-job');
          }
          break;

        case 'orm':
          if (ext === '.prisma' ||
              filePath.includes('.model.') || filePath.includes('.entity.') || filePath.includes('.schema.') ||
              filePath.includes('/models/') || filePath.includes('/entities/') || filePath.includes('/schemas/') ||
              filePath.includes('/prisma/') || filePath.includes('ormconfig.json')) {
            frameworks.push('orm');
          }
          break;

        case 'laravel':
          if (ext === '.php') {
            let isLaravelFile = false;

            // Controller files
            if (filePath.includes('/app/Http/Controllers/') ||
                path.basename(filePath).endsWith('Controller.php')) {
              isLaravelFile = true;
            }
            // Model files
            if (filePath.includes('/app/Models/') ||
                (filePath.includes('/app/') && this.hasLaravelModelPattern(filePath))) {
              isLaravelFile = true;
            }
            // Route files
            if (filePath.includes('/routes/') &&
                (path.basename(filePath) === 'web.php' ||
                 path.basename(filePath) === 'api.php' ||
                 path.basename(filePath) === 'console.php')) {
              isLaravelFile = true;
            }
            // Middleware files
            if (filePath.includes('/app/Http/Middleware/') ||
                path.basename(filePath).endsWith('Middleware.php')) {
              isLaravelFile = true;
            }
            // Service provider files
            if (filePath.includes('/app/Providers/') ||
                path.basename(filePath).endsWith('ServiceProvider.php')) {
              isLaravelFile = true;
            }
            // Migration files
            if (filePath.includes('/database/migrations/')) {
              isLaravelFile = true;
            }
            // Seeder files
            if (filePath.includes('/database/seeders/') ||
                path.basename(filePath).endsWith('Seeder.php')) {
              isLaravelFile = true;
            }
            // Artisan command files
            if (filePath.includes('/app/Console/Commands/') ||
                path.basename(filePath).endsWith('Command.php')) {
              isLaravelFile = true;
            }

            // Job files
            if (filePath.includes('/app/Jobs/') ||
                path.basename(filePath).endsWith('Job.php')) {
              isLaravelFile = true;
            }

            if (isLaravelFile) {
              // Laravel parser handles base PHP parsing internally, so remove base 'php' parser
              const phpIndex = frameworks.indexOf('php');
              if (phpIndex !== -1) {
                frameworks.splice(phpIndex, 1);
              }
              frameworks.push('laravel');
            }
          }
          break;
      }
    }

    return frameworks;
  }

  /**
   * Check if a file path likely contains a Laravel model based on file patterns
   */
  private hasLaravelModelPattern(filePath: string): boolean {
    // This is a simplified check that can be enhanced with actual file content analysis
    // For now, check if it's in app/ directory and ends with .php (suggesting it might be a model)
    return filePath.includes('/app/') && !filePath.includes('Controller') &&
           !filePath.includes('Middleware') && !filePath.includes('Provider') &&
           !filePath.includes('Job') && !filePath.includes('Command');
  }

  /**
   * Get the path relative to the detected project root to avoid false positives
   * when files are in test fixture directories
   */
  private getProjectRelativePath(filePath: string, detectionResult: FrameworkDetectionResult): string {
    // Try to find the project root by looking for key files that indicate a project boundary
    let projectRoot = filePath;
    let currentDir = path.dirname(filePath);

    // Walk up the directory tree to find project markers
    while (currentDir !== path.dirname(currentDir)) { // Stop at filesystem root
      // Check for common project markers
      const markers = ['package.json', 'composer.json', '.git', 'artisan', 'next.config.js', 'vue.config.js'];
      let foundMarker = false;

      for (const marker of markers) {
        const markerPath = path.join(currentDir, marker);
        try {
          // We can't use async fs.access here, so we'll do our best to infer from the directory structure
          if (detectionResult.metadata.hasPackageJson && marker === 'package.json') {
            projectRoot = currentDir;
            foundMarker = true;
            break;
          }
          if (detectionResult.metadata.hasComposerJson && marker === 'composer.json') {
            projectRoot = currentDir;
            foundMarker = true;
            break;
          }
        } catch (error) {
          // Continue searching
        }
      }

      if (foundMarker) {
        break;
      }

      currentDir = path.dirname(currentDir);
    }

    // Return the relative path from the project root
    const relativePath = path.relative(projectRoot, filePath);
    return relativePath.replace(/\\/g, '/'); // Normalize to forward slashes
  }
}