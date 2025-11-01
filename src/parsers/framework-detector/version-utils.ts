/**
 * Extract framework version from package.json
 */
export function extractFrameworkVersion(
  frameworkName: string,
  packageJson: any
): string | undefined {
  if (!packageJson) return undefined;

  const dependencyMappings: Record<string, string> = {
    vue: 'vue',
    nextjs: 'next',
    react: 'react',
    nodejs: 'express',
  };

  const packageName = dependencyMappings[frameworkName];
  if (!packageName) return undefined;

  const version =
    packageJson.dependencies?.[packageName] || packageJson.devDependencies?.[packageName];

  if (version) {
    // Clean version string (remove ^, ~, etc.)
    return version.replace(/^[\^~]/, '');
  }

  return undefined;
}
