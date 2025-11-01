import { FrameworkPattern } from './types';

/**
 * Framework detection patterns for various frameworks and libraries
 */
export const FRAMEWORK_PATTERNS: FrameworkPattern[] = [
  // Vue.js
  {
    name: 'vue',
    patterns: {
      dependencies: ['vue', '@vue/core'],
      devDependencies: ['@vue/cli-service', 'vite', '@vitejs/plugin-vue'],
      files: ['vue.config.js', 'vite.config.js', 'nuxt.config.js'],
      directories: ['src/components', 'src/views', 'pages', 'components'],
      configs: ['vue.config.js', 'vite.config.js'],
      features: ['sfc', 'composition-api', 'vue-router', 'pinia', 'vuex'],
    },
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
      features: ['pages-router', 'app-router', 'api-routes', 'middleware', 'ssr'],
    },
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
      features: ['hooks', 'jsx', 'tsx', 'context'],
    },
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
      features: ['express-routes', 'middleware', 'rest-api'],
    },
  },

  // Test Frameworks
  {
    name: 'test-framework',
    patterns: {
      dependencies: [
        'jest',
        'vitest',
        'cypress',
        'playwright',
        'mocha',
        'jasmine',
        '@testing-library/react',
      ],
      devDependencies: [
        'jest',
        'vitest',
        'cypress',
        'playwright',
        'mocha',
        'jasmine',
        '@types/jest',
      ],
      files: ['jest.config.js', 'vitest.config.js', 'cypress.json', 'playwright.config.js'],
      directories: ['tests', 'test', '__tests__', 'cypress', 'e2e'],
      configs: ['jest.config.js', 'vitest.config.js', 'cypress.json', 'playwright.config.js'],
      features: ['unit-tests', 'integration-tests', 'e2e-tests', 'test-coverage'],
    },
  },

  // Package Managers
  {
    name: 'package-manager',
    patterns: {
      dependencies: [],
      devDependencies: [],
      files: [
        'package.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'bun.lockb',
        'lerna.json',
        'nx.json',
        'turbo.json',
      ],
      directories: ['packages', 'apps', 'libs', 'workspace'],
      configs: ['lerna.json', 'nx.json', 'turbo.json', 'pnpm-workspace.yaml'],
      features: ['workspaces', 'monorepo', 'package-management'],
    },
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
      features: ['job-queues', 'worker-threads', 'job-scheduling', 'background-processing'],
    },
  },

  // ORM Systems
  {
    name: 'orm',
    patterns: {
      dependencies: [
        'prisma',
        'typeorm',
        'sequelize',
        'mongoose',
        'objection',
        'mikro-orm',
        'bookshelf',
      ],
      devDependencies: ['@types/sequelize', '@types/mongoose', 'prisma'],
      files: ['schema.prisma', 'ormconfig.json', 'mikro-orm.config.js'],
      directories: ['models', 'entities', 'schemas', 'prisma', 'migrations'],
      configs: ['ormconfig.json', 'mikro-orm.config.js', 'sequelize.config.js'],
      features: ['database-models', 'migrations', 'relationships', 'orm-mapping'],
    },
  },

  // Laravel Framework
  {
    name: 'laravel',
    patterns: {
      dependencies: ['laravel/framework', 'illuminate/support', 'illuminate/database'],
      devDependencies: ['phpunit/phpunit', 'mockery/mockery', 'laravel/pint', 'laravel/sail'],
      files: ['artisan', 'composer.json', '.env.example', 'server.php'],
      directories: [
        'app',
        'routes',
        'config',
        'database',
        'resources',
        'storage',
        'public',
        'bootstrap',
      ],
      configs: [
        'config/app.php',
        'config/database.php',
        'config/services.php',
        'config/auth.php',
        'routes/web.php',
        'routes/api.php',
      ],
      features: [
        'eloquent-orm',
        'blade-templates',
        'artisan-commands',
        'middleware',
        'service-providers',
        'route-model-binding',
        'dependency-injection',
      ],
    },
  },

  // Godot Game Engine
  {
    name: 'godot',
    patterns: {
      dependencies: [],
      devDependencies: [],
      files: ['project.godot', 'export_presets.cfg', 'addons/'],
      directories: ['scenes', 'scripts', 'assets', 'addons', 'autoload'],
      configs: ['project.godot', 'export_presets.cfg'],
      features: [
        'godot-scenes',
        'csharp-scripts',
        'gdscript',
        'nodes',
        'signals',
        'autoload',
        'scene-tree',
      ],
    },
  },
];
