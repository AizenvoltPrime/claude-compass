import { BaseParser } from './base';
import { BaseFrameworkParser, ParseFileResult, FrameworkParseOptions } from './base-framework';
import { FrameworkDetector, FrameworkDetectionResult } from './framework-detector';
import { ParserFactory } from './base';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';
import { CrossStackParser, CrossStackRelationship } from './cross-stack';

const logger = createComponentLogger('multi-parser');

/**
 * Combined parse result from multiple parsers
 */
export interface MultiParseResult extends ParseFileResult {
  parsers: string[];
  primaryParser: string;
}

/**
 * Options for multi-parser
 */
export interface MultiParseOptions extends FrameworkParseOptions {
  frameworks?: string[];
  primaryFramework?: string;
  forceBaseParsing?: boolean;
}

/**
 * Parser that can apply multiple framework parsers to a single file
 */
export class MultiParser {
  private detector: FrameworkDetector;
  private frameworkCache: Map<string, FrameworkDetectionResult> = new Map();

  constructor() {
    this.detector = new FrameworkDetector();
  }

  /**
   * Parse a file with multiple parsers based on framework detection
   */
  async parseFile(
    content: string,
    filePath: string,
    options: MultiParseOptions = {},
    detectionResult?: FrameworkDetectionResult
  ): Promise<MultiParseResult> {
    // Declare applicableParsers in broader scope so catch block can access it
    let applicableParsers: string[] = [];

    try {
      // Get framework detection if not provided
      if (!detectionResult && !options.frameworks) {
        const projectRoot = options.frameworkContext?.projectRoot || this.findProjectRoot(filePath);

        if (this.frameworkCache.has(projectRoot)) {
          detectionResult = this.frameworkCache.get(projectRoot)!;
        } else {
          try {
            detectionResult = await this.detector.detectFrameworks(projectRoot);
            this.frameworkCache.set(projectRoot, detectionResult);
          } catch (error) {
            logger.warn(`Framework detection failed for ${filePath}`, { error: error.message });
            detectionResult = {
              frameworks: [],
              metadata: {
                hasPackageJson: false,
                hasComposerJson: false,
                hasConfigFiles: false,
                directoryStructure: [],
              },
            };
            this.frameworkCache.set(projectRoot, detectionResult);
          }
        }
      }

      // Determine which parsers to apply

      if (options.frameworks) {
        // Use explicitly provided frameworks
        applicableParsers = options.frameworks;
      } else if (detectionResult && detectionResult.frameworks) {
        // Use framework detection + file-based detection
        try {
          const frameworkParsers = this.detector.getApplicableFrameworks(filePath, detectionResult);

          if (frameworkParsers.length > 0) {
            // Use framework-detected parsers only
            applicableParsers = frameworkParsers;
          } else {
            // No framework parsers found, use defaults only
            applicableParsers = this.getDefaultParsers(filePath);
          }
        } catch (error) {
          logger.warn(
            `getApplicableFrameworks failed for ${filePath}, falling back to default parsers`,
            { error: error.message }
          );
          applicableParsers = this.getDefaultParsers(filePath);
        }
      } else {
        // Fallback to default parsers only
        applicableParsers = this.getDefaultParsers(filePath);
      }

      if (applicableParsers.length === 0) {
        logger.warn(`No applicable parsers found for file`, { filePath });
        return this.createEmptyResult(filePath, []);
      }

      // Parse with each applicable parser in parallel
      const parsePromises = applicableParsers.map(async (parserName) => {
        try {
          const parser = ParserFactory.getParser(parserName);
          if (!parser) {
            logger.warn(`Parser not found: ${parserName}`);
            return {
              parser: parserName,
              result: null,
              error: {
                message: `Parser not found: ${parserName}`,
                line: 0,
                column: 0,
                severity: 'error',
              },
            };
          }

          let result: ParseFileResult;

          if (parser instanceof BaseFrameworkParser) {
            result = await parser.parseFile(filePath, content, options);
          } else if (parser instanceof BaseParser) {
            const baseResult = await parser.parseFile(filePath, content, options);
            result = {
              filePath,
              ...baseResult,
              frameworkEntities: [],
              metadata: {
                framework: parserName,
                isFrameworkSpecific: false,
              },
            };
          } else {
            logger.warn(`Unsupported parser type: ${parserName}`);
            return {
              parser: parserName,
              result: null,
              error: {
                message: `Unsupported parser type: ${parserName}`,
                line: 0,
                column: 0,
                severity: 'warning',
              },
            };
          }

          return {
            parser: parserName,
            result,
            error: null,
          };
        } catch (error) {
          const errorMessage = `Parser ${parserName} failed: ${error.message}`;
          logger.error(errorMessage, { filePath, error });
          return {
            parser: parserName,
            result: null,
            error: {
              message: errorMessage,
              line: 0,
              column: 0,
              severity: 'error',
            },
          };
        }
      });

      const allResults = await Promise.all(parsePromises);

      const parseResults: { parser: string; result: ParseFileResult }[] = [];
      const collectedErrors: any[] = [];

      for (const { parser: parserName, result, error } of allResults) {
        if (error) {
          collectedErrors.push(error);
        }
        if (result) {
          parseResults.push({ parser: parserName, result });
        }
      }

      let primaryResult: ParseFileResult | null = null;
      let primaryParser = '';

      for (const { parser: parserName, result } of parseResults) {
        if (!primaryResult || this.shouldBePrimary(parserName, result, primaryParser, primaryResult)) {
          primaryResult = result;
          primaryParser = parserName;
        }
      }

      if (!primaryResult) {
        logger.error(`All parsers failed for file`, { filePath });
        const emptyResult = this.createEmptyResult(filePath, applicableParsers);

        // Add collected errors to the empty result
        if (collectedErrors.length > 0) {
          // If we have specific parser errors, filter them and use only those
          const filteredErrors = this.deduplicateErrors(
            this.filterFalsePositiveErrors(collectedErrors)
          );
          emptyResult.errors = filteredErrors;
        } else {
          // If no specific errors, keep the generic "All parsers failed" error
          const filteredErrors = this.deduplicateErrors(
            this.filterFalsePositiveErrors(collectedErrors)
          );
          emptyResult.errors.push(...filteredErrors);
        }

        emptyResult.parsers = applicableParsers;
        return emptyResult;
      }

      // Merge results from all parsers
      const mergedResult = await this.mergeParseResults(primaryResult, parseResults, primaryParser);

      // Add any collected errors from failed parsers
      if (collectedErrors.length > 0) {
        const filteredErrors = this.deduplicateErrors(
          this.filterFalsePositiveErrors(collectedErrors)
        );
        mergedResult.errors.push(...filteredErrors);
      }

      return {
        ...mergedResult,
        parsers: applicableParsers,
        primaryParser,
      };
    } catch (error) {
      logger.error(`Multi-parsing failed for file ${filePath}`, { error });
      // Use the parsers that were determined, or fall back to default parsers
      const fallbackParsers =
        applicableParsers.length > 0 ? applicableParsers : this.getDefaultParsers(filePath);
      return this.createEmptyResult(filePath, fallbackParsers);
    }
  }

  /**
   * Parse multiple files with framework detection
   */
  async parseFiles(
    files: Array<{ content: string; filePath: string; options?: MultiParseOptions }>,
    projectPath?: string
  ): Promise<MultiParseResult[]> {
    // Detect frameworks once for the project
    let detectionResult: FrameworkDetectionResult | undefined;

    if (projectPath) {
      detectionResult = await this.detector.detectFrameworks(projectPath);
    }

    // Parse all files
    const results: MultiParseResult[] = [];

    for (const file of files) {
      const options = {
        ...file.options,
        frameworkContext: {
          ...file.options?.frameworkContext,
          projectRoot: projectPath || file.options?.frameworkContext?.projectRoot,
        },
      };

      const result = await this.parseFile(file.content, file.filePath, options, detectionResult);
      results.push(result);
    }

    return results;
  }

  /**
   * Find project root directory
   */
  private findProjectRoot(filePath: string): string {
    let currentDir = path.dirname(filePath);

    while (currentDir !== path.dirname(currentDir)) {
      try {
        // Look for package.json or composer.json as indicators of project root
        const packageJsonPath = path.join(currentDir, 'package.json');
        const composerJsonPath = path.join(currentDir, 'composer.json');

        try {
          require('fs').accessSync(packageJsonPath);
          return currentDir;
        } catch (error) {
          // If package.json not found, try composer.json
          require('fs').accessSync(composerJsonPath);
          return currentDir;
        }
      } catch (error) {
        currentDir = path.dirname(currentDir);
      }
    }

    // Fallback to file directory
    return path.dirname(filePath);
  }

  /**
   * Get default parsers for a file when no framework detection is available
   */
  private getDefaultParsers(filePath: string): string[] {
    const ext = path.extname(filePath);
    const fileName = path.basename(filePath);
    const parsers: string[] = [];

    // Check for specialized file types first
    if (ext === '.prisma') {
      return ['orm'];
    }

    if (fileName === 'package.json') {
      return ['package-manager'];
    }

    // Check for test files
    if (fileName.includes('.test.') || fileName.includes('.spec.') || fileName.includes('.e2e.')) {
      parsers.push('test-framework');
    }

    // Check for ORM/model files based on naming patterns
    if (
      fileName.includes('.model.') ||
      fileName.includes('.entity.') ||
      fileName.includes('.schema.')
    ) {
      parsers.push('orm');
    }

    // Add base language parsers
    switch (ext) {
      case '.js':
      case '.mjs':
      case '.cjs':
        parsers.push('javascript');
        // Check for background job patterns in JS files
        if (fileName.includes('worker') || fileName.includes('job') || fileName.includes('queue')) {
          parsers.push('background-job');
        }
        break;
      case '.ts':
      case '.mts':
      case '.cts':
        parsers.push('typescript');
        // Check for background job patterns in TS files
        if (fileName.includes('worker') || fileName.includes('job') || fileName.includes('queue')) {
          parsers.push('background-job');
        }
        break;
      case '.jsx':
        parsers.push('javascript', 'react');
        break;
      case '.tsx':
        parsers.push('typescript', 'react');
        break;
      case '.vue':
        parsers.push('vue');
        break;
      case '.php':
      case '.phtml':
      case '.php3':
      case '.php4':
      case '.php5':
      case '.php7':
      case '.phps':
        parsers.push('php');
        break;
      case '.cs':
        // C# files - use C# parser by default
        parsers.push('csharp');
        break;
      case '.tscn':
        // Godot scene files
        parsers.push('godot');
        break;
      case '.godot':
        // Godot project configuration files
        parsers.push('godot');
        break;
      default:
        // Return empty array for unsupported file types
        break;
    }

    return parsers.length > 0 ? parsers : [];
  }

  /**
   * Determine if a parser should be the primary parser
   */
  private shouldBePrimary(
    parserName: string,
    result: ParseFileResult,
    currentPrimaryParser: string,
    currentPrimaryResult: ParseFileResult
  ): boolean {
    // Framework parsers take priority over base parsers
    if (this.isFrameworkParser(parserName) && !this.isFrameworkParser(currentPrimaryParser)) {
      return true;
    }

    // Among framework parsers, prefer the one with more framework entities
    if (this.isFrameworkParser(parserName) && this.isFrameworkParser(currentPrimaryParser)) {
      const currentEntities = currentPrimaryResult.frameworkEntities?.length || 0;
      const newEntities = result.frameworkEntities?.length || 0;
      return newEntities > currentEntities;
    }

    // Among base parsers, prefer TypeScript over JavaScript
    if (parserName === 'typescript' && currentPrimaryParser === 'javascript') {
      return true;
    }

    return false;
  }

  /**
   * Check if parser is a framework parser
   */
  private isFrameworkParser(parserName: string): boolean {
    return [
      'vue',
      'nextjs',
      'react',
      'nodejs',
      'laravel',
      'godot',
      'test-framework',
      'package-manager',
      'background-job',
      'orm',
    ].includes(parserName);
  }

  /**
   * Merge results from multiple parsers
   */
  private async mergeParseResults(
    primaryResult: ParseFileResult,
    allResults: Array<{ parser: string; result: ParseFileResult }>,
    _primaryParser: string
  ): Promise<ParseFileResult> {
    const symbolsMap = new Map<string, any>();
    const dependenciesMap = new Map<string, any>();
    const importsMap = new Map<string, any>();
    const exportsMap = new Map<string, any>();
    const frameworkEntitiesMap = new Map<string, any>();

    const symbolKey = (s: any): string =>
      `${s.name}:${s.symbol_type}:${s.start_line}:${s.end_line}`;

    const depKey = (d: any): string =>
      `${d.from_symbol}:${d.to_symbol}:${d.dependency_type}:${d.line_number}`;

    const impKey = (i: any): string => {
      const names = (i.imported_names || []).slice().sort().join(',');
      return `${i.source}:${i.import_type}:${i.line_number}:${i.is_dynamic}:${names}`;
    };

    const expKey = (e: any): string => {
      const names = (e.exported_names || []).slice().sort().join(',');
      return `${e.export_type}:${e.source}:${e.line_number}:${names}`;
    };

    const entityKey = (e: any): string => `${e.type}:${e.name}:${e.filePath}`;

    primaryResult.symbols.forEach(s => symbolsMap.set(symbolKey(s), s));
    primaryResult.dependencies.forEach(d => dependenciesMap.set(depKey(d), d));
    primaryResult.imports.forEach(i => importsMap.set(impKey(i), i));
    primaryResult.exports.forEach(e => exportsMap.set(expKey(e), e));
    (primaryResult.frameworkEntities || []).forEach(e => frameworkEntitiesMap.set(entityKey(e), e));

    const allErrors = [
      ...this.deduplicateErrors(this.filterFalsePositiveErrors(primaryResult.errors)),
    ];

    for (const { result } of allResults) {
      result.symbols.forEach(s => {
        const key = symbolKey(s);
        if (!symbolsMap.has(key)) {
          symbolsMap.set(key, s);
        }
      });

      result.dependencies.forEach(d => {
        const key = depKey(d);
        if (!dependenciesMap.has(key)) {
          dependenciesMap.set(key, d);
        }
      });

      result.imports.forEach(i => {
        const key = impKey(i);
        if (!importsMap.has(key)) {
          importsMap.set(key, i);
        }
      });

      result.exports.forEach(e => {
        const key = expKey(e);
        if (!exportsMap.has(key)) {
          exportsMap.set(key, e);
        }
      });

      const filteredErrors = this.deduplicateErrors(this.filterFalsePositiveErrors(result.errors));
      allErrors.push(...filteredErrors);

      if (result.frameworkEntities) {
        result.frameworkEntities.forEach(e => {
          const key = entityKey(e);
          if (!frameworkEntitiesMap.has(key)) {
            frameworkEntitiesMap.set(key, e);
          }
        });
      }
    }

    const crossStackRelationships = await this.detectCrossStackRelationships(allResults);
    if (crossStackRelationships.length > 0) {
      for (const relationship of crossStackRelationships) {
        const key = depKey(relationship.dependency);
        if (!dependenciesMap.has(key)) {
          dependenciesMap.set(key, relationship.dependency);
        }
      }

      for (const relationship of crossStackRelationships) {
        const key = entityKey(relationship.metadata);
        if (!frameworkEntitiesMap.has(key)) {
          frameworkEntitiesMap.set(key, relationship.metadata);
        }
      }
    }

    return {
      filePath: primaryResult.filePath,
      symbols: Array.from(symbolsMap.values()),
      dependencies: Array.from(dependenciesMap.values()),
      imports: Array.from(importsMap.values()),
      exports: Array.from(exportsMap.values()),
      errors: this.deduplicateErrors(allErrors),
      frameworkEntities: Array.from(frameworkEntitiesMap.values()),
      metadata: {
        ...primaryResult.metadata,
        ...(crossStackRelationships.length > 0 && {
          crossStackRelationships: crossStackRelationships.length,
        }),
      },
    };
  }

  /**
   * Detect cross-stack relationships between Vue and Laravel parse results
   */
  private async detectCrossStackRelationships(
    allResults: Array<{ parser: string; result: ParseFileResult }>
  ): Promise<CrossStackRelationship[]> {
    try {
      // Filter results by framework type
      const vueResults = allResults
        .filter(r => r.parser === 'vue' || r.result.metadata?.framework === 'vue')
        .map(r => r.result);

      const laravelResults = allResults
        .filter(r => r.parser === 'laravel' || r.result.metadata?.framework === 'laravel')
        .map(r => r.result);

      // Only proceed if we have both Vue and Laravel results
      if (vueResults.length === 0 || laravelResults.length === 0) {
        return [];
      }

      // Use CrossStackParser to detect relationships
      const crossStackParser = new CrossStackParser();
      const relationships = await crossStackParser.detectApiCallRelationships(
        vueResults,
        laravelResults
      );

      return relationships;
    } catch (error) {
      logger.error('Cross-stack relationship detection failed', { error });
      return [];
    }
  }

  /**
   * Create empty result for failed parsing
   */
  private createEmptyResult(filePath: string, parsers: string[]): MultiParseResult {
    return {
      filePath,
      symbols: [],
      dependencies: [],
      imports: [],
      exports: [],
      errors: [
        {
          message: 'All parsers failed',
          line: 0,
          column: 0,
          severity: 'error',
        },
      ],
      frameworkEntities: [],
      metadata: {
        framework: 'unknown',
        isFrameworkSpecific: false,
      },
      parsers,
      primaryParser: parsers[0] || 'unknown',
    };
  }

  /**
   * Get framework detection for a project
   */
  async detectFrameworks(projectPath: string): Promise<FrameworkDetectionResult> {
    return this.detector.detectFrameworks(projectPath);
  }

  /**
   * Get applicable frameworks for a file
   */
  getApplicableFrameworks(filePath: string, detectionResult: FrameworkDetectionResult): string[] {
    return this.detector.getApplicableFrameworks(filePath, detectionResult);
  }

  private static readonly FALSE_POSITIVE_REGEX = new RegExp(
    [
      'google\\.maps',
      'google\\.analytics',
      'microsoft\\.maps',
      'parsing error in error: interface',
      'parsing error in labeled_statement',
      'parsing error in expression_statement',
      'parsing error in subscript_expression',
      'parsing error in identifier:',
      'syntax errors in vue script section',
      'parsing error in program',
      'parsing error in statement_block',
      'parsing error in sequence_expression',
      'parsing error in ternary_expression',
      'parsing error in export_statement',
      'parsing error in lexical_declaration',
      'parsing error in variable_declarator',
      'parsing error in call_expression',
      'parsing error in arguments',
      'parsing error in object',
      'parsing error in pair',
      'parsing error in member_expression',
      'parsing error in assignment_expression',
      'parsing error in arrow_function',
      'parsing error in function_declaration',
      'parsing error in template_literal',
      'parsing error in property_identifier',
      'parsing error in formal_parameters',
      'parsing error in parameter',
      'parsing error in method_definition',
      'parsing error in class_declaration',
      'parsing error in if_statement',
      'parsing error in for_statement',
      'parsing error in while_statement',
      'parsing error in try_statement',
      'parsing error in parenthesized_expression',
      'parsing error in await_expression',
      'parsing error in return_statement',
      'parsing error in binary_expression',
      'parsing error in unary_expression',
      'parsing error in update_expression',
      'parsing error in new_expression',
      'parsing error in switch_statement',
      'parsing error in case_clause',
      'parsing error in default_clause',
      'parsing error in break_statement',
      'parsing error in continue_statement',
      'parsing error in throw_statement',
      'parsing error in catch_clause',
      'parsing error in finally_clause',
      'parsing error in type_annotation',
      'parsing error in type_arguments',
      'parsing error in generic_type',
      'parsing error in union_type',
      'parsing error in intersection_type',
      'parsing error in predicate_type',
      'parsing error in conditional_type',
      'parsing error in mapped_type_clause',
      'parsing error in import_statement',
      'parsing error in import_clause',
      'parsing error in named_imports',
      'parsing error in import_specifier',
      'parsing error in \\):',
      'parsing error in }: ',
      'parsing error in ]; ',
      'parsing error in >:',
      'parsing error in ,:',
      'parsing error in ;:',
      'parsing error in assignment_pattern',
      'parsing error in array:',
      'parsing error in array_pattern',
      'parsing error in object_pattern',
      'parsing error in rest_pattern',
      'parsing error in destructuring_pattern',
      'parsing error in jsx_expression',
      'parsing error in jsx_element',
      'parsing error in jsx_fragment',
      'content too large',
      'file content too large',
      'parsing error in error:',
      'parsing error in error ',
      'parsing error in identifier: \\n',
      'parsing error in identifier: ',
      'parsing error in identifier:\\n',
    ].join('|'),
    'i'
  );

  /**
   * Filter out known false positive parsing errors
   */
  private filterFalsePositiveErrors(errors: any[]): any[] {
    return errors.filter(error => {
      const message = error.message?.toLowerCase() || '';
      return !MultiParser.FALSE_POSITIVE_REGEX.test(message);
    });
  }

  /**
   * Remove duplicate errors from a list of errors
   */
  private deduplicateErrors(errors: any[]): any[] {
    const seen = new Set<string>();
    return errors.filter(error => {
      // Create a unique key based on message, line, and column
      const key = `${error.message || ''}:${error.line || 0}:${error.column || 0}`;
      if (seen.has(key)) {
        return false; // Duplicate found
      }
      seen.add(key);
      return true;
    });
  }
}
