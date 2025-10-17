import { Symbol, SymbolType } from '../../../database/models';
import { ParsedDependency } from '../../../parsers/base';
import { IResolutionContext, SymbolResolutionResult, Language } from '../interfaces';
import { BaseLanguageResolver } from './base-language-resolver';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('csharp-resolver');

interface FieldTypeMap {
  [fieldName: string]: string;
}

export class CSharpResolver extends BaseLanguageResolver {
  readonly name = 'CSharpResolver';
  readonly supportedLanguages: Language[] = ['csharp'];
  readonly priority = 100;

  canResolve(context: IResolutionContext, _targetSymbol: string, _dependency?: ParsedDependency): boolean {
    return context.language === 'csharp';
  }

  resolve(
    context: IResolutionContext,
    targetSymbol: string,
    dependency?: ParsedDependency
  ): SymbolResolutionResult | null {
    this.initializeFieldTypeContext(context);

    try {
      if (dependency?.resolved_class && !targetSymbol.includes('.')) {
        const classMethodSymbol = this.resolveCSharpClassMethod(
          dependency.resolved_class,
          targetSymbol
        );
        if (classMethodSymbol) {
          this.logResolution(true, targetSymbol, 'resolved_class', context);
          return this.createHighConfidenceResult(classMethodSymbol, 'csharp:resolved_class');
        }
      }

      if (dependency?.qualified_context?.startsWith('field_call_')) {
        const fieldName = dependency.qualified_context.replace('field_call_', '');
        const fieldTypeSymbol = this.resolveFieldBasedCall(context, fieldName, targetSymbol);
        if (fieldTypeSymbol) {
          this.logResolution(true, targetSymbol, 'field_call', context);
          return this.createHighConfidenceResult(fieldTypeSymbol, 'csharp:field_call');
        }
      }

      if (targetSymbol.includes('.')) {
        const qualifiedSymbol = this.resolveQualifiedName(context, targetSymbol);
        if (qualifiedSymbol) {
          this.logResolution(true, targetSymbol, 'qualified_name', context);
          return this.createHighConfidenceResult(qualifiedSymbol, 'csharp:qualified_name');
        }
      }

      const localSymbol = this.resolveInLocalScope(context, targetSymbol);
      if (localSymbol) {
        this.logResolution(true, targetSymbol, 'local_scope', context);
        return this.createHighConfidenceResult(localSymbol, 'csharp:local_scope');
      }

      const exportedSymbol = this.resolveFromExports(targetSymbol);
      if (exportedSymbol) {
        this.logResolution(true, targetSymbol, 'exports', context);
        return this.createMediumConfidenceResult(exportedSymbol, 'csharp:exports');
      }

      this.logResolution(false, targetSymbol, undefined, context);
      return null;
    } finally {
      this.clearFieldTypeContext(context);
    }
  }

  private initializeFieldTypeContext(context: IResolutionContext): void {
    if (context.hasLanguageContext('csharp:fieldTypes')) {
      return;
    }

    const fieldTypeMap: FieldTypeMap = {};
    const classSymbols = context.symbols.filter(s => s.symbol_type === SymbolType.CLASS);

    if (classSymbols.length > 0) {
      const fieldSymbols = context.symbols.filter(
        s => s.symbol_type === SymbolType.PROPERTY || s.symbol_type === SymbolType.VARIABLE
      );

      for (const fieldSymbol of fieldSymbols) {
        if (fieldSymbol.signature) {
          const fieldTypeMatch = fieldSymbol.signature.match(/^(\w+(?:<.*?>)?)\s+(\w+)/);
          if (fieldTypeMatch) {
            const fieldType = fieldTypeMatch[1];
            const fieldName = fieldTypeMatch[2];

            fieldTypeMap[fieldName] = fieldType;

            if (fieldType.startsWith('I') && fieldType.length > 1) {
              const className = fieldType.substring(1);
              fieldTypeMap[fieldName] = className;
            }
          }
        }
      }
    }

    context.setLanguageContext('csharp:fieldTypes', fieldTypeMap);
  }

  private clearFieldTypeContext(context: IResolutionContext): void {
    if (context.hasLanguageContext('csharp:fieldTypes')) {
      context.setLanguageContext('csharp:fieldTypes', {});
    }
  }

  private resolveFieldBasedCall(
    context: IResolutionContext,
    fieldName: string,
    targetSymbol: string
  ): Symbol | null {
    const fieldTypeMap = context.getLanguageContext<FieldTypeMap>('csharp:fieldTypes');
    if (!fieldTypeMap || !fieldTypeMap[fieldName]) {
      return null;
    }

    const fieldType = fieldTypeMap[fieldName];

    if (targetSymbol.includes('.')) {
      const dotIndex = targetSymbol.indexOf('.');
      const methodName = targetSymbol.substring(dotIndex + 1);
      return this.resolveCSharpClassMethod(fieldType, methodName);
    }

    return this.resolveCSharpClassMethod(fieldType, targetSymbol);
  }

  private resolveQualifiedName(context: IResolutionContext, qualifiedName: string): Symbol | null {
    const dotIndex = qualifiedName.indexOf('.');
    if (dotIndex === -1) {
      return null;
    }

    const className = qualifiedName.substring(0, dotIndex);
    const methodName = qualifiedName.substring(dotIndex + 1);

    const fieldTypeMap = context.getLanguageContext<FieldTypeMap>('csharp:fieldTypes');
    if (fieldTypeMap && className.startsWith('_') && fieldTypeMap[className]) {
      const fieldType = fieldTypeMap[className];
      return this.resolveCSharpClassMethod(fieldType, methodName);
    }

    return this.resolveCSharpClassMethod(className, methodName);
  }

  private resolveCSharpClassMethod(className: string, methodName: string): Symbol | null {
    const candidateMethods = this.indexManager.getSymbolsByName(methodName);

    const expectedQualifiedNameEnding = `${className}.${methodName}`;

    for (const method of candidateMethods) {
      if (method.qualified_name) {
        const endsWithPattern =
          method.qualified_name === expectedQualifiedNameEnding ||
          method.qualified_name.endsWith(`.${expectedQualifiedNameEnding}`);

        if (endsWithPattern) {
          return method;
        }
      }
    }

    for (const method of candidateMethods) {
      const methodSymbol = this.indexManager.getSymbolById(method.id);
      if (!methodSymbol) {
        continue;
      }

      const classSymbols = this.indexManager.getSymbolsByName(className);
      for (const classSymbol of classSymbols) {
        if (
          classSymbol.symbol_type === 'class' ||
          classSymbol.symbol_type === 'interface'
        ) {
          if (methodSymbol.file_id === classSymbol.file_id) {
            const isMethodInClass =
              methodSymbol.start_line >= classSymbol.start_line &&
              methodSymbol.end_line <= classSymbol.end_line;

            if (isMethodInClass) {
              return methodSymbol;
            }
          }
        }
      }
    }

    return null;
  }

  cleanup(): void {
    super.cleanup();
    logger.debug('CSharpResolver cleanup complete');
  }
}
