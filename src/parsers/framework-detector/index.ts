// Type definitions
export * from './types';

// Framework patterns
export * from './framework-patterns';

// File I/O utilities
export * from './file-io-utils';

// Directory analysis
export * from './directory-analysis-utils';

// Code pattern matching
export * from './code-pattern-utils';

// Version utilities
export * from './version-utils';

// Feature detection
export * from './feature-detection';

// Helper utilities
export * from './helper-utils';

// Core detection logic
export * from './framework-detection-core';

// Framework mapping
export * from './framework-mapping';

// Class wrapper for backward compatibility
import { FrameworkDetectionResult } from './types';
import { detectFrameworks } from './framework-detection-core';
import { getApplicableFrameworks } from './framework-mapping';

/**
 * Service for detecting frameworks in a project
 */
export class FrameworkDetector {
  /**
   * Detect frameworks in a project directory
   */
  async detectFrameworks(projectPath: string): Promise<FrameworkDetectionResult> {
    return detectFrameworks(projectPath);
  }

  /**
   * Get frameworks that should be used for parsing a specific file
   */
  getApplicableFrameworks(
    filePath: string,
    detectionResult: FrameworkDetectionResult
  ): string[] {
    return getApplicableFrameworks(filePath, detectionResult);
  }
}
