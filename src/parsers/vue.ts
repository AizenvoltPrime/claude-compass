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
  VueComponent,
  VueComposable,
  VueRoute,
  PiniaStore,
  PropDefinition,
  ParsedDependency,
  ParsedSymbol,
  ParseResult,
} from './base';
import { DependencyType, SymbolType } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import { entityClassifier } from '../utils/entity-classifier';
import * as path from 'path';
import {
  normalizeUrlPattern,
  calculateUrlSimilarity,
  parseUrlConstruction,
  UrlPattern,
  RouteParameter,
} from './utils/url-patterns';
import { JavaScriptParser } from './javascript';
import { TypeScriptParser } from './typescript';
import {
  extractLeadingJSDocComment,
  extractDescriptionOnly,
  extractJSDocComment,
} from './utils/jsdoc-extractor';

const logger = createComponentLogger('vue-parser');

/**
 * API call information extracted from Vue components
 */
export interface VueApiCall extends FrameworkEntity {
  type: 'api_call';
  url: string;
  normalizedUrl: string;
  method: string;
  requestType?: string;
  responseType?: string;
  location: {
    line: number;
    column: number;
  };
  framework: 'vue';
}

/**
 * TypeScript interface information for API types
 */
export interface VueTypeInterface extends FrameworkEntity {
  type: 'type_interface';
  properties: Array<{
    name: string;
    type: string;
    optional: boolean;
  }>;
  usage: 'request' | 'response' | 'generic';
  framework: 'vue';
}

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
  private axiosIdentifiers: Set<string> = new Set(['axios']);
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

    const sections = this.extractSFCSections(content);

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
          const templateSymbols = this.extractTemplateSymbols(sections.template, filePath, options);
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
      const templateSymbols = this.extractTemplateSymbols(sections.template, filePath, options);
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
   * Parse Vue Single File Component with proper script extraction
   */
  private async parseVueSFC(
    filePath: string,
    content: string,
    options: FrameworkParseOptions
  ): Promise<ParseFileResult> {
    this.currentFilePath = filePath;
    this.currentOptions = options;

    const sections = this.extractSFCSections(content);

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

        // Delegate to JavaScriptParser or TypeScriptParser for proper JSDoc extraction
        const tempFilePath = filePath.replace('.vue', isTypeScript ? '.ts' : '.js');
        const parser = isTypeScript ? this.tsParser : this.jsParser;

        const parseResult = await parser.parseFile(tempFilePath, scriptContent!, options);
        symbols = parseResult.symbols;
        imports = parseResult.imports;
        exports = parseResult.exports;
        dependencies = parseResult.dependencies;
        errors = parseResult.errors || [];

        // Extract template symbols using lightweight parsing
        if (sections.template) {
          const templateSymbols = this.extractTemplateSymbols(sections.template, filePath, options);
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
      const templateSymbols = this.extractTemplateSymbols(sections.template, filePath, options);
      symbols.push(...templateSymbols);
    }

    // Detect framework entities
    const frameworkResult = await this.detectFrameworkEntities(content, filePath, options);

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
        isFrameworkSpecific: (frameworkResult.entities?.length || 0) > 0,
        fileType: 'vue-sfc',
      },
    };
  }

  private analyzeScriptInSinglePass(
    scriptContent: string,
    filePath: string,
    isTypeScript: boolean
  ): {
    apiCalls: VueApiCall[];
    typeInterfaces: VueTypeInterface[];
  } {
    const apiCalls: VueApiCall[] = [];
    const typeInterfaces: VueTypeInterface[] = [];

    try {
      const tree = this.parseScriptContent(scriptContent, isTypeScript);

      if (!tree?.rootNode) {
        return { apiCalls, typeInterfaces };
      }

      const traverse = (node: Parser.SyntaxNode) => {
        switch (node.type) {
          case 'call_expression': {
            const apiCall = this.parseApiCallExpression(node, scriptContent, filePath);
            if (apiCall) {
              apiCalls.push(apiCall);
            }
            break;
          }
          case 'interface_declaration': {
            if (isTypeScript) {
              const interfaceEntity = this.parseInterfaceDeclaration(node, scriptContent, filePath);
              if (interfaceEntity) {
                typeInterfaces.push(interfaceEntity);
              }
            }
            break;
          }
          case 'type_alias_declaration': {
            if (isTypeScript) {
              const typeEntity = this.parseTypeAliasDeclaration(node, scriptContent, filePath);
              if (typeEntity) {
                typeInterfaces.push(typeEntity);
              }
            }
            break;
          }
        }

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
      };

      traverse(tree.rootNode);
    } catch (error) {
      logger.warn(`Failed to analyze script in single pass for ${filePath}`, { error });
    }

    return { apiCalls, typeInterfaces };
  }

  /**
   * Extract API calls from Vue component script content
   */
  private extractApiCalls(scriptContent: string, filePath: string): VueApiCall[] {
    const apiCalls: VueApiCall[] = [];

    try {
      const isTypeScript =
        filePath.includes('.ts') ||
        scriptContent.includes('interface ') ||
        scriptContent.includes('type ');
      const tree = this.parseScriptContent(scriptContent, isTypeScript);

      if (!tree?.rootNode) {
        return apiCalls;
      }

      this.trackAxiosImports(tree.rootNode, scriptContent);

      const traverse = (node: Parser.SyntaxNode) => {
        // Detect various API call patterns
        if (node.type === 'call_expression') {
          const apiCall = this.parseApiCallExpression(node, scriptContent, filePath);
          if (apiCall) {
            apiCalls.push(apiCall);
          }
        }

        // Traverse child nodes
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
      };

      traverse(tree.rootNode);
    } catch (error) {
      logger.warn(`Failed to extract API calls from ${filePath}`, { error });
    }

    return apiCalls;
  }

  /**
   * Parse individual API call expression
   */
  private parseApiCallExpression(
    node: Parser.SyntaxNode,
    scriptContent: string,
    filePath: string
  ): VueApiCall | null {
    const functionNode = node.child(0);
    if (!functionNode) return null;

    const functionName = functionNode.text;
    const argsNode = node.child(1); // arguments node

    // Detect different API calling patterns
    let method = 'GET';
    let url = '';
    let requestType: string | undefined;
    let responseType: string | undefined;

    // Pattern 1: fetch('/api/users')
    if (functionName === 'fetch' || functionName === '$fetch') {
      const result = this.parseFetchCall(argsNode, scriptContent);
      if (result) {
        url = result.url;
        method = result.method;
        requestType = result.requestType;
        responseType = result.responseType;
      }
    }
    // Pattern 2: axios.get('/api/users') or axios('/api/users', {method: 'POST'})
    else if (functionName.includes('axios')) {
      const result = this.parseAxiosCall(functionNode, argsNode, scriptContent);
      if (result) {
        url = result.url;
        method = result.method;
        requestType = result.requestType;
        responseType = result.responseType;
      }
    }
    // Pattern 3: useFetch('/api/users') (Nuxt composable)
    else if (functionName === 'useFetch' || functionName === 'useLazyFetch') {
      const result = this.parseUseFetchCall(argsNode, scriptContent);
      if (result) {
        url = result.url;
        method = result.method;
        requestType = result.requestType;
        responseType = result.responseType;
      }
    }

    if (!url || !this.isValidApiUrl(url)) {
      return null;
    }

    // Normalize URL pattern
    const urlPattern = normalizeUrlPattern(url);

    return {
      type: 'api_call',
      name: `${method.toUpperCase()}_${url.replace(/[^a-zA-Z0-9]/g, '_')}`,
      filePath,
      url,
      normalizedUrl: urlPattern.normalized,
      method: method.toUpperCase(),
      requestType,
      responseType,
      location: {
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      },
      framework: 'vue',
      metadata: {
        urlPattern,
        originalCall: functionName,
      },
    };
  }

  /**
   * Parse fetch() or $fetch() call arguments
   */
  private parseFetchCall(
    argsNode: Parser.SyntaxNode | null,
    scriptContent: string
  ): {
    url: string;
    method: string;
    requestType?: string;
    responseType?: string;
  } | null {
    if (!argsNode || argsNode.childCount < 2) return null;

    let url = '';
    let method = 'GET';
    let requestType: string | undefined;
    let responseType: string | undefined;

    // First argument is URL
    const urlArg = argsNode.child(1);
    if (urlArg && (urlArg.type === 'string' || urlArg.type === 'template_string')) {
      url = this.extractStringValue(urlArg, scriptContent);
      if (url.includes('${') || url.includes('" + ') || url.includes("' + ")) {
      }
    }

    // Second argument might be options object
    if (argsNode.childCount > 3) {
      const optionsArg = argsNode.child(3);
      if (optionsArg && optionsArg.type === 'object_expression') {
        const methodProp = this.findObjectProperty(optionsArg, 'method');
        if (methodProp) {
          method = this.extractStringValue(methodProp, scriptContent).toUpperCase();
        }

        // Look for body type in TypeScript
        const bodyProp = this.findObjectProperty(optionsArg, 'body');
        if (bodyProp) {
          requestType = this.inferTypeFromExpression(bodyProp, scriptContent);
        }
      }
    }

    return url ? { url, method, requestType, responseType } : null;
  }

  /**
   * Parse axios call arguments
   */
  private parseAxiosCall(
    functionNode: Parser.SyntaxNode,
    argsNode: Parser.SyntaxNode | null,
    scriptContent: string
  ): {
    url: string;
    method: string;
    requestType?: string;
    responseType?: string;
  } | null {
    let method = 'GET';
    let url = '';

    if (functionNode.type === 'member_expression') {
      const object = functionNode.childForFieldName('object');
      const property = functionNode.childForFieldName('property');

      if (object && property) {
        const objectName = object.text;

        if (this.axiosIdentifiers.has(objectName)) {
          const methodName = property.text.toUpperCase();
          const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

          if (validMethods.includes(methodName)) {
            method = methodName;
          }
        } else {
          return null;
        }
      }
    }

    // Extract URL from first argument
    if (argsNode && argsNode.childCount > 1) {
      const urlArg = argsNode.child(1);
      if (urlArg && (urlArg.type === 'string' || urlArg.type === 'template_string')) {
        url = this.extractStringValue(urlArg, scriptContent);
      }
    }

    return url ? { url, method } : null;
  }

  /**
   * Parse useFetch() call arguments (Nuxt.js)
   */
  private parseUseFetchCall(
    argsNode: Parser.SyntaxNode | null,
    scriptContent: string
  ): {
    url: string;
    method: string;
    requestType?: string;
    responseType?: string;
  } | null {
    if (!argsNode || argsNode.childCount < 2) return null;

    const urlArg = argsNode.child(1);
    if (!urlArg) return null;

    let url = '';
    let method = 'GET';
    let responseType: string | undefined;

    // Handle different useFetch patterns
    if (urlArg.type === 'arrow_function' || urlArg.type === 'function_expression') {
      // useFetch(() => `/api/users/${id}`)
      url = this.extractUrlFromFunction(urlArg, scriptContent);
    } else if (urlArg.type === 'string' || urlArg.type === 'template_string') {
      // useFetch('/api/users')
      url = this.extractStringValue(urlArg, scriptContent);
    }

    // Try to extract response type from TypeScript generics
    // useFetch<UserResponse>('/api/users')
    const parentCall = urlArg.parent?.parent;
    if (parentCall && parentCall.type === 'call_expression') {
      responseType = this.extractGenericType(parentCall, scriptContent);
    }

    return url ? { url, method, responseType } : null;
  }

  /**
   * Extract TypeScript interfaces used in API calls
   */
  private parseTypeScriptInterfaces(scriptContent: string, filePath: string): VueTypeInterface[] {
    const interfaces: VueTypeInterface[] = [];

    try {
      const tree = this.parseScriptContent(scriptContent, true);
      if (!tree?.rootNode) return interfaces;

      const traverse = (node: Parser.SyntaxNode) => {
        if (node.type === 'interface_declaration') {
          const interfaceEntity = this.parseInterfaceDeclaration(node, scriptContent, filePath);
          if (interfaceEntity) {
            interfaces.push(interfaceEntity);
          }
        }

        // Also look for type aliases
        if (node.type === 'type_alias_declaration') {
          const typeEntity = this.parseTypeAliasDeclaration(node, scriptContent, filePath);
          if (typeEntity) {
            interfaces.push(typeEntity);
          }
        }

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
      };

      traverse(tree.rootNode);
    } catch (error) {
      logger.warn(`Failed to extract TypeScript interfaces from ${filePath}`, { error });
    }

    return interfaces;
  }

  /**
   * Parse interface declaration node
   */
  private parseInterfaceDeclaration(
    node: Parser.SyntaxNode,
    scriptContent: string,
    filePath: string
  ): VueTypeInterface | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const interfaceName = nameNode.text;
    const properties: VueTypeInterface['properties'] = [];

    // Extract interface body
    const bodyNode = node.childForFieldName('body');
    if (bodyNode && bodyNode.type === 'object_type') {
      for (let i = 0; i < bodyNode.childCount; i++) {
        const child = bodyNode.child(i);
        if (child && child.type === 'property_signature') {
          const prop = this.parsePropertySignature(child, scriptContent);
          if (prop) {
            properties.push(prop);
          }
        }
      }
    }

    // Determine usage based on naming conventions
    let usage: VueTypeInterface['usage'] = 'generic';
    const lowerName = interfaceName.toLowerCase();
    if (
      lowerName.includes('request') ||
      lowerName.includes('input') ||
      lowerName.includes('create') ||
      lowerName.includes('update')
    ) {
      usage = 'request';
    } else if (
      lowerName.includes('response') ||
      lowerName.includes('result') ||
      lowerName.includes('data')
    ) {
      usage = 'response';
    }

    return {
      type: 'type_interface',
      name: interfaceName,
      filePath,
      properties,
      usage,
      framework: 'vue',
      metadata: {
        isInterface: true,
        location: {
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        },
      },
    };
  }

  /**
   * Parse type alias declaration node
   */
  private parseTypeAliasDeclaration(
    node: Parser.SyntaxNode,
    scriptContent: string,
    filePath: string
  ): VueTypeInterface | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const typeName = nameNode.text;

    // For type aliases, we'll extract what we can
    return {
      type: 'type_interface',
      name: typeName,
      filePath,
      properties: [], // Type aliases are harder to analyze structurally
      usage: 'generic',
      framework: 'vue',
      metadata: {
        isInterface: false,
        isTypeAlias: true,
        location: {
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        },
      },
    };
  }

  /**
   * Helper methods for parsing API calls and types
   */
  private trackAxiosImports(rootNode: Parser.SyntaxNode, content: string): void {
    this.axiosIdentifiers.clear();
    this.axiosIdentifiers.add('axios');

    const traverse = (node: Parser.SyntaxNode): void => {
      if (node.type === 'import_statement') {
        const source = node.childForFieldName('source');
        if (source && this.extractStringValue(source, content).includes('axios')) {
          const importClause = node.children.find(n => n.type === 'import_clause');
          if (importClause) {
            for (const child of importClause.children) {
              if (child.type === 'identifier') {
                this.axiosIdentifiers.add(child.text);
              } else if (child.type === 'named_imports') {
                for (const namedImport of child.children) {
                  if (namedImport.type === 'import_specifier') {
                    const localName =
                      namedImport.childForFieldName('name') ||
                      namedImport.children.find(c => c.type === 'identifier');
                    if (localName) {
                      this.axiosIdentifiers.add(localName.text);
                    }
                  }
                }
              }
            }
          }
        }
      } else if (node.type === 'variable_declarator') {
        const value = node.childForFieldName('value');
        if (value && value.type === 'call_expression') {
          const func = value.childForFieldName('function');
          if (func && func.type === 'member_expression') {
            const funcText = func.text;
            if (funcText.includes('axios.create')) {
              const name = node.childForFieldName('name');
              if (name) {
                this.axiosIdentifiers.add(name.text);
              }
            }
          }
        }
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(rootNode);
  }

  private extractStringValue(node: Parser.SyntaxNode, content: string): string {
    if (node.type === 'string' || node.type === 'template_string') {
      const text = node.text;
      if (text.startsWith('`') && text.endsWith('`')) {
        return text.slice(1, -1);
      }
      if (
        (text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))
      ) {
        return text.slice(1, -1);
      }
      return text;
    }
    return '';
  }

  private isValidApiUrl(url: string): boolean {
    if (!url || typeof url !== 'string') {
      return false;
    }

    if (!url.startsWith('/') && !url.startsWith('http')) {
      return false;
    }

    if (url.includes('.') && !url.includes('://')) {
      return false;
    }

    if (url.includes('(') || url.includes(')')) {
      return false;
    }

    const singleWordPattern = /^[a-z]+$/;
    if (singleWordPattern.test(url)) {
      return false;
    }

    return true;
  }

  private findObjectProperty(
    objectNode: Parser.SyntaxNode,
    propertyName: string
  ): Parser.SyntaxNode | null {
    for (let i = 0; i < objectNode.childCount; i++) {
      const child = objectNode.child(i);
      if (child && child.type === 'pair') {
        const keyNode = child.child(0);
        if (keyNode && keyNode.text.includes(propertyName)) {
          return child.child(2); // Return value node
        }
      }
    }
    return null;
  }

  private inferTypeFromExpression(node: Parser.SyntaxNode, content: string): string | undefined {
    // Basic type inference from expressions
    if (node.type === 'object_expression') {
      return 'object';
    }
    if (node.type === 'array_expression') {
      return 'array';
    }
    if (node.type === 'string' || node.type === 'template_string') {
      return 'string';
    }
    return undefined;
  }

  private extractUrlFromFunction(functionNode: Parser.SyntaxNode, content: string): string {
    // Extract URL from arrow function or function expression
    // This is a simplified extraction - could be enhanced
    const body = functionNode.childForFieldName('body');
    if (body) {
      return this.extractStringValue(body, content);
    }
    return '';
  }

  private extractGenericType(callNode: Parser.SyntaxNode, content: string): string | undefined {
    // Look for TypeScript generics in call expression
    const typeArgs = callNode.childForFieldName('type_arguments');
    if (typeArgs && typeArgs.childCount > 0) {
      const firstType = typeArgs.child(1); // Skip opening bracket
      if (firstType) {
        return firstType.text;
      }
    }
    return undefined;
  }

  private parsePropertySignature(
    node: Parser.SyntaxNode,
    content: string
  ): VueTypeInterface['properties'][0] | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const typeNode = node.childForFieldName('type');
    const isOptional = node.text.includes('?');

    return {
      name: nameNode.text,
      type: typeNode ? typeNode.text : 'any',
      optional: isOptional,
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
        const stores = await this.parsePiniaStore(content, filePath, options);
        entities.push(...stores);
      } else if (this.isRouterFile(filePath, content)) {
        // Parse Vue Router routes
        const routes = await this.parseVueRouterRoutes(content, filePath, options);
        entities.push(...routes);
      } else if (this.isComposableFile(filePath, content)) {
        // Parse Vue composables (check after more specific types)
        const composables = await this.parseComposables(content, filePath, options);
        entities.push(...composables);
      } else if (this.isVueComponentFile(content)) {
        // Parse regular Vue component (non-SFC)
        const component = await this.parseVueComponent(content, filePath, options);
        if (component) {
          entities.push(component);
        }
      }

      // Extract API calls and TypeScript interfaces from script content
      const sections = this.extractSFCSections(content);
      const scriptContent = sections.scriptSetup || sections.script;

      if (scriptContent) {
        const isTypeScript =
          sections.scriptLang === 'ts' ||
          filePath.includes('.ts') ||
          scriptContent.includes('interface ') ||
          scriptContent.includes('type ');

        const { apiCalls, typeInterfaces } = this.analyzeScriptInSinglePass(
          scriptContent,
          filePath,
          isTypeScript
        );

        entities.push(...apiCalls);
        if (isTypeScript) {
          entities.push(...typeInterfaces);
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
    options: FrameworkParseOptions
  ): Promise<FrameworkEntity | null> {
    const sections = this.extractSFCSections(content);
    const componentName = this.extractComponentName(filePath);
    // Parse script content if available
    let scriptTree = null;
    const scriptContent = sections.scriptSetup || sections.script;
    if (scriptContent) {
      try {
        // Use TypeScript parser for TS content, otherwise use JavaScript parser
        const isTypeScript = sections.scriptLang === 'ts' || content.includes('lang="ts"');

        // Check if script content is too large and skip tree parsing for framework entity extraction
        if (scriptContent.length > 28000) {
          // For large scripts, we skip detailed parsing for framework entities
          // The symbols will be extracted via the main parseFile path with chunking
          scriptTree = null;
        } else {
          scriptTree = this.parseScriptContent(scriptContent, isTypeScript);
        }
      } catch (error) {
        logger.warn(`Failed to parse script section for ${filePath}`, { error });
        // Continue with component creation even if script parsing fails
        scriptTree = null;
      }
    }

    let componentDescription: string | undefined;
    if (scriptTree) {
      const jsdocComment = extractLeadingJSDocComment(scriptTree.rootNode, scriptContent!);
      if (jsdocComment) {
        componentDescription = extractDescriptionOnly(jsdocComment);
      }
    }

    // Extract enhanced metadata (with error handling)
    let builtInComponents = [];
    let directives = [];
    let scopedSlots = [];
    let templateRefs = [];
    let dynamicComponents = [];
    let eventHandlers = [];
    let props: PropDefinition[] = [];
    let emits: string[] = [];
    let lifecycle = [];

    try {
      builtInComponents = sections.template ? this.extractBuiltInComponents(sections.template) : [];
      directives = sections.template ? this.extractDirectives(sections.template) : [];
      scopedSlots = sections.template ? this.extractScopedSlots(sections.template) : [];
      templateRefs = sections.template ? this.extractTemplateRefs(sections.template) : [];
      dynamicComponents = sections.template ? this.extractDynamicComponents(sections.template) : [];
      eventHandlers = sections.template ? this.extractEventHandlers(sections.template) : [];

      // Extract basic component properties (single-pass optimization)
      if (scriptTree) {
        const extracted = this.extractVuePropsAndEmits(scriptTree);
        props = extracted.props;
        emits = extracted.emits;
      } else {
        props = [];
        emits = [];
      }
      lifecycle = scriptTree ? this.extractLifecycleHooks(scriptTree, content) : [];
    } catch (error) {
      logger.warn(`Failed to extract Vue component metadata for ${filePath}`, { error });
      // Continue with empty arrays - better to have a basic component than no component
    }

    // Extract advanced Composition API patterns (with error handling)
    let advancedComposition = {
      provide: [],
      inject: [],
      defineExpose: [],
      defineModel: [],
      watchEffect: [],
      computed: [],
    };
    let vueUseComposables = [];
    let vitePatterns = { globImports: [], envVariables: [], hotReload: false };
    let stylingFeatures = {};
    let typescriptFeatures = {
      interfaces: [],
      types: [],
      generics: [],
      imports: [],
    };

    try {
      advancedComposition = scriptTree
        ? this.extractAdvancedCompositionAPI(scriptTree)
        : advancedComposition;
      vueUseComposables = scriptTree ? this.extractVueUseComposables(scriptTree) : [];
      vitePatterns = this.extractVitePatterns(content);
      stylingFeatures = this.extractStylingFeatures(content);
      typescriptFeatures = scriptTree
        ? this.extractTypeScriptFeatures(content, scriptTree)
        : typescriptFeatures;
    } catch (error) {
      logger.warn(`Failed to extract advanced Vue component features for ${filePath}`, { error });
      // Continue with default values
    }

    const component: VueComponent = {
      type: 'component',
      name: componentName,
      filePath,
      description: componentDescription,
      props,
      emits,
      slots: scopedSlots.map(s => s.name),
      composables: [],
      template_dependencies: eventHandlers.map(e => e.handler),
      metadata: {
        // Basic SFC metadata
        scriptSetup: !!sections.scriptSetup,
        hasScript: !!(sections.script || sections.scriptSetup),
        hasTemplate: !!sections.template,
        hasStyle: !!sections.style,
        scriptLang: sections.scriptLang || (filePath.includes('.ts') ? 'ts' : 'js'),

        // Component lifecycle
        lifecycle,

        // Vue 3 built-in components
        builtInComponents,
        teleportTargets: this.extractTeleportTargets(sections.template || ''),
        hasAsyncComponents: builtInComponents.includes('Suspense'),
        hasCaching: builtInComponents.includes('KeepAlive'),
        hasAnimations: builtInComponents.some(c => c.includes('Transition')),
        transitionNames: this.extractTransitionNames(sections.template || ''),

        // Advanced Composition API
        providedKeys: advancedComposition.provide.map(p => p.key),
        injectedKeys: advancedComposition.inject.map(i => i.key),
        hasProvideInject:
          advancedComposition.provide.length > 0 || advancedComposition.inject.length > 0,
        exposedMethods: advancedComposition.defineExpose,
        exposedProperties: advancedComposition.defineExpose,
        hasDefineExpose: advancedComposition.defineExpose.length > 0,
        models: advancedComposition.defineModel.map(m => m.name),
        hasDefineModel: advancedComposition.defineModel.length > 0,

        // Template analysis
        directives: {
          builtin: directives.filter(d => d.type === 'built-in').map(d => `v-${d.name}`),
          custom: directives.filter(d => d.type === 'custom').map(d => `v-${d.name}`),
        },
        eventHandlers: eventHandlers.map(h => h.event),
        scopedSlots: scopedSlots.map(s => s.name),
        hasScopedSlots: scopedSlots.length > 0,
        templateRefs,
        hasTemplateRefs: templateRefs.length > 0,
        hasDynamicComponents: dynamicComponents.length > 0,
        dynamicComponentVariables: dynamicComponents,

        // VueUse integration
        vueUseComposables,
        hasVueUse: vueUseComposables.length > 0,

        // Vite patterns
        vitePatterns: {
          globImports: vitePatterns.globImports,
          envVariables: vitePatterns.envVariables,
          hasGlobImports: vitePatterns.globImports.length > 0,
          hasEnvVariables: vitePatterns.envVariables.length > 0,
          hasHotReload: vitePatterns.hotReload,
        },

        // Styling features
        styling: {
          cssModules: this.extractCSSModules(content),
          hasCSSModules: sections.styleModules === true,
          preprocessors: this.extractPreprocessors(content),
          hasPreprocessors:
            sections.styleLang !== undefined &&
            ['scss', 'sass', 'less', 'stylus'].includes(sections.styleLang),
          scoped: sections.styleScoped === true,
          variables: this.extractCSSVariables(content),
          hasDynamicStyling: this.hasDynamicStyling(content),
          dynamicStyleVariables: this.extractDynamicStyleVariables(content),
        },

        // TypeScript integration
        typescript: (() => {
          const genericFunctions = this.extractGenericFunctions(content);
          const utilityTypes = this.extractUtilityTypes(content);
          return {
            interfaces: typescriptFeatures.interfaces.map(i => i.name),
            types: typescriptFeatures.types.map(t => t.name),
            utilityTypes,
            hasTypeScript: sections.scriptLang === 'ts' || content.includes('lang="ts"'),
            hasGenerics: typescriptFeatures.generics.length > 0 || genericFunctions.length > 0,
            genericFunctions,
            hasUtilityTypes: this.hasUtilityTypes(content),
          };
        })(),
      },
    };

    return component;
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
   * Parse Vue Single File Component (.vue files)
   */
  private async parseSingleFileComponent(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<VueComponent | null> {
    try {
      // Extract sections from SFC
      const sections = this.extractSFCSections(content);

      if (!sections.script && !sections.template) {
        logger.warn(`Vue SFC has no script or template section: ${filePath}`);
        // Still create a basic component entity for empty Vue files
      }

      const componentName = this.extractComponentName(filePath);

      // Parse script section for component logic
      let props: PropDefinition[] = [];
      let emits: string[] = [];
      let composables: string[] = [];
      let templateDependencies: string[] = [];
      let scriptSymbols: any[] = [];
      let scriptImports: any[] = [];

      if (sections.script || sections.scriptSetup) {
        const scriptContent = sections.scriptSetup || sections.script;
        const scriptAnalysis = await this.analyzeVueScript(scriptContent!, filePath);
        props = scriptAnalysis.props;
        emits = scriptAnalysis.emits;
        composables = scriptAnalysis.composables;

        // Also extract symbols and imports from script content using delegation
        const isTypeScript = sections.scriptLang === 'ts' || content.includes('lang="ts"');
        const tempFilePath = filePath.replace('.vue', isTypeScript ? '.ts' : '.js');
        const parser = isTypeScript ? this.tsParser : this.jsParser;

        try {
          const parseResult = await parser.parseFile(tempFilePath, scriptContent!, {});
          scriptSymbols = parseResult.symbols;
          scriptImports = parseResult.imports;
        } catch (error) {
          // Continue even if parsing fails
          logger.warn(`Failed to parse Vue script section: ${error.message}`);
        }
      }

      // Parse template section for component dependencies and advanced features
      let builtInComponents: string[] = [];
      let directives: Array<{
        name: string;
        type: 'built-in' | 'custom';
        modifiers: string[];
        arguments?: string;
      }> = [];
      let scopedSlots: Array<{ name: string; props: string[] }> = [];
      let templateRefs: string[] = [];
      let dynamicComponents: string[] = [];
      let eventHandlers: Array<{ event: string; handler: string; modifiers: string[] }> = [];

      if (sections.template) {
        templateDependencies = this.extractTemplateDependencies(sections.template);
        builtInComponents = this.extractBuiltInComponents(sections.template);
        directives = this.extractDirectives(sections.template);
        scopedSlots = this.extractScopedSlots(sections.template);
        templateRefs = this.extractTemplateRefs(sections.template);
        dynamicComponents = this.extractDynamicComponents(sections.template);
        eventHandlers = this.extractEventHandlers(sections.template);

        // Extract template symbols using lightweight parsing
        if (sections.template) {
          const templateSymbols = this.extractTemplateSymbols(sections.template, filePath, options);
          scriptSymbols.push(...templateSymbols);
        }
      }

      // Extract slots from template
      const slots = sections.template ? this.extractSlots(sections.template) : [];

      // Detect lifecycle methods from script content
      let lifecycleMethods: string[] = [];
      let advancedComposition: any = {};
      let vueUseComposables: string[] = [];
      let typeScriptFeatures: any = {};
      if (sections.script || sections.scriptSetup) {
        const scriptContent = sections.scriptSetup || sections.script;
        lifecycleMethods = this.extractLifecycleMethods(scriptContent!);

        // Parse the script content with Tree-sitter for advanced analysis
        const isTypeScript = sections.scriptLang === 'ts' || filePath.endsWith('.ts');
        const tree = this.parseScriptContent(scriptContent!, isTypeScript);
        if (tree?.rootNode) {
          advancedComposition = this.extractAdvancedCompositionAPI(tree);
          vueUseComposables = this.extractVueUseComposables(tree);

          // Extract TypeScript features if the file is TypeScript
          if (isTypeScript) {
            typeScriptFeatures = this.extractTypeScriptFeatures(scriptContent!, tree);
          }
        }
      }

      // Extract Vite patterns and styling features from the entire file content
      const vitePatterns = this.extractVitePatterns(content);
      const stylingFeatures = this.extractStylingFeatures(content);
      const testingPatterns = this.extractTestingPatterns(filePath);

      const component: VueComponent = {
        type: 'component',
        name: componentName,
        filePath,
        props,
        emits,
        slots,
        composables: [...composables, ...vueUseComposables],
        template_dependencies: templateDependencies,
        metadata: {
          scriptSetup: sections.scriptSetup !== null,
          hasScript: sections.script !== null || sections.scriptSetup !== null,
          hasTemplate: sections.template !== null,
          hasStyle: sections.style !== null,
          scriptLang: sections.scriptLang || 'js',
          props: props.map(p => p.name),
          emits: emits,
          lifecycle: lifecycleMethods,
          // Vue 3 built-in components
          builtInComponents,
          // Advanced Composition API
          advancedComposition,
          // VueUse composables
          vueUseComposables,
          // Template analysis
          directives: directives.map(d => ({
            name: d.name,
            type: d.type,
            modifiers: d.modifiers,
            arguments: d.arguments,
          })),
          scopedSlots,
          templateRefs,
          dynamicComponents,
          eventHandlers,
          // Vite patterns
          vitePatterns,
          // Styling features
          styling: {
            cssModules: this.extractCSSModules(content),
            hasCSSModules: /<style\s+module/.test(content),
            preprocessors: this.extractPreprocessors(content),
            hasPreprocessors: /<style\s+[^>]*lang=["'](scss|sass|less|stylus)["']/.test(content),
            scoped: /<style[^>]*\s+scoped/.test(content),
            variables: this.extractCSSVariables(content),
            hasDynamicStyling: this.hasDynamicStyling(content),
            dynamicStyleVariables: this.extractDynamicStyleVariables(content),
          },
          // Testing patterns
          testingPatterns,
          // TypeScript features
          typeScriptFeatures,
        },
      };

      return component;
    } catch (error) {
      logger.error(`Failed to parse Vue SFC: ${filePath}`, { error });
      return null;
    }
  }

  /**
   * Extract <template>, <script>, <style> sections from Vue SFC
   */

  /**
   * Analyze Vue script section for component metadata
   */
  private async analyzeVueScript(
    scriptContent: string,
    filePath: string
  ): Promise<{
    props: PropDefinition[];
    emits: string[];
    composables: string[];
  }> {
    // Skip detailed analysis for large scripts to avoid Tree-sitter limits
    if (scriptContent.length > 28000) {
      return { props: [], emits: [], composables: [] };
    }

    const tree = this.parseContent(scriptContent);

    const { props, emits } = this.extractVuePropsAndEmits(tree);

    return {
      props,
      emits,
      composables: this.extractVueComposables(tree),
    };
  }

  /**
   * Extract props from a TypeScript interface or type alias definition by traversing the AST.
   * Searches for interface declarations or type aliases matching the given type name
   * and extracts property definitions with their types and optionality.
   *
   * @param rootNode - The root AST node to search within
   * @param typeName - The name of the interface or type alias to extract props from
   * @returns Array of prop definitions with name, type, and required status
   */
  private extractPropsFromTypeDefinition(
    rootNode: Parser.SyntaxNode,
    typeName: string
  ): PropDefinition[] {
    const props: PropDefinition[] = [];

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'interface_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode?.text === typeName) {
          const bodyNode = node.childForFieldName('body');
          if (bodyNode) {
            props.push(...this.parseInterfaceBody(bodyNode));
          }
        }
      }

      if (node.type === 'type_alias_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode?.text === typeName) {
          const valueNode = node.childForFieldName('value');
          if (valueNode?.type === 'object_type') {
            props.push(...this.parseInterfaceBody(valueNode));
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(rootNode);
    return props;
  }

  /**
   * Parse an interface body or object type node to extract property definitions.
   * Iterates through property signatures and extracts property name, type annotation,
   * and optional status by checking for '?' token in the AST.
   *
   * @param bodyNode - The AST node representing an interface body or object type
   * @returns Array of prop definitions extracted from the interface/object type
   */
  private parseInterfaceBody(bodyNode: Parser.SyntaxNode): PropDefinition[] {
    const props: PropDefinition[] = [];

    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i);
      if (child && child.type === 'property_signature') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');

        if (nameNode) {
          const propName = nameNode.text;

          // Check for optional marker by looking for '?' token in child nodes
          let isOptional = false;
          for (let j = 0; j < child.childCount; j++) {
            const token = child.child(j);
            if (token && token.type === '?') {
              isOptional = true;
              break;
            }
          }

          let propType = typeNode?.text || 'any';

          if (propType.startsWith(':')) {
            propType = propType.substring(1).trim();
          }

          props.push({
            name: propName,
            type: propType,
            required: !isOptional,
          });
        }
      }
    }

    return props;
  }

  /**
   * Extract Vue component props and emits in a single optimized AST traversal.
   * This method combines the functionality of extractVueProps and extractVueEmits
   * to avoid duplicate tree traversals, improving parser performance for large files.
   *
   * Supports:
   * - Composition API: defineProps(), defineEmits()
   * - Options API: props and emits properties
   * - TypeScript type annotations for both props and emits
   * - Runtime $emit and emit() calls
   *
   * @param tree - The parsed AST tree from Tree-sitter
   * @returns Object containing arrays of props and emits extracted from the AST
   */
  private extractVuePropsAndEmits(tree: Parser.Tree): { props: PropDefinition[]; emits: string[] } {
    const props: PropDefinition[] = [];
    const emits: string[] = [];

    if (!tree?.rootNode) return { props, emits };

    const traverse = (node: Parser.SyntaxNode) => {
      try {
        if (node.type === 'call_expression') {
          const functionNode = node.child(0);

          // Extract props from defineProps
          if (functionNode?.text === 'defineProps') {
            const secondChild = node.child(1);

            if (secondChild?.type === 'type_arguments') {
              const typeIdentifier = secondChild.child(1);
              if (typeIdentifier?.type === 'type_identifier') {
                const typeName = typeIdentifier.text;
                const interfaceProps = this.extractPropsFromTypeDefinition(tree.rootNode, typeName);
                props.push(...interfaceProps);
              }
            } else if (secondChild?.type === 'arguments') {
              const propsArg = secondChild.child(1);
              if (propsArg) {
                props.push(...this.parsePropsFromNode(propsArg));
              }
            }
          }

          // Extract emits from defineEmits
          if (functionNode?.text === 'defineEmits') {
            const secondChild = node.child(1);

            if (secondChild?.type === 'type_arguments') {
              const typeNode = secondChild.child(1);
              if (typeNode) {
                const typeEmits = this.extractEmitsFromTypeNode(typeNode, tree.rootNode);
                emits.push(...typeEmits);
              }
            } else if (secondChild?.type === 'arguments') {
              const emitsArg = secondChild.child(1);
              if (emitsArg?.type === 'array') {
                for (let i = 0; i < emitsArg.childCount; i++) {
                  const child = emitsArg.child(i);
                  if (child) {
                    const emitName = this.extractStringLiteral(child);
                    if (emitName) {
                      emits.push(emitName);
                    }
                  }
                }
              }
            }
          }

          // Extract emit calls ($emit or emit)
          const caller = node.child(0);
          if (caller?.type === 'member_expression') {
            const object = caller.child(0)?.text;
            const property = caller.child(2)?.text;

            if (object === '$emit' || property === 'emit') {
              const argsNode = node.child(1);
              const firstArg = argsNode?.child(1);
              const emitName = this.extractStringLiteral(firstArg);
              if (emitName && !emits.includes(emitName)) {
                emits.push(emitName);
              }
            }
          }
        }

        if (node.type === 'pair') {
          const keyNode = node.child(0);

          // Extract props from object-based props definition
          if (keyNode?.text === 'props') {
            const propsValue = node.child(2);
            if (propsValue) {
              props.push(...this.parsePropsFromNode(propsValue));
            }
          }

          // Extract emits from array-based emits definition
          if (keyNode?.text === 'emits') {
            const emitsValue = node.child(2);
            if (emitsValue?.type === 'array') {
              for (let i = 0; i < emitsValue.childCount; i++) {
                const child = emitsValue.child(i);
                if (child) {
                  const emitName = this.extractStringLiteral(child);
                  if (emitName) {
                    emits.push(emitName);
                  }
                }
              }
            }
          }
        }

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
      } catch (error) {
        logger.warn('Error traversing AST node during props/emits extraction', {
          nodeType: node.type,
          error,
        });
      }
    };

    traverse(tree.rootNode);
    return { props, emits };
  }

  /**
   * Parse props from an AST node (object or array)
   */
  private parsePropsFromNode(node: any): PropDefinition[] {
    const props: PropDefinition[] = [];

    if (!node) return props;

    // Handle array format: ['prop1', 'prop2']
    if (node.type === 'array') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          const propName = this.extractStringLiteral(child);
          if (propName) {
            props.push({
              name: propName,
              type: 'unknown',
              required: false,
            });
          }
        }
      }
      return props;
    }

    // Handle object format: { prop1: String, prop2: { type: Number, required: true } }
    if (node.type === 'object') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === 'pair') {
          const propNameNode = child.child(0);
          const propName = this.extractStringLiteral(propNameNode) || propNameNode?.text;

          if (propName) {
            const propValue = child.child(2); // After property name and ':'

            if (propValue) {
              props.push(this.parsePropDefinition(propName, propValue));
            }
          }
        }
      }
    }

    return props;
  }

  /**
   * Parse a single prop definition
   */
  private parsePropDefinition(name: string, valueNode: any): PropDefinition {
    const prop: PropDefinition = {
      name,
      type: 'unknown',
      required: false,
    };

    if (!valueNode) return prop;

    // Simple type: prop: String
    if (valueNode.type === 'identifier') {
      prop.type = valueNode.text.toLowerCase();
      return prop;
    }

    // Object definition: prop: { type: String, required: true, default: 'value' }
    if (valueNode.type === 'object') {
      for (let i = 0; i < valueNode.childCount; i++) {
        const child = valueNode.child(i);
        if (child && child.type === 'pair') {
          const keyNode = child.child(0);
          const key = keyNode?.text;
          const value = child.child(2);

          if (key === 'type' && value?.type === 'identifier') {
            prop.type = value.text.toLowerCase();
          } else if (key === 'required' && value?.text === 'true') {
            prop.required = true;
          } else if (key === 'default') {
            prop.default = this.extractStringLiteral(value) || value?.text;
          }
        }
      }
    }

    return prop;
  }

  /**
   * Extract emits from a TypeScript type node, supporting multiple type formats.
   * Handles tuple types, array types, object types with method signatures,
   * and type identifier references to named types.
   *
   * @param typeNode - The AST node representing the emits type annotation
   * @param rootNode - The root AST node for resolving type references
   * @returns Array of emit event names extracted from the type definition
   */
  private extractEmitsFromTypeNode(
    typeNode: Parser.SyntaxNode,
    rootNode: Parser.SyntaxNode
  ): string[] {
    const emits: string[] = [];

    if (typeNode.type === 'tuple_type' || typeNode.type === 'array_type') {
      for (let i = 0; i < typeNode.childCount; i++) {
        const child = typeNode.child(i);
        if (child) {
          const emitName = this.extractStringLiteral(child);
          if (emitName) {
            emits.push(emitName);
          }
        }
      }
    } else if (typeNode.type === 'object_type') {
      for (let i = 0; i < typeNode.childCount; i++) {
        const child = typeNode.child(i);
        if (child?.type === 'call_signature' || child?.type === 'method_signature') {
          const params = child.childForFieldName('parameters');
          if (params) {
            const firstParam = params.child(1);
            if (firstParam) {
              const typeAnnotation = firstParam.childForFieldName('type');
              if (typeAnnotation) {
                const emitName = this.extractStringLiteral(typeAnnotation);
                if (emitName) {
                  emits.push(emitName);
                }
              }
            }
          }
        }
      }
    } else if (typeNode.type === 'type_identifier') {
      const typeName = typeNode.text;
      const typeEmits = this.extractEmitsFromTypeDefinition(rootNode, typeName);
      emits.push(...typeEmits);
    }

    return emits;
  }

  /**
   * Extract emits from a TypeScript type alias definition by name.
   * Searches the AST for type alias declarations matching the given type name
   * and recursively extracts emit event names from the type definition.
   *
   * @param rootNode - The root AST node to search within
   * @param typeName - The name of the type alias to extract emits from
   * @returns Array of emit event names found in the type definition
   */
  private extractEmitsFromTypeDefinition(rootNode: Parser.SyntaxNode, typeName: string): string[] {
    const emits: string[] = [];

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'type_alias_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode?.text === typeName) {
          const valueNode = node.childForFieldName('value');
          if (valueNode) {
            emits.push(...this.extractEmitsFromTypeNode(valueNode, rootNode));
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(rootNode);
    return emits;
  }

  /**
   * Extract Vue component emits from AST
   * @deprecated Use extractVuePropsAndEmits for better performance
   */
  private extractVueEmits(tree: Parser.Tree): string[] {
    const emits: string[] = [];

    if (!tree?.rootNode) return emits;

    const traverse = (node: Parser.SyntaxNode) => {
      try {
        if (node.type === 'call_expression') {
          const functionNode = node.child(0);
          if (functionNode?.text === 'defineEmits') {
            const secondChild = node.child(1);

            if (secondChild?.type === 'type_arguments') {
              const typeNode = secondChild.child(1);
              if (typeNode) {
                const typeEmits = this.extractEmitsFromTypeNode(typeNode, tree.rootNode);
                emits.push(...typeEmits);
              }
            } else if (secondChild?.type === 'arguments') {
              const emitsArg = secondChild.child(1);
              if (emitsArg?.type === 'array') {
                for (let i = 0; i < emitsArg.childCount; i++) {
                  const child = emitsArg.child(i);
                  if (child) {
                    const emitName = this.extractStringLiteral(child);
                    if (emitName) {
                      emits.push(emitName);
                    }
                  }
                }
              }
            }
          }
        }

        if (node.type === 'pair') {
          const keyNode = node.child(0);
          if (keyNode?.text === 'emits') {
            const emitsValue = node.child(2);
            if (emitsValue?.type === 'array') {
              for (let i = 0; i < emitsValue.childCount; i++) {
                const child = emitsValue.child(i);
                if (child) {
                  const emitName = this.extractStringLiteral(child);
                  if (emitName) {
                    emits.push(emitName);
                  }
                }
              }
            }
          }
        }

        if (node.type === 'call_expression') {
          const caller = node.child(0);
          if (caller?.type === 'member_expression') {
            const object = caller.child(0)?.text;
            const property = caller.child(2)?.text;

            if (object === '$emit' || property === 'emit') {
              const argsNode = node.child(1);
              const firstArg = argsNode?.child(1);
              const emitName = this.extractStringLiteral(firstArg);
              if (emitName && !emits.includes(emitName)) {
                emits.push(emitName);
              }
            }
          }
        }

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
      } catch (error) {
        logger.warn('Error traversing AST node during emits extraction', {
          nodeType: node.type,
          error,
        });
      }
    };

    traverse(tree.rootNode);
    return emits;
  }

  /**
   * Extract Vue composables used in the component
   */
  private extractVueComposables(tree: any): string[] {
    const composables: string[] = [];

    if (!tree?.rootNode) return composables;

    const traverse = (node: Parser.SyntaxNode) => {
      // Look for function calls starting with 'use'
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        const functionName = functionNode?.text;

        if (functionName && functionName.startsWith('use') && functionName.length > 3) {
          if (!composables.includes(functionName)) {
            composables.push(functionName);
          }
        }
      }

      // Traverse children using Tree-sitter API
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return composables;
  }

  /**
   * Extract advanced Composition API patterns
   */
  private extractAdvancedCompositionAPI(tree: any): {
    provide: Array<{ key: string; value?: string }>;
    inject: Array<{ key: string; defaultValue?: string }>;
    defineExpose: string[];
    defineModel: Array<{ name: string; options?: string }>;
    watchEffect: string[];
    computed: string[];
  } {
    const result = {
      provide: [] as Array<{ key: string; value?: string }>,
      inject: [] as Array<{ key: string; defaultValue?: string }>,
      defineExpose: [] as string[],
      defineModel: [] as Array<{ name: string; options?: string }>,
      watchEffect: [] as string[],
      computed: [] as string[],
    };

    if (!tree?.rootNode) return result;

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        const functionName = functionNode?.text;

        switch (functionName) {
          case 'provide':
            const provideArgs = this.extractCallArguments(node);
            if (provideArgs.length >= 1) {
              result.provide.push({
                key: provideArgs[0],
                value: provideArgs[1],
              });
            }
            break;

          case 'inject':
            const injectArgs = this.extractCallArguments(node);
            if (injectArgs.length >= 1) {
              result.inject.push({
                key: injectArgs[0],
                defaultValue: injectArgs[1],
              });
            }
            break;

          case 'defineExpose':
            const exposeArgs = this.extractCallArguments(node);
            if (exposeArgs.length > 0) {
              // Parse the exposed object to extract property names
              const exposedContent = exposeArgs[0];
              const propertyNames = this.parseObjectProperties(exposedContent);
              result.defineExpose.push(...propertyNames);
            }
            break;

          case 'defineModel':
            const modelArgs = this.extractCallArguments(node);
            if (modelArgs.length >= 1) {
              result.defineModel.push({
                name: modelArgs[0],
                options: modelArgs[1],
              });
            } else {
              // defineModel() without parameters defaults to 'modelValue'
              result.defineModel.push({
                name: 'modelValue',
                options: undefined,
              });
            }
            break;

          case 'watchEffect':
            result.watchEffect.push(functionName);
            break;

          case 'computed':
            result.computed.push(functionName);
            break;
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return result;
  }

  /**
   * Extract call arguments as strings
   */
  private extractCallArguments(callNode: Parser.SyntaxNode): string[] {
    const args: string[] = [];
    const argsNode = callNode.child(1); // arguments node

    if (argsNode) {
      for (let i = 0; i < argsNode.childCount; i++) {
        const child = argsNode.child(i);
        if (child && child.type !== '(' && child.type !== ')' && child.type !== ',') {
          args.push(this.extractStringLiteral(child) || child.text);
        }
      }
    }

    return args;
  }

  /**
   * Parse object properties from a string representation
   * Handles patterns like "{ prop1, prop2, prop3: value }"
   */
  private parseObjectProperties(objectString: string): string[] {
    const properties: string[] = [];

    // Remove outer braces and whitespace
    const content = objectString.replace(/^\s*\{\s*|\s*\}\s*$/g, '');

    // Split by commas and extract property names
    const parts = content.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        // Extract property name (before colon if present, otherwise the whole thing)
        const colonIndex = trimmed.indexOf(':');
        const propertyName = colonIndex > 0 ? trimmed.substring(0, colonIndex).trim() : trimmed;

        // Basic validation that it looks like an identifier
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propertyName)) {
          properties.push(propertyName);
        }
      }
    }

    return properties;
  }

  /**
   * Extract props from component
   */
  private extractProps(tree: any, content: string): string[] {
    const props: string[] = [];

    if (!tree?.rootNode) return props;

    // Extract from defineProps in script setup
    const definePropsPattern = /defineProps\s*<([^>]+)>|defineProps\s*\(\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = definePropsPattern.exec(content)) !== null) {
      const propsDefinition = match[1] || match[2];
      if (propsDefinition) {
        // Extract prop names using simple regex
        const propNames = propsDefinition.match(/(\w+)(?=\s*[?:])/g);
        if (propNames) {
          props.push(...propNames);
        }
      }
    }

    // Extract from props option in Options API
    const propsOptionPattern = /props\s*:\s*\{([^}]+)\}/g;
    while ((match = propsOptionPattern.exec(content)) !== null) {
      const propsDefinition = match[1];
      if (propsDefinition) {
        const propNames = propsDefinition.match(/(\w+)\s*:/g);
        if (propNames) {
          props.push(...propNames.map(p => p.replace(':', '').trim()));
        }
      }
    }

    return [...new Set(props)];
  }

  /**
   * Extract emits from component
   */
  private extractEmits(tree: any, content: string): string[] {
    const emits: string[] = [];

    if (!tree?.rootNode) return emits;

    // Extract from defineEmits in script setup
    const defineEmitsPattern = /defineEmits\s*<([^>]+)>|defineEmits\s*\(\s*\[([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = defineEmitsPattern.exec(content)) !== null) {
      const emitsDefinition = match[1] || match[2];
      if (emitsDefinition) {
        // Extract emit names
        const emitNames = emitsDefinition.match(/['"`](\w+)['"`]/g);
        if (emitNames) {
          emits.push(...emitNames.map(e => e.replace(/['"`]/g, '')));
        }
      }
    }

    // Extract from emits option in Options API
    const emitsOptionPattern = /emits\s*:\s*\[([^\]]+)\]/g;
    while ((match = emitsOptionPattern.exec(content)) !== null) {
      const emitsDefinition = match[1];
      if (emitsDefinition) {
        const emitNames = emitsDefinition.match(/['"`](\w+)['"`]/g);
        if (emitNames) {
          emits.push(...emitNames.map(e => e.replace(/['"`]/g, '')));
        }
      }
    }

    return [...new Set(emits)];
  }

  /**
   * Extract lifecycle hooks from component
   */
  private extractLifecycleHooks(tree: any, content: string): string[] {
    const lifecycle: string[] = [];
    const lifecycleHooks = [
      'beforeCreate',
      'created',
      'beforeMount',
      'mounted',
      'beforeUpdate',
      'updated',
      'beforeUnmount',
      'unmounted',
      'beforeDestroy',
      'destroyed',
      'activated',
      'deactivated',
    ];

    if (!tree?.rootNode) return lifecycle;

    // Extract from Options API
    for (const hook of lifecycleHooks) {
      const hookPattern = new RegExp(`\\b${hook}\\s*\\(`, 'g');
      if (hookPattern.test(content)) {
        lifecycle.push(hook);
      }
    }

    return [...new Set(lifecycle)];
  }

  /**
   * Detect VueUse composables
   */
  private extractVueUseComposables(tree: any): string[] {
    const vueUseComposables: string[] = [];

    if (!tree?.rootNode) return vueUseComposables;

    // Common VueUse composables
    const commonVueUse = [
      // Core
      'useCounter',
      'useToggle',
      'useBoolean',
      'useClipboard',
      'useColorMode',
      'useCycleList',
      'useLocalStorage',
      'useSessionStorage',
      'useStorage',
      'usePreferredDark',
      'usePreferredLanguages',
      'useTitle',
      'useFavicon',
      'useDebounce',
      'useFetch',
      'useAsyncState',
      // Browser
      'useActiveElement',
      'useBreakpoints',
      'useBrowserLocation',
      'useClipboard',
      'useEventListener',
      'useFullscreen',
      'useGeolocation',
      'useIdle',
      'useIntersectionObserver',
      'useMediaQuery',
      'useMemory',
      'useMouseInElement',
      'useMousePressed',
      'useNetwork',
      'useOnline',
      'usePageLeave',
      'usePermission',
      'usePreferredColorScheme',
      'usePreferredReducedMotion',
      'useResizeObserver',
      'useScriptTag',
      'useShare',
      'useSpeechRecognition',
      'useSpeechSynthesis',
      'useUrlSearchParams',
      'useVibrate',
      'useWakeLock',
      'useWebNotification',
      // Sensors
      'useAccelerometer',
      'useBattery',
      'useDeviceMotion',
      'useDeviceOrientation',
      'useDevicePixelRatio',
      'useDocumentVisibility',
      'useElementBounding',
      'useElementSize',
      'useElementVisibility',
      'useEyeDropper',
      'useFps',
      'useKeyModifier',
      'useMagicKeys',
      'useMouse',
      'useMousePressed',
      'useParallax',
      'usePointerSwipe',
      'useScroll',
      'useScrollLock',
      'useSwipe',
      'useTextareaAutosize',
      'useWindowFocus',
      'useWindowScroll',
      'useWindowSize',
      // Head management
      'useHead',
      'useSeoMeta',
      'useServerHead',
    ];

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        const functionName = functionNode?.text;

        if (functionName && commonVueUse.includes(functionName)) {
          if (!vueUseComposables.includes(functionName)) {
            vueUseComposables.push(functionName);
          }
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return vueUseComposables;
  }

  /**
   * Detect Vite-specific patterns
   */
  private extractVitePatterns(content: string): {
    globImports: string[];
    envVariables: string[];
    hotReload: boolean;
  } {
    const result = {
      globImports: [] as string[],
      envVariables: [] as string[],
      hotReload: false,
    };

    // Extract import.meta.glob patterns
    const globPattern = /import\.meta\.glob\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let match: RegExpExecArray | null;
    while ((match = globPattern.exec(content)) !== null) {
      result.globImports.push(match[1]);
    }

    // Extract environment variables
    const envPattern = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;
    while ((match = envPattern.exec(content)) !== null) {
      if (!result.envVariables.includes(match[1])) {
        result.envVariables.push(match[1]);
      }
    }

    // Check for hot reload
    result.hotReload = /import\.meta\.hot/.test(content);

    return result;
  }

  /**
   * Detect CSS Modules and scoped styles
   */
  private extractStylingFeatures(content: string): {
    cssModules: boolean;
    scopedStyles: boolean;
    cssVariables: string[];
    preprocessor?: string;
  } {
    const result = {
      cssModules: false,
      scopedStyles: false,
      cssVariables: [] as string[],
      preprocessor: undefined as string | undefined,
    };

    // Check for CSS Modules
    result.cssModules = /<style\s+module/.test(content);

    // Check for scoped styles
    result.scopedStyles = /<style\s+scoped/.test(content);

    // Extract CSS custom properties (CSS variables)
    const cssVarPattern = /--([a-zA-Z-][a-zA-Z0-9-]*)/g;
    let match: RegExpExecArray | null;
    while ((match = cssVarPattern.exec(content)) !== null) {
      if (!result.cssVariables.includes(match[1])) {
        result.cssVariables.push(match[1]);
      }
    }

    // Detect preprocessor
    if (/<style\s+[^>]*lang=["']scss["']/.test(content)) {
      result.preprocessor = 'scss';
    } else if (/<style\s+[^>]*lang=["']sass["']/.test(content)) {
      result.preprocessor = 'sass';
    } else if (/<style\s+[^>]*lang=["']less["']/.test(content)) {
      result.preprocessor = 'less';
    } else if (/<style\s+[^>]*lang=["']stylus["']/.test(content)) {
      result.preprocessor = 'stylus';
    }

    return result;
  }

  /**
   * Detect testing patterns
   */
  private extractTestingPatterns(filePath: string): {
    isTestFile: boolean;
    isStoryFile: boolean;
    testUtils: string[];
    testFramework?: string;
  } {
    const result = {
      isTestFile: false,
      isStoryFile: false,
      testUtils: [] as string[],
      testFramework: undefined as string | undefined,
    };

    // Check if it's a test file
    result.isTestFile = /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(filePath);

    // Check if it's a Storybook story
    result.isStoryFile = /\.stories\.(js|ts|jsx|tsx)$/.test(filePath);

    return result;
  }

  /**
   * Enhance TypeScript integration for Vue components
   */
  private extractTypeScriptFeatures(
    content: string,
    tree: any
  ): {
    interfaces: Array<{ name: string; properties: string[] }>;
    types: Array<{ name: string; definition: string }>;
    generics: string[];
    imports: Array<{ name: string; isTypeOnly: boolean; source: string }>;
  } {
    const result = {
      interfaces: [] as Array<{ name: string; properties: string[] }>,
      types: [] as Array<{ name: string; definition: string }>,
      generics: [] as string[],
      imports: [] as Array<{ name: string; isTypeOnly: boolean; source: string }>,
    };

    if (!tree?.rootNode) return result;

    const traverse = (node: Parser.SyntaxNode) => {
      // Extract TypeScript interfaces
      if (node.type === 'interface_declaration') {
        const nameNode = node.child(1);
        const interfaceName = nameNode?.text;
        if (interfaceName) {
          const properties = this.extractInterfaceProperties(node);
          result.interfaces.push({
            name: interfaceName,
            properties,
          });
        }
      }

      // Extract type aliases
      if (node.type === 'type_alias_declaration') {
        const nameNode = node.child(1);
        const typeName = nameNode?.text;
        if (typeName) {
          const definition = node.text;
          result.types.push({
            name: typeName,
            definition,
          });
        }
      }

      // Extract generic type parameters
      if (node.type === 'type_parameters') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === 'type_identifier') {
            const genericName = child.text;
            if (genericName && !result.generics.includes(genericName)) {
              result.generics.push(genericName);
            }
          }
        }
      }

      // Extract type-only imports
      if (node.type === 'import_statement' && node.text) {
        const hasTypeKeyword = node.text.includes('import type');
        const sourceMatch = node.text.match(/from\s+['"`]([^'"`]+)['"`]/);
        const source = sourceMatch ? sourceMatch[1] : '';

        if (hasTypeKeyword && source) {
          // Extract imported type names
          const importNames = this.extractImportNames(node);
          for (const name of importNames) {
            result.imports.push({
              name,
              isTypeOnly: true,
              source,
            });
          }
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return result;
  }

  /**
   * Extract interface properties
   */
  private extractInterfaceProperties(interfaceNode: Parser.SyntaxNode): string[] {
    const properties: string[] = [];

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'property_signature') {
        const nameNode = node.child(0);
        if (nameNode?.text) {
          properties.push(nameNode.text);
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(interfaceNode);
    return properties;
  }

  /**
   * Extract import names from import statement
   */
  private extractImportNames(importNode: Parser.SyntaxNode): string[] {
    const names: string[] = [];

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'import_specifier') {
        const nameNode = node.child(0);
        if (nameNode?.text) {
          names.push(nameNode.text);
        }
      } else if (node.type === 'identifier' && node.parent?.type === 'named_imports') {
        names.push(node.text);
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(importNode);
    return names;
  }

  /**
   * Extract template dependencies (used components)
   */
  private extractTemplateDependencies(templateContent: string): string[] {
    const dependencies: string[] = [];

    // Match custom component tags (PascalCase or kebab-case)
    const componentRegex = /<(?:([A-Z][a-zA-Z0-9]*)|([a-z][a-z0-9]*(?:-[a-z0-9]+)+))(?:\s|>|\/)/g;

    let match: RegExpExecArray | null;
    while ((match = componentRegex.exec(templateContent)) !== null) {
      const componentName = match[1] || this.kebabToPascal(match[2]);
      if (componentName && !dependencies.includes(componentName)) {
        dependencies.push(componentName);
      }
    }

    return dependencies;
  }

  /**
   * Extract Vue 3 built-in components from template
   */
  private extractBuiltInComponents(templateContent: string): string[] {
    const builtInComponents: string[] = [];
    const builtIns = ['Teleport', 'Suspense', 'KeepAlive', 'Transition', 'TransitionGroup'];

    for (const component of builtIns) {
      const regex = new RegExp(`<${component}[\\s>]`, 'g');
      if (regex.test(templateContent)) {
        builtInComponents.push(component);
        // Also add kebab-case version for compatibility
        const kebabCase = component
          .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2') // Handle consecutive capitals
          .replace(/([a-z])([A-Z])/g, '$1-$2') // Handle normal camelCase
          .toLowerCase();
        builtInComponents.push(kebabCase);
      }
    }

    return [...new Set(builtInComponents)];
  }

  /**
   * Extract directives from template
   */
  private extractDirectives(templateContent: string): Array<{
    name: string;
    type: 'built-in' | 'custom';
    modifiers: string[];
    arguments?: string;
  }> {
    const directives: Array<{
      name: string;
      type: 'built-in' | 'custom';
      modifiers: string[];
      arguments?: string;
    }> = [];

    const builtInDirectives = [
      'if',
      'else',
      'else-if',
      'show',
      'for',
      'on',
      'bind',
      'model',
      'slot',
      'pre',
      'cloak',
      'once',
      'memo',
      'text',
      'html',
    ];

    // Match directives: v-directive:argument.modifier1.modifier2="value"
    const directiveRegex =
      /v-([a-zA-Z][a-zA-Z0-9-]*)(?::([a-zA-Z][a-zA-Z0-9-]*))?(?:\.([a-zA-Z0-9.-]+))?/g;

    let match: RegExpExecArray | null;
    while ((match = directiveRegex.exec(templateContent)) !== null) {
      const directiveName = match[1];
      const argument = match[2];
      const modifiers = match[3] ? match[3].split('.') : [];

      const type: 'built-in' | 'custom' = builtInDirectives.includes(directiveName)
        ? 'built-in'
        : 'custom';

      const directive = {
        name: directiveName,
        type,
        modifiers,
        ...(argument && { arguments: argument }),
      };

      // Avoid duplicates
      const exists = directives.some(
        d =>
          d.name === directive.name &&
          d.arguments === directive.arguments &&
          JSON.stringify(d.modifiers) === JSON.stringify(directive.modifiers)
      );

      if (!exists) {
        directives.push(directive);
      }
    }

    return directives;
  }

  /**
   * Extract scoped slots from template
   */
  private extractScopedSlots(templateContent: string): Array<{
    name: string;
    props: string[];
  }> {
    const scopedSlots: Array<{
      name: string;
      props: string[];
    }> = [];

    // Fixed regex to properly handle scoped slot patterns in template content
    // The templateContent contains inner template content, so we search for template tags within it
    // Matches: <template #slotName="{ prop1, prop2 }"> or <template v-slot:slotName="{ prop1, prop2 }">
    const scopedSlotRegex =
      /<template\s+(?:#([a-zA-Z][a-zA-Z0-9-]*)|v-slot:([a-zA-Z][a-zA-Z0-9-]*))="?\{\s*([^}]*)\s*\}"?/g;

    let match: RegExpExecArray | null;
    while ((match = scopedSlotRegex.exec(templateContent)) !== null) {
      const slotName = match[1] || match[2] || 'default';
      const propsString = match[3] || '';

      // Extract individual prop names from destructured props
      const props = propsString
        .split(',')
        .map((prop: string) => prop.trim())
        .filter((prop: string) => prop.length > 0);

      scopedSlots.push({
        name: slotName,
        props,
      });
    }

    return scopedSlots;
  }

  /**
   * Extract template refs
   */
  private extractTemplateRefs(templateContent: string): string[] {
    const refs: string[] = [];

    // Match ref="refName"
    const refRegex = /ref="([^"]+)"/g;

    let match: RegExpExecArray | null;
    while ((match = refRegex.exec(templateContent)) !== null) {
      const refName = match[1];
      if (!refs.includes(refName)) {
        refs.push(refName);
      }
    }

    return refs;
  }

  /**
   * Extract dynamic components
   */
  private extractDynamicComponents(templateContent: string): string[] {
    const dynamicComponents: string[] = [];

    // Match <component :is="componentName">
    const dynamicComponentRegex = /<component\s+:is="([^"]+)"/g;

    let match: RegExpExecArray | null;
    while ((match = dynamicComponentRegex.exec(templateContent)) !== null) {
      const componentExpression = match[1];
      if (!dynamicComponents.includes(componentExpression)) {
        dynamicComponents.push(componentExpression);
      }
    }

    return dynamicComponents;
  }

  /**
   * Extract event handlers from template
   */
  private extractEventHandlers(templateContent: string): Array<{
    event: string;
    handler: string;
    modifiers: string[];
  }> {
    const handlers: Array<{
      event: string;
      handler: string;
      modifiers: string[];
    }> = [];

    // Match @event.modifier="handler" or v-on:event.modifier="handler"
    const eventRegex =
      /(?:@([a-zA-Z][a-zA-Z0-9-]*)|v-on:([a-zA-Z][a-zA-Z0-9-]*))(?:\.([a-zA-Z0-9.-]+))?="([^"]+)"/g;

    let match: RegExpExecArray | null;
    while ((match = eventRegex.exec(templateContent)) !== null) {
      const event = match[1] || match[2];
      const modifiers = match[3] ? match[3].split('.') : [];
      const handler = match[4];

      handlers.push({
        event,
        handler,
        modifiers,
      });
    }

    return handlers;
  }

  /**
   * Extract Vue lifecycle methods from script content
   */
  private extractLifecycleMethods(scriptContent: string): string[] {
    const lifecycleMethods: string[] = [];

    try {
      // Skip lifecycle extraction for large scripts to avoid Tree-sitter limits
      if (scriptContent.length > 28000) {
        return lifecycleMethods;
      }

      const tree = this.parseContent(scriptContent);
      if (!tree?.rootNode) return lifecycleMethods;

      const vueLifecycleHooks = [
        'beforeCreate',
        'created',
        'beforeMount',
        'mounted',
        'beforeUpdate',
        'updated',
        'beforeUnmount',
        'unmounted',
        'activated',
        'deactivated',
        'errorCaptured',
      ];

      const traverse = (node: any) => {
        // Look for method definitions in export default object (Options API)
        if (node.type === 'method_definition') {
          const nameNode = node.child(0); // property_identifier
          const methodName = nameNode?.text;

          if (methodName && vueLifecycleHooks.includes(methodName)) {
            if (!lifecycleMethods.includes(methodName)) {
              lifecycleMethods.push(methodName);
            }
          }
        }

        // Look for property pairs with function values (alternative Options API format)
        if (node.type === 'pair') {
          const keyNode = node.child(0);
          const key = keyNode?.text?.replace(/['"]/g, '');

          if (key && vueLifecycleHooks.includes(key)) {
            if (!lifecycleMethods.includes(key)) {
              lifecycleMethods.push(key);
            }
          }
        }

        // Look for lifecycle hooks in Composition API (onMounted, etc.)
        if (node.type === 'call_expression') {
          const functionNode = node.child(0);
          const functionName = functionNode?.text;

          if (functionName?.startsWith('on') && functionName.length > 2) {
            // Convert onMounted -> mounted, onCreated -> created, etc.
            const hookName = functionName.substring(2).toLowerCase();
            const lifecycleMap: Record<string, string> = {
              mounted: 'mounted',
              updated: 'updated',
              unmounted: 'unmounted',
              beforemount: 'beforeMount',
              beforeupdate: 'beforeUpdate',
              beforeunmount: 'beforeUnmount',
            };

            if (lifecycleMap[hookName]) {
              const mappedHook = lifecycleMap[hookName];
              if (!lifecycleMethods.includes(mappedHook)) {
                lifecycleMethods.push(mappedHook);
              }
            }
          }
        }

        // Traverse children
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
      };

      traverse(tree.rootNode);
    } catch (error) {
      logger.warn('Failed to extract lifecycle methods', { error });
    }

    return lifecycleMethods;
  }

  /**
   * Extract slots from template
   */
  private extractSlots(templateContent: string): string[] {
    const slots: string[] = [];

    // Match slot definitions
    const slotRegex = /<slot(?:\s+name=["']([^"']+)["'])?/g;

    let match;
    while ((match = slotRegex.exec(templateContent)) !== null) {
      const slotName = match[1] || 'default';
      if (!slots.includes(slotName)) {
        slots.push(slotName);
      }
    }

    return slots;
  }

  /**
   * Parse Vue composables from JavaScript/TypeScript files
   */
  private async parseComposables(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<VueComposable[]> {
    const composables: VueComposable[] = [];

    // Check if this looks like a composable file
    if (!this.isComposableFile(filePath, content)) {
      return composables;
    }

    try {
      // Skip composable detection for large files to avoid Tree-sitter limits
      if (content.length > 28000) {
        return composables;
      }

      const tree = this.parseContent(content);
      const functions = this.findComposableFunctions(tree, content);

      for (const func of functions) {
        const composable: VueComposable = {
          type: 'composable',
          name: func.name,
          filePath,
          description: func.description,
          returns: func.returns,
          dependencies: func.dependencies,
          reactive_refs: func.reactiveRefs,
          metadata: {
            isDefault: func.isDefault,
            parameters: func.parameters,
            returns: func.returns,
            lifecycle: func.dependencies.filter(d =>
              ['onMounted', 'onUnmounted', 'onUpdated'].includes(d)
            ),
          },
        };

        composables.push(composable);
      }
    } catch (error) {
      logger.error(`Failed to parse Vue composables in ${filePath}`, { error });
    }

    return composables;
  }

  /**
   * Find composable functions in the AST
   */
  private findComposableFunctions(
    tree: any,
    content: string
  ): Array<{
    name: string;
    returns: string[];
    dependencies: string[];
    reactiveRefs: string[];
    isDefault: boolean;
    parameters: string[];
    description?: string;
  }> {
    const functions: any[] = [];

    if (!tree?.rootNode) return functions;

    const traverse = (node: any) => {
      // Function declarations: function useExample() {}
      if (node.type === 'function_declaration') {
        let nameNode = null;
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type === 'identifier') {
            nameNode = child;
            break;
          }
        }
        const name = nameNode?.text;

        if (name && name.startsWith('use') && name.length > 3) {
          functions.push(this.analyzeComposableFunction(node, name, false, content));
        }
      }

      // Variable declarations: const useExample = () => {}
      if (node.type === 'variable_declarator') {
        const nameNode = node.child(0);
        const valueNode = node.child(2);
        const name = nameNode?.text;

        if (
          name &&
          name.startsWith('use') &&
          name.length > 3 &&
          (valueNode?.type === 'arrow_function' || valueNode?.type === 'function_expression')
        ) {
          functions.push(this.analyzeComposableFunction(valueNode, name, false, content));
        }
      }

      // Export default function
      if (node.type === 'export_default_declaration') {
        let funcNode = null;
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (
            child &&
            (child.type === 'function_declaration' ||
              child.type === 'arrow_function' ||
              child.type === 'function_expression')
          ) {
            funcNode = child;
            break;
          }
        }

        if (funcNode) {
          const name = 'default'; // Will be extracted from filename
          functions.push(this.analyzeComposableFunction(funcNode, name, true, content));
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return functions;
  }

  /**
   * Analyze a composable function to extract its metadata
   */
  private analyzeComposableFunction(
    node: any,
    name: string,
    isDefault: boolean,
    content?: string
  ): {
    name: string;
    returns: string[];
    dependencies: string[];
    reactiveRefs: string[];
    isDefault: boolean;
    parameters: string[];
    description?: string;
  } {
    const returns: string[] = [];
    const dependencies: string[] = [];
    const reactiveRefs: string[] = [];
    const parameters: string[] = [];
    let description: string | undefined;

    if (content) {
      const jsdocComment = extractJSDocComment(node, content);
      if (jsdocComment) {
        description = extractDescriptionOnly(jsdocComment);
      }
    }

    // Extract parameters
    let parametersList = null;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === 'formal_parameters') {
        parametersList = child;
        break;
      }
    }

    if (parametersList) {
      for (let i = 0; i < parametersList.childCount; i++) {
        const param = parametersList.child(i);
        if (param && param.type === 'identifier') {
          parameters.push(param.text);
        }
      }
    }

    // Find function body
    let body = null;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && (child.type === 'statement_block' || child.type === 'expression')) {
        body = child;
        break;
      }
    }

    if (body) {
      this.analyzeComposableBody(body, returns, dependencies, reactiveRefs);
    }

    return {
      name,
      returns,
      dependencies,
      reactiveRefs,
      isDefault,
      parameters,
      description,
    };
  }

  /**
   * Analyze composable function body for return values and dependencies
   */
  private analyzeComposableBody(
    body: any,
    returns: string[],
    dependencies: string[],
    reactiveRefs: string[]
  ): void {
    const traverse = (node: any) => {
      // Look for return statements
      if (node.type === 'return_statement') {
        const returnValue = node.child(1);
        if (returnValue?.type === 'object') {
          // Extract returned object properties
          for (let i = 0; i < returnValue.childCount; i++) {
            const child = returnValue.child(i);
            if (child && (child.type === 'pair' || child.type === 'property_name')) {
              const propNameNode = child.child(0);
              const propName = propNameNode?.text || child.text;
              if (propName && !returns.includes(propName)) {
                returns.push(propName);
              }
            } else if (child && child.type === 'shorthand_property_identifier') {
              // Handle shorthand properties like { increment, decrement }
              const propName = child.text;
              if (propName && !returns.includes(propName)) {
                returns.push(propName);
              }
            }
          }
        }
      }

      // Look for Vue composition API calls
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        const functionName = functionNode?.text;

        if (functionName) {
          // Track composition API dependencies
          if (['ref', 'reactive', 'computed', 'watch', 'watchEffect'].includes(functionName)) {
            if (!dependencies.includes(functionName)) {
              dependencies.push(functionName);
            }

            // Track reactive references
            if (['ref', 'reactive'].includes(functionName)) {
              // Try to find variable name this is assigned to
              const parent = this.findParent(node, 'variable_declarator');
              if (parent) {
                const varNameNode = parent.child(0);
                const varName = varNameNode?.text;
                if (varName && !reactiveRefs.includes(varName)) {
                  reactiveRefs.push(varName);
                }
              }
            }
          }

          // Track other composable calls
          if (functionName.startsWith('use') && functionName.length > 3) {
            if (!dependencies.includes(functionName)) {
              dependencies.push(functionName);
            }
          }

          // Track lifecycle hooks (onMounted, onUnmounted, etc.)
          if (functionName.startsWith('on') && functionName.length > 2) {
            if (!dependencies.includes(functionName)) {
              dependencies.push(functionName);
            }
          }
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(body);
  }

  /**
   * Find parent node of a specific type
   */
  private findParent(node: Parser.SyntaxNode, parentType: string): Parser.SyntaxNode | null {
    let current = node.parent;
    while (current && current.type !== parentType) {
      current = current.parent;
    }
    return current;
  }

  /**
   * Parse Vue Router routes configuration
   */
  private async parseVueRouterRoutes(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<VueRoute[]> {
    const routes: VueRoute[] = [];

    try {
      // Skip route analysis for large files to avoid Tree-sitter limits
      if (content.length > 28000) {
        return routes;
      }

      const tree = this.parseContent(content);
      if (!tree?.rootNode) return routes;

      // Find route definitions in different patterns
      this.findRouteDefinitions(tree.rootNode, routes, filePath);
    } catch (error) {
      logger.error(`Failed to parse Vue Router routes in ${filePath}`, { error });
    }

    return routes;
  }

  /**
   * Find and extract route definitions from AST
   */
  private findRouteDefinitions(
    node: Parser.SyntaxNode,
    routes: VueRoute[],
    filePath: string
  ): void {
    const traverse = (node: Parser.SyntaxNode) => {
      // Pattern 1: createRouter({ routes: [...] })
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'createRouter') {
          const argsNode = node.child(1);
          if (argsNode) {
            const routesArray = this.findRoutesArrayInObject(argsNode);
            if (routesArray) {
              this.parseRoutesArray(routesArray, routes, filePath);
            }
          }
        }
      }

      // Pattern 2: const routes = [...]
      if (node.type === 'variable_declarator') {
        const nameNode = node.child(0);
        const valueNode = node.child(2);

        if (nameNode?.text === 'routes' && valueNode?.type === 'array') {
          this.parseRoutesArray(valueNode, routes, filePath);
        }
      }

      // Pattern 3: export default [...] (route array export)
      if (node.type === 'export_default_declaration') {
        const valueNode = node.child(1);
        if (valueNode?.type === 'array') {
          this.parseRoutesArray(valueNode, routes, filePath);
        }
      }

      // Recursively traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(node);
  }

  /**
   * Find routes array in createRouter object argument
   */
  private findRoutesArrayInObject(objectNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (let i = 0; i < objectNode.childCount; i++) {
      const child = objectNode.child(i);
      if (child?.type === 'pair') {
        const keyNode = child.child(0);
        const valueNode = child.child(2);

        if (keyNode?.text === 'routes' && valueNode?.type === 'array') {
          return valueNode;
        }
      }
    }
    return null;
  }

  /**
   * Parse routes array and extract individual route objects
   */
  private parseRoutesArray(
    arrayNode: Parser.SyntaxNode,
    routes: VueRoute[],
    filePath: string
  ): void {
    for (let i = 0; i < arrayNode.childCount; i++) {
      const routeNode = arrayNode.child(i);
      if (routeNode?.type === 'object') {
        const route = this.parseRouteObject(routeNode, filePath);
        if (route) {
          routes.push(route);
        }
      }
    }
  }

  /**
   * Parse individual route object
   */
  private parseRouteObject(routeNode: Parser.SyntaxNode, filePath: string): VueRoute | null {
    const route: any = {
      type: 'route',
      name: '',
      filePath,
      path: '',
      component: null,
      metadata: {},
    };

    let metaObject: any = {};

    // Parse route properties
    for (let i = 0; i < routeNode.childCount; i++) {
      const pairNode = routeNode.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const valueNode = pairNode.child(2);

        if (!keyNode || !valueNode) continue;

        const key = this.getVueNodeText(keyNode).replace(/['"]/g, '');

        switch (key) {
          case 'path':
            route.path = this.getVueNodeText(valueNode).replace(/['"]/g, '');
            route.metadata.path = route.path;
            break;
          case 'name':
            route.name = this.getVueNodeText(valueNode).replace(/['"]/g, '');
            route.metadata.name = route.name;
            break;
          case 'component':
            const componentValue = this.getVueNodeText(valueNode).replace(/['"]/g, '');
            route.component = componentValue;
            route.metadata.component = componentValue;

            // Check if it's a lazy loaded component
            if (
              valueNode.type === 'arrow_function' ||
              this.getVueNodeText(valueNode).includes('import(')
            ) {
              route.metadata.lazy = true;
            }
            break;
          case 'meta':
            metaObject = this.parseObjectToJson(valueNode);
            // Extract specific meta properties the tests expect
            if (metaObject.requiresAuth !== undefined) {
              route.metadata.requiresAuth = metaObject.requiresAuth;
            }
            if (metaObject.role !== undefined) {
              route.metadata.role = metaObject.role;
            }
            break;
          case 'props':
            route.metadata.props = this.getVueNodeText(valueNode) === 'true';
            break;
          case 'children':
            if (valueNode.type === 'array') {
              route.metadata.children = [];
              for (let j = 0; j < valueNode.childCount; j++) {
                const childRouteNode = valueNode.child(j);
                if (childRouteNode?.type === 'object') {
                  const childRoute = this.parseRouteObject(childRouteNode, filePath);
                  if (childRoute) {
                    route.metadata.children.push(childRoute);
                  }
                }
              }
            }
            break;
          default:
            // Store other properties in metadata
            route.metadata[key] = this.getVueNodeText(valueNode);
        }
      }
    }

    // Check if route has dynamic segments
    if (route.path && (route.path.includes(':') || route.path.includes('['))) {
      route.metadata.dynamic = true;
    }

    // Use path as name if no name specified
    if (!route.name && route.path) {
      route.name = route.path.replace(/[\/:\[\]]/g, '_').replace(/^_|_$/g, '') || 'route';
      route.metadata.name = route.name;
    }

    return route.path ? route : null;
  }

  /**
   * Get text content of a node
   */
  protected getVueNodeText(node: Parser.SyntaxNode): string {
    return node.text || '';
  }

  /**
   * Parse an object node to JSON-like structure
   */
  private parseObjectToJson(node: Parser.SyntaxNode): any {
    const obj: any = {};

    for (let i = 0; i < node.childCount; i++) {
      const pairNode = node.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const valueNode = pairNode.child(2);

        if (keyNode && valueNode) {
          const key = this.getVueNodeText(keyNode).replace(/['"]/g, '');
          let value: any = this.getVueNodeText(valueNode);

          // Try to parse as boolean/number
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (!isNaN(Number(value)) && value.trim() !== '') value = Number(value);
          else value = value.replace(/['"]/g, '');

          obj[key] = value;
        }
      }
    }

    return obj;
  }

  /**
   * Parse Pinia store definitions (supports multiple stores per file)
   */
  private async parsePiniaStore(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<PiniaStore[]> {
    try {
      // Skip store analysis for large files to avoid Tree-sitter limits
      if (content.length > 28000) {
        return [];
      }

      const tree = this.parseContent(content);
      if (!tree?.rootNode) return [];

      const storeDefinitions = this.findStoreDefinitions(tree.rootNode);
      if (storeDefinitions.length === 0) return [];

      const stores: PiniaStore[] = [];

      for (const storeDefinition of storeDefinitions) {
        const store: any = {
          type: 'store',
          name: storeDefinition.composableName,
          filePath,
          state: storeDefinition.state,
          getters: storeDefinition.getters,
          actions: storeDefinition.actions,
          metadata: {
            storeId: storeDefinition.id,
            style: storeDefinition.style,
            state: storeDefinition.state,
            getters: storeDefinition.getters,
            actions: storeDefinition.actions,
            composableName: storeDefinition.composableName,
            isDefaultExport: storeDefinition.isDefaultExport,
          },
        };

        stores.push(store);
      }

      return stores;
    } catch (error) {
      logger.error(`Failed to parse Pinia stores in ${filePath}`, { error });
      return [];
    }
  }

  /**
   * Find ALL defineStore definitions in the AST (supports multiple stores per file)
   */
  private findStoreDefinitions(node: Parser.SyntaxNode): Array<{
    name: string;
    id: string;
    state: string[];
    getters: string[];
    actions: string[];
    composableName: string;
    isDefaultExport: boolean;
    style: string;
  }> {
    const storeDefinitions: any[] = [];

    const traverse = (node: Parser.SyntaxNode) => {
      // Pattern 1: defineStore('id', { state, getters, actions })
      // Pattern 2: defineStore({ id: 'name', state, getters, actions })
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'defineStore') {
          const storeDef = this.parseDefineStoreCall(node);
          if (storeDef) {
            storeDefinitions.push(storeDef);
          }
          // Continue searching for more stores (don't return here)
        }
      }

      // Look for variable declarations or exports that contain stores
      if (node.type === 'variable_declarator' || node.type === 'export_default_declaration') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
        return;
      }

      // Recursively traverse ALL children (removed the !storeDefinition condition)
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(node);
    return storeDefinitions;
  }

  /**
   * Find defineStore definition in the AST (legacy method for single store)
   */
  private findStoreDefinition(node: Parser.SyntaxNode): {
    name: string;
    id: string;
    state: string[];
    getters: string[];
    actions: string[];
    composableName: string;
    isDefaultExport: boolean;
    style: string;
  } | null {
    let storeDefinition: any = null;

    const traverse = (node: Parser.SyntaxNode) => {
      // Pattern 1: defineStore('id', { state, getters, actions })
      // Pattern 2: defineStore({ id: 'name', state, getters, actions })
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'defineStore') {
          storeDefinition = this.parseDefineStoreCall(node);
          return;
        }
      }

      // Look for variable declarations or exports that contain the store
      if (node.type === 'variable_declarator' || node.type === 'export_default_declaration') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
        return;
      }

      // Recursively traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && !storeDefinition) {
          traverse(child);
        }
      }
    };

    traverse(node);
    return storeDefinition;
  }

  /**
   * Parse defineStore function call
   */
  private parseDefineStoreCall(callNode: Parser.SyntaxNode): {
    name: string;
    id: string;
    state: string[];
    getters: string[];
    actions: string[];
    composableName: string;
    isDefaultExport: boolean;
    style: string;
  } | null {
    const argsNode = callNode.child(1);
    if (!argsNode) return null;

    let storeId = '';
    let storeConfig: Parser.SyntaxNode | null = null;
    let composableName = 'useStore';
    let isDefaultExport = false;

    // Check if this is wrapped in an export or variable declaration
    const parent = this.findParent(callNode, 'variable_declarator');
    if (parent) {
      const nameNode = parent.child(0);
      if (nameNode?.text) {
        composableName = nameNode.text;
      }
    }

    const exportParent = this.findParent(callNode, 'export_default_declaration');
    if (exportParent) {
      isDefaultExport = true;
    }

    // Parse arguments
    const firstArg = argsNode.child(1); // Skip opening parenthesis
    const secondArg = argsNode.child(3); // Skip comma

    if (firstArg) {
      if (firstArg.type === 'string') {
        // Pattern: defineStore('id', { ... })
        storeId = this.getVueNodeText(firstArg).replace(/['"]/g, '');
        storeConfig = secondArg;
      } else if (firstArg.type === 'object') {
        // Pattern: defineStore({ id: 'name', ... })
        storeConfig = firstArg;
        storeId = this.findPropertyInObject(firstArg, 'id') || '';
      }
    }

    if (!storeConfig || !storeId) return null;

    // Determine store style based on second argument
    let style = 'options';
    if (secondArg && secondArg.type === 'arrow_function') {
      style = 'setup';
    }

    let state: string[] = [];
    let getters: string[] = [];
    let actions: string[] = [];

    if (style === 'setup' && secondArg?.type === 'arrow_function') {
      // Parse Setup API store (arrow function)
      const setupContent = this.extractSetupStoreContent(secondArg);
      state = setupContent.state;
      getters = setupContent.getters;
      actions = setupContent.actions;
    } else if (style === 'options' && storeConfig) {
      // Parse Options API store (object)
      state = this.extractStoreSection(storeConfig, 'state');
      getters = this.extractStoreSection(storeConfig, 'getters');
      actions = this.extractStoreSection(storeConfig, 'actions');
    }

    return {
      name: storeId,
      id: storeId,
      state,
      getters,
      actions,
      composableName,
      isDefaultExport,
      style,
    };
  }

  /**
   * Extract content from Setup API store (arrow function)
   */
  private extractSetupStoreContent(functionNode: Parser.SyntaxNode): {
    state: string[];
    getters: string[];
    actions: string[];
  } {
    const state: string[] = [];
    const getters: string[] = [];
    const actions: string[] = [];

    // Find the function body
    let body: Parser.SyntaxNode | null = null;
    for (let i = 0; i < functionNode.childCount; i++) {
      const child = functionNode.child(i);
      if (child?.type === 'statement_block') {
        body = child;
        break;
      }
    }

    if (!body) return { state, getters, actions };

    const traverse = (node: Parser.SyntaxNode) => {
      // Look for variable declarations
      if (node.type === 'variable_declarator') {
        const nameNode = node.child(0);
        const valueNode = node.child(2);
        const varName = nameNode?.text;

        if (varName && valueNode) {
          // Check if it's a ref() call (state)
          if (valueNode.type === 'call_expression') {
            const functionCall = valueNode.child(0);
            const funcName = functionCall?.text;

            if (funcName === 'ref' || funcName === 'reactive') {
              state.push(varName);
            } else if (funcName === 'computed') {
              getters.push(varName);
            }
          }
          // Check if it's a function (action)
          else if (
            valueNode.type === 'arrow_function' ||
            valueNode.type === 'function_expression'
          ) {
            actions.push(varName);
          }
        }
      }

      // Look for function declarations (also actions)
      if (node.type === 'function_declaration') {
        let nameNode = null;
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type === 'identifier') {
            nameNode = child;
            break;
          }
        }

        if (nameNode?.text) {
          actions.push(nameNode.text);
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(body);
    return { state, getters, actions };
  }

  /**
   * Extract state, getters, or actions from store configuration
   */
  private extractStoreSection(configNode: Parser.SyntaxNode, sectionName: string): string[] {
    const items: string[] = [];

    for (let i = 0; i < configNode.childCount; i++) {
      const pairNode = configNode.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const valueNode = pairNode.child(2);

        if (keyNode?.text === sectionName && valueNode) {
          if (sectionName === 'state' && valueNode.type === 'arrow_function') {
            // state: () => ({ ... })
            const returnValue = this.findReturnValue(valueNode);
            if (returnValue?.type === 'object') {
              items.push(...this.extractObjectKeys(returnValue));
            }
          } else if (valueNode.type === 'object') {
            // getters: { ... } or actions: { ... }
            items.push(...this.extractObjectKeys(valueNode));
          }
        }
      }
    }

    return items;
  }

  /**
   * Find return value in arrow function or function
   */
  private findReturnValue(functionNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    // For arrow functions like () => ({ ... })
    for (let i = 0; i < functionNode.childCount; i++) {
      const child = functionNode.child(i);
      if (child?.type === 'object' || child?.type === 'parenthesized_expression') {
        if (child.type === 'parenthesized_expression') {
          const innerChild = child.child(1);
          if (innerChild?.type === 'object') {
            return innerChild;
          }
        } else {
          return child;
        }
      }
    }

    return null;
  }

  /**
   * Extract keys from an object node
   */
  private extractObjectKeys(objectNode: Parser.SyntaxNode): string[] {
    const keys: string[] = [];

    for (let i = 0; i < objectNode.childCount; i++) {
      const pairNode = objectNode.child(i);
      if (pairNode?.type === 'pair' || pairNode?.type === 'method_definition') {
        const keyNode = pairNode.child(0);
        if (keyNode?.text) {
          keys.push(keyNode.text.replace(/['"]/g, ''));
        }
      }
    }

    return keys;
  }

  /**
   * Find a property value in an object node
   */
  private findPropertyInObject(objectNode: Parser.SyntaxNode, propertyName: string): string | null {
    for (let i = 0; i < objectNode.childCount; i++) {
      const pairNode = objectNode.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const valueNode = pairNode.child(2);

        if (keyNode?.text === propertyName && valueNode) {
          return this.getVueNodeText(valueNode).replace(/['"]/g, '');
        }
      }
    }
    return null;
  }

  /**
   * Parse regular Vue component (not SFC)
   */
  private async parseVueComponent(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<VueComponent | null> {
    try {
      // Skip component analysis for large files to avoid Tree-sitter limits
      if (content.length > 28000) {
        return null;
      }

      const tree = this.parseContent(content);
      if (!tree?.rootNode) return null;

      const componentDefinition = this.findVueComponentDefinition(tree.rootNode);
      if (!componentDefinition) return null;

      const componentName = this.extractComponentName(filePath);

      const component: VueComponent = {
        type: 'component',
        name: componentName,
        filePath,
        props: componentDefinition.props,
        emits: componentDefinition.emits,
        slots: componentDefinition.slots,
        composables: componentDefinition.composables,
        template_dependencies: componentDefinition.templateDependencies,
        metadata: {
          scriptSetup: componentDefinition.isCompositionAPI,
          hasScript: true,
          hasTemplate: componentDefinition.hasTemplate,
          hasStyle: false,
          scriptLang: path.extname(filePath) === '.ts' ? 'ts' : 'js',
          props: componentDefinition.props.map(p => p.name),
          emits: componentDefinition.emits,
          lifecycle: componentDefinition.lifecycle || [],
          definitionType: componentDefinition.definitionType,
        },
      };

      return component;
    } catch (error) {
      logger.error(`Failed to parse Vue component in ${filePath}`, { error });
      return null;
    }
  }

  /**
   * Find Vue component definition in JS/TS files
   */
  private findVueComponentDefinition(node: Parser.SyntaxNode): {
    props: PropDefinition[];
    emits: string[];
    slots: string[];
    composables: string[];
    templateDependencies: string[];
    isCompositionAPI: boolean;
    hasTemplate: boolean;
    definitionType: string;
    lifecycle: string[];
  } | null {
    let componentDef: any = null;

    const traverse = (node: Parser.SyntaxNode) => {
      // Pattern 1: defineComponent({ ... })
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'defineComponent') {
          const argsNode = node.child(1);
          const configNode = argsNode?.child(1); // First argument
          if (configNode?.type === 'object') {
            componentDef = this.parseComponentOptions(configNode, 'defineComponent');
            return;
          }
        }
      }

      // Pattern 2: export default { ... } (Options API)
      if (node.type === 'export_default_declaration') {
        const valueNode = node.child(1);
        if (valueNode?.type === 'object') {
          // Check if this looks like a Vue component
          if (this.looksLikeVueComponent(valueNode)) {
            componentDef = this.parseComponentOptions(valueNode, 'optionsAPI');
            return;
          }
        }
      }

      // Pattern 3: Vue.component('name', { ... })
      if (node.type === 'call_expression') {
        const memberNode = node.child(0);
        if (memberNode?.type === 'member_expression') {
          const objectNode = memberNode.child(0);
          const propertyNode = memberNode.child(2);

          if (objectNode?.text === 'Vue' && propertyNode?.text === 'component') {
            const argsNode = node.child(1);
            const configNode = argsNode?.child(3); // Second argument
            if (configNode?.type === 'object') {
              componentDef = this.parseComponentOptions(configNode, 'globalComponent');
              return;
            }
          }
        }
      }

      // Pattern 4: createApp({ ... }) or new Vue({ ... })
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (
          functionNode?.text === 'createApp' ||
          (functionNode?.type === 'new_expression' && functionNode.child(1)?.text === 'Vue')
        ) {
          const argsNode = node.child(1);
          const configNode = argsNode?.child(1); // First argument
          if (configNode?.type === 'object') {
            componentDef = this.parseComponentOptions(configNode, 'appComponent');
            return;
          }
        }
      }

      // Recursively traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && !componentDef) {
          traverse(child);
        }
      }
    };

    traverse(node);
    return componentDef;
  }

  /**
   * Check if an object looks like a Vue component configuration
   */
  private looksLikeVueComponent(objectNode: Parser.SyntaxNode): boolean {
    const componentProperties = [
      'data',
      'computed',
      'methods',
      'props',
      'emits',
      'setup',
      'template',
      'render',
    ];

    for (let i = 0; i < objectNode.childCount; i++) {
      const pairNode = objectNode.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const key = keyNode?.text?.replace(/['"]/g, '');

        if (componentProperties.includes(key || '')) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Parse Vue component options object
   */
  private parseComponentOptions(
    configNode: Parser.SyntaxNode,
    definitionType: string
  ): {
    props: PropDefinition[];
    emits: string[];
    slots: string[];
    composables: string[];
    templateDependencies: string[];
    isCompositionAPI: boolean;
    hasTemplate: boolean;
    definitionType: string;
    lifecycle: string[];
  } {
    const result = {
      props: [] as PropDefinition[],
      emits: [] as string[],
      slots: [] as string[],
      composables: [] as string[],
      templateDependencies: [] as string[],
      isCompositionAPI: false,
      hasTemplate: false,
      definitionType,
      lifecycle: [] as string[],
    };

    for (let i = 0; i < configNode.childCount; i++) {
      const pairNode = configNode.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const valueNode = pairNode.child(2);
        const key = keyNode?.text?.replace(/['"]/g, '');

        if (!key || !valueNode) continue;

        switch (key) {
          case 'props':
            result.props = this.parsePropsFromNode(valueNode);
            break;

          case 'emits':
            if (valueNode.type === 'array') {
              result.emits = this.parseEmitsArray(valueNode);
            }
            break;

          case 'setup':
            result.isCompositionAPI = true;
            result.composables = this.extractComposablesFromSetup(valueNode);
            break;

          case 'template':
            result.hasTemplate = true;
            if (valueNode.type === 'string') {
              const templateContent = this.getVueNodeText(valueNode).replace(/['"]/g, '');
              result.templateDependencies = this.extractTemplateDependencies(templateContent);
              result.slots = this.extractSlots(templateContent);
            }
            break;

          case 'methods':
          case 'computed':
            if (valueNode.type === 'object') {
              // Extract method/computed names that might emit events
              const methodNames = this.extractObjectKeys(valueNode);
              // Look for $emit calls in method bodies (simplified)
              // This could be enhanced to actually parse method bodies
            }
            break;

          case 'data':
            // In Options API, data function exists
            break;

          case 'mounted':
          case 'created':
          case 'beforeCreate':
          case 'beforeMount':
          case 'beforeUpdate':
          case 'updated':
          case 'beforeUnmount':
          case 'unmounted':
          case 'activated':
          case 'deactivated':
          case 'errorCaptured':
            result.lifecycle.push(key);
            break;
        }
      }
    }

    return result;
  }

  /**
   * Parse emits array from node
   */
  private parseEmitsArray(arrayNode: Parser.SyntaxNode): string[] {
    const emits: string[] = [];

    for (let i = 0; i < arrayNode.childCount; i++) {
      const child = arrayNode.child(i);
      if (child?.type === 'string') {
        const emitName = this.getVueNodeText(child).replace(/['"]/g, '');
        if (emitName && !emits.includes(emitName)) {
          emits.push(emitName);
        }
      }
    }

    return emits;
  }

  /**
   * Extract composables used in setup function
   */
  private extractComposablesFromSetup(setupNode: Parser.SyntaxNode): string[] {
    const composables: string[] = [];

    const traverse = (node: Parser.SyntaxNode) => {
      // Look for function calls starting with 'use'
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        const functionName = functionNode?.text;

        if (functionName && functionName.startsWith('use') && functionName.length > 3) {
          if (!composables.includes(functionName)) {
            composables.push(functionName);
          }
        }
      }

      // Recursively traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(setupNode);
    return composables;
  }

  // Helper methods

  private isJavaScriptFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return ['.js', '.ts', '.mjs', '.cjs'].includes(ext);
  }

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

  private isComposableFile(filePath: string, content: string): boolean {
    return (
      filePath.includes('composable') ||
      path.basename(filePath).startsWith('use') ||
      this.containsPattern(content, /export\s+(default\s+)?function\s+use[A-Z]/)
    );
  }

  private isVueComponentFile(content: string): boolean {
    return this.containsPattern(content, /defineComponent|createApp|Vue\.component/);
  }

  private kebabToPascal(kebabStr: string): string {
    return kebabStr
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
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
    const symbols: any[] = [];
    const dependencies: ParsedDependency[] = [];
    const imports: any[] = [];

    if (!rootNode) return { symbols, dependencies, imports };

    const traverse = (node: any) => {
      // Handle imports first
      if (node.type === 'import_statement') {
        let source = '';
        const importedNames: string[] = [];
        let importType: 'named' | 'default' | 'namespace' | 'side_effect' = 'side_effect';

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === 'string') {
            const stringFragment = child.child(1);
            if (stringFragment?.type === 'string_fragment') {
              source = stringFragment.text;
            } else {
              source = child.text.replace(/^['"]|['"]$/g, '');
            }
          }
          if (child?.type === 'import_clause') {
            for (let j = 0; j < child.childCount; j++) {
              const clauseChild = child.child(j);
              if (clauseChild?.type === 'named_imports') {
                importType = 'named';
                for (let k = 0; k < clauseChild.childCount; k++) {
                  const importSpecifier = clauseChild.child(k);
                  if (importSpecifier?.type === 'import_specifier') {
                    const nameNode = importSpecifier.child(0);
                    if (nameNode?.type === 'identifier') {
                      importedNames.push(nameNode.text);
                    }
                  }
                }
              } else if (clauseChild?.type === 'identifier') {
                importType = 'default';
                importedNames.push(clauseChild.text);
              }
            }
          }
        }

        if (source) {
          imports.push({
            source,
            import_type: importType,
            line_number: node.startPosition?.row + 1 || 1,
            is_dynamic: false,
            imported_names: importedNames.length > 0 ? importedNames : undefined,
          });
        }
      }

      // Handle dependencies (call expressions)
      if (node.type === 'call_expression') {
        const dependency = this.extractCallDependency(node, content);
        if (dependency) {
          dependency.dependency_type = DependencyType.CALLS;
          dependencies.push(dependency);
        }
      }

      // Variable declarations: const title = ref(...) or lexical_declaration containing variable_declarator
      if (node.type === 'variable_declarator') {
        const nameNode = node.child(0);
        const valueNode = node.child(2);

        if (nameNode?.text) {
          if (valueNode?.type === 'arrow_function') {
            const classification = entityClassifier.classify(
              'function',
              nameNode.text,
              [],
              this.currentFilePath,
              'vue',
              undefined,
              this.currentOptions?.repositoryFrameworks
            );

            symbols.push({
              name: nameNode.text,
              qualified_name: this.buildQualifiedName(nameNode.text),
              symbol_type: 'function',
              entity_type: classification.entityType,
              framework: 'vue',
              start_line: node.startPosition?.row + 1 || 1,
              end_line: node.endPosition?.row + 1 || 1,
              is_exported: false,
              signature: this.getVueNodeText(node),
            });
          } else {
            const classification = entityClassifier.classify(
              'variable',
              nameNode.text,
              [],
              this.currentFilePath,
              'vue',
              undefined,
              this.currentOptions?.repositoryFrameworks
            );

            symbols.push({
              name: nameNode.text,
              qualified_name: this.buildQualifiedName(nameNode.text),
              symbol_type: 'variable',
              entity_type: classification.entityType,
              framework: 'vue',
              start_line: node.startPosition?.row + 1 || 1,
              end_line: node.endPosition?.row + 1 || 1,
              is_exported: false,
              signature: this.getVueNodeText(node),
            });
          }
        }
      }

      // Function declarations: function increment() {}
      if (node.type === 'function_declaration') {
        let nameNode = null;
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type === 'identifier') {
            nameNode = child;
            break;
          }
        }

        if (nameNode?.text) {
          const classification = entityClassifier.classify(
            'function',
            nameNode.text,
            [],
            this.currentFilePath,
            'vue',
            undefined,
            this.currentOptions?.repositoryFrameworks
          );

          symbols.push({
            name: nameNode.text,
            qualified_name: this.buildQualifiedName(nameNode.text),
            symbol_type: 'function',
            entity_type: classification.entityType,
            framework: 'vue',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: this.getVueNodeText(node),
          });
        }
      }

      // Interface declarations: interface User {}
      if (
        node.type === 'interface_declaration' ||
        (node.type === 'ERROR' && node.text.startsWith('interface '))
      ) {
        let nameNode = null;

        if (node.type === 'interface_declaration') {
          nameNode = node.child(1);
        } else if (node.type === 'ERROR') {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child?.type === 'identifier' && child.text !== 'interface') {
              nameNode = child;
              break;
            }
          }
        }

        if (nameNode?.text) {
          const classification = entityClassifier.classify(
            'interface',
            nameNode.text,
            [],
            this.currentFilePath,
            'vue',
            undefined,
            this.currentOptions?.repositoryFrameworks
          );

          symbols.push({
            name: nameNode.text,
            qualified_name: this.buildQualifiedName(nameNode.text),
            symbol_type: 'interface',
            entity_type: classification.entityType,
            framework: 'vue',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: this.getVueNodeText(node),
          });
        }
      }

      // Type alias declarations: type UserType = ...
      if (node.type === 'type_alias_declaration') {
        const nameNode = node.child(1);
        if (nameNode?.text) {
          const classification = entityClassifier.classify(
            'type_alias',
            nameNode.text,
            [],
            this.currentFilePath,
            'vue',
            undefined,
            this.currentOptions?.repositoryFrameworks
          );

          symbols.push({
            name: nameNode.text,
            qualified_name: this.buildQualifiedName(nameNode.text),
            symbol_type: 'type_alias',
            entity_type: classification.entityType,
            framework: 'vue',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: this.getVueNodeText(node),
          });
        }
      }

      // Class declarations: class MyClass {}
      if (node.type === 'class_declaration') {
        const nameNode = node.child(1);
        if (nameNode?.text) {
          const classification = entityClassifier.classify(
            'class',
            nameNode.text,
            [],
            this.currentFilePath,
            'vue',
            undefined,
            this.currentOptions?.repositoryFrameworks
          );

          symbols.push({
            name: nameNode.text,
            qualified_name: this.buildQualifiedName(nameNode.text),
            symbol_type: 'class',
            entity_type: classification.entityType,
            framework: 'vue',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: this.getVueNodeText(node),
          });
        }
      }

      // Vue Composition API lifecycle hooks and callbacks
      if (node.type === 'call_expression') {
        const functionNode = node.childForFieldName('function');
        if (functionNode && functionNode.type === 'identifier') {
          const functionName = functionNode.text;

          const vueCallbacks = [
            'onMounted',
            'onUnmounted',
            'onUpdated',
            'onCreated',
            'onBeforeMount',
            'onBeforeUpdate',
            'onBeforeUnmount',
            'onActivated',
            'onDeactivated',
            'onErrorCaptured',
            'watch',
            'watchEffect',
            'computed',
            'readonly',
            'customRef',
          ];

          if (vueCallbacks.includes(functionName)) {
            const argumentsNode = node.childForFieldName('arguments');
            if (argumentsNode) {
              for (let i = 0; i < argumentsNode.childCount; i++) {
                const child = argumentsNode.child(i);
                if (
                  child &&
                  (child.type === 'arrow_function' || child.type === 'function_expression')
                ) {
                  const callbackName = `${functionName}_callback`;
                  const classification = entityClassifier.classify(
                    'function',
                    callbackName,
                    [],
                    this.currentFilePath,
                    'vue',
                    undefined,
                    this.currentOptions?.repositoryFrameworks
                  );

                  symbols.push({
                    name: callbackName,
                    qualified_name: this.buildQualifiedName(callbackName),
                    symbol_type: 'function',
                    entity_type: classification.entityType,
                    framework: 'vue',
                    start_line: child.startPosition?.row + 1 || 1,
                    end_line: child.endPosition?.row + 1 || 1,
                    is_exported: false,
                    signature: this.getVueNodeText(child),
                  });
                  break;
                }
              }
            }
          }
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(rootNode);

    this.extractedSymbols = symbols;

    return { symbols, dependencies, imports };
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
  private findContainingFunction(callNode: Parser.SyntaxNode, content: string): string {
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

  // Missing helper methods for enhanced Vue parser functionality

  /**
   * Extract SFC sections from Vue file using lightweight regex parsing
   */
  private extractSFCSections(content: string): {
    template?: string;
    script?: string;
    scriptSetup?: string;
    style?: string;
    styleScoped?: boolean;
    styleModules?: boolean;
    styleLang?: string;
    scriptLang?: string;
  } {
    const sections: any = {};

    // Extract template (use greedy match to handle nested template tags in scoped slots)
    const templateMatch = content.match(/<template[^>]*>([\s\S]*)<\/template>/);
    if (templateMatch) {
      sections.template = templateMatch[1];
    }

    // Extract script setup
    const scriptSetupMatch = content.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    if (scriptSetupMatch) {
      sections.scriptSetup = scriptSetupMatch[1];
    }

    // Extract regular script
    const scriptMatch = content.match(/<script(?!\s+setup)[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      sections.script = scriptMatch[1];
    }

    // Extract script language
    const scriptLangMatch = content.match(/<script[^>]*\s+lang=["']([^"']+)["']/);
    if (scriptLangMatch) {
      sections.scriptLang = scriptLangMatch[1];
    }

    // Extract style
    const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/);
    if (styleMatch) {
      sections.style = styleMatch[1];
      sections.styleScoped = /<style[^>]*\s+scoped/.test(content);
      sections.styleModules = /<style\s+module/.test(content);
    }

    // Extract style language
    const styleLangMatch = content.match(/<style\s+[^>]*lang=["']([^"']+)["']/);
    if (styleLangMatch) {
      sections.styleLang = styleLangMatch[1];
    }

    return sections;
  }

  /**
   * Extract template symbols using lightweight regex patterns
   */
  private extractTemplateSymbols(
    template: string,
    filePath?: string,
    options?: FrameworkParseOptions
  ): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    if (!template) {
      return symbols;
    }

    try {
      // Extract custom components (PascalCase or kebab-case)
      const componentRegex = /<([A-Z][a-zA-Z0-9]*|[a-z-]+(?:-[a-z]+)+)/g;
      let match;
      while ((match = componentRegex.exec(template)) !== null) {
        const componentName = match[1];

        const classification = entityClassifier.classify(
          'class',
          componentName,
          [],
          filePath || '',
          'vue',
          undefined,
          options?.repositoryFrameworks
        );

        symbols.push({
          name: componentName,
          symbol_type: SymbolType.CLASS,
          entity_type: classification.entityType,
          framework: 'vue',
          base_class: classification.baseClass || undefined,
          start_line: this.getLineFromIndex(template, match.index),
          end_line: this.getLineFromIndex(template, match.index),
          is_exported: false,
          signature: `<${componentName}>`,
        });
      }

      // Extract template refs
      const refRegex = /ref=["']([^"']+)["']/g;
      while ((match = refRegex.exec(template)) !== null) {
        const refName = match[1];

        const classification = entityClassifier.classify(
          'variable',
          refName,
          [],
          filePath || '',
          'vue',
          undefined,
          options?.repositoryFrameworks
        );

        symbols.push({
          name: refName,
          symbol_type: SymbolType.VARIABLE,
          entity_type: classification.entityType,
          framework: 'vue',
          base_class: classification.baseClass || undefined,
          start_line: this.getLineFromIndex(template, match.index),
          end_line: this.getLineFromIndex(template, match.index),
          is_exported: false,
          signature: `ref="${refName}"`,
        });
      }

      // Extract v-model variables
      const vModelRegex = /v-model=["']([^"']+)["']/g;
      while ((match = vModelRegex.exec(template)) !== null) {
        const varName = match[1];

        const classification = entityClassifier.classify(
          'variable',
          varName,
          [],
          filePath || '',
          'vue',
          undefined,
          options?.repositoryFrameworks
        );

        symbols.push({
          name: varName,
          symbol_type: SymbolType.VARIABLE,
          entity_type: classification.entityType,
          framework: 'vue',
          base_class: classification.baseClass || undefined,
          start_line: this.getLineFromIndex(template, match.index),
          end_line: this.getLineFromIndex(template, match.index),
          is_exported: false,
          signature: `v-model="${varName}"`,
        });
      }

      // Extract interpolated variables {{ variable }}
      const interpolationRegex = /\{\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\}\}/g;
      while ((match = interpolationRegex.exec(template)) !== null) {
        const varName = match[1];
        if (!this.isJavaScriptKeyword(varName)) {
          const classification = entityClassifier.classify(
            'variable',
            varName,
            [],
            filePath || '',
            'vue',
            undefined,
            options?.repositoryFrameworks
          );

          symbols.push({
            name: varName,
            symbol_type: SymbolType.VARIABLE,
            entity_type: classification.entityType,
            framework: 'vue',
            base_class: classification.baseClass || undefined,
            start_line: this.getLineFromIndex(template, match.index),
            end_line: this.getLineFromIndex(template, match.index),
            is_exported: false,
            signature: `{{ ${varName} }}`,
          });
        }
      }
    } catch (error) {
      logger.warn(`Error extracting template symbols: ${error}`);
    }

    return symbols;
  }

  /**
   * Get line number from string index
   */
  private getLineFromIndex(content: string, index: number): number {
    return content.substring(0, index).split('\n').length;
  }

  /**
   * Check if a string is a JavaScript keyword
   */
  private isJavaScriptKeyword(word: string): boolean {
    const keywords = new Set([
      'const',
      'let',
      'var',
      'function',
      'return',
      'if',
      'else',
      'for',
      'while',
      'do',
      'switch',
      'case',
      'break',
      'continue',
      'try',
      'catch',
      'finally',
      'throw',
      'new',
      'this',
      'typeof',
      'instanceof',
      'in',
      'of',
      'true',
      'false',
      'null',
      'undefined',
      'void',
      'delete',
      'class',
      'extends',
      'super',
      'static',
    ]);

    return keywords.has(word);
  }

  /**
   * Extract teleport targets
   */
  private extractTeleportTargets(template: string): string[] {
    const targets: string[] = [];
    const regex = /<(?:Teleport|teleport)[^>]+to=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(template)) !== null) {
      if (!targets.includes(match[1])) {
        targets.push(match[1]);
      }
    }
    return targets;
  }

  /**
   * Extract transition names
   */
  private extractTransitionNames(template: string): string[] {
    const names: string[] = [];
    const regex = /<(?:Transition|transition|TransitionGroup)[^>]+name=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(template)) !== null) {
      if (!names.includes(match[1])) {
        names.push(match[1]);
      }
    }
    return names;
  }

  /**
   * Extract CSS Modules classes
   */
  private extractCSSModules(content: string): string[] {
    const classes: string[] = [];

    // Extract from template usage: $style.className
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (templateMatch) {
      const template = templateMatch[1];
      const regex = /\$style\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(template)) !== null) {
        if (!classes.includes(match[1])) {
          classes.push(match[1]);
        }
      }
    }

    // Extract from style module section
    const styleModuleMatch = content.match(/<style\s+module[^>]*>([\s\S]*?)<\/style>/);
    if (styleModuleMatch) {
      const styles = styleModuleMatch[1];
      const regex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)\s*{/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(styles)) !== null) {
        if (!classes.includes(match[1])) {
          classes.push(match[1]);
        }
      }
    }

    return classes;
  }

  /**
   * Extract CSS preprocessors
   */
  private extractPreprocessors(content: string): string[] {
    const preprocessors: string[] = [];
    const styleMatches = content.match(/<style[^>]*>/g);

    if (styleMatches) {
      for (const styleTag of styleMatches) {
        const langMatch = styleTag.match(/lang=["']([^"']+)["']/);
        if (langMatch) {
          const lang = langMatch[1];
          if (['scss', 'sass', 'less', 'stylus'].includes(lang) && !preprocessors.includes(lang)) {
            preprocessors.push(lang);
          }
        }
      }
    }

    return preprocessors;
  }

  /**
   * Extract CSS variables
   */
  private extractCSSVariables(content: string): string[] {
    const variables: string[] = [];

    // Extract CSS custom properties
    const cssVarRegex = /--([a-zA-Z-][a-zA-Z0-9-]*)/g;
    let match: RegExpExecArray | null;
    while ((match = cssVarRegex.exec(content)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }

    // Extract SCSS/SASS variables
    const sassVarRegex = /\$([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
    while ((match = sassVarRegex.exec(content)) !== null) {
      if (!variables.includes(`$${match[1]}`)) {
        variables.push(`$${match[1]}`);
      }
    }

    // Extract Less variables
    const lessVarRegex = /@import/g;
    if (lessVarRegex.test(content)) {
      variables.push('@import');
    }

    return variables;
  }

  /**
   * Check if content has dynamic styling
   */
  private hasDynamicStyling(content: string): boolean {
    return /:style=/.test(content) || /:class=/.test(content);
  }

  /**
   * Extract dynamic style variables
   */
  private extractDynamicStyleVariables(content: string): string[] {
    const variables: string[] = [];

    // Extract variables from :style and :class bindings
    const styleRegex = /:(?:style|class)=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = styleRegex.exec(content)) !== null) {
      // Simple variable extraction - could be enhanced
      const varMatches = match[1].match(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g);
      if (varMatches) {
        for (const varMatch of varMatches) {
          if (
            !variables.includes(varMatch) &&
            !['true', 'false', 'null', 'undefined'].includes(varMatch)
          ) {
            variables.push(varMatch);
          }
        }
      }
    }

    return variables;
  }

  /**
   * Extract TypeScript utility types
   */
  private extractUtilityTypes(content: string): string[] {
    const utilityTypes: string[] = [];
    const regex =
      /\b(Partial|Required|Readonly|Record|Pick|Omit|Exclude|Extract|NonNullable|Parameters|ConstructorParameters|ReturnType|InstanceType|ThisParameterType|OmitThisParameter|ThisType|Uppercase|Lowercase|Capitalize|Uncapitalize|Array|Promise)\b/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (!utilityTypes.includes(match[1])) {
        utilityTypes.push(match[1]);
      }
    }

    return utilityTypes;
  }

  /**
   * Extract generic functions
   */
  private extractGenericFunctions(content: string): string[] {
    const functions: string[] = [];
    const regex = /(?:function\s+(\w+)\s*<[^>]+>|const\s+(\w+)\s*=\s*<[^>]+>)/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const funcName = match[1] || match[2];
      if (funcName && !functions.includes(funcName)) {
        functions.push(funcName);
      }
    }

    return functions;
  }

  /**
   * Check if content has utility types
   */
  private hasUtilityTypes(content: string): boolean {
    return /\b(Partial|Required|Readonly|Record|Pick|Omit|Exclude|Extract|NonNullable|Parameters|ConstructorParameters|ReturnType|InstanceType|Array|Promise)</.test(
      content
    );
  }
}
