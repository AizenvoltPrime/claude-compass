import { pipeline, Pipeline } from '@xenova/transformers';

/**
 * Service for generating vector embeddings using Nomic AI
 * Uses nomic-embed-text-v1.5 model for 768-dimensional embeddings
 * Designed for retrieval with 8192 token context window and formal Matryoshka Representation Learning
 */
export class EmbeddingService {
  private model: any | null = null;
  private readonly modelName = 'nomic-ai/nomic-embed-text-v1.5';
  private initializationPromise: Promise<void> | null = null;
  private isInitialized = false;

  /**
   * Initialize the embedding model
   * Uses lazy initialization to avoid loading model until needed
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._initialize();
    await this.initializationPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      console.log(`Loading embedding model: ${this.modelName}`);
      this.model = await pipeline('feature-extraction', this.modelName);
      this.isInitialized = true;
      console.log('Embedding model loaded successfully');
    } catch (error) {
      console.error('Failed to load embedding model:', error);
      this.initializationPromise = null;
      throw new Error(`Failed to initialize embedding model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embedding for a single text string
   * @param text Input text to embed
   * @returns 768-dimensional embedding vector
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.model) {
      throw new Error('Embedding model not initialized');
    }

    try {
      const sanitizedText = this.sanitizeTextForEmbedding(text);
      if (!sanitizedText.trim()) {
        // Return zero vector for empty text
        return new Array(768).fill(0);
      }

      const embeddings = await this.model(sanitizedText, {
        pooling: 'mean',
        normalize: true
      });

      // Extract the embedding data and ensure it's a proper array
      const embeddingArray = Array.from(embeddings.data as Float32Array);

      if (embeddingArray.length !== 768) {
        throw new Error(`Expected 768-dimensional embedding, got ${embeddingArray.length}`);
      }

      return embeddingArray;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * @param texts Array of input texts
   * @returns Array of 768-dimensional embedding vectors
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.model) {
      throw new Error('Embedding model not initialized');
    }

    if (texts.length === 0) {
      return [];
    }

    try {
      // Process texts individually for better error handling
      // This ensures one failed text doesn't break the entire batch
      const results: number[][] = [];

      for (const text of texts) {
        try {
          const embedding = await this.generateEmbedding(text);
          results.push(embedding);
        } catch (error) {
          console.warn(`Failed to generate embedding for text: "${text.substring(0, 50)}..."`, error);
          // Use zero vector as fallback
          results.push(new Array(768).fill(0));
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to generate batch embeddings:', error);
      throw new Error(`Batch embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Sanitize and prepare text for embedding generation
   * @param text Raw input text
   * @returns Cleaned text suitable for embedding
   */
  private sanitizeTextForEmbedding(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      // Remove or replace problematic characters
      .replace(/[^\w\s.-]/g, ' ')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim()
      // Limit length to prevent model overload (8192 tokens is roughly 32768 characters)
      .substring(0, 8192);
  }

  /**
   * Check if the service is initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get model information
   */
  get modelInfo(): { name: string; dimensions: number } {
    return {
      name: this.modelName,
      dimensions: 768
    };
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    this.model = null;
    this.isInitialized = false;
    this.initializationPromise = null;
  }
}

// Singleton instance for global use
let globalEmbeddingService: EmbeddingService | null = null;

/**
 * Get the global embedding service instance
 * @returns Singleton EmbeddingService instance
 */
export function getEmbeddingService(): EmbeddingService {
  if (!globalEmbeddingService) {
    globalEmbeddingService = new EmbeddingService();
  }
  return globalEmbeddingService;
}

/**
 * Cleanup the global embedding service
 */
export async function cleanupEmbeddingService(): Promise<void> {
  if (globalEmbeddingService) {
    await globalEmbeddingService.dispose();
    globalEmbeddingService = null;
  }
}