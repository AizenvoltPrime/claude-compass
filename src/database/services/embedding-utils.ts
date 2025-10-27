import type { Knex } from 'knex';
import { getEmbeddingService, EmbeddingService } from '../../services/embedding-service';
import { createComponentLogger } from '../../utils/logger';
import { validateEmbedding as validateEmbeddingVector } from './validation-utils';
import type { Symbol } from '../models';

const logger = createComponentLogger('embedding-utils');

// Module-level state for embedding management
let embeddingService: EmbeddingService | null = null;
const embeddingCache = new Map<string, number[]>();

// Embedding failure tracking
let embeddingFailureCounter = 0;
let embeddingTotalAttempts = 0;
let lastFailureRateWarning = 0;

/**
 * Get or initialize embedding service singleton
 */
function getService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = getEmbeddingService();
  }
  return embeddingService;
}

/**
 * Track embedding generation failures and alert on systematic issues.
 * Prevents silent degradation of semantic search quality.
 */
export function trackEmbeddingFailure(context: string): void {
  embeddingTotalAttempts++;
  embeddingFailureCounter++;

  const failureRate = embeddingFailureCounter / embeddingTotalAttempts;
  const now = Date.now();

  // Alert on systematic failure (>10% failure rate with at least 10 attempts)
  // Throttle warnings to once per minute to avoid log spam
  if (
    failureRate > 0.1 &&
    embeddingTotalAttempts >= 10 &&
    now - lastFailureRateWarning > 60000
  ) {
    logger.error('High embedding failure rate detected - check service availability', {
      failureRate: `${(failureRate * 100).toFixed(1)}%`,
      totalFailures: embeddingFailureCounter,
      totalAttempts: embeddingTotalAttempts,
      context,
    });
    lastFailureRateWarning = now;
  }
}

/**
 * Track successful embedding generation.
 */
export function trackEmbeddingSuccess(): void {
  embeddingTotalAttempts++;
}

/**
 * Get cached embedding or generate new one
 */
export async function getCachedEmbedding(text: string): Promise<number[]> {
  // Check cache first
  if (embeddingCache.has(text)) {
    return embeddingCache.get(text)!;
  }

  // Generate new embedding
  const service = getService();
  const embedding = await service.generateEmbedding(text);

  // Cache with LRU management
  embeddingCache.set(text, embedding);

  // LRU cache management - remove oldest if over limit
  if (embeddingCache.size > 1000) {
    const firstKey = embeddingCache.keys().next().value;
    embeddingCache.delete(firstKey);
  }

  return embedding;
}

/**
 * Generate embeddings for a single symbol
 */
export async function generateSymbolEmbeddings(
  db: Knex,
  symbolId: number,
  name: string,
  description?: string
): Promise<void> {
  try {
    // Generate combined embedding (name + description)
    const combinedText = description ? `${name} ${description}` : name;
    const service = getService();
    const combinedEmbedding = await service.generateEmbedding(combinedText);

    await db('symbols')
      .where('id', symbolId)
      .update({
        combined_embedding: JSON.stringify(combinedEmbedding),
        embeddings_updated_at: new Date(),
        embedding_model: 'bge-m3',
      });

    trackEmbeddingSuccess();
  } catch (error) {
    trackEmbeddingFailure(`generateSymbolEmbeddings:${symbolId}`);
    logger.warn(`Failed to generate embeddings for symbol ${symbolId}:`, error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple symbols in batch
 */
export async function batchGenerateEmbeddings(db: Knex, symbols: Symbol[]): Promise<void> {
  if (symbols.length === 0) return;

  try {
    // Process each symbol individually for better error handling
    for (const symbol of symbols) {
      try {
        await generateSymbolEmbeddings(db, symbol.id, symbol.name, symbol.description);
      } catch (error) {
        // Log error but continue with other symbols
        logger.warn(
          `Failed to generate embedding for symbol ${symbol.id} (${symbol.name}):`,
          error
        );
      }
    }
  } catch (error) {
    logger.error('Batch embedding generation failed:', error);
    throw error;
  }
}

/**
 * Update symbol embeddings
 */
export async function updateSymbolEmbeddings(
  db: Knex,
  symbolId: number,
  combinedEmbedding: number[],
  modelName: string
): Promise<void> {
  await db('symbols')
    .where({ id: symbolId })
    .update({
      combined_embedding: JSON.stringify(combinedEmbedding),
      embeddings_updated_at: new Date(),
      embedding_model: modelName,
    });
}

/**
 * Batch update symbol embeddings
 */
export async function batchUpdateSymbolEmbeddings(
  db: Knex,
  updates: Array<{
    id: number;
    combinedEmbedding: number[];
    embeddingModel: string;
  }>
): Promise<void> {
  // Reduce batch size to minimize JSON string memory pressure
  // Each symbol: 1 embedding × 1024 numbers → ~6KB JSON strings
  const BATCH_SIZE = 50;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    await db.transaction(async trx => {
      // Process serially to avoid holding all JSON strings in memory
      for (const update of batch) {
        const combinedEmbStr = JSON.stringify(update.combinedEmbedding);

        await trx('symbols').where('id', update.id).update({
          combined_embedding: combinedEmbStr,
          embeddings_updated_at: new Date(),
          embedding_model: update.embeddingModel,
        });

        // String goes out of scope here and can be freed
      }
    });
  }
}

/**
 * Get symbol similarities using cosine distance
 */
export async function getSymbolSimilarities(
  db: Knex,
  symbolIds: number[],
  queryEmbedding: number[]
): Promise<Map<number, number>> {
  if (symbolIds.length === 0) return new Map();

  const results = (await db('symbols')
    .whereIn('id', symbolIds)
    .whereNotNull('combined_embedding')
    .select([
      'id',
      db.raw('(1 - (combined_embedding <=> ?)) as similarity', [JSON.stringify(queryEmbedding)]),
    ])) as Array<{ id: number; similarity: number }>;

  const similarities = new Map<number, number>();
  for (const row of results) {
    similarities.set(row.id, row.similarity);
  }

  return similarities;
}

/**
 * Initialize embedding service
 */
export async function initializeEmbeddingService(): Promise<void> {
  const service = getService();
  if (!await service.initialized) {
    await service.initialize();
  }
}

/**
 * Check if embedding service is initialized
 */
export async function isEmbeddingServiceInitialized(): Promise<boolean> {
  const service = getService();
  return await service.initialized;
}

// Re-export validation function for convenience
export { validateEmbeddingVector as validateEmbedding };
