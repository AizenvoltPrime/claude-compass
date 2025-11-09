import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import { ParseResult } from '../../parsers/base';
import { MultiParser } from '../../parsers';
import { FileSizeManager, FileSizePolicy, DEFAULT_POLICY } from '../../config/file-size-policy';
import { EncodingConverter } from '../../utils/encoding-converter';
import { BuildOptions } from './types';
import { createComponentLogger } from '../../utils/logger';
import type { Knex } from 'knex';

/**
 * File Parsing Orchestrator
 * Handles file parsing with encoding recovery, size policies, and Eloquent relationship detection
 */
export class FileParsingOrchestrator {
  private logger: any;

  constructor(
    private db: Knex,
    logger?: any
  ) {
    this.logger = logger || createComponentLogger('file-parsing-orchestrator');
  }

  async buildEloquentRelationshipRegistry(
    files: Array<{ path: string; relativePath?: string }>,
    options: BuildOptions
  ): Promise<Map<string, Map<string, string>>> {
    const registry = new Map<string, Map<string, string>>();

    const modelFiles = files.filter(file => {
      const normalized = file.path.replace(/\\/g, '/');
      return (
        normalized.includes('/app/Models/') || normalized.includes('/app/Model/')
      ) && file.path.endsWith('.php');
    });

    if (modelFiles.length === 0) {
      return registry;
    }

    this.logger.info('Building Eloquent relationship registry', {
      modelFileCount: modelFiles.length,
    });

    const { PHPParser } = await import('../../parsers/php');
    const phpParser = new PHPParser();

    const parseResults = await Promise.all(
      modelFiles.map(async file => {
        try {
          const content = await this.readFileWithEncodingRecovery(file.path, options);
          if (!content) {
            return { success: false, file: file.path };
          }

          await phpParser.parseFile(file.path, content, {
            eloquentRelationshipRegistry: registry,
          });
          return { success: true };
        } catch (error) {
          this.logger.warn('Failed to parse model file for registry', {
            path: file.path,
            error: (error as Error).message,
          });
          return { success: false, file: file.path };
        }
      })
    );

    const successCount = parseResults.filter(r => r.success).length;
    const failureCount = parseResults.filter(r => !r.success).length;
    const failedFiles = parseResults
      .filter(r => !r.success && r.file)
      .map(r => r.file!);

    this.logger.info('Eloquent relationship registry built', {
      modelCount: registry.size,
      totalRelationships: Array.from(registry.values()).reduce((sum, m) => sum + m.size, 0),
      successfulParses: successCount,
      failedParses: failureCount,
      ...(failureCount > 0 && { failedFiles: failedFiles.slice(0, 5) }),
    });

    return registry;
  }

  async parseFiles(
    files: Array<{ path: string; relativePath?: string }>,
    options: BuildOptions
  ): Promise<Array<ParseResult & { filePath: string }>> {
    const multiParser = new MultiParser();

    // Use pre-built registry if provided, otherwise build from files
    const eloquentRegistry = options.eloquentRelationshipRegistry ||
      await this.buildEloquentRelationshipRegistry(files, options);

    const concurrency = options.maxConcurrency || 10;
    const limit = pLimit(concurrency);

    const parsePromises = files.map(file =>
      limit(async () => {
        try {
          const content = await this.readFileWithEncodingRecovery(file.path, options);
          if (!content) {
            return null;
          }

          const enhancedOptions = {
            ...options,
            eloquentRelationshipRegistry: eloquentRegistry,
          };

          const parseResult = await this.processFileWithSizePolicyMultiParser(
            file,
            content,
            multiParser,
            enhancedOptions
          );
          if (!parseResult) {
            return null;
          }

          return {
            ...parseResult,
            filePath: file.path,
          };
        } catch (error) {
          this.logger.error('Failed to parse file', {
            path: file.path,
            error: (error as Error).message,
          });

          return {
            filePath: file.path,
            symbols: [],
            dependencies: [],
            imports: [],
            exports: [],
            errors: [
              {
                message: (error as Error).message,
                line: 0,
                column: 0,
                severity: 'error',
              },
            ],
            success: false,
          };
        }
      })
    );

    const parsedResults = await Promise.all(parsePromises);

    const results = parsedResults.filter(
      (result): result is ParseResult & { filePath: string } => result !== null
    );

    const parseStats = {
      totalFiles: files.length,
      successfulParses: results.filter(r => r.success !== false && r.errors.length === 0).length,
      failedParses: results.filter(r => r.success === false || r.errors.length > 0).length,
      totalSymbols: results.reduce((sum, r) => sum + r.symbols.length, 0),
      totalDependencies: results.reduce((sum, r) => sum + r.dependencies.length, 0),
      byExtension: {} as Record<string, { files: number; symbols: number; errors: number }>,
    };

    results.forEach(result => {
      const ext = path.extname(result.filePath);
      if (!parseStats.byExtension[ext]) {
        parseStats.byExtension[ext] = { files: 0, symbols: 0, errors: 0 };
      }
      parseStats.byExtension[ext].files++;
      parseStats.byExtension[ext].symbols += result.symbols.length;
      parseStats.byExtension[ext].errors += result.errors.length;
    });

    this.logger.info('File parsing completed', parseStats);

    if (parseStats.failedParses > 0) {
      const failedFiles = results
        .filter(r => r.success === false || r.errors.length > 0)
        .map(r => ({ path: r.filePath, errors: r.errors.length }));

      this.logger.warn('Parsing failures detected', {
        failedCount: parseStats.failedParses,
        failedFiles: failedFiles.slice(0, 10),
      });
    }

    return results;
  }

  async readFileWithEncodingRecovery(
    filePath: string,
    _options: BuildOptions
  ): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (!content.includes('\uFFFD')) {
        return content;
      }

      this.logger.info('Attempting encoding recovery', { filePath });
      const buffer = await fs.readFile(filePath);
      const recovered = await EncodingConverter.convertToUtf8(buffer);
      return recovered;
    } catch (error) {
      this.logger.warn('File reading failed', { filePath, error: (error as Error).message });
      return null;
    }
  }

  private async processFileWithSizePolicy(
    file: { path: string; relativePath?: string },
    content: string,
    parser: any,
    options: BuildOptions
  ): Promise<ParseResult | null> {
    const fileSizePolicy = options.fileSizePolicy || this.createDefaultFileSizePolicy(options);
    const sizeManager = new FileSizeManager(fileSizePolicy);
    const action = sizeManager.getRecommendedAction(content.length);

    switch (action) {
      case 'reject':
        this.logger.warn('File rejected due to size policy', {
          path: file.path,
          size: content.length,
        });
        return null;

      case 'skip':
        this.logger.info('File skipped due to size policy', {
          path: file.path,
          size: content.length,
        });
        return null;

      case 'chunk':
        const parseOptions = {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          enableChunking: true,
          enableEncodingRecovery: true,
          chunkSize: fileSizePolicy.chunkingThreshold,
          chunkOverlapLines: options.chunkOverlapLines || 100,
        };
        return await parser.parseFile(file.path, content, parseOptions);

      case 'truncate':
        this.logger.warn('Truncate action requested but using chunking instead', {
          path: file.path,
          size: content.length,
        });
        const fallbackParseOptions = {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          enableChunking: true,
          enableEncodingRecovery: true,
          chunkSize: fileSizePolicy.truncationFallback,
          chunkOverlapLines: options.chunkOverlapLines || 100,
        };
        return await parser.parseFile(file.path, content, fallbackParseOptions);

      case 'warn':
        this.logger.warn('Processing large file', {
          path: file.path,
          size: content.length,
        });

      case 'process':
      default:
        return await parser.parseFile(file.path, content, {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          enableChunking: true,
          enableEncodingRecovery: true,
          chunkOverlapLines: options.chunkOverlapLines || 100,
        });
    }
  }

  private async processFileWithSizePolicyMultiParser(
    file: { path: string; relativePath?: string },
    content: string,
    multiParser: MultiParser,
    options: BuildOptions
  ): Promise<ParseResult | null> {
    const fileSizePolicy = options.fileSizePolicy || this.createDefaultFileSizePolicy(options);
    const sizeManager = new FileSizeManager(fileSizePolicy);
    const action = sizeManager.getRecommendedAction(content.length);

    switch (action) {
      case 'reject':
        this.logger.warn('File rejected due to size policy', {
          path: file.path,
          size: content.length,
        });
        return null;

      case 'skip':
        this.logger.info('File skipped due to size policy', {
          path: file.path,
          size: content.length,
        });
        return null;

      case 'chunk':
      case 'truncate':
      case 'warn':
      case 'process':
      default:
        const parseOptions = {
          includePrivateSymbols: true,
          includeTestFiles: options.includeTestFiles,
          enableChunking: action === 'chunk',
          enableEncodingRecovery: true,
          chunkSize: action === 'chunk' ? fileSizePolicy.chunkingThreshold : undefined,
          chunkOverlapLines: options.chunkOverlapLines || 100,
          eloquentRelationshipRegistry: options.eloquentRelationshipRegistry,
        };

        const multiResult = await multiParser.parseFile(content, file.path, parseOptions);

        return {
          symbols: multiResult.symbols,
          dependencies: multiResult.dependencies,
          imports: multiResult.imports,
          exports: multiResult.exports,
          errors: multiResult.errors,
          frameworkEntities: multiResult.frameworkEntities || [],
          success: multiResult.errors.length === 0,
        };
    }
  }

  private createDefaultFileSizePolicy(_options: BuildOptions): FileSizePolicy {
    return { ...DEFAULT_POLICY };
  }
}
