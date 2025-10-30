import { DependencyType, DependencyWithSymbols } from '../../database/models';

export interface TransitiveAnalysisOptions {
  maxDepth?: number;
  includeTypes?: DependencyType[];
  excludeTypes?: DependencyType[];
  includeCrossStack?: boolean;
  showCallChains?: boolean;
}

export interface TransitiveResult {
  symbolId: number;
  path: number[];
  depth: number;
  dependencies: DependencyWithSymbols[];
  call_chain?: string;
}

export interface TransitiveAnalysisResult {
  results: TransitiveResult[];
  maxDepthReached: number;
  totalPaths: number;
  cyclesDetected: number;
  executionTimeMs: number;
}

export interface CrossStackOptions {
  maxDepth?: number;
  includeTransitive?: boolean;
}

export interface CrossStackImpactResult {
  symbolId: number;
  frontendImpact: TransitiveResult[];
  backendImpact: TransitiveResult[];
  crossStackRelationships: CrossStackRelationship[];
  totalImpactedSymbols: number;
  executionTimeMs: number;
}

export interface CrossStackRelationship {
  fromSymbol: { id: number; name: string; type: string; language: string };
  toSymbol: { id: number; name: string; type: string; language: string };
  relationshipType: DependencyType;
  path: number[];
}

export interface ImportanceRankingConfig {
  betweennessWeight: number;
  degreeWeight: number;
  eigenvectorWeight: number;
  closenessWeight: number;
  semanticWeight: number;
}

export const DEFAULT_IMPORTANCE_CONFIG: ImportanceRankingConfig = {
  betweennessWeight: 0.3,
  degreeWeight: 0.2,
  eigenvectorWeight: 0.15,
  closenessWeight: 0.1,
  semanticWeight: 0.25,
};

export interface SymbolForRanking {
  id: number;
  name: string;
  symbol_type: string;
  file_path?: string;
  depth?: number;
  qualified_name?: string;
}
