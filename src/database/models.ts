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

// File dependency for file-to-file relationships (imports, requires, etc.)
export interface FileDependency {
  id: number;
  from_file_id: number;
  to_file_id: number;
  dependency_type: DependencyType;
  line_number?: number;
  confidence: number;
  created_at: Date;
  updated_at: Date;
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

export interface CreateFileDependency {
  from_file_id: number;
  to_file_id: number;
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

// Framework-specific models

export interface Route {
  id: number;
  repo_id: number;
  path: string;
  method?: string;
  handler_symbol_id?: number;
  framework_type?: string;
  middleware: string[];
  dynamic_segments: string[];
  auth_required: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Component {
  id: number;
  repo_id: number;
  symbol_id: number;
  component_type: ComponentType;
  props: PropDefinition[];
  emits?: string[]; // Vue-specific
  slots?: string[]; // Vue-specific
  hooks?: string[]; // React-specific
  parent_component_id?: number;
  template_dependencies: string[];
  created_at: Date;
  updated_at: Date;
}

export interface Composable {
  id: number;
  repo_id: number;
  symbol_id: number;
  composable_type: ComposableType;
  returns: string[];
  dependencies: string[];
  reactive_refs?: string[]; // Vue-specific
  dependency_array?: string[]; // React-specific useEffect dependencies
  created_at: Date;
  updated_at: Date;
}

export interface FrameworkMetadata {
  id: number;
  repo_id: number;
  framework_type: string;
  version?: string;
  config_path?: string;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

// Framework-specific enums
export enum ComponentType {
  VUE = 'vue',
  REACT = 'react',
}

export enum ComposableType {
  VUE_COMPOSABLE = 'vue-composable',
  REACT_HOOK = 'react-hook',
}

export enum FrameworkType {
  VUE = 'vue',
  NEXTJS = 'nextjs',
  REACT = 'react',
  EXPRESS = 'express',
  FASTIFY = 'fastify',
  NUXT = 'nuxt',
}

// Framework-specific helper types
export interface PropDefinition {
  name: string;
  type?: string;
  required: boolean;
  default?: any;
  description?: string;
}

export interface RouteSearchOptions {
  query?: string;
  method?: string;
  framework?: string;
  repo_id?: number;
  limit?: number;
}

export interface ComponentSearchOptions {
  query?: string;
  component_type?: ComponentType;
  repo_id?: number;
  limit?: number;
}

export interface ComposableSearchOptions {
  query?: string;
  composable_type?: ComposableType;
  repo_id?: number;
  limit?: number;
}

// Input types for creating framework records
export interface CreateRoute {
  repo_id: number;
  path: string;
  method?: string;
  handler_symbol_id?: number;
  framework_type?: string;
  middleware?: string[];
  dynamic_segments?: string[];
  auth_required?: boolean;
}

export interface CreateComponent {
  repo_id: number;
  symbol_id: number;
  component_type: ComponentType;
  props?: PropDefinition[];
  emits?: string[];
  slots?: string[];
  hooks?: string[];
  parent_component_id?: number;
  template_dependencies?: string[];
}

export interface CreateComposable {
  repo_id: number;
  symbol_id: number;
  composable_type: ComposableType;
  returns?: string[];
  dependencies?: string[];
  reactive_refs?: string[];
  dependency_array?: string[];
}

export interface CreateFrameworkMetadata {
  repo_id: number;
  framework_type: string;
  version?: string;
  config_path?: string;
  metadata?: Record<string, any>;
}

// Query result types with relationships for framework entities
export interface RouteWithSymbol extends Route {
  handler_symbol?: SymbolWithFile;
  repository?: Repository;
}

export interface ComponentWithSymbol extends Component {
  symbol?: SymbolWithFile;
  repository?: Repository;
  parent_component?: Component;
}

export interface ComposableWithSymbol extends Composable {
  symbol?: SymbolWithFile;
  repository?: Repository;
}

export interface ComponentTree extends Component {
  children?: ComponentTree[];
  parent?: Component;
}

// Framework entity dependency relationships
export interface ComposableDependency {
  id: number;
  composable_id: number;
  depends_on_symbol_id: number;
  dependency_type: string;
  created_at: Date;
  updated_at: Date;
}