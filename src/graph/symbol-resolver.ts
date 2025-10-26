import { Symbol, File } from '../database/models';
import { ParsedDependency, ParsedImport, ParsedExport } from '../parsers/base';
import { createComponentLogger } from '../utils/logger';
import { autoloaderRegistry } from '../config/autoloader-resolver';

import { ResolutionContext } from './resolvers/context/resolution-context';
import { ContextAnalyzer } from './resolvers/context/context-analyzer';
import { SymbolIndexManager } from './resolvers/support/symbol-index-manager';
import { VirtualSymbolFactory } from './resolvers/support/virtual-symbol-factory';
import { CSharpResolver } from './resolvers/languages/csharp-resolver';
import { PHPResolver } from './resolvers/languages/php-resolver';
import { JavaScriptResolver } from './resolvers/languages/javascript-resolver';
import { StoreResolver } from './resolvers/frameworks/store-resolver';
import { ComposableResolver } from './resolvers/frameworks/composable-resolver';
import { ILanguageResolver, IResolutionContext, SymbolResolutionResult } from './resolvers/interfaces';

const logger = createComponentLogger('symbol-resolver');

export interface SymbolResolutionContext {
  fileId: number;
  filePath: string;
  symbols: Symbol[];
  imports: ParsedImport[];
  exports: ParsedExport[];
}

export interface ResolvedDependency {
  fromSymbol: Symbol;
  toSymbol: Symbol;
  originalDependency: ParsedDependency;
  resolutionStrategy?: string;
}

export class SymbolResolver {
  private languageResolvers: ILanguageResolver[] = [];
  private frameworkResolvers: ILanguageResolver[] = [];
  private indexManager: SymbolIndexManager;
  private virtualFactory: VirtualSymbolFactory;
  private contextAnalyzer: ContextAnalyzer;
  private contexts: Map<number, IResolutionContext> = new Map();
  private projectRoot: string = '';

  constructor() {
    this.indexManager = new SymbolIndexManager();
    this.virtualFactory = new VirtualSymbolFactory();
    this.contextAnalyzer = new ContextAnalyzer();

    this.initializeResolvers();
  }

  private initializeResolvers(): void {
    const csharpResolver = new CSharpResolver();
    const phpResolver = new PHPResolver();
    const javascriptResolver = new JavaScriptResolver();
    const storeResolver = new StoreResolver();
    const composableResolver = new ComposableResolver();

    this.languageResolvers = [csharpResolver, phpResolver, javascriptResolver];
    this.frameworkResolvers = [storeResolver, composableResolver];

    for (const resolver of [...this.languageResolvers, ...this.frameworkResolvers]) {
      resolver.initialize(this.indexManager, this.virtualFactory);
    }

    logger.info('Symbol resolver initialized', {
      languageResolvers: this.languageResolvers.length,
      frameworkResolvers: this.frameworkResolvers.length,
    });
  }

  initialize(
    files: File[],
    allSymbols: Symbol[],
    importsMap: Map<number, ParsedImport[]>,
    exportsMap: Map<number, ParsedExport[]>,
    dependenciesMap?: Map<number, ParsedDependency[]>
  ): void {
    this.contexts.clear();

    for (const file of files) {
      const fileSymbols = allSymbols.filter(s => s.file_id === file.id);
      const fileImports = importsMap.get(file.id) || [];
      const fileExports = exportsMap.get(file.id) || [];

      const context = ResolutionContext.fromFileContext(
        file.id,
        file.path,
        fileSymbols,
        fileImports,
        fileExports
      );

      this.contexts.set(file.id, context);
    }

    // Extract IMPLEMENTS dependencies for interface resolution
    const implementsDependencies: Array<{ fromSymbolId: number; toSymbolId: number }> = [];
    if (dependenciesMap) {
      for (const deps of dependenciesMap.values()) {
        for (const dep of deps) {
          if (dep.dependency_type === 'implements') {
            // Find the actual symbol IDs
            const fromSymbol = allSymbols.find(s => s.name === dep.from_symbol);
            const toSymbol = allSymbols.find(s => s.name === dep.to_symbol);
            if (fromSymbol && toSymbol) {
              implementsDependencies.push({
                fromSymbolId: fromSymbol.id,
                toSymbolId: toSymbol.id
              });
            }
          }
        }
      }
    }

    this.indexManager.buildTransientIndexes(
      Array.from(this.contexts.values()),
      allSymbols,
      implementsDependencies
    );

    logger.debug('Initialized with file contexts', {
      fileCount: files.length,
      symbolCount: allSymbols.length,
      implementsDependencies: implementsDependencies.length,
    });
  }

  resolveDependencies(sourceFileId: number, dependencies: ParsedDependency[]): ResolvedDependency[] {
    const sourceContext = this.contexts.get(sourceFileId);
    if (!sourceContext) {
      logger.warn('No context found for source file', { sourceFileId });
      return [];
    }

    const resolved: ResolvedDependency[] = [];

    for (const dependency of dependencies) {
      try {
        const resolution = this.resolveSingleDependency(sourceContext, dependency);
        if (resolution) {
          resolved.push(resolution);
        }
      } catch (error) {
        logger.error('Failed to resolve dependency', {
          dependency,
          sourceFile: sourceContext.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return resolved;
  }

  private resolveSingleDependency(
    sourceContext: IResolutionContext,
    dependency: ParsedDependency
  ): ResolvedDependency | null {
    const fromSymbol = this.findFromSymbol(sourceContext, dependency.from_symbol);
    if (!fromSymbol) {
      return null;
    }

    const resolutionResult = this.resolveTargetSymbolWithStrategy(sourceContext, dependency.to_symbol, dependency);
    if (!resolutionResult) {
      return null;
    }

    return {
      fromSymbol,
      toSymbol: resolutionResult.symbol,
      originalDependency: dependency,
      resolutionStrategy: resolutionResult.strategy,
    };
  }

  private findFromSymbol(context: IResolutionContext, fromSymbolName: string): Symbol | null {
    let symbol = context.symbols.find(s => s.name === fromSymbolName);

    if (!symbol && fromSymbolName.includes('.')) {
      const methodName = fromSymbolName.split('.').pop();
      if (methodName) {
        symbol = context.symbols.find(s => s.name === methodName);
      }
    }

    return symbol || null;
  }

  private resolveTargetSymbolWithStrategy(
    context: IResolutionContext,
    targetSymbol: string,
    dependency?: ParsedDependency
  ): { symbol: Symbol; strategy: string } | null {
    const languageResolver = this.getLanguageResolver(context);
    if (languageResolver) {
      try {
        const result = languageResolver.resolve(context, targetSymbol, dependency);
        if (result) {
          return { symbol: result.symbol, strategy: result.resolutionStrategy };
        }
      } catch (error) {
        logger.error('Language resolver failed', {
          resolver: languageResolver.name,
          targetSymbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const frameworkResolver of this.frameworkResolvers) {
      if (!frameworkResolver.canResolve(context, targetSymbol, dependency)) {
        continue;
      }

      try {
        const result = frameworkResolver.resolve(context, targetSymbol, dependency);
        if (result) {
          return { symbol: result.symbol, strategy: result.resolutionStrategy };
        }
      } catch (error) {
        logger.error('Framework resolver failed', {
          resolver: frameworkResolver.name,
          targetSymbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }

  private resolveTargetSymbol(
    context: IResolutionContext,
    targetSymbol: string,
    dependency?: ParsedDependency
  ): Symbol | null {
    const result = this.resolveTargetSymbolWithStrategy(context, targetSymbol, dependency);
    return result?.symbol || null;
  }

  private getLanguageResolver(context: IResolutionContext): ILanguageResolver | null {
    for (const resolver of this.languageResolvers) {
      if (resolver.supportedLanguages.includes(context.language)) {
        return resolver;
      }
    }
    return null;
  }

  async buildGlobalSymbolIndex(files: File[], symbols: Symbol[]): Promise<void> {
    this.indexManager.buildGlobalIndex(files, symbols);
  }

  async registerAutoloaderConfig(repositoryPath: string): Promise<void> {
    this.projectRoot = repositoryPath;

    await autoloaderRegistry.discoverAndLoadConfigs(repositoryPath);
    const stats = autoloaderRegistry.getStats();
    logger.info('Autoloader configs loaded', stats);

    const phpResolver = this.languageResolvers.find(r => r.name === 'PHPResolver') as PHPResolver;
    if (phpResolver) {
      phpResolver.setProjectRoot(repositoryPath);
    }

    const jsResolver = this.languageResolvers.find(r => r.name === 'JavaScriptResolver') as JavaScriptResolver;
    if (jsResolver) {
      jsResolver.setProjectRoot(repositoryPath);
    }
  }

  resolveImport(fileId: number, importName: string): Symbol | null {
    const context = this.contexts.get(fileId);
    if (!context) {
      return null;
    }

    return this.resolveTargetSymbol(context, importName);
  }

  getVirtualSymbols(): Symbol[] {
    return this.virtualFactory.getAllVirtualSymbols();
  }

  getResolutionStats(): {
    totalFiles: number;
    totalSymbols: number;
    exportedSymbols: number;
    virtualSymbols: number;
  } {
    const stats = this.indexManager.getStats();

    return {
      totalFiles: stats.files,
      totalSymbols: stats.transientSymbols,
      exportedSymbols: stats.exportedSymbols,
      virtualSymbols: this.virtualFactory.getAllVirtualSymbols().length,
    };
  }

  clearContextMaps(): void {
    this.contexts.clear();
    this.indexManager.clearTransient();
    logger.debug('Context maps cleared');
  }

  clearGlobalIndex(): void {
    this.indexManager.clearAll();
    this.virtualFactory.clear();
    logger.debug('Global index cleared');
  }

  setFieldTypeMap(_fieldTypeMap: Map<string, string>): void {
    logger.warn('setFieldTypeMap is deprecated - field types are now managed in ResolutionContext');
  }

  clearFieldTypeMap(): void {
    logger.warn('clearFieldTypeMap is deprecated - field types are now managed in ResolutionContext');
  }

  getSymbolByQualifiedName(qualifiedName: string): Symbol | null {
    return this.indexManager.getSymbolByQualifiedName(qualifiedName);
  }

  resolvePHPClassName(
    className: string,
    useStatements: ParsedImport[],
    currentNamespace: string | null
  ): string | null {
    const phpResolver = this.languageResolvers.find(r => r.name === 'PHPResolver') as PHPResolver;
    if (!phpResolver) {
      logger.warn('PHPResolver not found');
      return null;
    }

    return (phpResolver as any).resolvePHPClassName(className, useStatements, currentNamespace);
  }

  resolvePHPStaticCall(
    className: string,
    methodName: string,
    useStatements: ParsedImport[],
    currentNamespace: string | null,
    contextFilePath: string
  ): Symbol | null {
    const phpResolver = this.languageResolvers.find(r => r.name === 'PHPResolver') as PHPResolver;
    if (!phpResolver) {
      logger.warn('PHPResolver not found');
      return null;
    }

    return (phpResolver as any).resolvePHPStaticCall(
      className,
      methodName,
      useStatements,
      currentNamespace,
      contextFilePath
    );
  }

  resolveNamespaceToFile(
    fqn: string,
    contextFilePath: string,
    language: 'php' | 'typescript' | 'csharp'
  ): string | null {
    switch (language) {
      case 'php':
        return autoloaderRegistry.resolvePhpClass(fqn, contextFilePath);
      case 'typescript':
        return autoloaderRegistry.resolveTypeScriptImport(fqn, contextFilePath);
      case 'csharp':
        return autoloaderRegistry.resolveCsharpNamespace(fqn, contextFilePath);
      default:
        return null;
    }
  }
}
