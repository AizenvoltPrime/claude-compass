import { SymbolNode } from './types';

export function createNameToSymbolMap(nodes: SymbolNode[]): Map<string, SymbolNode[]> {
  const map = new Map<string, SymbolNode[]>();

  for (const node of nodes) {
    const existing = map.get(node.name) || [];
    existing.push(node);
    map.set(node.name, existing);
  }

  return map;
}

export function getSymbolClassName(symbol: SymbolNode, allNodes: SymbolNode[], fileIdToPath: Map<number, string> = new Map()): string {
  const classNodes = allNodes.filter(n =>
    n.type === 'class' &&
    n.fileId === symbol.fileId &&
    n.startLine <= symbol.startLine &&
    n.endLine >= symbol.endLine
  );


  if (classNodes.length > 0) {
    classNodes.sort((a, b) => (b.endLine - b.startLine) - (a.endLine - a.startLine));
    return classNodes[classNodes.length - 1].name;
  }

  return '';
}

export function isSignatureClassMember(memberSymbol: SymbolNode, _className: string): boolean {
  if (!memberSymbol.signature) {
    return false;
  }

  const isMethodInClass =
    memberSymbol.type === 'method' &&
    (memberSymbol.visibility === 'public' ||
     memberSymbol.visibility === 'private' ||
     memberSymbol.visibility === 'protected');

  return isMethodInClass;
}

export function isLikelyPartialClassMember(memberSymbol: SymbolNode, classSymbol: SymbolNode): boolean {
  return (
    memberSymbol.fileId === classSymbol.fileId &&
    memberSymbol.type === 'method' &&
    classSymbol.type === 'class' &&
    (memberSymbol.visibility === 'public' ||
     memberSymbol.visibility === 'private' ||
     memberSymbol.visibility === 'protected')
  );
}
