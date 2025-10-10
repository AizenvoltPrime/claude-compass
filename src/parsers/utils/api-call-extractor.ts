import Parser from 'tree-sitter';
import { typescript as TypeScript } from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import { createComponentLogger } from '../../utils/logger';

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

  constructor() {
    this.parser = new Parser();
    this.logger = logger;
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
        variableBindings: variableBindings.size,
        functionInfos: functionInfos.size,
      });

      const apiCalls: ExtractedApiCall[] = [];

      this.traverseForApiCalls(rootNode, scriptContent, variableBindings, functionInfos, apiCalls, filePath);

      this.logger.debug('API call extraction complete', {
        filePath,
        callsFound: apiCalls.length,
      });

      return apiCalls;
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
    const scriptTagRegex = /<script[^>]*>([\s\S]*?)<\/script>/i;
    const match = vueContent.match(scriptTagRegex);

    if (match && match[1]) {
      return match[1];
    }

    return '';
  }

  private extractVariableBindings(rootNode: Parser.SyntaxNode, content: string): Map<string, VariableBinding> {
    const bindings = new Map<string, VariableBinding>();

    const traverse = (node: Parser.SyntaxNode): void => {
      if (
        node.type === 'variable_declarator' ||
        node.type === 'lexical_declaration'
      ) {
        const nameNode = node.childForFieldName('name');
        const valueNode = node.childForFieldName('value');

        if (nameNode && valueNode) {
          const name = this.getNodeText(nameNode, content);
          const value = this.resolveValue(valueNode, content);

          if (value && this.isApiUrl(value)) {
            bindings.set(name, {
              name,
              value,
              node: valueNode,
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
          if (value && this.isApiUrl(value)) {
            urls.push(value);
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
              if (value && this.isApiUrl(value)) {
                urls.push(value);
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
    variableBindings: Map<string, VariableBinding>,
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
    variableBindings: Map<string, VariableBinding>,
    functionInfos: Map<string, FunctionInfo>,
    filePath: string
  ): ExtractedApiCall | ExtractedApiCall[] | null {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) return null;

    const functionText = this.getNodeText(functionNode, content);
    const { method, isApiCall } = this.parseApiCallFunction(functionText);

    if (!isApiCall) return null;

    const argumentsNode = node.childForFieldName('arguments');
    if (!argumentsNode) return null;

    const firstArgNode = argumentsNode.namedChild(0);
    if (!firstArgNode) return null;

    const urlResult = this.resolveUrlArgument(firstArgNode, content, variableBindings, functionInfos);

    if (!urlResult) return null;

    // If we got an array of URLs (from fallback), create multiple API calls
    if (Array.isArray(urlResult)) {
      return urlResult.map(url => ({
        url,
        method,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        filePath,
      }));
    }

    return {
      url: urlResult,
      method,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      filePath,
    };
  }

  private parseApiCallFunction(functionText: string): { method: string; isApiCall: boolean } {
    const axiosMatch = functionText.match(/axios\.(get|post|put|patch|delete)/);
    if (axiosMatch) {
      return { method: axiosMatch[1].toUpperCase(), isApiCall: true };
    }

    if (functionText.includes('fetch') || functionText.includes('$fetch')) {
      return { method: 'GET', isApiCall: true };
    }

    if (functionText.includes('useFetch') || functionText.includes('useAsyncData')) {
      return { method: 'GET', isApiCall: true };
    }

    return { method: '', isApiCall: false };
  }

  private resolveUrlArgument(
    argNode: Parser.SyntaxNode,
    content: string,
    variableBindings: Map<string, VariableBinding>,
    functionInfos: Map<string, FunctionInfo>
  ): string | string[] | null {
    if (argNode.type === 'string' || argNode.type === 'template_string') {
      return this.resolveValue(argNode, content);
    }

    if (argNode.type === 'identifier') {
      const varName = this.getNodeText(argNode, content);
      const binding = variableBindings.get(varName);
      if (binding) {
        return binding.value;
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
  ): string | null {
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

  private resolveValue(node: Parser.SyntaxNode, content: string): string | null {
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

    return null;
  }

  private normalizeUrl(url: string): string {
    return url.replace(/\$\{[^}]+\}/g, '{id}');
  }

  private isApiUrl(url: string): boolean {
    return url.startsWith('/api/') || url.startsWith('http://') || url.startsWith('https://');
  }

  private getNodeText(node: Parser.SyntaxNode, content: string): string {
    return content.substring(node.startIndex, node.endIndex);
  }
}
