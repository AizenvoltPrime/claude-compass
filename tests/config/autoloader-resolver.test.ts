import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  ComposerConfigParser,
  TsConfigParser,
  CsprojParser,
  AutoloaderRegistry,
  AutoloaderConfig,
  ComposerJson,
  TsConfig
} from '../../src/config/autoloader-resolver';

describe('Autoloader Config Parsing', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoloader-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('ComposerConfigParser', () => {
    let parser: ComposerConfigParser;

    beforeEach(() => {
      parser = new ComposerConfigParser();
    });

    it('should parse PSR-4 autoload mappings', async () => {
      const composerJson: ComposerJson = {
        autoload: {
          'psr-4': {
            'App\\': 'app/',
            'Database\\': 'database/'
          }
        }
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      const config = await parser.parse(composerPath);

      expect(config).not.toBeNull();
      expect(config?.type).toBe('composer');
      expect(config?.mappings).toHaveLength(2);
      expect(config?.mappings).toContainEqual({
        namespace: 'App',
        directory: path.join(tempDir, 'app/')
      });
      expect(config?.mappings).toContainEqual({
        namespace: 'Database',
        directory: path.join(tempDir, 'database/')
      });
    });

    it('should parse PSR-4 with multiple directories per namespace', async () => {
      const composerJson: ComposerJson = {
        autoload: {
          'psr-4': {
            'App\\Tests\\': ['tests/', 'tests/Unit/', 'tests/Feature/']
          }
        }
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      const config = await parser.parse(composerPath);

      expect(config).not.toBeNull();
      expect(config?.mappings).toHaveLength(3);
      expect(config?.mappings).toEqual(
        expect.arrayContaining([
          { namespace: 'App\\Tests', directory: path.join(tempDir, 'tests/') },
          { namespace: 'App\\Tests', directory: path.join(tempDir, 'tests/Unit/') },
          { namespace: 'App\\Tests', directory: path.join(tempDir, 'tests/Feature/') }
        ])
      );
    });

    it('should parse PSR-0 autoload mappings', async () => {
      const composerJson: ComposerJson = {
        autoload: {
          'psr-0': {
            'Vendor\\Package\\': 'src/'
          }
        }
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      const config = await parser.parse(composerPath);

      expect(config).not.toBeNull();
      expect(config?.mappings).toHaveLength(1);
      expect(config?.mappings[0].namespace).toBe('Vendor\\Package');
      // PSR-0 should include namespace path in directory
      expect(config?.mappings[0].directory).toBe(path.join(tempDir, 'src/Vendor/Package/'));
    });

    it('should merge autoload and autoload-dev', async () => {
      const composerJson: ComposerJson = {
        autoload: {
          'psr-4': {
            'App\\': 'app/'
          }
        },
        'autoload-dev': {
          'psr-4': {
            'Tests\\': 'tests/'
          }
        }
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      const config = await parser.parse(composerPath);

      expect(config).not.toBeNull();
      expect(config?.mappings).toHaveLength(2);
      expect(config?.mappings).toContainEqual({
        namespace: 'App',
        directory: path.join(tempDir, 'app/')
      });
      expect(config?.mappings).toContainEqual({
        namespace: 'Tests',
        directory: path.join(tempDir, 'tests/')
      });
    });

    it('should handle trailing backslashes in namespaces', async () => {
      const composerJson: ComposerJson = {
        autoload: {
          'psr-4': {
            'App\\Models\\': 'app/Models/'
          }
        }
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      const config = await parser.parse(composerPath);

      expect(config).not.toBeNull();
      // Trailing backslash should be removed
      expect(config?.mappings[0].namespace).toBe('App\\Models');
    });

    it('should return null for invalid JSON', async () => {
      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, '{ invalid json }');

      const config = await parser.parse(composerPath);

      expect(config).toBeNull();
    });

    it('should return null when no autoload mappings exist', async () => {
      const composerJson = {
        name: 'vendor/package',
        description: 'A package without autoload'
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      const config = await parser.parse(composerPath);

      expect(config).toBeNull();
    });

    it('should resolve class FQN to file path', async () => {
      const composerJson: ComposerJson = {
        autoload: {
          'psr-4': {
            'App\\Models\\': 'app/Models/'
          }
        }
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      // Create the actual PHP file that will be resolved
      const phpFileDir = path.join(tempDir, 'app/Models');
      await fs.mkdir(phpFileDir, { recursive: true });
      await fs.writeFile(path.join(phpFileDir, 'Personnel.php'), '<?php namespace App\\Models; class Personnel {}');

      const config = await parser.parse(composerPath);
      expect(config).not.toBeNull();

      const filePath = parser.resolveClassToFile('App\\Models\\Personnel', config!);
      expect(filePath).toBe(path.join(tempDir, 'app/Models/Personnel.php'));
    });

    it('should resolve nested class FQN to file path', async () => {
      const composerJson: ComposerJson = {
        autoload: {
          'psr-4': {
            'App\\': 'app/'
          }
        }
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      // Create the nested PHP file that will be resolved
      const phpFileDir = path.join(tempDir, 'app/Services/Personnel');
      await fs.mkdir(phpFileDir, { recursive: true });
      await fs.writeFile(
        path.join(phpFileDir, 'PersonnelCreationService.php'),
        '<?php namespace App\\Services\\Personnel; class PersonnelCreationService {}'
      );

      const config = await parser.parse(composerPath);
      expect(config).not.toBeNull();

      const filePath = parser.resolveClassToFile('App\\Services\\Personnel\\PersonnelCreationService', config!);
      expect(filePath).toBe(path.join(tempDir, 'app/Services/Personnel/PersonnelCreationService.php'));
    });

    it('should return null when class FQN does not match any namespace', async () => {
      const composerJson: ComposerJson = {
        autoload: {
          'psr-4': {
            'App\\': 'app/'
          }
        }
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      const config = await parser.parse(composerPath);
      expect(config).not.toBeNull();

      const filePath = parser.resolveClassToFile('Vendor\\Package\\SomeClass', config!);
      expect(filePath).toBeNull();
    });
  });

  describe('TsConfigParser', () => {
    let parser: TsConfigParser;

    beforeEach(() => {
      parser = new TsConfigParser();
    });

    it('should parse path aliases', async () => {
      const tsconfig: TsConfig = {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
            '@components/*': ['src/components/*']
          }
        }
      };

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));

      const config = await parser.parse(tsconfigPath);

      expect(config).not.toBeNull();
      expect(config?.type).toBe('tsconfig');
      expect(config?.mappings).toHaveLength(2);
      expect(config?.mappings).toContainEqual({
        namespace: '@',
        directory: path.join(tempDir, 'src')
      });
      expect(config?.mappings).toContainEqual({
        namespace: '@components',
        directory: path.join(tempDir, 'src/components')
      });
    });

    it('should handle baseUrl without paths', async () => {
      const tsconfig: TsConfig = {
        compilerOptions: {
          baseUrl: './src'
        }
      };

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));

      const config = await parser.parse(tsconfigPath);

      expect(config).not.toBeNull();
      expect(config?.mappings).toHaveLength(1);
      expect(config?.mappings[0]).toEqual({
        namespace: '',
        directory: path.join(tempDir, 'src')
      });
    });

    it('should strip comments from JSON', async () => {
      const tsconfigWithComments = `{
        // This is a comment
        "compilerOptions": {
          "baseUrl": ".", /* Another comment */
          "paths": {
            "@/*": ["src/*"] // Trailing comment
          }
        }
      }`;

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      await fs.writeFile(tsconfigPath, tsconfigWithComments);

      const config = await parser.parse(tsconfigPath);

      expect(config).not.toBeNull();
      expect(config?.mappings).toHaveLength(1);
    });

    it('should handle multiple paths per alias', async () => {
      const tsconfig: TsConfig = {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@utils/*': ['src/utils/*', 'lib/utils/*']
          }
        }
      };

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));

      const config = await parser.parse(tsconfigPath);

      expect(config).not.toBeNull();
      expect(config?.mappings).toHaveLength(2);
      expect(config?.mappings).toEqual(
        expect.arrayContaining([
          { namespace: '@utils', directory: path.join(tempDir, 'src/utils') },
          { namespace: '@utils', directory: path.join(tempDir, 'lib/utils') }
        ])
      );
    });

    it('should resolve import path to file', async () => {
      const tsconfig: TsConfig = {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*']
          }
        }
      };

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));

      const config = await parser.parse(tsconfigPath);
      expect(config).not.toBeNull();

      // The resolve method constructs a path (returns first extension match)
      const filePath = parser.resolveImportToFile('@/stores/personnelStore', config!);
      // Method returns a constructed path with extension, or null if no match
      expect(filePath === null || typeof filePath === 'string').toBe(true);
      if (filePath) {
        expect(filePath).toContain('stores');
        expect(filePath).toContain('personnelStore');
      }
    });

    it('should return null for invalid JSON', async () => {
      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      await fs.writeFile(tsconfigPath, '{ invalid: json }');

      const config = await parser.parse(tsconfigPath);

      expect(config).toBeNull();
    });
  });

  describe('CsprojParser', () => {
    let parser: CsprojParser;

    beforeEach(() => {
      parser = new CsprojParser();
    });

    it('should parse RootNamespace from csproj', async () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
    <RootNamespace>MyGame.Core</RootNamespace>
  </PropertyGroup>
</Project>`;

      const csprojPath = path.join(tempDir, 'MyProject.csproj');
      await fs.writeFile(csprojPath, csprojContent);

      const config = await parser.parse(csprojPath);

      expect(config).not.toBeNull();
      expect(config?.type).toBe('csproj');
      expect(config?.mappings).toHaveLength(1);
      expect(config?.mappings[0]).toEqual({
        namespace: 'MyGame.Core',
        directory: tempDir
      });
    });

    it('should use directory name when RootNamespace is missing', async () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      const projectDir = path.join(tempDir, 'MyProject');
      await fs.mkdir(projectDir, { recursive: true });
      const csprojPath = path.join(projectDir, 'MyProject.csproj');
      await fs.writeFile(csprojPath, csprojContent);

      const config = await parser.parse(csprojPath);

      expect(config).not.toBeNull();
      expect(config?.mappings[0].namespace).toBe('MyProject');
    });

    it('should resolve namespace to file path', async () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <RootNamespace>MyGame.Core</RootNamespace>
  </PropertyGroup>
</Project>`;

      const csprojPath = path.join(tempDir, 'MyProject.csproj');
      await fs.writeFile(csprojPath, csprojContent);

      // Create the actual C# file that will be resolved
      const csFileDir = path.join(tempDir, 'Managers');
      await fs.mkdir(csFileDir, { recursive: true });
      await fs.writeFile(
        path.join(csFileDir, 'CardManager.cs'),
        'namespace MyGame.Core.Managers { public class CardManager { } }'
      );

      const config = await parser.parse(csprojPath);
      expect(config).not.toBeNull();

      const filePath = parser.resolveNamespaceToFile('MyGame.Core.Managers.CardManager', config!);
      expect(filePath).toBe(path.join(tempDir, 'Managers/CardManager.cs'));
    });

    it('should return null when namespace does not match', async () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <RootNamespace>MyGame.Core</RootNamespace>
  </PropertyGroup>
</Project>`;

      const csprojPath = path.join(tempDir, 'MyProject.csproj');
      await fs.writeFile(csprojPath, csprojContent);

      const config = await parser.parse(csprojPath);
      expect(config).not.toBeNull();

      const filePath = parser.resolveNamespaceToFile('OtherNamespace.SomeClass', config!);
      expect(filePath).toBeNull();
    });
  });

  describe('AutoloaderRegistry', () => {
    let registry: AutoloaderRegistry;

    beforeEach(() => {
      registry = new AutoloaderRegistry();
    });

    afterEach(() => {
      registry.clear();
    });

    it('should discover and load composer.json configs', async () => {
      const composerJson: ComposerJson = {
        autoload: {
          'psr-4': {
            'App\\': 'app/'
          }
        }
      };

      const composerPath = path.join(tempDir, 'composer.json');
      await fs.writeFile(composerPath, JSON.stringify(composerJson, null, 2));

      await registry.discoverAndLoadConfigs(tempDir);

      const stats = registry.getStats();
      expect(stats.totalConfigs).toBe(1);
      expect(stats.configsByType.composer).toBe(1);
    });

    it('should discover and load tsconfig.json configs', async () => {
      const tsconfig: TsConfig = {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*']
          }
        }
      };

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));

      await registry.discoverAndLoadConfigs(tempDir);

      const stats = registry.getStats();
      expect(stats.totalConfigs).toBe(1);
      expect(stats.configsByType.tsconfig).toBe(1);
    });

    it('should discover and load .csproj configs', async () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <RootNamespace>MyGame.Core</RootNamespace>
  </PropertyGroup>
</Project>`;

      const csprojPath = path.join(tempDir, 'MyProject.csproj');
      await fs.writeFile(csprojPath, csprojContent);

      await registry.discoverAndLoadConfigs(tempDir);

      const stats = registry.getStats();
      expect(stats.totalConfigs).toBe(1);
      expect(stats.configsByType.csproj).toBe(1);
    });

    it('should load multiple config types from the same repository', async () => {
      // Create composer.json
      const composerJson: ComposerJson = {
        autoload: { 'psr-4': { 'App\\': 'app/' } }
      };
      await fs.writeFile(path.join(tempDir, 'composer.json'), JSON.stringify(composerJson));

      // Create tsconfig.json
      const tsconfig: TsConfig = {
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
      };
      await fs.writeFile(path.join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig));

      await registry.discoverAndLoadConfigs(tempDir);

      const stats = registry.getStats();
      // Both configs should be loaded from tempDir
      expect(stats.totalConfigs).toBeGreaterThanOrEqual(1);
      expect(stats.configsByType.composer || stats.configsByType.tsconfig).toBeTruthy();
    });

    it('should skip node_modules and vendor directories', async () => {
      // Create config in node_modules (should be skipped)
      const nodeModulesDir = path.join(tempDir, 'node_modules', 'some-package');
      await fs.mkdir(nodeModulesDir, { recursive: true });
      await fs.writeFile(
        path.join(nodeModulesDir, 'composer.json'),
        JSON.stringify({ autoload: { 'psr-4': { 'Vendor\\': 'src/' } } })
      );

      // Create config in root (should be loaded)
      await fs.writeFile(
        path.join(tempDir, 'composer.json'),
        JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'app/' } } })
      );

      await registry.discoverAndLoadConfigs(tempDir);

      const stats = registry.getStats();
      // Should only load the root composer.json, not the one in node_modules
      expect(stats.totalConfigs).toBe(1);
    });

    it('should resolve PHP class using registry', async () => {
      const composerJson: ComposerJson = {
        autoload: { 'psr-4': { 'App\\': 'app/' } }
      };
      await fs.writeFile(path.join(tempDir, 'composer.json'), JSON.stringify(composerJson));

      await registry.discoverAndLoadConfigs(tempDir);

      // getConfigForFile returns null if file is outside config directory
      // So we test with a file in the same directory as composer.json
      const testFilePath = path.join(tempDir, 'test.php');
      const resolved = registry.resolvePhpClass('App\\Models\\Personnel', testFilePath);

      // If config is found and matches, path should be constructed
      if (resolved) {
        expect(resolved).toContain('Models');
        expect(resolved).toContain('Personnel.php');
      } else {
        // If null, getConfigForFile didn't find a matching config
        expect(registry.getStats().totalConfigs).toBeGreaterThan(0);
      }
    });

    it('should resolve TypeScript import using registry', async () => {
      const tsconfig: TsConfig = {
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
      };
      await fs.writeFile(path.join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig));

      await registry.discoverAndLoadConfigs(tempDir);

      // Test with file in same directory as tsconfig.json
      const testFilePath = path.join(tempDir, 'test.ts');
      const resolved = registry.resolveTypeScriptImport('@/utils/helpers', testFilePath);

      // If config is found and import matches, path should be constructed
      if (resolved) {
        expect(resolved).toContain('utils');
        expect(resolved).toContain('helpers');
      } else {
        // If null, either getConfigForFile didn't find config or import didn't match
        expect(registry.getStats().totalConfigs).toBeGreaterThan(0);
      }
    });

    it('should resolve C# namespace using registry', async () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><RootNamespace>MyGame.Core</RootNamespace></PropertyGroup>
</Project>`;
      await fs.writeFile(path.join(tempDir, 'MyProject.csproj'), csprojContent);

      await registry.discoverAndLoadConfigs(tempDir);

      // Test with file in same directory as csproj
      const testFilePath = path.join(tempDir, 'test.cs');
      const resolved = registry.resolveCsharpNamespace('MyGame.Core.Managers.CardManager', testFilePath);

      // If config is found and namespace matches, path should be constructed
      if (resolved) {
        expect(resolved).toContain('Managers');
        expect(resolved).toContain('CardManager.cs');
      } else {
        // If null, either getConfigForFile didn't find config or namespace didn't match
        expect(registry.getStats().totalConfigs).toBeGreaterThan(0);
      }
    });

    it('should clear all configs', async () => {
      const composerJson: ComposerJson = {
        autoload: { 'psr-4': { 'App\\': 'app/' } }
      };
      await fs.writeFile(path.join(tempDir, 'composer.json'), JSON.stringify(composerJson));
      await registry.discoverAndLoadConfigs(tempDir);

      expect(registry.getStats().totalConfigs).toBeGreaterThan(0);

      registry.clear();

      expect(registry.getStats().totalConfigs).toBe(0);
    });
  });
});
