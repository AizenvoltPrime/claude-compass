import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read and parse package.json
 */
export async function readPackageJson(projectPath: string): Promise<any | null> {
  try {
    const packagePath = path.join(projectPath, 'package.json');
    const content = await fs.readFile(packagePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Read and parse composer.json
 */
export async function readComposerJson(projectPath: string): Promise<any | null> {
  try {
    const composerPath = path.join(projectPath, 'composer.json');
    const content = await fs.readFile(composerPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}
