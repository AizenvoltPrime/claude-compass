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

    return this.resolveNestedMember(resolvedObject, memberPath, indexManager, context);
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
    indexManager: ISymbolIndexManager,
    context: IResolutionContext
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
      logger.info('Using fallback symbol resolution for nested member', {
        baseObject: baseObject.name,
        baseObjectType: baseObject.symbol_type,
        member: finalMember.name,
        candidateCount: candidateSymbols.length,
        contextFile: context.filePath,
      });

      // When multiple candidates exist, prefer symbols from the same language/stack
      // For Pinia stores (TypeScript), prefer store methods over backend controller methods
      if (candidateSymbols.length > 1) {
        // Determine if base object is from frontend or backend based on context
        const isFrontendBase = this.isFrontendFile(context.filePath);

        logger.info('Multiple candidates found, applying disambiguation', {
          baseObject: baseObject.name,
          member: finalMember.name,
          totalCandidates: candidateSymbols.length,
          candidateFiles: candidateSymbols.map(c => ({
            id: c.id,
            file_id: c.file_id,
            type: c.symbol_type
          })),
          isFrontendBase,
        });

        // Filter candidates by language preference
        const preferredCandidates = candidateSymbols.filter(candidate => {
          const candidateFilePath = indexManager.getFilePath(candidate.file_id);
          if (!candidateFilePath) {
            logger.warn('Could not get file path for candidate', {
              candidateId: candidate.id,
              fileId: candidate.file_id,
            });
            return false;
          }

          const isFrontendCandidate = this.isFrontendFile(candidateFilePath);
          logger.info('Checking candidate', {
            candidateId: candidate.id,
            candidatePath: candidateFilePath,
            isFrontendCandidate,
            matches: isFrontendBase === isFrontendCandidate,
          });
          return isFrontendBase === isFrontendCandidate;
        });

        if (preferredCandidates.length > 0 && preferredCandidates.length < candidateSymbols.length) {
          logger.info('Filtered candidates by language preference', {
            baseObject: baseObject.name,
            member: finalMember.name,
            contextFile: context.filePath,
            total: candidateSymbols.length,
            preferred: preferredCandidates.length,
            isFrontend: isFrontendBase,
            selectedId: preferredCandidates[0].id,
          });
          return preferredCandidates[0];
        } else {
          logger.info('Disambiguation did not filter candidates', {
            preferredCount: preferredCandidates.length,
            totalCount: candidateSymbols.length,
            reason: preferredCandidates.length === 0 ? 'No preferred candidates' : 'All candidates match preference',
          });
        }
      }

      logger.info('Returning first candidate without filtering', {
        candidateId: candidateSymbols[0].id,
        candidateName: candidateSymbols[0].name,
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

  private isFrontendFile(filePath: string): boolean {
    // Laravel-specific frontend paths
    if (filePath.includes('/resources/js/') || filePath.includes('/resources/ts/')) {
      return true;
    }

    // Common frontend directory patterns
    if (
      filePath.includes('/frontend/') ||
      filePath.includes('/client/') ||
      filePath.includes('/src/components/') ||
      filePath.includes('/src/pages/') ||
      filePath.includes('/src/views/')
    ) {
      return true;
    }

    // Vue/React component files (but not in backend directories)
    if (filePath.match(/\.(vue|tsx|jsx)$/) !== null && !filePath.includes('/app/')) {
      return true;
    }

    return false;
  }
}
