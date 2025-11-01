import { createComponentLogger } from '../../utils/logger';
import {
  FrameworkDetectionResult,
  DetectedFramework,
  FrameworkEvidence,
  FrameworkPattern,
} from './types';
import { FRAMEWORK_PATTERNS } from './framework-patterns';
import { readPackageJson, readComposerJson } from './file-io-utils';
import { findConfigFiles, analyzeDirectoryStructure } from './directory-analysis-utils';
import { extractFrameworkVersion } from './version-utils';
import {
  detectVueFeatures,
  detectNextJSFeatures,
  detectReactFeatures,
  detectNodeJSFeatures,
} from './feature-detection';

const logger = createComponentLogger('framework-detector');

/**
 * Detect frameworks in a project directory
 */
export async function detectFrameworks(projectPath: string): Promise<FrameworkDetectionResult> {
  try {
    const packageJson = await readPackageJson(projectPath);
    const composerJson = await readComposerJson(projectPath);
    const configFiles = await findConfigFiles(projectPath);
    const directoryStructure = await analyzeDirectoryStructure(projectPath);

    const detectedFrameworks: DetectedFramework[] = [];

    for (const pattern of FRAMEWORK_PATTERNS) {
      const detection = await detectFramework(
        pattern,
        packageJson,
        composerJson,
        configFiles,
        directoryStructure,
        projectPath
      );

      // Only include frameworks that have strong evidence (dependencies, configs)
      // to avoid false positives from shared directory structures
      // Special case: Godot projects don't have dependencies but project.godot is strong evidence
      const hasStrongEvidence = detection.evidence.some(
        e => e.type === 'dependency' || e.type === 'devDependency' || e.type === 'config'
      );
      const isGodotWithProjectFile =
        pattern.name === 'godot' &&
        detection.evidence.some(e => e.type === 'config' && e.value === 'project.godot');
      if (hasStrongEvidence || isGodotWithProjectFile) {
        detectedFrameworks.push(detection);
      }
    }

    return {
      frameworks: detectedFrameworks,
      metadata: {
        hasPackageJson: packageJson !== null,
        hasComposerJson: composerJson !== null,
        hasConfigFiles: configFiles.length > 0,
        directoryStructure,
      },
    };
  } catch (error) {
    logger.error(`Framework detection failed for ${projectPath}`, { error });
    return {
      frameworks: [],
      metadata: {
        hasPackageJson: false,
        hasComposerJson: false,
        hasConfigFiles: false,
        directoryStructure: [],
      },
    };
  }
}

/**
 * Detect specific framework based on pattern
 */
export async function detectFramework(
  pattern: FrameworkPattern,
  packageJson: any,
  composerJson: any,
  configFiles: string[],
  directoryStructure: string[],
  projectPath: string
): Promise<DetectedFramework> {
  const evidence: FrameworkEvidence[] = [];
  const features: string[] = [];

  // Check dependencies
  if (packageJson && pattern.patterns.dependencies) {
    for (const dep of pattern.patterns.dependencies) {
      if (packageJson.dependencies?.[dep]) {
        evidence.push({
          type: 'dependency',
          source: 'package.json',
          value: `${dep}@${packageJson.dependencies[dep]}`,
        });
      }
    }
  }

  // Check dev dependencies
  if (packageJson && pattern.patterns.devDependencies) {
    for (const dep of pattern.patterns.devDependencies) {
      if (packageJson.devDependencies?.[dep]) {
        evidence.push({
          type: 'devDependency',
          source: 'package.json',
          value: `${dep}@${packageJson.devDependencies[dep]}`,
        });
      }
    }
  }

  // Check composer.json dependencies (PHP projects)
  if (composerJson && pattern.patterns.dependencies) {
    for (const dep of pattern.patterns.dependencies) {
      if (composerJson.require?.[dep]) {
        evidence.push({
          type: 'dependency',
          source: 'composer.json',
          value: `${dep}@${composerJson.require[dep]}`,
        });
      }
    }
  }

  // Check composer.json dev dependencies (PHP projects)
  if (composerJson && pattern.patterns.devDependencies) {
    for (const dep of pattern.patterns.devDependencies) {
      if (composerJson['require-dev']?.[dep]) {
        evidence.push({
          type: 'devDependency',
          source: 'composer.json',
          value: `${dep}@${composerJson['require-dev'][dep]}`,
        });
      }
    }
  }

  // Check config files
  if (pattern.patterns.configs) {
    for (const configFile of pattern.patterns.configs) {
      if (configFiles.includes(configFile)) {
        evidence.push({
          type: 'config',
          source: 'filesystem',
          value: configFile,
        });
      }
    }
  }

  // Check directories
  if (pattern.patterns.directories) {
    for (const dir of pattern.patterns.directories) {
      if (directoryStructure.some(d => d.includes(dir))) {
        evidence.push({
          type: 'directory',
          source: 'filesystem',
          value: dir,
        });
      }
    }
  }

  // Detect framework-specific features
  if (pattern.name === 'vue') {
    features.push(...(await detectVueFeatures(projectPath, packageJson)));
  } else if (pattern.name === 'nextjs') {
    features.push(...(await detectNextJSFeatures(projectPath, directoryStructure)));
  } else if (pattern.name === 'react') {
    features.push(...(await detectReactFeatures(projectPath, packageJson)));
  } else if (pattern.name === 'nodejs') {
    features.push(...(await detectNodeJSFeatures(projectPath, packageJson)));
  }

  return {
    name: pattern.name,
    version: extractFrameworkVersion(pattern.name, packageJson),
    evidence,
    features,
  };
}
