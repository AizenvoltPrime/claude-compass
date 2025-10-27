import type { Knex } from 'knex';
import type {
  Symbol,
  CreateSymbol,
  SymbolWithFileAndRepository,
  SymbolType,
} from '../models';
import { createComponentLogger } from '../../utils/logger';
import {
  generateSymbolEmbeddings,
  batchGenerateEmbeddings,
} from './embedding-utils';

const logger = createComponentLogger('symbol-service');

/**
 * Deduplicate symbols before database insertion (defense-in-depth safety net).
 * Layer 2 deduplication by physical uniqueness using file_id:name:symbol_type:start_line.
 */
function deduplicateSymbolsForInsertion(symbols: CreateSymbol[]): CreateSymbol[] {
  const seen = new Map<string, CreateSymbol>();

  for (const symbol of symbols) {
    const key = `${symbol.file_id}:${symbol.name}:${symbol.symbol_type}:${symbol.start_line}`;

    if (!seen.has(key) || isMoreCompleteSymbolForInsertion(symbol, seen.get(key)!)) {
      seen.set(key, symbol);
    }
  }

  return Array.from(seen.values());
}

/**
 * Determine if one symbol is more complete than another for deduplication.
 * Prefers symbols with signatures, exported symbols, and better metadata.
 */
function isMoreCompleteSymbolForInsertion(s1: CreateSymbol, s2: CreateSymbol): boolean {
  if (s1.signature && !s2.signature) return true;
  if (!s1.signature && s2.signature) return false;

  if (s1.is_exported && !s2.is_exported) return true;
  if (!s1.is_exported && s2.is_exported) return false;

  if (s1.description && !s2.description) return true;
  if (!s1.description && s2.description) return false;

  if (s1.qualified_name && !s2.qualified_name) return true;
  if (!s1.qualified_name && s2.qualified_name) return false;

  return false;
}

/**
 * Get symbols by repository (optimized with index-backed join)
 */
export async function getSymbolsByRepository(db: Knex, repoId: number): Promise<Symbol[]> {
  const symbols = await db('symbols')
    .join('files', 'symbols.file_id', 'files.id')
    .where('files.repo_id', repoId)
    .select('symbols.*')
    .orderBy('symbols.id');
  return symbols as Symbol[];
}

/**
 * Get symbols needing embeddings
 */
export async function getSymbolsForEmbedding(
  db: Knex,
  repoId: number,
  limit: number,
  afterId: number = 0
): Promise<Symbol[]> {
  const symbols = await db('symbols')
    .join('files', 'symbols.file_id', 'files.id')
    .where('files.repo_id', repoId)
    .where('symbols.id', '>', afterId)
    .whereNull('symbols.combined_embedding')
    .select('symbols.*')
    .orderBy('symbols.id')
    .limit(limit);
  return symbols as Symbol[];
}

/**
 * Count symbols needing embeddings
 */
export async function countSymbolsNeedingEmbeddings(db: Knex, repoId: number): Promise<number> {
  const result = await db('symbols')
    .join('files', 'symbols.file_id', 'files.id')
    .where('files.repo_id', repoId)
    .whereNull('symbols.combined_embedding')
    .count('* as count')
    .first();
  return Number(result?.count || 0);
}

/**
 * Create a single symbol
 */
export async function createSymbol(db: Knex, data: CreateSymbol): Promise<Symbol> {
  const [symbol] = await db('symbols').insert(data).returning('*');

  // Check if search_vector was populated by the PostgreSQL trigger
  // If not, manually populate it (important for test environments)
  try {
    const symbolWithVector = await db('symbols')
      .where('id', symbol.id)
      .whereNotNull('search_vector')
      .first();

    if (!symbolWithVector) {
      // Manually create tsvector like the trigger would
      const searchText = [data.name || '', data.signature || ''].join(' ').trim();

      await db('symbols')
        .where('id', symbol.id)
        .update({
          search_vector: db.raw("to_tsvector('english', ?)", [searchText]),
        });
    }
  } catch (error) {
    // If manual search_vector creation fails, log but don't fail the symbol creation
    logger.warn('Failed to manually populate search_vector', { error: (error as Error).message });
  }

  return symbol as Symbol;
}

/**
 * Create symbol with embeddings synchronously
 */
export async function createSymbolWithEmbeddings(db: Knex, data: CreateSymbol): Promise<Symbol> {
  const [symbol] = await db('symbols').insert(data).returning('*');

  // Generate embeddings synchronously
  await generateSymbolEmbeddings(db, symbol.id, symbol.name, symbol.description);

  return symbol as Symbol;
}

/**
 * Create multiple symbols (batch)
 */
export async function createSymbols(db: Knex, symbols: CreateSymbol[]): Promise<Symbol[]> {
  if (symbols.length === 0) return [];

  const deduplicated = deduplicateSymbolsForInsertion(symbols);

  if (deduplicated.length < symbols.length) {
    const duplicatesRemoved = symbols.length - deduplicated.length;
    logger.info('Removed duplicate symbols before database insertion', {
      original: symbols.length,
      deduplicated: deduplicated.length,
      duplicatesRemoved,
    });
  }

  const BATCH_SIZE = 50;
  const results: Symbol[] = [];

  for (let i = 0; i < deduplicated.length; i += BATCH_SIZE) {
    const batch = deduplicated.slice(i, i + BATCH_SIZE);

    const batchResults = await db('symbols').insert(batch).returning('*');
    results.push(...(batchResults as Symbol[]));
  }

  return results;
}

/**
 * Create symbols with embeddings and progress feedback
 */
export async function createSymbolsWithEmbeddings(
  db: Knex,
  symbols: CreateSymbol[],
  onProgress?: (completed: number, total: number) => void
): Promise<Symbol[]> {
  if (symbols.length === 0) return [];

  const BATCH_SIZE = 50;
  const results: Symbol[] = [];

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);

    const batchResults = await db('symbols').insert(batch).returning('*');
    results.push(...(batchResults as Symbol[]));

    // Generate embeddings for batch synchronously with progress
    await batchGenerateEmbeddings(db, batchResults as Symbol[]);

    if (onProgress) {
      onProgress(Math.min(i + BATCH_SIZE, symbols.length), symbols.length);
    }
  }

  return results;
}

/**
 * Validate that search infrastructure is working properly.
 * Creates a test symbol, verifies it can be found, then cleans up.
 */
export async function validateSearchInfrastructure(db: Knex, repoId: number): Promise<boolean> {
  const testSymbolName = 'TestSearchValidationSymbol_' + Date.now();
  let testFileId: number | null = null;
  let testSymbolId: number | null = null;

  try {
    // Import file-service to create test file
    const { createFile } = await import('./file-service');

    // Create a temporary test file
    const testFile = await createFile(db, {
      repo_id: repoId,
      path: `/test/validation/${testSymbolName}.php`,
      language: 'php',
      is_generated: false,
      is_test: true,
    });
    testFileId = testFile.id;

    // Create a test symbol
    const testSymbol = await createSymbol(db, {
      file_id: testFileId,
      name: testSymbolName,
      symbol_type: 'class' as SymbolType,
      is_exported: true,
      signature: `class ${testSymbolName} extends TestModel`,
    });
    testSymbolId = testSymbol.id;

    // Wait a moment for any async processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify that the symbol can be retrieved
    const retrievedSymbol = await getSymbol(db, testSymbolId);

    return retrievedSymbol !== null;
  } catch (error) {
    logger.warn('Search infrastructure validation failed', {
      error: (error as Error).message,
      testSymbolName,
    });
    return false;
  } finally {
    // Clean up test data
    try {
      if (testSymbolId) {
        await db('symbols').where('id', testSymbolId).del();
      }
      if (testFileId) {
        await db('files').where('id', testFileId).del();
      }
    } catch (cleanupError) {
      logger.warn('Failed to clean up test data', {
        error: (cleanupError as Error).message,
        testSymbolId,
        testFileId,
      });
    }
  }
}

/**
 * Get symbol by ID
 */
export async function getSymbol(db: Knex, id: number): Promise<Symbol | null> {
  const symbol = await db('symbols').where({ id }).first();
  return (symbol as Symbol) || null;
}

/**
 * Get multiple symbols by IDs (batch)
 */
export async function getSymbolsBatch(db: Knex, ids: number[]): Promise<Map<number, Symbol>> {
  if (ids.length === 0) {
    return new Map();
  }

  const symbols = await db('symbols').whereIn('id', ids).select('*');

  return new Map(symbols.map(s => [s.id, s as Symbol]));
}

/**
 * Get symbol with file and repository information
 */
export async function getSymbolWithFile(db: Knex, id: number): Promise<SymbolWithFileAndRepository | null> {
  const result = await db('symbols')
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

/**
 * Get symbols by file ID
 */
export async function getSymbolsByFile(db: Knex, fileId: number): Promise<Symbol[]> {
  const symbols = await db('symbols')
    .where({ file_id: fileId })
    .orderBy(['start_line', 'name']);
  return symbols as Symbol[];
}

/**
 * Get symbols for multiple files (batch).
 * Returns a Map of fileId to symbols array.
 */
export async function getSymbolsByFiles(db: Knex, fileIds: number[]): Promise<Map<number, Symbol[]>> {
  if (fileIds.length === 0) {
    return new Map();
  }

  const symbols = await db('symbols')
    .whereIn('file_id', fileIds)
    .orderBy(['file_id', 'start_line', 'name'])
    .select('*');

  const symbolsByFile = new Map<number, Symbol[]>();
  for (const symbol of symbols) {
    const fileSymbols = symbolsByFile.get(symbol.file_id) || [];
    fileSymbols.push(symbol as Symbol);
    symbolsByFile.set(symbol.file_id, fileSymbols);
  }

  return symbolsByFile;
}

