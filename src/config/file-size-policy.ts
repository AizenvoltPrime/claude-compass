import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('file-size-policy');

/**
 * File size policy configuration
 */
export interface FileSizePolicy {
  /** Hard limit - reject files entirely above this size (default: 5MB) */
  maxFileSize: number;

  /** Start chunking files above this size (default: 28KB) */
  chunkingThreshold: number;

  /** Fallback truncation limit for non-chunked parsing (default: 32KB) */
  truncationFallback: number;

  /** Warning threshold for large files (default: 1MB) */
  warnThreshold: number;

  /** Optional: Skip files above this size instead of processing (default: undefined) */
  skipThreshold?: number;

  /** Optional: Minimum file size to process (default: 1 byte) */
  minFileSize?: number;

  /** Optional: Maximum number of chunks per file (default: 50) */
  maxChunksPerFile?: number;
}

/**
 * Recommended action for a file based on its size
 */
export type FileSizeAction =
  | 'process' // Normal processing
  | 'chunk' // Use chunked parsing
  | 'truncate' // Use truncation (fallback)
  | 'warn' // Process but warn about size
  | 'skip' // Skip file due to size policy
  | 'reject'; // Reject file entirely

/**
 * Detailed recommendation with metadata
 */
export interface FileSizeRecommendation {
  action: FileSizeAction;
  reason: string;
  metadata: {
    fileSize: number;
    exceedsThreshold: string[];
    estimatedChunks?: number;
    estimatedProcessingTime?: number;
    recommendations?: string[];
  };
}

/**
 * Default file size policy for comprehensive analysis
 */
export const DEFAULT_POLICY: FileSizePolicy = {
  maxFileSize: 20 * 1024 * 1024, // 20MB
  chunkingThreshold: 50 * 1024, // 50KB
  truncationFallback: 28 * 1024, // 28KB (Tree-sitter safe limit)
  warnThreshold: 2 * 1024 * 1024, // 2MB
  minFileSize: 1, // 1 byte
  maxChunksPerFile: 100,
};

/**
 * File size manager that implements unified size policy
 */
export class FileSizeManager {
  private policy: FileSizePolicy;

  constructor(policy?: Partial<FileSizePolicy>) {
    this.policy = {
      ...DEFAULT_POLICY,
      ...policy,
    };

    this.validatePolicy();
  }

  /**
   * Check if a file should be rejected entirely
   */
  shouldRejectFile(size: number): boolean {
    return (
      size > this.policy.maxFileSize ||
      (this.policy.minFileSize !== undefined && size < this.policy.minFileSize)
    );
  }

  /**
   * Check if a file should be processed with chunking
   */
  shouldChunkFile(size: number): boolean {
    return (
      size > this.policy.chunkingThreshold &&
      !this.shouldRejectFile(size) &&
      !this.shouldSkipFile(size)
    );
  }

  /**
   * Check if a file should trigger a warning
   */
  shouldWarnLargeFile(size: number): boolean {
    return size > this.policy.warnThreshold;
  }

  /**
   * Check if a file should be skipped based on optional skip threshold
   */
  shouldSkipFile(size: number): boolean {
    return this.policy.skipThreshold !== undefined && size > this.policy.skipThreshold;
  }

  /**
   * Get recommended action for a file size
   */
  getRecommendedAction(size: number): FileSizeAction {
    // Check rejection criteria first
    if (this.shouldRejectFile(size)) {
      return 'reject';
    }

    // Check skip criteria
    if (this.shouldSkipFile(size)) {
      return 'skip';
    }

    // Check chunking criteria
    if (this.shouldChunkFile(size)) {
      return 'chunk';
    }

    // Check if file exceeds Tree-sitter limit - use chunking instead of truncation
    if (size > this.policy.truncationFallback) {
      return 'chunk'; // Force chunking for files over Tree-sitter limit
    }

    // Check warning criteria
    if (this.shouldWarnLargeFile(size)) {
      return 'warn';
    }

    // Normal processing
    return 'process';
  }

  /**
   * Get detailed recommendation with metadata
   */
  getDetailedRecommendation(size: number): FileSizeRecommendation {
    const action = this.getRecommendedAction(size);
    const exceedsThreshold: string[] = [];
    const recommendations: string[] = [];

    // Analyze which thresholds are exceeded
    if (size > this.policy.warnThreshold) {
      exceedsThreshold.push(`warn (${this.formatSize(this.policy.warnThreshold)})`);
    }
    if (size > this.policy.chunkingThreshold) {
      exceedsThreshold.push(`chunking (${this.formatSize(this.policy.chunkingThreshold)})`);
    }
    if (size > this.policy.truncationFallback) {
      exceedsThreshold.push(`truncation (${this.formatSize(this.policy.truncationFallback)})`);
    }
    if (this.policy.skipThreshold && size > this.policy.skipThreshold) {
      exceedsThreshold.push(`skip (${this.formatSize(this.policy.skipThreshold)})`);
    }
    if (size > this.policy.maxFileSize) {
      exceedsThreshold.push(`max (${this.formatSize(this.policy.maxFileSize)})`);
    }

    // Generate recommendations based on action
    switch (action) {
      case 'chunk':
        const estimatedChunks = this.estimateChunkCount(size);
        recommendations.push('File will be split into chunks for parsing');
        recommendations.push(`Estimated ${estimatedChunks} chunks needed`);
        if (estimatedChunks > 20) {
          recommendations.push('Consider file size optimization or exclusion');
        }
        break;

      case 'truncate':
        recommendations.push('File will be truncated for parsing - some content may be lost');
        recommendations.push('Consider enabling chunked parsing to preserve all content');
        break;

      case 'warn':
        recommendations.push('File is large but will be processed normally');
        break;

      case 'skip':
        recommendations.push('File exceeds skip threshold and will be ignored');
        recommendations.push('Increase skipThreshold or enable chunked parsing to process');
        break;

      case 'reject':
        recommendations.push('File exceeds maximum size limit');
        recommendations.push('Increase maxFileSize or exclude file from analysis');
        break;
    }

    return {
      action,
      reason: this.getActionReason(action, size),
      metadata: {
        fileSize: size,
        exceedsThreshold,
        estimatedChunks: action === 'chunk' ? this.estimateChunkCount(size) : undefined,
        estimatedProcessingTime: this.estimateProcessingTime(size, action),
        recommendations,
      },
    };
  }

  /**
   * Estimate number of chunks needed for a file
   */
  estimateChunkCount(size: number): number {
    if (size <= this.policy.chunkingThreshold) {
      return 1;
    }

    // Account for overlap between chunks
    const effectiveChunkSize = this.policy.chunkingThreshold * 0.8; // 20% overlap assumption
    const chunks = Math.ceil(size / effectiveChunkSize);

    // Apply maximum chunks limit
    const maxChunks = this.policy.maxChunksPerFile || 50;
    return Math.min(chunks, maxChunks);
  }

  /**
   * Estimate processing time in milliseconds
   */
  estimateProcessingTime(size: number, action: FileSizeAction): number {
    // Base processing time per KB (very rough estimate)
    const baseTimePerKB = 2; // 2ms per KB baseline

    switch (action) {
      case 'process':
      case 'warn':
        return (size / 1024) * baseTimePerKB;

      case 'chunk':
        // Chunking adds overhead
        const chunks = this.estimateChunkCount(size);
        return (size / 1024) * baseTimePerKB * 1.5 + chunks * 10;

      case 'truncate':
        // Truncation is faster since we process less content
        const truncatedSize = Math.min(size, this.policy.truncationFallback);
        return (truncatedSize / 1024) * baseTimePerKB;

      case 'skip':
      case 'reject':
        return 0; // No processing time

      default:
        return (size / 1024) * baseTimePerKB;
    }
  }

  /**
   * Get current policy
   */
  getPolicy(): Readonly<FileSizePolicy> {
    return { ...this.policy };
  }

  /**
   * Update policy with new values
   */
  updatePolicy(updates: Partial<FileSizePolicy>): void {
    this.policy = { ...this.policy, ...updates };
    this.validatePolicy();
  }

  /**
   * Format file size in human-readable format
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(unitIndex > 0 ? 1 : 0)}${units[unitIndex]}`;
  }

  /**
   * Get human-readable reason for action
   */
  private getActionReason(action: FileSizeAction, size: number): string {
    const sizeStr = this.formatSize(size);

    switch (action) {
      case 'process':
        return `File size ${sizeStr} is within normal processing limits`;

      case 'chunk':
        return `File size ${sizeStr} exceeds chunking threshold (${this.formatSize(this.policy.chunkingThreshold)})`;

      case 'truncate':
        return `File size ${sizeStr} exceeds Tree-sitter limit and chunking is disabled`;

      case 'warn':
        return `File size ${sizeStr} exceeds warning threshold (${this.formatSize(this.policy.warnThreshold)})`;

      case 'skip':
        return `File size ${sizeStr} exceeds skip threshold (${this.formatSize(this.policy.skipThreshold!)})`;

      case 'reject':
        if (this.policy.minFileSize !== undefined && size < this.policy.minFileSize) {
          return `File size ${sizeStr} is below minimum size (${this.formatSize(this.policy.minFileSize)})`;
        }
        return `File size ${sizeStr} exceeds maximum limit (${this.formatSize(this.policy.maxFileSize)})`;

      default:
        return `File size ${sizeStr} requires special handling`;
    }
  }

  /**
   * Validate policy configuration
   */
  private validatePolicy(): void {
    const p = this.policy;

    if (p.chunkingThreshold >= p.maxFileSize) {
      logger.warn('Chunking threshold is greater than or equal to max file size', {
        chunkingThreshold: p.chunkingThreshold,
        maxFileSize: p.maxFileSize,
      });
    }

    if (p.truncationFallback > p.chunkingThreshold) {
      logger.warn('Truncation fallback is larger than chunking threshold', {
        truncationFallback: p.truncationFallback,
        chunkingThreshold: p.chunkingThreshold,
      });
    }

    if (p.skipThreshold && p.skipThreshold >= p.maxFileSize) {
      logger.warn('Skip threshold is greater than or equal to max file size', {
        skipThreshold: p.skipThreshold,
        maxFileSize: p.maxFileSize,
      });
    }

    if (p.minFileSize && p.minFileSize > p.maxFileSize) {
      throw new Error('Minimum file size cannot be greater than maximum file size');
    }

    if (p.maxChunksPerFile !== undefined && p.maxChunksPerFile < 1) {
      throw new Error('Maximum chunks per file must be at least 1');
    }
  }
}

/**
 * Utility functions for common file size operations
 */
export const FileSizeUtils = {
  /**
   * Convert size string (e.g., "5MB", "1024KB") to bytes
   */
  parseSize(sizeString: string): number {
    const match = sizeString.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
    if (!match) {
      throw new Error(`Invalid size format: ${sizeString}`);
    }

    const [, value, unit] = match;
    const numValue = parseFloat(value);

    switch (unit.toUpperCase()) {
      case 'B':
        return numValue;
      case 'KB':
        return numValue * 1024;
      case 'MB':
        return numValue * 1024 * 1024;
      case 'GB':
        return numValue * 1024 * 1024 * 1024;
      default:
        throw new Error(`Unknown unit: ${unit}`);
    }
  },

  /**
   * Format bytes as human-readable string
   */
  formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(unitIndex > 0 ? 1 : 0)}${units[unitIndex]}`;
  },

  /**
   * Create policy from CLI options
   */
  createPolicyFromOptions(options: {
    maxFileSize?: string;
    chunkingThreshold?: string;
    warnThreshold?: string;
    skipThreshold?: string;
    enableChunking?: boolean;
  }): Partial<FileSizePolicy> {
    const policy: Partial<FileSizePolicy> = {};

    if (options.maxFileSize) {
      policy.maxFileSize = this.parseSize(options.maxFileSize);
    }
    if (options.chunkingThreshold) {
      policy.chunkingThreshold = this.parseSize(options.chunkingThreshold);
    }
    if (options.warnThreshold) {
      policy.warnThreshold = this.parseSize(options.warnThreshold);
    }
    if (options.skipThreshold) {
      policy.skipThreshold = this.parseSize(options.skipThreshold);
    }
    if (options.enableChunking === false) {
      policy.chunkingThreshold = Number.MAX_SAFE_INTEGER; // Effectively disable chunking
    }

    return policy;
  },
};
