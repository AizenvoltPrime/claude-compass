import { Symbol, File } from '../../../database/models';
import { ISymbolIndexManager, IResolutionContext, SymbolLocation, ExportedSymbol } from '../interfaces';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('symbol-index-manager');

export class SymbolIndexManager implements ISymbolIndexManager {
  private globalSymbolIndex: Map<string, SymbolLocation> = new Map();
  private filePathToIdMap: Map<string, number> = new Map();
  private fileIdToPathMap: Map<number, string> = new Map();
  private symbolIdToSymbolMap: Map<number, Symbol> = new Map();

  private symbolsByName: Map<string, Symbol[]> = new Map();
  private exportedSymbols: Map<string, ExportedSymbol[]> = new Map();
  private interfaceToImplementationsMap: Map<string, Symbol[]> = new Map();

  buildGlobalIndex(files: File[], symbols: Symbol[]): void {
    this.globalSymbolIndex.clear();
    this.filePathToIdMap.clear();
    this.fileIdToPathMap.clear();
    this.symbolIdToSymbolMap.clear();

    for (const file of files) {
      this.filePathToIdMap.set(file.path, file.id);
      this.fileIdToPathMap.set(file.id, file.path);
    }

    for (const symbol of symbols) {
      this.symbolIdToSymbolMap.set(symbol.id, symbol);

      if (symbol.qualified_name) {
        this.globalSymbolIndex.set(symbol.qualified_name, {
          fileId: symbol.file_id,
          symbolId: symbol.id,
          filePath: files.find(f => f.id === symbol.file_id)?.path || '',
        });
      }

      if (symbol.name && symbol.symbol_type === 'class') {
        const fileContext = files.find(f => f.id === symbol.file_id);
        if (fileContext) {
          const key = `${fileContext.path}::${symbol.name}`;
          this.globalSymbolIndex.set(key, {
            fileId: symbol.file_id,
            symbolId: symbol.id,
            filePath: fileContext.path,
          });
        }
      }
    }

    logger.info('Global symbol index built', {
      totalSymbols: this.globalSymbolIndex.size,
      files: files.length,
      symbols: symbols.length,
    });
  }

  buildTransientIndexes(
    contexts: IResolutionContext[],
    allSymbols: Symbol[],
    implementsDependencies?: Array<{ fromSymbolId: number; toSymbolId: number }>
  ): void {
    this.symbolsByName.clear();
    this.exportedSymbols.clear();
    this.interfaceToImplementationsMap.clear();

    for (const context of contexts) {
      for (const symbol of context.symbols) {
        const existing = this.symbolsByName.get(symbol.name) || [];
        existing.push(symbol);
        this.symbolsByName.set(symbol.name, existing);

        if (symbol.is_exported) {
          const exportedList = this.exportedSymbols.get(symbol.name) || [];
          exportedList.push({ symbol, fromFile: context.fileId });
          this.exportedSymbols.set(symbol.name, exportedList);
        }
      }
    }

    // Build interface-to-implementation map from actual IMPLEMENTS dependencies
    // This uses the type system, not string parsing
    if (implementsDependencies && implementsDependencies.length > 0) {
      const symbolIdMap = new Map<number, Symbol>();
      for (const symbol of allSymbols) {
        symbolIdMap.set(symbol.id, symbol);
      }

      for (const { fromSymbolId, toSymbolId } of implementsDependencies) {
        const implClass = symbolIdMap.get(fromSymbolId);
        const interfaceSymbol = symbolIdMap.get(toSymbolId);

        if (implClass && interfaceSymbol) {
          const implementations = this.interfaceToImplementationsMap.get(interfaceSymbol.name) || [];
          implementations.push(implClass);
          this.interfaceToImplementationsMap.set(interfaceSymbol.name, implementations);
        }
      }
    }

    logger.debug('Transient indexes built', {
      symbolsByName: this.symbolsByName.size,
      exportedSymbols: this.exportedSymbols.size,
      interfaceMappings: this.interfaceToImplementationsMap.size,
    });
  }

  getSymbolById(symbolId: number): Symbol | undefined {
    return this.symbolIdToSymbolMap.get(symbolId);
  }

  getSymbolsByName(name: string): Symbol[] {
    return this.symbolsByName.get(name) || [];
  }

  getSymbolsByFileId(fileId: number): Symbol[] {
    const symbols: Symbol[] = [];
    for (const symbolList of this.symbolsByName.values()) {
      for (const symbol of symbolList) {
        if (symbol.file_id === fileId) {
          symbols.push(symbol);
        }
      }
    }
    return symbols;
  }

  getExportedSymbols(name: string): ExportedSymbol[] {
    return this.exportedSymbols.get(name) || [];
  }

  getSymbolByQualifiedName(qualifiedName: string): Symbol | null {
    const indexEntry = this.globalSymbolIndex.get(qualifiedName);
    if (!indexEntry) {
      return null;
    }

    return this.symbolIdToSymbolMap.get(indexEntry.symbolId) || null;
  }

  getFileId(filePath: string): number | undefined {
    return this.filePathToIdMap.get(filePath);
  }

  getFilePath(fileId: number): string | undefined {
    return this.fileIdToPathMap.get(fileId);
  }

  clearTransient(): void {
    this.symbolsByName.clear();
    this.exportedSymbols.clear();
    this.interfaceToImplementationsMap.clear();
    logger.debug('Transient indexes cleared');
  }

  clearAll(): void {
    this.globalSymbolIndex.clear();
    this.filePathToIdMap.clear();
    this.symbolIdToSymbolMap.clear();
    this.symbolsByName.clear();
    this.exportedSymbols.clear();
    this.interfaceToImplementationsMap.clear();
    logger.debug('All indexes cleared');
  }

  getStats(): {
    globalSymbols: number;
    transientSymbols: number;
    exportedSymbols: number;
    files: number;
  } {
    return {
      globalSymbols: this.globalSymbolIndex.size,
      transientSymbols: this.symbolsByName.size,
      exportedSymbols: this.exportedSymbols.size,
      files: this.filePathToIdMap.size,
    };
  }

  findImplementingClasses(interfaceId: number): Symbol[] {
    const interfaceSymbol = this.symbolIdToSymbolMap.get(interfaceId);
    if (!interfaceSymbol) {
      return [];
    }

    return this.interfaceToImplementationsMap.get(interfaceSymbol.name) || [];
  }
}
