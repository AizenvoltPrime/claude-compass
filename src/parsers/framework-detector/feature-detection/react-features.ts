import { hasCodePattern } from '../code-pattern-utils';

/**
 * Detect React specific features
 */
export async function detectReactFeatures(projectPath: string, packageJson: any): Promise<string[]> {
  const features: string[] = [];

  // Check for TypeScript - TypeScript React projects support both JSX and TSX
  if (packageJson?.devDependencies?.['typescript']) {
    features.push('tsx');
    features.push('jsx'); // TypeScript projects can also use JSX files
  } else {
    features.push('jsx');
  }

  // Check for common React patterns
  try {
    const hasHooks = await hasCodePattern(projectPath, /use[A-Z]/);
    if (hasHooks) {
      features.push('hooks');
    }

    const hasContext = await hasCodePattern(projectPath, /createContext|useContext/);
    if (hasContext) {
      features.push('context');
    }
  } catch (error) {
    // Ignore
  }

  return features;
}
