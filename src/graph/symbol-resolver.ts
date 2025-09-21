import { Symbol, File } from '../database/models';
import { ParsedDependency, ParsedImport, ParsedExport } from '../parsers/base';
import { createComponentLogger } from '../utils/logger';

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
  confidence: number;
}

/**
 * File-aware symbol resolver that respects import/export relationships
 * and file boundaries when resolving symbol dependencies.
 */
export class SymbolResolver {
  private fileContexts: Map<number, SymbolResolutionContext> = new Map();
  private symbolsByName: Map<string, Symbol[]> = new Map();
  private exportedSymbols: Map<string, { symbol: Symbol; fromFile: number }[]> = new Map();
  private logger: any;

  constructor() {
    this.logger = logger;
  }

  /**
   * Initialize the resolver with file contexts
   */
  initialize(
    files: File[],
    allSymbols: Symbol[],
    importsMap: Map<number, ParsedImport[]>,
    exportsMap: Map<number, ParsedExport[]>
  ): void {
    this.logger.info('Initializing symbol resolver', {
      fileCount: files.length,
      symbolCount: allSymbols.length
    });

    // Clear existing data
    this.fileContexts.clear();
    this.symbolsByName.clear();
    this.exportedSymbols.clear();

    // Build file contexts
    for (const file of files) {
      const fileSymbols = allSymbols.filter(s => s.file_id === file.id);
      const fileImports = importsMap.get(file.id) || [];
      const fileExports = exportsMap.get(file.id) || [];

      this.fileContexts.set(file.id, {
        fileId: file.id,
        filePath: file.path,
        symbols: fileSymbols,
        imports: fileImports,
        exports: fileExports
      });

      // Index symbols by name
      for (const symbol of fileSymbols) {
        const existing = this.symbolsByName.get(symbol.name) || [];
        existing.push(symbol);
        this.symbolsByName.set(symbol.name, existing);

        // Index exported symbols
        if (symbol.is_exported) {
          const exportedList = this.exportedSymbols.get(symbol.name) || [];
          exportedList.push({ symbol, fromFile: file.id });
          this.exportedSymbols.set(symbol.name, exportedList);
        }
      }
    }

    this.logger.info('Symbol resolver initialized', {
      fileContextsCreated: this.fileContexts.size,
      uniqueSymbolNames: this.symbolsByName.size,
      exportedSymbolNames: this.exportedSymbols.size
    });
  }

  /**
   * Resolve dependencies with file-aware context validation
   */
  resolveDependencies(
    sourceFileId: number,
    dependencies: ParsedDependency[]
  ): ResolvedDependency[] {
    const sourceContext = this.fileContexts.get(sourceFileId);
    if (!sourceContext) {
      this.logger.warn('No context found for source file', { sourceFileId });
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
        this.logger.error('Failed to resolve dependency', {
          dependency,
          sourceFile: sourceContext.filePath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return resolved;
  }

  /**
   * Resolve a single dependency with proper scope validation
   */
  private resolveSingleDependency(
    sourceContext: SymbolResolutionContext,
    dependency: ParsedDependency
  ): ResolvedDependency | null {
    // Find the source symbol in the current file
    let fromSymbol = sourceContext.symbols.find(s => s.name === dependency.from_symbol);

    // If not found and from_symbol contains dots (qualified name), try extracting just the method name
    if (!fromSymbol && dependency.from_symbol.includes('.')) {
      const methodName = dependency.from_symbol.split('.').pop();
      if (methodName) {
        fromSymbol = sourceContext.symbols.find(s => s.name === methodName);
        // Don't log if we found it via the fallback - this is expected for C# qualified names
      }
    }

    if (!fromSymbol) {
      // Only log if we couldn't resolve even with the fallback
      this.logger.debug('Source symbol not found in file context', {
        symbolName: dependency.from_symbol,
        filePath: sourceContext.filePath
      });
      return null;
    }

    // Resolve the target symbol with proper scoping
    const toSymbol = this.resolveTargetSymbol(sourceContext, dependency.to_symbol);
    if (!toSymbol) {
      this.logger.debug('Target symbol could not be resolved', {
        symbolName: dependency.to_symbol,
        filePath: sourceContext.filePath
      });
      return null;
    }

    // Calculate confidence based on resolution method
    const confidence = this.calculateConfidence(sourceContext, toSymbol, dependency);

    return {
      fromSymbol,
      toSymbol,
      originalDependency: dependency,
      confidence
    };
  }

  /**
   * Resolve target symbol using proper scoping rules
   */
  private resolveTargetSymbol(
    sourceContext: SymbolResolutionContext,
    targetSymbolName: string
  ): Symbol | null {
    // Check if this is an object.method pattern (e.g., "areasStore.getAreas")
    if (targetSymbolName.includes('.')) {
      const memberExpressionSymbol = this.resolveMemberExpression(sourceContext, targetSymbolName);
      if (memberExpressionSymbol) {
        this.logger.debug('Resolved member expression symbol', {
          symbolName: targetSymbolName,
          filePath: sourceContext.filePath
        });
        return memberExpressionSymbol;
      }
    }

    // 1. First check local file scope
    const localSymbol = sourceContext.symbols.find(s => s.name === targetSymbolName);
    if (localSymbol) {
      this.logger.debug('Resolved symbol in local scope', {
        symbolName: targetSymbolName,
        filePath: sourceContext.filePath
      });
      return localSymbol;
    }

    // 2. Check imported symbols
    const importedSymbol = this.resolveImportedSymbol(sourceContext, targetSymbolName);
    if (importedSymbol) {
      this.logger.debug('Resolved imported symbol', {
        symbolName: targetSymbolName,
        filePath: sourceContext.filePath
      });
      return importedSymbol;
    }

    // 3. Check for store method patterns (Pinia stores)
    const storeMethodSymbol = this.resolveStoreMethod(sourceContext, targetSymbolName);
    if (storeMethodSymbol) {
      this.logger.debug('Resolved store method symbol', {
        symbolName: targetSymbolName,
        filePath: sourceContext.filePath
      });
      return storeMethodSymbol;
    }

    // 4. As a fallback, check if it's a globally exported symbol
    // But only if there's a single unambiguous match
    const exportedOptions = this.exportedSymbols.get(targetSymbolName) || [];
    if (exportedOptions.length === 1) {
      this.logger.debug('Resolved globally exported symbol', {
        symbolName: targetSymbolName,
        filePath: sourceContext.filePath,
        exportedFrom: exportedOptions[0].fromFile
      });
      return exportedOptions[0].symbol;
    }

    // 5. If multiple matches exist, we cannot resolve without explicit import
    if (exportedOptions.length > 1) {
      this.logger.debug('Ambiguous symbol resolution - multiple exports found', {
        symbolName: targetSymbolName,
        filePath: sourceContext.filePath,
        exportCount: exportedOptions.length
      });
    }

    return null;
  }

  /**
   * Resolve member expressions like "areasStore.getAreas"
   */
  private resolveMemberExpression(
    sourceContext: SymbolResolutionContext,
    memberExpression: string
  ): Symbol | null {
    const dotIndex = memberExpression.indexOf('.');
    if (dotIndex === -1) return null;

    const objectName = memberExpression.substring(0, dotIndex);
    const methodName = memberExpression.substring(dotIndex + 1);

    this.logger.debug('Resolving member expression', {
      fullExpression: memberExpression,
      objectName,
      methodName,
      filePath: sourceContext.filePath
    });

    // Strategy 1: Check if objectName is directly imported
    for (const importDecl of sourceContext.imports) {
      if (this.importIncludesSymbol(importDecl, objectName)) {
        // Find the target file that exports this object
        const targetSymbol = this.findMethodInImportedObject(importDecl, objectName, methodName);
        if (targetSymbol) {
          this.logger.debug('Resolved member expression via direct import', {
            objectName,
            methodName,
            targetFile: targetSymbol.file_id
          });
          return targetSymbol;
        }
      }
    }

    // Strategy 2: Check for store patterns (useAreasStore -> areasStore.getAreas)
    const storeMethodSymbol = this.resolveStoreMethodFromExpression(sourceContext, objectName, methodName);
    if (storeMethodSymbol) {
      this.logger.debug('Resolved member expression via store pattern', {
        objectName,
        methodName,
        targetFile: storeMethodSymbol.file_id
      });
      return storeMethodSymbol;
    }

    // Strategy 3: Look for object declarations in local file
    const localObject = sourceContext.symbols.find(s => s.name === objectName);
    if (localObject) {
      // Check if there's a method with the target name in the same file
      const localMethod = sourceContext.symbols.find(s =>
        s.name === methodName &&
        (s.symbol_type === 'method' || s.symbol_type === 'function')
      );
      if (localMethod) {
        this.logger.debug('Resolved member expression in local scope', {
          objectName,
          methodName
        });
        return localMethod;
      }
    }

    // C# class-based resolution for qualified method names
    const csharpMethodSymbol = this.resolveCSharpClassMethod(objectName, methodName);
    if (csharpMethodSymbol) {
      return csharpMethodSymbol;
    }

    return null;
  }

  private resolveCSharpClassMethod(className: string, methodName: string): Symbol | null {

    // Find all methods with the target name across all files
    const candidateMethods = this.symbolsByName.get(methodName) || [];

    for (const method of candidateMethods) {
      // Check if this method belongs to a file that contains the specified class
      const fileContext = this.fileContexts.get(method.file_id);
      if (!fileContext) continue;

      // Look for a class symbol with the matching name in the same file
      const classSymbol = fileContext.symbols.find(s =>
        s.name === className &&
        (s.symbol_type === 'class' || s.symbol_type === 'interface')
      );

      if (classSymbol) {
        // Verify the method is within the class boundaries
        const isMethodInClass = method.start_line >= classSymbol.start_line &&
                               method.end_line <= classSymbol.end_line;

        if (isMethodInClass) {
          return method;
        }
      }
    }

    // Fallback: try to match interface patterns (IClassName -> ClassName)
    if (className.length > 1 && !className.startsWith('I')) {
      const interfaceName = `I${className}`;

      // Recursively try with interface name
      const interfaceMethod = this.resolveCSharpClassMethod(interfaceName, methodName);
      if (interfaceMethod) {
        return interfaceMethod;
      }
    }


    return null;
  }

  /**
   * Find a method in an imported object
   */
  private findMethodInImportedObject(
    importDecl: ParsedImport,
    objectName: string,
    methodName: string
  ): Symbol | null {
    // Find symbols that match the method name from exported symbols
    const exportedOptions = this.exportedSymbols.get(methodName) || [];

    for (const exported of exportedOptions) {
      const fileContext = this.fileContexts.get(exported.fromFile);
      if (fileContext) {
        // Check if this file could be the source of the import
        // This is a simplified check - in a full implementation we'd resolve the import path
        const hasObjectWithMethod = fileContext.symbols.some(s =>
          s.name === methodName &&
          (s.symbol_type === 'method' || s.symbol_type === 'function')
        );

        if (hasObjectWithMethod) {
          return exported.symbol;
        }
      }
    }

    return null;
  }

  /**
   * Resolve store method from member expression (enhanced store pattern resolution)
   */
  private resolveStoreMethodFromExpression(
    sourceContext: SymbolResolutionContext,
    objectName: string,
    methodName: string
  ): Symbol | null {
    // Check if objectName matches a store pattern (e.g., "areasStore" from "useAreasStore")
    const storeFactory = this.inferStoreFactoryFromObjectName(objectName);
    if (storeFactory) {
      // Check if this store factory is imported
      const hasStoreImport = sourceContext.imports.some(imp =>
        this.importIncludesSymbol(imp, storeFactory)
      );

      if (hasStoreImport) {
        const storeName = this.getStoreNameFromFactory(storeFactory);
        return this.findStoreMethod(storeName, methodName);
      }
    }

    return null;
  }

  /**
   * Infer store factory name from object name (e.g., "areasStore" -> "useAreasStore")
   */
  private inferStoreFactoryFromObjectName(objectName: string): string | null {
    // Pattern: "areasStore" -> "useAreasStore"
    if (objectName.endsWith('Store')) {
      const baseName = objectName.substring(0, objectName.length - 5); // Remove "Store"
      return `use${baseName.charAt(0).toUpperCase()}${baseName.slice(1)}Store`;
    }

    return null;
  }

  /**
   * Resolve symbol through import relationships
   */
  private resolveImportedSymbol(
    sourceContext: SymbolResolutionContext,
    targetSymbolName: string
  ): Symbol | null {
    for (const importDecl of sourceContext.imports) {
      // Check if this import includes the target symbol
      if (this.importIncludesSymbol(importDecl, targetSymbolName)) {
        // Find the exported symbol from the source file
        const targetSymbol = this.findExportedSymbolByImport(importDecl, targetSymbolName);
        if (targetSymbol) {
          return targetSymbol;
        }
      }
    }

    return null;
  }

  /**
   * Check if an import declaration includes a specific symbol
   */
  private importIncludesSymbol(importDecl: ParsedImport, symbolName: string): boolean {
    // Named imports
    if (importDecl.imported_names?.includes(symbolName)) {
      return true;
    }

    // Default import (symbol name would match the import alias)
    if (importDecl.import_type === 'default' && importDecl.imported_names?.[0] === symbolName) {
      return true;
    }

    // Namespace import (would need to be accessed as namespace.symbol)
    if (importDecl.import_type === 'namespace') {
      // This is more complex and would require tracking namespace usage
      // For now, we don't resolve these to avoid false positives
      return false;
    }

    return false;
  }

  /**
   * Find exported symbol based on import declaration
   */
  private findExportedSymbolByImport(
    importDecl: ParsedImport,
    symbolName: string
  ): Symbol | null {
    // This would require resolving the import source path to a file ID
    // For now, we'll use a simplified approach based on exported symbols
    const exportedOptions = this.exportedSymbols.get(symbolName) || [];

    // If there's only one exported symbol with this name, use it
    if (exportedOptions.length === 1) {
      return exportedOptions[0].symbol;
    }

    // TODO: Implement proper path resolution to match import source to file
    // This would involve resolving relative/absolute paths, node_modules, etc.

    return null;
  }

  /**
   * Resolve store method calls (Pinia store pattern)
   * Handles patterns like: vehiclesStore.createVehicle()
   * where vehiclesStore comes from useVehiclesStore()
   */
  private resolveStoreMethod(
    sourceContext: SymbolResolutionContext,
    targetSymbolName: string
  ): Symbol | null {
    // Look for store factory imports (e.g., useVehiclesStore, useCamerasStore)
    for (const importDecl of sourceContext.imports) {
      // Check if this is a store factory import pattern
      const storeFactoryName = this.getStoreFactoryFromImport(importDecl);
      if (storeFactoryName) {
        // Derive the store name from the factory (e.g., useVehiclesStore -> vehicles)
        const storeName = this.getStoreNameFromFactory(storeFactoryName);

        // Look for a method with the target name in stores that match this pattern
        const storeMethodSymbol = this.findStoreMethod(storeName, targetSymbolName);
        if (storeMethodSymbol) {
          this.logger.debug('Resolved store method via factory pattern', {
            factoryName: storeFactoryName,
            storeName,
            methodName: targetSymbolName,
            filePath: sourceContext.filePath
          });
          return storeMethodSymbol;
        }
      }
    }

    return null;
  }

  /**
   * Extract store factory name from import declaration
   * Returns name if it matches pattern like 'useXxxStore'
   */
  private getStoreFactoryFromImport(importDecl: ParsedImport): string | null {
    if (importDecl.imported_names) {
      for (const name of importDecl.imported_names) {
        if (name.startsWith('use') && name.endsWith('Store')) {
          return name;
        }
      }
    }
    return null;
  }

  /**
   * Derive store name from factory function name
   * useVehiclesStore -> vehicles, useCamerasStore -> cameras
   */
  private getStoreNameFromFactory(factoryName: string): string {
    // Remove 'use' prefix and 'Store' suffix, convert to lowercase
    return factoryName
      .substring(3) // Remove 'use'
      .slice(0, -5) // Remove 'Store'
      .toLowerCase();
  }

  /**
   * Find a method in stores that match the given store name pattern
   */
  private findStoreMethod(storeName: string, methodName: string): Symbol | null {
    // Look through all exported symbols for store files that contain the method
    for (const [symbolName, exportedList] of this.exportedSymbols) {
      if (symbolName === methodName) {
        // Check if any of the exported symbols are from a store file that matches our pattern
        for (const exported of exportedList) {
          const fileContext = this.fileContexts.get(exported.fromFile);
          if (fileContext && this.isStoreFile(fileContext.filePath, storeName)) {
            // Look for the method in this store file
            const method = fileContext.symbols.find(s =>
              s.name === methodName &&
              (s.symbol_type === 'method' || s.symbol_type === 'function')
            );
            if (method) {
              return method;
            }
          }
        }
      }
    }

    // Also check by scanning all store files directly
    for (const [fileId, context] of this.fileContexts) {
      if (this.isStoreFile(context.filePath, storeName)) {
        const method = context.symbols.find(s =>
          s.name === methodName &&
          (s.symbol_type === 'method' || s.symbol_type === 'function')
        );
        if (method) {
          return method;
        }
      }
    }

    return null;
  }

  /**
   * Check if a file path represents a store file for the given store name
   */
  private isStoreFile(filePath: string, storeName: string): boolean {
    // Check for common store file patterns
    const fileName = filePath.toLowerCase();

    // Pattern 1: vehiclesStore.ts, vehiclesStore.js
    if (fileName.includes(`${storeName}store.`)) {
      return true;
    }

    // Pattern 2: stores/vehicles.ts, stores/vehicles.js
    if (fileName.includes(`stores/${storeName}.`)) {
      return true;
    }

    // Pattern 3: stores/vehiclesStore.ts
    if (fileName.includes('stores/') && fileName.includes(`${storeName}store.`)) {
      return true;
    }

    return false;
  }

  /**
   * Calculate confidence score for a resolved dependency
   */
  private calculateConfidence(
    sourceContext: SymbolResolutionContext,
    targetSymbol: Symbol,
    dependency: ParsedDependency
  ): number {
    // Base confidence
    let confidence = 0.5;

    // Same file - higher confidence
    if (targetSymbol.file_id === sourceContext.fileId) {
      confidence = 0.9;
    }
    // Explicitly imported - high confidence
    else if (this.isExplicitlyImported(sourceContext, targetSymbol.name)) {
      confidence = 0.8;
    }
    // Store method resolution - high confidence
    else if (this.isStoreMethodResolution(sourceContext, targetSymbol)) {
      confidence = 0.85;
    }
    // Single global export - medium confidence
    else {
      const exportedOptions = this.exportedSymbols.get(targetSymbol.name) || [];
      if (exportedOptions.length === 1) {
        confidence = 0.6;
      } else {
        // Multiple exports - lower confidence
        confidence = 0.3;
      }
    }

    // Adjust based on dependency type
    switch (dependency.dependency_type) {
      case 'calls':
        confidence *= 1.0; // Function calls are usually explicit
        break;
      case 'references':
        confidence *= 0.8; // References might be less certain
        break;
      case 'imports':
        confidence = 0.95; // Imports are very explicit
        break;
      default:
        confidence *= 0.7;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Check if a symbol is explicitly imported in the file
   */
  private isExplicitlyImported(sourceContext: SymbolResolutionContext, symbolName: string): boolean {
    return sourceContext.imports.some(imp => this.importIncludesSymbol(imp, symbolName));
  }

  /**
   * Check if this is a store method resolution (high confidence pattern)
   */
  private isStoreMethodResolution(sourceContext: SymbolResolutionContext, targetSymbol: Symbol): boolean {
    // Check if target symbol is a method in a store file
    if (targetSymbol.symbol_type !== 'method' && targetSymbol.symbol_type !== 'function') {
      return false;
    }

    // Check if source file imports any store factories
    for (const importDecl of sourceContext.imports) {
      const storeFactoryName = this.getStoreFactoryFromImport(importDecl);
      if (storeFactoryName) {
        const storeName = this.getStoreNameFromFactory(storeFactoryName);
        const targetFileContext = this.fileContexts.get(targetSymbol.file_id);
        if (targetFileContext && this.isStoreFile(targetFileContext.filePath, storeName)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get statistics about resolution success
   */
  getResolutionStats(): {
    totalFiles: number;
    totalSymbols: number;
    exportedSymbols: number;
    ambiguousExports: number;
  } {
    let ambiguousCount = 0;
    for (const [name, exports] of this.exportedSymbols) {
      if (exports.length > 1) {
        ambiguousCount++;
      }
    }

    return {
      totalFiles: this.fileContexts.size,
      totalSymbols: Array.from(this.symbolsByName.values()).flat().length,
      exportedSymbols: this.exportedSymbols.size,
      ambiguousExports: ambiguousCount
    };
  }
}