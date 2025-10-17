import { Symbol } from '../../../database/models';
import { IMemberExpressionResolver, IResolutionContext, ISymbolIndexManager, MemberExpressionPart } from '../interfaces';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('member-expression-resolver');

export class MemberExpressionResolver implements IMemberExpressionResolver {
  parse(expression: string): MemberExpressionPart[] {
    if (!expression.includes('.')) {
      return [
        {
          name: expression,
          isLast: true,
          fullPath: expression,
        },
      ];
    }

    const parts = expression.split('.');
    return parts.map((part, index) => ({
      name: part,
      isLast: index === parts.length - 1,
      fullPath: parts.slice(0, index + 1).join('.'),
    }));
  }

  resolve(
    expression: string,
    context: IResolutionContext,
    indexManager: ISymbolIndexManager
  ): Symbol | null {
    const parts = this.parse(expression);

    if (parts.length === 1) {
      const symbols = indexManager.getSymbolsByName(parts[0].name);
      return symbols.find(s => s.file_id === context.fileId) || symbols[0] || null;
    }

    const objectName = parts[0].name;
    const memberPath = parts.slice(1);

    const resolvedObject = this.resolveObjectReference(objectName, context, indexManager);
    if (!resolvedObject) {
      logger.debug('Could not resolve object reference', { objectName, expression });
      return null;
    }

    return this.resolveNestedMember(resolvedObject, memberPath, indexManager);
  }

  private resolveObjectReference(
    objectName: string,
    context: IResolutionContext,
    indexManager: ISymbolIndexManager
  ): Symbol | null {
    const localSymbol = context.symbols.find(s => s.name === objectName);
    if (localSymbol) {
      return localSymbol;
    }

    const importedSymbol = this.resolveImportedObject(objectName, context, indexManager);
    if (importedSymbol) {
      return importedSymbol;
    }

    const exportedSymbols = indexManager.getExportedSymbols(objectName);
    if (exportedSymbols.length === 1) {
      return exportedSymbols[0].symbol;
    }

    const symbolsByName = indexManager.getSymbolsByName(objectName);
    if (symbolsByName.length > 0) {
      return symbolsByName[0];
    }

    return null;
  }

  private resolveImportedObject(
    objectName: string,
    context: IResolutionContext,
    indexManager: ISymbolIndexManager
  ): Symbol | null {
    for (const importDecl of context.imports) {
      if (importDecl.imported_names?.includes(objectName)) {
        const exportedSymbols = indexManager.getExportedSymbols(objectName);
        if (exportedSymbols.length > 0) {
          return exportedSymbols[0].symbol;
        }
      }
    }

    return null;
  }

  private resolveNestedMember(
    baseObject: Symbol,
    memberPath: MemberExpressionPart[],
    indexManager: ISymbolIndexManager
  ): Symbol | null {
    const finalMember = memberPath[memberPath.length - 1];

    const candidateSymbols = indexManager.getSymbolsByName(finalMember.name);

    const symbolsInSameFile = candidateSymbols.filter(s => s.file_id === baseObject.file_id);
    if (symbolsInSameFile.length > 0) {
      return this.selectBestMatch(symbolsInSameFile, baseObject);
    }

    if (baseObject.symbol_type === 'class' || baseObject.symbol_type === 'interface') {
      const typeRelatedSymbols = this.findMembersOfType(baseObject, finalMember.name, indexManager);
      if (typeRelatedSymbols.length > 0) {
        return typeRelatedSymbols[0];
      }
    }

    if (candidateSymbols.length > 0) {
      logger.debug('Using fallback symbol resolution for nested member', {
        baseObject: baseObject.name,
        member: finalMember.name,
        candidateCount: candidateSymbols.length,
      });
      return candidateSymbols[0];
    }

    return null;
  }

  private findMembersOfType(
    typeSymbol: Symbol,
    memberName: string,
    indexManager: ISymbolIndexManager
  ): Symbol[] {
    const candidateSymbols = indexManager.getSymbolsByName(memberName);

    return candidateSymbols.filter(s => {
      if (s.file_id !== typeSymbol.file_id) {
        return false;
      }

      if (s.symbol_type === 'method' || s.symbol_type === 'property' || s.symbol_type === 'function') {
        const isWithinType =
          s.start_line >= typeSymbol.start_line && s.end_line <= typeSymbol.end_line;
        return isWithinType;
      }

      return false;
    });
  }

  private selectBestMatch(candidates: Symbol[], baseObject: Symbol): Symbol {
    const methodsAndProperties = candidates.filter(
      s => s.symbol_type === 'method' || s.symbol_type === 'property' || s.symbol_type === 'function'
    );

    if (methodsAndProperties.length > 0) {
      const withinObject = methodsAndProperties.filter(
        s => s.start_line >= baseObject.start_line && s.end_line <= baseObject.end_line
      );

      if (withinObject.length > 0) {
        return withinObject[0];
      }

      return methodsAndProperties[0];
    }

    return candidates[0];
  }
}
