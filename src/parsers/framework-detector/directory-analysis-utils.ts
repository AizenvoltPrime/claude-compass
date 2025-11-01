import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Find configuration files in project
 */
export async function findConfigFiles(projectPath: string): Promise<string[]> {
  const configPatterns = [
    'vue.config.js',
    'vite.config.js',
    'vite.config.ts',
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'nuxt.config.js',
    'nuxt.config.ts',
    'react-app-env.d.ts',
    'craco.config.js',
    'nodemon.json',
    'pm2.config.js',
    'tailwind.config.js',
    'webpack.config.js',
    'project.godot',
    'export_presets.cfg',
  ];

  const foundFiles: string[] = [];

  for (const pattern of configPatterns) {
    try {
      const filePath = path.join(projectPath, pattern);
      await fs.access(filePath);
      foundFiles.push(pattern);
    } catch (error) {
      // File doesn't exist, continue
    }
  }

  return foundFiles;
}

/**
 * Analyze directory structure
 */
export async function analyzeDirectoryStructure(
  projectPath: string,
  maxDepth: number = 3
): Promise<string[]> {
  const directories: string[] = [];

  const scanDirectory = async (dirPath: string, currentDepth: number = 0): Promise<void> => {
    if (currentDepth >= maxDepth) return;

    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
          const relativePath = path.relative(projectPath, path.join(dirPath, item.name));
          directories.push(relativePath);

          // Recursively scan subdirectories
          await scanDirectory(path.join(dirPath, item.name), currentDepth + 1);
        }
      }
    } catch (error) {
      // Directory not accessible, skip
    }
  };

  await scanDirectory(projectPath);
  return directories;
}
