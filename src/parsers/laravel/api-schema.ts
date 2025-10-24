import { SyntaxNode } from 'tree-sitter';
import { LaravelApiSchema } from './types';
import {
  findChildByType,
  findNodesByType,
  getClassName,
  getMethodName,
} from './ast-helpers';
import {
  extractArrayKey,
  extractArrayValueNode,
  extractRequestValidation,
} from './validation';

const logger = console; // TODO: Use proper logger

export async function extractApiSchemas(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): Promise<LaravelApiSchema[]> {
  const apiSchemas: LaravelApiSchema[] = [];

  try {
    // Look for controller classes
    const classNodes = findNodesByType(rootNode, 'class_declaration');

    for (const classNode of classNodes) {
      const className = getClassName(classNode, content);
      if (className && className.includes('Controller')) {
        const methods = findNodesByType(classNode, 'method_declaration');

        for (const methodNode of methods) {
          const methodName = getMethodName(methodNode, content);
          if (methodName && isApiMethod(methodNode, content)) {
            const schema = await parseApiMethodSchema(
              methodNode,
              methodName,
              className,
              content,
              filePath
            );
            if (schema) {
              apiSchemas.push(schema);
            }
          }
        }
      }
    }
  } catch (error) {
    logger.warn(`Failed to extract API schemas from ${filePath}`, { error });
  }

  return apiSchemas;
}

/**
 * Parse individual API method to extract schema information
 */
export async function parseApiMethodSchema(
  methodNode: SyntaxNode,
  methodName: string,
  className: string,
  content: string,
  filePath: string
): Promise<LaravelApiSchema | null> {
  try {
    // Extract HTTP method and route information
    const httpMethod = inferHttpMethod(methodName);
    const route = inferRoute(className, methodName);

    // Extract request validation
    const requestValidation = extractRequestValidation(methodNode, content, logger);

    // Extract response schema
    const responseSchema = extractResponseSchema(methodNode, content);

    return {
      type: 'api_schema',
      name: `${className}@${methodName}`,
      filePath,
      controllerMethod: `${className}@${methodName}`,
      route,
      httpMethod,
      requestValidation: requestValidation.length > 0 ? requestValidation : undefined,
      responseSchema,
      location: {
        line: methodNode.startPosition.row + 1,
        column: methodNode.startPosition.column,
      },
      framework: 'laravel',
      metadata: {
        className,
        methodName,
        isApiMethod: true,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse API method schema for ${methodName}`, { error });
    return null;
  }
}

export function findResponseJsonCalls(methodNode: SyntaxNode): SyntaxNode[] {
  const calls: SyntaxNode[] = [];

  const traverse = (node: SyntaxNode): void => {
    if (node.type === 'member_call_expression') {
      const methodName = node.childForFieldName('name');
      if (methodName && methodName.text === 'json') {
        calls.push(node);
      }
    }

    for (const child of node.children) {
      traverse(child);
    }
  };

  const body = methodNode.childForFieldName('body');
  if (body) traverse(body);

  return calls;
}

export function parseResponseArrayStructure(
  arrayNode: SyntaxNode,
  content: string
): any {
  const result: any = {};

  const elements = arrayNode.children.filter(n => n.type === 'array_element_initializer');

  for (const element of elements) {
    const key = extractArrayKey(element, content);
    if (!key) continue;

    const valueNode = extractArrayValueNode(element);
    if (!valueNode) continue;

    if (valueNode.type === 'array_creation_expression') {
      result[key] = parseResponseArrayStructure(valueNode, content);
    } else if (valueNode.type === 'string') {
      result[key] = 'string';
    } else {
      result[key] = 'mixed';
    }
  }

  return result;
}

/**
 * Helper methods for API schema extraction
 */
export function isApiMethod(methodNode: SyntaxNode, content: string): boolean {
  const methodText = content.substring(methodNode.startIndex, methodNode.endIndex);

  // Check for common API indicators
  const apiIndicators = [
    'return response()->json(',
    'return Response::json(',
    'return new JsonResponse(',
    'JsonResponse',
    'ApiResource',
    'Resource::',
    '->json(',
  ];

  return apiIndicators.some(indicator => methodText.includes(indicator));
}

export function inferHttpMethod(methodName: string): string {
  const methodName_lower = methodName.toLowerCase();

  if (methodName_lower.includes('store') || methodName_lower.includes('create')) {
    return 'POST';
  }
  if (methodName_lower.includes('update') || methodName_lower.includes('edit')) {
    return 'PUT';
  }
  if (methodName_lower.includes('destroy') || methodName_lower.includes('delete')) {
    return 'DELETE';
  }
  if (
    methodName_lower.includes('index') ||
    methodName_lower.includes('show') ||
    methodName_lower.includes('get')
  ) {
    return 'GET';
  }

  return 'GET'; // Default
}

export function inferRoute(className: string, methodName: string): string {
  // Remove "Controller" suffix
  const resourceName = className.replace(/Controller$/, '').toLowerCase();

  // Map common method names to routes
  switch (methodName.toLowerCase()) {
    case 'index':
      return `/api/${resourceName}`;
    case 'show':
      return `/api/${resourceName}/{id}`;
    case 'store':
      return `/api/${resourceName}`;
    case 'update':
      return `/api/${resourceName}/{id}`;
    case 'destroy':
      return `/api/${resourceName}/{id}`;
    default:
      return `/api/${resourceName}/${methodName.toLowerCase()}`;
  }
}

export function extractResponseSchema(methodNode: SyntaxNode, content: string): any {
  const methodText = content.substring(methodNode.startIndex, methodNode.endIndex);

  try {
    // Look for different response patterns
    if (methodText.includes('Resource::collection(')) {
      return { type: 'collection', resource: 'ApiResource' };
    }
    if (methodText.includes('Resource::make(') || methodText.includes('new \\w+Resource(')) {
      return { type: 'resource', resource: 'ApiResource' };
    }
    if (methodText.includes('response()->json(')) {
      const jsonCalls = findResponseJsonCalls(methodNode);
      for (const callNode of jsonCalls) {
        const args = callNode.childForFieldName('arguments');
        if (!args) continue;

        const arrayArg = findChildByType(args, 'array_creation_expression');
        if (arrayArg) {
          const structure = parseResponseArrayStructure(arrayArg, content);
          return { type: 'json', structure };
        }
      }
    }

    return null;
  } catch (error) {
    logger.warn(`Failed to extract response schema`, { error });
    return null;
  }
}
