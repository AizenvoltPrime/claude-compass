import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Detect Next.js specific features
 */
export async function detectNextJSFeatures(
  projectPath: string,
  directoryStructure: string[]
): Promise<string[]> {
  const features: string[] = [];

  // Check for app router vs pages router
  if (directoryStructure.some(dir => dir === 'app' || dir === 'src/app')) {
    features.push('app-router');
  }
  if (directoryStructure.some(dir => dir === 'pages' || dir === 'src/pages')) {
    features.push('pages-router');
  }

  // Check for API routes
  if (directoryStructure.some(dir => dir.includes('api'))) {
    features.push('api-routes');
  }

  // Check for middleware
  try {
    const middlewarePath = path.join(projectPath, 'middleware.js');
    await fs.access(middlewarePath);
    features.push('middleware');
  } catch (error) {
    try {
      const middlewarePath = path.join(projectPath, 'middleware.ts');
      await fs.access(middlewarePath);
      features.push('middleware');
    } catch (error) {
      // No middleware
    }
  }

  return features;
}
