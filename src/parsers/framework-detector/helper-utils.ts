import * as path from 'path';
import { FrameworkDetectionResult } from './types';

/**
 * Check if a file path likely contains a Laravel model based on file patterns
 */
export function hasLaravelModelPattern(filePath: string): boolean {
  return (
    filePath.includes('/app/') &&
    !filePath.includes('Controller') &&
    !filePath.includes('Middleware') &&
    !filePath.includes('Provider') &&
    !filePath.includes('Job') &&
    !filePath.includes('Command')
  );
}

/**
 * Get the path relative to the detected project root to avoid false positives
 * when files are in test fixture directories
 */
export function getProjectRelativePath(
  filePath: string,
  detectionResult: FrameworkDetectionResult
): string {
  let projectRoot = filePath;
  let currentDir = path.dirname(filePath);

  // Walk up the directory tree to find project markers
  while (currentDir !== path.dirname(currentDir)) {
    // Stop at filesystem root
    // Check for common project markers
    const markers = [
      'package.json',
      'composer.json',
      '.git',
      'artisan',
      'next.config.js',
      'vue.config.js',
    ];
    let foundMarker = false;

    for (const marker of markers) {
      try {
        if (detectionResult.metadata.hasPackageJson && marker === 'package.json') {
          projectRoot = currentDir;
          foundMarker = true;
          break;
        }
        if (detectionResult.metadata.hasComposerJson && marker === 'composer.json') {
          projectRoot = currentDir;
          foundMarker = true;
          break;
        }
      } catch (error) {
        // Continue searching
      }
    }

    if (foundMarker) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }

  // Return the relative path from the project root
  const relativePath = path.relative(projectRoot, filePath);
  return relativePath.replace(/\\/g, '/'); // Normalize to forward slashes
}
