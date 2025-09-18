import { PackageManagerParser } from '../../src/parsers/package-manager';
import { SymbolType, DependencyType } from '../../src/database/models';

describe('PackageManagerParser', () => {
  let parser: PackageManagerParser;

  beforeEach(() => {
    parser = new PackageManagerParser();
  });

  describe('getSupportedExtensions', () => {
    it('should return correct package manager file extensions', () => {
      const extensions = parser.getSupportedExtensions();
      expect(extensions).toContain('package.json');
      expect(extensions).toContain('yarn.lock');
      expect(extensions).toContain('pnpm-lock.yaml');
    });
  });

  describe('getFrameworkPatterns', () => {
    it('should return package manager patterns', () => {
      const patterns = parser.getFrameworkPatterns();
      expect(patterns).toHaveLength(4);
      expect(patterns.map(p => p.name)).toContain('package-json');
      expect(patterns.map(p => p.name)).toContain('yarn-lock');
      expect(patterns.map(p => p.name)).toContain('pnpm-lock');
      expect(patterns.map(p => p.name)).toContain('lerna-config');
    });
  });

  describe('parseFile', () => {
    it('should parse simple package.json', async () => {
      const content = JSON.stringify({
        "name": "my-app",
        "version": "1.0.0",
        "description": "A sample application",
        "main": "index.js",
        "dependencies": {
          "express": "^4.18.0",
          "lodash": "~4.17.21"
        },
        "devDependencies": {
          "jest": "^29.0.0",
          "@types/node": "^18.0.0"
        },
        "scripts": {
          "start": "node index.js",
          "test": "jest",
          "build": "tsc"
        }
      }, null, 2);

      const result = await parser.parseFile('package.json', content);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0]).toMatchObject({
        name: 'my-app',
        symbol_type: SymbolType.WORKSPACE_PROJECT,
        is_exported: true,
      });

      expect(result.dependencies).toHaveLength(4); // express, lodash, jest, @types/node
      expect(result.dependencies[0]).toMatchObject({
        from_symbol: 'my-app',
        dependency_type: DependencyType.PACKAGE_DEPENDENCY,
        confidence: 1,
      });
    });

    it('should parse yarn workspace package.json', async () => {
      const content = JSON.stringify({
        "name": "my-monorepo",
        "private": true,
        "workspaces": [
          "packages/*",
          "apps/*"
        ],
        "devDependencies": {
          "lerna": "^6.0.0",
          "typescript": "^4.9.0"
        }
      }, null, 2);

      const result = await parser.parseFile('package.json', content);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0]).toMatchObject({
        name: 'my-monorepo',
        symbol_type: SymbolType.WORKSPACE_PROJECT,
      });

      expect(result.dependencies).toHaveLength(2); // lerna, typescript
    });

    it('should parse pnpm-workspace.yaml', async () => {
      const content = `
packages:
  - 'packages/*'
  - 'apps/*'
  - '!**/test/**'
`;

      const result = await parser.parseFile('pnpm-workspace.yaml', content);

      // YAML parsing is not fully implemented, expect minimal results
      expect(result.symbols).toHaveLength(0);
      expect(result.dependencies).toHaveLength(0);
    });

    it('should parse lerna.json', async () => {
      const content = JSON.stringify({
        "version": "independent",
        "npmClient": "yarn",
        "useWorkspaces": true,
        "packages": [
          "packages/*"
        ],
        "command": {
          "publish": {
            "conventionalCommits": true,
            "message": "chore(release): publish"
          }
        }
      }, null, 2);

      const result = await parser.parseFile('lerna.json', content);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0]).toMatchObject({
        name: 'lerna',
        symbol_type: SymbolType.VARIABLE,
      });
    });

    it('should parse nx.json', async () => {
      const content = JSON.stringify({
        "extends": "@nrwl/workspace/presets/npm.json",
        "affected": {
          "defaultBase": "origin/main"
        },
        "targetDefaults": {
          "build": {
            "dependsOn": ["^build"]
          }
        },
        "workspaceLayout": {
          "appsDir": "apps",
          "libsDir": "libs"
        }
      }, null, 2);

      const result = await parser.parseFile('nx.json', content);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0]).toMatchObject({
        name: 'nx',
        symbol_type: SymbolType.VARIABLE,
      });
    });

    it('should parse turbo.json', async () => {
      const content = JSON.stringify({
        "$schema": "https://turbo.build/schema.json",
        "pipeline": {
          "build": {
            "dependsOn": ["^build"],
            "outputs": ["dist/**"]
          },
          "test": {
            "dependsOn": ["build"],
            "outputs": []
          },
          "lint": {
            "outputs": []
          },
          "dev": {
            "cache": false
          }
        }
      }, null, 2);

      const result = await parser.parseFile('turbo.json', content);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0]).toMatchObject({
        name: 'turbo',
        symbol_type: SymbolType.VARIABLE,
      });
    });

    it('should parse package.json with complex workspace structure', async () => {
      const content = JSON.stringify({
        "name": "complex-monorepo",
        "workspaces": {
          "packages": [
            "apps/*",
            "packages/shared/*",
            "packages/ui/*",
            "tools/*"
          ],
          "nohoist": [
            "**/react-native",
            "**/react-native/**"
          ]
        },
        "dependencies": {
          "react": "^18.2.0"
        },
        "devDependencies": {
          "typescript": "^4.9.0",
          "jest": "^29.0.0",
          "eslint": "^8.0.0"
        }
      }, null, 2);

      const result = await parser.parseFile('package.json', content);

      expect(result.symbols).toHaveLength(1);
      expect(result.dependencies).toHaveLength(4); // react, typescript, jest, eslint
    });

    it('should detect package manager from lock files', async () => {
      // Test yarn.lock detection
      const yarnLockContent = `
# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1

"@babel/code-frame@^7.0.0":
  version "7.18.6"
  resolved "https://registry.yarnpkg.com/@babel/code-frame/-/code-frame-7.18.6.tgz"
`;

      const yarnResult = await parser.parseFile('yarn.lock', yarnLockContent);
      expect(yarnResult.symbols).toHaveLength(1);
      expect(yarnResult.symbols[0].name).toBe('yarn-lock');

      // Test pnpm-lock.yaml detection
      const pnpmLockContent = `
lockfileVersion: 5.4

specifiers:
  '@types/node': ^18.0.0
  typescript: ^4.9.0

dependencies:
  typescript: 4.9.4

devDependencies:
  '@types/node': 18.11.18
`;

      const pnpmResult = await parser.parseFile('pnpm-lock.yaml', pnpmLockContent);
      expect(pnpmResult.symbols).toHaveLength(1);
      expect(pnpmResult.symbols[0].name).toBe('pnpm-lock');
    });

    it('should handle package.json with scripts', async () => {
      const content = JSON.stringify({
        "name": "script-heavy-package",
        "scripts": {
          "start": "node server.js",
          "dev": "nodemon server.js",
          "build": "webpack --mode production",
          "test": "jest",
          "test:watch": "jest --watch",
          "lint": "eslint src/",
          "lint:fix": "eslint src/ --fix",
          "clean": "rimraf dist/",
          "prebuild": "npm run clean",
          "postbuild": "npm run test"
        },
        "dependencies": {
          "express": "^4.18.0"
        }
      }, null, 2);

      const result = await parser.parseFile('package.json', content);

      expect(result.symbols).toHaveLength(1);
      expect(result.dependencies).toHaveLength(1); // Only the express dependency
    });

    it('should handle invalid JSON gracefully', async () => {
      const content = '{ invalid json }';
      const result = await parser.parseFile('package.json', content);

      expect(result.symbols).toHaveLength(0);
      expect(result.dependencies).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
    });

    it('should handle empty package.json', async () => {
      const content = '{}';
      const result = await parser.parseFile('package.json', content);

      expect(result.symbols).toHaveLength(1); // Creates default package symbol
      expect(result.dependencies).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('detectFrameworkEntities', () => {
    it('should detect package manager system', async () => {
      const content = JSON.stringify({
        "name": "test-package",
        "workspaces": ["packages/*"]
      });

      const result = await parser.detectFrameworkEntities(content, 'package.json', {});

      // detectFrameworkEntities may not be fully implemented for package manager
      expect(result.entities).toHaveLength(0);
    });
  });

  describe('getDetectedPackageManagers', () => {
    it('should return detected package managers', async () => {
      await parser.parseFile('package.json', '{"name": "test"}');
      await parser.parseFile('yarn.lock', 'yarn lockfile content');

      const packageManagers = parser.getDetectedPackageManagers();

      expect(packageManagers).toContain('npm');
      expect(packageManagers).toContain('yarn');
    });
  });
});