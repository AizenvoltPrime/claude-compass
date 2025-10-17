import { Symbol } from '../../../database/models';
import { ParsedDependency } from '../../../parsers/base';
import {
  ILanguageResolver,
  IResolutionContext,
  ISymbolIndexManager,
  IVirtualSymbolFactory,
  SymbolResolutionResult,
  Language,
} from '../interfaces';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('base-language-resolver');

export abstract class BaseLanguageResolver implements ILanguageResolver {
  abstract readonly name: string;
  abstract readonly supportedLanguages: Language[];
  abstract readonly priority: number;

  protected indexManager!: ISymbolIndexManager;
  protected virtualFactory!: IVirtualSymbolFactory;

  initialize(indexManager: ISymbolIndexManager, virtualFactory: IVirtualSymbolFactory): void {
    this.indexManager = indexManager;
    this.virtualFactory = virtualFactory;
  }

  abstract canResolve(
    context: IResolutionContext,
    targetSymbol: string,
    dependency?: ParsedDependency
  ): boolean;

  abstract resolve(
    context: IResolutionContext,
    targetSymbol: string,
    dependency?: ParsedDependency
  ): SymbolResolutionResult | null;

  cleanup(): void {
    logger.debug(`Cleaning up ${this.name} resolver`);
  }

  protected resolveInLocalScope(context: IResolutionContext, symbolName: string): Symbol | null {
    return context.symbols.find(s => s.name === symbolName) || null;
  }

  protected resolveFromImports(context: IResolutionContext, symbolName: string): Symbol | null {
    for (const importDecl of context.imports) {
      if (this.importIncludesSymbol(importDecl, symbolName)) {
        const exportedSymbols = this.indexManager.getExportedSymbols(symbolName);
        if (exportedSymbols.length === 1) {
          return exportedSymbols[0].symbol;
        }
        if (exportedSymbols.length > 1) {
          logger.debug('Multiple exported symbols found, using first match', {
            symbolName,
            count: exportedSymbols.length,
          });
          return exportedSymbols[0].symbol;
        }
      }
    }
    return null;
  }

  protected resolveFromExports(symbolName: string): Symbol | null {
    const exportedSymbols = this.indexManager.getExportedSymbols(symbolName);
    if (exportedSymbols.length === 1) {
      return exportedSymbols[0].symbol;
    }
    return null;
  }

  protected importIncludesSymbol(importDecl: any, symbolName: string): boolean {
    if (importDecl.imported_names?.includes(symbolName)) {
      return true;
    }

    if (importDecl.import_type === 'default' && importDecl.imported_names?.[0] === symbolName) {
      return true;
    }

    return false;
  }

  protected createHighConfidenceResult(
    symbol: Symbol,
    strategy: string
  ): SymbolResolutionResult {
    return {
      symbol,
      confidence: 'high',
      resolutionStrategy: strategy,
    };
  }

  protected createMediumConfidenceResult(
    symbol: Symbol,
    strategy: string
  ): SymbolResolutionResult {
    return {
      symbol,
      confidence: 'medium',
      resolutionStrategy: strategy,
    };
  }

  protected createLowConfidenceResult(
    symbol: Symbol,
    strategy: string
  ): SymbolResolutionResult {
    return {
      symbol,
      confidence: 'low',
      resolutionStrategy: strategy,
    };
  }

  protected logResolution(
    success: boolean,
    targetSymbol: string,
    strategy?: string,
    context?: IResolutionContext
  ): void {
    if (success) {
      logger.debug(`Resolved symbol using ${strategy}`, {
        resolver: this.name,
        symbol: targetSymbol,
        file: context?.filePath,
      });
    } else {
      logger.debug(`Failed to resolve symbol`, {
        resolver: this.name,
        symbol: targetSymbol,
        file: context?.filePath,
      });
    }
  }
}
