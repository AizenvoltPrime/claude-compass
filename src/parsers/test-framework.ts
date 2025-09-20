import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { BaseFrameworkParser, FrameworkParseOptions, ParseFileResult } from './base-framework';
import { MergedParseResult } from './chunked-parser';
import { ParsedSymbol, ParsedDependency, ParsedImport, ParsedExport, ParseResult, ParseOptions, ParseError, FrameworkEntity } from './base';
import { SymbolType, DependencyType, TestFrameworkType } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';

const logger = createComponentLogger('test-framework-parser');

export interface TestSuite {
  name: string;
  filePath: string;
  framework: TestFrameworkType;
  testCases: TestCase[];
  setupMethods: string[];
  teardownMethods: string[];
  mocks: MockDefinition[];
  testedModules: string[];
}

export interface TestCase {
  name: string;
  suite: string;
  testType: 'unit' | 'integration' | 'e2e';
  startLine: number;
  endLine: number;
  assertions: string[];
  dependencies: string[];
}

export interface MockDefinition {
  targetModule: string;
  mockType: 'jest' | 'vitest' | 'sinon' | 'custom';
  mockMethods: string[];
  startLine: number;
}

export interface TestCoverage {
  testFile: string;
  targetFile: string;
  coverage_type: 'unit' | 'integration' | 'e2e';
  confidence: number;
}

/**
 * TestFrameworkParser identifies and analyzes test frameworks in JavaScript/TypeScript projects.
 * Supports Jest, Vitest, Cypress, Playwright and extracts test-to-code relationships.
 */
export class TestFrameworkParser extends BaseFrameworkParser {
  private testSuites: TestSuite[] = [];
  private testCoverages: TestCoverage[] = [];
  private detectedFrameworks: Set<TestFrameworkType> = new Set();

  constructor() {
    const parser = new Parser();
    parser.setLanguage(JavaScript);
    super(parser, 'test-framework');
  }

  getSupportedExtensions(): string[] {
    return ['.test.js', '.test.ts', '.spec.js', '.spec.ts', '.test.jsx', '.test.tsx', '.spec.jsx', '.spec.tsx', '.e2e.js', '.e2e.ts'];
  }

  async parseFile(filePath: string, content: string, options: FrameworkParseOptions = {}): Promise<ParseFileResult> {

    // Check if this is a test file
    if (!this.isTestFile(filePath)) {
      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [],
        frameworkEntities: [],
        metadata: {
          framework: 'test-framework',
          fileType: 'non-test',
          isFrameworkSpecific: false
        }
      };
    }

    // Check if chunked parsing is needed for large files (force chunking for large files regardless of options)
    const forceChunkingOptions = { ...options, enableChunking: true };
    if (this.shouldUseChunking(content, forceChunkingOptions)) {
      this.logger.debug(`Using chunked parsing for large test file`, { filePath, size: content.length });
      // Use chunked parsing for large files
      const chunkedResult = await this.parseFileInChunks(filePath, content, options);
      // Convert MergedParseResult to ParseResult with framework entities
      const baseResult = this.convertMergedResult(chunkedResult);

      // Add framework-specific analysis to chunked result
      const frameworkEntities = this.analyzeFrameworkEntitiesFromResult(baseResult, content, filePath);

      const result: ParseFileResult = {
        filePath,
        ...baseResult,
        frameworkEntities,
        metadata: {
          framework: 'test-framework',
          fileType: 'analyzed',
          isFrameworkSpecific: frameworkEntities.length > 0
        }
      };

      return this.addTestSpecificAnalysis(result, content, filePath);
    }

    // For small files or when chunking is disabled, use direct parsing
    const result = await this.parseFileDirectly(filePath, content, options);

    // Add test-specific analysis
    try {
      // Detect test framework(s) used in this file
      const frameworks = this.detectTestFrameworks(content, filePath);
      frameworks.forEach(framework => this.detectedFrameworks.add(framework));

      // Add additional test-specific symbols and dependencies
      const testSymbols = this.extractTestSymbols(filePath, content, frameworks);
      const testDependencies = this.extractTestDependencies(filePath, content);

      result.symbols.push(...testSymbols);
      result.dependencies.push(...testDependencies);

      // Create framework entities for test frameworks
      const frameworkEntities = this.createTestFrameworkEntities(filePath, frameworks);

      return {
        filePath,
        ...result,
        frameworkEntities,
        metadata: {
          framework: 'test-framework',
          fileType: 'test',
          isFrameworkSpecific: true
        }
      };

    } catch (error) {
      result.errors.push({
        message: `Test framework analysis failed: ${(error as Error).message}`,
        line: 1,
        column: 1,
        severity: 'warning'
      });

      return {
        filePath,
        ...result,
        frameworkEntities: [],
        metadata: {
          framework: 'test-framework',
          fileType: 'test',
          isFrameworkSpecific: true
        }
      };
    }
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract function declarations (standard JavaScript symbols)
    const functionNodes = this.findNodesOfType(rootNode, 'function_declaration');
    for (const node of functionNodes) {
      const symbol = this.extractFunctionSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract variable declarations
    const variableNodes = this.findNodesOfType(rootNode, 'variable_declarator');
    for (const node of variableNodes) {
      const symbol = this.extractVariableSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    return symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract function calls
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
   * Extract test-specific symbols like test suites and test cases
   */
  private extractTestSymbols(filePath: string, content: string, frameworks: TestFrameworkType[]): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    if (frameworks.length === 0) return symbols;

    // Skip detailed analysis for large test files to avoid Tree-sitter limits
    if (content.length > 28000) {
      logger.debug('Skipping test symbol extraction for large file', {
        filePath,
        contentSize: content.length
      });
      return symbols;
    }

    const tree = this.parseContent(content);
    if (!tree) return symbols;

    try {
      // Create test suite symbol
      const testSuiteName = path.basename(filePath, path.extname(filePath));
      symbols.push({
        name: testSuiteName,
        symbol_type: SymbolType.TEST_SUITE,
        start_line: 1,
        end_line: content.split('\n').length,
        is_exported: false,
        signature: `Test Suite: ${testSuiteName} (${frameworks.join(', ')})`
      });

      // Extract test cases
      const callNodes = this.findNodesOfType(tree.rootNode, 'call_expression');
      for (const node of callNodes) {
        const testCase = this.extractTestCaseSymbol(node, content);
        if (testCase) symbols.push(testCase);
      }

      return symbols;
    } finally {
      // Tree-sitter trees are automatically garbage collected in Node.js
      // No explicit disposal needed
    }
  }

  /**
   * Extract test-specific dependencies
   */
  private extractTestDependencies(filePath: string, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Skip detailed analysis for large test files to avoid Tree-sitter limits
    if (content.length > 28000) {
      logger.debug('Skipping test dependency extraction for large file', {
        filePath,
        contentSize: content.length
      });
      return dependencies;
    }

    const tree = this.parseContent(content);
    if (!tree) return dependencies;

    try {
      // Look for test coverage relationships
      const testSuiteName = path.basename(filePath, path.extname(filePath));

      // Extract import dependencies to understand what's being tested
      const importNodes = this.findNodesOfType(tree.rootNode, 'import_statement');
      for (const node of importNodes) {
        const dependency = this.extractTestCoverageDependency(node, content, testSuiteName);
        if (dependency) dependencies.push(dependency);
      }

      return dependencies;
    } finally {
      // Tree-sitter trees are automatically garbage collected in Node.js
      // No explicit disposal needed
    }
  }

  /**
   * Extract test case symbols from call expressions
   */
  private extractTestCaseSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const functionName = this.getFunctionNameFromCall(node, content);
    if (!functionName || !this.isTestFunction(functionName)) {
      return null;
    }

    const args = this.getCallArguments(node);
    if (args.length === 0) return null;

    const testName = this.getStringLiteral(args[0], content);
    if (!testName) return null;

    return {
      name: testName,
      symbol_type: SymbolType.TEST_CASE,
      start_line: this.getLineNumber(node.startIndex, content),
      end_line: this.getLineNumber(node.endIndex, content),
      is_exported: false,
      signature: `${functionName}("${testName}")`
    };
  }

  /**
   * Extract test coverage dependency from import statement
   */
  private extractTestCoverageDependency(node: Parser.SyntaxNode, content: string, testSuiteName: string): ParsedDependency | null {
    const source = this.getImportSource(node, content);
    if (!source || this.isTestFrameworkImport(source)) {
      return null;
    }

    return {
      from_symbol: testSuiteName,
      to_symbol: source,
      dependency_type: DependencyType.TEST_COVERS,
      line_number: this.getLineNumber(node.startIndex, content),
      confidence: 0.8
    };
  }

  /**
   * Check if file is a test file based on naming patterns and content
   */
  private isTestFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const testPatterns = [
      /\.test\.(js|ts|jsx|tsx)$/,
      /\.spec\.(js|ts|jsx|tsx)$/,
      /\.e2e\.(js|ts)$/,
      /\.integration\.(js|ts)$/
    ];

    // Check file name patterns
    if (testPatterns.some(pattern => pattern.test(fileName))) {
      return true;
    }

    // Check directory patterns
    const normalizedPath = filePath.replace(/\\/g, '/');
    const testDirectories = [
      '/tests/',
      '/test/',
      '/__tests__/',
      '/cypress/',
      '/e2e/',
      '/integration/',
      '/specs/'
    ];

    return testDirectories.some(dir => normalizedPath.includes(dir));
  }

  /**
   * Detect which test frameworks are used in this file
   */
  private detectTestFrameworks(content: string, filePath: string): TestFrameworkType[] {
    const frameworks: TestFrameworkType[] = [];

    // Jest patterns
    if (this.containsJestPatterns(content)) {
      frameworks.push(TestFrameworkType.JEST);
    }

    // Vitest patterns
    if (this.containsVitestPatterns(content)) {
      frameworks.push(TestFrameworkType.VITEST);
    }

    // Cypress patterns
    if (this.containsCypressPatterns(content, filePath)) {
      frameworks.push(TestFrameworkType.CYPRESS);
    }

    // Playwright patterns
    if (this.containsPlaywrightPatterns(content)) {
      frameworks.push(TestFrameworkType.PLAYWRIGHT);
    }

    return frameworks;
  }

  private containsJestPatterns(content: string): boolean {
    const jestPatterns = [
      /import.*from ['"]@jest/,
      /jest\.mock\(/,
      /jest\.fn\(/,
      /jest\.spyOn\(/,
      /expect\(.*\)\.toBe/,
      /expect\(.*\)\.toEqual/,
      /describe\s*\(/,
      /test\s*\(/,
      /it\s*\(/
    ];

    return jestPatterns.some(pattern => pattern.test(content));
  }

  private containsVitestPatterns(content: string): boolean {
    const vitestPatterns = [
      /import.*from ['"]vitest['"]/,
      /import.*from ['"]@vitest/,
      /vi\.mock\(/,
      /vi\.fn\(/,
      /vi\.spyOn\(/,
      /import\s*\{[^}]*vi[^}]*\}\s*from\s*['"]vitest['"]/
    ];

    return vitestPatterns.some(pattern => pattern.test(content));
  }

  private containsCypressPatterns(content: string, filePath: string): boolean {
    const cypressPatterns = [
      /cy\./,
      /Cypress\./,
      /import.*cypress/i,
      /cypress\/support/i
    ];

    const isCypressFile = filePath.includes('cypress/') ||
                         filePath.includes('/cypress/') ||
                         filePath.includes('\\cypress\\');

    return isCypressFile || cypressPatterns.some(pattern => pattern.test(content));
  }

  private containsPlaywrightPatterns(content: string): boolean {
    const playwrightPatterns = [
      /import.*from ['"]@playwright\/test['"]/,
      /import.*\{.*test.*\}.*from ['"]@playwright\/test['"]/,
      /page\./,
      /browser\./,
      /context\./,
      /playwright/i
    ];

    return playwrightPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Check if function name indicates a test function
   */
  private isTestFunction(functionName: string): boolean {
    const testFunctions = [
      'describe', 'describe.skip', 'describe.only',
      'test', 'test.skip', 'test.only',
      'it', 'it.skip', 'it.only'
    ];
    return testFunctions.includes(functionName);
  }

  /**
   * Check if import is a test framework import
   */
  private isTestFrameworkImport(importPath: string): boolean {
    const testFrameworkPackages = [
      'jest',
      '@jest',
      'vitest',
      '@vitest',
      'cypress',
      '@cypress',
      '@playwright',
      'playwright',
      '@testing-library'
    ];

    return testFrameworkPackages.some(pkg => importPath.startsWith(pkg));
  }

  // Helper methods that mimic the ones I was trying to use

  private getFunctionNameFromCall(node: Parser.SyntaxNode, content: string): string | null {
    if (node.type !== 'call_expression') return null;
    const functionNode = node.children.find(child => child.type === 'identifier' || child.type === 'member_expression');
    if (!functionNode) return null;
    return this.getNodeText(functionNode, content);
  }

  private getCallArguments(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const argumentsNode = node.children.find(child => child.type === 'arguments');
    if (!argumentsNode) return [];
    return argumentsNode.children.filter(child => child.type !== '(' && child.type !== ')' && child.type !== ',');
  }

  private getStringLiteral(node: Parser.SyntaxNode, content: string): string | null {
    if (node.type !== 'string') return null;
    const text = this.getNodeText(node, content);
    // Remove quotes
    return text.slice(1, -1);
  }

  private getImportSource(node: Parser.SyntaxNode, content: string): string | null {
    if (node.type !== 'import_statement') return null;
    const sourceNode = node.children.find(child => child.type === 'string');
    if (!sourceNode) return null;
    const text = this.getNodeText(sourceNode, content);
    // Remove quotes
    return text.slice(1, -1);
  }

  // Stub implementations for required abstract methods from JavaScriptParser pattern

  protected extractFunctionSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.children.find(child => child.type === 'identifier');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    return {
      name,
      symbol_type: SymbolType.FUNCTION,
      start_line: this.getLineNumber(node.startIndex, content),
      end_line: this.getLineNumber(node.endIndex, content),
      is_exported: false, // Will be determined by export analysis
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
      from_symbol: 'current_function', // This would need better context tracking
      to_symbol: functionName,
      dependency_type: DependencyType.CALLS,
      line_number: this.getLineNumber(node.startIndex, content),
      confidence: 0.9
    };
  }

  private extractImportInfo(node: Parser.SyntaxNode, content: string): ParsedImport | null {
    const source = this.getImportSource(node, content);
    if (!source) return null;

    return {
      source,
      imported_names: [], // Would need more detailed parsing
      import_type: 'named',
      line_number: this.getLineNumber(node.startIndex, content),
      is_dynamic: false
    };
  }

  private extractExportInfo(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    return {
      exported_names: [], // Would need more detailed parsing
      export_type: 'named',
      line_number: this.getLineNumber(node.startIndex, content)
    };
  }

  /**
   * Create framework entities for detected test frameworks
   */
  private createTestFrameworkEntities(filePath: string, frameworks: TestFrameworkType[]): FrameworkEntity[] {
    const entities: FrameworkEntity[] = [];

    if (frameworks.length === 0) return entities;

    const testSuiteName = path.basename(filePath, path.extname(filePath));

    // Create a test suite entity
    entities.push({
      type: 'test_suite',
      name: testSuiteName,
      filePath,
      metadata: {
        frameworks,
        testCases: this.testSuites.find(suite => suite.filePath === filePath)?.testCases || [],
        detectedAt: new Date().toISOString()
      }
    });

    return entities;
  }

  /**
   * Get test suites found in this parse session
   */
  getTestSuites(): TestSuite[] {
    return this.testSuites;
  }

  /**
   * Get test coverage relationships found in this parse session
   */
  getTestCoverages(): TestCoverage[] {
    return this.testCoverages;
  }

  /**
   * Get detected test frameworks
   */
  getDetectedFrameworks(): TestFrameworkType[] {
    return Array.from(this.detectedFrameworks);
  }

  /**
   * Clear parser state for new analysis
   */
  clearState(): void {
    this.testSuites = [];
    this.testCoverages = [];
    this.detectedFrameworks.clear();
  }

  // Required abstract method implementations from BaseFrameworkParser

  /**
   * Detect framework entities (test suites, test cases, mocks)
   */
  public async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<{ entities: FrameworkEntity[] }> {
    const entities: FrameworkEntity[] = [];

    if (!this.isTestFile(filePath)) {
      return { entities };
    }

    const frameworks = this.detectTestFrameworks(content, filePath);
    if (frameworks.length > 0) {
      entities.push(...this.createTestFrameworkEntities(filePath, frameworks));
    }

    return { entities };
  }

  /**
   * Get test framework detection patterns
   */
  getFrameworkPatterns(): any[] {
    return [
      {
        name: 'jest-test',
        pattern: /describe\s*\(|test\s*\(|it\s*\(|expect\s*\(/,
        fileExtensions: ['.test.js', '.test.ts', '.spec.js', '.spec.ts'],
        priority: 10
      },
      {
        name: 'vitest-test',
        pattern: /import.*vitest|vi\./,
        fileExtensions: ['.test.js', '.test.ts', '.spec.js', '.spec.ts'],
        priority: 9
      },
      {
        name: 'cypress-test',
        pattern: /cy\.|Cypress\./,
        fileExtensions: ['.cy.js', '.cy.ts'],
        priority: 8
      },
      {
        name: 'playwright-test',
        pattern: /import.*@playwright|page\./,
        fileExtensions: ['.spec.js', '.spec.ts'],
        priority: 7
      }
    ];
  }

  /**
   * Get chunk boundaries for large test files
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const lines = content.split('\n');
    const boundaries: number[] = [0];
    let currentSize = 0;
    let currentPos = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineSize = lines[i].length + 1; // +1 for newline

      if (currentSize + lineSize > maxChunkSize && currentSize > 0) {
        // Try to break at test boundaries (describe/test/it blocks)
        const line = lines[i];
        if (/^\s*(describe|test|it)\s*\(/.test(line)) {
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
   * Merge results from multiple chunks, handling test-specific duplicates
   */
  protected mergeChunkResults(chunks: ParseResult[], chunkMetadata: any[]): any {
    const merged = {
      symbols: [] as ParsedSymbol[],
      dependencies: [] as ParsedDependency[],
      imports: [] as ParsedImport[],
      exports: [] as ParsedExport[],
      errors: [] as ParseError[],
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunks.length,
        duplicatesRemoved: 0,
        crossChunkReferencesFound: 0
      }
    };

    // Track seen symbols by name and line to avoid duplicates
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

      // Merge imports and exports (usually no duplicates expected)
      merged.imports.push(...chunk.imports);
      merged.exports.push(...chunk.exports);
      merged.errors.push(...chunk.errors);
    }

    return merged;
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
      const frameworks = this.detectTestFrameworks(content, filePath);
      return this.createTestFrameworkEntities(filePath, frameworks);
    } catch (error) {
      this.logger.warn('Failed to analyze framework entities from parsed result', {
        filePath,
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * Add test-specific analysis to parsed results
   */
  private addTestSpecificAnalysis(result: ParseFileResult, content: string, filePath: string): ParseFileResult {
    try {
      // Detect test framework(s) used in this file
      const frameworks = this.detectTestFrameworks(content, filePath);
      frameworks.forEach(framework => this.detectedFrameworks.add(framework));

      // Add additional test-specific symbols and dependencies
      const testSymbols = this.extractTestSymbols(filePath, content, frameworks);
      const testDependencies = this.extractTestDependencies(filePath, content);

      result.symbols.push(...testSymbols);
      result.dependencies.push(...testDependencies);

      // Update framework entities if needed
      if (!result.frameworkEntities) {
        result.frameworkEntities = [];
      }
      const testEntities = this.createTestFrameworkEntities(filePath, frameworks);
      result.frameworkEntities.push(...testEntities);

      // Update metadata
      result.metadata = {
        ...result.metadata,
        framework: 'test-framework',
        fileType: 'test',
        isFrameworkSpecific: true
      };

      return result;
    } catch (error) {
      result.errors.push({
        message: `Test framework analysis failed: ${(error as Error).message}`,
        line: 0,
        column: 0,
        severity: 'error'
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          framework: 'test-framework',
          fileType: 'error',
          isFrameworkSpecific: false
        }
      };
    }
  }
}