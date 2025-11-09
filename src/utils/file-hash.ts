import crypto from 'crypto';
import fs from 'fs/promises';

/**
 * Compute SHA-256 hash of file content
 * Used for deterministic incremental analysis change detection
 */
export async function computeFileHash(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error) {
    throw new Error(
      `Failed to compute hash for ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Compute hash from string content (for in-memory content)
 */
export function computeContentHash(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
