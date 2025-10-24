import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import {
  BaseFrameworkParser,
  FrameworkParseOptions,
  FrameworkPattern,
  ParseFileResult,
} from './base-framework';
import {
  FrameworkEntity,
  FrameworkParseResult,
  ParsedDependency,
  ParsedSymbol,
  ParseResult,
} from './base';
import { DependencyType, SymbolType } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import { entityClassifier } from '../utils/entity-classifier';
import { JavaScriptParser } from './javascript';
import { TypeScriptParser } from './typescript';

// Extracted Vue modules
import {
  extractSFCSections,
  isComposableFile as isComposableFileUtil,
  convertTemplateHandlersToDependencies as convertTemplateHandlersToDependenciesUtil,
  extractTemplateDependencies as extractTemplateDependenciesUtil,
  extractTemplateSymbols as extractTemplateSymbolsUtil,
  parseComposables as parseComposablesUtil,
  parseVueRouterRoutes as parseVueRouterRoutesUtil,
  parsePiniaStore as parsePiniaStoreUtil,
  performVueSinglePassExtraction,
  buildVueSFCEntity,
  parseVueComponent as parseVueComponentUtil,
} from './vue/index';

const logger = createComponentLogger('vue-parser');

/**
 * Vue.js-specific parser for Single File Components, composables, and Vue Router
 */
export class VueParser extends BaseFrameworkParser {
  private typescriptParser: Parser;
  private jsParser: JavaScriptParser;
  private tsParser: TypeScriptParser;
  private extractedSymbols: ParsedSymbol[] = [];
  private singlePassCache: {
    symbols: ParsedSymbol[];
    dependencies: ParsedDependency[];
    imports: any[];
  } | null = null;
  private singlePassCacheKey: string = '';
  private currentFilePath: string = '';
  private currentOptions: FrameworkParseOptions | undefined;

  constructor(parser: Parser) {
    super(parser, 'vue');

    // Create TypeScript parser for handling TS script sections
    this.typescriptParser = new Parser();
    this.typescriptParser.setLanguage(TypeScript.typescript);

    // Create parser instances for delegation (handles JSDoc extraction)
    this.jsParser = new JavaScriptParser();
    this.tsParser = new TypeScriptParser();
  }

  /**
   * Build qualified name for symbols within Vue components
   */
  private buildQualifiedName(symbolName: string): string {
    if (!this.currentFilePath) {
      return symbolName;
    }

    const componentName = this.extractComponentName(this.currentFilePath);
    return `${componentName}::${symbolName}`;
  }

  /**
   * Helper method to choose the appropriate parser based on content type
   */
  private parseScriptContent(scriptContent: string, isTypeScript: boolean): Parser.Tree | null {
    // Check if content is too large for direct parsing
    if (scriptContent.length > 28000) {
      return null;
    }

    // Use BaseParser's parseContent method to get proper size limit handling
    if (isTypeScript) {
      // Temporarily set TypeScript parser and use parseContent
      const originalParser = this.parser;
      this.parser = this.typescriptParser;
      const result = this.parseContent(scriptContent);
      this.parser = originalParser;
      return result;
    } else {
      return this.parseContent(scriptContent);
    }
  }

  /**
   * Override parseFile to handle Vue SFCs properly
   */
  async parseFile(
    filePath: string,
    content: string,
    options: FrameworkParseOptions = {}
  ): Promise<ParseFileResult> {
    try {
      // For Vue SFCs, handle chunked parsing at script level if needed
      if (filePath.endsWith('.vue')) {
        return await this.parseVueSFCWithChunking(filePath, content, options);
      }

      // For regular JS/TS files, use base framework parser
      return await super.parseFile(filePath, content, options);
    } catch (error) {
      logger.error(`Vue parsing failed for ${filePath}`, { error });

      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [
          {
            message: `Vue parsing error: ${error.message}`,
            line: 0,
            column: 0,
            severity: 'error',
          },
        ],
        frameworkEntities: [],
        metadata: {
          framework: 'vue',
          isFrameworkSpecific: false,
        },
      };
    }
  }

  /**
   * Parse Vue SFC with chunked parsing support for large script sections
   */
  private async parseVueSFCWithChunking(
    filePath: string,
    content: string,
    options: FrameworkParseOptions
  ): Promise<ParseFileResult> {
    this.currentFilePath = filePath;
    this.currentOptions = options;

    const sections = extractSFCSections(content);

    // Extract symbols, imports, etc. from script section
    let symbols: any[] = [];
    let imports: any[] = [];
    let exports: any[] = [];
    let dependencies: any[] = [];
    let errors: any[] = [];

    if (sections.script || sections.scriptSetup) {
      const scriptContent = sections.scriptSetup || sections.script;

      try {
        const isTypeScript = sections.scriptLang === 'ts' || content.includes('lang="ts"');

        // Check if script content needs chunking (force chunking for large scripts regardless of options)
        const forceChunkingOptions: FrameworkParseOptions = {
          ...options,
          enableChunking: true,
          frameworkContext: {
            framework: 'vue',
          },
        };

        if (scriptContent && this.shouldUseChunking(scriptContent, forceChunkingOptions)) {
          // Create a temporary script file path for chunked parsing
          const scriptFilePath = filePath.replace('.vue', isTypeScript ? '.ts' : '.js');

          // Use chunked parsing on just the script content
          const chunkedResult = await this.parseFileInChunks(
            scriptFilePath,
            scriptContent,
            forceChunkingOptions
          );

          symbols = chunkedResult.symbols;
          imports = chunkedResult.imports;
          exports = chunkedResult.exports;
          dependencies = chunkedResult.dependencies;
          errors = chunkedResult.errors;
        } else {
          // Delegate to JavaScriptParser or TypeScriptParser for proper JSDoc extraction
          const tempFilePath = filePath.replace('.vue', isTypeScript ? '.ts' : '.js');
          const parser = isTypeScript ? this.tsParser : this.jsParser;

          const vueFrameworkOptions: FrameworkParseOptions = {
            ...options,
            frameworkContext: {
              framework: 'vue',
            },
          };

          try {
            const parseResult = await parser.parseFile(
              tempFilePath,
              scriptContent!,
              vueFrameworkOptions
            );
            symbols = parseResult.symbols;
            imports = parseResult.imports;
            exports = parseResult.exports;
            dependencies = parseResult.dependencies;
            errors = parseResult.errors || [];
          } catch (error: any) {
            errors.push({
              message: `Script parsing error: ${error.message}`,
              line: 1,
              column: 1,
              severity: 'error' as const,
            });
          }
        }

        // Extract template symbols using lightweight parsing
        if (sections.template) {
          const templateSymbols = extractTemplateSymbolsUtil(sections.template, filePath, options);
          symbols.push(...templateSymbols);
        }
      } catch (error) {
        errors.push({
          message: `Script parsing error: ${error.message}`,
          line: 1,
          column: 1,
          severity: 'error' as const,
        });
      }
    } else if (sections.template) {
      // Handle template-only Vue files
      const templateSymbols = extractTemplateSymbolsUtil(sections.template, filePath, options);
      symbols.push(...templateSymbols);
    }

    const hasComponentSymbol = symbols.some(s => s.symbol_type === 'component');

    if (!hasComponentSymbol) {
      const componentName = this.extractComponentName(filePath);
      const totalLines = (content.match(/\n/g) || []).length + 1;

      const classification = entityClassifier.classify(
        'component',
        componentName,
        [],
        filePath,
        'vue',
        undefined,
        options?.repositoryFrameworks
      );

      const componentSymbol: ParsedSymbol = {
        name: componentName,
        qualified_name: componentName,
        symbol_type: SymbolType.COMPONENT,
        entity_type: classification.entityType,
        framework: 'vue',
        start_line: 1,
        end_line: totalLines,
        is_exported: true,
        signature: `component ${componentName}`,
        description: undefined,
      };
      symbols.push(componentSymbol);
    }

    // Detect framework entities
    const frameworkResult = await this.detectFrameworkEntities(content, filePath, options);

    // Extract template event handler dependencies
    if (sections.template) {
      const componentName = this.extractComponentName(filePath);
      const templateDeps = convertTemplateHandlersToDependenciesUtil(
        sections.template,
        componentName,
        filePath
      );
      dependencies.push(...templateDeps);

      // Extract template component usage dependencies
      const componentDeps = this.convertTemplateComponentsToDependencies(
        sections.template,
        componentName
      );
      dependencies.push(...componentDeps);
    }

    return {
      filePath,
      symbols,
      dependencies,
      imports,
      exports,
      errors,
      frameworkEntities: frameworkResult.entities || [],
      metadata: {
        framework: 'vue',
        fileType: 'sfc',
        isFrameworkSpecific: true,
      },
    };
  }

  /**
   * Detect framework entities (components, composables, routes, stores)
   */
  public async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkParseResult> {
    const entities: FrameworkEntity[] = [];

    try {
      if (filePath.endsWith('.vue')) {
        // Parse Vue Single File Component
        const component = await this.parseVueSFCEntity(content, filePath, options);
        if (component) {
          entities.push(component);
        } else {
          logger.warn('No Vue component entity created for SFC', { filePath });
        }
      } else if (this.isPiniaStore(filePath, content)) {
        // Parse Pinia stores (check before composables since stores are more specific)
        const tree = this.parseScriptContent(content, true);
        const stores = await parsePiniaStoreUtil(tree, content, filePath, options);
        entities.push(...stores);
      } else if (this.isRouterFile(filePath, content)) {
        // Parse Vue Router routes
        const tree = this.parseScriptContent(content, true);
        const routes = await parseVueRouterRoutesUtil(tree, content, filePath, options);
        entities.push(...routes);
      } else if (isComposableFileUtil(filePath, content)) {
        // Parse Vue composables (check after more specific types)
        const tree = this.parseScriptContent(content, true);
        const composables = await parseComposablesUtil(tree, content, filePath, options);
        entities.push(...composables);
      } else if (this.isVueComponentFile(content)) {
        // Parse regular Vue component (non-SFC)
        const component = parseVueComponentUtil(
          content,
          filePath,
          this.parseContent.bind(this),
          this.extractComponentName.bind(this),
          this.getVueNodeText.bind(this),
          this.extractStringLiteral.bind(this)
        );
        if (component) {
          entities.push(component);
        }
      }
    } catch (error) {
      logger.error(`Framework entity detection failed for ${filePath}`, { error });
    }

    return {
      entities,
    };
  }

  /**
   * Parse Vue SFC as a framework entity with enhanced metadata
   */
  private async parseVueSFCEntity(
    content: string,
    filePath: string,
    _options: FrameworkParseOptions
  ): Promise<FrameworkEntity | null> {
    return buildVueSFCEntity(
      content,
      filePath,
      this.extractComponentName.bind(this),
      this.parseScriptContent.bind(this)
    );
  }

  /**
   * Get Vue.js-specific detection patterns
   */
  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'vue-sfc',
        pattern: /<template>|<script>|<style>/,
        fileExtensions: ['.vue'],
        description: 'Vue Single File Component',
      },
      {
        name: 'vue-composition-api',
        pattern: /import\s+\{[^}]*\}\s+from\s+['"]vue['"]|defineComponent|setup\s*\(/,
        fileExtensions: ['.js', '.ts', '.vue'],
        description: 'Vue Composition API usage',
      },
      {
        name: 'vue-composable',
        pattern: /export\s+(default\s+)?function\s+use[A-Z]\w*|const\s+use[A-Z]\w*\s*=/,
        fileExtensions: ['.js', '.ts'],
        description: 'Vue composable function',
      },
      {
        name: 'vue-router',
        pattern: /createRouter|useRouter|useRoute|router\.(push|replace)|RouterView|RouterLink/,
        fileExtensions: ['.js', '.ts', '.vue'],
        description: 'Vue Router usage',
      },
      {
        name: 'pinia-store',
        pattern: /defineStore|usePinia|createPinia/,
        fileExtensions: ['.js', '.ts'],
        description: 'Pinia store definition',
      },
      {
        name: 'vue-built-in-components',
        pattern: /<Teleport|<Suspense|<KeepAlive|<Transition|<TransitionGroup/,
        fileExtensions: ['.vue', '.js', '.jsx', '.ts', '.tsx'],
        description: 'Vue 3 built-in components',
      },
      {
        name: 'vue-advanced-composition',
        pattern: /provide\s*\(|inject\s*\(|defineExpose\s*\(|defineModel\s*\(/,
        fileExtensions: ['.vue', '.js', '.ts'],
        description: 'Vue 3 advanced Composition API',
      },
      {
        name: 'vueuse-composables',
        pattern:
          /@vueuse\/core|@vueuse\/head|use[A-Z]\w*(?:Storage|Element|Mouse|Keyboard|Network|Browser)/,
        fileExtensions: ['.js', '.ts', '.vue'],
        description: 'VueUse composables library',
      },
      {
        name: 'vite-patterns',
        pattern: /import\.meta\.glob|import\.meta\.env|import\.meta\.hot/,
        fileExtensions: ['.js', '.ts', '.vue'],
        description: 'Vite-specific patterns',
      },
      {
        name: 'vue-testing',
        pattern: /@vue\/test-utils|mount\s*\(|shallowMount\s*\(|\.stories\./,
        fileExtensions: ['.js', '.ts', '.spec.js', '.test.js', '.stories.js'],
        description: 'Vue testing patterns',
      },
    ];
  }

  /**
   * Convert template component usage into ParsedDependency objects for dependency graph.
   * This ensures components used in templates create proper dependency edges, preventing
   * false "dead component" findings for imported components.
   */
  private convertTemplateComponentsToDependencies(
    templateContent: string,
    componentName: string
  ): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];
    const templateDependencies = extractTemplateDependenciesUtil(templateContent);

    for (const usedComponent of templateDependencies) {
      dependencies.push({
        from_symbol: componentName,
        to_symbol: usedComponent,
        dependency_type: DependencyType.REFERENCES,
        line_number: 1, // Template line numbers not precisely tracked by regex
        qualified_context: `${componentName} template uses ${usedComponent}`,
      });
    }

    return dependencies;
  }

  /**
   * Get text content of a node
   */
  protected getVueNodeText(node: Parser.SyntaxNode): string {
    return node.text || '';
  }

  // Helper methods

  private isRouterFile(filePath: string, content: string): boolean {
    return filePath.includes('router') && this.containsPattern(content, /createRouter|routes\s*:/);
  }

  private isPiniaStore(filePath: string, content: string): boolean {
    const hasStoreInPath =
      filePath.includes('store') ||
      filePath.includes('stores') ||
      filePath.toLowerCase().includes('pinia');
    return hasStoreInPath && this.containsPattern(content, /defineStore/);
  }

  private isVueComponentFile(content: string): boolean {
    return this.containsPattern(content, /defineComponent|createApp|Vue\.component/);
  }

  /**
   * Override parseFileDirectly to handle Vue script content properly for chunked parsing
   */
  protected async parseFileDirectly(
    filePath: string,
    content: string,
    options?: FrameworkParseOptions
  ): Promise<ParseResult> {
    // If this is a Vue file path (ends with .vue), treat the content as extracted script
    if (filePath.endsWith('.vue') || filePath.includes('#chunk')) {
      // For Vue files being chunked, the content is already extracted script content
      // Determine if it's TypeScript based on file extension or lang attribute
      const isTypeScript = filePath.includes('.ts') || content.includes('lang="ts"');

      // Delegate to JavaScriptParser or TypeScriptParser for proper JSDoc extraction
      const parser = isTypeScript ? this.tsParser : this.jsParser;
      const tempFilePath = filePath.replace('.vue', isTypeScript ? '.ts' : '.js');

      try {
        return await parser.parseFile(tempFilePath, content, options);
      } catch (error) {
        return {
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [
            {
              message: `Vue script parsing error: ${error.message}`,
              line: 1,
              column: 1,
              severity: 'error',
            },
          ],
        };
      }
    }

    // For non-Vue files, use the parent implementation
    return await super.parseFileDirectly(filePath, content, options);
  }

  /**
   * Get chunk boundaries for large files
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const lines = content.split('\n');
    const boundaries: number[] = [0];
    let currentSize = 0;

    for (let i = 0; i < lines.length; i++) {
      currentSize += lines[i].length + 1; // +1 for newline

      if (currentSize > maxChunkSize) {
        boundaries.push(i);
        currentSize = 0;
      }
    }

    if (boundaries[boundaries.length - 1] !== lines.length - 1) {
      boundaries.push(lines.length - 1);
    }

    return boundaries;
  }

  /**
   * Merge results from multiple chunks
   */
  protected mergeChunkResults(chunks: any[]): any {
    const merged = {
      symbols: [] as any[],
      dependencies: [] as any[],
      imports: [] as any[],
      exports: [] as any[],
      errors: [] as any[],
    };

    for (const chunk of chunks) {
      merged.symbols.push(...chunk.symbols);
      merged.dependencies.push(...chunk.dependencies);
      merged.imports.push(...chunk.imports);
      merged.exports.push(...chunk.exports);
      merged.errors.push(...chunk.errors);
    }

    return merged;
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return ['.vue', '.js', '.ts'];
  }

  protected performSinglePassExtraction(
    rootNode: any,
    content: string
  ): {
    symbols: ParsedSymbol[];
    dependencies: ParsedDependency[];
    imports: any[];
  } {
    const result = performVueSinglePassExtraction(
      rootNode,
      content,
      this.currentFilePath,
      this.currentOptions,
      this.buildQualifiedName.bind(this),
      this.getVueNodeText.bind(this),
      this.getNodeText.bind(this),
      this.findContainingFunction.bind(this)
    );

    this.extractedSymbols = result.symbols;
    return result;
  }

  /**
   * Extract symbols from AST - uses cached single-pass result
   */
  protected extractSymbols(rootNode: any, content: string): any[] {
    const cacheKey = `${rootNode ? rootNode.id : 'null'}_${content.length}`;
    if (this.singlePassCacheKey !== cacheKey || !this.singlePassCache) {
      this.singlePassCache = this.performSinglePassExtraction(rootNode, content);
      this.singlePassCacheKey = cacheKey;
    }
    return this.singlePassCache.symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const cacheKey = `${rootNode ? rootNode.id : 'null'}_${content.length}`;
    if (this.singlePassCacheKey !== cacheKey || !this.singlePassCache) {
      this.singlePassCache = this.performSinglePassExtraction(rootNode, content);
      this.singlePassCacheKey = cacheKey;
    }
    return this.singlePassCache.dependencies;
  }

  protected extractImports(rootNode: any, content: string): any[] {
    const cacheKey = `${rootNode ? rootNode.id : 'null'}_${content.length}`;
    if (this.singlePassCacheKey !== cacheKey || !this.singlePassCache) {
      this.singlePassCache = this.performSinglePassExtraction(rootNode, content);
      this.singlePassCacheKey = cacheKey;
    }
    return this.singlePassCache.imports;
  }

  /**
   * Override extractCallDependency to properly extract method names from member expressions
   * and identify the actual calling function
   */
  protected extractCallDependency(
    node: Parser.SyntaxNode,
    content: string
  ): ParsedDependency | null {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) return null;

    let functionName: string;

    if (functionNode.type === 'identifier') {
      // Simple function call: functionName()
      functionName = this.getNodeText(functionNode, content);
    } else if (functionNode.type === 'member_expression') {
      // Method call: obj.method() - extract just the method name
      const propertyNode = functionNode.childForFieldName('property');
      if (!propertyNode) return null;
      functionName = this.getNodeText(propertyNode, content);
    } else {
      return null;
    }

    const skipMethods = [
      'console',
      'log',
      'error',
      'warn',
      'push',
      'pop',
      'shift',
      'unshift',
      'slice',
      'splice',
      'toString',
      'valueOf',
    ];
    if (skipMethods.includes(functionName)) return null;

    // Find the actual containing function instead of using generic "caller"
    const callerName = this.findContainingFunction(node, content);

    return {
      from_symbol: callerName,
      to_symbol: functionName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
    };
  }

  /**
   * Find the containing function for a call expression node by traversing up the AST
   */
  private findContainingFunction(callNode: Parser.SyntaxNode, _content: string): string {
    const callLine = callNode.startPosition.row + 1;

    // Find all extracted symbols that contain this line
    const candidateSymbols = this.extractedSymbols.filter(
      symbol => symbol.start_line <= callLine && callLine <= symbol.end_line
    );

    if (candidateSymbols.length === 0) {
      // No containing symbol found, fall back to script_setup
      return 'script_setup';
    }

    // Return the most specific (smallest range) symbol
    candidateSymbols.sort((a, b) => {
      const rangeA = a.end_line - a.start_line;
      const rangeB = b.end_line - b.start_line;
      return rangeA - rangeB;
    });

    return candidateSymbols[0].name;
  }

  protected extractExports(_rootNode: any, _content: string): any[] {
    return [];
  }
}
