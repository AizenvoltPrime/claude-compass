/**
 * Response compression utilities for MCP protocol payload optimization
 * Phase 1: Performance Infrastructure Implementation
 */

import * as zlib from 'zlib';
import { promisify } from 'util';
import { createComponentLogger } from './logger';

const logger = createComponentLogger('response-compression');
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export interface CompressionConfig {
  threshold: number; // Minimum payload size to compress (bytes)
  level: number; // Compression level (1-9, 6 is default)
  enableCompression: boolean;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  threshold: 10240, // 10KB threshold
  level: 6, // Balanced compression level
  enableCompression: true,
};

export interface CompressedResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  metadata?: {
    compressed: boolean;
    originalSize?: number;
    compressedSize?: number;
    compressionRatio?: number;
  };
}

/**
 * Compresses MCP response payload if it exceeds threshold
 */
export async function compressResponsePayload(
  response: any,
  config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG
): Promise<CompressedResponse> {
  if (!config.enableCompression) {
    return response;
  }

  const jsonString = JSON.stringify(response.content[0].data || response.content[0].text);
  const originalSize = Buffer.byteLength(jsonString, 'utf8');

  // Only compress if payload exceeds threshold
  if (originalSize < config.threshold) {
    logger.debug('Payload below compression threshold', {
      originalSize,
      threshold: config.threshold
    });
    return response;
  }

  try {
    const compressed = await gzipAsync(jsonString, { level: config.level });
    const compressedSize = compressed.length;
    const compressionRatio = (1 - compressedSize / originalSize) * 100;

    // Encode compressed data as base64 for JSON transport
    const compressedString = compressed.toString('base64');

    logger.debug('Payload compressed successfully', {
      originalSize,
      compressedSize,
      compressionRatio: `${compressionRatio.toFixed(1)}%`
    });

    return {
      content: [{
        type: 'text',
        text: compressedString
      }],
      metadata: {
        compressed: true,
        originalSize,
        compressedSize,
        compressionRatio
      }
    };
  } catch (error) {
    logger.error('Compression failed, returning original payload', {
      error: (error as Error).message
    });
    return response;
  }
}

/**
 * Decompresses MCP response payload if it was compressed
 */
export async function decompressResponsePayload(
  response: CompressedResponse
): Promise<any> {
  if (!response.metadata?.compressed) {
    return response;
  }

  try {
    const compressedBuffer = Buffer.from(response.content[0].text, 'base64');
    const decompressed = await gunzipAsync(compressedBuffer);
    const decompressedString = decompressed.toString('utf8');

    return {
      content: [{
        type: 'text',
        text: decompressedString
      }]
    };
  } catch (error) {
    logger.error('Decompression failed', { error: (error as Error).message });
    throw new Error(`Failed to decompress response: ${(error as Error).message}`);
  }
}

/**
 * Optimizes response payload size through intelligent truncation and summarization
 */
export function optimizeResponsePayload(response: any, maxSize: number = 1024 * 1024): any {
  const jsonString = JSON.stringify(response);
  const currentSize = Buffer.byteLength(jsonString, 'utf8');

  if (currentSize <= maxSize) {
    return response;
  }

  logger.debug('Response payload exceeds max size, optimizing', {
    currentSize,
    maxSize
  });

  // Implement intelligent truncation strategies
  if (response.content?.[0]?.data) {
    const data = JSON.parse(response.content[0].data);

    // Truncate large arrays while preserving structure
    if (data.callers && Array.isArray(data.callers)) {
      const originalCount = data.callers.length;
      data.callers = data.callers.slice(0, Math.floor(maxSize / 2000)); // Rough estimation
      data.truncated = {
        total_results: originalCount,
        showing: data.callers.length,
        message: `Results truncated due to size limits. Use pagination for complete results.`
      };
    }

    // Similar truncation for other large arrays
    ['dependencies', 'symbols', 'impact_analysis'].forEach(key => {
      if (data[key] && Array.isArray(data[key])) {
        const originalCount = data[key].length;
        if (originalCount > 100) {
          data[key] = data[key].slice(0, 100);
          data[`${key}_truncated`] = {
            total: originalCount,
            showing: 100
          };
        }
      }
    });

    response.content[0].data = JSON.stringify(data);
  }

  return response;
}