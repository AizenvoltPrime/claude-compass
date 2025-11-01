import { hasFileExtension } from '../code-pattern-utils';

/**
 * Detect Vue.js specific features
 */
export async function detectVueFeatures(projectPath: string, packageJson: any): Promise<string[]> {
  const features: string[] = [];

  // Check for Vue Router
  if (packageJson?.dependencies?.['vue-router']) {
    features.push('vue-router');
  }

  // Check for Pinia/Vuex
  if (packageJson?.dependencies?.['pinia']) {
    features.push('pinia');
  }
  if (packageJson?.dependencies?.['vuex']) {
    features.push('vuex');
  }

  // Check for SFCs
  try {
    const hasVueFiles = await hasFileExtension(projectPath, '.vue');
    if (hasVueFiles) {
      features.push('sfc');
    }
  } catch (error) {
    // Ignore
  }

  return features;
}
