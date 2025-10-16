import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('autoloader-resolver');

export interface AutoloaderMapping {
  namespace: string;
  directory: string;
}

export interface AutoloaderConfig {
  type: 'composer' | 'tsconfig' | 'csproj';
  configPath: string;
  mappings: AutoloaderMapping[];
  basePath: string;
}

export interface ComposerJson {
  autoload?: {
    'psr-4'?: Record<string, string | string[]>;
    'psr-0'?: Record<string, string | string[]>;
    classmap?: string[];
    files?: string[];
  };
  'autoload-dev'?: {
    'psr-4'?: Record<string, string | string[]>;
    'psr-0'?: Record<string, string | string[]>;
  };
}

export interface TsConfig {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
    rootDir?: string;
  };
}

export class ComposerConfigParser {
  async parse(composerJsonPath: string): Promise<AutoloaderConfig | null> {
    try {
      const content = await fs.readFile(composerJsonPath, 'utf-8');
      const composerJson: ComposerJson = JSON.parse(content);
      const basePath = path.dirname(composerJsonPath);
      const mappings: AutoloaderMapping[] = [];

      const psr4Mappings = composerJson.autoload?.['psr-4'] || {};
      const devPsr4Mappings = composerJson['autoload-dev']?.['psr-4'] || {};
      const allPsr4 = { ...psr4Mappings, ...devPsr4Mappings };

      for (const [namespace, dirs] of Object.entries(allPsr4)) {
        const directories = Array.isArray(dirs) ? dirs : [dirs];

        for (const dir of directories) {
          mappings.push({
            namespace: namespace.replace(/\\$/, ''),
            directory: path.join(basePath, dir)
          });
        }
      }

      const psr0Mappings = composerJson.autoload?.['psr-0'] || {};
      const devPsr0Mappings = composerJson['autoload-dev']?.['psr-0'] || {};
      const allPsr0 = { ...psr0Mappings, ...devPsr0Mappings };

      for (const [namespace, dirs] of Object.entries(allPsr0)) {
        const directories = Array.isArray(dirs) ? dirs : [dirs];

        for (const dir of directories) {
          const namespacePath = namespace.replace(/\\/g, '/');
          mappings.push({
            namespace: namespace.replace(/\\$/, ''),
            directory: path.join(basePath, dir, namespacePath)
          });
        }
      }

      if (mappings.length === 0) {
        return null;
      }

      return {
        type: 'composer',
        configPath: composerJsonPath,
        mappings,
        basePath
      };
    } catch (error) {
      logger.warn('Failed to parse composer.json', {
        path: composerJsonPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  resolveClassToFile(fqn: string, config: AutoloaderConfig): string | null {
    const normalizedFqn = fqn.replace(/^\\/, '');

    for (const mapping of config.mappings) {
      if (normalizedFqn.startsWith(mapping.namespace)) {
        const relativePath = normalizedFqn
          .substring(mapping.namespace.length)
          .replace(/\\/g, '/')
          .replace(/^\//, '');

        const filePath = path.join(mapping.directory, `${relativePath}.php`);

        try {
          if (fsSync.existsSync(filePath)) {
            return filePath;
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }
}

export class TsConfigParser {
  async parse(tsconfigPath: string): Promise<AutoloaderConfig | null> {
    try {
      const content = await fs.readFile(tsconfigPath, 'utf-8');
      const stripped = this.stripComments(content);
      const tsconfig: TsConfig = JSON.parse(stripped);
      const basePath = path.dirname(tsconfigPath);
      const mappings: AutoloaderMapping[] = [];

      const baseUrl = tsconfig.compilerOptions?.baseUrl || '.';
      const paths = tsconfig.compilerOptions?.paths || {};
      const baseUrlResolved = path.join(basePath, baseUrl);

      for (const [alias, targetPaths] of Object.entries(paths)) {
        const cleanAlias = alias.replace(/\/\*$/, '');

        for (const targetPath of targetPaths) {
          const cleanTarget = targetPath.replace(/\/\*$/, '');
          const resolvedPath = path.join(baseUrlResolved, cleanTarget);

          mappings.push({
            namespace: cleanAlias,
            directory: resolvedPath
          });
        }
      }

      if (mappings.length === 0) {
        mappings.push({
          namespace: '',
          directory: baseUrlResolved
        });
      }

      return {
        type: 'tsconfig',
        configPath: tsconfigPath,
        mappings,
        basePath: baseUrlResolved
      };
    } catch (error) {
      logger.warn('Failed to parse tsconfig.json', {
        path: tsconfigPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private stripComments(jsonWithComments: string): string {
    return jsonWithComments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');
  }

  resolveImportToFile(importPath: string, config: AutoloaderConfig): string | null {
    const cleanImport = importPath.replace(/^@\//, '');

    for (const mapping of config.mappings) {
      if (cleanImport.startsWith(mapping.namespace)) {
        const relativePath = cleanImport.substring(mapping.namespace.length).replace(/^\//, '');

        const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
        for (const ext of extensions) {
          const filePath = path.join(mapping.directory, relativePath + ext);

          try {
            if (fsSync.existsSync(filePath)) {
              return filePath;
            }
          } catch {
            continue;
          }
        }
      }
    }

    return null;
  }
}

export class CsprojParser {
  async parse(csprojPath: string): Promise<AutoloaderConfig | null> {
    try {
      const content = await fs.readFile(csprojPath, 'utf-8');
      const basePath = path.dirname(csprojPath);
      const mappings: AutoloaderMapping[] = [];

      const rootNamespaceMatch = content.match(/<RootNamespace>(.*?)<\/RootNamespace>/);
      const rootNamespace = rootNamespaceMatch ? rootNamespaceMatch[1] : path.basename(basePath);

      mappings.push({
        namespace: rootNamespace,
        directory: basePath
      });

      return {
        type: 'csproj',
        configPath: csprojPath,
        mappings,
        basePath
      };
    } catch (error) {
      logger.warn('Failed to parse .csproj', {
        path: csprojPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  resolveNamespaceToFile(fqn: string, config: AutoloaderConfig): string | null {
    for (const mapping of config.mappings) {
      if (fqn.startsWith(mapping.namespace)) {
        const relativePath = fqn
          .substring(mapping.namespace.length)
          .replace(/\./g, '/')
          .replace(/^\//, '');

        const filePath = path.join(mapping.directory, `${relativePath}.cs`);

        try {
          if (fsSync.existsSync(filePath)) {
            return filePath;
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }
}

/**
 * AutoloaderRegistry manages autoloader configurations across multiple
 * frameworks (Composer, tsconfig, csproj) and provides unified resolution.
 *
 * This registry discovers and caches configuration files from different
 * language ecosystems and uses them to resolve fully-qualified names to
 * file paths. It supports PSR-4/PSR-0 autoloading for PHP, TypeScript path
 * mappings, and C# namespace resolution.
 *
 * @example
 * ```typescript
 * const registry = new AutoloaderRegistry();
 * await registry.discoverAndLoadConfigs('/path/to/repo');
 *
 * // Resolve PHP class to file path
 * const phpFile = registry.resolvePhpClass('App\\Models\\User', 'src/test.php');
 *
 * // Resolve TypeScript import
 * const tsFile = registry.resolveTypeScriptImport('@/components/Button', 'src/App.tsx');
 *
 * // Resolve C# namespace
 * const csFile = registry.resolveCsharpNamespace('MyApp.Services.Auth', 'src/Main.cs');
 * ```
 *
 * @see ComposerConfigParser for PSR-4/PSR-0 resolution details
 * @see TsConfigParser for TypeScript path mapping resolution
 * @see CsprojParser for C# namespace resolution
 */
export class AutoloaderRegistry {
  private configs: Map<string, AutoloaderConfig> = new Map();
  private fileSearchCache: Map<string, string[]> = new Map();
  private composerParser = new ComposerConfigParser();
  private tsconfigParser = new TsConfigParser();
  private csprojParser = new CsprojParser();

  /**
   * Discovers and loads all autoloader configuration files in the repository.
   * Searches for composer.json, tsconfig.json, and *.csproj files recursively,
   * skipping common directories like node_modules, vendor, and dist.
   *
   * @param repositoryPath - Root path of the repository to scan
   */
  async discoverAndLoadConfigs(repositoryPath: string): Promise<void> {
    await this.findAndLoadComposerConfigs(repositoryPath);
    await this.findAndLoadTsConfigs(repositoryPath);
    await this.findAndLoadCsprojConfigs(repositoryPath);
  }

  private async findAndLoadComposerConfigs(repositoryPath: string): Promise<void> {
    const composerFiles = await this.findFiles(repositoryPath, 'composer.json');

    for (const composerFile of composerFiles) {
      const config = await this.composerParser.parse(composerFile);
      if (config) {
        const dirKey = path.dirname(composerFile);
        this.configs.set(dirKey, config);
        logger.debug('Loaded composer.json config', { path: composerFile, mappings: config.mappings.length });
      }
    }
  }

  private async findAndLoadTsConfigs(repositoryPath: string): Promise<void> {
    const tsconfigFiles = await this.findFiles(repositoryPath, 'tsconfig.json');

    for (const tsconfigFile of tsconfigFiles) {
      const config = await this.tsconfigParser.parse(tsconfigFile);
      if (config) {
        const dirKey = path.dirname(tsconfigFile);
        this.configs.set(dirKey, config);
        logger.debug('Loaded tsconfig.json config', { path: tsconfigFile, mappings: config.mappings.length });
      }
    }
  }

  private async findAndLoadCsprojConfigs(repositoryPath: string): Promise<void> {
    const csprojFiles = await this.findFiles(repositoryPath, '*.csproj');

    for (const csprojFile of csprojFiles) {
      const config = await this.csprojParser.parse(csprojFile);
      if (config) {
        const dirKey = path.dirname(csprojFile);
        this.configs.set(dirKey, config);
        logger.debug('Loaded .csproj config', { path: csprojFile, mappings: config.mappings.length });
      }
    }
  }

  private async findFiles(dir: string, pattern: string): Promise<string[]> {
    const cacheKey = `${dir}:${pattern}`;
    if (this.fileSearchCache.has(cacheKey)) {
      return this.fileSearchCache.get(cacheKey)!;
    }

    const results: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!this.shouldSkipDirectory(entry.name)) {
            const subResults = await this.findFiles(fullPath, pattern);
            results.push(...subResults);
          }
        } else if (entry.isFile()) {
          if (this.matchesPattern(entry.name, pattern)) {
            results.push(fullPath);
          }
        }
      }
    } catch (error) {
      logger.debug('Error reading directory', {
        dir,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    this.fileSearchCache.set(cacheKey, results);
    return results;
  }

  private shouldSkipDirectory(name: string): boolean {
    const skipDirs = new Set(['node_modules', 'vendor', 'dist', 'build', '.git', '.next', 'coverage']);
    return skipDirs.has(name);
  }

  private matchesPattern(filename: string, pattern: string): boolean {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(filename);
    }
    return filename === pattern;
  }

  getConfigForFile(filePath: string): AutoloaderConfig | null {
    let currentDir = path.dirname(filePath);
    const repoRoot = this.findRepositoryRoot(currentDir);

    while (currentDir.startsWith(repoRoot)) {
      const config = this.configs.get(currentDir);
      if (config) {
        return config;
      }

      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }

    return null;
  }

  private findRepositoryRoot(startPath: string): string {
    let currentDir = startPath;

    while (true) {
      try {
        if (fsSync.existsSync(path.join(currentDir, '.git'))) {
          return currentDir;
        }
      } catch {
        // Continue to parent if access check fails
      }

      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        return startPath;
      }
      currentDir = parent;
    }
  }

  resolvePhpClass(fqn: string, filePath: string): string | null {
    const config = this.getConfigForFile(filePath);
    if (!config || config.type !== 'composer') {
      return null;
    }

    return this.composerParser.resolveClassToFile(fqn, config);
  }

  resolveTypeScriptImport(importPath: string, filePath: string): string | null {
    const config = this.getConfigForFile(filePath);
    if (!config || config.type !== 'tsconfig') {
      return null;
    }

    return this.tsconfigParser.resolveImportToFile(importPath, config);
  }

  resolveCsharpNamespace(fqn: string, filePath: string): string | null {
    const config = this.getConfigForFile(filePath);
    if (!config || config.type !== 'csproj') {
      return null;
    }

    return this.csprojParser.resolveNamespaceToFile(fqn, config);
  }

  getStats(): { totalConfigs: number; configsByType: Record<string, number> } {
    const configsByType: Record<string, number> = {};

    for (const config of this.configs.values()) {
      configsByType[config.type] = (configsByType[config.type] || 0) + 1;
    }

    return {
      totalConfigs: this.configs.size,
      configsByType
    };
  }

  clear(): void {
    this.configs.clear();
    this.fileSearchCache.clear();
  }
}

export const autoloaderRegistry = new AutoloaderRegistry();
