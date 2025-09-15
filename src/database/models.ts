/**
 * Database models and TypeScript interfaces for Claude Compass
 */

// Core database models
export interface Repository {
  id: number;
  name: string;
  path: string;
  language_primary?: string;
  framework_stack: string[];
  last_indexed?: Date;
  git_hash?: string;
  created_at: Date;
  updated_at: Date;
}

export interface File {
  id: number;
  repo_id: number;
  path: string;
  language?: string;
  size?: number;
  last_modified?: Date;
  git_hash?: string;
  is_generated: boolean;
  is_test: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Symbol {
  id: number;
  file_id: number;
  name: string;
  symbol_type: SymbolType;
  start_line?: number;
  end_line?: number;
  is_exported: boolean;
  visibility?: Visibility;
  signature?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Dependency {
  id: number;
  from_symbol_id: number;
  to_symbol_id: number;
  dependency_type: DependencyType;
  line_number?: number;
  confidence: number;
  created_at: Date;
  updated_at: Date;
}

// Enum types
export enum SymbolType {
  FUNCTION = 'function',
  CLASS = 'class',
  INTERFACE = 'interface',
  VARIABLE = 'variable',
  CONSTANT = 'constant',
  TYPE_ALIAS = 'type_alias',
  ENUM = 'enum',
  METHOD = 'method',
  PROPERTY = 'property',
}

export enum Visibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  PROTECTED = 'protected',
}

export enum DependencyType {
  CALLS = 'calls',
  IMPORTS = 'imports',
  INHERITS = 'inherits',
  IMPLEMENTS = 'implements',
  REFERENCES = 'references',
  EXPORTS = 'exports',
}

// Input types for creating records
export interface CreateRepository {
  name: string;
  path: string;
  language_primary?: string;
  framework_stack?: string[];
  last_indexed?: Date;
  git_hash?: string;
}

export interface CreateFile {
  repo_id: number;
  path: string;
  language?: string;
  size?: number;
  last_modified?: Date;
  git_hash?: string;
  is_generated?: boolean;
  is_test?: boolean;
}

export interface CreateSymbol {
  file_id: number;
  name: string;
  symbol_type: SymbolType;
  start_line?: number;
  end_line?: number;
  is_exported?: boolean;
  visibility?: Visibility;
  signature?: string;
}

export interface CreateDependency {
  from_symbol_id: number;
  to_symbol_id: number;
  dependency_type: DependencyType;
  line_number?: number;
  confidence?: number;
}

// Query result types with relationships
export interface FileWithRepository extends File {
  repository?: Repository;
}

export interface SymbolWithFile extends Symbol {
  file?: File;
}

export interface SymbolWithFileAndRepository extends Symbol {
  file?: FileWithRepository;
}

export interface DependencyWithSymbols extends Dependency {
  from_symbol?: SymbolWithFile;
  to_symbol?: SymbolWithFile;
}