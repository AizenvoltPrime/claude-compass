/**
 * Framework detection result
 */
export interface FrameworkDetectionResult {
  frameworks: DetectedFramework[];
  metadata: {
    hasPackageJson: boolean;
    hasComposerJson: boolean;
    hasConfigFiles: boolean;
    directoryStructure: string[];
  };
}

/**
 * Individual framework detection
 */
export interface DetectedFramework {
  name: string;
  version?: string;
  evidence: FrameworkEvidence[];
  features: string[];
}

/**
 * Evidence for framework presence
 */
export interface FrameworkEvidence {
  type: 'dependency' | 'devDependency' | 'config' | 'directory' | 'file';
  source: string;
  value: string;
}

/**
 * Framework detection pattern
 */
export interface FrameworkPattern {
  name: string;
  patterns: {
    dependencies?: string[];
    devDependencies?: string[];
    files?: string[];
    directories?: string[];
    configs?: string[];
    features?: string[];
  };
}
