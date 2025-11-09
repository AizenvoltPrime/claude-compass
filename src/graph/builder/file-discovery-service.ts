import fs from 'fs/promises';
import path from 'path';
import { CompassIgnore } from '../../utils/compassignore';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('file-discovery-service');

export interface BuildOptions {
  includeTestFiles?: boolean;
  includeNodeModules?: boolean;
  maxFiles?: number;
  fileExtensions?: string[];
  compassignorePath?: string;
}

export interface DiscoveredFile {
  path: string;
  relativePath: string;
}

/**
 * File Discovery Service
 * Handles file system traversal, filtering, and discovery
 */
export class FileDiscoveryService {
  /**
   * Discover files in a repository with filtering
   */
  async discoverFiles(
    repositoryPath: string,
    options: BuildOptions
  ): Promise<DiscoveredFile[]> {
    const files: DiscoveredFile[] = [];
    const compassIgnore = await this.loadCompassIgnore(repositoryPath, options);

    logger.info('Starting file discovery', {
      repositoryPath,
      allowedExtensions: options.fileExtensions,
    });

    const traverse = async (currentPath: string): Promise<void> => {
      try {
        const lstats = await fs.lstat(currentPath);

        if (lstats.isSymbolicLink()) {
          try {
            await fs.stat(currentPath);
          } catch (symlinkError) {
            logger.debug('Skipping broken symlink', { path: currentPath });
            return;
          }
        }

        const stats = lstats.isSymbolicLink() ? await fs.stat(currentPath) : lstats;

        if (stats.isDirectory()) {
          const dirName = path.basename(currentPath);
          const relativePath = path.relative(repositoryPath, currentPath);

          // Check .compassignore patterns first
          if (compassIgnore.shouldIgnore(currentPath, relativePath)) {
            return;
          }

          // Then check built-in skip logic
          if (this.shouldSkipDirectory(dirName, options)) {
            return;
          }

          const entries = await fs.readdir(currentPath);

          await Promise.all(
            entries.map(async entry => {
              const entryPath = path.join(currentPath, entry);
              await traverse(entryPath);
            })
          );
        } else if (stats.isFile()) {
          const relativePath = path.relative(repositoryPath, currentPath);

          // Check .compassignore patterns first
          if (compassIgnore.shouldIgnore(currentPath, relativePath)) {
            return;
          }

          // Then check built-in include logic
          if (this.shouldIncludeFile(currentPath, relativePath, options)) {
            logger.info('Including file', { path: relativePath });
            files.push({
              path: currentPath,
              relativePath: relativePath,
            });
          }
        }
      } catch (error) {
        logger.error('Error traversing path', {
          path: currentPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    await traverse(repositoryPath);

    // Generate file extension statistics
    const extensionStats: Record<string, number> = {};
    files.forEach(file => {
      const ext = path.extname(file.path);
      extensionStats[ext] = (extensionStats[ext] || 0) + 1;
    });

    logger.info('File discovery completed', {
      totalFiles: files.length,
      extensionStats,
      allowedExtensions: options.fileExtensions,
      patternsUsed: compassIgnore.getPatterns(),
    });

    // Limit the number of files if specified
    if (options.maxFiles && files.length > options.maxFiles) {
      logger.warn(`Limiting analysis to ${options.maxFiles} files`);
      return files.slice(0, options.maxFiles);
    }

    return files;
  }

  /**
   * Load CompassIgnore configuration from repository directory
   */
  private async loadCompassIgnore(
    repositoryPath: string,
    options: BuildOptions
  ): Promise<CompassIgnore> {
    if (options.compassignorePath) {
      // Use custom path if provided
      const customPath = path.isAbsolute(options.compassignorePath)
        ? options.compassignorePath
        : path.join(repositoryPath, options.compassignorePath);
      const compassIgnore = await CompassIgnore.fromFile(customPath);

      // Add default patterns if no custom .compassignore file exists
      if (!(await this.fileExists(customPath))) {
        compassIgnore.addPatterns(require('../../utils/compassignore').DEFAULT_IGNORE_PATTERNS);
      }

      return compassIgnore;
    }

    // Use default .compassignore in repository root, with fallback to default patterns
    const compassIgnore = await CompassIgnore.fromDirectory(repositoryPath);
    const compassIgnorePath = path.join(repositoryPath, '.compassignore');

    // If no .compassignore file exists, add default patterns
    if (!(await this.fileExists(compassIgnorePath))) {
      compassIgnore.addPatterns(require('../../utils/compassignore').DEFAULT_IGNORE_PATTERNS);
    }

    return compassIgnore;
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  shouldSkipDirectory(dirName: string, options: BuildOptions): boolean {
    const skipDirs = [
      'node_modules',
      '.git',
      '.svn',
      '.hg',
      'dist',
      'build',
      'coverage',
      '.nyc_output',
    ];

    if (skipDirs.includes(dirName)) {
      if (dirName === 'node_modules' && options.includeNodeModules) {
        return false;
      }
      return true;
    }

    return dirName.startsWith('.');
  }

  shouldIncludeFile(
    filePath: string,
    relativePath: string,
    options: BuildOptions
  ): boolean {
    const ext = path.extname(filePath);

    // Use provided extensions if specified, otherwise fall back to defaults
    const allowedExtensions = options.fileExtensions || [
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '.mjs',
      '.cjs',
      '.vue',
      '.php',
      '.cs',
      '.tscn',
      '.godot',
    ];

    if (!allowedExtensions.includes(ext)) {
      return false;
    }

    if (!options.includeTestFiles && this.isTestFile(relativePath)) {
      return false;
    }

    logger.info('File should be included', { filePath });
    return true;
  }

  isTestFile(relativePath: string): boolean {
    const fileName = path.basename(relativePath).toLowerCase();

    // Check filename patterns first
    if (
      fileName.includes('.test.') ||
      fileName.includes('.spec.') ||
      fileName.endsWith('.test') ||
      fileName.endsWith('.spec')
    ) {
      return true;
    }

    // Check directory patterns within the project (relative path only)
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const pathSegments = normalizedPath.split('/');

    // Look for test directories in the project structure
    return pathSegments.some(
      segment =>
        segment === '__tests__' ||
        segment === 'test' ||
        segment === 'tests' ||
        segment === 'spec' ||
        segment === 'specs'
    );
  }

  isGeneratedFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return (
      fileName.includes('.generated.') ||
      fileName.includes('.gen.') ||
      filePath.includes('/generated/') ||
      filePath.includes('/.next/') ||
      filePath.includes('/dist/') ||
      filePath.includes('/build/')
    );
  }

  detectLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath);

    switch (ext) {
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.vue':
        return 'vue';
      case '.php':
        return 'php';
      case '.cs':
        return 'csharp';
      case '.tscn':
        return 'godot_scene';
      case '.godot':
        return 'godot';
      default:
        return 'unknown';
    }
  }
}
