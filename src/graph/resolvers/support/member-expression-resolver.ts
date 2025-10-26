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

    // Handle variables that reference stores/composables
    // Example: const userStore = useUserStore() where signature is "useUserStore()"
    if (baseObject.symbol_type === 'variable' || baseObject.symbol_type === 'constant') {
      const actualContainer = this.resolveVariableContainer(baseObject, indexManager);
      if (actualContainer) {
        const typeRelatedSymbols = this.findMembersOfType(actualContainer, finalMember.name, indexManager);
        if (typeRelatedSymbols.length > 0) {
          logger.debug('Resolved member via variable container', {
            variable: baseObject.name,
            container: actualContainer.name,
            containerType: actualContainer.entity_type,
            member: finalMember.name,
            resolvedId: typeRelatedSymbols[0].id,
          });
          return typeRelatedSymbols[0];
        }
      }
    }

    if (baseObject.symbol_type === 'class' || baseObject.symbol_type === 'interface') {
      const typeRelatedSymbols = this.findMembersOfType(baseObject, finalMember.name, indexManager);
      if (typeRelatedSymbols.length > 0) {
        return typeRelatedSymbols[0];
      }
    }

    // Only allow cross-file resolution if there's an import relationship
    // This prevents false positives like marker.setMap() → sentinelStore.setMap
    const importedCandidates: Symbol[] = [];

    for (const candidate of candidateSymbols) {
      // Same file - always allowed
      if (candidate.file_id === context.fileId) {
        importedCandidates.push(candidate);
        continue;
      }

      // Cross-file - check if candidate's file is imported
      const isImported = context.imports.some(importDecl => {
        // Check if any exported symbol from this import comes from candidate's file
        const exportedSymbols = indexManager.getExportedSymbols(importDecl.source);
        return exportedSymbols.some(exp => exp.fromFile === candidate.file_id);
      });

      if (isImported) {
        importedCandidates.push(candidate);
      } else {
        logger.debug('Excluding cross-file candidate without import', {
          baseObject: baseObject.name,
          member: finalMember.name,
          candidateId: candidate.id,
          candidateFileId: candidate.file_id,
        });
      }
    }

    if (importedCandidates.length === 0) {
      logger.debug('No valid candidates after import filtering', {
        baseObject: baseObject.name,
        member: finalMember.name,
        totalCandidates: candidateSymbols.length,
        contextFile: context.filePath,
      });
      return null;
    }

    // Apply language preference if multiple candidates
    if (importedCandidates.length > 1) {
      const isFrontendBase = this.isFrontendFile(context.filePath);

      const preferredCandidates = importedCandidates.filter(candidate => {
        const candidateFilePath = indexManager.getFilePath(candidate.file_id);
        if (!candidateFilePath) return false;

        const isFrontendCandidate = this.isFrontendFile(candidateFilePath);
        return isFrontendBase === isFrontendCandidate;
      });

      if (preferredCandidates.length > 0) {
        logger.debug('Resolved via language preference', {
          baseObject: baseObject.name,
          member: finalMember.name,
          selectedId: preferredCandidates[0].id,
        });
        return preferredCandidates[0];
      }
    }

    logger.debug('Resolved via import relationship', {
      baseObject: baseObject.name,
      member: finalMember.name,
      selectedId: importedCandidates[0].id,
      totalFiltered: candidateSymbols.length - importedCandidates.length,
    });
    return importedCandidates[0];
  }

  /**
   * Resolve the actual container (store/composable) from a variable's signature.
   *
   * Handles patterns like:
   * - const userStore = useUserStore() → resolves to useUserStore symbol
   * - const authComposable = useAuth() → resolves to useAuth symbol
   *
   * This enables proper method resolution for Pinia stores and Vue composables.
   */
  private resolveVariableContainer(
    variable: Symbol,
    indexManager: ISymbolIndexManager
  ): Symbol | null {
    if (!variable.signature) {
      return null;
    }

    // Extract function call from signature: "useUserStore()" → "useUserStore"
    const functionCallMatch = variable.signature.match(/^(\w+)\s*\(/);
    if (!functionCallMatch) {
      return null;
    }

    const containerName = functionCallMatch[1];
    const containerCandidates = indexManager.getSymbolsByName(containerName);

    // Find the store/composable definition
    // Prefer symbols with entity_type = 'store' or 'composable'
    for (const candidate of containerCandidates) {
      if (candidate.entity_type === 'store' ||
          candidate.entity_type === 'composable' ||
          candidate.entity_type === 'component') {
        logger.debug('Resolved variable container', {
          variable: variable.name,
          variableSignature: variable.signature,
          container: candidate.name,
          containerType: candidate.entity_type,
          containerId: candidate.id,
        });
        return candidate;
      }
    }

    // Fallback: if no entity_type match, use the first candidate if it's a reasonable container type
    for (const candidate of containerCandidates) {
      if (candidate.symbol_type === 'function' ||
          candidate.symbol_type === 'variable' ||
          candidate.symbol_type === 'class') {
        logger.debug('Resolved variable container (fallback)', {
          variable: variable.name,
          container: candidate.name,
          containerType: candidate.symbol_type,
          containerId: candidate.id,
        });
        return candidate;
      }
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
