import { Symbol, SymbolType } from '../../../database/models';
import { ParsedDependency, ParsedImport } from '../../../parsers/base';
import { IResolutionContext, SymbolResolutionResult, Language } from '../interfaces';
import { BaseLanguageResolver } from './base-language-resolver';
import { autoloaderRegistry } from '../../../config/autoloader-resolver';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('php-resolver');

interface ImportAlias {
  originalName: string;
  alias: string;
}

export class PHPResolver extends BaseLanguageResolver {
  readonly name = 'PHPResolver';
  readonly supportedLanguages: Language[] = ['php'];
  readonly priority = 100;

  private projectRoot: string = '';

  canResolve(context: IResolutionContext, _targetSymbol: string, _dependency?: ParsedDependency): boolean {
    return context.language === 'php';
  }

  resolve(
    context: IResolutionContext,
    targetSymbol: string,
    dependency?: ParsedDependency
  ): SymbolResolutionResult | null {
    this.initializeImportAliases(context);

    if (targetSymbol.includes('::')) {
      const staticCallSymbol = this.resolveStaticCall(context, targetSymbol);
      if (staticCallSymbol) {
        this.logResolution(true, targetSymbol, 'static_call', context);
        return this.createHighConfidenceResult(staticCallSymbol, 'php:static_call');
      }
    }

    // Handle instance method calls with resolved_class (e.g., $this->service->method())
    // When parser resolves $this->paymentService->processPayment(),
    // it provides resolved_class="PaymentService" to disambiguate the method call
    if (dependency?.resolved_class) {
      // Check if this is a framework class that we shouldn't create dependencies for
      if (this.isFrameworkClass(dependency.resolved_class)) {
        logger.debug('Skipping framework class method call', {
          targetSymbol,
          resolvedClass: dependency.resolved_class,
        });
        // Return null to indicate no local dependency should be created
        // This prevents false positives like $file->store() matching EquipmentController::store
        return null;
      }

      const instanceMethodSymbol = this.resolveInstanceMethodCall(
        context,
        targetSymbol,
        dependency.resolved_class
      );
      if (instanceMethodSymbol) {
        this.logResolution(true, targetSymbol, 'instance_method_call', context);
        return this.createHighConfidenceResult(instanceMethodSymbol, 'php:instance_method');
      }

      // If we have a resolved_class but couldn't find the method, don't fall back to local scope
      // This prevents matching unrelated methods with the same name
      logger.debug('Instance method not found for resolved class, skipping local fallback', {
        targetSymbol,
        resolvedClass: dependency.resolved_class,
      });
      return null;
    }

    // CONSERVATIVE RESOLUTION: If we have a calling_object (instance method call) but couldn't resolve its type,
    // don't fall back to local scope matching. This prevents false positives like:
    // Instance method calls on unresolved types incorrectly matching unrelated local methods
    //
    // Only proceed to local scope if this is:
    // 1. A direct function call (no calling_object), OR
    // 2. A static call (handled above with ::), OR
    // 3. A call where we're confident about the context
    if (dependency?.calling_object) {
      logger.debug('Skipping instance method call with unresolved type to prevent false positives', {
        targetSymbol,
        callingObject: dependency.calling_object,
      });
      return null;
    }

    const localSymbol = this.resolveInLocalScope(context, targetSymbol);
    if (localSymbol) {
      this.logResolution(true, targetSymbol, 'local_scope', context);
      return this.createHighConfidenceResult(localSymbol, 'php:local_scope');
    }

    const importedSymbol = this.resolveFromImports(context, targetSymbol);
    if (importedSymbol) {
      this.logResolution(true, targetSymbol, 'imports', context);
      return this.createHighConfidenceResult(importedSymbol, 'php:imports');
    }

    const exportedSymbol = this.resolveFromExports(targetSymbol);
    if (exportedSymbol) {
      this.logResolution(true, targetSymbol, 'exports', context);
      return this.createMediumConfidenceResult(exportedSymbol, 'php:exports');
    }

    this.logResolution(false, targetSymbol, undefined, context);
    return null;
  }

  setProjectRoot(projectRoot: string): void {
    this.projectRoot = projectRoot;
  }

  private initializeImportAliases(context: IResolutionContext): void {
    if (context.hasLanguageContext('php:importAliases')) {
      return;
    }

    const aliases: ImportAlias[] = [];

    context.setLanguageContext('php:importAliases', aliases);
  }

  private resolveStaticCall(context: IResolutionContext, staticCall: string): Symbol | null {
    const parts = staticCall.split('::');
    if (parts.length !== 2) {
      return null;
    }

    const [className, methodName] = parts;

    const currentNamespace = this.extractNamespace(context);
    const useStatements = context.imports;

    return this.resolvePHPStaticCall(
      className,
      methodName,
      useStatements,
      currentNamespace,
      context.filePath
    );
  }

  private resolvePHPStaticCall(
    className: string,
    methodName: string,
    useStatements: ParsedImport[],
    currentNamespace: string | null,
    contextFilePath: string
  ): Symbol | null {
    const fqn = this.resolvePHPClassName(className, useStatements, currentNamespace);
    if (!fqn) {
      return null;
    }

    const methodFqn = `${fqn}::${methodName}`;
    const symbolByQualifiedName = this.indexManager.getSymbolByQualifiedName(methodFqn);

    if (symbolByQualifiedName) {
      return symbolByQualifiedName;
    }

    if (!this.projectRoot) {
      logger.debug('Project root not set, cannot resolve via autoloader');
      return null;
    }

    const resolvedPath = autoloaderRegistry.resolvePhpClass(fqn, contextFilePath);
    if (!resolvedPath) {
      logger.debug('Could not resolve PHP class to file', { fqn, contextFilePath });
      return null;
    }

    const fileId = this.indexManager.getFileId(resolvedPath);
    if (!fileId) {
      logger.debug('No file ID for resolved path', { resolvedPath });
      return null;
    }

    const methodSymbols = this.indexManager.getSymbolsByName(methodName);
    const method = methodSymbols.find(
      s =>
        s.file_id === fileId &&
        (s.symbol_type === SymbolType.METHOD || s.symbol_type === SymbolType.FUNCTION)
    );

    if (method) {
      logger.debug('Resolved PHP static call via autoloader', {
        className,
        methodName,
        fqn,
        resolvedPath,
        methodId: method.id,
      });
    }

    return method || null;
  }

  private resolvePHPClassName(
    className: string,
    useStatements: ParsedImport[],
    currentNamespace: string | null
  ): string | null {
    const normalizedClassName = className.replace(/^\\/, '');

    for (const useStmt of useStatements) {
      if (!useStmt.imported_names) {
        continue;
      }

      for (const importedName of useStmt.imported_names) {
        const parts = importedName.split('\\');
        const lastPart = parts[parts.length - 1];

        if (lastPart === normalizedClassName || importedName === normalizedClassName) {
          return importedName;
        }

        if (importedName.endsWith(`\\${normalizedClassName}`)) {
          return importedName;
        }
      }
    }

    if (currentNamespace) {
      return `${currentNamespace}\\${normalizedClassName}`;
    }

    return normalizedClassName;
  }

  private extractNamespace(context: IResolutionContext): string | null {
    const namespaceSymbol = context.symbols.find(s => s.symbol_type === 'namespace');
    return namespaceSymbol?.name || null;
  }

  /**
   * Resolve instance method calls using resolved_class context.
   * Example: $this->paymentService->processPayment()
   * - targetSymbol: "processPayment"
   * - resolvedClass: "PaymentService"
   *
   * This disambiguates method calls by finding the method in the correct class,
   * preventing false matches to methods with the same name in other classes.
   */
  private resolveInstanceMethodCall(
    context: IResolutionContext,
    methodName: string,
    resolvedClass: string
  ): Symbol | null {
    const currentNamespace = this.extractNamespace(context);
    const useStatements = context.imports;

    // Resolve the class FQN from the resolved_class name
    const classFqn = this.resolvePHPClassName(resolvedClass, useStatements, currentNamespace);
    if (!classFqn) {
      logger.debug('Could not resolve class FQN for instance method call', {
        resolvedClass,
        methodName,
      });
      return null;
    }

    // Try qualified name lookup first (most precise)
    const methodFqn = `${classFqn}::${methodName}`;
    const symbolByQualifiedName = this.indexManager.getSymbolByQualifiedName(methodFqn);
    if (symbolByQualifiedName) {
      logger.debug('Resolved instance method via qualified name', {
        methodName,
        resolvedClass,
        classFqn,
        methodFqn,
        symbolId: symbolByQualifiedName.id,
      });
      return symbolByQualifiedName;
    }

    // Fallback: Find via autoloader + file lookup
    if (!this.projectRoot) {
      logger.debug('Project root not set, cannot resolve via autoloader');
      return null;
    }

    const resolvedPath = autoloaderRegistry.resolvePhpClass(classFqn, context.filePath);
    if (!resolvedPath) {
      logger.debug('Could not resolve PHP class to file', { classFqn, contextFilePath: context.filePath });
      return null;
    }

    const fileId = this.indexManager.getFileId(resolvedPath);
    if (!fileId) {
      logger.debug('No file ID for resolved path', { resolvedPath });
      return null;
    }

    // Find method in the class file
    const methodSymbols = this.indexManager.getSymbolsByName(methodName);
    const method = methodSymbols.find(
      s => s.file_id === fileId && s.symbol_type === SymbolType.METHOD
    );

    if (method) {
      logger.debug('Resolved instance method via autoloader', {
        methodName,
        resolvedClass,
        classFqn,
        resolvedPath,
        methodId: method.id,
      });
    } else {
      logger.debug('Instance method not found in resolved class file', {
        methodName,
        resolvedClass,
        classFqn,
        resolvedPath,
        fileId,
        availableMethodsWithName: methodSymbols.length,
      });
    }

    return method || null;
  }

  /**
   * Check if a class name is a known framework class.
   * Returns true for Laravel framework classes and PHP built-in classes.
   */
  private isFrameworkClass(className: string): boolean {
    // Laravel framework classes
    const laravelClasses = [
      'UploadedFile', // Illuminate\Http\UploadedFile
      'Request', // Illuminate\Http\Request
      'Response', // Illuminate\Http\Response
      'Collection', // Illuminate\Support\Collection
      'Model', // Illuminate\Database\Eloquent\Model
      'Builder', // Illuminate\Database\Eloquent\Builder (query builder)
      'QueryBuilder', // Illuminate\Database\Query\Builder
      'RedirectResponse', // Illuminate\Http\RedirectResponse
      'JsonResponse', // Illuminate\Http\JsonResponse
      'Validator', // Illuminate\Validation\Validator
      'FormRequest', // Illuminate\Foundation\Http\FormRequest
      'Str', // Illuminate\Support\Str
      'Arr', // Illuminate\Support\Arr
      'Carbon', // Carbon\Carbon (date library)
      'CarbonImmutable', // Carbon\CarbonImmutable
      'Filesystem', // Illuminate\Filesystem\Filesystem
      'Storage', // Illuminate\Support\Facades\Storage
      'File', // Illuminate\Support\Facades\File
    ];

    // PHP built-in classes
    const phpBuiltins = [
      'DateTime',
      'DateTimeImmutable',
      'DateInterval',
      'Exception',
      'PDO',
      'PDOStatement',
      'SplFileInfo',
      'stdClass',
    ];

    const allFrameworkClasses = [...laravelClasses, ...phpBuiltins];

    // Check exact match or class name ends with the framework class
    // Handles both "UploadedFile" and "Illuminate\\Http\\UploadedFile"
    return allFrameworkClasses.some(
      frameworkClass =>
        className === frameworkClass ||
        className.endsWith(`\\${frameworkClass}`) ||
        className.endsWith(`/${frameworkClass}`)
    );
  }

  cleanup(): void {
    super.cleanup();
    logger.debug('PHPResolver cleanup complete');
  }
}
