import { SymbolType, DependencyType } from '../../database/models';

export interface SymbolNode {
  id: number;
  name: string;
  qualifiedName?: string;
  type: SymbolType;
  fileId: number;
  startLine: number;
  endLine: number;
  isExported: boolean;
  visibility?: 'public' | 'private' | 'protected';
  signature?: string;
}

export interface SymbolEdge {
  from: number;
  to: number;
  type: DependencyType;
  lineNumber: number;
  to_qualified_name?: string;
  parameter_context?: string;
  call_instance_id?: string;
  parameter_types?: string[];
  calling_object?: string;
  qualified_context?: string;
  resolved_class?: string;
}

export interface SymbolGraphData {
  nodes: SymbolNode[];
  edges: SymbolEdge[];
}

export interface CallChain {
  symbols: SymbolNode[];
  depth: number;
}
