import * as path from 'path';
import * as fs from 'fs';
import { IImportPathResolver, ImportResolutionOptions, ResolvedImportPath } from '../interfaces';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('import-path-resolver');

export class ImportPathResolver implements IImportPathResolver {
  private tsconfigCache: Map<string, any> = new Map();
  private barrelFileCache: Map<string, string[]> = new Map();

  resolvePath(
    importSource: string,
    currentFilePath: string,
    projectRoot: string,
    options?: ImportResolutionOptions
  ): ResolvedImportPath | null {
    const opts = {
      resolveAliases: true,
      resolveBarrelFiles: true,
      followReExports: false,
      ...options,
    };

    if (this.isExternalImport(importSource)) {
      return {
        resolvedPath: importSource,
        isExternal: true,
        isRelative: false,
        isBarrelFile: false,
      };
    }

    let resolvedPath: string | null = null;

    if (this.isRelativeImport(importSource)) {
      resolvedPath = this.resolveRelativePath(importSource, currentFilePath);
    } else if (importSource.startsWith('/')) {
      resolvedPath = path.join(projectRoot, importSource);
    } else if (opts.resolveAliases) {
      const tsconfig = this.loadTsConfig(projectRoot);
      const aliasResolved = this.resolvePathAlias(importSource, tsconfig);
      if (aliasResolved) {
        resolvedPath = path.isAbsolute(aliasResolved)
          ? aliasResolved
          : path.join(projectRoot, aliasResolved);
      }
    }

    if (!resolvedPath) {
      logger.debug('Could not resolve import path', { importSource, currentFilePath });
      return null;
    }

    resolvedPath = this.resolveExtensions(resolvedPath);

    const isBarrel = opts.resolveBarrelFiles && this.isBarrelImport(resolvedPath);

    return {
      resolvedPath,
      isExternal: false,
      isRelative: this.isRelativeImport(importSource),
      isBarrelFile: isBarrel,
    };
  }

  isExternalImport(source: string): boolean {
    return !source.startsWith('./') && !source.startsWith('../') && !source.startsWith('/');
  }

  isRelativeImport(source: string): boolean {
    return source.startsWith('./') || source.startsWith('../');
  }

  resolveBarrelFile(dirPath: string): string[] {
    const cached = this.barrelFileCache.get(dirPath);
    if (cached) {
      return cached;
    }

    const barrelFiles: string[] = [];
    const possibleBarrels = [
      path.join(dirPath, 'index.ts'),
      path.join(dirPath, 'index.tsx'),
      path.join(dirPath, 'index.js'),
      path.join(dirPath, 'index.jsx'),
    ];

    for (const barrelPath of possibleBarrels) {
      if (fs.existsSync(barrelPath)) {
        barrelFiles.push(barrelPath);
      }
    }

    this.barrelFileCache.set(dirPath, barrelFiles);
    return barrelFiles;
  }

  resolvePathAlias(source: string, tsconfig?: any): string | null {
    if (!tsconfig?.compilerOptions?.paths) {
      return null;
    }

    const paths = tsconfig.compilerOptions.paths;
    const baseUrl = tsconfig.compilerOptions.baseUrl || '.';

    for (const [pattern, replacements] of Object.entries(paths)) {
      const regex = this.createAliasRegex(pattern);
      const match = source.match(regex);

      if (match) {
        const replacement = (replacements as string[])[0];
        const resolvedPath = replacement.replace('*', match[1] || '');
        return path.join(baseUrl, resolvedPath);
      }
    }

    return null;
  }

  clearCache(): void {
    this.tsconfigCache.clear();
    this.barrelFileCache.clear();
  }

  private resolveRelativePath(importSource: string, currentFilePath: string): string {
    const currentDir = path.dirname(currentFilePath);
    return path.resolve(currentDir, importSource);
  }

  private resolveExtensions(filePath: string): string {
    if (fs.existsSync(filePath)) {
      return filePath;
    }

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.php', '.cs'];
    for (const ext of extensions) {
      const withExt = filePath + ext;
      if (fs.existsSync(withExt)) {
        return withExt;
      }
    }

    return filePath;
  }

  private isBarrelImport(resolvedPath: string): boolean {
    if (!fs.existsSync(resolvedPath)) {
      return false;
    }

    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
      const barrels = this.resolveBarrelFile(resolvedPath);
      return barrels.length > 0;
    }

    return false;
  }

  private loadTsConfig(projectRoot: string): any {
    const cached = this.tsconfigCache.get(projectRoot);
    if (cached) {
      return cached;
    }

    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(tsconfigPath, 'utf-8');
      const tsconfig = JSON.parse(content);
      this.tsconfigCache.set(projectRoot, tsconfig);
      return tsconfig;
    } catch (error) {
      logger.warn('Failed to load tsconfig.json', { projectRoot, error });
      return null;
    }
  }

  private createAliasRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexPattern = escaped.replace('\\*', '(.*)');
    return new RegExp(`^${regexPattern}$`);
  }
}
