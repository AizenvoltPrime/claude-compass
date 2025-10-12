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
  qualified_name?: string;
  parent_symbol_id?: number;
  symbol_type: SymbolType;
  entity_type?: string; // Semantic/framework-aware type (component, service, manager, model, etc.)
  base_class?: string; // Inheritance information (Node, Control, Model, Resource, etc.)
  start_line?: number;
  end_line?: number;
  is_exported: boolean;
  visibility?: Visibility;
  signature?: string;
  description?: string;
  framework?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Dependency {
  id: number;
  from_symbol_id: number;
  to_symbol_id: number | null; // Nullable for unresolved qualified name references
  to_qualified_name?: string; // Stable reference that survives symbol deletion/recreation
  dependency_type: DependencyType;
  line_number?: number;
  parameter_context?: string;
  call_instance_id?: string;
  parameter_types?: string[];
  created_at: Date;
  updated_at: Date;
}

// Enhanced dependency interface with rich context for advanced C# analysis
export interface EnhancedDependency extends Dependency {
  calling_object?: string;
  resolved_class?: string;
  qualified_context?: string;
  method_signature?: string;
  file_context?: string;
  namespace_context?: string;
  // Call chain visualization fields (Enhancement 1)
  call_chain?: string;
  path?: number[];
  depth?: number;
}

/**
 * Simplified dependency interface - Canonical format for all MCP tools
 * Language-agnostic, token-optimized structure with essential context only
 */
export interface SimplifiedDependency {
  from: string;
  to: string;
  type: DependencyType;
  line_number?: number;
  file_path?: string;

  // Context fields (language-agnostic disambiguation)
  qualified_context?: string;
  parameter_types?: string[];
  parameter_context?: string;

  // Transitive analysis (only present for indirect dependencies)
  call_chain?: string;
  depth?: number;

  // Cross-stack fields (only present for API calls)
  is_cross_stack?: boolean;
  http_method?: string;
  endpoint_path?: string;
}

/**
 * Standard dependency response format for MCP tools
 * Used by who_calls and list_dependencies
 */
export interface SimplifiedDependencyResponse {
  dependencies: SimplifiedDependency[];
  total_count: number;
  query_info: {
    symbol: string;
    analysis_type: 'callers' | 'dependencies' | 'impact';
    timestamp: string;
  };
}

/**
 * Restructured impact analysis response
 * Categorizes different types of impact for better AI comprehension
 */
export interface ImpactAnalysisResponse {
  direct_impact: SimplifiedDependency[];
  indirect_impact: SimplifiedDependency[];
  routes_affected: Array<{
    path: string;
    method: string;
    framework: string;
  }>;
  jobs_affected: Array<{
    name: string;
    type: string;
  }>;
  tests_affected: Array<{
    name: string;
    file_path: string;
  }>;
  summary: {
    total_symbols: number;
    total_routes: number;
    total_jobs: number;
    total_tests: number;
    max_depth: number;
    frameworks: string[];
  };
  query_info: {
    symbol: string;
    analysis_type: 'impact';
    timestamp: string;
  };
}

/**
 * Simplified symbol metadata response
 * Focused on symbol details only, relationships accessed via dedicated tools
 */
export interface SimplifiedSymbolResponse {
  symbol: {
    id: number;
    name: string;
    type: string;
    start_line?: number;
    end_line?: number;
    is_exported: boolean;
    visibility?: string;
    signature?: string;
  };
  file_path: string;
  repository_name?: string;
  dependencies_count: number;
  callers_count: number;
}

/**
 * Simple cross-stack relationship for Vue ↔ Laravel analysis
 */
export interface SimpleCrossStackRelationship {
  from_component: string;
  to_endpoint: string;
  relationship_type: 'api_call' | 'data_binding' | 'route_reference';
  method?: string; // HTTP method for API calls
  url_pattern?: string; // Route pattern
  line_number?: number;
}

/**
 * Simplified API call interface
 */
export interface SimpleApiCall {
  component: string;
  method: string; // HTTP method (GET, POST, etc.)
  url: string; // Request URL or pattern
  controller_method?: string; // Laravel controller method
  route_name?: string; // Laravel route name
  line_number?: number;
}

/**
 * Response format for simplified dependency list
 */
export interface FlatDependencyResponse {
  data: SimplifiedDependency[];
  metadata: {
    total_results: number;
    query_type: string;
    execution_time_ms: number;
    optimizations_applied: string[];
  };
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
  JOB_QUEUE = 'job_queue',
  JOB_DEFINITION = 'job_definition',
  WORKER_THREAD = 'worker_thread',
  ORM_ENTITY = 'orm_entity',
  ORM_REPOSITORY = 'orm_repository',
  TEST_SUITE = 'test_suite',
  TEST_CASE = 'test_case',
  MOCK = 'mock',
  WORKSPACE_PROJECT = 'workspace_project',
  TRAIT = 'trait',
  NAMESPACE = 'namespace',
  ATTRIBUTE = 'attribute',
  COMPONENT = 'component',
  GODOT_SCENE = 'godot_scene',
  GODOT_NODE = 'godot_node',
  GODOT_SCRIPT = 'godot_script',
  GODOT_AUTOLOAD = 'godot_autoload',
  GODOT_RESOURCE = 'godot_resource',
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
  ORM_RELATION = 'orm_relation',
  TEST_COVERS = 'test_covers',
  PROCESSES_JOB = 'processes_job',
  QUEUES_JOB = 'queues_job',
  SCHEDULES_JOB = 'schedules_job',
  BELONGS_TO = 'belongs_to',
  HAS_MANY = 'has_many',
  HAS_ONE = 'has_one',
  MANY_TO_MANY = 'many_to_many',
  MOCKS = 'mocks',
  IMPORTS_FOR_TEST = 'imports_for_test',
  PACKAGE_DEPENDENCY = 'package_dependency',
  WORKSPACE_DEPENDENCY = 'workspace_dependency',
  API_CALL = 'api_call', // Vue component calls Laravel API
  SHARES_SCHEMA = 'shares_schema', // TypeScript interface ↔ PHP DTO
  FRONTEND_BACKEND = 'frontend_backend', // Generic cross-stack relationship
  SCENE_REFERENCE = 'scene_reference',
  NODE_CHILD = 'node_child',
  SIGNAL_CONNECTION = 'signal_connection',
  SCRIPT_ATTACHMENT = 'script_attachment',
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
  qualified_name?: string;
  parent_symbol_id?: number;
  symbol_type: SymbolType;
  entity_type?: string;
  base_class?: string;
  start_line?: number;
  end_line?: number;
  is_exported?: boolean;
  visibility?: Visibility;
  signature?: string;
  description?: string;
}

export interface CreateDependency {
  from_symbol_id: number;
  to_symbol_id: number | null; // Nullable when only qualified name is known
  to_qualified_name?: string; // Stable reference for incremental analysis
  dependency_type: DependencyType;
  line_number?: number;
  parameter_context?: string;
  call_instance_id?: string;
  parameter_types?: string[];
  calling_object?: string;
  qualified_context?: string;
  resolved_class?: string; // C# resolved class name - moved from CreateEnhancedDependency
}

// Enhanced dependency creation interface with rich context for advanced C# analysis
export interface CreateEnhancedDependency extends CreateDependency {
  method_signature?: string; // Full signature with parameters
  file_context?: string; // File path for cross-file analysis
  namespace_context?: string; // C# namespace information
}

export interface CreateFileDependency {
  from_file_id: number;
  to_file_id: number;
  dependency_type: DependencyType;
  line_number?: number;
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
  // Call chain visualization fields (Enhancement 1)
  call_chain?: string;
  path?: number[];
  depth?: number;
}

// Enhanced dependency interface with rich context
export interface EnhancedDependencyWithSymbols extends DependencyWithSymbols {
  calling_object?: string;
  resolved_class?: string;
  qualified_context?: string;
  method_signature?: string;
  file_context?: string;
  namespace_context?: string;
  // Call chain visualization fields (Enhancement 1)
  call_chain?: string;
  path?: number[];
  depth?: number;
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

  // Laravel-specific fields (nullable for other frameworks)
  name?: string; // Laravel route name
  controller_class?: string; // Laravel controller class
  controller_method?: string; // Laravel controller method
  action?: string; // Laravel route action
  file_path?: string; // Source file path
  line_number?: number; // Line number in source file

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
  LARAVEL = 'laravel',
  GODOT = 'godot',
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

export interface SymbolSearchOptions {
  limit?: number;
  symbolTypes?: SymbolType[];
  isExported?: boolean;
  framework?: string;
  repoIds?: number[];
}

export interface VectorSearchOptions extends SymbolSearchOptions {
  similarityThreshold?: number;
}

export interface HybridSearchOptions extends SymbolSearchOptions {
  weights?: {
    lexical: number;
    vector: number;
    fulltext: number;
  };
}

export interface SearchResult<T = any> {
  item: T;
  score: number;
  matchType: 'lexical' | 'vector' | 'fulltext';
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

  // Laravel-specific fields (optional for other frameworks)
  name?: string; // Laravel route name
  controller_class?: string; // Laravel controller class
  controller_method?: string; // Laravel controller method
  action?: string; // Laravel route action
  file_path?: string; // Source file path
  line_number?: number; // Line number in source file
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

export interface ApiCall {
  id: number;
  repo_id: number;
  caller_symbol_id: number;
  endpoint_symbol_id?: number | null;
  http_method: string;
  endpoint_path: string;
  call_type: string;
  created_at: Date;
  updated_at: Date;
}

export interface DataContract {
  id: number;
  repo_id: number;
  name: string;
  frontend_type_id: number;
  backend_type_id: number;
  schema_definition: any;
  drift_detected: boolean;
  last_verified: Date;
}

export interface JobQueue {
  id: number;
  repo_id: number;
  name: string;
  queue_type: JobQueueType;
  symbol_id: number;
  config_data: Record<string, any>;
  redis_config?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface JobDefinition {
  id: number;
  repo_id: number;
  queue_id: number;
  job_name: string;
  handler_symbol_id: number;
  schedule_pattern?: string;
  concurrency: number;
  retry_attempts: number;
  job_options: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface WorkerThread {
  id: number;
  repo_id: number;
  worker_file_id: number;
  parent_symbol_id?: number;
  worker_type: WorkerType;
  data_schema?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export enum JobQueueType {
  BULL = 'bull',
  BULLMQ = 'bullmq',
  AGENDA = 'agenda',
  BEE = 'bee',
  KUE = 'kue',
}

export enum WorkerType {
  WORKER_THREADS = 'worker_threads',
  CLUSTER = 'cluster',
  CHILD_PROCESS = 'child_process',
}

export interface ORMEntity {
  id: number;
  repo_id: number;
  symbol_id: number;
  entity_name: string;
  table_name?: string;
  orm_type: ORMType;
  schema_file_id?: number;
  fields: Record<string, any>;
  indexes: any[];
  created_at: Date;
  updated_at: Date;
}

export interface ORMRepository {
  id: number;
  repo_id: number;
  symbol_id: number;
  entity_id: number;
  repository_type: ORMRepositoryType;
  methods: string[];
  created_at: Date;
  updated_at: Date;
}

export enum ORMType {
  PRISMA = 'prisma',
  TYPEORM = 'typeorm',
  SEQUELIZE = 'sequelize',
  MONGOOSE = 'mongoose',

  ELOQUENT = 'eloquent',
}

export enum ORMRepositoryType {
  TYPEORM_REPOSITORY = 'typeorm_repository',
  PRISMA_SERVICE = 'prisma_service',
  SEQUELIZE_MODEL = 'sequelize_model',
  CUSTOM_REPOSITORY = 'custom_repository',
}

// Test Framework Type (used by parser, not stored in DB)
export enum TestFrameworkType {
  JEST = 'jest',
  VITEST = 'vitest',
  CYPRESS = 'cypress',
  PLAYWRIGHT = 'playwright',
  MOCHA = 'mocha',
  JASMINE = 'jasmine',
  PHPUNIT = 'phpunit',
  PEST = 'pest',
}

// Workspace Projects

export interface WorkspaceProject {
  id: number;
  repo_id: number;
  project_name: string;
  project_path: string;
  package_json_path: string;
  parent_project_id?: number;
  workspace_type: WorkspaceType;
  config_data: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export enum PackageManagerType {
  NPM = 'npm',
  YARN = 'yarn',
  PNPM = 'pnpm',
  BUN = 'bun',
  COMPOSER = 'composer',
}

export enum WorkspaceType {
  NX = 'nx',
  LERNA = 'lerna',
  TURBOREPO = 'turborepo',
  RUSH = 'rush',
  YARN_WORKSPACES = 'yarn_workspaces',
  NPM_WORKSPACES = 'npm_workspaces',
}

export interface CreateJobQueue {
  repo_id: number;
  name: string;
  queue_type: JobQueueType;
  symbol_id: number;
  config_data?: Record<string, any>;
  redis_config?: Record<string, any>;
}

export interface CreateJobDefinition {
  repo_id: number;
  queue_id: number;
  job_name: string;
  handler_symbol_id: number;
  schedule_pattern?: string;
  concurrency?: number;
  retry_attempts?: number;
  job_options?: Record<string, any>;
}

export interface CreateWorkerThread {
  repo_id: number;
  worker_file_id: number;
  parent_symbol_id?: number;
  worker_type: WorkerType;
  data_schema?: Record<string, any>;
}

export interface CreateORMEntity {
  repo_id: number;
  symbol_id: number;
  entity_name: string;
  table_name?: string;
  orm_type: ORMType;
  schema_file_id?: number;
  fields?: Record<string, any>;
  indexes?: any[];
}

export interface CreateORMRepository {
  repo_id: number;
  symbol_id: number;
  entity_id: number;
  repository_type: ORMRepositoryType;
  methods?: string[];
}

export interface CreateWorkspaceProject {
  repo_id: number;
  project_name: string;
  project_path: string;
  package_json_path: string;
  parent_project_id?: number;
  workspace_type: WorkspaceType;
  config_data?: Record<string, any>;
}

export interface CreateApiCall {
  repo_id: number;
  caller_symbol_id: number;
  endpoint_symbol_id?: number | null;
  http_method: string;
  endpoint_path: string;
  call_type: string;
  line_number?: number | null;
}

export interface CreateDataContract {
  repo_id: number;
  name: string;
  frontend_type_id: number;
  backend_type_id: number;
  schema_definition?: any;
  drift_detected?: boolean;
}

// Implementation of Solution 1: Enhanced Framework Relationships

export interface GodotScene {
  id: number;
  repo_id: number;
  scene_path: string;
  scene_name: string;
  root_node_id?: number;
  node_count: number;
  has_script: boolean;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface GodotNode {
  id: number;
  repo_id: number;
  scene_id: number;
  node_name: string;
  node_type: string;
  parent_node_id?: number;
  script_path?: string;
  properties: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface GodotScript {
  id: number;
  repo_id: number;
  script_path: string;
  class_name: string;
  base_class?: string;
  is_autoload: boolean;
  signals: Array<{
    name: string;
    parameters: Array<{ name: string; type?: string }>;
    line: number;
  }>;
  exports: Array<{
    name: string;
    type: string;
    defaultValue?: any;
    exportType?: string;
    line: number;
  }>;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface GodotAutoload {
  id: number;
  repo_id: number;
  autoload_name: string;
  script_path: string;
  script_id?: number;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface GodotRelationship {
  id: number;
  repo_id: number;
  relationship_type: GodotRelationshipType;
  from_entity_type: GodotEntityType;
  from_entity_id: number;
  to_entity_type: GodotEntityType;
  to_entity_id: number;
  resource_id?: string;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export enum GodotRelationshipType {
  SCENE_SCRIPT_ATTACHMENT = 'scene_script_attachment',
  SCENE_RESOURCE_REFERENCE = 'scene_resource_reference',
  NODE_HIERARCHY = 'node_hierarchy',
  SIGNAL_CONNECTION = 'signal_connection',
  AUTOLOAD_REFERENCE = 'autoload_reference',
  SCRIPT_INHERITANCE = 'script_inheritance',
}

export enum GodotEntityType {
  SCENE = 'scene',
  NODE = 'node',
  SCRIPT = 'script',
  AUTOLOAD = 'autoload',
}

// Input types for creating Godot records
export interface CreateGodotScene {
  repo_id: number;
  scene_path: string;
  scene_name: string;
  root_node_id?: number;
  node_count?: number;
  has_script?: boolean;
  metadata?: Record<string, any>;
}

export interface CreateGodotNode {
  repo_id: number;
  scene_id: number;
  node_name: string;
  node_type: string;
  parent_node_id?: number;
  script_path?: string;
  properties?: Record<string, any>;
}

export interface CreateGodotScript {
  repo_id: number;
  script_path: string;
  class_name: string;
  base_class?: string;
  is_autoload?: boolean;
  signals?: Array<{
    name: string;
    parameters: Array<{ name: string; type?: string }>;
    line: number;
  }>;
  exports?: Array<{
    name: string;
    type: string;
    defaultValue?: any;
    exportType?: string;
    line: number;
  }>;
  metadata?: Record<string, any>;
}

export interface CreateGodotAutoload {
  repo_id: number;
  autoload_name: string;
  script_path: string;
  script_id?: number;
  metadata?: Record<string, any>;
}

export interface CreateGodotRelationship {
  repo_id: number;
  relationship_type: GodotRelationshipType;
  from_entity_type: GodotEntityType;
  from_entity_id: number;
  to_entity_type: GodotEntityType;
  to_entity_id: number;
  resource_id?: string;
  metadata?: Record<string, any>;
}

// Query result types with relationships for Godot entities
export interface GodotSceneWithNodes extends GodotScene {
  nodes?: GodotNode[];
  root_node?: GodotNode;
  repository?: Repository;
}

export interface GodotNodeWithScript extends GodotNode {
  script?: GodotScript;
  scene?: GodotScene;
  parent?: GodotNode;
  children?: GodotNode[];
}

export interface GodotScriptWithScenes extends GodotScript {
  attached_scenes?: GodotScene[];
  repository?: Repository;
}

export interface GodotRelationshipWithEntities extends GodotRelationship {
  from_scene?: GodotScene;
  from_node?: GodotNode;
  from_script?: GodotScript;
  from_autoload?: GodotAutoload;
  to_scene?: GodotScene;
  to_node?: GodotNode;
  to_script?: GodotScript;
  to_autoload?: GodotAutoload;
}

// Search options for Godot entities
export interface GodotSceneSearchOptions {
  query?: string;
  repo_id?: number;
  has_script?: boolean;
  limit?: number;
}

export interface GodotNodeSearchOptions {
  query?: string;
  repo_id?: number;
  scene_id?: number;
  node_type?: string;
  has_script?: boolean;
  limit?: number;
}

export interface GodotScriptSearchOptions {
  query?: string;
  repo_id?: number;
  base_class?: string;
  is_autoload?: boolean;
  limit?: number;
}

export interface GodotRelationshipSearchOptions {
  repo_id?: number;
  relationship_type?: GodotRelationshipType;
  from_entity_type?: GodotEntityType;
  from_entity_id?: number;
  to_entity_type?: GodotEntityType;
  to_entity_id?: number;
  limit?: number;
}
