import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface GPUMemoryInfo {
  used: number;
  total: number;
  free: number;
  utilizationPercent: number;
}

interface AdaptiveMetrics {
  batchProcessingTimes: number[];
  memoryGrowthRate: number;
  consecutiveSlowBatches: number;
  lastResetBatch: number;
  totalBatches: number;
}

export class AdaptiveEmbeddingController {
  private metrics: AdaptiveMetrics = {
    batchProcessingTimes: [],
    memoryGrowthRate: 0,
    consecutiveSlowBatches: 0,
    lastResetBatch: 0,
    totalBatches: 0,
  };

  private initialBatchSize: number;
  private currentBatchSize: number;
  private isGPU: boolean;
  private lastMemoryCheck: GPUMemoryInfo | null = null;
  private baselineProcessingTime: number | null = null;
  private gpuMemoryCache: { info: GPUMemoryInfo; timestamp: number } | null = null;

  // Thresholds for adaptive decisions
  private readonly GPU_MEMORY_CACHE_TTL_MS = 2000; // Cache GPU memory for 2 seconds
  private readonly SLOW_BATCH_THRESHOLD_MS = 5000;
  private readonly MEMORY_DANGER_THRESHOLD = 0.90; // 90% GPU memory usage
  private readonly MEMORY_WARNING_THRESHOLD = 0.80; // 80% GPU memory usage
  private readonly PROCESSING_TIME_SPIKE_MULTIPLIER = 2.5; // 2.5x baseline = spike
  private readonly MIN_BATCH_SIZE = 2;
  private readonly MAX_BATCH_SIZE_INCREASE_FACTOR = 1.5;
  private readonly BATCH_HISTORY_SIZE = 10;

  constructor(initialBatchSize: number, isGPU: boolean) {
    this.initialBatchSize = initialBatchSize;
    this.currentBatchSize = initialBatchSize;
    this.isGPU = isGPU;
  }

  /**
   * Get current GPU memory usage (CUDA only) with 2-second caching
   */
  private async getGPUMemory(): Promise<GPUMemoryInfo | null> {
    if (!this.isGPU) return null;

    // Return cached value if fresh
    const now = Date.now();
    if (this.gpuMemoryCache && now - this.gpuMemoryCache.timestamp < this.GPU_MEMORY_CACHE_TTL_MS) {
      return this.gpuMemoryCache.info;
    }

    try {
      const { stdout } = await execAsync(
        'nvidia-smi --query-gpu=memory.used,memory.total,memory.free --format=csv,noheader,nounits'
      );

      const [used, total, free] = stdout.trim().split(',').map(s => parseInt(s.trim()));
      const utilizationPercent = (used / total) * 100;
      const info = { used, total, free, utilizationPercent };

      // Update cache
      this.gpuMemoryCache = { info, timestamp: now };

      return info;
    } catch (error) {
      // nvidia-smi not available or failed
      return null;
    }
  }

  /**
   * Calculate memory growth rate between checks
   */
  private calculateMemoryGrowth(current: GPUMemoryInfo): number {
    if (!this.lastMemoryCheck) {
      this.lastMemoryCheck = current;
      return 0;
    }

    const growth = current.used - this.lastMemoryCheck.used;
    this.lastMemoryCheck = current;
    return growth;
  }

  /**
   * Decide batch size based on text characteristics
   */
  public decideBatchSize(texts: string[]): number {
    const avgTextLength = texts.reduce((sum, t) => sum + t.length, 0) / texts.length;
    const maxTextLength = Math.max(...texts.map(t => t.length));

    // Very long sequences (500+ chars average, likely 200+ tokens)
    if (avgTextLength > 500 || maxTextLength > 1500) {
      return Math.min(this.currentBatchSize, 4);
    }

    // Long sequences (300-500 chars)
    if (avgTextLength > 300 || maxTextLength > 1000) {
      return Math.min(this.currentBatchSize, 8);
    }

    // Medium sequences (150-300 chars)
    if (avgTextLength > 150 || maxTextLength > 500) {
      return Math.min(this.currentBatchSize, 12);
    }

    // Short sequences - use current batch size
    return this.currentBatchSize;
  }

  /**
   * Single-pass batch preparation: extract texts AND decide batch size in one iteration
   * Replaces multiple separate map/reduce operations for better performance
   */
  public prepareBatch(symbols: any[]): {
    nameTexts: string[];
    descriptionTexts: string[];
    decidedBatchSize: number;
    finalBatch: any[];
  } {
    let sumLength = 0;
    let maxLength = 0;
    const maxSymbols = Math.min(symbols.length, this.currentBatchSize);

    const nameTexts: string[] = [];
    const descriptionTexts: string[] = [];

    // Single pass: extract texts AND calculate statistics
    for (let i = 0; i < maxSymbols; i++) {
      const s = symbols[i];
      nameTexts.push(s.name || '');

      const parts = [];
      if (s.qualified_name) parts.push(s.qualified_name);
      if (s.signature) parts.push(s.signature);
      const desc = parts.join(' ') || s.name || '';
      descriptionTexts.push(desc);

      const len = desc.length;
      sumLength += len;
      if (len > maxLength) maxLength = len;
    }

    // Decide batch size based on statistics
    const avgLength = sumLength / nameTexts.length;
    let decidedBatchSize = this.currentBatchSize;

    if (avgLength > 500 || maxLength > 1500) decidedBatchSize = Math.min(decidedBatchSize, 4);
    else if (avgLength > 300 || maxLength > 1000) decidedBatchSize = Math.min(decidedBatchSize, 8);
    else if (avgLength > 150 || maxLength > 500) decidedBatchSize = Math.min(decidedBatchSize, 12);

    // Trim to decided size
    if (decidedBatchSize < nameTexts.length) {
      nameTexts.length = decidedBatchSize;
      descriptionTexts.length = decidedBatchSize;
    }

    const finalBatch = symbols.slice(0, decidedBatchSize);

    return { nameTexts, descriptionTexts, decidedBatchSize, finalBatch };
  }

  /**
   * Record batch processing time and update baseline
   */
  public recordBatchTime(durationMs: number, actualBatchSize?: number): void {
    this.metrics.batchProcessingTimes.push(durationMs);
    this.metrics.totalBatches++;

    // Keep only recent history
    if (this.metrics.batchProcessingTimes.length > this.BATCH_HISTORY_SIZE) {
      this.metrics.batchProcessingTimes.shift();
    }

    // Establish baseline from first 3 batches (warm-up period)
    // Only use batches that are at full adaptive size (not text-reduced)
    const isFullSizeBatch = !actualBatchSize || actualBatchSize >= this.currentBatchSize;
    if (
      this.baselineProcessingTime === null &&
      this.metrics.batchProcessingTimes.length >= 3 &&
      isFullSizeBatch
    ) {
      this.baselineProcessingTime =
        this.metrics.batchProcessingTimes.reduce((sum, t) => sum + t, 0) /
        this.metrics.batchProcessingTimes.length;
    }

    // Track consecutive slow batches
    // IMPORTANT: Only count slow batches that are at full adaptive size
    // If batch was reduced due to long texts (actualBatchSize < currentBatchSize),
    // the slowness is expected and should not trigger adaptive reduction
    if (durationMs > this.SLOW_BATCH_THRESHOLD_MS && isFullSizeBatch) {
      this.metrics.consecutiveSlowBatches++;
    } else if (isFullSizeBatch) {
      // Only reset counter on fast batches at full size
      this.metrics.consecutiveSlowBatches = 0;
    }
    // If batch was text-reduced, don't change consecutiveSlowBatches counter
  }

  /**
   * Decide if session reset is needed based on multiple factors
   */
  public async shouldResetSession(): Promise<{
    shouldReset: boolean;
    reason?: string;
    memoryInfo?: GPUMemoryInfo;
  }> {
    if (!this.isGPU) {
      return { shouldReset: false };
    }

    const memoryInfo = await this.getGPUMemory();

    // If we can't check GPU memory, fall back to batch-count heuristic
    if (!memoryInfo) {
      const batchesSinceReset = this.metrics.totalBatches - this.metrics.lastResetBatch;
      const heuristicInterval = 150; // Conservative fallback

      if (batchesSinceReset >= heuristicInterval) {
        return {
          shouldReset: true,
          reason: `Batch count reached ${batchesSinceReset} (heuristic fallback)`,
        };
      }
      return { shouldReset: false };
    }

    // Critical: GPU memory at danger level
    if (memoryInfo.utilizationPercent >= this.MEMORY_DANGER_THRESHOLD * 100) {
      return {
        shouldReset: true,
        reason: `GPU memory critical: ${memoryInfo.utilizationPercent.toFixed(1)}% (${memoryInfo.used}MB / ${memoryInfo.total}MB)`,
        memoryInfo,
      };
    }

    // Warning: GPU memory high + rapid growth
    const memoryGrowth = this.calculateMemoryGrowth(memoryInfo);
    if (
      memoryInfo.utilizationPercent >= this.MEMORY_WARNING_THRESHOLD * 100 &&
      memoryGrowth > 100 // Growing by 100MB+ between checks
    ) {
      return {
        shouldReset: true,
        reason: `GPU memory growing rapidly: ${memoryInfo.utilizationPercent.toFixed(1)}% and +${memoryGrowth}MB growth`,
        memoryInfo,
      };
    }

    // Multiple consecutive slow batches indicate memory pressure
    if (this.metrics.consecutiveSlowBatches >= 3) {
      return {
        shouldReset: true,
        reason: `${this.metrics.consecutiveSlowBatches} consecutive slow batches (likely memory thrashing)`,
        memoryInfo,
      };
    }

    return { shouldReset: false, memoryInfo };
  }

  /**
   * Record that session was reset
   */
  public recordSessionReset(): void {
    this.metrics.lastResetBatch = this.metrics.totalBatches;
    this.metrics.consecutiveSlowBatches = 0;
    this.lastMemoryCheck = null; // Reset memory baseline
    this.gpuMemoryCache = null; // Invalidate cache after session reset
  }

  /**
   * Adjust batch size based on recent performance
   */
  public async adjustBatchSize(): Promise<{
    newBatchSize: number;
    changed: boolean;
    reason?: string;
  }> {
    // Check GPU memory
    const memoryInfo = await this.getGPUMemory();
    if (memoryInfo) {
      // Reduce batch size if memory is high
      if (memoryInfo.utilizationPercent >= this.MEMORY_WARNING_THRESHOLD * 100) {
        this.currentBatchSize = Math.max(
          this.MIN_BATCH_SIZE,
          Math.floor(this.currentBatchSize * 0.75)
        );
        return {
          newBatchSize: this.currentBatchSize,
          changed: true,
          reason: `GPU memory at ${memoryInfo.utilizationPercent.toFixed(1)}% - reducing batch size`,
        };
      }

      // Increase batch size if memory is low and performance is good
      if (
        memoryInfo.utilizationPercent < 60 &&
        this.metrics.consecutiveSlowBatches === 0 &&
        this.currentBatchSize < this.initialBatchSize
      ) {
        this.currentBatchSize = Math.min(
          this.initialBatchSize,
          Math.floor(this.currentBatchSize * this.MAX_BATCH_SIZE_INCREASE_FACTOR)
        );
        return {
          newBatchSize: this.currentBatchSize,
          changed: true,
          reason: `GPU memory low (${memoryInfo.utilizationPercent.toFixed(1)}%) and performance good - increasing batch size`,
        };
      }
    }

    // Check processing time spikes
    if (this.baselineProcessingTime && this.metrics.batchProcessingTimes.length > 0) {
      const recentAvg =
        this.metrics.batchProcessingTimes.reduce((sum, t) => sum + t, 0) /
        this.metrics.batchProcessingTimes.length;

      if (recentAvg > this.baselineProcessingTime * this.PROCESSING_TIME_SPIKE_MULTIPLIER) {
        this.currentBatchSize = Math.max(
          this.MIN_BATCH_SIZE,
          Math.floor(this.currentBatchSize * 0.75)
        );
        return {
          newBatchSize: this.currentBatchSize,
          changed: true,
          reason: `Processing time spike detected (${recentAvg.toFixed(0)}ms vs ${this.baselineProcessingTime.toFixed(0)}ms baseline)`,
        };
      }
    }

    return { newBatchSize: this.currentBatchSize, changed: false };
  }

  /**
   * Get current controller state for logging
   */
  public getState() {
    return {
      currentBatchSize: this.currentBatchSize,
      initialBatchSize: this.initialBatchSize,
      totalBatches: this.metrics.totalBatches,
      batchesSinceReset: this.metrics.totalBatches - this.metrics.lastResetBatch,
      consecutiveSlowBatches: this.metrics.consecutiveSlowBatches,
      baselineProcessingTime: this.baselineProcessingTime,
      recentAvgProcessingTime:
        this.metrics.batchProcessingTimes.length > 0
          ? this.metrics.batchProcessingTimes.reduce((sum, t) => sum + t, 0) /
            this.metrics.batchProcessingTimes.length
          : null,
    };
  }
}
