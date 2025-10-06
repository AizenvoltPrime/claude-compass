import { AutoTokenizer, env as transformersEnv } from '@xenova/transformers';
import * as ort from 'onnxruntime-node';
import os from 'os';
import path from 'path';
import fs from 'fs';

transformersEnv.cacheDir = path.join(os.homedir(), '.cache', 'claude-compass', 'models');
transformersEnv.allowLocalModels = true;
transformersEnv.allowRemoteModels = true;

/**
 * Service for generating vector embeddings using BGE-M3
 * Uses bge-m3 model for 1024-dimensional embeddings with GPU acceleration
 * State-of-the-art model with multi-lingual support and clean ONNX export
 * Automatically uses CUDA GPU if available, falls back to CPU
 */
export class EmbeddingService {
  private session: ort.InferenceSession | null = null;
  private tokenizer: any | null = null;
  private readonly modelName = 'Xenova/bge-m3';
  private initializationPromise: Promise<void> | null = null;
  private isInitialized = false;
  private useGPU = false;

  /**
   * Initialize the embedding model with GPU support
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

      // Load tokenizer using transformers.js
      console.log('Loading tokenizer...');
      this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName);

      // Find ONNX model file in transformers cache
      const modelPath = await this.findOnnxModelPath();

      // Check GPU availability (CUDA doesn't need to be bundled, just listed)
      const backends = ort.listSupportedBackends();
      const cudaAvailable = backends.some(b => b.name === 'cuda');

      // Create session options optimized for GPU if available
      const sessionOptions: ort.InferenceSession.SessionOptions = {
        executionProviders: [],
        graphOptimizationLevel: 'all',
        executionMode: 'parallel',
        logSeverityLevel: 2, // Warning level (reduces log spam)
        logVerbosityLevel: 0
      };

      // Try CUDA first, fall back to CPU
      if (cudaAvailable) {
        console.log('CUDA support detected, attempting GPU acceleration...');
        sessionOptions.executionProviders = [
          {
            name: 'cuda',
            deviceId: 0
          } as any, // Type assertion needed for CUDA-specific options
          'cpu'
        ];
        this.useGPU = true;
      } else {
        console.log('No CUDA support detected, using CPU');
        sessionOptions.executionProviders = ['cpu'];
        this.useGPU = false;
      }

      // Create ONNX Runtime inference session
      this.session = await ort.InferenceSession.create(modelPath, sessionOptions);

      // Log provider status
      console.log('ONNX Runtime session created');
      if (this.useGPU) {
        console.log('GPU acceleration enabled (CUDA provider) ✓');
      } else {
        console.log('Using CPU provider');
      }

      this.isInitialized = true;
      console.log('Embedding model loaded successfully');
    } catch (error) {
      console.error('Failed to load embedding model:', error);
      this.initializationPromise = null;
      throw new Error(`Failed to initialize embedding model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find the ONNX model file in the transformers.js cache
   */
  private async findOnnxModelPath(): Promise<string> {
    const cacheDir = path.join(os.homedir(), '.cache', 'claude-compass', 'models');

    // Prefer FP16 model for GPU, fall back to quantized for CPU
    const possiblePaths = [
      path.join(cacheDir, 'Xenova', 'bge-m3', 'onnx', 'model.onnx'),          // FP16 (best for GPU)
      path.join(cacheDir, 'Xenova', 'bge-m3', 'onnx', 'model_quantized.onnx') // Quantized (fallback)
    ];

    for (const onnxPath of possiblePaths) {
      if (fs.existsSync(onnxPath)) {
        const modelType = onnxPath.includes('quantized') ? 'quantized (CPU-optimized)' : 'FP16 (GPU-optimized)';
        console.log(`Using ONNX model: ${modelType}`);
        console.log(`  Path: ${onnxPath}`);
        return onnxPath;
      }
    }

    throw new Error(
      `ONNX model not found. Tried:\n${possiblePaths.join('\n')}\n\n` +
      `Please download the model first by running:\n` +
      `  node download-bge-m3.js`
    );
  }

  /**
   * Generate embedding for a single text string
   * @param text Input text to embed
   * @returns 1024-dimensional embedding vector
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.session || !this.tokenizer) {
      throw new Error('Embedding model not initialized');
    }

    try {
      const sanitizedText = this.sanitizeTextForEmbedding(text);
      if (!sanitizedText.trim()) {
        return new Array(1024).fill(0);
      }

      // Tokenize input
      const encoded = await this.tokenizer(sanitizedText, {
        padding: true,
        truncation: true
      });

      // Convert to ONNX Runtime tensors manually
      const inputIds = encoded.input_ids.data;
      const attentionMask = encoded.attention_mask.data;
      const dims = encoded.input_ids.dims;

      const feeds = {
        input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds, BigInt), dims),
        attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask, BigInt), dims)
      };

      const outputs = await this.session.run(feeds);

      // Extract embeddings from last_hidden_state
      // Shape: [batch_size, sequence_length, hidden_size]
      const lastHiddenState = outputs.last_hidden_state;

      // Perform mean pooling
      const embeddings = this.meanPooling(
        lastHiddenState.data as Float32Array,
        encoded.attention_mask.data as BigInt64Array,
        lastHiddenState.dims as number[]
      );

      // Normalize
      const normalized = this.normalize(embeddings);

      if (normalized.length !== 1024) {
        throw new Error(`Expected 1024-dimensional embedding, got ${normalized.length}`);
      }

      return normalized;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * @param texts Array of input texts
   * @returns Array of 1024-dimensional embedding vectors
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.session || !this.tokenizer) {
      throw new Error('Embedding model not initialized');
    }

    if (texts.length === 0) {
      return [];
    }

    const MAX_BATCH_SIZE = this.useGPU ? 32 : 16;

    if (texts.length > MAX_BATCH_SIZE) {
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
        const chunk = texts.slice(i, i + MAX_BATCH_SIZE);
        const chunkEmbeddings = await this.generateBatchEmbeddingsChunk(chunk);
        results.push(...chunkEmbeddings);
      }
      return results;
    }

    return this.generateBatchEmbeddingsChunk(texts);
  }

  /**
   * Generate embeddings for a single chunk of texts (internal method)
   */
  private async generateBatchEmbeddingsChunk(texts: string[]): Promise<number[][]> {
    if (!this.session || !this.tokenizer) {
      throw new Error('Embedding model not initialized');
    }

    try {
      const sanitizedTexts = texts.map(text => this.sanitizeTextForEmbedding(text));
      const processedTexts = sanitizedTexts.map(text => text.trim() || '[empty]');

      const encoded = await this.tokenizer(processedTexts, {
        padding: true,
        truncation: true,
        max_length: 256
      });

      const inputIds = encoded.input_ids.data;
      const attentionMask = encoded.attention_mask.data;
      const dims = encoded.input_ids.dims;

      const feeds = {
        input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds, BigInt), dims),
        attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask, BigInt), dims)
      };

      const outputs = await this.session.run(feeds);
      const lastHiddenState = outputs.last_hidden_state;

      const results: number[][] = [];
      const batchSize = (lastHiddenState.dims as number[])[0];
      const seqLength = (lastHiddenState.dims as number[])[1];
      const hiddenSize = (lastHiddenState.dims as number[])[2];

      for (let i = 0; i < batchSize; i++) {
        const start = i * seqLength * hiddenSize;
        const end = start + seqLength * hiddenSize;
        const itemHiddenStates = (lastHiddenState.data as Float32Array).slice(start, end);

        const maskStart = i * seqLength;
        const maskEnd = maskStart + seqLength;
        const itemMask = (encoded.attention_mask.data as BigInt64Array).slice(maskStart, maskEnd);

        const pooled = this.meanPooling(
          itemHiddenStates,
          itemMask,
          [1, seqLength, hiddenSize]
        );

        const normalized = this.normalize(pooled);

        if (sanitizedTexts[i].trim() === '') {
          results.push(new Array(1024).fill(0));
        } else {
          results.push(normalized);
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to generate batch embeddings:', error);
      throw new Error(`Batch embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Mean pooling operation
   */
  private meanPooling(
    hiddenStates: Float32Array,
    attentionMask: BigInt64Array,
    dims: number[]
  ): number[] {
    const [batchSize, seqLength, hiddenSize] = dims;
    const pooled = new Float32Array(hiddenSize);

    let tokenCount = 0;
    for (let i = 0; i < seqLength; i++) {
      if (Number(attentionMask[i]) > 0) {
        tokenCount++;
        for (let j = 0; j < hiddenSize; j++) {
          pooled[j] += hiddenStates[i * hiddenSize + j];
        }
      }
    }

    // Average
    if (tokenCount > 0) {
      for (let i = 0; i < hiddenSize; i++) {
        pooled[i] /= tokenCount;
      }
    }

    return Array.from(pooled);
  }

  /**
   * L2 normalization
   */
  private normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) return vector;
    return vector.map(val => val / norm);
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
      .replace(/[^\w\s.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
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
  get modelInfo(): { name: string; dimensions: number; gpu: boolean } {
    return {
      name: this.modelName,
      dimensions: 1024,
      gpu: this.useGPU
    };
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
    this.tokenizer = null;
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
