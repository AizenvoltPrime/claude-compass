import { hasCodePattern } from '../code-pattern-utils';

/**
 * Detect Node.js specific features
 */
export async function detectNodeJSFeatures(projectPath: string, packageJson: any): Promise<string[]> {
  const features: string[] = [];

  // Check for Express
  if (packageJson?.dependencies?.['express']) {
    features.push('express-routes');
  }

  // Check for API patterns
  try {
    const hasRoutes = await hasCodePattern(
      projectPath,
      /router\.|app\.(get|post|put|delete)/
    );
    if (hasRoutes) {
      features.push('rest-api');
    }

    const hasMiddleware = await hasCodePattern(projectPath, /\(req,\s*res,\s*next\)/);
    if (hasMiddleware) {
      features.push('middleware');
    }
  } catch (error) {
    // Ignore
  }

  return features;
}
