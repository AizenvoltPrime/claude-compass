import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { BaseFrameworkParser, FrameworkParseOptions, ParseFileResult } from '../base-framework';
import { MergedParseResult } from '../chunked-parser';
import {
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
  FrameworkEntity,
} from '../base';
import { JobQueueType, WorkerType } from '../../database/models';
import { createComponentLogger } from '../../utils/logger';
import { JobQueue, WorkerThread } from './types';
import * as DetectionPatterns from './detection-patterns';
import * as SymbolExtractors from './symbol-extractors';
import * as DependencyExtractors from './dependency-extractors';
import * as FrameworkEntityUtils from './framework-entity-utils';
import * as ChunkingUtils from './chunking-utils';
import * as AstHelpers from './ast-helper-utils';

const logger = createComponentLogger('background-job-parser');

export class BackgroundJobParser extends BaseFrameworkParser {
  private jobQueues: JobQueue[] = [];
  private workerThreads: WorkerThread[] = [];
  private detectedJobSystems: Set<JobQueueType | WorkerType> = new Set();

  constructor() {
    const parser = new Parser();
    parser.setLanguage(JavaScript);
    super(parser, 'background-job');
  }

  getSupportedExtensions(): string[] {
    return ['.js', '.ts', '.jsx', '.tsx'];
  }

  async parseFile(
    filePath: string,
    content: string,
    options: FrameworkParseOptions = {}
  ): Promise<ParseFileResult> {
    // Check if this file contains job-related code
    if (!DetectionPatterns.containsJobPatterns(content)) {
      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [],
        metadata: {
          framework: 'background-job',
          fileType: 'non-job',
          isFrameworkSpecific: false,
        },
      };
    }

    // Check if chunking should be used for large files
    if (options.enableChunking !== false && content.length > (options.chunkSize || 28 * 1024)) {
      // Use chunked parsing for large files
      const chunkedResult = await this.parseFileInChunks(filePath, content, options);
      const baseResult = this.convertMergedResult(chunkedResult);

      // Add framework-specific analysis to chunked result
      const frameworkEntities = FrameworkEntityUtils.analyzeFrameworkEntitiesFromResult(
        baseResult,
        content,
        filePath,
        DetectionPatterns.detectJobSystems,
        this.jobQueues,
        this.workerThreads
      );

      const result: ParseFileResult = {
        filePath,
        ...baseResult,
        frameworkEntities,
        metadata: {
          framework: 'background-job',
          fileType: 'analyzed',
          isFrameworkSpecific: frameworkEntities.length > 0,
        },
      };

      return this.addJobSpecificAnalysis(result, content, filePath);
    }

    // For small files or when chunking is disabled, use direct parsing
    const result = await this.parseFileDirectly(filePath, content, options);

    try {
      // Detect job systems used in this file
      const jobSystems = DetectionPatterns.detectJobSystems(content);
      jobSystems.forEach(system => this.detectedJobSystems.add(system));

      // Add job-specific symbols and dependencies
      const jobSymbols = SymbolExtractors.extractJobSymbols(
        filePath,
        content,
        jobSystems,
        this.parseContent.bind(this),
        this.findNodesOfType.bind(this)
      );
      const jobDependencies = DependencyExtractors.extractJobDependencies(
        filePath,
        content,
        this.parseContent.bind(this),
        this.findNodesOfType.bind(this)
      );

      result.symbols.push(...jobSymbols);
      result.dependencies.push(...jobDependencies);

      // Create framework entities for job systems
      const frameworkEntities = FrameworkEntityUtils.createJobFrameworkEntities(
        filePath,
        jobSystems,
        this.jobQueues,
        this.workerThreads
      );

      return {
        filePath,
        ...result,
        frameworkEntities,
        metadata: {
          framework: 'background-job',
          fileType: 'job',
          isFrameworkSpecific: true,
        },
      };
    } catch (error) {
      result.errors.push({
        message: `Background job analysis failed: ${(error as Error).message}`,
        line: 1,
        column: 1,
        severity: 'warning',
      });

      return {
        filePath,
        ...result,
        frameworkEntities: [],
        metadata: {
          framework: 'background-job',
          fileType: 'job',
          isFrameworkSpecific: true,
        },
      };
    }
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract function declarations (job processors, job definitions)
    const functionNodes = this.findNodesOfType(rootNode, 'function_declaration');
    for (const node of functionNodes) {
      const symbol = AstHelpers.extractFunctionSymbol(
        node,
        content,
        AstHelpers.getNodeText,
        AstHelpers.getLineNumber
      );
      if (symbol) symbols.push(symbol);
    }

    // Extract variable declarations (queue definitions)
    const variableNodes = this.findNodesOfType(rootNode, 'variable_declarator');
    for (const node of variableNodes) {
      const symbol = AstHelpers.extractVariableSymbol(
        node,
        content,
        AstHelpers.getNodeText,
        AstHelpers.getLineNumber
      );
      if (symbol) symbols.push(symbol);
    }

    return symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract function calls (job enqueuing, processing)
    const callNodes = this.findNodesOfType(rootNode, 'call_expression');
    for (const node of callNodes) {
      const dependency = AstHelpers.extractCallDependency(
        node,
        content,
        AstHelpers.getFunctionNameFromCall,
        AstHelpers.getLineNumber
      );
      if (dependency) dependencies.push(dependency);
    }

    return dependencies;
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Extract import statements
    const importNodes = this.findNodesOfType(rootNode, 'import_statement');
    for (const node of importNodes) {
      const importInfo = AstHelpers.extractImportInfo(node, content, AstHelpers.getLineNumber);
      if (importInfo) imports.push(importInfo);
    }

    return imports;
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];

    // Extract export statements
    const exportNodes = this.findNodesOfType(rootNode, 'export_statement');
    for (const node of exportNodes) {
      const exportInfo = AstHelpers.extractExportInfo(node, content, AstHelpers.getLineNumber);
      if (exportInfo) exports.push(exportInfo);
    }

    return exports;
  }

  public async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<{ entities: FrameworkEntity[] }> {
    const entities: FrameworkEntity[] = [];

    if (!DetectionPatterns.containsJobPatterns(content)) {
      return { entities };
    }

    const jobSystems = DetectionPatterns.detectJobSystems(content);
    if (jobSystems.length > 0) {
      entities.push(
        ...FrameworkEntityUtils.createJobFrameworkEntities(
          filePath,
          jobSystems,
          this.jobQueues,
          this.workerThreads
        )
      );
    }

    return { entities };
  }

  getFrameworkPatterns(): any[] {
    return DetectionPatterns.getFrameworkPatterns();
  }

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    return ChunkingUtils.getChunkBoundaries(content, maxChunkSize);
  }

  protected mergeChunkResults(chunks: ParseResult[], chunkMetadata: any[]): any {
    return ChunkingUtils.mergeChunkResults(chunks, chunkMetadata);
  }

  getJobQueues(): JobQueue[] {
    return this.jobQueues;
  }

  getWorkerThreads(): WorkerThread[] {
    return this.workerThreads;
  }

  getDetectedJobSystems(): (JobQueueType | WorkerType)[] {
    return Array.from(this.detectedJobSystems);
  }

  clearState(): void {
    this.jobQueues = [];
    this.workerThreads = [];
    this.detectedJobSystems.clear();
  }

  private convertMergedResult(mergedResult: MergedParseResult): ParseResult {
    return {
      symbols: mergedResult.symbols,
      dependencies: mergedResult.dependencies,
      imports: mergedResult.imports,
      exports: mergedResult.exports,
      errors: mergedResult.errors,
    };
  }

  private addJobSpecificAnalysis(
    result: ParseFileResult,
    content: string,
    filePath: string
  ): ParseFileResult {
    try {
      // Detect job systems used in this file
      const jobSystems = DetectionPatterns.detectJobSystems(content);
      jobSystems.forEach(system => this.detectedJobSystems.add(system));

      // Add job-specific symbols and dependencies
      const jobSymbols = SymbolExtractors.extractJobSymbols(
        filePath,
        content,
        jobSystems,
        this.parseContent.bind(this),
        this.findNodesOfType.bind(this)
      );
      const jobDependencies = DependencyExtractors.extractJobDependencies(
        filePath,
        content,
        this.parseContent.bind(this),
        this.findNodesOfType.bind(this)
      );

      result.symbols.push(...jobSymbols);
      result.dependencies.push(...jobDependencies);

      // Update framework entities if needed
      if (!result.frameworkEntities) {
        result.frameworkEntities = [];
      }
      const jobEntities = FrameworkEntityUtils.createJobFrameworkEntities(
        filePath,
        jobSystems,
        this.jobQueues,
        this.workerThreads
      );
      result.frameworkEntities.push(...jobEntities);

      // Update metadata
      result.metadata = {
        ...result.metadata,
        framework: 'background-job',
        fileType: 'job',
        isFrameworkSpecific: true,
      };

      return result;
    } catch (error) {
      result.errors.push({
        message: `Background job analysis failed: ${(error as Error).message}`,
        line: 0,
        column: 0,
        severity: 'error',
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          framework: 'background-job',
          fileType: 'error',
          isFrameworkSpecific: false,
        },
      };
    }
  }
}

export * from './types';
