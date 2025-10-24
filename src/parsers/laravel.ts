import Parser from 'tree-sitter';
import { php } from 'tree-sitter-php';
import { BaseFrameworkParser, FrameworkPattern, FrameworkParseOptions } from './base-framework';
import { FrameworkEntity, FrameworkParseResult, ParseResult } from './base';
import { ChunkResult, MergedParseResult } from './chunked-parser';
import { PHPParser } from './php';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';

import {
  LaravelRoute,
  LaravelController,
  EloquentModel,
  LaravelMiddleware,
  LaravelJob,
  LaravelServiceProvider,
  LaravelCommand,
  LaravelFormRequest,
  LaravelEvent,
  LaravelMail,
  LaravelPolicy,
  LaravelListener,
  LaravelService,
  LaravelFactory,
  LaravelTrait,
  LaravelResource,
  LaravelObserver,
  LaravelApiSchema,
  ValidationRule,
  LaravelResponseSchema,
} from './laravel/types';
import {
  parseFormRequestValidation,
} from './laravel/validation';
import {
  extractApiSchemas,
} from './laravel/api-schema';
import {
  extractEloquentModels,
} from './laravel/models';
import {
  extractLaravelControllers,
} from './laravel/controllers';
import {
  extractLaravelMiddleware,
} from './laravel/middleware';
import {
  extractLaravelJobs,
} from './laravel/jobs';
import {
  extractArtisanCommands,
} from './laravel/commands';
import {
  extractLaravelRoutes,
  isRouteFile,
} from './laravel/routes';
import {
  extractLaravelServiceProviders,
} from './laravel/service-providers';
import {
  extractLaravelFormRequests,
} from './laravel/form-requests';
import {
  extractLaravelEvents,
  extractLaravelListeners,
} from './laravel/events';
import {
  extractLaravelMail,
} from './laravel/mail';
import {
  extractLaravelPolicies,
} from './laravel/policies';
import {
  extractLaravelServices,
} from './laravel/services';
import {
  extractLaravelFactories,
} from './laravel/factories';
import {
  extractLaravelTraits,
} from './laravel/traits';
import {
  extractLaravelResources,
} from './laravel/resources';
import {
  extractLaravelObservers,
} from './laravel/observers';

export {
  LaravelRoute,
  LaravelController,
  EloquentModel,
  LaravelMiddleware,
  LaravelJob,
  LaravelServiceProvider,
  LaravelCommand,
  LaravelFormRequest,
  LaravelEvent,
  LaravelMail,
  LaravelPolicy,
  LaravelListener,
  LaravelService,
  LaravelFactory,
  LaravelTrait,
  LaravelResource,
  LaravelObserver,
  LaravelApiSchema,
  ValidationRule,
  LaravelResponseSchema,
};

const logger = createComponentLogger('laravel-parser');

/**
 * Laravel framework parser that extends BaseFrameworkParser
 * Analyzes PHP files for Laravel-specific patterns and entities
 */
export class LaravelParser extends BaseFrameworkParser {
  private phpParser: PHPParser;

  constructor(parser: Parser) {
    super(parser, 'laravel');
    this.phpParser = new PHPParser();
  }

  /**
   * Override parseFileDirectly to use PHPParser for base parsing
   */
  protected async parseFileDirectly(
    filePath: string,
    content: string,
    options?: FrameworkParseOptions
  ): Promise<ParseResult> {
    // Delegate to PHPParser for base PHP parsing
    return this.phpParser.parseFile(filePath, content, options);
  }

  /**
   * Get Laravel-specific framework patterns for detection
   */
  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'laravel-controller',
        pattern: /class\s+\w+Controller\s+extends\s+(Controller|BaseController)/,
        fileExtensions: ['.php'],
        description: 'Laravel controller classes extending base Controller',
      },
      {
        name: 'laravel-model',
        pattern: /class\s+\w+\s+extends\s+(Model|Authenticatable|Pivot)/,
        fileExtensions: ['.php'],
        description: 'Eloquent model classes extending Model, Authenticatable, or Pivot',
      },
      {
        name: 'laravel-route',
        pattern: /Route::(get|post|put|delete|patch|any|match|resource|group)/,
        fileExtensions: ['.php'],
        description: 'Laravel route definitions using Route facade',
      },
      {
        name: 'laravel-middleware',
        pattern: /class\s+\w+\s+(implements\s+.*Middleware|extends\s+.*Middleware)/,
        fileExtensions: ['.php'],
        description: 'Laravel middleware classes',
      },
      {
        name: 'laravel-service-provider',
        pattern: /class\s+\w+ServiceProvider\s+extends\s+ServiceProvider/,
        fileExtensions: ['.php'],
        description: 'Laravel service provider classes',
      },
      {
        name: 'laravel-job',
        pattern: /class\s+\w+\s+implements\s+.*ShouldQueue/,
        fileExtensions: ['.php'],
        description: 'Laravel queueable job classes',
      },
      {
        name: 'laravel-command',
        pattern: /class\s+\w+\s+extends\s+Command/,
        fileExtensions: ['.php'],
        description: 'Laravel Artisan command classes',
      },
      {
        name: 'laravel-migration',
        pattern: /class\s+\w+\s+extends\s+Migration/,
        fileExtensions: ['.php'],
        description: 'Laravel database migration classes',
      },
      {
        name: 'laravel-seeder',
        pattern: /class\s+\w+\s+extends\s+Seeder/,
        fileExtensions: ['.php'],
        description: 'Laravel database seeder classes',
      },
      // Missing Laravel entity patterns from improvement plan
      {
        name: 'laravel-form-request',
        pattern: /class\s+\w+\s+extends\s+FormRequest/,
        fileExtensions: ['.php'],
        description: 'Laravel Form Request classes for validation',
      },
      {
        name: 'laravel-event',
        pattern: /class\s+\w+\s+implements\s+.*ShouldBroadcast/,
        fileExtensions: ['.php'],
        description: 'Laravel Event classes with broadcasting',
      },
      {
        name: 'laravel-mail',
        pattern: /class\s+\w+\s+extends\s+Mailable/,
        fileExtensions: ['.php'],
        description: 'Laravel Mail classes',
      },
      {
        name: 'laravel-policy',
        pattern: /class\s+\w+.*Policy/,
        fileExtensions: ['.php'],
        description: 'Laravel Policy classes for authorization',
      },
      {
        name: 'laravel-listener',
        pattern: /class\s+\w+.*\s+public\s+function\s+handle/,
        fileExtensions: ['.php'],
        description: 'Laravel Event Listener classes',
      },
      {
        name: 'laravel-factory',
        pattern: /class\s+\w+Factory\s+extends\s+Factory/,
        fileExtensions: ['.php'],
        description: 'Laravel Factory classes for model generation',
      },
      {
        name: 'laravel-trait',
        pattern: /trait\s+\w+/,
        fileExtensions: ['.php'],
        description: 'PHP Traits used in Laravel applications',
      },
      {
        name: 'laravel-resource',
        pattern: /class\s+\w+\s+extends\s+.*Resource/,
        fileExtensions: ['.php'],
        description: 'Laravel API Resource classes',
      },
      {
        name: 'laravel-observer',
        pattern: /class\s+\w+Observer/,
        fileExtensions: ['.php'],
        description: 'Laravel Model Observer classes',
      },
      {
        name: 'laravel-service',
        pattern: /class\s+\w+Service/,
        fileExtensions: ['.php'],
        description: 'Laravel Service classes for business logic',
      },
    ];
  }

  /**
   * Detect Laravel framework entities in the given file
   */
  async detectFrameworkEntities(
    content: string,
    filePath: string,
    _options: FrameworkParseOptions
  ): Promise<FrameworkParseResult> {
    const entities: FrameworkEntity[] = [];

    try {
      // Create a dedicated PHP parser for tree-sitter parsing
      const phpTreeParser = new Parser();
      phpTreeParser.setLanguage(php);

      // Parse the PHP content
      const tree = phpTreeParser.parse(content);
      if (!tree || !tree.rootNode) {
        logger.warn(`Failed to parse PHP content for Laravel analysis: ${filePath}`);
        return { entities: [] };
      }

      // Route files get special treatment
      const isRoute = isRouteFile(filePath);
      if (isRoute) {
        entities.push(...(await extractLaravelRoutes(content, filePath, tree.rootNode)));
      }

      // Extract all Laravel entity types
      entities.push(...(await extractLaravelControllers(content, filePath, tree.rootNode)));
      entities.push(...(await extractEloquentModels(content, filePath, tree.rootNode)));
      entities.push(...(await extractLaravelMiddleware(content, filePath, tree.rootNode)));
      entities.push(...(await extractLaravelJobs(content, filePath, tree.rootNode)));
      entities.push(...extractLaravelServiceProviders(content, filePath, tree.rootNode));
      entities.push(...(await extractArtisanCommands(content, filePath, tree.rootNode)));
      entities.push(...extractLaravelFormRequests(content, filePath, tree.rootNode));
      entities.push(...extractLaravelEvents(content, filePath, tree.rootNode));
      entities.push(...extractLaravelMail(content, filePath, tree.rootNode));
      entities.push(...extractLaravelPolicies(content, filePath, tree.rootNode));
      entities.push(...extractLaravelListeners(content, filePath, tree.rootNode));
      entities.push(...extractLaravelServices(content, filePath, tree.rootNode));
      entities.push(...extractLaravelFactories(content, filePath, tree.rootNode));
      entities.push(...extractLaravelTraits(content, filePath, tree.rootNode));
      entities.push(...extractLaravelResources(content, filePath, tree.rootNode));
      entities.push(...extractLaravelObservers(content, filePath, tree.rootNode));
      entities.push(...(await extractApiSchemas(content, filePath, tree.rootNode)));

      // Extract validation rules from FormRequest classes
      if (filePath.includes('Request') && content.includes('FormRequest')) {
        const validationRules = parseFormRequestValidation(content, filePath, tree.rootNode, logger);
        if (validationRules.length > 0) {
          const formRequestEntity: FrameworkEntity = {
            type: 'form_request_validation',
            name: path.basename(filePath, '.php'),
            filePath,
            metadata: {
              validationRules,
              rulesCount: validationRules.length,
              framework: 'laravel',
            },
          };
          entities.push(formRequestEntity);
        }
      }

      return { entities };
    } catch (error) {
      logger.error(`Laravel entity detection failed for ${filePath}`, { error: error.message });
      return { entities: [] };
    }
  }

  /**
   * Check if the file is applicable for Laravel framework parsing
   */
  protected isFrameworkApplicable(filePath: string, content: string): boolean {
    // Laravel specific file patterns
    const laravelPatterns = [
      '/app/Http/Controllers/',
      '/app/Models/',
      '/app/Http/Middleware/',
      '/app/Jobs/',
      '/app/Providers/',
      '/routes/',
      '/database/migrations/',
      '/database/seeders/',
      '/app/Console/Commands/',
    ];

    const isLaravelPath = laravelPatterns.some(pattern => filePath.includes(pattern));

    // Check if content is valid before checking Laravel patterns
    const hasLaravelCode =
      content &&
      (content.includes('laravel') ||
        content.includes('illuminate') ||
        content.includes('Illuminate\\') ||
        content.includes('App\\') ||
        content.includes('Route::') ||
        content.includes('extends Model') ||
        content.includes('extends Authenticatable') ||
        content.includes('extends Controller'));

    return filePath.endsWith('.php') && (isLaravelPath || hasLaravelCode);
  }


  // Required implementations from ChunkedParser and BaseParser

  /**
   * Get supported file extensions for Laravel parser
   */
  getSupportedExtensions(): string[] {
    return ['.php'];
  }

  /**
   * Get chunk boundaries for large PHP files
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries = [];
    const lines = content.split('\n');
    let currentSize = 0;
    let currentLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineSize = lines[i].length + 1; // +1 for newline

      if (currentSize + lineSize > maxChunkSize && currentLine < i) {
        // Look for good break points (end of class/function)
        let breakPoint = i;
        for (let j = i; j >= currentLine; j--) {
          const line = lines[j].trim();
          if (line === '}' || line.startsWith('<?php') || line.startsWith('namespace')) {
            breakPoint = j + 1;
            break;
          }
        }
        boundaries.push(breakPoint);
        currentLine = breakPoint;
        currentSize = 0;
      } else {
        currentSize += lineSize;
      }
    }

    return boundaries;
  }

  /**
   * Merge results from multiple chunks
   */
  protected mergeChunkResults(
    chunks: ParseResult[],
    chunkMetadata: ChunkResult[]
  ): MergedParseResult {
    const merged: MergedParseResult = {
      symbols: [],
      dependencies: [],
      imports: [],
      exports: [],
      errors: [],
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunkMetadata.length,
        duplicatesRemoved: 0,
        crossChunkReferencesFound: 0,
      },
    };

    for (const chunk of chunks) {
      merged.symbols.push(...chunk.symbols);
      merged.dependencies.push(...chunk.dependencies);
      merged.imports.push(...chunk.imports);
      merged.exports.push(...chunk.exports);
      merged.errors.push(...chunk.errors);
    }

    // Remove duplicates and count them
    const originalSymbolCount = merged.symbols.length;
    merged.symbols = this.removeDuplicateSymbols(merged.symbols);
    if (merged.metadata) {
      merged.metadata.duplicatesRemoved = originalSymbolCount - merged.symbols.length;
    }

    return merged;
  }
}
