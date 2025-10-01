import Parser from 'tree-sitter';
import * as CSharp from 'tree-sitter-c-sharp';
import {
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
  ParseOptions,
  ParseError,
} from './base';
import { createComponentLogger } from '../utils/logger';
import {
  ChunkedParser,
  MergedParseResult,
  ChunkedParseOptions,
  ChunkResult,
} from './chunked-parser';
import { SymbolType, DependencyType, Visibility } from '../database/models';

const logger = createComponentLogger('csharp-parser');

/**
 * Type information with complete context
 */
interface TypeInfo {
  type: string;
  fullQualifiedName: string;
  source: 'field' | 'property' | 'variable' | 'parameter' | 'method';
  declarationLine?: number;
  namespace?: string;
  genericArgs?: string[];
}

/**
 * Method information for enhanced resolution
 */
interface MethodInfo {
  name: string;
  className: string;
  returnType: string;
  parameters: ParameterInfo[];
  isStatic: boolean;
  visibility: Visibility;
  line: number;
}

/**
 * Parameter information
 */
interface ParameterInfo {
  name: string;
  type: string;
  defaultValue?: string;
  isRef?: boolean;
  isOut?: boolean;
  isParams?: boolean;
}

/**
 * AST context for efficient traversal
 */
interface ASTContext {
  typeMap: Map<string, TypeInfo>;
  methodMap: Map<string, MethodInfo[]>;
  namespaceStack: string[];
  classStack: string[];
  currentNamespace?: string;
  currentClass?: string;
  usingDirectives: Set<string>;
  symbolCache: Map<string, ParsedSymbol>;
  nodeCache: Map<string, Parser.SyntaxNode[]>;
}

/**
 * Godot integration context
 */
interface GodotContext {
  signals: Map<string, SignalInfo>;
  exports: Map<string, ExportInfo>;
  nodePaths: Set<string>;
  autoloads: Set<string>;
  sceneReferences: Set<string>;
}

interface SignalInfo {
  name: string;
  parameters: string[];
  emitters: string[];
}

interface ExportInfo {
  name: string;
  type: string;
  exportType?: string;
  defaultValue?: any;
}

interface MethodCall {
  methodName: string;
  callingObject: string;
  resolvedClass?: string;
  parameters: string[];
  fullyQualifiedName: string;
}

/**
 * Pre-compiled regex patterns for performance
 */
const PATTERNS = {
  // Method patterns
  methodCall: /(\w+)\s*\(/g,
  qualifiedCall: /(\w+)\.(\w+)\s*\(/g,
  conditionalAccess: /([_\w]+)\?\s*\.?\s*([_\w]+)\s*\(/g,
  memberAccess: /([_\w]+)\.([_\w]+)\s*\(/g,
  fieldAccess: /([_\w]+)\s*\(/g,

  // Godot patterns
  godotSignal: /\[Signal\]\s*(?:public\s+)?delegate\s+\w+\s+(\w+)\s*\(([^)]*)\)/g,
  godotExport: /\[Export(?:\(([^)]+)\))?\]\s*(?:public\s+)?(\w+)\s+(\w+)/g,
  godotNode: /GetNode(?:<(\w+)>)?\s*\(\s*["']([^"']+)["']\s*\)/g,
  godotAutoload: /GetNode<(\w+)>\s*\(\s*["']\/root\/(\w+)["']\s*\)/g,
  emitSignal: /EmitSignal\s*\(\s*(?:nameof\s*\()?["']?(\w+)/g,

  // Type patterns
  genericType: /^([^<]+)<(.+)>$/,
  interfacePrefix: /^I[A-Z]/,

  // Class patterns
  classDeclaration:
    /(?:public\s+|private\s+|internal\s+)?(?:partial\s+)?(?:static\s+)?(?:abstract\s+)?(?:sealed\s+)?class\s+(\w+)(?:\s*:\s*([^{]+))?/g,
  interfaceDeclaration:
    /(?:public\s+|private\s+|internal\s+)?interface\s+(\w+)(?:\s*:\s*([^{]+))?/g,
} as const;

/**
 * Ultimate C# Parser with Godot integration
 * Optimized for performance with single-pass AST traversal
 */
export class CSharpParser extends ChunkedParser {
  private static readonly MODIFIER_KEYWORDS = new Set([
    'public',
    'private',
    'protected',
    'internal',
    'static',
    'partial',
    'abstract',
    'sealed',
    'virtual',
    'override',
    'readonly',
    'async',
    'const',
    'new',
    'extern',
    'unsafe',
    'volatile',
  ]);

  private static readonly GODOT_BASE_CLASSES = new Set([
    'Node',
    'Node2D',
    'Node3D',
    'Control',
    'Resource',
    'RefCounted',
    'Object',
    'PackedScene',
    'GodotObject',
    'Area2D',
    'Area3D',
    'RigidBody2D',
    'RigidBody3D',
    'CharacterBody2D',
    'CharacterBody3D',
    'StaticBody2D',
    'StaticBody3D',
  ]);

  private static readonly GODOT_LIFECYCLE_METHODS = new Set([
    '_Ready',
    '_EnterTree',
    '_ExitTree',
    '_Process',
    '_PhysicsProcess',
    '_Input',
    '_UnhandledInput',
    '_UnhandledKeyInput',
    '_Draw',
    '_Notification',
    '_GetPropertyList',
    '_PropertyCanRevert',
  ]);

  constructor() {
    const parser = new Parser();
    parser.setLanguage(CSharp as any);
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

    // Check file size and determine parsing strategy
    const shouldChunk = this.shouldUseChunking(content, chunkedOptions);

    if (shouldChunk) {
      const chunkedResult = await this.parseFileInChunks(filePath, content, chunkedOptions);
      return this.convertMergedResult(chunkedResult);
    }

    return this.parseFileDirectly(filePath, content, chunkedOptions);
  }

  /**
   * Optimized direct parsing with single AST traversal
   */
  protected async parseFileDirectly(
    filePath: string,
    content: string,
    options?: ChunkedParseOptions
  ): Promise<ParseResult> {
    const tree = this.parseContent(content, options);
    if (!tree?.rootNode) {
      return this.createErrorResult('Failed to parse syntax tree');
    }

    try {
      // Initialize context for single-pass traversal
      const context = this.initializeASTContext();
      const godotContext = this.initializeGodotContext();

      // Single traversal to extract everything
      const result = this.performSinglePassExtraction(
        tree.rootNode,
        content,
        context,
        godotContext
      );

      // Enhance with Godot relationships
      this.enhanceGodotRelationships(result, godotContext);

      // Validate and filter based on options
      return this.finalizeResult(result, options);
    } catch (error) {
      logger.error('C# parsing failed', {
        filePath,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.createErrorResult(`Parsing failed: ${error}`);
    }
  }

  /**
   * Single-pass AST traversal for optimal performance
   */
  private performSinglePassExtraction(
    rootNode: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    godotContext: GodotContext
  ): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const dependencies: ParsedDependency[] = [];
    const imports: ParsedImport[] = [];
    const exports: ParsedExport[] = [];
    const errors: ParseError[] = [];

    // Single traversal function
    const traverse = (node: Parser.SyntaxNode, depth: number = 0) => {
      // Cache node by type for efficient lookup
      if (!context.nodeCache.has(node.type)) {
        context.nodeCache.set(node.type, []);
      }
      context.nodeCache.get(node.type)!.push(node);

      // Process based on node type
      switch (node.type) {
        // Namespace handling
        case 'namespace_declaration':
        case 'file_scoped_namespace_declaration':
          this.processNamespace(node, content, context, symbols);
          break;

        // Type declarations
        case 'class_declaration':
          this.processClass(node, content, context, godotContext, symbols, exports);
          break;
        case 'interface_declaration':
          this.processInterface(node, content, context, symbols, exports);
          break;
        case 'struct_declaration':
          this.processStruct(node, content, context, symbols, exports);
          break;
        case 'enum_declaration':
          this.processEnum(node, content, context, symbols, exports);
          break;
        case 'delegate_declaration':
          this.processDelegate(node, content, context, symbols);
          break;

        // Members
        case 'method_declaration':
          this.processMethod(node, content, context, godotContext, symbols);
          break;
        case 'constructor_declaration':
          this.processConstructor(node, content, context, symbols);
          break;
        case 'property_declaration':
          this.processProperty(node, content, context, godotContext, symbols);
          break;
        case 'field_declaration':
          this.processField(node, content, context, godotContext, symbols);
          break;
        case 'event_declaration':
          this.processEvent(node, content, context, symbols);
          break;

        // Dependencies - unified dependency detection
        case 'invocation_expression':
        case 'conditional_access_expression':
        case 'object_creation_expression':
          this.processDependency(node, content, context, godotContext, dependencies);
          break;
        case 'member_access_expression':
          // Only process if not part of an invocation (to avoid duplicates)
          if (
            node.parent?.type !== 'invocation_expression' &&
            node.parent?.type !== 'conditional_access_expression'
          ) {
            this.processMemberAccess(node, content, context, dependencies);
          }
          break;
        case 'base_list':
          this.processInheritance(node, content, context, dependencies);
          break;

        // Imports
        case 'using_directive':
          this.processUsing(node, content, context, imports);
          break;
        case 'extern_alias_directive':
          this.processExternAlias(node, content, imports);
          break;
      }

      // Traverse children
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) traverse(child, depth + 1);
      }
    };

    traverse(rootNode);

    return { symbols, dependencies, imports, exports, errors };
  }

  /**
   * Initialize AST context for efficient traversal
   */
  private initializeASTContext(): ASTContext {
    return {
      typeMap: new Map(),
      methodMap: new Map(),
      namespaceStack: [],
      classStack: [],
      usingDirectives: new Set(),
      symbolCache: new Map(),
      nodeCache: new Map(),
    };
  }

  /**
   * Initialize Godot-specific context
   */
  private initializeGodotContext(): GodotContext {
    return {
      signals: new Map(),
      exports: new Map(),
      nodePaths: new Set(),
      autoloads: new Set(),
      sceneReferences: new Set(),
    };
  }

  /**
   * Process namespace declaration
   */
  private processNamespace(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    symbols: ParsedSymbol[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = this.getNodeText(nameNode, content);
    context.currentNamespace = name;
    context.namespaceStack.push(name);

    symbols.push({
      name,
      symbol_type: SymbolType.NAMESPACE,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: true,
      visibility: Visibility.PUBLIC,
    });
  }

  /**
   * Process class declaration with Godot awareness
   */
  private processClass(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    _godotContext: GodotContext,
    symbols: ParsedSymbol[],
    exports: ParsedExport[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);
    const baseTypes = this.extractBaseTypes(node, content);
    const isGodotClass = this.isGodotClass(baseTypes);

    context.currentClass = name;
    context.classStack.push(name);

    // Add to type map for resolution
    const qualifiedName = this.buildQualifiedName(context, name);
    context.typeMap.set(name, {
      type: name,
      fullQualifiedName: qualifiedName,
      source: 'method',
      namespace: context.currentNamespace,
    });

    const symbol: ParsedSymbol = {
      name,
      qualified_name: qualifiedName,
      symbol_type: SymbolType.CLASS,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
      signature: this.buildClassSignature(name, modifiers, baseTypes),
    };

    symbols.push(symbol);
    context.symbolCache.set(qualifiedName, symbol);

    if (modifiers.includes('public')) {
      exports.push({
        exported_names: [name],
        export_type: 'named',
        line_number: node.startPosition.row + 1,
      });
    }
  }

  /**
   * Process method declaration with Godot lifecycle detection
   */
  private processMethod(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    _godotContext: GodotContext,
    symbols: ParsedSymbol[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);
    const returnType = this.extractReturnType(node, content);
    const parameters = this.extractParameters(node, content);
    const isGodotLifecycle = CSharpParser.GODOT_LIFECYCLE_METHODS.has(name);

    // Add to method map for resolution
    const methodInfo: MethodInfo = {
      name,
      className: context.currentClass || '',
      returnType,
      parameters,
      isStatic: modifiers.includes('static'),
      visibility,
      line: node.startPosition.row + 1,
    };

    if (!context.methodMap.has(name)) {
      context.methodMap.set(name, []);
    }
    context.methodMap.get(name)!.push(methodInfo);

    const methodQualifiedName = this.buildQualifiedName(context, name);

    const symbol: ParsedSymbol = {
      name,
      qualified_name: methodQualifiedName,
      symbol_type: SymbolType.METHOD,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
      signature: this.buildMethodSignature(name, modifiers, returnType, parameters),
    };

    symbols.push(symbol);
  }

  /**
   * Process field declaration with Godot export detection
   */
  private processField(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    godotContext: GodotContext,
    symbols: ParsedSymbol[]
  ): void {
    const variableDeclaration = node.children.find(child => child.type === 'variable_declaration');
    if (!variableDeclaration) return;

    const typeNode = variableDeclaration.childForFieldName('type');
    const fieldType = typeNode ? this.getNodeText(typeNode, content) : 'object';
    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);

    // Check for Godot Export attribute
    const hasExportAttribute = this.hasAttribute(node, 'Export', content);

    // Extract each variable declarator
    const declaratorNodes = this.findNodesOfType(variableDeclaration, 'variable_declarator');
    for (const declarator of declaratorNodes) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;

      const fieldName = this.getNodeText(nameNode, content);

      // Add to type map for resolution
      context.typeMap.set(fieldName, {
        type: this.resolveType(fieldType),
        fullQualifiedName: fieldType,
        source: 'field',
        namespace: context.currentNamespace,
      });

      // Track Godot exports
      if (hasExportAttribute) {
        godotContext.exports.set(fieldName, {
          name: fieldName,
          type: fieldType,
        });
      }

      symbols.push({
        name: fieldName,
        symbol_type: modifiers.includes('const') ? SymbolType.CONSTANT : SymbolType.VARIABLE,
        start_line: declarator.startPosition.row + 1,
        end_line: declarator.endPosition.row + 1,
        is_exported: modifiers.includes('public'),
        visibility,
        signature: `${modifiers.join(' ')} ${fieldType} ${fieldName}`.trim(),
      });
    }
  }

  /**
   * Unified dependency processing for all call types with complete AST analysis
   */
  private processDependency(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    godotContext: GodotContext,
    dependencies: ParsedDependency[]
  ): void {
    const callerName = this.findContainingMethod(node, context);
    if (!callerName) return;

    let methodCall: MethodCall | null = null;

    switch (node.type) {
      case 'invocation_expression':
        methodCall = this.extractMethodCall(node, content, context);
        break;
      case 'conditional_access_expression':
        methodCall = this.extractConditionalCall(node, content, context);
        break;
      case 'object_creation_expression':
        methodCall = this.extractConstructorCall(node, content, context);
        break;
    }

    if (!methodCall) return;

    // Process Godot-specific method calls
    this.processGodotMethodCall(
      methodCall.methodName,
      node,
      content,
      context,
      godotContext,
      dependencies
    );

    // Create dependency entry
    dependencies.push({
      from_symbol: callerName,
      to_symbol: methodCall.fullyQualifiedName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
      calling_object: methodCall.callingObject || undefined,
      resolved_class: methodCall.resolvedClass,
      parameter_context:
        methodCall.parameters.length > 0 ? methodCall.parameters.join(', ') : undefined,
    });
  }

  /**
   * Extract method call information from invocation expression
   */
  private extractMethodCall(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext
  ): MethodCall | null {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) return null;

    let methodName = '';
    let callingObject = '';
    let resolvedClass: string | undefined;

    if (functionNode.type === 'member_access_expression') {
      const nameNode = functionNode.childForFieldName('name');
      const objectNode = functionNode.childForFieldName('expression');

      methodName = nameNode ? this.getNodeText(nameNode, content) : '';
      callingObject = objectNode ? this.getNodeText(objectNode, content) : '';

      resolvedClass = this.resolveObjectType(callingObject, context);
    } else if (functionNode.type === 'identifier') {
      methodName = this.getNodeText(functionNode, content);
      // Method call without object, likely on current class
      callingObject = 'this';
      resolvedClass = context.currentClass;
    } else if (functionNode.type === 'conditional_access_expression') {
      // Handle nested conditional access
      return this.extractConditionalCall(functionNode, content, context);
    }

    const parameters = this.extractCallParameters(node, content);
    const fullyQualifiedName = resolvedClass ? `${resolvedClass}.${methodName}` : methodName;

    return {
      methodName,
      callingObject,
      resolvedClass,
      parameters,
      fullyQualifiedName,
    };
  }

  /**
   * Extract method call from conditional access expression (?.operator)
   */
  private extractConditionalCall(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext
  ): MethodCall | null {
    // For conditional access, the structure is:
    // conditional_access_expression -> identifier + member_binding_expression

    if (node.namedChildCount < 2) return null;

    const objectNode = node.namedChild(0); // The object being accessed (_handManager)
    const memberBindingNode = node.namedChild(1); // The member binding (.SetHandPositions)

    if (!objectNode || !memberBindingNode) return null;

    const callingObject = this.getNodeText(objectNode, content);

    // Extract method name from member binding expression
    let methodName = '';
    if (memberBindingNode.type === 'member_binding_expression') {
      // Find the identifier within the member binding
      const identifierNode = this.findChildByType(memberBindingNode, 'identifier');
      if (identifierNode) {
        methodName = this.getNodeText(identifierNode, content);
      }
    }

    if (!methodName) return null;

    const resolvedClass = this.resolveObjectType(callingObject, context);

    // For conditional access in invocation, get parameters from parent invocation
    const parameters: string[] = [];
    if (node.parent?.type === 'invocation_expression') {
      parameters.push(...this.extractCallParameters(node.parent, content));
    }

    const fullyQualifiedName = resolvedClass ? `${resolvedClass}.${methodName}` : methodName;

    return {
      methodName,
      callingObject,
      resolvedClass,
      parameters,
      fullyQualifiedName,
    };
  }

  /**
   * Extract constructor call information
   */
  private extractConstructorCall(
    node: Parser.SyntaxNode,
    content: string,
    _context: ASTContext
  ): MethodCall | null {
    const typeNode = node.childForFieldName('type');
    if (!typeNode) return null;

    const typeName = this.getNodeText(typeNode, content);
    const parameters = this.extractCallParameters(node, content);
    const resolvedClass = this.resolveType(typeName);

    return {
      methodName: 'constructor',
      callingObject: '',
      resolvedClass,
      parameters,
      fullyQualifiedName: `${resolvedClass}.constructor`,
    };
  }

  /**
   * Comprehensive object type resolution
   */
  private resolveObjectType(objectExpression: string, context: ASTContext): string | undefined {
    if (!objectExpression) return undefined;

    // Handle this. prefix
    const cleanedObject = objectExpression.replace(/^this\./, '');

    // Try direct lookup first
    let typeInfo = context.typeMap.get(cleanedObject);

    // Handle private field naming conventions
    if (!typeInfo) {
      // Try with underscore prefix for private fields
      if (!cleanedObject.startsWith('_')) {
        typeInfo = context.typeMap.get('_' + cleanedObject);
      }
      // Try without underscore prefix
      else if (cleanedObject.startsWith('_')) {
        typeInfo = context.typeMap.get(cleanedObject.substring(1));
      }
    }

    // Try parameter resolution (TODO: Add parameter type tracking)

    return typeInfo?.type;
  }

  /**
   * Find child node by type
   */
  private findChildByType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === type) {
        return child;
      }
      // Recursively search in children
      const found = this.findChildByType(child!, type);
      if (found) return found;
    }
    return null;
  }

  /**
   * Process Godot-specific method calls
   */
  private processGodotMethodCall(
    methodName: string,
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    godotContext: GodotContext,
    _dependencies: ParsedDependency[]
  ): void {
    // Handle GetNode calls
    if (methodName === 'GetNode') {
      const nodePathMatch = content
        .substring(node.startIndex, node.endIndex)
        .match(/GetNode(?:<\w+>)?\s*\(\s*["']([^"']+)["']\s*\)/);

      if (nodePathMatch) {
        godotContext.nodePaths.add(nodePathMatch[1]);

        // Check for autoload pattern
        if (nodePathMatch[1].startsWith('/root/')) {
          const autoloadName = nodePathMatch[1].substring(6);
          godotContext.autoloads.add(autoloadName);
        }
      }
    }

    // Handle EmitSignal calls
    else if (methodName === 'EmitSignal') {
      const signalMatch = content
        .substring(node.startIndex, node.endIndex)
        .match(/EmitSignal\s*\(\s*(?:nameof\s*\()?["']?(\w+)/);

      if (signalMatch) {
        const signalName = signalMatch[1];
        const callerName = this.findContainingMethod(node, context);

        if (!godotContext.signals.has(signalName)) {
          godotContext.signals.set(signalName, {
            name: signalName,
            parameters: [],
            emitters: [callerName],
          });
        } else {
          godotContext.signals.get(signalName)!.emitters.push(callerName);
        }
      }
    }
  }

  /**
   * Process property declaration
   */
  private processProperty(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    _godotContext: GodotContext,
    symbols: ParsedSymbol[]
  ): void {
    const nameNode = node.childForFieldName('name');
    const typeNode = node.childForFieldName('type');
    if (!nameNode) return;

    const name = this.getNodeText(nameNode, content);
    const propertyType = typeNode ? this.getNodeText(typeNode, content) : 'object';
    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);

    // Add to type map
    context.typeMap.set(name, {
      type: this.resolveType(propertyType),
      fullQualifiedName: propertyType,
      source: 'property',
      namespace: context.currentNamespace,
    });

    symbols.push({
      name,
      symbol_type: SymbolType.PROPERTY,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
      signature: `${modifiers.join(' ')} ${propertyType} ${name}`.trim(),
    });
  }

  /**
   * Process interface declaration
   */
  private processInterface(
    node: Parser.SyntaxNode,
    content: string,
    _context: ASTContext,
    symbols: ParsedSymbol[],
    exports: ParsedExport[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);
    const baseTypes = this.extractBaseTypes(node, content);

    symbols.push({
      name,
      symbol_type: SymbolType.INTERFACE,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
      signature: this.buildInterfaceSignature(name, modifiers, baseTypes),
    });

    if (modifiers.includes('public')) {
      exports.push({
        exported_names: [name],
        export_type: 'named',
        line_number: node.startPosition.row + 1,
      });
    }
  }

  /**
   * Process struct declaration
   */
  private processStruct(
    node: Parser.SyntaxNode,
    content: string,
    _context: ASTContext,
    symbols: ParsedSymbol[],
    exports: ParsedExport[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);

    symbols.push({
      name,
      symbol_type: SymbolType.CLASS,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
      signature: `struct ${name}`,
    });

    if (modifiers.includes('public')) {
      exports.push({
        exported_names: [name],
        export_type: 'named',
        line_number: node.startPosition.row + 1,
      });
    }
  }

  /**
   * Process enum declaration
   */
  private processEnum(
    node: Parser.SyntaxNode,
    content: string,
    _context: ASTContext,
    symbols: ParsedSymbol[],
    exports: ParsedExport[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);

    symbols.push({
      name,
      symbol_type: SymbolType.ENUM,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
    });

    if (modifiers.includes('public')) {
      exports.push({
        exported_names: [name],
        export_type: 'named',
        line_number: node.startPosition.row + 1,
      });
    }
  }

  /**
   * Process delegate declaration
   */
  private processDelegate(
    node: Parser.SyntaxNode,
    content: string,
    _context: ASTContext,
    symbols: ParsedSymbol[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);

    // Check if this is a Godot signal
    // Check for Signal attribute for potential delegate signals
    this.hasAttribute(node, 'Signal', content);

    symbols.push({
      name,
      symbol_type: SymbolType.TYPE_ALIAS,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
      signature: `delegate ${name}`,
    });
  }

  /**
   * Process constructor declaration
   */
  private processConstructor(
    node: Parser.SyntaxNode,
    content: string,
    _context: ASTContext,
    symbols: ParsedSymbol[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = this.getNodeText(nameNode, content);
    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);
    const parameters = this.extractParameters(node, content);

    symbols.push({
      name,
      symbol_type: SymbolType.METHOD,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
      signature: this.buildConstructorSignature(name, modifiers, parameters),
    });
  }

  /**
   * Process event declaration
   */
  private processEvent(
    node: Parser.SyntaxNode,
    content: string,
    _context: ASTContext,
    symbols: ParsedSymbol[]
  ): void {
    const variableDeclaration = node.children.find(child => child.type === 'variable_declaration');
    if (!variableDeclaration) return;

    const modifiers = this.extractModifiers(node);
    const visibility = this.getVisibility(modifiers);

    const declaratorNodes = this.findNodesOfType(variableDeclaration, 'variable_declarator');
    for (const declarator of declaratorNodes) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;

      const name = this.getNodeText(nameNode, content);

      symbols.push({
        name,
        symbol_type: SymbolType.VARIABLE,
        start_line: declarator.startPosition.row + 1,
        end_line: declarator.endPosition.row + 1,
        is_exported: modifiers.includes('public'),
        visibility,
        signature: `event ${name}`,
      });
    }
  }

  /**
   * Process member access
   */
  private processMemberAccess(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    dependencies: ParsedDependency[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const memberName = this.getNodeText(nameNode, content);
    const callerName = this.findContainingMethod(node, context);

    dependencies.push({
      from_symbol: callerName,
      to_symbol: memberName,
      dependency_type: DependencyType.REFERENCES,
      line_number: node.startPosition.row + 1,
    });
  }

  /**
   * Process inheritance relationships
   */
  private processInheritance(
    node: Parser.SyntaxNode,
    content: string,
    _context: ASTContext,
    dependencies: ParsedDependency[]
  ): void {
    const parent = this.findParentDeclaration(node);
    if (!parent) return;

    const parentNameNode = parent.childForFieldName('name');
    if (!parentNameNode) return;

    const fromSymbol = this.getNodeText(parentNameNode, content);
    const isInterface = parent.type === 'interface_declaration';
    const baseTypes = this.extractBaseTypesFromList(node, content);

    for (let i = 0; i < baseTypes.length; i++) {
      const baseName = baseTypes[i];
      const isFirstItem = i === 0;
      const looksLikeInterface = PATTERNS.interfacePrefix.test(baseName);

      let dependencyType: DependencyType;
      if (isInterface) {
        dependencyType = DependencyType.INHERITS;
      } else if (isFirstItem && !looksLikeInterface) {
        dependencyType = DependencyType.INHERITS;
      } else {
        dependencyType = DependencyType.IMPLEMENTS;
      }

      dependencies.push({
        from_symbol: fromSymbol,
        to_symbol: baseName,
        dependency_type: dependencyType,
        line_number: node.startPosition.row + 1,
      });
    }
  }

  /**
   * Process using directives
   */
  private processUsing(
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    imports: ParsedImport[]
  ): void {
    const nameNode = node.children.find(
      child => child.type === 'identifier' || child.type === 'qualified_name'
    );
    if (!nameNode) return;

    const namespaceName = this.getNodeText(nameNode, content);
    context.usingDirectives.add(namespaceName);

    imports.push({
      source: namespaceName,
      imported_names: ['*'],
      import_type: 'namespace',
      line_number: node.startPosition.row + 1,
      is_dynamic: false,
    });
  }

  /**
   * Process extern alias directives
   */
  private processExternAlias(
    node: Parser.SyntaxNode,
    content: string,
    imports: ParsedImport[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const aliasName = this.getNodeText(nameNode, content);

    imports.push({
      source: aliasName,
      imported_names: [aliasName],
      import_type: 'named',
      line_number: node.startPosition.row + 1,
      is_dynamic: false,
    });
  }

  /**
   * Enhance results with Godot-specific relationships
   */
  private enhanceGodotRelationships(result: ParseResult, godotContext: GodotContext): void {
    // Add signal connections
    for (const [signalName, signalInfo] of godotContext.signals) {
      for (const emitter of signalInfo.emitters) {
        result.dependencies.push({
          from_symbol: emitter,
          to_symbol: `signal:${signalName}`,
          dependency_type: DependencyType.REFERENCES,
          line_number: 0,
        });
      }
    }

    // Add node path references
    for (const nodePath of godotContext.nodePaths) {
      result.dependencies.push({
        from_symbol: '<scene>',
        to_symbol: `node:${nodePath}`,
        dependency_type: DependencyType.REFERENCES,
        line_number: 0,
      });
    }

    // Add autoload references
    for (const autoload of godotContext.autoloads) {
      result.dependencies.push({
        from_symbol: '<global>',
        to_symbol: `autoload:${autoload}`,
        dependency_type: DependencyType.REFERENCES,
        line_number: 0,
      });
    }
  }

  // Helper methods

  private extractModifiers(node: Parser.SyntaxNode): string[] {
    const modifiers: string[] = [];

    for (const child of node.children) {
      if (child.type === 'modifier' && child.childCount > 0) {
        const modifierType = child.child(0)?.type;
        if (modifierType && CSharpParser.MODIFIER_KEYWORDS.has(modifierType)) {
          modifiers.push(modifierType);
        }
      } else if (CSharpParser.MODIFIER_KEYWORDS.has(child.type)) {
        modifiers.push(child.type);
      }
    }

    return modifiers;
  }

  private getVisibility(modifiers: string[]): Visibility {
    if (modifiers.includes('public')) return Visibility.PUBLIC;
    if (modifiers.includes('protected')) return Visibility.PROTECTED;
    if (modifiers.includes('internal')) return Visibility.PUBLIC; // Map internal to public for now
    return Visibility.PRIVATE;
  }

  private extractBaseTypes(node: Parser.SyntaxNode, content: string): string[] {
    const baseList = node.children.find(child => child.type === 'base_list');
    if (!baseList) return [];

    return this.extractBaseTypesFromList(baseList, content);
  }

  private extractBaseTypesFromList(baseList: Parser.SyntaxNode, content: string): string[] {
    const baseTypes: string[] = [];

    for (const child of baseList.children) {
      if (child.type === 'identifier' || child.type === 'qualified_name') {
        const typeName = this.getNodeText(child, content).trim();
        if (typeName) baseTypes.push(typeName);
      }
    }

    return baseTypes;
  }

  private isGodotClass(baseTypes: string[]): boolean {
    return baseTypes.some(type => CSharpParser.GODOT_BASE_CLASSES.has(type));
  }

  private hasAttribute(node: Parser.SyntaxNode, attributeName: string, content: string): boolean {
    const attributes = this.findNodesOfType(node, 'attribute');
    return attributes.some(attr => {
      const text = this.getNodeText(attr, content);
      return text.includes(attributeName);
    });
  }

  private extractReturnType(node: Parser.SyntaxNode, content: string): string {
    const typeNode = node.children.find(
      child =>
        child.type === 'predefined_type' ||
        child.type === 'identifier' ||
        child.type === 'qualified_name' ||
        child.type === 'generic_name' ||
        child.type === 'array_type' ||
        child.type === 'nullable_type'
    );

    return typeNode ? this.getNodeText(typeNode, content) : 'void';
  }

  private extractParameters(node: Parser.SyntaxNode, content: string): ParameterInfo[] {
    const parameters: ParameterInfo[] = [];
    const parameterList = node.childForFieldName('parameters');

    if (!parameterList) return parameters;

    for (let i = 0; i < parameterList.childCount; i++) {
      const child = parameterList.child(i);
      if (child?.type === 'parameter') {
        const typeNode = child.childForFieldName('type');
        const nameNode = child.childForFieldName('name');

        if (typeNode && nameNode) {
          parameters.push({
            name: this.getNodeText(nameNode, content),
            type: this.getNodeText(typeNode, content),
            isRef: this.getNodeText(child, content).includes('ref '),
            isOut: this.getNodeText(child, content).includes('out '),
            isParams: this.getNodeText(child, content).includes('params '),
          });
        }
      }
    }

    return parameters;
  }

  private extractCallParameters(node: Parser.SyntaxNode, content: string): string[] {
    const parameters: string[] = [];
    const argumentList = this.findNodeOfType(node, 'argument_list');

    if (argumentList) {
      for (let i = 0; i < argumentList.childCount; i++) {
        const child = argumentList.child(i);
        if (child?.type === 'argument') {
          const text = this.getNodeText(child, content).trim();
          if (text) parameters.push(text);
        }
      }
    }

    return parameters;
  }

  private resolveType(typeString: string): string {
    // Remove interface prefix
    if (PATTERNS.interfacePrefix.test(typeString)) {
      return typeString.substring(1);
    }

    // Extract base type from generics
    const genericMatch = typeString.match(PATTERNS.genericType);
    if (genericMatch) {
      return genericMatch[1];
    }

    return typeString;
  }

  private buildQualifiedName(context: ASTContext, name: string): string {
    const parts: string[] = [];

    if (context.currentNamespace) {
      parts.push(context.currentNamespace);
    }

    if (context.currentClass && context.currentClass !== name) {
      parts.push(context.currentClass);
    }

    parts.push(name);

    return parts.join('.');
  }

  private findContainingMethod(node: Parser.SyntaxNode, context: ASTContext): string {
    let parent = node.parent;

    while (parent) {
      if (
        parent.type === 'method_declaration' ||
        parent.type === 'constructor_declaration' ||
        parent.type === 'property_declaration'
      ) {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          const methodName = this.getNodeText(nameNode, parent.tree.rootNode.text);
          return this.buildQualifiedName(context, methodName);
        }
      }
      parent = parent.parent;
    }

    return context.currentClass || context.currentNamespace || '<global>';
  }

  private findParentDeclaration(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    let parent = node.parent;

    while (parent) {
      if (
        parent.type === 'class_declaration' ||
        parent.type === 'interface_declaration' ||
        parent.type === 'struct_declaration'
      ) {
        return parent;
      }
      parent = parent.parent;
    }

    return null;
  }

  private findNodeOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === type) return child;
    }
    return null;
  }

  protected findNodesOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    const nodes: Parser.SyntaxNode[] = [];

    const traverse = (n: Parser.SyntaxNode) => {
      if (n.type === type) {
        nodes.push(n);
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) traverse(child);
      }
    };

    traverse(node);
    return nodes;
  }

  private buildClassSignature(name: string, modifiers: string[], baseTypes: string[]): string {
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    const inheritance = baseTypes.length > 0 ? ` : ${baseTypes.join(', ')}` : '';
    return `${modifierString}class ${name}${inheritance}`;
  }

  private buildInterfaceSignature(name: string, modifiers: string[], baseTypes: string[]): string {
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    const inheritance = baseTypes.length > 0 ? ` : ${baseTypes.join(', ')}` : '';
    return `${modifierString}interface ${name}${inheritance}`;
  }

  private buildMethodSignature(
    name: string,
    modifiers: string[],
    returnType: string,
    parameters: ParameterInfo[]
  ): string {
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    const paramString = parameters.map(p => `${p.type} ${p.name}`).join(', ');
    return `${modifierString}${returnType} ${name}(${paramString})`;
  }

  private buildConstructorSignature(
    name: string,
    modifiers: string[],
    parameters: ParameterInfo[]
  ): string {
    const modifierString = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
    const paramString = parameters.map(p => `${p.type} ${p.name}`).join(', ');
    return `${modifierString}${name}(${paramString})`;
  }

  protected shouldUseChunking(content: string, options: ChunkedParseOptions): boolean {
    const chunkingEnabled = options.enableChunking !== false;
    const exceedsSize = content.length > (options.chunkSize || this.DEFAULT_CHUNK_SIZE);
    return chunkingEnabled && exceedsSize;
  }

  private createErrorResult(message: string): ParseResult {
    return {
      symbols: [],
      dependencies: [],
      imports: [],
      exports: [],
      errors: [
        {
          message,
          line: 1,
          column: 1,
          severity: 'error',
        },
      ],
    };
  }

  private finalizeResult(result: ParseResult, options?: ParseOptions): ParseResult {
    const validatedOptions = this.validateOptions(options);

    // Filter private symbols if needed
    if (!validatedOptions.includePrivateSymbols) {
      result.symbols = result.symbols.filter(s => s.visibility !== Visibility.PRIVATE);
    }

    // Remove duplicate dependencies
    const uniqueDeps = new Map<string, ParsedDependency>();
    for (const dep of result.dependencies) {
      const key = `${dep.from_symbol}|${dep.to_symbol}|${dep.dependency_type}|${dep.line_number}`;
      if (!uniqueDeps.has(key)) {
        uniqueDeps.set(key, dep);
      }
    }
    result.dependencies = Array.from(uniqueDeps.values());

    return result;
  }

  // Chunked parsing implementation

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries: number[] = [];
    const tree = this.parser.parse(content);

    if (!tree?.rootNode) return boundaries;

    // Find top-level declarations
    const declarations = this.findTopLevelDeclarations(tree.rootNode, content);

    let currentSize = 0;

    for (const decl of declarations) {
      const declSize = decl.endIndex - decl.startIndex;

      if (currentSize + declSize > maxChunkSize && currentSize > 0) {
        boundaries.push(decl.startIndex - 1);
        currentSize = 0;
      }

      currentSize += declSize;
    }

    return boundaries;
  }

  private findTopLevelDeclarations(
    rootNode: Parser.SyntaxNode,
    _content: string
  ): Array<{ startIndex: number; endIndex: number; type: string }> {
    const declarations: Array<{ startIndex: number; endIndex: number; type: string }> = [];

    const topLevelTypes = [
      'namespace_declaration',
      'class_declaration',
      'interface_declaration',
      'struct_declaration',
      'enum_declaration',
      'delegate_declaration',
    ];

    for (const type of topLevelTypes) {
      const nodes = this.findNodesOfType(rootNode, type);
      for (const node of nodes) {
        // Only include actual top-level declarations
        let parent = node.parent;
        let isTopLevel = true;

        while (parent && parent !== rootNode) {
          if (topLevelTypes.includes(parent.type)) {
            isTopLevel = false;
            break;
          }
          parent = parent.parent;
        }

        if (isTopLevel) {
          declarations.push({
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            type: node.type,
          });
        }
      }
    }

    return declarations.sort((a, b) => a.startIndex - b.startIndex);
  }

  protected mergeChunkResults(
    chunks: ParseResult[],
    chunkMetadata: ChunkResult[]
  ): MergedParseResult {
    const merged: ParseResult = {
      symbols: [],
      dependencies: [],
      imports: [],
      exports: [],
      errors: [],
    };

    // Merge all chunks
    for (const chunk of chunks) {
      merged.symbols.push(...chunk.symbols);
      merged.dependencies.push(...chunk.dependencies);
      merged.imports.push(...chunk.imports);
      merged.exports.push(...chunk.exports);
      merged.errors.push(...chunk.errors);
    }

    // Remove duplicates
    merged.symbols = this.removeDuplicateSymbols(merged.symbols);
    merged.dependencies = this.removeDuplicateDependencies(merged.dependencies);

    return {
      ...merged,
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunkMetadata.length,
        duplicatesRemoved: 0,
        crossChunkReferencesFound: 0,
      },
    };
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

  // Required abstract method implementations

  protected extractSymbols(_rootNode: Parser.SyntaxNode, _content: string): ParsedSymbol[] {
    // This is handled by the single-pass extraction
    return [];
  }

  protected extractDependencies(
    _rootNode: Parser.SyntaxNode,
    _content: string
  ): ParsedDependency[] {
    // This is handled by the single-pass extraction
    return [];
  }

  protected extractImports(_rootNode: Parser.SyntaxNode, _content: string): ParsedImport[] {
    // This is handled by the single-pass extraction
    return [];
  }

  protected extractExports(_rootNode: Parser.SyntaxNode, _content: string): ParsedExport[] {
    // This is handled by the single-pass extraction
    return [];
  }
}
