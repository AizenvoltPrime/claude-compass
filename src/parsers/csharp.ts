import Parser from 'tree-sitter';
const CSharp: Parser.Language = require('tree-sitter-c-sharp');
import {
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
  ParseOptions,
  ParseError,
} from './base';
import { FrameworkParseOptions } from './base-framework';
import { createComponentLogger } from '../utils/logger';
import {
  ChunkedParser,
  MergedParseResult,
  ChunkedParseOptions,
  ChunkResult,
} from './chunked-parser';

// Import types
import type { ASTContext, GodotContext } from './csharp/types';

// Import utilities from individual modules
import {
  buildQualifiedName,
  generateCallInstanceId,
  buildQualifiedContext,
  captureParseError as captureParseErrorUtil,
} from './csharp/helper-utils';
import {
  findContainingMethod,
  findNodesOfType,
  findParentDeclaration,
} from './csharp/traversal-utils';
import {
  resolveObjectType,
  resolveFQN,
  resolveType,
  resolveClassNameWithUsings,
  extractGenericTypeParameter,
  inferTypeFromExpression,
} from './csharp/type-utils';
import { initializeASTContext } from './csharp/context-utils';
import { extractParameters, extractBaseTypesFromList } from './csharp/signature-utils';
import {
  processClass,
  processInterface,
  processStruct,
  processEnum,
  processDelegate,
  processMethod,
  processConstructor,
  processProperty,
  processField,
  processEvent,
  processLocalDeclaration,
  processMemberAccess,
  processInheritance,
  processNamespace,
} from './csharp/symbol-extractors';
import {
  processUsing,
  processExternAlias,
  extractConstructorDependencies,
  extractContainmentDependencies,
  processDependency,
} from './csharp/dependency-extractors';
import {
  initializeGodotContext,
  processGodotMethodCall,
  enhanceGodotRelationships,
} from './csharp/godot-utils';
import {
  shouldUseChunking,
  getChunkBoundaries,
  extractStructuralContext,
  enrichChunksWithStructuralContext,
  mergeChunkResults,
  removeDuplicateSymbols as removeDuplicateSymbolsUtil,
} from './csharp/chunking-utils';
import {
  createErrorResult as createErrorResultUtil,
  finalizeResult as finalizeResultUtil,
  convertMergedResult as convertMergedResultUtil,
} from './csharp/result-utils';

const logger = createComponentLogger('csharp-parser');

/**
 * Ultimate C# Parser with Godot integration
 * Optimized for performance with single-pass AST traversal
 *
 * Delegates to modular utilities in ./csharp/ for maintainability
 */
export class CSharpParser extends ChunkedParser {
  private currentChunkNamespace?: string;
  private currentChunkStructures?: {
    namespace?: string;
    classes?: string[];
    qualifiedClassName?: string;
  };
  private callInstanceCounters: Map<string, number> = new Map();

  constructor() {
    const parser = new Parser();
    parser.setLanguage(CSharp);
    super(parser, 'csharp');
  }

  getSupportedExtensions(): string[] {
    return ['.cs'];
  }

  /**
   * Main parsing entry point - optimized single-pass approach
   */
  async parseFile(filePath: string, content: string, options?: ParseOptions): Promise<ParseResult> {
    const validatedOptions = this.validateOptions(options);
    const chunkedOptions = validatedOptions as ChunkedParseOptions;

    try {
      const tree = this.parseContent(content, { ...chunkedOptions, bypassSizeLimit: true });

      if (tree?.rootNode) {
        const result = await this.parseFileDirectly(filePath, content, {
          ...chunkedOptions,
          bypassSizeLimit: true,
        });

        if (result.symbols.length > 0 || result.errors.length === 0) {
          this.logger.debug('Successfully parsed file directly', {
            filePath,
            size: content.length,
            symbols: result.symbols.length,
          });
          return result;
        }
      }
    } catch (error) {
      this.logger.warn('Direct parsing failed, falling back to chunked parsing', {
        filePath,
        size: content.length,
        error: (error as Error).message,
      });
    }

    const shouldChunk = this.shouldUseChunking(content, chunkedOptions);

    if (shouldChunk) {
      this.logger.info('Using chunked parsing', { filePath, size: content.length });
      const chunkedResult = await this.parseFileInChunks(filePath, content, chunkedOptions);
      return convertMergedResultUtil(chunkedResult);
    }

    return this.parseFileDirectly(filePath, content, chunkedOptions);
  }

  public async parseFileInChunks(
    filePath: string,
    content: string,
    options?: ChunkedParseOptions
  ): Promise<MergedParseResult> {
    const chunkSize = options?.chunkSize || this.DEFAULT_CHUNK_SIZE;
    const overlapLines = options?.chunkOverlapLines || this.DEFAULT_OVERLAP_LINES;

    try {
      const chunks = this.splitIntoChunks(content, chunkSize, overlapLines);
      const chunkResults: ParseResult[] = [];
      let extractedNamespace: string | undefined;

      if (chunks.length > 0) {
        const namespaceMatch = chunks[0].content.match(/^\s*namespace\s+([\w.]+)\s*\{/);
        if (namespaceMatch) {
          extractedNamespace = namespaceMatch[1];
          for (let j = 0; j < chunks.length; j++) {
            chunks[j].namespaceContext = extractedNamespace;
          }
        }
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        if (chunk.namespaceContext) {
          this.currentChunkNamespace = chunk.namespaceContext;
        }

        if (chunk.metadata?.enclosingStructures) {
          this.currentChunkStructures = chunk.metadata.enclosingStructures;
        }

        const chunkResult = await this.parseChunk(chunk, filePath, options);
        chunkResults.push(chunkResult);

        this.currentChunkNamespace = undefined;
        this.currentChunkStructures = undefined;
      }

      return this.mergeChunkResults(chunkResults, chunks);
    } catch (error) {
      this.logger.error('Chunked parsing failed', {
        filePath,
        error: (error as Error).message,
      });
      const errorResult = createErrorResultUtil('Chunked parsing failed');
      return {
        ...errorResult,
        chunksProcessed: 0,
        metadata: {
          totalChunks: 0,
          duplicatesRemoved: 0,
          crossChunkReferencesFound: 0,
        },
      };
    }
  }

  protected async parseChunk(
    chunk: ChunkResult,
    originalFilePath: string,
    options?: ChunkedParseOptions
  ): Promise<ParseResult> {
    this.logger.debug(
      `Parsing chunk ${chunk.chunkIndex + 1}/${chunk.metadata?.totalChunks || 'unknown'}`,
      {
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        size: chunk.content.length,
      }
    );

    return this.parseFileDirectly(originalFilePath, chunk.content, {
      ...options,
      bypassSizeLimit: true,
    });
  }

  protected async parseFileDirectly(
    filePath: string,
    content: string,
    options?: ChunkedParseOptions
  ): Promise<ParseResult> {
    const tree = this.parseContent(content, options);

    if (!tree?.rootNode) {
      return createErrorResultUtil('Failed to parse content');
    }

    // Initialize context with enclosing structures from chunk metadata
    const context = initializeASTContext(this.currentChunkNamespace, this.currentChunkStructures);
    context.filePath = filePath;

    // Store framework options in context for entity classification
    if (options && 'repositoryFrameworks' in options) {
      context.options = options as FrameworkParseOptions;
    }

    const godotContext = initializeGodotContext();

    try {
      const result = this.performSinglePassExtraction(
        tree.rootNode,
        content,
        context,
        godotContext
      );

      // Enhance with Godot-specific relationships
      enhanceGodotRelationships(result, godotContext);

      return finalizeResultUtil(result, options, this.logger);
    } catch (error) {
      this.logger.error('Parsing failed', {
        filePath,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });

      return createErrorResultUtil((error as Error).message);
    }
  }

  private performSinglePassExtraction(
    rootNode: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    godotContext: GodotContext
  ): ParseResult {
    this.callInstanceCounters.clear();

    const symbols: ParsedSymbol[] = [];
    const dependencies: ParsedDependency[] = [];
    const imports: ParsedImport[] = [];
    const exports: ParsedExport[] = [];
    const errors: ParseError[] = [];

    // Bind instance methods as callbacks for delegation
    const getNodeText = this.getNodeText.bind(this);
    const findContainingMethodWrapper = (node: Parser.SyntaxNode, ctx: ASTContext, cnt: string) =>
      findContainingMethod(node, ctx, cnt, getNodeText, buildQualifiedName);

    // Single traversal function
    const traverse = (node: Parser.SyntaxNode, depth: number = 0) => {
      if (node.type === 'ERROR') {
        captureParseErrorUtil(node, content, errors);
      }

      // Cache node by type for efficient lookup
      if (!context.nodeCache.has(node.type)) {
        context.nodeCache.set(node.type, []);
      }
      context.nodeCache.get(node.type)!.push(node);

      // Process based on node type - delegate to extracted modules
      switch (node.type) {
        // Namespace handling
        case 'namespace_declaration':
        case 'file_scoped_namespace_declaration':
          processNamespace(node, content, context, symbols, getNodeText);
          break;

        // Type declarations - delegate to symbol-extractors
        case 'class_declaration':
          processClass(node, content, context, godotContext, symbols, exports, getNodeText);
          break;
        case 'interface_declaration':
          processInterface(node, content, context, symbols, exports, getNodeText);
          break;
        case 'struct_declaration':
          processStruct(node, content, context, symbols, exports, getNodeText);
          break;
        case 'enum_declaration':
          processEnum(node, content, context, symbols, exports, getNodeText);
          break;
        case 'delegate_declaration':
          processDelegate(node, content, context, symbols, getNodeText);
          break;

        // Members - delegate to symbol-extractors
        case 'method_declaration': {
          const methodParams = extractParameters(node, content, getNodeText);
          context.currentMethodParameters.clear();
          for (const param of methodParams) {
            context.currentMethodParameters.set(param.name, param.type);
          }
          processMethod(node, content, context, godotContext, symbols, getNodeText);
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child) traverse(child, depth + 1);
          }
          context.currentMethodParameters.clear();
          return;
        }
        case 'constructor_declaration': {
          const ctorParams = extractParameters(node, content, getNodeText);
          context.currentMethodParameters.clear();
          for (const param of ctorParams) {
            context.currentMethodParameters.set(param.name, param.type);
          }
          processConstructor(node, content, context, symbols, getNodeText);

          const constructorDeps = extractConstructorDependencies(
            ctorParams,
            context,
            node.startPosition.row + 1,
            (className: string, ctx: ASTContext) => resolveFQN(className, ctx)
          );
          dependencies.push(...constructorDeps);

          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child) traverse(child, depth + 1);
          }
          context.currentMethodParameters.clear();
          return;
        }
        case 'property_declaration':
          processProperty(node, content, context, godotContext, symbols, getNodeText);
          break;
        case 'field_declaration':
          processField(node, content, context, godotContext, symbols, getNodeText);
          break;
        case 'event_declaration':
          processEvent(node, content, context, symbols, getNodeText);
          break;
        case 'local_declaration_statement':
          processLocalDeclaration(node, content, context, getNodeText, inferTypeFromExpression);
          break;

        // Dependencies - delegate to dependency-extractors and godot-utils
        case 'invocation_expression':
        case 'conditional_access_expression':
        case 'object_creation_expression':
          processDependency(
            node,
            content,
            context,
            godotContext,
            dependencies,
            getNodeText,
            this.callInstanceCounters,
            findContainingMethodWrapper,
            buildQualifiedName,
            buildQualifiedContext,
            generateCallInstanceId,
            resolveObjectType,
            resolveType,
            resolveClassNameWithUsings,
            processGodotMethodCall,
            extractGenericTypeParameter
          );
          break;
        case 'member_access_expression':
          // Only process if not part of an invocation (to avoid duplicates)
          if (
            node.parent?.type !== 'invocation_expression' &&
            node.parent?.type !== 'conditional_access_expression'
          ) {
            processMemberAccess(
              node,
              content,
              context,
              dependencies,
              getNodeText,
              findContainingMethodWrapper
            );
          }
          break;
        case 'base_list':
          processInheritance(
            node,
            content,
            context,
            dependencies,
            getNodeText,
            findParentDeclaration,
            extractBaseTypesFromList
          );
          break;

        // Imports - delegate to dependency-extractors
        case 'using_directive':
          processUsing(node, content, context, imports, getNodeText);
          break;
        case 'extern_alias_directive':
          processExternAlias(node, content, imports, getNodeText);
          break;
      }

      // Traverse children
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) traverse(child, depth + 1);
      }
    };

    traverse(rootNode);

    // Extract containment relationships (classes/interfaces containing methods)
    const containmentDeps = extractContainmentDependencies(symbols);
    dependencies.push(...containmentDeps);

    return { symbols, dependencies, imports, exports, errors };
  }

  /**
   * Chunking support - delegates to chunking-utils
   */
  protected shouldUseChunking(content: string, options: ChunkedParseOptions): boolean {
    return shouldUseChunking(content, options, this.DEFAULT_CHUNK_SIZE);
  }

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    return getChunkBoundaries(
      content,
      maxChunkSize,
      this.parseContent.bind(this),
      this.getNodeText.bind(this),
      this.findNodesOfType.bind(this)
    );
  }

  protected override splitIntoChunks(
    content: string,
    chunkSize: number,
    overlapLines: number
  ): ChunkResult[] {
    const boundaries = this.getChunkBoundaries(content, chunkSize);
    const lines = content.split('\n');
    const chunks: ChunkResult[] = [];

    if (boundaries.length === 0) {
      chunks.push({
        content,
        startLine: 1,
        endLine: lines.length,
        chunkIndex: 0,
        isComplete: true,
        metadata: {
          originalStartLine: 1,
          hasOverlapBefore: false,
          hasOverlapAfter: false,
          totalChunks: 1,
        },
      });
    } else {
      let lastBoundary = 0;

      for (let i = 0; i <= boundaries.length; i++) {
        const currentBoundary = i < boundaries.length ? boundaries[i] : content.length;

        const startIndex = Math.max(0, lastBoundary - overlapLines * 50);
        const endIndex = currentBoundary;

        const chunkContent = content.substring(startIndex, endIndex);
        const startLineNum = content.substring(0, startIndex).split('\n').length;
        const endLineNum = content.substring(0, endIndex).split('\n').length;

        chunks.push({
          content: chunkContent,
          startLine: startLineNum,
          endLine: endLineNum,
          chunkIndex: i,
          isComplete: i === boundaries.length,
          metadata: {
            originalStartLine: startLineNum,
            hasOverlapBefore: i > 0,
            hasOverlapAfter: i < boundaries.length,
            totalChunks: boundaries.length + 1,
          },
        });

        lastBoundary = currentBoundary;
      }
    }

    // Extract and enrich with structural context
    const structures = extractStructuralContext(
      content,
      this.parseContent.bind(this),
      this.getNodeText.bind(this)
    );

    return enrichChunksWithStructuralContext(chunks, structures);
  }

  protected mergeChunkResults(
    chunkResults: ParseResult[],
    chunkMetadata: ChunkResult[]
  ): MergedParseResult {
    return mergeChunkResults(
      chunkResults,
      chunkMetadata,
      this.removeDuplicateSymbols.bind(this),
      this.removeDuplicateDependencies.bind(this)
    );
  }

  protected removeDuplicateSymbols(symbols: ParsedSymbol[]): ParsedSymbol[] {
    return removeDuplicateSymbolsUtil(symbols, (symbol1, symbol2) => {
      // Prefer symbols with more complete information
      if (symbol1.signature && !symbol2.signature) return true;
      if (!symbol1.signature && symbol2.signature) return false;
      if (symbol1.description && !symbol2.description) return true;
      if (!symbol1.description && symbol2.description) return false;
      return symbol1.start_line < symbol2.start_line;
    });
  }

  /**
   * Abstract method implementations - delegate to extracted modules
   */
  protected extractSymbols(_rootNode: Parser.SyntaxNode, _content: string): ParsedSymbol[] {
    // Not used - we use performSinglePassExtraction instead
    return [];
  }

  protected extractDependencies(
    _rootNode: Parser.SyntaxNode,
    _content: string
  ): ParsedDependency[] {
    // Not used - we use performSinglePassExtraction instead
    return [];
  }

  protected extractImports(_rootNode: Parser.SyntaxNode, _content: string): ParsedImport[] {
    // Not used - we use performSinglePassExtraction instead
    return [];
  }

  protected extractExports(_rootNode: Parser.SyntaxNode, _content: string): ParsedExport[] {
    // Not used - we use performSinglePassExtraction instead
    return [];
  }

  protected findNodesOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    return findNodesOfType(node, type);
  }
}
