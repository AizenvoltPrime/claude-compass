import { Symbol } from '../../../database/models';
import { ParsedDependency } from '../../../parsers/base';
import { IResolutionContext, SymbolResolutionResult, Language } from '../interfaces';
import { BaseLanguageResolver } from '../languages/base-language-resolver';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('composable-resolver');

export class ComposableResolver extends BaseLanguageResolver {
  readonly name = 'ComposableResolver';
  readonly supportedLanguages: Language[] = ['javascript', 'typescript'];
  readonly priority = 85;

  canResolve(context: IResolutionContext, targetSymbol: string, _dependency?: ParsedDependency): boolean {
    if (context.language !== 'javascript' && context.language !== 'typescript') {
      return false;
    }

    return this.isComposablePattern(targetSymbol) || this.hasComposableImport(context);
  }

  resolve(
    context: IResolutionContext,
    targetSymbol: string,
    dependency?: ParsedDependency
  ): SymbolResolutionResult | null {
    if (this.isComposablePattern(targetSymbol)) {
      const composableSymbol = this.resolveComposable(context, targetSymbol);
      if (composableSymbol) {
        this.logResolution(true, targetSymbol, 'composable', context);
        return this.createMediumConfidenceResult(composableSymbol, 'composable:function');
      }
    }

    this.logResolution(false, targetSymbol, undefined, context);
    return null;
  }

  private isComposablePattern(symbolName: string): boolean {
    return symbolName.startsWith('use') && symbolName.length > 3 && symbolName[3] === symbolName[3].toUpperCase();
  }

  private hasComposableImport(context: IResolutionContext): boolean {
    return context.imports.some(imp =>
      imp.imported_names?.some(name => this.isComposablePattern(name))
    );
  }

  private resolveComposable(context: IResolutionContext, composableName: string): Symbol | null {
    const importedSymbol = this.resolveFromImports(context, composableName);
    if (importedSymbol) {
      return importedSymbol;
    }

    const exportedSymbols = this.indexManager.getExportedSymbols(composableName);
    for (const exported of exportedSymbols) {
      if (this.isComposableFile(exported.symbol)) {
        logger.debug('Found composable via export matching', {
          composableName,
          fileId: exported.fromFile,
        });
        return exported.symbol;
      }
    }

    if (exportedSymbols.length === 1) {
      return exportedSymbols[0].symbol;
    }

    return null;
  }

  private isComposableFile(symbol: Symbol): boolean {
    const fileId = symbol.file_id;
    const allSymbols = this.indexManager.getSymbolsByName('');
    const fileSymbols = allSymbols.filter(s => s.file_id === fileId);

    return fileSymbols.some(s =>
      s.symbol_type === 'function' && this.isComposablePattern(s.name)
    );
  }

  cleanup(): void {
    super.cleanup();
    logger.debug('ComposableResolver cleanup complete');
  }
}
