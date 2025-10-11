import Parser from 'tree-sitter';
import { typescript as TypeScript } from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import { createComponentLogger } from '../../utils/logger';
import { VueSFCParser } from './vue-sfc-parser';

const logger = createComponentLogger('api-call-extractor');

export interface ExtractedApiCall {
  url: string;
  method: string;
  line: number;
  column: number;
  filePath?: string;
  callerName?: string;
}

interface VariableBinding {
  name: string;
  value: string;
  node: Parser.SyntaxNode;
  position: number; // Start position in the file
}

interface FunctionInfo {
  name: string;
  parameters: string[];
  node: Parser.SyntaxNode;
  returns: string[];
}

export class ApiCallExtractor {
  private parser: Parser;
  private logger: any;
  private sfcParser: VueSFCParser;

  constructor() {
    this.parser = new Parser();
    this.logger = logger;
    this.sfcParser = new VueSFCParser();
  }

  extractFromContent(
    content: string,
    filePath: string,
    language: 'typescript' | 'javascript' = 'typescript'
  ): ExtractedApiCall[] {
    try {
      let scriptContent = content;

      if (filePath.endsWith('.vue')) {
        scriptContent = this.extractScriptFromVue(content);
        if (!scriptContent) {
          this.logger.debug('No script content found in Vue file', { filePath });
          return [];
        }
        this.logger.debug('Extracted script from Vue file', {
          filePath,
          scriptLength: scriptContent.length
        });
      }

      this.parser.setLanguage(language === 'typescript' ? TypeScript : JavaScript);
      const tree = this.parser.parse(scriptContent);
      const rootNode = tree.rootNode;

      if (rootNode.hasError) {
        this.logger.warn('Parse tree has errors', {
          filePath,
          nodeType: rootNode.type,
          errorCount: this.countErrors(rootNode),
        });
      }

      this.logger.debug('Parse tree created', {
        filePath,
        rootType: rootNode.type,
        hasError: rootNode.hasError,
        childCount: rootNode.childCount,
      });

      const variableBindings = this.extractVariableBindings(rootNode, scriptContent);
      const functionInfos = this.extractFunctionInfos(rootNode, scriptContent);

      this.logger.debug('Extracted bindings and functions', {
        filePath,
        variableBindings: variableBindings.length,
        functionInfos: functionInfos.size,
      });

      const apiCalls: ExtractedApiCall[] = [];

      this.traverseForApiCalls(rootNode, scriptContent, variableBindings, functionInfos, apiCalls, filePath);

      // Deduplicate API calls (same line + URL can appear multiple times during resolution)
      const uniqueApiCalls: ExtractedApiCall[] = [];
      const seenKeys = new Set<string>();

      for (const call of apiCalls) {
        const key = `${call.line}|${call.method}|${call.url}|${call.callerName || ''}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueApiCalls.push(call);
        }
      }

      this.logger.debug('API call extraction complete', {
        filePath,
        callsFound: uniqueApiCalls.length,
        duplicatesRemoved: apiCalls.length - uniqueApiCalls.length,
      });

      return uniqueApiCalls;
    } catch (error) {
      this.logger.error('Failed to extract API calls', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return [];
    }
  }

  private countErrors(node: Parser.SyntaxNode): number {
    let count = 0;
    if (node.hasError) {
      if (node.type === 'ERROR' || node.isMissing) {
        count++;
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          count += this.countErrors(child);
        }
      }
    }
    return count;
  }

  private extractScriptFromVue(vueContent: string): string {
    const sections = this.sfcParser.extractSections(vueContent);
    return this.sfcParser.getCombinedScript(sections);
  }

  private extractVariableBindings(rootNode: Parser.SyntaxNode, content: string): VariableBinding[] {
    const bindings: VariableBinding[] = [];

    const traverse = (node: Parser.SyntaxNode): void => {
      // Only process variable_declarator nodes (not lexical_declaration)
      // lexical_declaration is the parent (const/let/var statement)
      // variable_declarator is the child (name = value part)
      if (node.type === 'variable_declarator') {
        const nameNode = node.childForFieldName('name');
        const valueNode = node.childForFieldName('value');

        if (nameNode && valueNode) {
          const name = this.getNodeText(nameNode, content);
          const value = this.resolveValue(valueNode, content);

          if (value) {
            // Handle both single values and arrays (from ternary expressions)
            const values = Array.isArray(value) ? value : [value];

            for (const url of values) {
              if (this.isApiUrl(url)) {
                bindings.push({
                  name,
                  value: url,
                  node: valueNode,
                  position: nameNode.startIndex, // Store position for scope resolution
                });
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    };

    traverse(rootNode);

    return bindings;
  }

  private extractFunctionInfos(rootNode: Parser.SyntaxNode, content: string): Map<string, FunctionInfo> {
    const functions = new Map<string, FunctionInfo>();

    const traverse = (node: Parser.SyntaxNode): void => {
      if (node.type === 'variable_declarator') {
        const nameNode = node.childForFieldName('name');
        const valueNode = node.childForFieldName('value');

        if (nameNode && valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
          const parametersNode = valueNode.childForFieldName('parameters');
          const bodyNode = valueNode.childForFieldName('body');

          if (parametersNode && bodyNode) {
            const name = this.getNodeText(nameNode, content);
            const parameters = this.extractParameterNames(parametersNode, content);
            const returns = this.extractReturnUrls(bodyNode, content);

            if (returns.length > 0) {
              this.logger.debug('Found URL builder function (const)', {
                name,
                parameters: parameters.length,
                returns: returns.length,
                sampleReturn: returns[0],
              });
              functions.set(name, {
                name,
                parameters,
                node: valueNode,
                returns,
              });
            }
          }
        }
      } else if (
        node.type === 'function_declaration' ||
        node.type === 'method_definition'
      ) {
        const nameNode = node.childForFieldName('name');
        const parametersNode = node.childForFieldName('parameters');
        const bodyNode = node.childForFieldName('body');

        if (parametersNode && bodyNode) {
          const name = nameNode ? this.getNodeText(nameNode, content) : 'anonymous';
          const parameters = this.extractParameterNames(parametersNode, content);
          const returns = this.extractReturnUrls(bodyNode, content);

          if (returns.length > 0) {
            this.logger.debug('Found URL builder function (func/method)', {
              name,
              parameters: parameters.length,
              returns: returns.length,
              sampleReturn: returns[0],
            });
            functions.set(name, {
              name,
              parameters,
              node,
              returns,
            });
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    };

    traverse(rootNode);
    return functions;
  }

  private extractParameterNames(parametersNode: Parser.SyntaxNode, content: string): string[] {
    const params: string[] = [];

    const traverse = (node: Parser.SyntaxNode): void => {
      if (node.type === 'identifier' || node.type === 'required_parameter') {
        const param = this.getNodeText(node, content).trim();
        if (param && !params.includes(param)) {
          params.push(param);
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    };

    traverse(parametersNode);
    return params;
  }

  private extractReturnUrls(bodyNode: Parser.SyntaxNode, content: string): string[] {
    const urls: string[] = [];

    const traverse = (node: Parser.SyntaxNode): void => {
      if (node.type === 'return_statement') {
        const valueNode = node.childForFieldName('argument') || node.child(1);
        if (valueNode) {
          const value = this.resolveValue(valueNode, content);
          if (value) {
            // Handle both single values and arrays (from ternary expressions)
            const values = Array.isArray(value) ? value : [value];
            for (const url of values) {
              if (this.isApiUrl(url)) {
                urls.push(url);
              }
            }
          }
        }
      } else if (node.type === 'switch_statement') {
        const bodyNode = node.childForFieldName('body');
        if (bodyNode) {
          this.extractSwitchCaseReturns(bodyNode, content, urls);
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    };

    traverse(bodyNode);
    return urls;
  }

  private extractSwitchCaseReturns(switchBodyNode: Parser.SyntaxNode, content: string, urls: string[]): void {
    const traverse = (node: Parser.SyntaxNode): void => {
      if (node.type === 'switch_case') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type === 'return_statement') {
            const valueNode = child.childForFieldName('argument') || child.child(1);
            if (valueNode) {
              const value = this.resolveValue(valueNode, content);
              if (value) {
                // Handle both single values and arrays (from ternary expressions)
                const values = Array.isArray(value) ? value : [value];
                for (const url of values) {
                  if (this.isApiUrl(url)) {
                    urls.push(url);
                  }
                }
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    };

    traverse(switchBodyNode);
  }

  private traverseForApiCalls(
    node: Parser.SyntaxNode,
    content: string,
    variableBindings: VariableBinding[],
    functionInfos: Map<string, FunctionInfo>,
    apiCalls: ExtractedApiCall[],
    filePath: string
  ): void {
    if (node.type === 'call_expression') {
      const extractedCalls = this.extractApiCallFromNode(node, content, variableBindings, functionInfos, filePath);
      if (extractedCalls) {
        if (Array.isArray(extractedCalls)) {
          apiCalls.push(...extractedCalls);
        } else {
          apiCalls.push(extractedCalls);
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.traverseForApiCalls(child, content, variableBindings, functionInfos, apiCalls, filePath);
      }
    }
  }

  private extractApiCallFromNode(
    node: Parser.SyntaxNode,
    content: string,
    variableBindings: VariableBinding[],
    functionInfos: Map<string, FunctionInfo>,
    filePath: string
  ): ExtractedApiCall | ExtractedApiCall[] | null {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) return null;

    const argumentsNode = node.childForFieldName('arguments');
    if (!argumentsNode) return null;

    const firstArgNode = argumentsNode.namedChild(0);
    if (!firstArgNode) return null;

    // First check: Is this an HTTP call pattern?
    const httpInfo = this.detectHttpCallPattern(functionNode, argumentsNode, content);

    if (!httpInfo) return null;

    // Second check: Does first argument resolve to a URL?
    const urlResult = this.resolveUrlArgument(firstArgNode, content, variableBindings, functionInfos);
    if (!urlResult) return null;

    const method = httpInfo.method;

    const enclosingFunction = this.findEnclosingFunction(node);
    const callerName = enclosingFunction
      ? this.getFunctionName(enclosingFunction, content)
      : undefined;

    // If we got an array of URLs (from URL builder with multiple branches),
    // create separate API call entries for each possible endpoint
    if (Array.isArray(urlResult)) {
      return urlResult.map(url => ({
        url,
        method,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        filePath,
        callerName,
      }));
    }

    return {
      url: urlResult,
      method,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      filePath,
      callerName,
    };
  }

  private detectHttpCallPattern(
    functionNode: Parser.SyntaxNode,
    argumentsNode: Parser.SyntaxNode,
    content: string
  ): { method: string } | null {
    // Unwrap await: await axios.get(...) -> axios.get(...)
    let actualFunctionNode = functionNode;
    if (functionNode.type === 'await_expression') {
      // Tree-sitter doesn't have named fields for await, use first named child
      const innerExpression = functionNode.namedChild(0);
      if (innerExpression) {
        actualFunctionNode = innerExpression;
      }
    }

    // Handle TypeScript generics: axios.get<Type>(...) -> axios.get
    if (actualFunctionNode.type === 'call_expression') {
      const innerFunction = actualFunctionNode.childForFieldName('function');
      if (innerFunction) {
        actualFunctionNode = innerFunction;
      }
    }

    // Pattern 1: member_expression where property is an HTTP method
    // Examples: axios.get, client.post, http.delete, axios.get<Type>
    if (actualFunctionNode.type === 'member_expression') {
      const propertyNode = actualFunctionNode.childForFieldName('property');
      if (propertyNode) {
        const propertyName = this.getNodeText(propertyNode, content).toUpperCase();
        if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'REQUEST'].includes(propertyName)) {
          return { method: propertyName === 'REQUEST' ? 'GET' : propertyName };
        }
      }
    }

    // Pattern 2: identifier 'fetch' with options object containing method
    // Example: fetch(url, { method: 'POST' }) or fetch<Type>(url, { method: 'POST' })
    if (actualFunctionNode.type === 'identifier') {
      const name = this.getNodeText(actualFunctionNode, content);
      if (name === 'fetch') {
        const secondArgNode = argumentsNode.namedChild(1);
        if (secondArgNode && secondArgNode.type === 'object') {
          const methodProperty = this.findPropertyInObject(secondArgNode, 'method', content);
          if (methodProperty) {
            return { method: methodProperty.toUpperCase() };
          }
        }
        // fetch without options defaults to GET
        return { method: 'GET' };
      }
    }

    // Not an HTTP call pattern
    return null;
  }

  private findPropertyInObject(objectNode: Parser.SyntaxNode, propertyName: string, content: string): string | null {
    for (let i = 0; i < objectNode.childCount; i++) {
      const child = objectNode.child(i);
      if (child && child.type === 'pair') {
        const keyNode = child.childForFieldName('key');
        const valueNode = child.childForFieldName('value');

        if (keyNode && valueNode) {
          const key = this.getNodeText(keyNode, content).replace(/['"]/g, '');
          if (key === propertyName) {
            const value = this.getNodeText(valueNode, content).replace(/['"]/g, '');
            return value;
          }
        }
      }
    }
    return null;
  }

  private resolveUrlArgument(
    argNode: Parser.SyntaxNode,
    content: string,
    variableBindings: VariableBinding[],
    functionInfos: Map<string, FunctionInfo>
  ): string | string[] | null {
    if (argNode.type === 'string' || argNode.type === 'template_string') {
      return this.resolveValue(argNode, content);
    }

    if (argNode.type === 'identifier') {
      const varName = this.getNodeText(argNode, content);
      const callPosition = argNode.startIndex;

      // Find the closest variable binding with this name that appears BEFORE this call
      // (searching backwards from the call position)
      const candidates = variableBindings
        .filter(b => b.name === varName && b.position < callPosition)
        .sort((a, b) => b.position - a.position); // Sort by position descending

      if (candidates.length > 0) {
        // Get the position of the closest binding
        const closestPosition = candidates[0].position;

        // Get ALL bindings at that position (e.g., from ternary expression)
        const bindingsAtSamePosition = candidates.filter(b => b.position === closestPosition);

        if (bindingsAtSamePosition.length === 1) {
          return bindingsAtSamePosition[0].value;
        } else {
          // Multiple bindings at same position (ternary expression) - return all
          return bindingsAtSamePosition.map(b => b.value);
        }
      }

      const enclosingFunction = this.findEnclosingFunction(argNode);
      if (enclosingFunction) {
        const funcName = this.getFunctionName(enclosingFunction, content);
        const funcInfo = functionInfos.get(funcName);

        if (funcInfo && funcInfo.parameters.includes(varName)) {
          const callSites = this.findCallSites(enclosingFunction, content);

          for (const callSite of callSites) {
            const passedUrl = this.extractArgumentAtCallSite(callSite, varName, funcInfo, content);
            if (passedUrl) {
              return passedUrl;
            }
          }
        }
      }

      const urlBuilderFunctions = Array.from(functionInfos.values()).filter(f => f.returns.length > 0);
      if (urlBuilderFunctions.length > 0) {
        const allPossibleUrls: string[] = [];

        for (const urlFunc of urlBuilderFunctions) {
          for (const url of urlFunc.returns) {
            if (this.isApiUrl(url)) {
              allPossibleUrls.push(url);
            }
          }
        }

        if (allPossibleUrls.length > 0) {
          this.logger.debug('Using URL builder fallback - returning ALL possible URLs', {
            varName,
            urlCount: allPossibleUrls.length,
            urls: allPossibleUrls,
          });
          return allPossibleUrls; // Return array of ALL possible URLs
        }
      }
    }

    return null;
  }

  private findEnclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    let current = node.parent;
    while (current) {
      if (
        current.type === 'function_declaration' ||
        current.type === 'arrow_function' ||
        current.type === 'function_expression' ||
        current.type === 'method_definition'
      ) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  private getFunctionName(functionNode: Parser.SyntaxNode, content: string): string {
    const nameNode = functionNode.childForFieldName('name');
    if (nameNode) {
      return this.getNodeText(nameNode, content);
    }

    if (functionNode.parent && functionNode.parent.type === 'variable_declarator') {
      const parentNameNode = functionNode.parent.childForFieldName('name');
      if (parentNameNode) {
        return this.getNodeText(parentNameNode, content);
      }
    }

    let current = functionNode.parent;
    let depth = 0;
    const MAX_DEPTH = 15;

    while (current && depth < MAX_DEPTH) {
      if (
        current.type === 'function_declaration' ||
        current.type === 'arrow_function' ||
        current.type === 'function_expression' ||
        current.type === 'method_definition'
      ) {
        const parentFunctionName = current.childForFieldName('name');
        if (parentFunctionName) {
          return this.getNodeText(parentFunctionName, content);
        }

        if (current.parent && current.parent.type === 'variable_declarator') {
          const varName = current.parent.childForFieldName('name');
          if (varName) {
            return this.getNodeText(varName, content);
          }
        }
      }

      current = current.parent;
      depth++;
    }

    return 'anonymous';
  }

  private findCallSites(functionNode: Parser.SyntaxNode, content: string): Parser.SyntaxNode[] {
    const root = this.findRootNode(functionNode);
    const funcName = this.getFunctionName(functionNode, content);
    const callSites: Parser.SyntaxNode[] = [];

    const traverse = (node: Parser.SyntaxNode): void => {
      if (node.type === 'call_expression') {
        const calleeNode = node.childForFieldName('function');
        if (calleeNode) {
          const calleeName = this.getNodeText(calleeNode, content);
          if (calleeName === funcName || calleeName.endsWith(`.${funcName}`)) {
            callSites.push(node);
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.id !== functionNode.id) {
          traverse(child);
        }
      }
    };

    traverse(root);
    return callSites;
  }

  private extractArgumentAtCallSite(
    callSite: Parser.SyntaxNode,
    paramName: string,
    funcInfo: FunctionInfo,
    content: string
  ): string | string[] | null {
    const argsNode = callSite.childForFieldName('arguments');
    if (!argsNode) return null;

    const paramIndex = funcInfo.parameters.indexOf(paramName);
    if (paramIndex === -1) return null;

    const argNode = argsNode.namedChild(paramIndex);
    if (!argNode) return null;

    return this.resolveValue(argNode, content);
  }

  private findRootNode(node: Parser.SyntaxNode): Parser.SyntaxNode {
    let current = node;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }

  private resolveValue(node: Parser.SyntaxNode, content: string): string | string[] | null {
    if (node.type === 'string') {
      let text = this.getNodeText(node, content);
      text = text.replace(/^['"`]|['"`]$/g, '');
      return this.normalizeUrl(text);
    }

    if (node.type === 'template_string') {
      let text = this.getNodeText(node, content);
      text = text.replace(/^`|`$/g, '');
      text = text.replace(/\$\{[^}]+\}/g, '{id}');
      return this.normalizeUrl(text);
    }

    // Handle ternary expressions: condition ? value1 : value2
    // Tree-sitter structure: [condition, ?, consequence, :, alternative]
    if (node.type === 'ternary_expression') {
      const urls: string[] = [];

      // Iterate through all children and extract string/template_string nodes
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && (child.type === 'string' || child.type === 'template_string')) {
          const value = this.resolveValue(child, content);
          if (value) {
            if (Array.isArray(value)) {
              urls.push(...value);
            } else {
              urls.push(value);
            }
          }
        }
      }

      // Return array of unique URLs (deduplicate if both branches return same URL)
      return urls.length > 0 ? [...new Set(urls)] : null;
    }

    return null;
  }

  private normalizeUrl(url: string): string {
    return url.replace(/\$\{[^}]+\}/g, '{id}');
  }

  private isApiUrl(url: string): boolean {
    return (
      url.startsWith('/api/') ||
      url.startsWith('/sanctum/') ||
      url.startsWith('http://') ||
      url.startsWith('https://')
    );
  }

  private getNodeText(node: Parser.SyntaxNode, content: string): string {
    return content.substring(node.startIndex, node.endIndex);
  }
}
