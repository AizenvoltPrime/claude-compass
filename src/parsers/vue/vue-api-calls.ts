import Parser from 'tree-sitter';
import { createComponentLogger } from '../../utils/logger';
import { normalizeUrlPattern } from '../utils/url-patterns';
import { VueApiCall, VueTypeInterface } from './vue-types';
import {
  extractStringValue,
  isValidApiUrl,
  findObjectProperty,
  inferTypeFromExpression,
  extractUrlFromFunction,
  extractGenericType,
} from './vue-utils';

const logger = createComponentLogger('vue-api-calls');

export function analyzeScriptInSinglePass(
  tree: Parser.Tree | null,
  scriptContent: string,
  filePath: string,
  isTypeScript: boolean,
  axiosIdentifiers: Set<string>
): {
  apiCalls: VueApiCall[];
  typeInterfaces: VueTypeInterface[];
} {
  const apiCalls: VueApiCall[] = [];
  const typeInterfaces: VueTypeInterface[] = [];

  try {
    if (!tree?.rootNode) {
      return { apiCalls, typeInterfaces };
    }

    const traverse = (node: Parser.SyntaxNode) => {
      switch (node.type) {
        case 'call_expression': {
          const apiCall = parseApiCallExpression(node, scriptContent, filePath, axiosIdentifiers);
          if (apiCall) {
            apiCalls.push(apiCall);
          }
          break;
        }
        case 'interface_declaration': {
          if (isTypeScript) {
            const interfaceEntity = parseInterfaceDeclaration(node, scriptContent, filePath);
            if (interfaceEntity) {
              typeInterfaces.push(interfaceEntity);
            }
          }
          break;
        }
        case 'type_alias_declaration': {
          if (isTypeScript) {
            const typeEntity = parseTypeAliasDeclaration(node, scriptContent, filePath);
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

export function extractApiCalls(
  tree: Parser.Tree | null,
  scriptContent: string,
  filePath: string,
  axiosIdentifiers: Set<string>
): VueApiCall[] {
  const apiCalls: VueApiCall[] = [];

  try {
    if (!tree?.rootNode) {
      return apiCalls;
    }

    trackAxiosImports(tree.rootNode, scriptContent, axiosIdentifiers);

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'call_expression') {
        const apiCall = parseApiCallExpression(node, scriptContent, filePath, axiosIdentifiers);
        if (apiCall) {
          apiCalls.push(apiCall);
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
    logger.warn(`Failed to extract API calls from ${filePath}`, { error });
  }

  return apiCalls;
}

export function parseApiCallExpression(
  node: Parser.SyntaxNode,
  scriptContent: string,
  filePath: string,
  axiosIdentifiers: Set<string>
): VueApiCall | null {
  const functionNode = node.child(0);
  if (!functionNode) return null;

  const functionName = functionNode.text;
  const argsNode = node.child(1);

  let method = 'GET';
  let url = '';
  let requestType: string | undefined;
  let responseType: string | undefined;

  // Pattern 1: fetch('/api/users')
  if (functionName === 'fetch' || functionName === '$fetch') {
    const result = parseFetchCall(argsNode, scriptContent);
    if (result) {
      url = result.url;
      method = result.method;
      requestType = result.requestType;
      responseType = result.responseType;
    }
  }
  // Pattern 2: axios.get('/api/users') or axios('/api/users', {method: 'POST'})
  else if (functionName.includes('axios')) {
    const result = parseAxiosCall(functionNode, argsNode, scriptContent, axiosIdentifiers);
    if (result) {
      url = result.url;
      method = result.method;
      requestType = result.requestType;
      responseType = result.responseType;
    }
  }
  // Pattern 3: useFetch('/api/users') (Nuxt composable)
  else if (functionName === 'useFetch' || functionName === 'useLazyFetch') {
    const result = parseUseFetchCall(argsNode, scriptContent);
    if (result) {
      url = result.url;
      method = result.method;
      requestType = result.requestType;
      responseType = result.responseType;
    }
  }

  if (!url || !isValidApiUrl(url)) {
    return null;
  }

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

export function parseFetchCall(
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

  const urlArg = argsNode.child(1);
  if (urlArg && (urlArg.type === 'string' || urlArg.type === 'template_string')) {
    url = extractStringValue(urlArg, scriptContent);
  }

  if (argsNode.childCount > 3) {
    const optionsArg = argsNode.child(3);
    if (optionsArg && optionsArg.type === 'object_expression') {
      const methodProp = findObjectProperty(optionsArg, 'method');
      if (methodProp) {
        method = extractStringValue(methodProp, scriptContent).toUpperCase();
      }

      const bodyProp = findObjectProperty(optionsArg, 'body');
      if (bodyProp) {
        requestType = inferTypeFromExpression(bodyProp, scriptContent);
      }
    }
  }

  return url ? { url, method, requestType, responseType } : null;
}

export function parseAxiosCall(
  functionNode: Parser.SyntaxNode,
  argsNode: Parser.SyntaxNode | null,
  scriptContent: string,
  axiosIdentifiers: Set<string>
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

      if (axiosIdentifiers.has(objectName)) {
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

  if (argsNode && argsNode.childCount > 1) {
    const urlArg = argsNode.child(1);
    if (urlArg && (urlArg.type === 'string' || urlArg.type === 'template_string')) {
      url = extractStringValue(urlArg, scriptContent);
    }
  }

  return url ? { url, method } : null;
}

export function parseUseFetchCall(
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

  if (urlArg.type === 'arrow_function' || urlArg.type === 'function_expression') {
    url = extractUrlFromFunction(urlArg, scriptContent);
  } else if (urlArg.type === 'string' || urlArg.type === 'template_string') {
    url = extractStringValue(urlArg, scriptContent);
  }

  const parentCall = urlArg.parent?.parent;
  if (parentCall && parentCall.type === 'call_expression') {
    responseType = extractGenericType(parentCall, scriptContent);
  }

  return url ? { url, method, responseType } : null;
}

export function parseTypeScriptInterfaces(
  tree: Parser.Tree | null,
  scriptContent: string,
  filePath: string
): VueTypeInterface[] {
  const interfaces: VueTypeInterface[] = [];

  try {
    if (!tree?.rootNode) return interfaces;

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'interface_declaration') {
        const interfaceEntity = parseInterfaceDeclaration(node, scriptContent, filePath);
        if (interfaceEntity) {
          interfaces.push(interfaceEntity);
        }
      }

      if (node.type === 'type_alias_declaration') {
        const typeEntity = parseTypeAliasDeclaration(node, scriptContent, filePath);
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

export function parseInterfaceDeclaration(
  node: Parser.SyntaxNode,
  scriptContent: string,
  filePath: string
): VueTypeInterface | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const interfaceName = nameNode.text;
  const properties: VueTypeInterface['properties'] = [];

  const bodyNode = node.childForFieldName('body');
  if (bodyNode && bodyNode.type === 'object_type') {
    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i);
      if (child && child.type === 'property_signature') {
        const prop = parsePropertySignature(child, scriptContent);
        if (prop) {
          properties.push(prop);
        }
      }
    }
  }

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

export function parseTypeAliasDeclaration(
  node: Parser.SyntaxNode,
  scriptContent: string,
  filePath: string
): VueTypeInterface | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const typeName = nameNode.text;

  return {
    type: 'type_interface',
    name: typeName,
    filePath,
    properties: [],
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

export function parsePropertySignature(
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

export function trackAxiosImports(
  rootNode: Parser.SyntaxNode,
  content: string,
  axiosIdentifiers: Set<string>
): void {
  axiosIdentifiers.clear();
  axiosIdentifiers.add('axios');

  const traverse = (node: Parser.SyntaxNode): void => {
    if (node.type === 'import_statement') {
      const source = node.childForFieldName('source');
      if (source && extractStringValue(source, content).includes('axios')) {
        const importClause = node.children.find(n => n.type === 'import_clause');
        if (importClause) {
          for (const child of importClause.children) {
            if (child.type === 'identifier') {
              axiosIdentifiers.add(child.text);
            } else if (child.type === 'named_imports') {
              for (const namedImport of child.children) {
                if (namedImport.type === 'import_specifier') {
                  const localName =
                    namedImport.childForFieldName('name') ||
                    namedImport.children.find(c => c.type === 'identifier');
                  if (localName) {
                    axiosIdentifiers.add(localName.text);
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
              axiosIdentifiers.add(name.text);
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
