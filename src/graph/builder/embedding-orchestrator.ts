import type { Knex } from 'knex';
import * as SymbolService from '../../database/services/symbol-service';
import * as EmbeddingUtils from '../../database/services/embedding-utils';
import { getEmbeddingService } from '../../services/embedding-service';
import { AdaptiveEmbeddingController } from '../../utils/adaptive-embedding-controller';
import { createComponentLogger } from '../../utils/logger';

/**
 * Embedding Orchestrator
 * Handles symbol embedding generation with adaptive batching and GPU memory management
 */
export class EmbeddingOrchestrator {
  private logger: any;

  constructor(
    private db: Knex,
    logger?: any
  ) {
    this.logger = logger || createComponentLogger('embedding-orchestrator');
  }

  async generateSymbolEmbeddings(repositoryId: number): Promise<void> {
    const totalSymbols = await SymbolService.countSymbolsNeedingEmbeddings(
      this.db,
      repositoryId
    );
    if (totalSymbols === 0) return;

    this.logger.info('Generating embeddings for symbols', {
      repositoryId,
      symbolCount: totalSymbols,
    });

    const embeddingService = getEmbeddingService();
    await embeddingService.initialize();

    const isGPU = embeddingService.modelInfo.gpu;

    const initialBatchSize = isGPU ? 16 : 32;
    const adaptiveController = new AdaptiveEmbeddingController(initialBatchSize, isGPU);

    this.logger.info('Starting adaptive embedding generation', {
      totalSymbols,
      isGPU,
      initialBatchSize,
      modelName: embeddingService.modelInfo.name,
      modelDimensions: embeddingService.modelInfo.dimensions,
      mode: 'adaptive (zero-config: adjusts batch size and session resets based on runtime conditions)',
    });

    const CHUNK_SIZE = 1000;
    let lastProcessedId = 0;
    let processed = 0;
    let chunkIndex = 0;
    let pendingAdjustment: Promise<any> | null = null;

    let currentChunk = await SymbolService.getSymbolsForEmbedding(
      this.db,
      repositoryId,
      CHUNK_SIZE,
      lastProcessedId
    );

    while (currentChunk.length > 0) {
      const symbols = currentChunk;

      let nextChunkPromise: Promise<any[]> | null = null;
      if (symbols.length === CHUNK_SIZE) {
        const nextLastProcessedId = Math.max(...symbols.map(s => s.id!));
        nextChunkPromise = SymbolService.getSymbolsForEmbedding(
          this.db,
          repositoryId,
          CHUNK_SIZE,
          nextLastProcessedId
        );
      }

      this.logger.info(`Processing chunk ${chunkIndex + 1}`, {
        symbolsInChunk: symbols.length,
        processed,
        total: totalSymbols,
      });

      let i = 0;
      while (i < symbols.length) {
        const batchNum = adaptiveController.getState().totalBatches;
        if (batchNum % 10 === 0 && !pendingAdjustment) {
          pendingAdjustment = adaptiveController.adjustBatchSize().then(adjustment => {
            if (adjustment.changed) {
              this.logger.info('Adaptive batch size adjustment', {
                newSize: adjustment.newBatchSize,
                reason: adjustment.reason,
              });
            }
            pendingAdjustment = null;
            return adjustment;
          });
        }

        if (pendingAdjustment && batchNum % 20 === 0) {
          await pendingAdjustment;
        }

        const prepared = adaptiveController.prepareBatch(symbols.slice(i));
        const { nameTexts, descriptionTexts, decidedBatchSize, finalBatch } = prepared;

        let batchProcessed = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (!batchProcessed && retryCount < maxRetries) {
          try {
            const batchStart = Date.now();
            const combinedTexts = nameTexts.map((name, idx) => {
              const desc = descriptionTexts[idx];
              return desc ? `${name} ${desc}` : name;
            });
            const combinedEmbeddings =
              await embeddingService.generateBatchEmbeddings(combinedTexts);

            const batchDuration = Date.now() - batchStart;

            adaptiveController.recordBatchTime(batchDuration, decidedBatchSize);

            const updates = finalBatch.map((symbol, j) => ({
              id: symbol.id!,
              combinedEmbedding: combinedEmbeddings[j],
              embeddingModel: 'bge-m3',
            }));

            await EmbeddingUtils.batchUpdateSymbolEmbeddings(this.db, updates);

            updates.length = 0;
            combinedEmbeddings.length = 0;

            processed += finalBatch.length;
            i += decidedBatchSize;
            batchProcessed = true;

            const controllerState = adaptiveController.getState();
            this.logger.debug('Batch embeddings generated', {
              processed,
              total: totalSymbols,
              batchSize: decidedBatchSize,
              progress: `${Math.round((processed / totalSymbols) * 100)}%`,
              adaptiveBatchSize: controllerState.currentBatchSize,
              batchDurationMs: batchDuration,
            });

            const resetDecision = await adaptiveController.shouldResetSession();
            if (resetDecision.shouldReset && processed < totalSymbols) {
              const percentComplete = Math.round((processed / totalSymbols) * 100);
              this.logger.info('Adaptive ONNX session reset triggered', {
                processed,
                total: totalSymbols,
                progress: `${percentComplete}%`,
                reason: resetDecision.reason,
                gpuMemory: resetDecision.memoryInfo
                  ? {
                      used: `${resetDecision.memoryInfo.used}MB`,
                      total: `${resetDecision.memoryInfo.total}MB`,
                      utilization: `${resetDecision.memoryInfo.utilizationPercent.toFixed(1)}%`,
                    }
                  : undefined,
              });

              const resetStart = Date.now();
              await embeddingService.dispose();
              await embeddingService.initialize();
              adaptiveController.recordSessionReset();

              const resetDuration = Date.now() - resetStart;
              this.logger.info('ONNX session reset complete', {
                durationMs: resetDuration,
              });
            }
          } catch (error) {
            retryCount++;
            const errorMessage = (error as Error).message;

            if (
              errorMessage.includes('Failed to allocate memory') ||
              errorMessage.includes('FusedMatMul')
            ) {
              this.logger.warn('GPU OOM detected - adaptive controller will handle', {
                error: errorMessage,
                retry: retryCount,
                maxRetries,
              });

              await embeddingService.dispose();
              await embeddingService.initialize();
              adaptiveController.recordSessionReset();

              if (retryCount >= maxRetries) {
                this.logger.error('Failed after retries, skipping batch', {
                  batchStart: i,
                  decidedBatchSize,
                });
                i += decidedBatchSize;
                batchProcessed = true;
              }
            } else {
              this.logger.error('Failed to generate embeddings for batch', {
                batchStart: i,
                batchSize: decidedBatchSize,
                error: errorMessage,
              });
              i += decidedBatchSize;
              batchProcessed = true;
            }
          }
        }
      }

      if (nextChunkPromise) {
        currentChunk = await nextChunkPromise;
      } else {
        currentChunk = [];
      }
      chunkIndex++;
    }

    const finalState = adaptiveController.getState();
    this.logger.info('Embedding generation completed', {
      symbolsProcessed: processed,
      totalBatches: finalState.totalBatches,
      finalBatchSize: finalState.currentBatchSize,
      initialBatchSize: finalState.initialBatchSize,
      baselineProcessingTime: finalState.baselineProcessingTime
        ? `${Math.round(finalState.baselineProcessingTime)}ms`
        : 'N/A',
      recentAvgProcessingTime: finalState.recentAvgProcessingTime
        ? `${Math.round(finalState.recentAvgProcessingTime)}ms`
        : 'N/A',
    });
  }
}
