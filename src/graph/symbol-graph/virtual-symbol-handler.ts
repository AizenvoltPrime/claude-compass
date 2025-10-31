import { SymbolNode, SymbolEdge } from './types';
import { SymbolResolver } from '../symbol-resolver';

export function extractVirtualSymbolNodes(edges: SymbolEdge[], existingNodes: SymbolNode[], symbolResolver: SymbolResolver): SymbolNode[] {
  const existingIds = new Set(existingNodes.map(n => n.id));
  const virtualSymbols = symbolResolver.getVirtualSymbols();
  const virtualNodes: SymbolNode[] = [];

  for (const symbol of virtualSymbols) {
    if (!existingIds.has(symbol.id)) {
      virtualNodes.push({
        id: symbol.id,
        name: symbol.name,
        type: symbol.symbol_type,
        fileId: symbol.file_id,
        startLine: symbol.start_line || 1,
        endLine: symbol.end_line || 1,
        isExported: symbol.is_exported || true,
        visibility: symbol.visibility,
        signature: symbol.signature,
      });
    }
  }

  return virtualNodes;
}
