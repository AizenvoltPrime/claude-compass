import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import type { Knex } from 'knex';
import { Repository } from '../../database/models';
import * as RepositoryService from '../../database/services/repository-service';
import { FileSizePolicy, DEFAULT_POLICY } from '../../config/file-size-policy';
import { BuildOptions } from './types';
import { FileDiscoveryService } from './file-discovery-service';
import { createComponentLogger } from '../../utils/logger';

/**
 * Repository Manager
 * Handles repository creation, validation, and metadata detection
 */
export class RepositoryManager {
  private logger: any;

  constructor(
    private db: Knex,
    private fileDiscoveryService: FileDiscoveryService,
    logger?: any
  ) {
    this.logger = logger || createComponentLogger('repository-manager');
  }

  async ensureRepository(repositoryPath: string): Promise<Repository> {
    const absolutePath = path.resolve(repositoryPath);

    // Validate that the repository path exists and is a directory
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        throw new Error(`Repository path is not a directory: ${absolutePath}`);
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`Repository path does not exist: ${absolutePath}`);
      } else if (error.code === 'EACCES') {
        throw new Error(`Repository path is not accessible: ${absolutePath}`);
      } else {
        throw error;
      }
    }

    // Additional check for read access
    try {
      await fs.access(absolutePath, fs.constants.R_OK);
    } catch (error) {
      throw new Error(`Repository path is not readable: ${absolutePath}`);
    }

    let repository = await RepositoryService.getRepositoryByPath(this.db, absolutePath);

    if (!repository) {
      const name = path.basename(absolutePath);
      const primaryLanguage = await this.detectPrimaryLanguage(absolutePath);
      const frameworkStack = await this.detectFrameworks(absolutePath);

      repository = await RepositoryService.createRepository(this.db, {
        name,
        path: absolutePath,
        language_primary: primaryLanguage,
        framework_stack: frameworkStack,
      });

      this.logger.info('Created new repository', {
        name,
        path: absolutePath,
        id: repository.id,
      });
    }

    return repository;
  }

  async detectPrimaryLanguage(repositoryPath: string): Promise<string> {
    const files = await this.fileDiscoveryService.discoverFiles(repositoryPath, {
      fileExtensions: [
        '.js',
        '.ts',
        '.jsx',
        '.tsx',
        '.mjs',
        '.cjs',
        '.php',
        '.vue',
        '.cs',
        '.tscn',
        '.godot',
        '.py',
        '.rb',
        '.go',
        '.java',
        '.cpp',
        '.c',
        '.h',
      ],
      includeTestFiles: false,
    });

    if (files.length === 0) {
      return 'unknown';
    }

    const languageCounts = new Map<string, number>();

    for (const file of files) {
      const language = this.detectLanguageFromPath(file.path);

      if (language && language !== 'unknown') {
        languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
      }
    }

    if (languageCounts.size === 0) {
      return 'unknown';
    }

    const sortedLanguages = Array.from(languageCounts.entries()).sort((a, b) => b[1] - a[1]);

    const primaryLanguage = sortedLanguages[0][0];
    const primaryCount = sortedLanguages[0][1];
    const totalFiles = files.length;
    const percentage = ((primaryCount / totalFiles) * 100).toFixed(1);

    this.logger.info('Detected primary language', {
      language: primaryLanguage,
      fileCount: primaryCount,
      totalFiles,
      percentage: `${percentage}%`,
      allLanguages: Object.fromEntries(sortedLanguages),
    });

    return primaryLanguage;
  }

  async detectFrameworks(repositoryPath: string): Promise<string[]> {
    const frameworks: string[] = [];

    try {
      const packageJsonPath = path.join(repositoryPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      if (deps.vue || deps['@vue/cli-service']) frameworks.push('vue');
      if (deps.react) frameworks.push('react');
      if (deps.next) frameworks.push('nextjs');
      if (deps.nuxt) frameworks.push('nuxt');
      if (deps.express) frameworks.push('express');
      if (deps.fastify) frameworks.push('fastify');
    } catch {
      // Ignore errors
    }

    try {
      const composerJsonPath = path.join(repositoryPath, 'composer.json');
      const composerJson = JSON.parse(await fs.readFile(composerJsonPath, 'utf-8'));

      const deps = { ...composerJson.require, ...composerJson['require-dev'] };

      if (deps['laravel/framework']) frameworks.push('laravel');
      if (deps['symfony/framework-bundle']) frameworks.push('symfony');
      if (deps['codeigniter4/framework']) frameworks.push('codeigniter');
    } catch {
      // Ignore errors
    }

    try {
      const projectGodotPath = path.join(repositoryPath, 'project.godot');
      await fs.access(projectGodotPath);
      frameworks.push('godot');
    } catch {
      // Ignore errors
    }

    return frameworks;
  }

  async getGitHash(repoPath: string): Promise<string | null> {
    try {
      const hash = execSync('git rev-parse HEAD', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim();

      if (!hash || hash.length !== 40 || !/^[0-9a-f]{40}$/i.test(hash)) {
        this.logger.error('Invalid git hash format', {
          hash: hash ? hash.substring(0, 8) : '(empty)',
          length: hash?.length ?? 0,
          repoPath,
        });
        return null;
      }

      this.logger.info('Retrieved git hash', { hash: hash.substring(0, 8), repoPath });
      return hash;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to retrieve git hash', {
        error: errorMessage,
        repoPath,
        isTimeout: errorMessage.includes('ETIMEDOUT'),
        isNotGitRepo: errorMessage.includes('not a git repository'),
      });
      return null;
    }
  }

  validateOptions(options: BuildOptions, repository?: Repository): Required<BuildOptions> {
    return {
      includeTestFiles: options.includeTestFiles ?? true,
      includeNodeModules: options.includeNodeModules ?? false,
      maxFiles: options.maxFiles ?? 10000,
      fileExtensions: options.fileExtensions ?? [
        '.js',
        '.jsx',
        '.ts',
        '.tsx',
        '.mjs',
        '.cjs',
        '.vue',
        '.php',
        '.cs',
      ],

      fileSizePolicy: options.fileSizePolicy || this.createDefaultFileSizePolicy(options),
      chunkOverlapLines: options.chunkOverlapLines ?? 100,
      encodingFallback: options.encodingFallback ?? 'iso-8859-1',
      compassignorePath: options.compassignorePath,
      enableParallelParsing: options.enableParallelParsing ?? true,
      maxConcurrency: options.maxConcurrency ?? 10,
      skipEmbeddings: options.skipEmbeddings ?? false,
      forceFullAnalysis: options.forceFullAnalysis ?? false,

      enableCrossStackAnalysis: this.shouldEnableCrossStackAnalysis(options, repository),
      detectFrameworks: options.detectFrameworks ?? false,
      verbose: options.verbose ?? false,

      eloquentRelationshipRegistry: options.eloquentRelationshipRegistry,
    };
  }

  shouldEnableCrossStackAnalysis(options: BuildOptions, repository?: Repository): boolean {
    if (options.enableCrossStackAnalysis !== undefined) {
      return options.enableCrossStackAnalysis;
    }

    if (
      repository?.framework_stack &&
      Array.isArray(repository.framework_stack) &&
      repository.framework_stack.includes('vue') &&
      repository.framework_stack.includes('laravel')
    ) {
      this.logger.info('Auto-enabling cross-stack analysis for Vue + Laravel project', {
        repositoryId: repository.id,
        frameworks: repository.framework_stack,
      });
      return true;
    }

    return false;
  }

  private detectLanguageFromPath(filePath: string): string {
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

  private createDefaultFileSizePolicy(_options: BuildOptions): FileSizePolicy {
    return { ...DEFAULT_POLICY };
  }
}
