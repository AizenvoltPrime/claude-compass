import { Knex } from 'knex';
import { DeadCodeSymbol, InterfaceImplementationPair } from './types.js';
import { Symbol } from '../../../database/models.js';

/// <summary>
/// Optimized database queries for dead code detection
/// </summary>
export class DeadCodeQueryBuilder {
  constructor(private db: Knex) {}

  /// <summary>
  /// Find all symbols with zero incoming 'calls' dependencies
  /// Optimized single query with JOIN to avoid N+1
  /// </summary>
  async findZeroCallerCandidates(
    repoId: number,
    includeTests: boolean,
    filePattern?: string
  ): Promise<DeadCodeSymbol[]> {
    const db = this.db;
    let query = this.db('symbols as s')
      .select(
        's.*',
        'f.path as file_path',
        this.db.raw(
          "COUNT(d.id) FILTER (WHERE d.dependency_type = 'calls') as caller_count"
        )
      )
      .join('files as f', 's.file_id', 'f.id')
      .leftJoin('dependencies as d', function () {
        this.on('d.to_symbol_id', '=', 's.id').andOn(
          'd.dependency_type',
          '=',
          db.raw('?', ['calls'])
        );
      })
      .where('f.repo_id', repoId)
      .groupBy('s.id', 'f.path')
      .havingRaw("COUNT(d.id) FILTER (WHERE d.dependency_type = 'calls') = 0");

    // Apply file pattern filter if provided
    if (filePattern) {
      // Convert glob pattern to SQL LIKE pattern
      // First escape existing SQL wildcards, then convert glob wildcards
      const likePattern = filePattern
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/%/g, '\\%')    // Escape SQL wildcard %
        .replace(/_/g, '\\_')    // Escape SQL wildcard _
        .replace(/\*/g, '%')     // Convert glob * to SQL %
        .replace(/\?/g, '_');    // Convert glob ? to SQL _
      query = query.where('f.path', 'like', likePattern);
    }

    // Filter test files if requested
    if (!includeTests) {
      query = query.whereNot(function () {
        this.where('f.path', 'like', '%.test.%')
          .orWhere('f.path', 'like', '%.spec.%')
          .orWhere('f.path', 'like', '%/tests/%')
          .orWhere('f.path', 'like', '%/__tests__/%')
          .orWhere('f.path', 'like', '%_test.%')
          .orWhere('f.path', 'like', '%Test.%')
          .orWhere('f.path', 'like', '%Tests.%');
      });
    }

    const results = await query;

    return results.map(r => ({
      ...r,
      caller_count: parseInt(r.caller_count || '0', 10),
    })) as DeadCodeSymbol[];
  }

  /// <summary>
  /// Find interface methods and their implementations
  /// Used for detecting interface bloat
  /// Optimized to use 3 queries instead of O(n³) nested loops
  /// </summary>
  async findInterfaceImplementations(
    repoId: number
  ): Promise<InterfaceImplementationPair[]> {
    // Step 1: Find all (interface, implementing_class) pairs in a single query
    const db = this.db;
    const implementationPairs = await this.db('symbols as interface_sym')
      .select(
        'interface_sym.id as interface_id',
        'interface_sym.name as interface_name',
        'interface_sym.file_id as interface_file_id',
        'class_sym.id as class_id',
        'class_sym.name as class_name',
        'class_sym.file_id as class_file_id'
      )
      .join('files as f', 'interface_sym.file_id', 'f.id')
      .join('dependencies as d', function () {
        this.on('d.to_symbol_id', '=', 'interface_sym.id')
          .andOn('d.dependency_type', '=', db.raw('?', ['implements']));
      })
      .join('symbols as class_sym', 'd.from_symbol_id', 'class_sym.id')
      .where('f.repo_id', repoId)
      .andWhere(function () {
        this.where('interface_sym.symbol_type', 'interface')
          .orWhere('interface_sym.entity_type', 'interface');
      });

    if (implementationPairs.length === 0) {
      return [];
    }

    // Extract unique interface and class file IDs for batch queries
    const interfaceFileIds = [...new Set(implementationPairs.map(p => p.interface_file_id))];
    const classFileIds = [...new Set(implementationPairs.map(p => p.class_file_id))];

    // Step 2: Batch fetch all interface methods (single query)
    const interfaceMethods = await this.db('symbols')
      .select('id', 'name', 'file_id')
      .whereIn('file_id', interfaceFileIds)
      .andWhere(function () {
        this.where('symbol_type', 'method')
          .orWhere('entity_type', 'interface_method');
      });

    // Step 3: Batch fetch all implementation methods (single query)
    const implementationMethods = await this.db('symbols')
      .select('id', 'name', 'file_id')
      .whereIn('file_id', classFileIds)
      .andWhere(function () {
        this.where('symbol_type', 'method')
          .orWhere('symbol_type', 'class_method');
      });

    // Step 4: Build lookup maps for O(1) access
    const interfaceMethodsByFileAndName = new Map<string, { id: number; name: string }>();
    for (const method of interfaceMethods) {
      const key = `${method.file_id}:${method.name}`;
      interfaceMethodsByFileAndName.set(key, { id: method.id, name: method.name });
    }

    const implementationMethodsByFileAndName = new Map<string, { id: number; name: string }>();
    for (const method of implementationMethods) {
      const key = `${method.file_id}:${method.name}`;
      implementationMethodsByFileAndName.set(key, { id: method.id, name: method.name });
    }

    // Step 5: Match interface methods with implementation methods in memory
    const pairs: InterfaceImplementationPair[] = [];

    for (const pair of implementationPairs) {
      // Find all interface methods for this interface
      const interfaceMethodsForFile = interfaceMethods.filter(
        m => m.file_id === pair.interface_file_id
      );

      for (const interfaceMethod of interfaceMethodsForFile) {
        // Look up matching implementation method
        const implKey = `${pair.class_file_id}:${interfaceMethod.name}`;
        const implMethod = implementationMethodsByFileAndName.get(implKey);

        if (implMethod) {
          pairs.push({
            interface_symbol_id: interfaceMethod.id,
            interface_name: interfaceMethod.name,
            implementation_symbol_id: implMethod.id,
            implementation_name: implMethod.name,
            implementation_class: pair.class_name,
          });
        }
      }
    }

    return pairs;
  }

  /// <summary>
  /// Find symbols that implement interfaces or extend base classes
  /// (might be called polymorphically even with zero direct callers)
  /// </summary>
  async findOverrideSymbols(repoId: number): Promise<Set<number>> {
    const overrides = await this.db('dependencies as d')
      .select('d.from_symbol_id')
      .join('symbols as s', 'd.from_symbol_id', 's.id')
      .join('files as f', 's.file_id', 'f.id')
      .where('f.repo_id', repoId)
      .andWhere(function () {
        this.where('d.dependency_type', 'implements')
          .orWhere('d.dependency_type', 'inherits')
          .orWhere('d.dependency_type', 'extends');
      })
      .distinct();

    return new Set(overrides.map(o => o.from_symbol_id));
  }

  /// <summary>
  /// Find symbols that are exported (might be used externally)
  /// </summary>
  async findExportedSymbols(repoId: number): Promise<Set<number>> {
    const exported = await this.db('symbols as s')
      .select('s.id')
      .join('files as f', 's.file_id', 'f.id')
      .where('f.repo_id', repoId)
      .andWhere('s.is_exported', true);

    return new Set(exported.map(e => e.id));
  }

  /// <summary>
  /// Get repository information
  /// </summary>
  async getRepository(
    repoId: number
  ): Promise<{ id: number; name: string; path: string } | null> {
    const repo = await this.db('repositories')
      .select('id', 'name', 'path')
      .where('id', repoId)
      .first();

    return repo || null;
  }

  /// <summary>
  /// Get most recently analyzed repository
  /// </summary>
  async getMostRecentRepository(): Promise<{
    id: number;
    name: string;
    path: string;
  } | null> {
    const repo = await this.db('repositories')
      .select('id', 'name', 'path')
      .orderBy('updated_at', 'desc')
      .first();

    return repo || null;
  }

  /// <summary>
  /// Count total symbols analyzed for summary statistics
  /// </summary>
  async countTotalSymbols(
    repoId: number,
    includeTests: boolean,
    filePattern?: string
  ): Promise<number> {
    let query = this.db('symbols as s')
      .join('files as f', 's.file_id', 'f.id')
      .where('f.repo_id', repoId)
      .count('s.id as count');

    if (filePattern) {
      // Convert glob pattern to SQL LIKE pattern
      // First escape existing SQL wildcards, then convert glob wildcards
      const likePattern = filePattern
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/%/g, '\\%')    // Escape SQL wildcard %
        .replace(/_/g, '\\_')    // Escape SQL wildcard _
        .replace(/\*/g, '%')     // Convert glob * to SQL %
        .replace(/\?/g, '_');    // Convert glob ? to SQL _
      query = query.where('f.path', 'like', likePattern);
    }

    if (!includeTests) {
      query = query.whereNot(function () {
        this.where('f.path', 'like', '%.test.%')
          .orWhere('f.path', 'like', '%.spec.%')
          .orWhere('f.path', 'like', '%/tests/%')
          .orWhere('f.path', 'like', '%/__tests__/%');
      });
    }

    const result = await query.first();
    return parseInt((result?.count as string) || '0', 10);
  }
}
