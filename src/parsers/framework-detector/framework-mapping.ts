import * as path from 'path';
import { FrameworkDetectionResult } from './types';
import { hasLaravelModelPattern, getProjectRelativePath } from './helper-utils';

/**
 * Get frameworks that should be used for parsing a specific file
 */
export function getApplicableFrameworks(
  filePath: string,
  detectionResult: FrameworkDetectionResult
): string[] {
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
  } else if (ext === '.cs') {
    // C# files need base C# parsing (will be replaced by Godot parser if detected)
    frameworks.push('csharp');
  }

  // Add framework-specific parsers based on detection and file type
  for (const framework of detectionResult.frameworks) {
    switch (framework.name) {
      case 'vue':
        if (
          ext === '.vue' ||
          ((ext === '.js' || ext === '.ts') &&
            (filePath.includes('/composables/') || filePath.includes('/stores/')))
        ) {
          frameworks.push('vue');
        }
        break;

      case 'nextjs':
        if (
          (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx') &&
          (filePath.includes('/pages/') ||
            filePath.includes('/app/') ||
            filePath.includes('/api/'))
        ) {
          frameworks.push('nextjs');
        }
        break;

      case 'react':
        if (
          ext === '.jsx' ||
          ext === '.tsx' ||
          ((ext === '.js' || ext === '.ts') &&
            (filePath.includes('/components/') || filePath.includes('/hooks/')))
        ) {
          frameworks.push('react');
        }
        break;

      case 'nodejs':
        if (
          (ext === '.js' || ext === '.ts') &&
          (filePath.includes('/routes/') ||
            filePath.includes('/api/') ||
            filePath.includes('/controllers/') ||
            filePath.includes('/middleware/'))
        ) {
          frameworks.push('nodejs');
        }
        break;

      case 'test-framework':
        const fileName = path.basename(filePath);
        const relativeToProject = getProjectRelativePath(filePath, detectionResult);

        // Check filename patterns for test files
        const hasTestFilename =
          fileName.includes('.test.') ||
          fileName.includes('.spec.') ||
          fileName.includes('.e2e.');

        // Check if file is in a test directory relative to the project root (not absolute path)
        const isInTestDirectory =
          relativeToProject.includes('/tests/') ||
          relativeToProject.includes('/test/') ||
          relativeToProject.includes('/__tests__/') ||
          relativeToProject.includes('/cypress/') ||
          relativeToProject.includes('/e2e/');

        if (hasTestFilename || isInTestDirectory) {
          frameworks.push('test-framework');
        }
        break;

      case 'package-manager':
        if (
          path.basename(filePath) === 'package.json' ||
          filePath.includes('lerna.json') ||
          filePath.includes('nx.json') ||
          filePath.includes('turbo.json') ||
          filePath.includes('pnpm-workspace.yaml')
        ) {
          frameworks.push('package-manager');
        }
        break;

      case 'background-job':
        if (
          (ext === '.js' || ext === '.ts') &&
          (filePath.includes('worker') ||
            filePath.includes('job') ||
            filePath.includes('queue') ||
            filePath.includes('/workers/') ||
            filePath.includes('/jobs/') ||
            filePath.includes('/queues/'))
        ) {
          frameworks.push('background-job');
        }
        break;

      case 'orm':
        if (
          ext === '.prisma' ||
          filePath.includes('.model.') ||
          filePath.includes('.entity.') ||
          filePath.includes('.schema.') ||
          filePath.includes('/models/') ||
          filePath.includes('/entities/') ||
          filePath.includes('/schemas/') ||
          filePath.includes('/prisma/') ||
          filePath.includes('ormconfig.json')
        ) {
          frameworks.push('orm');
        }
        break;

      case 'laravel':
        if (ext === '.php') {
          let isLaravelFile = false;

          // Controller files
          if (
            filePath.includes('/app/Http/Controllers/') ||
            path.basename(filePath).endsWith('Controller.php')
          ) {
            isLaravelFile = true;
          }
          // Model files
          if (
            filePath.includes('/app/Models/') ||
            (filePath.includes('/app/') && hasLaravelModelPattern(filePath))
          ) {
            isLaravelFile = true;
          }
          // Route files
          if (
            filePath.includes('/routes/') &&
            (path.basename(filePath) === 'web.php' ||
              path.basename(filePath) === 'api.php' ||
              path.basename(filePath) === 'console.php')
          ) {
            isLaravelFile = true;
          }
          // Middleware files
          if (
            filePath.includes('/app/Http/Middleware/') ||
            path.basename(filePath).endsWith('Middleware.php')
          ) {
            isLaravelFile = true;
          }
          // Service provider files
          if (
            filePath.includes('/app/Providers/') ||
            path.basename(filePath).endsWith('ServiceProvider.php')
          ) {
            isLaravelFile = true;
          }
          // Migration files
          if (filePath.includes('/database/migrations/')) {
            isLaravelFile = true;
          }
          // Seeder files
          if (
            filePath.includes('/database/seeders/') ||
            path.basename(filePath).endsWith('Seeder.php')
          ) {
            isLaravelFile = true;
          }
          // Artisan command files
          if (
            filePath.includes('/app/Console/Commands/') ||
            path.basename(filePath).endsWith('Command.php')
          ) {
            isLaravelFile = true;
          }

          // Job files
          if (filePath.includes('/app/Jobs/') || path.basename(filePath).endsWith('Job.php')) {
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

      case 'godot':
        if (ext === '.tscn') {
          frameworks.push('godot');
        } else if (ext === '.cs') {
          const hasScriptsPath = filePath.includes('/scripts/') || filePath.includes('/Scripts/');
          const hasCamelCase = path.basename(filePath, '.cs').match(/[A-Z][a-z]+/);
          const shouldInclude = hasScriptsPath || hasCamelCase;

          if (shouldInclude) {
            // Godot parser handles base C# parsing internally, so remove base 'csharp' parser
            const csharpIndex = frameworks.indexOf('csharp');
            if (csharpIndex !== -1) {
              frameworks.splice(csharpIndex, 1);
            }
            frameworks.push('godot');
          }
        } else if (filePath.endsWith('project.godot')) {
          frameworks.push('godot');
        }
        break;
    }
  }

  return frameworks;
}
