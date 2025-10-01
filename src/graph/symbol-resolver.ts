import { Symbol, File, SymbolType } from '../database/models';
import { ParsedDependency, ParsedImport, ParsedExport } from '../parsers/base';
import { createComponentLogger } from '../utils/logger';
import { frameworkSymbolRegistry } from '../parsers/framework-symbols';

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
}

/**
 * File-aware symbol resolver that respects import/export relationships
 * and file boundaries when resolving symbol dependencies.
 */
export class SymbolResolver {
  private fileContexts: Map<number, SymbolResolutionContext> = new Map();
  private symbolsByName: Map<string, Symbol[]> = new Map();
  private exportedSymbols: Map<string, { symbol: Symbol; fromFile: number }[]> = new Map();
  private fieldTypeMap: Map<string, string> = new Map(); // NEW: Field type mapping
  private logger: any;

  constructor() {
    this.logger = logger;
  }

  /**
   * Register field type mappings for the current file context
   */
  public setFieldTypeMap(fieldTypeMap: Map<string, string>): void {
    this.fieldTypeMap = fieldTypeMap;
  }

  /**
   * Clear field type mappings (call when switching files)
   */
  public clearFieldTypeMap(): void {
    this.fieldTypeMap.clear();
  }

  /**
   * Extract and set field type context for C# file processing
   */
  private setFieldTypeContextForFile(sourceContext: SymbolResolutionContext): void {
    try {
      // Clear existing field mappings
      this.clearFieldTypeMap();

      // Find class symbols in the file
      const classSymbols = sourceContext.symbols.filter(s => s.symbol_type === SymbolType.CLASS);

      if (classSymbols.length > 0) {
        // For C# files, we need to extract field declarations from the class symbols
        // This is a simplified approach that looks for property symbols (C# fields are often stored as properties)
        const fieldSymbols = sourceContext.symbols.filter(
          s => s.symbol_type === SymbolType.PROPERTY || s.symbol_type === SymbolType.VARIABLE
        );

        for (const fieldSymbol of fieldSymbols) {
          // Extract field type from signature if available
          if (fieldSymbol.signature) {
            const fieldTypeMatch = fieldSymbol.signature.match(/^(\w+(?:<.*?>)?)\s+(\w+)/);
            if (fieldTypeMatch) {
              const fieldType = fieldTypeMatch[1];
              const fieldName = fieldTypeMatch[2];

              this.fieldTypeMap.set(fieldName, fieldType);

              // Handle interface to class mapping (IHandManager -> HandManager)
              if (fieldType.startsWith('I') && fieldType.length > 1) {
                const className = fieldType.substring(1);
                this.fieldTypeMap.set(fieldName, className);
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to set field context for ${sourceContext.filePath}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
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
        exports: fileExports,
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

    // ENHANCED: Set field type context for C# files
    if (sourceContext.filePath.endsWith('.cs')) {
      this.setFieldTypeContextForFile(sourceContext);
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
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // ENHANCED: Clear field context after processing
    if (sourceContext.filePath.endsWith('.cs')) {
      this.clearFieldTypeMap();
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
      return null;
    }

    // Resolve the target symbol with proper scoping
    const toSymbol = this.resolveTargetSymbol(sourceContext, dependency.to_symbol, dependency);
    if (!toSymbol) {
      return null;
    }

    return {
      fromSymbol,
      toSymbol,
      originalDependency: dependency,
    };
  }

  /**
   * Resolve target symbol using proper scoping rules
   */
  private resolveTargetSymbol(
    sourceContext: SymbolResolutionContext,
    targetSymbolName: string,
    dependency?: ParsedDependency
  ): Symbol | null {
    // NEW: Check for field-based calls with context hints
    if (dependency?.qualified_context?.startsWith('field_call_')) {
      const fieldName = dependency.qualified_context.replace('field_call_', '');

      // Try to resolve using field type mapping
      if (this.fieldTypeMap.has(fieldName)) {
        const fieldType = this.fieldTypeMap.get(fieldName);
        if (fieldType && targetSymbolName.includes('.')) {
          // Target already has class context from parser
          const memberResult = this.resolveMemberExpression(sourceContext, targetSymbolName);
          if (memberResult) {
            return memberResult;
          }
        }
      }
    }

    // Check if this is an object.method pattern (e.g., "areasStore.getAreas")
    if (targetSymbolName.includes('.')) {
      const memberExpressionSymbol = this.resolveMemberExpression(sourceContext, targetSymbolName);
      if (memberExpressionSymbol) {
        return memberExpressionSymbol;
      }
    }

    // 1. First check local file scope
    const localSymbol = sourceContext.symbols.find(s => s.name === targetSymbolName);
    if (localSymbol) {
      return localSymbol;
    }

    // 2. Check imported symbols
    const importedSymbol = this.resolveImportedSymbol(sourceContext, targetSymbolName);
    if (importedSymbol) {
      return importedSymbol;
    }

    // 3. Check for store method patterns (Pinia stores)
    const storeMethodSymbol = this.resolveStoreMethod(sourceContext, targetSymbolName);
    if (storeMethodSymbol) {
      return storeMethodSymbol;
    }

    // 4. As a fallback, check if it's a globally exported symbol
    // But only if there's a single unambiguous match
    const exportedOptions = this.exportedSymbols.get(targetSymbolName) || [];
    if (exportedOptions.length === 1) {
      return exportedOptions[0].symbol;
    }

    // 5. If multiple matches exist, we cannot resolve without explicit import

    // 6. As a final fallback, check framework-provided symbols (PHPUnit, Laravel, etc.)
    const frameworkSymbol = this.resolveFrameworkSymbol(
      sourceContext,
      targetSymbolName,
      dependency
    );
    if (frameworkSymbol) {
      return frameworkSymbol;
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

    // Strategy 1: Check if objectName is directly imported
    for (const importDecl of sourceContext.imports) {
      if (this.importIncludesSymbol(importDecl, objectName)) {
        // Find the target file that exports this object
        const targetSymbol = this.findMethodInImportedObject(importDecl, objectName, methodName);
        if (targetSymbol) {
          return targetSymbol;
        }
      }
    }

    // Strategy 2: Check for store patterns (useAreasStore -> areasStore.getAreas)
    const storeMethodSymbol = this.resolveStoreMethodFromExpression(
      sourceContext,
      objectName,
      methodName
    );
    if (storeMethodSymbol) {
      return storeMethodSymbol;
    }

    // Strategy 3: Look for object declarations in local file
    const localObject = sourceContext.symbols.find(s => s.name === objectName);
    if (localObject) {
      // Check if there's a method with the target name in the same file
      const localMethod = sourceContext.symbols.find(
        s => s.name === methodName && (s.symbol_type === 'method' || s.symbol_type === 'function')
      );
      if (localMethod) {
        return localMethod;
      }
    }

    // ENHANCED: C# field-based resolution before class-based resolution
    if (sourceContext.filePath?.endsWith('.cs')) {
      // NEW: Check for field-based method calls first
      if (objectName.startsWith('_') && this.fieldTypeMap.has(objectName)) {
        const fieldType = this.fieldTypeMap.get(objectName);
        if (fieldType) {
          // Resolve field type to target class method
          const classMethodResult = this.resolveCSharpClassMethod(fieldType, methodName);
          if (classMethodResult) {
            return classMethodResult;
          }
        }
      }

      // EXISTING: Direct C# class-based resolution
      const csharpMethodSymbol = this.resolveCSharpClassMethod(objectName, methodName);
      if (csharpMethodSymbol) {
        return csharpMethodSymbol;
      }
    } else {
      // For non-C# files, use original C# class-based resolution
      const csharpMethodSymbol = this.resolveCSharpClassMethod(objectName, methodName);
      if (csharpMethodSymbol) {
        return csharpMethodSymbol;
      }
    }

    return null;
  }

  private resolveCSharpClassMethod(className: string, methodName: string): Symbol | null {
    const candidateMethods = this.symbolsByName.get(methodName) || [];

    const expectedQualifiedNameEnding = `${className}.${methodName}`;

    for (const method of candidateMethods) {
      if (method.qualified_name) {
        if (method.qualified_name.endsWith(expectedQualifiedNameEnding) ||
            method.qualified_name === expectedQualifiedNameEnding) {
          return method;
        }
      }
    }

    for (const method of candidateMethods) {
      if (!method.qualified_name) {
        const fileContext = this.fileContexts.get(method.file_id);
        if (!fileContext) continue;

        const classSymbol = fileContext.symbols.find(
          s => s.name === className && (s.symbol_type === 'class' || s.symbol_type === 'interface')
        );

        if (classSymbol) {
          const isMethodInClass =
            method.start_line >= classSymbol.start_line &&
            method.end_line <= classSymbol.end_line;

          if (isMethodInClass) {
            return method;
          }
        }
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
        const hasObjectWithMethod = fileContext.symbols.some(
          s => s.name === methodName && (s.symbol_type === 'method' || s.symbol_type === 'function')
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
        // First, try to find the exported symbol from internal codebase
        const targetSymbol = this.findExportedSymbolByImport(importDecl, targetSymbolName);
        if (targetSymbol) {
          return targetSymbol;
        }

        // If not found in internal codebase, check if it's from an external library
        const externalSymbol = this.resolveExternalLibrarySymbol(importDecl, targetSymbolName);
        if (externalSymbol) {
          return externalSymbol;
        }
      }
    }

    return null;
  }

  /**
   * Resolve symbols from external libraries (node_modules)
   */
  private resolveExternalLibrarySymbol(
    importDecl: ParsedImport,
    targetSymbolName: string
  ): Symbol | null {
    // Check if this is an import from an external library
    if (!this.isExternalLibraryImport(importDecl.source)) {
      return null;
    }

    // Use framework symbol registry to find the external symbol
    const frameworkSymbol = frameworkSymbolRegistry.isFrameworkSymbolAvailable(
      targetSymbolName,
      this.getExternalLibraryContext(importDecl.source),
      importDecl.source
    );

    if (!frameworkSymbol) {
      return null;
    }

    // Create a virtual Symbol object for the external library symbol
    // Use negative file_id to indicate external library symbol
    const virtualSymbol: Symbol = {
      id: -Math.abs(this.generateSymbolId(targetSymbolName, frameworkSymbol.framework)),
      file_id: -2, // Indicates external library symbol (different from framework-provided -1)
      name: targetSymbolName,
      symbol_type: frameworkSymbol.symbol_type,
      start_line: 1,
      end_line: 1,
      is_exported: true,
      visibility: frameworkSymbol.visibility,
      signature: frameworkSymbol.signature || `${frameworkSymbol.framework}::${targetSymbolName}`,
      description: frameworkSymbol.description,
      framework: frameworkSymbol.framework,
      created_at: new Date(),
      updated_at: new Date(),
    };

    return virtualSymbol;
  }

  /**
   * Check if an import is from an external library (node_modules)
   */
  private isExternalLibraryImport(source: string): boolean {
    // External libraries typically don't start with './' or '../' (relative paths)
    // and don't start with '/' (absolute paths within project)
    return !source.startsWith('./') && !source.startsWith('../') && !source.startsWith('/');
  }

  /**
   * Get the appropriate context for external library symbol resolution
   */
  private getExternalLibraryContext(source: string): string {
    switch (source) {
      case 'vue':
        return 'vue';
      case 'react':
        return 'react';
      default:
        // For built-in browser APIs accessed without imports (like setTimeout, document.querySelector)
        // this won't be called, but we need a default
        return 'javascript';
    }
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
  private findExportedSymbolByImport(importDecl: ParsedImport, symbolName: string): Symbol | null {
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
            const method = fileContext.symbols.find(
              s =>
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
        const method = context.symbols.find(
          s => s.name === methodName && (s.symbol_type === 'method' || s.symbol_type === 'function')
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
   * Check if a symbol is explicitly imported in the file
   */
  private isExplicitlyImported(
    sourceContext: SymbolResolutionContext,
    symbolName: string
  ): boolean {
    return sourceContext.imports.some(imp => this.importIncludesSymbol(imp, symbolName));
  }

  /**
   * Check if this is a store method resolution
   */
  private isStoreMethodResolution(
    sourceContext: SymbolResolutionContext,
    targetSymbol: Symbol
  ): boolean {
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
   * Resolve framework-provided symbols (PHPUnit assertions, Laravel methods, etc.)
   */
  private resolveFrameworkSymbol(
    sourceContext: SymbolResolutionContext,
    targetSymbolName: string,
    dependency?: ParsedDependency
  ): Symbol | null {
    // Determine context based on file path and usage
    let context = 'general';

    // PHP-specific contexts
    if (sourceContext.filePath.endsWith('.php')) {
      if (this.isTestFile(sourceContext.filePath)) {
        context = 'test';
      } else if (this.isValidationContext(dependency, sourceContext)) {
        context = 'validation';
      } else if (this.isRequestContext(dependency, sourceContext)) {
        context = 'request';
      }
    }
    // JavaScript/TypeScript contexts for built-in symbols (not imported)
    else if (
      sourceContext.filePath.endsWith('.vue') ||
      sourceContext.filePath.endsWith('.ts') ||
      sourceContext.filePath.endsWith('.js')
    ) {
      // These are for built-in browser/JavaScript APIs that don't need imports
      context = 'javascript';
    }

    // Try to find a framework symbol
    const frameworkSymbol = frameworkSymbolRegistry.isFrameworkSymbolAvailable(
      targetSymbolName,
      context,
      sourceContext.filePath
    );

    if (!frameworkSymbol) {
      return null;
    }

    // Create a virtual Symbol object for the framework symbol
    // We use a negative file_id to indicate this is a framework-provided symbol
    const virtualSymbol: Symbol = {
      id: -Math.abs(this.generateSymbolId(targetSymbolName, frameworkSymbol.framework)),
      file_id: -1, // Indicates framework-provided symbol
      name: targetSymbolName,
      symbol_type: frameworkSymbol.symbol_type,
      start_line: 1,
      end_line: 1,
      is_exported: true,
      visibility: frameworkSymbol.visibility,
      signature: frameworkSymbol.signature || `${frameworkSymbol.framework}::${targetSymbolName}`,
      description: frameworkSymbol.description,
      framework: frameworkSymbol.framework,
      created_at: new Date(),
      updated_at: new Date(),
    };

    return virtualSymbol;
  }

  /**
   * Check if this is a test file
   */
  private isTestFile(filePath: string): boolean {
    return (
      filePath.includes('/tests/') ||
      filePath.includes('/test/') ||
      filePath.toLowerCase().includes('test.php') ||
      filePath.toLowerCase().includes('spec.php')
    );
  }

  /**
   * Check if this is a validation context (e.g., using validator->errors())
   */
  private isValidationContext(
    dependency?: ParsedDependency,
    sourceContext?: SymbolResolutionContext
  ): boolean {
    if (!dependency || !sourceContext) return false;

    // Check if the dependency involves validation-related objects
    const validationPatterns = ['validator', 'errors', 'rules', 'messages', 'MessageBag'];
    return validationPatterns.some(
      pattern =>
        dependency.to_symbol.toLowerCase().includes(pattern.toLowerCase()) ||
        dependency.from_symbol.toLowerCase().includes(pattern.toLowerCase()) ||
        (dependency.qualified_context &&
          dependency.qualified_context.toLowerCase().includes(pattern.toLowerCase()))
    );
  }

  /**
   * Check if this is a request context
   */
  private isRequestContext(
    dependency?: ParsedDependency,
    sourceContext?: SymbolResolutionContext
  ): boolean {
    if (!dependency || !sourceContext) return false;

    // Check if the dependency involves request-related objects
    const requestPatterns = ['request', 'input', 'validate'];
    return requestPatterns.some(
      pattern =>
        dependency.to_symbol.toLowerCase().includes(pattern.toLowerCase()) ||
        dependency.from_symbol.toLowerCase().includes(pattern.toLowerCase()) ||
        (dependency.qualified_context &&
          dependency.qualified_context.toLowerCase().includes(pattern.toLowerCase()))
    );
  }

  /**
   * Generate a consistent ID for framework symbols
   */
  private generateSymbolId(symbolName: string, framework: string): number {
    // Simple hash function to generate consistent IDs
    let hash = 0;
    const str = `${framework}:${symbolName}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
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
      ambiguousExports: ambiguousCount,
    };
  }
}
