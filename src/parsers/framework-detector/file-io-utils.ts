import * as fs from 'fs/promises';
import * as path from 'path';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('framework-detector');

async function findFilesRecursively(
  dir: string,
  filename: string,
  maxDepth: number = 3,
  currentDepth: number = 0
): Promise<string[]> {
  if (currentDepth > maxDepth) {
    return [];
  }

  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === '.git') {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isFile() && entry.name === filename) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        const subResults = await findFilesRecursively(fullPath, filename, maxDepth, currentDepth + 1);
        results.push(...subResults);
      }
    }
  } catch (error) {
    logger.debug('Error reading directory during recursive file search', {
      directory: dir,
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return results;
  }

  return results;
}

async function mergePackageJsonFiles(files: string[]): Promise<any | null> {
  if (files.length === 0) {
    return null;
  }

  if (files.length > 1) {
    logger.debug('Found multiple package.json files, merging dependencies', {
      fileCount: files.length,
      files,
    });
  }

  const merged: any = {
    dependencies: {},
    devDependencies: {},
  };

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const json = JSON.parse(content);

      if (json.dependencies) {
        Object.assign(merged.dependencies, json.dependencies);
      }
      if (json.devDependencies) {
        Object.assign(merged.devDependencies, json.devDependencies);
      }
    } catch (error) {
      logger.debug('Error reading or parsing package.json file', {
        file,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
  }

  return merged;
}

async function mergeComposerJsonFiles(files: string[]): Promise<any | null> {
  if (files.length === 0) {
    return null;
  }

  if (files.length > 1) {
    logger.debug('Found multiple composer.json files, merging dependencies', {
      fileCount: files.length,
      files,
    });
  }

  const merged: any = {
    require: {},
    'require-dev': {},
  };

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const json = JSON.parse(content);

      if (json.require) {
        Object.assign(merged.require, json.require);
      }
      if (json['require-dev']) {
        Object.assign(merged['require-dev'], json['require-dev']);
      }
    } catch (error) {
      logger.debug('Error reading or parsing composer.json file', {
        file,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
  }

  return merged;
}

/**
 * Read and parse package.json, searching recursively in subdirectories
 */
export async function readPackageJson(projectPath: string): Promise<any | null> {
  const packageFiles = await findFilesRecursively(projectPath, 'package.json');
  return mergePackageJsonFiles(packageFiles);
}

/**
 * Read and parse composer.json, searching recursively in subdirectories
 */
export async function readComposerJson(projectPath: string): Promise<any | null> {
  const composerFiles = await findFilesRecursively(projectPath, 'composer.json');
  return mergeComposerJsonFiles(composerFiles);
}

/**
 * Detect JavaScript/TypeScript frameworks from package.json dependencies
 */
export function detectJsFrameworks(packageJson: any): string[] {
  if (!packageJson) return [];

  const frameworks: string[] = [];
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

  if (deps.vue || deps['@vue/cli-service']) frameworks.push('vue');
  if (deps.react) frameworks.push('react');
  if (deps.next) frameworks.push('nextjs');
  if (deps.nuxt) frameworks.push('nuxt');
  if (deps.express) frameworks.push('express');
  if (deps.fastify) frameworks.push('fastify');

  return frameworks;
}

/**
 * Detect PHP frameworks from composer.json dependencies
 */
export function detectPhpFrameworks(composerJson: any): string[] {
  if (!composerJson) return [];

  const frameworks: string[] = [];
  const deps = { ...composerJson.require, ...composerJson['require-dev'] };

  if (deps['laravel/framework']) frameworks.push('laravel');
  if (deps['symfony/framework-bundle']) frameworks.push('symfony');
  if (deps['codeigniter4/framework']) frameworks.push('codeigniter');

  return frameworks;
}
