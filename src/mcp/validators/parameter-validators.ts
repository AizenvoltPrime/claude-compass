import { MIN_DEPTH, MAX_DEPTH } from '../constants';
import {
  GetFileArgs,
  GetSymbolArgs,
  SearchCodeArgs,
  WhoCallsArgs,
  ListDependenciesArgs,
  ImpactOfArgs,
  IdentifyModulesArgs,
  TraceFlowArgs,
} from '../types';

export function validateMaxDepthParameter(value: any): void {
  if (value === undefined) return;

  if (typeof value !== 'number') {
    throw new Error('max_depth must be a number');
  }

  if (!Number.isInteger(value)) {
    throw new Error('max_depth must be an integer');
  }

  if (value < MIN_DEPTH || value > MAX_DEPTH) {
    throw new Error(`max_depth must be between ${MIN_DEPTH} and ${MAX_DEPTH}`);
  }
}

export function validateGetFileArgs(args: any): GetFileArgs {
  if (!args.file_id && !args.file_path) {
    throw new Error('Either file_id or file_path must be provided');
  }
  if (args.file_id && typeof args.file_id !== 'number') {
    throw new Error('file_id must be a number');
  }
  if (args.file_path && typeof args.file_path !== 'string') {
    throw new Error('file_path must be a string');
  }
  return args as GetFileArgs;
}

export function validateGetSymbolArgs(args: any): GetSymbolArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  return args as GetSymbolArgs;
}

export function validateSearchCodeArgs(args: any): SearchCodeArgs {
  if (args.repo_id !== undefined) {
    throw new Error('repo_id parameter removed. Use repo_ids array instead');
  }
  if (args.symbol_type !== undefined) {
    throw new Error('symbol_type parameter removed. Use entity_types array instead');
  }
  if (args.limit !== undefined) {
    throw new Error('limit parameter removed. Fixed limit of 100 is now used for all searches');
  }
  if (args.use_vector !== undefined) {
    throw new Error(
      'use_vector parameter removed. Use search_mode instead: "vector" for vector search, "exact" for lexical, "auto" for hybrid'
    );
  }

  if (!args.query || typeof args.query !== 'string') {
    throw new Error('query is required and must be a string');
  }
  if (args.is_exported !== undefined && typeof args.is_exported !== 'boolean') {
    throw new Error('is_exported must be a boolean');
  }

  if (args.entity_types !== undefined) {
    if (!Array.isArray(args.entity_types)) {
      throw new Error('entity_types must be an array');
    }
    const validEntityTypes = [
      'route',
      'model',
      'controller',
      'component',
      'job',
      'function',
      'class',
      'interface',
      'scene',
      'node',
      'script',
      'autoload',
    ];
    for (const entityType of args.entity_types) {
      if (typeof entityType !== 'string' || !validEntityTypes.includes(entityType)) {
        throw new Error(`entity_types must contain valid types: ${validEntityTypes.join(', ')}`);
      }
    }
  }

  if (args.framework !== undefined && typeof args.framework !== 'string') {
    throw new Error('framework must be a string');
  }

  if (args.repo_ids !== undefined) {
    if (!Array.isArray(args.repo_ids)) {
      throw new Error('repo_ids must be an array');
    }
    for (const repoId of args.repo_ids) {
      if (typeof repoId !== 'number') {
        throw new Error('repo_ids must contain only numbers');
      }
    }
  }

  if (args.search_mode !== undefined) {
    const validModes = ['auto', 'exact', 'vector', 'qualified'];
    if (typeof args.search_mode !== 'string' || !validModes.includes(args.search_mode)) {
      throw new Error('search_mode must be one of: auto, exact, vector, qualified');
    }
  }

  return args as SearchCodeArgs;
}

export function validateWhoCallsArgs(args: any): WhoCallsArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.dependency_type !== undefined && typeof args.dependency_type !== 'string') {
    throw new Error('dependency_type must be a string');
  }
  if (args.include_cross_stack !== undefined && typeof args.include_cross_stack !== 'boolean') {
    throw new Error('include_cross_stack must be a boolean');
  }
  validateMaxDepthParameter(args.max_depth);
  return args as WhoCallsArgs;
}

export function validateListDependenciesArgs(args: any): ListDependenciesArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.dependency_type !== undefined && typeof args.dependency_type !== 'string') {
    throw new Error('dependency_type must be a string');
  }
  if (args.include_cross_stack !== undefined && typeof args.include_cross_stack !== 'boolean') {
    throw new Error('include_cross_stack must be a boolean');
  }
  validateMaxDepthParameter(args.max_depth);
  return args as ListDependenciesArgs;
}

export function validateImpactOfArgs(args: any): ImpactOfArgs {
  if (args.symbol_id === undefined || args.symbol_id === null) {
    throw new Error('symbol_id is required');
  }
  if (typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id must be a number');
  }
  if (args.symbol_id <= 0) {
    throw new Error('symbol_id must be a positive number');
  }
  if (args.frameworks !== undefined && !Array.isArray(args.frameworks)) {
    throw new Error('frameworks must be an array');
  }
  validateMaxDepthParameter(args.max_depth);
  return args as ImpactOfArgs;
}

export function validateIdentifyModulesArgs(args: any): IdentifyModulesArgs {
  if (args.repo_id !== undefined && typeof args.repo_id !== 'number') {
    throw new Error('repo_id must be a number');
  }
  if (args.min_module_size !== undefined && typeof args.min_module_size !== 'number') {
    throw new Error('min_module_size must be a number');
  }
  if (args.resolution !== undefined && typeof args.resolution !== 'number') {
    throw new Error('resolution must be a number');
  }
  return args as IdentifyModulesArgs;
}

export function validateTraceFlowArgs(args: any): TraceFlowArgs {
  if (!args.start_symbol_id || typeof args.start_symbol_id !== 'number') {
    throw new Error('start_symbol_id is required and must be a number');
  }
  if (!args.end_symbol_id || typeof args.end_symbol_id !== 'number') {
    throw new Error('end_symbol_id is required and must be a number');
  }
  if (args.find_all_paths !== undefined && typeof args.find_all_paths !== 'boolean') {
    throw new Error('find_all_paths must be a boolean');
  }
  validateMaxDepthParameter(args.max_depth);
  return args as TraceFlowArgs;
}
