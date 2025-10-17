import { Symbol, SymbolType } from '../../../database/models';
import { ParsedDependency } from '../../../parsers/base';
import { IResolutionContext, SymbolResolutionResult, Language, VirtualSymbolConfig } from '../interfaces';
import { BaseLanguageResolver } from './base-language-resolver';
import { ImportPathResolver } from '../support/import-path-resolver';
import { MemberExpressionResolver } from '../support/member-expression-resolver';
import { frameworkSymbolRegistry } from '../../../parsers/framework-symbols';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('javascript-resolver');

export class JavaScriptResolver extends BaseLanguageResolver {
  readonly name = 'JavaScriptResolver';
  readonly supportedLanguages: Language[] = ['javascript', 'typescript'];
  readonly priority = 100;

  private importPathResolver: ImportPathResolver;
  private memberExpressionResolver: MemberExpressionResolver;
  private projectRoot: string = '';

  constructor() {
    super();
    this.importPathResolver = new ImportPathResolver();
    this.memberExpressionResolver = new MemberExpressionResolver();
  }

  canResolve(context: IResolutionContext, _targetSymbol: string, _dependency?: ParsedDependency): boolean {
    return context.language === 'javascript' || context.language === 'typescript';
  }

  resolve(
    context: IResolutionContext,
    targetSymbol: string,
    dependency?: ParsedDependency
  ): SymbolResolutionResult | null {
    if (targetSymbol.includes('.')) {
      const memberSymbol = this.memberExpressionResolver.resolve(
        targetSymbol,
        context,
        this.indexManager
      );
      if (memberSymbol) {
        this.logResolution(true, targetSymbol, 'member_expression', context);
        return this.createHighConfidenceResult(memberSymbol, 'javascript:member_expression');
      }
    }

    const localSymbol = this.resolveInLocalScope(context, targetSymbol);
    if (localSymbol) {
      this.logResolution(true, targetSymbol, 'local_scope', context);
      return this.createHighConfidenceResult(localSymbol, 'javascript:local_scope');
    }

    const importedSymbol = this.resolveFromImportsWithPath(context, targetSymbol);
    if (importedSymbol) {
      this.logResolution(true, targetSymbol, 'imports_with_path', context);
      return this.createHighConfidenceResult(importedSymbol, 'javascript:imports');
    }

    const exportedSymbol = this.resolveFromExports(targetSymbol);
    if (exportedSymbol) {
      this.logResolution(true, targetSymbol, 'exports', context);
      return this.createMediumConfidenceResult(exportedSymbol, 'javascript:exports');
    }

    const externalSymbol = this.resolveExternalLibrarySymbol(context, targetSymbol);
    if (externalSymbol) {
      this.logResolution(true, targetSymbol, 'external_library', context);
      return this.createMediumConfidenceResult(externalSymbol, 'javascript:external_library');
    }

    this.logResolution(false, targetSymbol, undefined, context);
    return null;
  }

  setProjectRoot(projectRoot: string): void {
    this.projectRoot = projectRoot;
  }

  private resolveFromImportsWithPath(context: IResolutionContext, symbolName: string): Symbol | null {
    for (const importDecl of context.imports) {
      if (!this.importIncludesSymbol(importDecl, symbolName)) {
        continue;
      }

      const exportedSymbols = this.indexManager.getExportedSymbols(symbolName);

      if (exportedSymbols.length === 1) {
        return exportedSymbols[0].symbol;
      }

      if (exportedSymbols.length > 1 && this.projectRoot) {
        const resolvedPath = this.importPathResolver.resolvePath(
          importDecl.source,
          context.filePath,
          this.projectRoot
        );

        if (resolvedPath) {
          const targetFileId = this.indexManager.getFileId(resolvedPath.resolvedPath);

          if (targetFileId) {
            const matchingSymbol = exportedSymbols.find(
              exp => exp.fromFile === targetFileId
            );

            if (matchingSymbol) {
              logger.debug('Resolved import using path resolution', {
                symbolName,
                importSource: importDecl.source,
                resolvedPath: resolvedPath.resolvedPath,
              });
              return matchingSymbol.symbol;
            }
          }
        }
      }

      if (exportedSymbols.length > 0) {
        logger.debug('Multiple exports found, using first match', {
          symbolName,
          count: exportedSymbols.length,
        });
        return exportedSymbols[0].symbol;
      }
    }

    return null;
  }

  private resolveExternalLibrarySymbol(context: IResolutionContext, symbolName: string): Symbol | null {
    for (const importDecl of context.imports) {
      if (!this.importIncludesSymbol(importDecl, symbolName)) {
        continue;
      }

      if (!this.isExternalLibraryImport(importDecl.source)) {
        continue;
      }

      const libraryContext = this.getExternalLibraryContext(importDecl.source);
      const frameworkSymbol = frameworkSymbolRegistry.isFrameworkSymbolAvailable(
        symbolName,
        libraryContext,
        importDecl.source
      );

      if (!frameworkSymbol) {
        continue;
      }

      const config: VirtualSymbolConfig = {
        name: symbolName,
        type: frameworkSymbol.symbol_type,
        library: frameworkSymbol.framework,
        signature: frameworkSymbol.signature || `${frameworkSymbol.framework}::${symbolName}`,
        description: frameworkSymbol.description,
        visibility: frameworkSymbol.visibility,
      };

      return this.virtualFactory.createExternalLibrarySymbol(config);
    }

    return null;
  }

  private isExternalLibraryImport(source: string): boolean {
    return !source.startsWith('./') && !source.startsWith('../') && !source.startsWith('/');
  }

  private getExternalLibraryContext(source: string): string {
    switch (source) {
      case 'vue':
        return 'vue';
      case 'react':
        return 'react';
      default:
        return 'javascript';
    }
  }

  cleanup(): void {
    super.cleanup();
    this.importPathResolver.clearCache();
    logger.debug('JavaScriptResolver cleanup complete');
  }
}
