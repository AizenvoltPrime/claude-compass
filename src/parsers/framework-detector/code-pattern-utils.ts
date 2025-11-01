import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Check if project has files with specific extension
 */
export async function hasFileExtension(projectPath: string, extension: string): Promise<boolean> {
  const checkDirectory = async (dirPath: string, depth: number = 0): Promise<boolean> => {
    if (depth > 3) return false;

    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        if (item.isFile() && item.name.endsWith(extension)) {
          return true;
        }

        if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
          const found = await checkDirectory(path.join(dirPath, item.name), depth + 1);
          if (found) return true;
        }
      }
    } catch (error) {
      // Directory not accessible
    }

    return false;
  };

  return checkDirectory(projectPath);
}

/**
 * Check if project contains specific code patterns
 */
export async function hasCodePattern(projectPath: string, pattern: RegExp): Promise<boolean> {
  const checkDirectory = async (dirPath: string, depth: number = 0): Promise<boolean> => {
    if (depth > 2) return false;

    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        if (item.isFile() && /\.(js|ts|jsx|tsx)$/.test(item.name)) {
          try {
            const content = await fs.readFile(path.join(dirPath, item.name), 'utf-8');
            if (pattern.test(content)) {
              return true;
            }
          } catch (error) {
            // File read error, continue
          }
        }

        if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
          const found = await checkDirectory(path.join(dirPath, item.name), depth + 1);
          if (found) return true;
        }
      }
    } catch (error) {
      // Directory not accessible
    }

    return false;
  };

  return checkDirectory(projectPath);
}
