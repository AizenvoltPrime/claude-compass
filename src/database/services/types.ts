import type { Knex } from 'knex';

// Re-export all database models
export type {
  Repository,
  File,
  Symbol,
  Dependency,
  CreateRepository,
  CreateFile,
  CreateSymbol,
  CreateDependency,
  SymbolType,
  CreateFileDependency,
  FileDependency,
  FileWithRepository,
  SymbolWithFile,
  SymbolWithFileAndRepository,
  DependencyWithSymbols,
  EnhancedDependencyWithSymbols,
  // Framework-specific types
  Route,
  Component,
  Composable,
  FrameworkMetadata,
  CreateRoute,
  CreateComponent,
  CreateComposable,
  CreateFrameworkMetadata,
  RouteWithSymbol,
  ComponentWithSymbol,
  ComposableWithSymbol,
  ComponentTree,
  RouteSearchOptions,
  ComponentSearchOptions,
  ComposableSearchOptions,
  RouteImpactRecord,
  JobImpactRecord,
  TestImpactRecord,
  // Enhanced Search types
  SymbolSearchOptions,
  VectorSearchOptions,
  HybridSearchOptions,
  SearchResult,
  // Background Jobs types
  JobQueue,
  JobDefinition,
  WorkerThread,
  CreateJobQueue,
  CreateJobDefinition,
  CreateWorkerThread,
  JobQueueType,
  WorkerType,
  // ORM Entities types
  ORMEntity,
  ORMRepository,
  CreateORMEntity,
  CreateORMRepository,
  ORMType,
  ORMRepositoryType,
  // Workspace Projects types
  WorkspaceProject,
  CreateWorkspaceProject,
  PackageManagerType,
  WorkspaceType,
  // Cross-Stack Tracking types
  ApiCall,
  DataContract,
  CreateApiCall,
  CreateDataContract,
  // Godot Framework Entities
  GodotScene,
  GodotNode,
  CreateGodotScene,
  CreateGodotNode,
  GodotSceneWithNodes,
  GodotNodeWithScript,
  GodotSceneSearchOptions,
  GodotNodeSearchOptions,
} from '../models';

// Service-specific types
export interface ServiceContext {
  db: Knex;
}
