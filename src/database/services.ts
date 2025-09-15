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
  FileWithRepository,
  SymbolWithFile,
  SymbolWithFileAndRepository,
  DependencyWithSymbols,
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

    // Break into smaller batches to avoid PostgreSQL query size limits
    const BATCH_SIZE = 50; // Further reduced batch size
    const results: Symbol[] = [];

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE).map(symbol => ({
        ...symbol,
        // Truncate signature to prevent PostgreSQL query size issues
        signature: symbol.signature && symbol.signature.length > 1000
          ? symbol.signature.substring(0, 997) + '...'
          : symbol.signature
      }));

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
}

export const databaseService = new DatabaseService();