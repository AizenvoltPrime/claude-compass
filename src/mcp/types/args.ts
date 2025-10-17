import { DependencyType } from '../../database/models';

export interface GetFileArgs {
  file_id?: number;
  file_path?: string;
}

export interface GetSymbolArgs {
  symbol_id: number;
}

export interface SearchCodeArgs {
  query: string;
  repo_ids?: number[];
  entity_types?: string[];
  framework?: string;
  is_exported?: boolean;
  search_mode?: 'auto' | 'exact' | 'vector' | 'qualified';
}

export interface WhoCallsArgs {
  symbol_id: number;
  dependency_type?: string;
  include_cross_stack?: boolean;
  max_depth?: number;
}

export interface ListDependenciesArgs {
  symbol_id: number;
  dependency_type?: string;
  include_cross_stack?: boolean;
  max_depth?: number;
}

export interface ImpactOfArgs {
  symbol_id: number;
  frameworks?: string[];
  max_depth?: number;
}

export interface TraceFlowArgs {
  start_symbol_id: number;
  end_symbol_id: number;
  find_all_paths?: boolean;
  max_depth?: number;
}

export interface DiscoverFeatureArgs {
  symbol_id: number;
  include_components?: boolean;
  include_routes?: boolean;
  include_models?: boolean;
  include_tests?: boolean;
  include_callers?: boolean;
  naming_depth?: number;
  max_depth?: number;
  max_symbols?: number;
  min_relevance_score?: number;
}
