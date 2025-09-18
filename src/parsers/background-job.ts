import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { BaseFrameworkParser, FrameworkParseOptions, ParseFileResult } from './base-framework';
import { MergedParseResult } from './chunked-parser';
import { ParsedSymbol, ParsedDependency, ParsedImport, ParsedExport, ParseResult, ParseOptions, ParseError, FrameworkEntity } from './base';
import { SymbolType, DependencyType, JobQueueType, WorkerType } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';

const logger = createComponentLogger('background-job-parser');

export interface JobQueue {
  name: string;
  queueType: JobQueueType;
  filePath: string;
  jobs: JobDefinition[];
  processors: JobProcessor[];
  config: JobQueueConfig;
}

export interface JobDefinition {
  name: string;
  jobType: 'scheduled' | 'triggered' | 'repeatable' | 'delayed';
  schedule?: string;
  retries?: number;
  timeout?: number;
  priority?: number;
  startLine: number;
  endLine: number;
  dependencies: string[];
}

export interface JobProcessor {
  name: string;
  queueName: string;
  concurrency?: number;
  filePath: string;
  startLine: number;
  endLine: number;
  handledJobs: string[];
}

export interface JobQueueConfig {
  redis?: {
    host?: string;
    port?: number;
    db?: number;
  };
  defaultJobOptions?: {
    removeOnComplete?: number;
    removeOnFail?: number;
    delay?: number;
    attempts?: number;
  };
}

export interface WorkerThread {
  name: string;
  filePath: string;
  threadFile?: string;
  data?: any;
  startLine: number;
  endLine: number;
  isMainThread: boolean;
}

/**
 * BackgroundJobParser analyzes background job systems in Node.js applications.
 * Supports Bull, BullMQ, Agenda, Bee-Queue, Kue, and Node.js Worker Threads.
 */
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

  async parseFile(filePath: string, content: string, options: FrameworkParseOptions = {}): Promise<ParseFileResult> {
    this.logger.debug('Parsing background job file', { filePath });

    // Check if this file contains job-related code
    if (!this.containsJobPatterns(content)) {
      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [],
        metadata: {
          framework: 'background-job',
          fileType: 'non-job',
          isFrameworkSpecific: false
        }
      };
    }

    // Check if chunking should be used for large files
    if (options.enableChunking !== false &&
        content.length > (options.chunkSize || 28 * 1024)) {
      // Use chunked parsing for large files
      const chunkedResult = await this.parseFileInChunks(filePath, content, options);
      // Convert MergedParseResult to ParseResult with framework entities
      const baseResult = this.convertMergedResult(chunkedResult);

      // Add framework-specific analysis to chunked result
      const frameworkEntities = this.analyzeFrameworkEntitiesFromResult(baseResult, content, filePath);

      const result: ParseFileResult = {
        ...baseResult,
        frameworkEntities,
        metadata: {
          framework: 'background-job',
          fileType: 'analyzed',
          isFrameworkSpecific: frameworkEntities.length > 0
        }
      };

      return this.addJobSpecificAnalysis(result, content, filePath);
    }

    // For small files or when chunking is disabled, use direct parsing
    const result = await this.parseFileDirectly(filePath, content, options);

    try {
      // Detect job systems used in this file
      const jobSystems = this.detectJobSystems(content);
      jobSystems.forEach(system => this.detectedJobSystems.add(system));

      // Add job-specific symbols and dependencies
      const jobSymbols = this.extractJobSymbols(filePath, content, jobSystems);
      const jobDependencies = this.extractJobDependencies(filePath, content);

      result.symbols.push(...jobSymbols);
      result.dependencies.push(...jobDependencies);

      // Create framework entities for job systems
      const frameworkEntities = this.createJobFrameworkEntities(filePath, jobSystems);

      return {
        ...result,
        frameworkEntities,
        metadata: {
          framework: 'background-job',
          fileType: 'job',
          isFrameworkSpecific: true
        }
      };

    } catch (error) {
      result.errors.push({
        message: `Background job analysis failed: ${(error as Error).message}`,
        line: 1,
        column: 1,
        severity: 'warning'
      });

      return {
        ...result,
        frameworkEntities: [],
        metadata: {
          framework: 'background-job',
          fileType: 'job',
          isFrameworkSpecific: true
        }
      };
    }
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract function declarations (job processors, job definitions)
    const functionNodes = this.findNodesOfType(rootNode, 'function_declaration');
    for (const node of functionNodes) {
      const symbol = this.extractFunctionSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract variable declarations (queue definitions)
    const variableNodes = this.findNodesOfType(rootNode, 'variable_declarator');
    for (const node of variableNodes) {
      const symbol = this.extractVariableSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    return symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract function calls (job enqueuing, processing)
    const callNodes = this.findNodesOfType(rootNode, 'call_expression');
    for (const node of callNodes) {
      const dependency = this.extractCallDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    return dependencies;
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Extract import statements
    const importNodes = this.findNodesOfType(rootNode, 'import_statement');
    for (const node of importNodes) {
      const importInfo = this.extractImportInfo(node, content);
      if (importInfo) imports.push(importInfo);
    }

    return imports;
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];

    // Extract export statements
    const exportNodes = this.findNodesOfType(rootNode, 'export_statement');
    for (const node of exportNodes) {
      const exportInfo = this.extractExportInfo(node, content);
      if (exportInfo) exports.push(exportInfo);
    }

    return exports;
  }

  /**
   * Check if content contains job-related patterns
   */
  private containsJobPatterns(content: string): boolean {
    const jobPatterns = [
      // Bull/BullMQ patterns
      /import.*bull/i,
      /require.*bull/i,
      /new Bull\(/,
      /new Queue\(/,
      /\.add\(/,
      /\.process\(/,
      /\.on\(['"]completed['"]|['"]failed['"]|['"]progress['"]\)/,

      // Agenda patterns
      /import.*agenda/i,
      /require.*agenda/i,
      /new Agenda\(/,
      /\.define\(/,
      /\.every\(/,
      /\.schedule\(/,
      /\.now\(/,
      /\.start\(/,

      // Worker threads patterns
      /worker_threads/,
      /new Worker\(/,
      /isMainThread/,
      /parentPort/,
      /workerData/,

      // Bee-Queue patterns
      /bee-queue/i,
      /new Queue\(/,

      // Kue patterns
      /import.*kue/i,
      /require.*kue/i,
      /kue\.createQueue/,

      // General job patterns
      /job.*queue/i,
      /background.*job/i,
      /task.*queue/i,
      /\.enqueue\(/,
      /\.dequeue\(/
    ];

    return jobPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Detect which job systems are used in this file
   */
  private detectJobSystems(content: string): (JobQueueType | WorkerType)[] {
    const systems: (JobQueueType | WorkerType)[] = [];

    // Bull/BullMQ
    if (/import.*bull|require.*bull|new Bull\(|new Queue\(/i.test(content)) {
      if (content.includes('bullmq') || content.includes('bull-mq')) {
        systems.push(JobQueueType.BULLMQ);
      } else {
        systems.push(JobQueueType.BULL);
      }
    }

    // Agenda
    if (/import.*agenda|require.*agenda|new Agenda\(/i.test(content)) {
      systems.push(JobQueueType.AGENDA);
    }

    // Bee-Queue
    if (/bee-queue/i.test(content)) {
      systems.push(JobQueueType.BEE);
    }

    // Kue
    if (/import.*kue|require.*kue|kue\.createQueue/i.test(content)) {
      systems.push(JobQueueType.KUE);
    }

    // Worker Threads
    if (/worker_threads|new Worker\(|isMainThread|parentPort|workerData/.test(content)) {
      systems.push(WorkerType.WORKER_THREADS);
    }

    return systems;
  }

  /**
   * Extract job-specific symbols
   */
  private extractJobSymbols(filePath: string, content: string, jobSystems: (JobQueueType | WorkerType)[]): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    if (jobSystems.length === 0) return symbols;

    // Skip detailed analysis for large files to avoid Tree-sitter limits
    if (content.length > 28000) {
      logger.debug('Skipping background job symbol extraction for large file', {
        filePath,
        contentSize: content.length
      });
      return symbols;
    }

    const tree = this.parseContent(content);
    if (!tree) return symbols;

    // Extract queue definitions
    const queueSymbols = this.extractQueueDefinitions(tree, content, jobSystems);
    symbols.push(...queueSymbols);

    // Extract job definitions
    const jobSymbols = this.extractJobDefinitions(tree, content, jobSystems);
    symbols.push(...jobSymbols);

    // Extract processors
    const processorSymbols = this.extractJobProcessors(tree, content, jobSystems);
    symbols.push(...processorSymbols);

    // Extract worker threads
    const workerSymbols = this.extractWorkerThreads(tree, content);
    symbols.push(...workerSymbols);

    return symbols;
  }

  /**
   * Extract job-specific dependencies
   */
  private extractJobDependencies(filePath: string, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Skip detailed analysis for large files to avoid Tree-sitter limits
    if (content.length > 28000) {
      logger.debug('Skipping background job dependency extraction for large file', {
        filePath,
        contentSize: content.length
      });
      return dependencies;
    }

    const tree = this.parseContent(content);
    if (!tree) return dependencies;

    // Look for job processing relationships
    const callNodes = this.findNodesOfType(tree.rootNode, 'call_expression');
    for (const node of callNodes) {
      const dependency = this.extractJobCallDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    return dependencies;
  }

  /**
   * Extract queue definitions
   */
  private extractQueueDefinitions(tree: Parser.Tree, content: string, jobSystems: (JobQueueType | WorkerType)[]): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    const variableNodes = this.findNodesOfType(tree.rootNode, 'variable_declarator');
    for (const node of variableNodes) {
      const queueSymbol = this.extractQueueSymbol(node, content, jobSystems);
      if (queueSymbol) symbols.push(queueSymbol);
    }

    return symbols;
  }

  /**
   * Extract job definitions
   */
  private extractJobDefinitions(tree: Parser.Tree, content: string, jobSystems: (JobQueueType | WorkerType)[]): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    const callNodes = this.findNodesOfType(tree.rootNode, 'call_expression');
    for (const node of callNodes) {
      const jobSymbol = this.extractJobDefinitionSymbol(node, content);
      if (jobSymbol) symbols.push(jobSymbol);
    }

    return symbols;
  }

  /**
   * Extract job processors
   */
  private extractJobProcessors(tree: Parser.Tree, content: string, jobSystems: (JobQueueType | WorkerType)[]): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    const callNodes = this.findNodesOfType(tree.rootNode, 'call_expression');
    for (const node of callNodes) {
      const processorSymbol = this.extractProcessorSymbol(node, content);
      if (processorSymbol) symbols.push(processorSymbol);
    }

    return symbols;
  }

  /**
   * Extract worker threads
   */
  private extractWorkerThreads(tree: Parser.Tree, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    const callNodes = this.findNodesOfType(tree.rootNode, 'call_expression');
    for (const node of callNodes) {
      const workerSymbol = this.extractWorkerThreadSymbol(node, content);
      if (workerSymbol) symbols.push(workerSymbol);
    }

    return symbols;
  }

  /**
   * Extract queue symbol from variable declaration
   */
  private extractQueueSymbol(node: Parser.SyntaxNode, content: string, jobSystems: (JobQueueType | WorkerType)[]): ParsedSymbol | null {
    const nameNode = node.children.find(child => child.type === 'identifier');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    // Check if this looks like a queue definition
    const initNode = node.children.find(child => child.type === 'call_expression');
    if (!initNode) return null;

    const initText = this.getNodeText(initNode, content);
    if (!/new\s+(Bull|Queue|Agenda)/i.test(initText)) return null;

    return {
      name,
      symbol_type: SymbolType.JOB_QUEUE,
      start_line: this.getLineNumber(node.startIndex, content),
      end_line: this.getLineNumber(node.endIndex, content),
      is_exported: false,
      signature: `Queue: ${name}`
    };
  }

  /**
   * Extract job definition symbol
   */
  private extractJobDefinitionSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const functionName = this.getFunctionNameFromCall(node, content);
    if (!functionName) return null;

    // Look for job definition patterns
    if (!['add', 'define', 'every', 'schedule', 'now'].includes(functionName)) {
      return null;
    }

    const args = this.getCallArguments(node);
    if (args.length === 0) return null;

    const jobName = this.getStringLiteral(args[0], content);
    if (!jobName) return null;

    return {
      name: jobName,
      symbol_type: SymbolType.JOB_DEFINITION,
      start_line: this.getLineNumber(node.startIndex, content),
      end_line: this.getLineNumber(node.endIndex, content),
      is_exported: false,
      signature: `Job: ${jobName} (${functionName})`
    };
  }

  /**
   * Extract processor symbol
   */
  private extractProcessorSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const functionName = this.getFunctionNameFromCall(node, content);
    if (!functionName || functionName !== 'process') return null;

    const args = this.getCallArguments(node);
    if (args.length === 0) return null;

    const jobType = this.getStringLiteral(args[0], content);
    const processorName = jobType ? `${jobType}_processor` : 'job_processor';

    return {
      name: processorName,
      symbol_type: SymbolType.FUNCTION,
      start_line: this.getLineNumber(node.startIndex, content),
      end_line: this.getLineNumber(node.endIndex, content),
      is_exported: false,
      signature: `Processor: ${processorName}`
    };
  }

  /**
   * Extract worker thread symbol
   */
  private extractWorkerThreadSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const initText = this.getNodeText(node, content);
    if (!initText.includes('new Worker(')) return null;

    const args = this.getCallArguments(node);
    if (args.length === 0) return null;

    const workerFile = this.getStringLiteral(args[0], content);
    const workerName = workerFile ? path.basename(workerFile, path.extname(workerFile)) : 'worker';

    return {
      name: `${workerName}_thread`,
      symbol_type: SymbolType.WORKER_THREAD,
      start_line: this.getLineNumber(node.startIndex, content),
      end_line: this.getLineNumber(node.endIndex, content),
      is_exported: false,
      signature: `Worker: ${workerName}`
    };
  }

  /**
   * Extract job call dependency
   */
  private extractJobCallDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const functionName = this.getFunctionNameFromCall(node, content);
    if (!functionName) return null;

    // Job processing dependencies
    if (['add', 'process', 'define', 'every', 'schedule'].includes(functionName)) {
      const args = this.getCallArguments(node);
      if (args.length > 0) {
        const targetJob = this.getStringLiteral(args[0], content);
        if (targetJob) {
          return {
            from_symbol: 'current_context',
            to_symbol: targetJob,
            dependency_type: DependencyType.PROCESSES_JOB,
            line_number: this.getLineNumber(node.startIndex, content),
            confidence: 0.9
          };
        }
      }
    }

    return null;
  }

  /**
   * Create framework entities for job systems
   */
  private createJobFrameworkEntities(filePath: string, jobSystems: (JobQueueType | WorkerType)[]): FrameworkEntity[] {
    const entities: FrameworkEntity[] = [];

    if (jobSystems.length === 0) return entities;

    const fileName = path.basename(filePath, path.extname(filePath));

    // Create a job system entity
    entities.push({
      type: 'job_system',
      name: fileName,
      filePath,
      metadata: {
        jobSystems,
        queues: this.jobQueues.filter(q => q.filePath === filePath),
        workers: this.workerThreads.filter(w => w.filePath === filePath),
        detectedAt: new Date().toISOString()
      }
    });

    return entities;
  }

  // Helper methods

  private getFunctionNameFromCall(node: Parser.SyntaxNode, content: string): string | null {
    if (node.type !== 'call_expression') return null;
    const functionNode = node.children.find(child =>
      child.type === 'identifier' || child.type === 'member_expression'
    );
    if (!functionNode) return null;

    const fullName = this.getNodeText(functionNode, content);
    // Extract method name from member expressions like 'queue.add'
    const parts = fullName.split('.');
    return parts[parts.length - 1];
  }

  private getCallArguments(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const argumentsNode = node.children.find(child => child.type === 'arguments');
    if (!argumentsNode) return [];
    return argumentsNode.children.filter(child =>
      child.type !== '(' && child.type !== ')' && child.type !== ','
    );
  }

  private getStringLiteral(node: Parser.SyntaxNode, content: string): string | null {
    if (node.type !== 'string') return null;
    const text = this.getNodeText(node, content);
    return text.slice(1, -1); // Remove quotes
  }

  protected extractFunctionSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.children.find(child => child.type === 'identifier');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    return {
      name,
      symbol_type: SymbolType.FUNCTION,
      start_line: this.getLineNumber(node.startIndex, content),
      end_line: this.getLineNumber(node.endIndex, content),
      is_exported: false,
      signature: `function ${name}(...)`
    };
  }

  protected extractVariableSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.children.find(child => child.type === 'identifier');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    return {
      name,
      symbol_type: SymbolType.VARIABLE,
      start_line: this.getLineNumber(node.startIndex, content),
      end_line: this.getLineNumber(node.endIndex, content),
      is_exported: false,
      signature: `var ${name}`
    };
  }

  protected extractCallDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const functionName = this.getFunctionNameFromCall(node, content);
    if (!functionName) return null;

    return {
      from_symbol: 'current_function',
      to_symbol: functionName,
      dependency_type: DependencyType.CALLS,
      line_number: this.getLineNumber(node.startIndex, content),
      confidence: 0.9
    };
  }

  private extractImportInfo(node: Parser.SyntaxNode, content: string): any {
    // Simplified import extraction
    return {
      source: 'unknown',
      imported_names: [],
      import_type: 'named',
      line_number: this.getLineNumber(node.startIndex, content),
      is_dynamic: false
    };
  }

  private extractExportInfo(node: Parser.SyntaxNode, content: string): any {
    // Simplified export extraction
    return {
      exported_names: [],
      export_type: 'named',
      line_number: this.getLineNumber(node.startIndex, content)
    };
  }

  // Required abstract method implementations

  /**
   * Detect framework entities (job queues, job definitions, workers)
   */
  public async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<{ entities: FrameworkEntity[] }> {
    const entities: FrameworkEntity[] = [];

    if (!this.containsJobPatterns(content)) {
      return { entities };
    }

    const jobSystems = this.detectJobSystems(content);
    if (jobSystems.length > 0) {
      entities.push(...this.createJobFrameworkEntities(filePath, jobSystems));
    }

    return { entities };
  }

  /**
   * Get job system detection patterns
   */
  getFrameworkPatterns(): any[] {
    return [
      {
        name: 'bull-queue',
        pattern: /import.*bull|require.*bull|new Bull\(|new Queue\(/i,
        fileExtensions: ['.js', '.ts'],
        priority: 10
      },
      {
        name: 'agenda-jobs',
        pattern: /import.*agenda|require.*agenda|new Agenda\(/i,
        fileExtensions: ['.js', '.ts'],
        priority: 9
      },
      {
        name: 'worker-threads',
        pattern: /worker_threads|new Worker\(|isMainThread|parentPort/,
        fileExtensions: ['.js', '.ts'],
        priority: 8
      },
      {
        name: 'bee-queue',
        pattern: /bee-queue/i,
        fileExtensions: ['.js', '.ts'],
        priority: 7
      },
      {
        name: 'kue-jobs',
        pattern: /import.*kue|require.*kue|kue\.createQueue/i,
        fileExtensions: ['.js', '.ts'],
        priority: 6
      }
    ];
  }

  /**
   * Get chunk boundaries for large job files
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const lines = content.split('\n');
    const boundaries: number[] = [0];
    let currentSize = 0;
    let currentPos = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineSize = lines[i].length + 1;

      if (currentSize + lineSize > maxChunkSize && currentSize > 0) {
        // Try to break at job/queue boundaries
        const line = lines[i];
        if (/^\s*(queue\.|\.define\(|\.process\(|\.add\()/.test(line)) {
          boundaries.push(currentPos);
          currentSize = lineSize;
        } else {
          currentSize += lineSize;
        }
      } else {
        currentSize += lineSize;
      }

      currentPos += lineSize;
    }

    if (boundaries[boundaries.length - 1] !== currentPos) {
      boundaries.push(currentPos);
    }

    return boundaries;
  }

  /**
   * Merge results from multiple chunks
   */
  protected mergeChunkResults(chunks: ParseResult[], chunkMetadata: any[]): any {
    const merged = {
      symbols: [] as ParsedSymbol[],
      dependencies: [] as ParsedDependency[],
      imports: [] as any[],
      exports: [] as any[],
      errors: [] as ParseError[],
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunks.length,
        duplicatesRemoved: 0,
        crossChunkReferencesFound: 0
      }
    };

    const seenSymbols = new Set<string>();
    const seenDependencies = new Set<string>();

    for (const chunk of chunks) {
      // Merge symbols, avoiding duplicates
      for (const symbol of chunk.symbols) {
        const key = `${symbol.name}:${symbol.start_line}`;
        if (!seenSymbols.has(key)) {
          seenSymbols.add(key);
          merged.symbols.push(symbol);
        } else {
          merged.metadata.duplicatesRemoved++;
        }
      }

      // Merge dependencies, avoiding duplicates
      for (const dep of chunk.dependencies) {
        const key = `${dep.from_symbol}:${dep.to_symbol}:${dep.line_number}`;
        if (!seenDependencies.has(key)) {
          seenDependencies.add(key);
          merged.dependencies.push(dep);
        } else {
          merged.metadata.duplicatesRemoved++;
        }
      }

      merged.imports.push(...chunk.imports);
      merged.exports.push(...chunk.exports);
      merged.errors.push(...chunk.errors);
    }

    return merged;
  }

  /**
   * Get job queues
   */
  getJobQueues(): JobQueue[] {
    return this.jobQueues;
  }

  /**
   * Get worker threads
   */
  getWorkerThreads(): WorkerThread[] {
    return this.workerThreads;
  }

  /**
   * Get detected job systems
   */
  getDetectedJobSystems(): (JobQueueType | WorkerType)[] {
    return Array.from(this.detectedJobSystems);
  }

  /**
   * Clear parser state
   */
  clearState(): void {
    this.jobQueues = [];
    this.workerThreads = [];
    this.detectedJobSystems.clear();
  }

  /**
   * Convert MergedParseResult from chunked parsing to ParseResult
   */
  private convertMergedResult(mergedResult: MergedParseResult): ParseResult {
    return {
      symbols: mergedResult.symbols,
      dependencies: mergedResult.dependencies,
      imports: mergedResult.imports,
      exports: mergedResult.exports,
      errors: mergedResult.errors
    };
  }

  /**
   * Analyze framework entities from already-parsed results
   */
  private analyzeFrameworkEntitiesFromResult(result: ParseResult, content: string, filePath: string): FrameworkEntity[] {
    try {
      // Framework-specific analysis based on symbols found by base parsing
      const jobSystems = this.detectJobSystems(content);
      return this.createJobFrameworkEntities(filePath, jobSystems);
    } catch (error) {
      this.logger.warn('Failed to analyze framework entities from parsed result', {
        filePath,
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * Add job-specific analysis to parsed results
   */
  private addJobSpecificAnalysis(result: ParseFileResult, content: string, filePath: string): ParseFileResult {
    try {
      // Detect job systems used in this file
      const jobSystems = this.detectJobSystems(content);
      jobSystems.forEach(system => this.detectedJobSystems.add(system));

      // Add job-specific symbols and dependencies
      const jobSymbols = this.extractJobSymbols(filePath, content, jobSystems);
      const jobDependencies = this.extractJobDependencies(filePath, content);

      result.symbols.push(...jobSymbols);
      result.dependencies.push(...jobDependencies);

      // Update framework entities if needed
      if (!result.frameworkEntities) {
        result.frameworkEntities = [];
      }
      const jobEntities = this.createJobFrameworkEntities(filePath, jobSystems);
      result.frameworkEntities.push(...jobEntities);

      // Update metadata
      result.metadata = {
        ...result.metadata,
        framework: 'background-job',
        fileType: 'job',
        isFrameworkSpecific: true
      };

      return result;
    } catch (error) {
      result.errors.push({
        message: `Background job analysis failed: ${(error as Error).message}`,
        line: 0,
        column: 0,
        severity: 'error'
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          framework: 'background-job',
          fileType: 'error',
          isFrameworkSpecific: false
        }
      };
    }
  }
}