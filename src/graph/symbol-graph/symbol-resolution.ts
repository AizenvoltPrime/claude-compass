import { DependencyType, SymbolType } from '../../database/models';
import { SymbolNode, SymbolEdge } from './types';
import { parseQualifiedName, stripGenericParameters } from './name-parsing-utils';
import { isExternalReference, isInstanceMemberAccess } from './language-detection-utils';
import { isSignatureClassMember, isLikelyPartialClassMember } from './symbol-lookup-utils';

export function buildInterfaceToImplementationMap(
  nodes: SymbolNode[],
  edges: SymbolEdge[],
  logger: any
): Map<string, SymbolNode[]> {
  const interfaceMap = new Map<string, SymbolNode[]>();
  const nodeMap = new Map<number, SymbolNode>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const inheritanceEdges = edges.filter(edge =>
    edge.type === DependencyType.INHERITS || edge.type === DependencyType.IMPLEMENTS
  );

  for (const edge of inheritanceEdges) {
    const implementingClass = nodeMap.get(edge.from);
    const interfaceOrBase = nodeMap.get(edge.to);

    if (implementingClass && interfaceOrBase) {
      const existing = interfaceMap.get(interfaceOrBase.name) || [];
      existing.push(implementingClass);
      interfaceMap.set(interfaceOrBase.name, existing);

      logger.debug('Interface mapping created', {
        interface: interfaceOrBase.name,
        implementation: implementingClass.name,
        edgeType: edge.type
      });
    }
  }

  return interfaceMap;
}

export function findClassMembers(
  classSymbol: SymbolNode,
  memberSymbols: SymbolNode[],
  memberName: string
): SymbolNode[] {
  const matches: SymbolNode[] = [];

  const fileMemberSymbols = memberSymbols.filter(member =>
    member.fileId === classSymbol.fileId && member.name === memberName
  );

  for (const memberSymbol of fileMemberSymbols) {
    if (isSignatureClassMember(memberSymbol, classSymbol.name)) {
      matches.push(memberSymbol);
      continue;
    }

    if (memberSymbol.startLine >= classSymbol.startLine) {
      matches.push(memberSymbol);
      continue;
    }

    if (classSymbol.type === 'class' && isLikelyPartialClassMember(memberSymbol, classSymbol)) {
      matches.push(memberSymbol);
    }
  }


  return matches;
}

export function findEnumMembers(
  enumName: string,
  memberName: string,
  memberSymbols: SymbolNode[]
): SymbolNode[] {
  const matches: SymbolNode[] = [];
  const expectedQualifiedName = `${enumName}.${memberName}`;

  for (const memberSymbol of memberSymbols) {
    if (memberSymbol.signature === expectedQualifiedName) {
      matches.push(memberSymbol);
      continue;
    }

    if (memberSymbol.name === memberName && memberSymbol.type === 'constant') {
      matches.push(memberSymbol);
    }
  }

  return matches;
}

export function enhancedSymbolLookup(
  targetName: string,
  nameToSymbolMap: Map<string, SymbolNode[]>,
  interfaceMap: Map<string, SymbolNode[]>,
  seenExternalPatterns: Set<string>,
  suppressedExternalCount: { value: number },
  suppressedAmbiguousCount: { value: number },
  logger: any
): SymbolNode[] {
  const strippedName = stripGenericParameters(targetName);
  const isExternal = isExternalReference(strippedName);
  const isInstanceAccess = isInstanceMemberAccess(strippedName);

  const parsed = parseQualifiedName(strippedName);

  if (parsed.qualifier) {
    const attemptKey = `attempt:${parsed.qualifier}.${parsed.memberName}`;
    if (!seenExternalPatterns.has(attemptKey)) {
      logger.debug('Attempting qualified name resolution', {
        targetName,
        qualifier: parsed.qualifier,
        memberName: parsed.memberName
      });
      seenExternalPatterns.add(attemptKey);
    } else {
      suppressedExternalCount.value++;
    }

    const qualifierSymbols = nameToSymbolMap.get(parsed.qualifier) || [];
    const memberSymbols = nameToSymbolMap.get(parsed.memberName) || [];

    const qualifiedMatches: SymbolNode[] = [];
    for (const qualifierSymbol of qualifierSymbols) {
      if (qualifierSymbol.type === 'class' || qualifierSymbol.type === 'interface') {
        const classMembers = findClassMembers(
          qualifierSymbol,
          memberSymbols,
          parsed.memberName
        );
        qualifiedMatches.push(...classMembers);
      }

      if (qualifierSymbol.type === 'enum') {
        const enumMembers = findEnumMembers(
          parsed.qualifier,
          parsed.memberName,
          memberSymbols
        );
        qualifiedMatches.push(...enumMembers);
      }
    }

    if (qualifiedMatches.length > 0) {
      logger.debug('Qualified name resolution successful', {
        targetName,
        qualifier: parsed.qualifier,
        memberName: parsed.memberName,
        matchCount: qualifiedMatches.length
      });

      return qualifiedMatches;
    }

    const implementingClasses = interfaceMap.get(parsed.qualifier) || [];

    if (implementingClasses.length > 0) {
      logger.debug('Attempting interface-to-implementation resolution', {
        interface: parsed.qualifier,
        implementationCount: implementingClasses.length
      });

      const interfaceResolutionMatches: SymbolNode[] = [];
      for (const implementingClass of implementingClasses) {
        if (implementingClass.type === 'class') {
          const memberSymbols = nameToSymbolMap.get(parsed.memberName) || [];
          const classMembers = findClassMembers(
            implementingClass,
            memberSymbols,
            parsed.memberName
          );
          interfaceResolutionMatches.push(...classMembers);

        }
      }

      if (interfaceResolutionMatches.length > 0) {
        logger.debug('Interface-to-implementation resolution successful', {
          targetName,
          interface: parsed.qualifier,
          matchCount: interfaceResolutionMatches.length
        });

        return interfaceResolutionMatches;
      }
    }

    const fallbackMatches = nameToSymbolMap.get(parsed.memberName) || [];
    const patternKey = `${parsed.qualifier}.${parsed.memberName}`;
    const shouldLog = !seenExternalPatterns.has(patternKey);

    if (fallbackMatches.length > 0) {
      if (isExternal || isInstanceAccess) {
        if (shouldLog) {
          logger.debug('External/instance reference - qualified resolution failed, skipping fallback', {
            targetName,
            qualifier: parsed.qualifier,
            memberName: parsed.memberName,
            isExternal,
            isInstanceAccess,
            potentialMatches: fallbackMatches.length
          });
          seenExternalPatterns.add(patternKey);
        } else {
          suppressedExternalCount.value++;
        }
        return [];
      }

      if (shouldLog) {
        logger.debug('Qualified name resolution failed, using simple name fallback', {
          targetName,
          qualifier: parsed.qualifier,
          memberName: parsed.memberName,
          fallbackMatchCount: fallbackMatches.length
        });
        seenExternalPatterns.add(patternKey);
      } else {
        suppressedExternalCount.value++;
      }

      return fallbackMatches;
    }

    if (shouldLog) {
      const logLevel = isExternal || isInstanceAccess ? 'debug' : 'warn';
      logger[logLevel]('Qualified name resolution failed, no fallback matches found', {
        targetName,
        qualifier: parsed.qualifier,
        memberName: parsed.memberName,
        isExternal,
        isInstanceAccess
      });
      seenExternalPatterns.add(patternKey);
    } else {
      suppressedExternalCount.value++;
    }

    return [];
  }

  const simpleMatches = nameToSymbolMap.get(parsed.memberName) || [];

  logger.debug('Simple name resolution', {
    targetName,
    matchCount: simpleMatches.length
  });

  return simpleMatches;
}
