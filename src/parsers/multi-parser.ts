import { BaseParser } from './base';
import { BaseFrameworkParser, ParseFileResult, FrameworkParseOptions } from './base-framework';
import { FrameworkDetector, FrameworkDetectionResult } from './framework-detector';
import { ParserFactory } from './base';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';

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
    logger.debug(`Multi-parsing file with framework detection`, { filePath });

    // Declare applicableParsers in broader scope so catch block can access it
    let applicableParsers: string[] = [];

    try {
      // Get framework detection if not provided
      if (!detectionResult && !options.frameworks) {
        const projectRoot = options.frameworkContext?.projectRoot || this.findProjectRoot(filePath);
        try {
          detectionResult = await this.detector.detectFrameworks(projectRoot);
          logger.debug(`Detected frameworks for ${filePath}`, {
            frameworks: detectionResult.frameworks.map(f => f.name),
            confidence: detectionResult.confidence
          });
        } catch (error) {
          logger.warn(`Framework detection failed for ${filePath}`, { error: error.message });
          detectionResult = {
            frameworks: [],
            confidence: 0,
            metadata: { hasPackageJson: false, hasConfigFiles: false, directoryStructure: [] }
          };
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
          logger.warn(`getApplicableFrameworks failed for ${filePath}, falling back to default parsers`, { error: error.message });
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

      logger.debug(`Using parsers for ${filePath}`, { parsers: applicableParsers });

      // Parse with each applicable parser
      const parseResults: { parser: string; result: ParseFileResult }[] = [];
      const collectedErrors: any[] = [];
      let primaryResult: ParseFileResult | null = null;
      let primaryParser = '';

      for (const parserName of applicableParsers) {
        try {
          const parser = ParserFactory.getParser(parserName);
          if (!parser) {
            logger.warn(`Parser not found: ${parserName}`);
            collectedErrors.push({
              message: `Parser not found: ${parserName}`,
              line: 0,
              column: 0,
              severity: 'error'
            });
            continue;
          }

          logger.debug(`Parsing with ${parserName}`, { filePath });

          let result: ParseFileResult;

          if (parser instanceof BaseFrameworkParser) {
            result = await parser.parseFile(filePath, content, options);
          } else if (parser instanceof BaseParser) {
            const baseResult = await parser.parseFile(filePath, content, options);
            result = {
              ...baseResult,
              frameworkEntities: [],
              metadata: {
                framework: parserName,
                isFrameworkSpecific: false,
              }
            };
          } else {
            logger.warn(`Unsupported parser type: ${parserName}`);
            collectedErrors.push({
              message: `Unsupported parser type: ${parserName}`,
              line: 0,
              column: 0,
              severity: 'warning'
            });
            continue;
          }

          parseResults.push({ parser: parserName, result });

          // Set primary result (first framework parser or most comprehensive)
          if (!primaryResult || this.shouldBePrimary(parserName, result, primaryParser, primaryResult)) {
            primaryResult = result;
            primaryParser = parserName;
          }

        } catch (error) {
          const errorMessage = `Parser ${parserName} failed: ${error.message}`;
          logger.error(errorMessage, { filePath, error });
          collectedErrors.push({
            message: errorMessage,
            line: 0,
            column: 0,
            severity: 'error'
          });
        }
      }

      if (!primaryResult) {
        logger.error(`All parsers failed for file`, { filePath });
        const emptyResult = this.createEmptyResult(filePath, applicableParsers);

        // Add collected errors to the empty result
        if (collectedErrors.length > 0) {
          // If we have specific parser errors, use only those
          emptyResult.errors = collectedErrors;
        } else {
          // If no specific errors, keep the generic "All parsers failed" error
          emptyResult.errors.push(...collectedErrors);
        }

        emptyResult.parsers = applicableParsers; // Ensure we return the attempted parsers
        return emptyResult;
      }

      // Merge results from all parsers
      const mergedResult = this.mergeParseResults(primaryResult, parseResults, primaryParser);

      // Add any collected errors from failed parsers
      if (collectedErrors.length > 0) {
        mergedResult.errors.push(...collectedErrors);
      }

      return {
        ...mergedResult,
        parsers: applicableParsers,
        primaryParser
      };

    } catch (error) {
      logger.error(`Multi-parsing failed for file ${filePath}`, { error });
      // Use the parsers that were determined, or fall back to default parsers
      const fallbackParsers = applicableParsers.length > 0 ? applicableParsers : this.getDefaultParsers(filePath);
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
      logger.info(`Project framework detection completed`, {
        projectPath,
        frameworks: detectionResult.frameworks.map(f => `${f.name}@${f.version || 'unknown'}`),
        confidence: detectionResult.confidence
      });
    }

    // Parse all files
    const results: MultiParseResult[] = [];

    for (const file of files) {
      const options = {
        ...file.options,
        frameworkContext: {
          ...file.options?.frameworkContext,
          projectRoot: projectPath || file.options?.frameworkContext?.projectRoot
        }
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
        // Look for package.json as indicator of project root
        const packageJsonPath = path.join(currentDir, 'package.json');
        require('fs').accessSync(packageJsonPath);
        return currentDir;
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

    switch (ext) {
      case '.js':
      case '.mjs':
      case '.cjs':
        return ['javascript'];
      case '.ts':
      case '.mts':
      case '.cts':
        return ['typescript'];
      case '.jsx':
        return ['javascript', 'react'];
      case '.tsx':
        return ['typescript', 'react'];
      case '.vue':
        return ['vue'];
      default:
        return [];
    }
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
    return ['vue', 'nextjs', 'react', 'nodejs'].includes(parserName);
  }

  /**
   * Merge results from multiple parsers
   */
  private mergeParseResults(
    primaryResult: ParseFileResult,
    allResults: Array<{ parser: string; result: ParseFileResult }>,
    primaryParser: string
  ): ParseFileResult {
    const mergedResult = { ...primaryResult };

    // Collect all symbols, dependencies, imports, exports from all parsers
    const allSymbols = [...primaryResult.symbols];
    const allDependencies = [...primaryResult.dependencies];
    const allImports = [...primaryResult.imports];
    const allExports = [...primaryResult.exports];
    const allErrors = [...primaryResult.errors];
    const allFrameworkEntities = [...(primaryResult.frameworkEntities || [])];

    for (const { result } of allResults) {
      // Add unique symbols
      for (const symbol of result.symbols) {
        if (!allSymbols.some(s => this.symbolsEqual(s, symbol))) {
          allSymbols.push(symbol);
        }
      }

      // Add unique dependencies
      for (const dep of result.dependencies) {
        if (!allDependencies.some(d => this.dependenciesEqual(d, dep))) {
          allDependencies.push(dep);
        }
      }

      // Add unique imports
      for (const imp of result.imports) {
        if (!allImports.some(i => this.importsEqual(i, imp))) {
          allImports.push(imp);
        }
      }

      // Add unique exports
      for (const exp of result.exports) {
        if (!allExports.some(e => this.exportsEqual(e, exp))) {
          allExports.push(exp);
        }
      }

      // Add all errors
      allErrors.push(...result.errors);

      // Add framework entities (avoid duplicates)
      if (result.frameworkEntities) {
        for (const entity of result.frameworkEntities) {
          if (!allFrameworkEntities.some(e => this.frameworkEntitiesEqual(e, entity))) {
            allFrameworkEntities.push(entity);
          }
        }
      }
    }

    return {
      symbols: allSymbols,
      dependencies: allDependencies,
      imports: allImports,
      exports: allExports,
      errors: allErrors,
      frameworkEntities: allFrameworkEntities,
      metadata: {
        ...primaryResult.metadata
      }
    };
  }

  /**
   * Create empty result for failed parsing
   */
  private createEmptyResult(filePath: string, parsers: string[]): MultiParseResult {
    return {
      symbols: [],
      dependencies: [],
      imports: [],
      exports: [],
      errors: [{
        message: 'All parsers failed',
        line: 0,
        column: 0,
        severity: 'error'
      }],
      frameworkEntities: [],
      metadata: {
        framework: 'unknown',
        isFrameworkSpecific: false,
      },
      parsers,
      primaryParser: parsers[0] || 'unknown'
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

  /**
   * Efficient comparison methods for deduplication
   */
  private symbolsEqual(a: any, b: any): boolean {
    return a.name === b.name &&
           a.symbol_type === b.symbol_type &&
           a.start_line === b.start_line &&
           a.end_line === b.end_line;
  }

  private dependenciesEqual(a: any, b: any): boolean {
    return a.from_symbol === b.from_symbol &&
           a.to_symbol === b.to_symbol &&
           a.dependency_type === b.dependency_type &&
           a.line_number === b.line_number;
  }

  private importsEqual(a: any, b: any): boolean {
    return a.source === b.source &&
           a.import_type === b.import_type &&
           a.line_number === b.line_number &&
           a.is_dynamic === b.is_dynamic &&
           JSON.stringify(a.imported_names?.sort()) === JSON.stringify(b.imported_names?.sort());
  }

  private exportsEqual(a: any, b: any): boolean {
    return a.export_type === b.export_type &&
           a.source === b.source &&
           a.line_number === b.line_number &&
           JSON.stringify(a.exported_names?.sort()) === JSON.stringify(b.exported_names?.sort());
  }

  private frameworkEntitiesEqual(a: any, b: any): boolean {
    return a.type === b.type &&
           a.name === b.name &&
           a.filePath === b.filePath;
  }
}