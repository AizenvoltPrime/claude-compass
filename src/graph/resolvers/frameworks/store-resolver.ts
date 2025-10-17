import { Symbol } from '../../../database/models';
import { ParsedDependency } from '../../../parsers/base';
import { IResolutionContext, SymbolResolutionResult, Language } from '../interfaces';
import { BaseLanguageResolver } from '../languages/base-language-resolver';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('store-resolver');

export class StoreResolver extends BaseLanguageResolver {
  readonly name = 'StoreResolver';
  readonly supportedLanguages: Language[] = ['javascript', 'typescript'];
  readonly priority = 90;

  canResolve(context: IResolutionContext, targetSymbol: string, _dependency?: ParsedDependency): boolean {
    if (context.language !== 'javascript' && context.language !== 'typescript') {
      return false;
    }

    return this.hasStoreImport(context) || this.isStoreMethodPattern(targetSymbol);
  }

  resolve(
    context: IResolutionContext,
    targetSymbol: string,
    dependency?: ParsedDependency
  ): SymbolResolutionResult | null {
    const storeMethodSymbol = this.resolveStoreMethod(context, targetSymbol);
    if (storeMethodSymbol) {
      this.logResolution(true, targetSymbol, 'store_method', context);
      return this.createMediumConfidenceResult(storeMethodSymbol, 'store:method');
    }

    if (targetSymbol.includes('.')) {
      const memberStoreSymbol = this.resolveStoreMethodFromExpression(context, targetSymbol);
      if (memberStoreSymbol) {
        this.logResolution(true, targetSymbol, 'store_member_expression', context);
        return this.createMediumConfidenceResult(memberStoreSymbol, 'store:member_expression');
      }
    }

    this.logResolution(false, targetSymbol, undefined, context);
    return null;
  }

  private hasStoreImport(context: IResolutionContext): boolean {
    return context.imports.some(imp =>
      imp.imported_names?.some(name => name.startsWith('use') && name.endsWith('Store'))
    );
  }

  private isStoreMethodPattern(targetSymbol: string): boolean {
    return targetSymbol.toLowerCase().includes('store') || targetSymbol.includes('.');
  }

  private resolveStoreMethod(context: IResolutionContext, targetSymbolName: string): Symbol | null {
    for (const importDecl of context.imports) {
      const storeFactoryName = this.getStoreFactoryFromImport(importDecl);
      if (storeFactoryName) {
        const storeName = this.getStoreNameFromFactory(storeFactoryName);
        const storeMethodSymbol = this.findStoreMethod(storeName, targetSymbolName);
        if (storeMethodSymbol) {
          return storeMethodSymbol;
        }
      }
    }

    return null;
  }

  private resolveStoreMethodFromExpression(
    context: IResolutionContext,
    memberExpression: string
  ): Symbol | null {
    const dotIndex = memberExpression.indexOf('.');
    if (dotIndex === -1) {
      return null;
    }

    const objectName = memberExpression.substring(0, dotIndex);
    const methodName = memberExpression.substring(dotIndex + 1);

    const storeFactory = this.inferStoreFactoryFromObjectName(objectName);
    if (!storeFactory) {
      return null;
    }

    const hasStoreImport = context.imports.some(imp =>
      this.importIncludesSymbol(imp, storeFactory)
    );

    if (hasStoreImport) {
      const storeName = this.getStoreNameFromFactory(storeFactory);
      return this.findStoreMethod(storeName, methodName);
    }

    return null;
  }

  private getStoreFactoryFromImport(importDecl: any): string | null {
    if (importDecl.imported_names) {
      for (const name of importDecl.imported_names) {
        if (name.startsWith('use') && name.endsWith('Store')) {
          return name;
        }
      }
    }
    return null;
  }

  private getStoreNameFromFactory(factoryName: string): string {
    return factoryName
      .substring(3)
      .slice(0, -5)
      .toLowerCase();
  }

  private inferStoreFactoryFromObjectName(objectName: string): string | null {
    if (objectName.endsWith('Store')) {
      const baseName = objectName.substring(0, objectName.length - 5);
      return `use${baseName.charAt(0).toUpperCase()}${baseName.slice(1)}Store`;
    }

    return null;
  }

  private findStoreMethod(storeName: string, methodName: string): Symbol | null {
    const exportedSymbols = this.indexManager.getExportedSymbols(methodName);

    for (const exported of exportedSymbols) {
      const symbolsByName = this.indexManager.getSymbolsByName(methodName);
      for (const symbol of symbolsByName) {
        if (symbol.file_id === exported.fromFile) {
          const fileId = symbol.file_id;
          const allSymbolsInFile = this.indexManager.getSymbolsByName('');

          const fileSymbols = allSymbolsInFile.filter(s => s.file_id === fileId);
          const fileHasStorePattern = fileSymbols.some(s =>
            s.name.toLowerCase().includes(storeName.toLowerCase())
          );

          if (fileHasStorePattern) {
            logger.debug('Found store method via export matching', {
              storeName,
              methodName,
              fileId,
            });
            return symbol;
          }
        }
      }
    }

    const allSymbols = this.indexManager.getSymbolsByName(methodName);
    for (const symbol of allSymbols) {
      const symbolFile = this.indexManager.getSymbolById(symbol.id);
      if (!symbolFile) {
        continue;
      }

      const allSymbolsInFile = this.indexManager.getSymbolsByName('');
      const fileSymbols = allSymbolsInFile.filter(s => s.file_id === symbol.file_id);

      const hasStoreInFile = fileSymbols.some(s => {
        const name = s.name.toLowerCase();
        return name.includes(storeName) || name.includes('store');
      });

      if (hasStoreInFile) {
        if (
          symbol.symbol_type === 'method' ||
          symbol.symbol_type === 'function'
        ) {
          logger.debug('Found store method via file pattern matching', {
            storeName,
            methodName,
            fileId: symbol.file_id,
          });
          return symbol;
        }
      }
    }

    return null;
  }

  cleanup(): void {
    super.cleanup();
    logger.debug('StoreResolver cleanup complete');
  }
}
