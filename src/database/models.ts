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
  description?: string;
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
  // Phase 3 additions
  JOB_QUEUE = 'job_queue',
  JOB_DEFINITION = 'job_definition',
  WORKER_THREAD = 'worker_thread',
  ORM_ENTITY = 'orm_entity',
  ORM_REPOSITORY = 'orm_repository',
  TEST_SUITE = 'test_suite',
  TEST_CASE = 'test_case',
  MOCK = 'mock',
  WORKSPACE_PROJECT = 'workspace_project',
  // Phase 4 additions - PHP/Laravel
  TRAIT = 'trait',
  NAMESPACE = 'namespace',
  ATTRIBUTE = 'attribute',
  // Phase 5 additions - Cross-stack framework entities
  COMPONENT = 'component',
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
  // Phase 3 additions
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
  // Phase 5 additions - Cross-stack tracking
  API_CALL = 'api_call',           // Vue component calls Laravel API
  SHARES_SCHEMA = 'shares_schema', // TypeScript interface ↔ PHP DTO
  FRONTEND_BACKEND = 'frontend_backend' // Generic cross-stack relationship
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
  // Phase 4 additions - PHP/Laravel
  LARAVEL = 'laravel',
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

// Phase 6 - Enhanced search options
export interface SymbolSearchOptions {
  limit?: number;
  confidenceThreshold?: number;
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
  confidence: number;
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

// Phase 5 Models - Cross-Stack Tracking

export interface ApiCall {
  id: number;
  repo_id: number;
  frontend_symbol_id: number;
  backend_route_id: number;
  method: string;
  url_pattern: string;
  request_schema: any;
  response_schema: any;
  confidence: number;
  created_at: Date;
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

// Phase 3 Models - Background Jobs

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

// Phase 3 Models - ORM Entities

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

export interface ORMRelationship {
  id: number;
  from_entity_id: number;
  to_entity_id: number;
  relationship_type: ORMRelationshipType;
  foreign_key?: string;
  through_table?: string;
  inverse_relationship_id?: number;
  confidence: number;
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
  // Phase 4 additions - PHP/Laravel ORM
  ELOQUENT = 'eloquent',
}

export enum ORMRelationshipType {
  HAS_MANY = 'has_many',
  BELONGS_TO = 'belongs_to',
  HAS_ONE = 'has_one',
  MANY_TO_MANY = 'many_to_many',
}

export enum ORMRepositoryType {
  TYPEORM_REPOSITORY = 'typeorm_repository',
  PRISMA_SERVICE = 'prisma_service',
  SEQUELIZE_MODEL = 'sequelize_model',
  CUSTOM_REPOSITORY = 'custom_repository',
}

// Phase 3 Models - Test Frameworks

export interface TestSuite {
  id: number;
  repo_id: number;
  file_id: number;
  suite_name: string;
  parent_suite_id?: number;
  framework_type: TestFrameworkType;
  start_line?: number;
  end_line?: number;
  created_at: Date;
  updated_at: Date;
}

export interface TestCase {
  id: number;
  repo_id: number;
  suite_id: number;
  symbol_id?: number;
  test_name: string;
  test_type: TestType;
  start_line?: number;
  end_line?: number;
  created_at: Date;
  updated_at: Date;
}

export interface TestCoverage {
  id: number;
  test_case_id: number;
  target_symbol_id: number;
  coverage_type: TestCoverageType;
  line_number?: number;
  confidence: number;
  created_at: Date;
  updated_at: Date;
}

export enum TestFrameworkType {
  JEST = 'jest',
  VITEST = 'vitest',
  CYPRESS = 'cypress',
  PLAYWRIGHT = 'playwright',
  MOCHA = 'mocha',
  JASMINE = 'jasmine',
  // Phase 4 additions - PHP testing frameworks
  PHPUNIT = 'phpunit',
  PEST = 'pest',
}

export enum TestType {
  UNIT = 'unit',
  INTEGRATION = 'integration',
  E2E = 'e2e',
  COMPONENT = 'component',
}

export enum TestCoverageType {
  TESTS = 'tests',
  MOCKS = 'mocks',
  IMPORTS_FOR_TEST = 'imports_for_test',
  SPY = 'spy',
}

// Phase 3 Models - Package Dependencies

export interface PackageDependency {
  id: number;
  repo_id: number;
  package_name: string;
  version_spec: string;
  resolved_version?: string;
  dependency_type: PackageDependencyType;
  package_manager: PackageManagerType;
  lock_file_path?: string;
  is_workspace: boolean;
  created_at: Date;
  updated_at: Date;
}

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

export enum PackageDependencyType {
  DEPENDENCIES = 'dependencies',
  DEV_DEPENDENCIES = 'devDependencies',
  PEER_DEPENDENCIES = 'peerDependencies',
  OPTIONAL_DEPENDENCIES = 'optionalDependencies',
}

export enum PackageManagerType {
  NPM = 'npm',
  YARN = 'yarn',
  PNPM = 'pnpm',
  BUN = 'bun',
  // Phase 4 additions - PHP package manager
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

// Phase 3 Create Input Types

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

export interface CreateORMRelationship {
  from_entity_id: number;
  to_entity_id: number;
  relationship_type: ORMRelationshipType;
  foreign_key?: string;
  through_table?: string;
  inverse_relationship_id?: number;
  confidence?: number;
}

export interface CreateORMRepository {
  repo_id: number;
  symbol_id: number;
  entity_id: number;
  repository_type: ORMRepositoryType;
  methods?: string[];
}

export interface CreateTestSuite {
  repo_id: number;
  file_id: number;
  suite_name: string;
  parent_suite_id?: number;
  framework_type: TestFrameworkType;
  start_line?: number;
  end_line?: number;
}

export interface CreateTestCase {
  repo_id: number;
  suite_id: number;
  symbol_id?: number;
  test_name: string;
  test_type: TestType;
  start_line?: number;
  end_line?: number;
}

export interface CreateTestCoverage {
  test_case_id: number;
  target_symbol_id: number;
  coverage_type: TestCoverageType;
  line_number?: number;
  confidence?: number;
}

export interface CreatePackageDependency {
  repo_id: number;
  package_name: string;
  version_spec: string;
  resolved_version?: string;
  dependency_type: PackageDependencyType;
  package_manager: PackageManagerType;
  lock_file_path?: string;
  is_workspace?: boolean;
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

// Phase 5 Create Input Types - Cross-Stack Tracking

export interface CreateApiCall {
  repo_id: number;
  frontend_symbol_id: number;
  backend_route_id: number;
  method: string;
  url_pattern: string;
  request_schema?: any;
  response_schema?: any;
  confidence?: number;
}

export interface CreateDataContract {
  repo_id: number;
  name: string;
  frontend_type_id: number;
  backend_type_id: number;
  schema_definition?: any;
  drift_detected?: boolean;
}