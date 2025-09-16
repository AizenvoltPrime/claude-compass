import type { Knex } from 'knex';
import { getDatabaseConnection } from './connection';
import {
  Repository,
  File,
  Symbol,
  Dependency,
  CreateRepository,
  CreateFile,
  CreateSymbol,
  CreateDependency,
  CreateFileDependency,
  FileDependency,
  FileWithRepository,
  SymbolWithFile,
  SymbolWithFileAndRepository,
  DependencyWithSymbols,
  // Framework-specific imports
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
} from './models';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('database-services');

export class DatabaseService {
  private db: Knex;

  constructor() {
    this.db = getDatabaseConnection();
  }

  // Repository operations
  async createRepository(data: CreateRepository): Promise<Repository> {
    logger.debug('Creating repository', { name: data.name, path: data.path });

    // Convert framework_stack array to JSON for database storage
    const insertData = {
      ...data,
      framework_stack: JSON.stringify(data.framework_stack || [])
    };

    const [repository] = await this.db('repositories')
      .insert(insertData)
      .returning('*');

    // Parse JSON back to array for the returned object
    const result = repository as Repository;
    if (result.framework_stack && typeof result.framework_stack === 'string') {
      result.framework_stack = JSON.parse(result.framework_stack as string);
    }

    return result;
  }

  async getRepository(id: number): Promise<Repository | null> {
    const repository = await this.db('repositories')
      .where({ id })
      .first();

    if (repository && repository.framework_stack && typeof repository.framework_stack === 'string') {
      repository.framework_stack = JSON.parse(repository.framework_stack);
    }

    return repository as Repository || null;
  }

  async getRepositoryByPath(path: string): Promise<Repository | null> {
    const repository = await this.db('repositories')
      .where({ path })
      .first();

    if (repository && repository.framework_stack && typeof repository.framework_stack === 'string') {
      repository.framework_stack = JSON.parse(repository.framework_stack);
    }

    return repository as Repository || null;
  }

  async getRepositoryByName(name: string): Promise<Repository | null> {
    const repository = await this.db('repositories')
      .where({ name })
      .first();

    if (repository && repository.framework_stack && typeof repository.framework_stack === 'string') {
      repository.framework_stack = JSON.parse(repository.framework_stack);
    }

    return repository as Repository || null;
  }

  async getAllRepositories(): Promise<Repository[]> {
    const repositories = await this.db('repositories')
      .select('*')
      .orderBy('name');

    // Parse framework_stack JSON for all repositories
    return repositories.map(repo => {
      if (repo.framework_stack && typeof repo.framework_stack === 'string') {
        repo.framework_stack = JSON.parse(repo.framework_stack);
      }
      return repo as Repository;
    });
  }

  async updateRepository(id: number, data: Partial<CreateRepository>): Promise<Repository | null> {
    const [repository] = await this.db('repositories')
      .where({ id })
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return repository as Repository || null;
  }

  async deleteRepository(id: number): Promise<boolean> {
    const deletedCount = await this.db('repositories')
      .where({ id })
      .del();
    return deletedCount > 0;
  }

  // Change detection queries for incremental updates
  async getRepositoryLastIndexed(repositoryId: number): Promise<Date | null> {
    const repo = await this.db('repositories')
      .select('last_indexed')
      .where('id', repositoryId)
      .first();
    return repo?.last_indexed || null;
  }

  async findModifiedFilesSince(repositoryId: number, since: Date): Promise<File[]> {
    const files = await this.db('files')
      .where('repo_id', repositoryId)
      .where('last_modified', '>', since)
      .select('*');
    return files as File[];
  }

  async findFilesNotInDatabase(repositoryId: number, currentFilePaths: string[]): Promise<string[]> {
    if (currentFilePaths.length === 0) {
      return [];
    }

    const existingFiles = await this.db('files')
      .where('repo_id', repositoryId)
      .whereIn('path', currentFilePaths)
      .select('path');

    const existingPaths = existingFiles.map(f => f.path);
    return currentFilePaths.filter(path => !existingPaths.includes(path));
  }

  async findOrphanedFiles(repositoryId: number, currentFilePaths: string[]): Promise<File[]> {
    if (currentFilePaths.length === 0) {
      // If no current files, all existing files are orphaned
      return await this.db('files')
        .where('repo_id', repositoryId)
        .select('*') as File[];
    }

    const orphanedFiles = await this.db('files')
      .where('repo_id', repositoryId)
      .whereNotIn('path', currentFilePaths)
      .select('*');

    return orphanedFiles as File[];
  }

  // File operations
  async createFile(data: CreateFile): Promise<File> {
    logger.debug('Creating/updating file', { path: data.path, repo_id: data.repo_id });

    // Try to find existing file first
    const existingFile = await this.db('files')
      .where({ repo_id: data.repo_id, path: data.path })
      .first();

    if (existingFile) {
      // Update existing file
      const [file] = await this.db('files')
        .where({ id: existingFile.id })
        .update({ ...data, updated_at: new Date() })
        .returning('*');
      return file as File;
    } else {
      // Insert new file
      const [file] = await this.db('files')
        .insert(data)
        .returning('*');
      return file as File;
    }
  }

  async getFile(id: number): Promise<File | null> {
    const file = await this.db('files')
      .where({ id })
      .first();
    return file as File || null;
  }

  async getFileWithRepository(id: number): Promise<FileWithRepository | null> {
    const result = await this.db('files')
      .leftJoin('repositories', 'files.repo_id', 'repositories.id')
      .select('files.*', 'repositories.name as repo_name', 'repositories.path as repo_path')
      .where('files.id', id)
      .first();

    if (!result) return null;

    return {
      ...result,
      repository: {
        id: result.repo_id,
        name: result.repo_name,
        path: result.repo_path,
      } as Repository,
    } as FileWithRepository;
  }

  async getFilesByRepository(repoId: number): Promise<File[]> {
    const files = await this.db('files')
      .where({ repo_id: repoId })
      .orderBy('path');
    return files as File[];
  }

  async updateFile(id: number, data: Partial<CreateFile>): Promise<File | null> {
    const [file] = await this.db('files')
      .where({ id })
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return file as File || null;
  }

  async deleteFile(id: number): Promise<boolean> {
    const deletedCount = await this.db('files')
      .where({ id })
      .del();
    return deletedCount > 0;
  }

  // Symbol operations
  async getSymbolsByRepository(repoId: number): Promise<Symbol[]> {
    const symbols = await this.db('symbols')
      .join('files', 'symbols.file_id', 'files.id')
      .where('files.repo_id', repoId)
      .select('symbols.*')
      .orderBy('symbols.name');
    return symbols as Symbol[];
  }

  async createSymbol(data: CreateSymbol): Promise<Symbol> {
    logger.debug('Creating symbol', { name: data.name, type: data.symbol_type, file_id: data.file_id });
    const [symbol] = await this.db('symbols')
      .insert(data)
      .returning('*');
    return symbol as Symbol;
  }

  async createSymbols(symbols: CreateSymbol[]): Promise<Symbol[]> {
    if (symbols.length === 0) return [];

    logger.debug('Creating symbols in batch', { count: symbols.length });

    // Break into smaller batches for better memory management and transaction performance
    const BATCH_SIZE = 50;
    const results: Symbol[] = [];

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      logger.debug(`Processing symbol batch ${i / BATCH_SIZE + 1}/${Math.ceil(symbols.length / BATCH_SIZE)}`, {
        batchSize: batch.length
      });

      const batchResults = await this.db('symbols')
        .insert(batch)
        .returning('*');
      results.push(...(batchResults as Symbol[]));
    }

    return results;
  }

  async getSymbol(id: number): Promise<Symbol | null> {
    const symbol = await this.db('symbols')
      .where({ id })
      .first();
    return symbol as Symbol || null;
  }

  async getSymbolWithFile(id: number): Promise<SymbolWithFileAndRepository | null> {
    const result = await this.db('symbols')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .leftJoin('repositories', 'files.repo_id', 'repositories.id')
      .select(
        'symbols.*',
        'files.path as file_path',
        'files.language as file_language',
        'repositories.name as repo_name',
        'repositories.path as repo_path'
      )
      .where('symbols.id', id)
      .first();

    if (!result) return null;

    return {
      ...result,
      file: {
        id: result.file_id,
        path: result.file_path,
        language: result.file_language,
        repository: {
          name: result.repo_name,
          path: result.repo_path,
        },
      },
    } as SymbolWithFileAndRepository;
  }

  async getSymbolsByFile(fileId: number): Promise<Symbol[]> {
    const symbols = await this.db('symbols')
      .where({ file_id: fileId })
      .orderBy(['start_line', 'name']);
    return symbols as Symbol[];
  }

  async searchSymbols(query: string, repoId?: number): Promise<SymbolWithFile[]> {
    let queryBuilder = this.db('symbols')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .select('symbols.*', 'files.path as file_path', 'files.language as file_language')
      .where('symbols.name', 'ilike', `%${query}%`);

    if (repoId) {
      queryBuilder = queryBuilder.where('files.repo_id', repoId);
    }

    const results = await queryBuilder
      .orderBy('symbols.name')
      .limit(100);

    return results.map(result => ({
      ...result,
      file: {
        id: result.file_id,
        path: result.file_path,
        language: result.file_language,
      },
    })) as SymbolWithFile[];
  }

  // Dependency operations
  async createDependency(data: CreateDependency): Promise<Dependency> {
    const [dependency] = await this.db('dependencies')
      .insert(data)
      .returning('*');
    return dependency as Dependency;
  }

  async createDependencies(dependencies: CreateDependency[]): Promise<Dependency[]> {
    if (dependencies.length === 0) return [];

    logger.debug('Creating dependencies in batch', { count: dependencies.length });

    // Use upsert logic to handle duplicates - PostgreSQL ON CONFLICT
    const results = await this.db('dependencies')
      .insert(dependencies)
      .onConflict(['from_symbol_id', 'to_symbol_id', 'dependency_type'])
      .merge(['line_number', 'confidence', 'updated_at'])
      .returning('*');
    return results as Dependency[];
  }

  // File dependency operations
  async createFileDependencies(dependencies: CreateFileDependency[]): Promise<FileDependency[]> {
    if (dependencies.length === 0) return [];

    logger.debug('Creating file dependencies in batch', { count: dependencies.length });

    // Use upsert logic to handle duplicates - PostgreSQL ON CONFLICT
    const results = await this.db('file_dependencies')
      .insert(dependencies)
      .onConflict(['from_file_id', 'to_file_id', 'dependency_type'])
      .merge(['line_number', 'confidence', 'updated_at'])
      .returning('*');

    return results as FileDependency[];
  }

  async getFileDependenciesByRepository(repoId: number): Promise<FileDependency[]> {
    const dependencies = await this.db('file_dependencies')
      .join('files as from_files', 'file_dependencies.from_file_id', 'from_files.id')
      .join('files as to_files', 'file_dependencies.to_file_id', 'to_files.id')
      .where('from_files.repo_id', repoId)
      .select('file_dependencies.*');
    return dependencies as FileDependency[];
  }

  async getDependenciesFrom(symbolId: number): Promise<DependencyWithSymbols[]> {
    const results = await this.db('dependencies')
      .leftJoin('symbols as to_symbols', 'dependencies.to_symbol_id', 'to_symbols.id')
      .leftJoin('files as to_files', 'to_symbols.file_id', 'to_files.id')
      .select(
        'dependencies.*',
        'to_symbols.name as to_symbol_name',
        'to_symbols.symbol_type as to_symbol_type',
        'to_files.path as to_file_path'
      )
      .where('dependencies.from_symbol_id', symbolId);

    return results.map(result => ({
      ...result,
      to_symbol: {
        id: result.to_symbol_id,
        name: result.to_symbol_name,
        symbol_type: result.to_symbol_type,
        file: {
          id: result.to_file_id,
          path: result.to_file_path,
        },
      },
    })) as DependencyWithSymbols[];
  }

  async getDependenciesTo(symbolId: number): Promise<DependencyWithSymbols[]> {
    const results = await this.db('dependencies')
      .leftJoin('symbols as from_symbols', 'dependencies.from_symbol_id', 'from_symbols.id')
      .leftJoin('files as from_files', 'from_symbols.file_id', 'from_files.id')
      .select(
        'dependencies.*',
        'from_symbols.name as from_symbol_name',
        'from_symbols.symbol_type as from_symbol_type',
        'from_files.path as from_file_path'
      )
      .where('dependencies.to_symbol_id', symbolId);

    return results.map(result => ({
      ...result,
      from_symbol: {
        id: result.from_symbol_id,
        name: result.from_symbol_name,
        symbol_type: result.from_symbol_type,
        file: {
          id: result.from_file_id,
          path: result.from_file_path,
        },
      },
    })) as DependencyWithSymbols[];
  }

  // Cleanup methods for re-analysis
  async cleanupRepositoryData(repositoryId: number): Promise<void> {
    logger.info('Cleaning up repository data for re-analysis', { repositoryId });

    // Delete in correct order to respect foreign key constraints
    // 1. Delete dependencies first (they reference symbols)
    await this.db.transaction(async (trx) => {
      // Delete dependencies related to symbols in this repository
      const deletedDependencies = await trx('dependencies')
        .whereIn('from_symbol_id',
          trx('symbols').select('id').whereIn('file_id',
            trx('files').select('id').where('repo_id', repositoryId)
          )
        )
        .orWhereIn('to_symbol_id',
          trx('symbols').select('id').whereIn('file_id',
            trx('files').select('id').where('repo_id', repositoryId)
          )
        )
        .del();

      // Delete symbols in files belonging to this repository
      const deletedSymbols = await trx('symbols')
        .whereIn('file_id',
          trx('files').select('id').where('repo_id', repositoryId)
        )
        .del();

      // Delete files belonging to this repository
      const deletedFiles = await trx('files')
        .where('repo_id', repositoryId)
        .del();

      logger.info('Repository cleanup completed', {
        repositoryId,
        deletedDependencies,
        deletedSymbols,
        deletedFiles
      });
    });
  }

  async deleteRepositoryCompletely(repositoryId: number): Promise<boolean> {
    logger.info('Completely deleting repository and all related data', { repositoryId });

    try {
      return await this.db.transaction(async (trx) => {
        // Delete dependencies related to symbols in this repository
        const deletedDependencies = await trx('dependencies')
          .whereIn('from_symbol_id',
            trx('symbols').select('id').whereIn('file_id',
              trx('files').select('id').where('repo_id', repositoryId)
            )
          )
          .orWhereIn('to_symbol_id',
            trx('symbols').select('id').whereIn('file_id',
              trx('files').select('id').where('repo_id', repositoryId)
            )
          )
          .del();

        // Delete symbols in files belonging to this repository
        const deletedSymbols = await trx('symbols')
          .whereIn('file_id',
            trx('files').select('id').where('repo_id', repositoryId)
          )
          .del();

        // Delete files belonging to this repository
        const deletedFiles = await trx('files')
          .where('repo_id', repositoryId)
          .del();

        // Then delete the repository itself
        const deletedRepo = await trx('repositories')
          .where('id', repositoryId)
          .del();

        logger.info('Repository completely deleted', {
          repositoryId,
          deletedDependencies,
          deletedSymbols,
          deletedFiles,
          deletedRepo
        });

        return deletedRepo > 0;
      });
    } catch (error) {
      logger.error('Failed to delete repository completely', { repositoryId, error });
      throw error;
    }
  }

  async deleteRepositoryByName(name: string): Promise<boolean> {
    logger.info('Deleting repository by name', { name });

    const repository = await this.getRepositoryByName(name);
    if (!repository) {
      logger.warn('Repository not found', { name });
      return false;
    }

    logger.info('Repository found, proceeding with deletion', {
      name,
      repositoryId: repository.id,
      path: repository.path
    });

    return await this.deleteRepositoryCompletely(repository.id);
  }

  // Utility methods
  async runMigrations(): Promise<void> {
    logger.info('Running database migrations');
    await this.db.migrate.latest();
    logger.info('Database migrations completed');
  }

  async rollbackMigrations(): Promise<void> {
    logger.info('Rolling back database migrations');
    await this.db.migrate.rollback();
    logger.info('Database migrations rolled back');
  }

  async close(): Promise<void> {
    logger.info('Closing database connection');
    await this.db.destroy();
    logger.info('Database connection closed');
  }

  // Framework-specific operations

  // Route operations
  async createRoute(data: CreateRoute): Promise<Route> {
    logger.debug('Creating route', { path: data.path, method: data.method, framework: data.framework_type });

    const [route] = await this.db('routes')
      .insert(data)
      .returning('*');

    return route as Route;
  }

  async getRoute(id: number): Promise<Route | null> {
    const route = await this.db('routes')
      .where({ id })
      .first();
    return route as Route || null;
  }

  async getRouteWithSymbol(id: number): Promise<RouteWithSymbol | null> {
    const result = await this.db('routes')
      .leftJoin('symbols', 'routes.handler_symbol_id', 'symbols.id')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .leftJoin('repositories', 'routes.repo_id', 'repositories.id')
      .select(
        'routes.*',
        'symbols.id as symbol_id',
        'symbols.name as symbol_name',
        'symbols.signature as symbol_signature',
        'symbols.start_line as symbol_start_line',
        'files.path as file_path',
        'files.language as file_language',
        'repositories.name as repo_name',
        'repositories.path as repo_path'
      )
      .where('routes.id', id)
      .first();

    if (!result) return null;

    const route = {
      id: result.id,
      repo_id: result.repo_id,
      path: result.path,
      method: result.method,
      handler_symbol_id: result.handler_symbol_id,
      framework_type: result.framework_type,
      middleware: result.middleware,
      dynamic_segments: result.dynamic_segments,
      auth_required: result.auth_required,
      created_at: result.created_at,
      updated_at: result.updated_at,
    } as RouteWithSymbol;

    if (result.symbol_id) {
      route.handler_symbol = {
        id: result.symbol_id,
        file_id: result.file_id,
        name: result.symbol_name,
        signature: result.symbol_signature,
        start_line: result.symbol_start_line,
        file: {
          id: result.file_id,
          path: result.file_path,
          language: result.file_language,
        },
      } as SymbolWithFile;
    }

    if (result.repo_name) {
      route.repository = {
        id: result.repo_id,
        name: result.repo_name,
        path: result.repo_path,
      } as Repository;
    }

    return route;
  }

  async getRoutesByFramework(repoId: number, framework: string): Promise<Route[]> {
    const routes = await this.db('routes')
      .where({ repo_id: repoId, framework_type: framework })
      .orderBy('path');
    return routes as Route[];
  }

  async getRoutesByRepository(repoId: number): Promise<Route[]> {
    const routes = await this.db('routes')
      .where({ repo_id: repoId })
      .orderBy(['framework_type', 'path']);
    return routes as Route[];
  }

  async getAllRoutes(repoId?: number): Promise<Route[]> {
    let query = this.db('routes').orderBy(['repo_id', 'framework_type', 'path']);

    if (repoId) {
      query = query.where({ repo_id: repoId });
    }

    const routes = await query;
    return routes as Route[];
  }

  async findRouteByPath(repoId: number, path: string, method: string): Promise<Route | null> {
    const route = await this.db('routes')
      .where({ repo_id: repoId, path, method })
      .first();
    return route as Route || null;
  }

  async searchRoutes(options: RouteSearchOptions): Promise<Route[]> {
    let query = this.db('routes').select('*');

    if (options.repo_id) {
      query = query.where('repo_id', options.repo_id);
    }

    if (options.framework) {
      query = query.where('framework_type', options.framework);
    }

    if (options.method) {
      query = query.where('method', options.method.toUpperCase());
    }

    if (options.query) {
      query = query.where(builder => {
        builder
          .where('path', 'ilike', `%${options.query}%`)
          .orWhereRaw("middleware::text ILIKE ?", [`%${options.query}%`]);
      });
    }

    const routes = await query
      .orderBy('path')
      .limit(options.limit || 50);

    return routes as Route[];
  }

  // Component operations
  async createComponent(data: CreateComponent): Promise<Component> {
    logger.debug('Creating component', { symbol_id: data.symbol_id, type: data.component_type });

    const [component] = await this.db('components')
      .insert(data)
      .returning('*');

    return component as Component;
  }

  async getComponent(id: number): Promise<Component | null> {
    const component = await this.db('components')
      .where({ id })
      .first();
    return component as Component || null;
  }

  async getComponentWithSymbol(id: number): Promise<ComponentWithSymbol | null> {
    const result = await this.db('components')
      .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .leftJoin('repositories', 'components.repo_id', 'repositories.id')
      .select(
        'components.*',
        'symbols.id as symbol_id',
        'symbols.name as symbol_name',
        'symbols.signature as symbol_signature',
        'symbols.start_line as symbol_start_line',
        'files.path as file_path',
        'files.language as file_language',
        'repositories.name as repo_name',
        'repositories.path as repo_path'
      )
      .where('components.id', id)
      .first();

    if (!result) return null;

    const component = { ...result } as ComponentWithSymbol;

    if (result.symbol_id) {
      component.symbol = {
        id: result.symbol_id,
        name: result.symbol_name,
        signature: result.symbol_signature,
        start_line: result.symbol_start_line,
        file: {
          path: result.file_path,
          language: result.file_language,
        },
      } as SymbolWithFile;
    }

    if (result.repo_name) {
      component.repository = {
        id: result.repo_id,
        name: result.repo_name,
        path: result.repo_path,
      } as Repository;
    }

    return component;
  }

  async getComponentsByType(repoId: number, type: string): Promise<Component[]> {
    const components = await this.db('components')
      .where({ repo_id: repoId, component_type: type })
      .orderBy('id');
    return components as Component[];
  }

  async getComponentsByRepository(repoId: number): Promise<Component[]> {
    const components = await this.db('components')
      .where({ repo_id: repoId })
      .orderBy(['component_type', 'id']);
    return components as Component[];
  }

  async getComponentHierarchy(componentId: number): Promise<ComponentTree | null> {
    const component = await this.getComponent(componentId);
    if (!component) return null;

    // Get children components
    const children = await this.db('components')
      .where({ parent_component_id: componentId });

    // Get parent component
    let parent = null;
    if (component.parent_component_id) {
      parent = await this.getComponent(component.parent_component_id);
    }

    return {
      ...component,
      children: await Promise.all(children.map(child => this.getComponentHierarchy(child.id))),
      parent,
    } as ComponentTree;
  }

  async findComponentByName(repoId: number, name: string): Promise<Component | null> {
    const component = await this.db('components')
      .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
      .where({
        'components.repo_id': repoId,
        'symbols.name': name,
      })
      .select('components.*')
      .first();

    return component as Component || null;
  }

  async searchComponents(options: ComponentSearchOptions): Promise<Component[]> {
    let query = this.db('components')
      .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
      .select('components.*');

    if (options.repo_id) {
      query = query.where('components.repo_id', options.repo_id);
    }

    if (options.component_type) {
      query = query.where('components.component_type', options.component_type);
    }

    if (options.query) {
      query = query.where('symbols.name', 'ilike', `%${options.query}%`);
    }

    const components = await query
      .orderBy('symbols.name')
      .limit(options.limit || 50);

    return components as Component[];
  }

  // Composable operations
  async createComposable(data: CreateComposable): Promise<Composable> {
    logger.debug('Creating composable', { symbol_id: data.symbol_id, type: data.composable_type });

    const [composable] = await this.db('composables')
      .insert(data)
      .returning('*');

    return composable as Composable;
  }

  async getComposable(id: number): Promise<Composable | null> {
    const composable = await this.db('composables')
      .where({ id })
      .first();
    return composable as Composable || null;
  }

  async getComposablesByType(repoId: number, type: string): Promise<Composable[]> {
    const composables = await this.db('composables')
      .where({ repo_id: repoId, composable_type: type })
      .orderBy('id');
    return composables as Composable[];
  }

  async getComposablesByRepository(repoId: number): Promise<Composable[]> {
    const composables = await this.db('composables')
      .where({ repo_id: repoId })
      .orderBy(['composable_type', 'id']);
    return composables as Composable[];
  }

  async searchComposables(options: ComposableSearchOptions): Promise<Composable[]> {
    let query = this.db('composables')
      .leftJoin('symbols', 'composables.symbol_id', 'symbols.id')
      .select('composables.*');

    if (options.repo_id) {
      query = query.where('composables.repo_id', options.repo_id);
    }

    if (options.composable_type) {
      query = query.where('composables.composable_type', options.composable_type);
    }

    if (options.query) {
      query = query.where('symbols.name', 'ilike', `%${options.query}%`);
    }

    const composables = await query
      .orderBy('symbols.name')
      .limit(options.limit || 50);

    return composables as Composable[];
  }

  // Framework metadata operations
  async storeFrameworkMetadata(data: CreateFrameworkMetadata): Promise<FrameworkMetadata> {
    logger.debug('Storing framework metadata', { framework: data.framework_type, repo_id: data.repo_id });

    // Try to find existing metadata first
    const existingMetadata = await this.db('framework_metadata')
      .where({ repo_id: data.repo_id, framework_type: data.framework_type })
      .first();

    if (existingMetadata) {
      // Update existing metadata
      const [metadata] = await this.db('framework_metadata')
        .where({ id: existingMetadata.id })
        .update({ ...data, updated_at: new Date() })
        .returning('*');
      return metadata as FrameworkMetadata;
    } else {
      // Insert new metadata
      const [metadata] = await this.db('framework_metadata')
        .insert(data)
        .returning('*');
      return metadata as FrameworkMetadata;
    }
  }

  async getFrameworkStack(repoId: number): Promise<FrameworkMetadata[]> {
    const metadata = await this.db('framework_metadata')
      .where({ repo_id: repoId })
      .orderBy('framework_type');
    return metadata as FrameworkMetadata[];
  }

  async getFrameworkMetadata(repoId: number, frameworkType: string): Promise<FrameworkMetadata | null> {
    const metadata = await this.db('framework_metadata')
      .where({ repo_id: repoId, framework_type: frameworkType })
      .first();
    return metadata as FrameworkMetadata || null;
  }

  // Enhanced symbol search with framework context
  async findSymbolByName(repoId: number, name: string): Promise<SymbolWithFile | null> {
    const result = await this.db('symbols')
      .leftJoin('files', 'symbols.file_id', 'files.id')
      .select('symbols.*', 'files.path as file_path', 'files.language as file_language')
      .where('files.repo_id', repoId)
      .where('symbols.name', name)
      .first();

    if (!result) return null;

    return {
      ...result,
      file: {
        id: result.file_id,
        path: result.file_path,
        language: result.file_language,
      },
    } as SymbolWithFile;
  }
}

export const databaseService = new DatabaseService();