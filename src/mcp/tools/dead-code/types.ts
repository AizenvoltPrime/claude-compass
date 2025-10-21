import { Symbol as DatabaseSymbol, File } from '../../../database/models.js';

export type DeadCodeCategory =
  | 'interface_bloat'
  | 'dead_class'
  | 'dead_public_method'
  | 'dead_private_method'
  | 'dead_function'
  | 'unused_export'
  | 'orphaned_implementation';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface DeadCodeSymbol extends DatabaseSymbol {
  file_path: string;
  caller_count: number;
}

export interface DeadCodeEvidence {
  caller_count: number;
  is_public: boolean;
  is_exported: boolean;
  is_private: boolean;
  is_override: boolean;
  interface_name?: string;
  implementation_used: boolean;
  implements_interface: boolean;
}

export interface DeadCodeFinding {
  symbol_id: number;
  name: string;
  symbol_type: string;
  entity_type: string | null;
  line_range: {
    start: number;
    end: number;
  };
  category: DeadCodeCategory;
  confidence: ConfidenceLevel;
  reason: string;
  evidence: DeadCodeEvidence;
}

export interface CategoryGroup {
  category: DeadCodeCategory;
  confidence: ConfidenceLevel;
  symbols: DeadCodeFinding[];
}

export interface FileGroup {
  file_path: string;
  file_id: number;
  dead_symbols_count: number;
  by_category: CategoryGroup[];
}

export interface DeadCodeSummary {
  total_symbols_analyzed: number;
  dead_code_found: number;
  by_category: Record<DeadCodeCategory, number>;
  by_confidence: Record<ConfidenceLevel, number>;
}

export interface DeadCodeResult {
  repository: {
    id: number;
    name: string;
    path: string;
  };
  summary: DeadCodeSummary;
  findings_by_file: FileGroup[];
  notes: string[];
}

export interface DetectDeadCodeParams {
  confidence_threshold?: ConfidenceLevel;
  include_exports?: boolean;
  include_tests?: boolean;
  max_results?: number;
  file_pattern?: string;
}

export interface InterfaceImplementationPair {
  interface_symbol_id: number;
  interface_name: string;
  implementation_symbol_id: number;
  implementation_name: string;
  implementation_class: string;
}

export interface LibraryDetectionResult {
  is_library: boolean;
  indicators: string[];
}
