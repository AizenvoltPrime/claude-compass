import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { BaseFrameworkParser, FrameworkParseOptions, ParseFileResult } from './base-framework';
import { ParsedSymbol, ParsedDependency, ParsedImport, ParsedExport, ParseResult, ParseOptions, ParseError, FrameworkEntity } from './base';
import { SymbolType, DependencyType, PackageManagerType } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs/promises';

const logger = createComponentLogger('package-manager-parser');

export interface PackageInfo {
  name: string;
  version: string;
  packageManager: PackageManagerType;
  workspaceRoot?: string;
  dependencies: PackageDependency[];
  devDependencies: PackageDependency[];
  peerDependencies: PackageDependency[];
  scripts: PackageScript[];
  workspaces?: WorkspaceInfo[];
}

export interface PackageDependency {
  name: string;
  version: string;
  dependencyType: 'production' | 'development' | 'peer' | 'optional';
  isWorkspace?: boolean;
  resolvedVersion?: string;
}

export interface PackageScript {
  name: string;
  command: string;
  dependencies: string[];
  framework?: string;
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  packageManager: PackageManagerType;
  dependencies: string[];
}

export interface MonorepoStructure {
  root: string;
  packageManager: PackageManagerType;
  workspaces: WorkspaceInfo[];
  sharedDependencies: string[];
  buildOrder: string[];
}

/**
 * PackageManagerParser analyzes package management files and workspace configurations.
 * Supports npm, yarn, pnpm, and bun with monorepo structures (Nx, Lerna, Turborepo).
 */
export class PackageManagerParser extends BaseFrameworkParser {
  private packageInfos: PackageInfo[] = [];
  private monorepoStructures: MonorepoStructure[] = [];
  private detectedPackageManagers: Set<PackageManagerType> = new Set();

  constructor() {
    const parser = new Parser();
    parser.setLanguage(JavaScript);
    super(parser, 'package-manager');
  }

  getSupportedExtensions(): string[] {
    return ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json'];
  }

  async parseFile(filePath: string, content: string, options: FrameworkParseOptions = {}): Promise<ParseFileResult> {

    const fileName = path.basename(filePath);

    // Check if this is a package management file
    if (!this.isPackageManagerFile(fileName)) {
      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [],
        metadata: {
          framework: 'package-manager',
          fileType: 'non-package',
          isFrameworkSpecific: false
        }
      };
    }

    try {
      let result: ParseFileResult;

      switch (fileName) {
        case 'package.json':
          result = await this.parsePackageJson(filePath, content, options);
          break;
        case 'package-lock.json':
          result = await this.parsePackageLock(filePath, content, options);
          break;
        case 'yarn.lock':
          result = await this.parseYarnLock(filePath, content, options);
          break;
        case 'pnpm-lock.yaml':
          result = await this.parsePnpmLock(filePath, content, options);
          break;
        case 'lerna.json':
        case 'nx.json':
        case 'turbo.json':
        case 'rush.json':
          result = await this.parseMonorepoConfig(filePath, content, options);
          break;
        default:
          const baseResult = await this.parseFileDirectly(filePath, content, options);
          result = { filePath, ...baseResult };
      }

      // Add package manager entities
      const frameworkEntities = await this.createPackageManagerEntities(filePath, fileName);
      result.frameworkEntities = frameworkEntities;
      result.metadata = {
        framework: 'package-manager',
        fileType: fileName,
        isFrameworkSpecific: true
      };

      return result;

    } catch (error) {
      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `Package manager analysis failed: ${(error as Error).message}`,
          line: 1,
          column: 1,
          severity: 'warning'
        }],
        frameworkEntities: [],
        metadata: {
          framework: 'package-manager',
          fileType: fileName,
          isFrameworkSpecific: true
        }
      };
    }
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    return []; // Package files don't have traditional symbols
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    return []; // Dependencies are extracted through JSON parsing
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    return []; // Package files don't have imports
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    return []; // Package files don't have exports
  }

  /**
   * Parse package.json files
   */
  private async parsePackageJson(filePath: string, content: string, options: FrameworkParseOptions): Promise<ParseFileResult> {
    try {
      const packageData = JSON.parse(content);
      const packageManager = await this.detectPackageManager(path.dirname(filePath));
      this.detectedPackageManagers.add(packageManager);

      const packageInfo: PackageInfo = {
        name: packageData.name || path.basename(path.dirname(filePath)),
        version: packageData.version || '0.0.0',
        packageManager,
        dependencies: this.extractPackageDependencies(packageData.dependencies, 'production'),
        devDependencies: this.extractPackageDependencies(packageData.devDependencies, 'development'),
        peerDependencies: this.extractPackageDependencies(packageData.peerDependencies, 'peer'),
        scripts: this.extractScripts(packageData.scripts),
        workspaces: await this.extractWorkspaces(packageData.workspaces, path.dirname(filePath))
      };

      this.packageInfos.push(packageInfo);

      // Create symbols for package and major dependencies
      const symbols: ParsedSymbol[] = [];
      const dependencies: ParsedDependency[] = [];

      // Package symbol
      symbols.push({
        name: packageInfo.name,
        symbol_type: SymbolType.WORKSPACE_PROJECT,
        start_line: 1,
        end_line: content.split('\n').length,
        is_exported: true,
        signature: `Package: ${packageInfo.name}@${packageInfo.version}`
      });

      // Create dependency relationships
      [...packageInfo.dependencies, ...packageInfo.devDependencies].forEach((dep, index) => {
        dependencies.push({
          from_symbol: packageInfo.name,
          to_symbol: dep.name,
          dependency_type: DependencyType.PACKAGE_DEPENDENCY,
          line_number: index + 10, // Approximate line numbers
          confidence: 1.0
        });
      });

      return {
        filePath,
        symbols,
        dependencies,
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [],
        metadata: {
          framework: 'package-manager',
          fileType: 'package.json',
          isFrameworkSpecific: true
        }
      };

    } catch (error) {
      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `Failed to parse package.json: ${(error as Error).message}`,
          line: 1,
          column: 1,
          severity: 'error'
        }],
        frameworkEntities: [],
        metadata: {
          framework: 'package-manager',
          fileType: 'package.json',
          isFrameworkSpecific: true
        }
      };
    }
  }

  /**
   * Parse package-lock.json files
   */
  private async parsePackageLock(filePath: string, content: string, options: FrameworkParseOptions): Promise<ParseFileResult> {
    try {
      const lockData = JSON.parse(content);
      this.detectedPackageManagers.add(PackageManagerType.NPM);

      const symbols: ParsedSymbol[] = [];
      const dependencies: ParsedDependency[] = [];

      // Create lock file symbol
      symbols.push({
        name: 'package-lock',
        symbol_type: SymbolType.VARIABLE,
        start_line: 1,
        end_line: content.split('\n').length,
        is_exported: false,
        signature: `NPM Lock File: ${lockData.name}@${lockData.version}`
      });

      // Extract resolved versions and create dependencies
      if (lockData.packages) {
        Object.entries(lockData.packages).forEach(([packagePath, packageInfo]: [string, any], index) => {
          if (packagePath && packagePath !== '' && packageInfo.version) {
            const packageName = packagePath.replace('node_modules/', '');
            if (packageName) {
              dependencies.push({
                from_symbol: 'package-lock',
                to_symbol: packageName,
                dependency_type: DependencyType.PACKAGE_DEPENDENCY,
                line_number: index + 5,
                confidence: 1.0
              });
            }
          }
        });
      }

      return {
        filePath,
        symbols,
        dependencies,
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [],
        metadata: {
          framework: 'package-manager',
          fileType: 'package-lock.json',
          isFrameworkSpecific: true
        }
      };

    } catch (error) {
      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `Failed to parse package-lock.json: ${(error as Error).message}`,
          line: 1,
          column: 1,
          severity: 'error'
        }],
        frameworkEntities: [],
        metadata: {
          framework: 'package-manager',
          fileType: 'package-lock.json',
          isFrameworkSpecific: true
        }
      };
    }
  }

  /**
   * Parse yarn.lock files
   */
  private async parseYarnLock(filePath: string, content: string, options: FrameworkParseOptions): Promise<ParseFileResult> {
    this.detectedPackageManagers.add(PackageManagerType.YARN);

    const symbols: ParsedSymbol[] = [];
    const dependencies: ParsedDependency[] = [];

    // Parse yarn.lock format (simplified)
    const lines = content.split('\n');
    let currentPackage = '';
    let lineNumber = 0;

    for (const line of lines) {
      lineNumber++;

      // Package definition line (e.g., "package@version:", "@scope/package@version:")
      if (line.match(/^["\']?[@\w].*["\']?:$/)) {
        currentPackage = line.replace(/[":]/g, '').trim();
        if (currentPackage) {
          dependencies.push({
            from_symbol: 'yarn-lock',
            to_symbol: currentPackage.split('@')[0],
            dependency_type: DependencyType.PACKAGE_DEPENDENCY,
            line_number: lineNumber,
            confidence: 0.9
          });
        }
      }
    }

    symbols.push({
      name: 'yarn-lock',
      symbol_type: SymbolType.VARIABLE,
      start_line: 1,
      end_line: lines.length,
      is_exported: false,
      signature: 'Yarn Lock File'
    });

    return {
      filePath,
      symbols,
      dependencies,
      imports: [],
      exports: [],
      errors: [],
      frameworkEntities: [],
      metadata: {
        framework: 'package-manager',
        fileType: 'yarn.lock',
        isFrameworkSpecific: true
      }
    };
  }

  /**
   * Parse pnpm-lock.yaml files
   */
  private async parsePnpmLock(filePath: string, content: string, options: FrameworkParseOptions): Promise<ParseFileResult> {
    this.detectedPackageManagers.add(PackageManagerType.PNPM);

    const symbols: ParsedSymbol[] = [];
    const dependencies: ParsedDependency[] = [];

    // Simple YAML parsing for pnpm-lock.yaml
    const lines = content.split('\n');
    let inDependencies = false;
    let lineNumber = 0;

    for (const line of lines) {
      lineNumber++;

      if (line.trim() === 'dependencies:' || line.trim() === 'devDependencies:') {
        inDependencies = true;
        continue;
      }

      if (inDependencies && line.startsWith('  ') && line.includes(':')) {
        const packageName = line.trim().split(':')[0];
        if (packageName && !packageName.startsWith('#')) {
          dependencies.push({
            from_symbol: 'pnpm-lock',
            to_symbol: packageName,
            dependency_type: DependencyType.PACKAGE_DEPENDENCY,
            line_number: lineNumber,
            confidence: 0.9
          });
        }
      }

      if (!line.startsWith('  ') && line.trim() !== '' && inDependencies) {
        inDependencies = false;
      }
    }

    symbols.push({
      name: 'pnpm-lock',
      symbol_type: SymbolType.VARIABLE,
      start_line: 1,
      end_line: lines.length,
      is_exported: false,
      signature: 'PNPM Lock File'
    });

    return {
      filePath,
      symbols,
      dependencies,
      imports: [],
      exports: [],
      errors: [],
      frameworkEntities: [],
      metadata: {
        framework: 'package-manager',
        fileType: 'pnpm-lock.yaml',
        isFrameworkSpecific: true
      }
    };
  }

  /**
   * Parse monorepo configuration files
   */
  private async parseMonorepoConfig(filePath: string, content: string, options: FrameworkParseOptions): Promise<ParseFileResult> {
    try {
      const configData = JSON.parse(content);
      const fileName = path.basename(filePath);

      const symbols: ParsedSymbol[] = [];
      const dependencies: ParsedDependency[] = [];

      // Create monorepo config symbol
      symbols.push({
        name: fileName.replace('.json', ''),
        symbol_type: SymbolType.VARIABLE,
        start_line: 1,
        end_line: content.split('\n').length,
        is_exported: false,
        signature: `Monorepo Config: ${fileName}`
      });

      // Extract workspace information based on config type
      const monorepoStructure = await this.extractMonorepoStructure(filePath, configData, fileName);
      if (monorepoStructure) {
        this.monorepoStructures.push(monorepoStructure);

        // Create dependencies for workspace relationships
        monorepoStructure.workspaces.forEach((workspace, index) => {
          dependencies.push({
            from_symbol: fileName.replace('.json', ''),
            to_symbol: workspace.name,
            dependency_type: DependencyType.WORKSPACE_DEPENDENCY,
            line_number: index + 5,
            confidence: 1.0
          });
        });
      }

      return {
        filePath,
        symbols,
        dependencies,
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [],
        metadata: {
          framework: 'package-manager',
          fileType: fileName,
          isFrameworkSpecific: true
        }
      };

    } catch (error) {
      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `Failed to parse ${path.basename(filePath)}: ${(error as Error).message}`,
          line: 1,
          column: 1,
          severity: 'error'
        }],
        frameworkEntities: [],
        metadata: {
          framework: 'package-manager',
          fileType: path.basename(filePath),
          isFrameworkSpecific: true
        }
      };
    }
  }

  /**
   * Check if file is a package manager file
   */
  private isPackageManagerFile(fileName: string): boolean {
    const packageFiles = [
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lockb',
      'lerna.json',
      'nx.json',
      'turbo.json',
      'rush.json'
    ];

    return packageFiles.includes(fileName);
  }

  /**
   * Detect package manager from directory contents
   */
  private async detectPackageManager(dirPath: string): Promise<PackageManagerType> {
    try {
      const files = await fs.readdir(dirPath);

      if (files.includes('bun.lockb')) return PackageManagerType.BUN;
      if (files.includes('pnpm-lock.yaml')) return PackageManagerType.PNPM;
      if (files.includes('yarn.lock')) return PackageManagerType.YARN;
      if (files.includes('package-lock.json')) return PackageManagerType.NPM;

      return PackageManagerType.NPM; // Default
    } catch {
      return PackageManagerType.NPM; // Default fallback
    }
  }

  /**
   * Extract dependencies from package.json format
   */
  private extractPackageDependencies(deps: any, type: 'production' | 'development' | 'peer'): PackageDependency[] {
    if (!deps) return [];

    return Object.entries(deps).map(([name, version]) => ({
      name,
      version: version as string,
      dependencyType: type,
      isWorkspace: (version as string).startsWith('workspace:')
    }));
  }

  /**
   * Extract scripts from package.json
   */
  private extractScripts(scripts: any): PackageScript[] {
    if (!scripts) return [];

    return Object.entries(scripts).map(([name, command]) => ({
      name,
      command: command as string,
      dependencies: this.extractScriptDependencies(command as string),
      framework: this.detectFrameworkFromScript(command as string)
    }));
  }

  /**
   * Extract script dependencies
   */
  private extractScriptDependencies(command: string): string[] {
    const deps: string[] = [];

    // Extract binary calls that might be dependencies
    const binaryMatches = command.match(/\b([a-z][a-z0-9-]+)\b/g);
    if (binaryMatches) {
      // Filter to common package binaries
      const commonBinaries = ['vite', 'webpack', 'rollup', 'tsc', 'eslint', 'jest', 'vitest', 'cypress'];
      deps.push(...binaryMatches.filter(match => commonBinaries.includes(match)));
    }

    return deps;
  }

  /**
   * Detect framework from script command
   */
  private detectFrameworkFromScript(command: string): string | undefined {
    if (command.includes('vite')) return 'vite';
    if (command.includes('webpack')) return 'webpack';
    if (command.includes('next')) return 'next.js';
    if (command.includes('nuxt')) return 'nuxt.js';
    if (command.includes('vue-cli')) return 'vue.js';
    if (command.includes('react-scripts')) return 'react';

    return undefined;
  }

  /**
   * Extract workspace information
   */
  private async extractWorkspaces(workspaces: any, rootPath: string): Promise<WorkspaceInfo[] | undefined> {
    if (!workspaces) return undefined;

    const workspaceInfos: WorkspaceInfo[] = [];
    const patterns = Array.isArray(workspaces) ? workspaces : workspaces.packages || [];

    for (const pattern of patterns) {
      // Simple glob pattern resolution (would need proper glob library for production)
      if (typeof pattern === 'string' && !pattern.includes('*')) {
        const workspacePath = path.join(rootPath, pattern);
        try {
          const packageJsonPath = path.join(workspacePath, 'package.json');
          const packageData = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

          workspaceInfos.push({
            name: packageData.name || path.basename(pattern),
            path: workspacePath,
            packageManager: await this.detectPackageManager(workspacePath),
            dependencies: Object.keys(packageData.dependencies || {})
          });
        } catch {
          // Workspace directory might not exist or have package.json
        }
      }
    }

    return workspaceInfos.length > 0 ? workspaceInfos : undefined;
  }

  /**
   * Extract monorepo structure from config files
   */
  private async extractMonorepoStructure(filePath: string, configData: any, fileName: string): Promise<MonorepoStructure | null> {
    const rootPath = path.dirname(filePath);

    try {
      switch (fileName) {
        case 'lerna.json':
          return {
            root: rootPath,
            packageManager: configData.npmClient === 'yarn' ? PackageManagerType.YARN : PackageManagerType.NPM,
            workspaces: await this.extractLernaWorkspaces(configData, rootPath),
            sharedDependencies: [],
            buildOrder: []
          };

        case 'nx.json':
          return {
            root: rootPath,
            packageManager: await this.detectPackageManager(rootPath),
            workspaces: await this.extractNxWorkspaces(configData, rootPath),
            sharedDependencies: [],
            buildOrder: Object.keys(configData.projects || {})
          };

        case 'turbo.json':
          return {
            root: rootPath,
            packageManager: await this.detectPackageManager(rootPath),
            workspaces: [],
            sharedDependencies: [],
            buildOrder: Object.keys(configData.pipeline || {})
          };

        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Extract Lerna workspace information
   */
  private async extractLernaWorkspaces(configData: any, rootPath: string): Promise<WorkspaceInfo[]> {
    const workspaces: WorkspaceInfo[] = [];
    const packages = configData.packages || ['packages/*'];

    // Simple pattern matching for Lerna packages
    for (const pattern of packages) {
      if (pattern.endsWith('/*')) {
        const baseDir = pattern.replace('/*', '');
        try {
          const packagesDir = path.join(rootPath, baseDir);
          const entries = await fs.readdir(packagesDir);

          for (const entry of entries) {
            const packagePath = path.join(packagesDir, entry);
            try {
              const packageJsonPath = path.join(packagePath, 'package.json');
              const packageData = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

              workspaces.push({
                name: packageData.name || entry,
                path: packagePath,
                packageManager: await this.detectPackageManager(packagePath),
                dependencies: Object.keys(packageData.dependencies || {})
              });
            } catch {
              // Skip invalid packages
            }
          }
        } catch {
          // Skip if directory doesn't exist
        }
      }
    }

    return workspaces;
  }

  /**
   * Extract Nx workspace information
   */
  private async extractNxWorkspaces(configData: any, rootPath: string): Promise<WorkspaceInfo[]> {
    const workspaces: WorkspaceInfo[] = [];

    if (configData.projects) {
      for (const [projectName, projectConfig] of Object.entries(configData.projects)) {
        if (typeof projectConfig === 'object' && (projectConfig as any).root) {
          workspaces.push({
            name: projectName,
            path: path.join(rootPath, (projectConfig as any).root),
            packageManager: await this.detectPackageManager(rootPath),
            dependencies: []
          });
        }
      }
    }

    return workspaces;
  }

  /**
   * Create framework entities for package management
   */
  private async createPackageManagerEntities(filePath: string, fileName: string): Promise<FrameworkEntity[]> {
    const entities: FrameworkEntity[] = [];

    // Find relevant package info
    const packageInfo = this.packageInfos.find(pkg =>
      path.dirname(filePath).endsWith(pkg.name) || filePath.includes(pkg.name)
    );

    if (packageInfo) {
      entities.push({
        type: 'package',
        name: packageInfo.name,
        filePath,
        metadata: {
          version: packageInfo.version,
          packageManager: packageInfo.packageManager,
          dependencyCount: packageInfo.dependencies.length,
          scripts: packageInfo.scripts.map(s => s.name),
          isWorkspaceRoot: !!packageInfo.workspaces,
          detectedAt: new Date().toISOString()
        }
      });
    }

    return entities;
  }

  // Required abstract method implementations

  /**
   * Detect framework entities (packages, workspaces, dependencies)
   */
  public async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<{ entities: FrameworkEntity[] }> {
    const entities = await this.createPackageManagerEntities(filePath, path.basename(filePath));
    return { entities };
  }

  /**
   * Get package manager detection patterns
   */
  getFrameworkPatterns(): any[] {
    return [
      {
        name: 'package-json',
        pattern: /"name":\s*"|"version":\s*"|"dependencies":\s*\{/,
        fileExtensions: ['package.json'],
        priority: 10
      },
      {
        name: 'yarn-lock',
        pattern: /^# yarn lockfile v/,
        fileExtensions: ['yarn.lock'],
        priority: 9
      },
      {
        name: 'pnpm-lock',
        pattern: /lockfileVersion:/,
        fileExtensions: ['pnpm-lock.yaml'],
        priority: 9
      },
      {
        name: 'lerna-config',
        pattern: /"version":|"packages":|"npmClient":/,
        fileExtensions: ['lerna.json'],
        priority: 8
      }
    ];
  }

  /**
   * Get chunk boundaries (not needed for package files)
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    return [0, content.length];
  }

  /**
   * Merge chunk results (not needed for package files)
   */
  protected mergeChunkResults(chunks: ParseResult[], chunkMetadata: any[]): any {
    return {
      symbols: chunks.flatMap(c => c.symbols),
      dependencies: chunks.flatMap(c => c.dependencies),
      imports: chunks.flatMap(c => c.imports),
      exports: chunks.flatMap(c => c.exports),
      errors: chunks.flatMap(c => c.errors),
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunks.length,
        duplicatesRemoved: 0,
        crossChunkReferencesFound: 0
      }
    };
  }

  /**
   * Get package information
   */
  getPackageInfos(): PackageInfo[] {
    return this.packageInfos;
  }

  /**
   * Get monorepo structures
   */
  getMonorepoStructures(): MonorepoStructure[] {
    return this.monorepoStructures;
  }

  /**
   * Get detected package managers
   */
  getDetectedPackageManagers(): PackageManagerType[] {
    return Array.from(this.detectedPackageManagers);
  }

  /**
   * Clear parser state
   */
  clearState(): void {
    this.packageInfos = [];
    this.monorepoStructures = [];
    this.detectedPackageManagers.clear();
  }
}