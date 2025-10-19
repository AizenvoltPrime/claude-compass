import * as fs from 'fs';
import * as path from 'path';

/**
 * Find the project root directory by searching for package.json
 *
 * Walks up the directory tree from the current file location until it finds
 * a directory containing package.json. This works correctly in all environments:
 * - Compiled code in dist/
 * - TypeScript source files
 * - ts-jest test execution
 *
 * @returns Absolute path to project root directory
 * @throws Error if package.json cannot be found
 */
export function findProjectRoot(): string {
  let currentDir = __dirname;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const packageJsonPath = path.join(currentDir, 'package.json');

    if (fs.existsSync(packageJsonPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
    depth++;
  }

  throw new Error(
    `Could not find project root (package.json) by walking up from ${__dirname}. ` +
    `Searched ${depth} levels up the directory tree.`
  );
}
