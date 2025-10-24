import { SyntaxNode } from 'tree-sitter';
import { LaravelRoute } from './types';
import {
  traverseGroupChildren,
  getArrayElements,
  extractLaravelStringLiteral,
} from './ast-helpers';

const logger = console; // TODO: Use proper logger

export async function extractLaravelRoutes(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): Promise<LaravelRoute[]> {
  const routes: LaravelRoute[] = [];
  const processedNodes = new Set<SyntaxNode>();
  let groupCount = 0;
  let routeCount = 0;

  try {
    // Use traverseGroupChildren to avoid processing routes inside groups twice
    traverseGroupChildren(rootNode, node => {
      if (isRouteGroup(node)) {
        groupCount++;
        processRouteGroup(node, [], routes, processedNodes, filePath, content);
        // Return false to skip traversing into this group - processRouteGroup handles it
        return false;
      } else if (isRouteDefinition(node) && !processedNodes.has(node)) {
        routeCount++;
        const routeDef = parseRouteDefinition(node, filePath, content);
        if (Array.isArray(routeDef)) {
          routes.push(...routeDef);
        } else if (routeDef) {
          routes.push(routeDef);
        }
      }
      // Continue traversing other children
      return true;
    });
  } catch (error) {
    logger.error(`Route extraction failed for ${filePath}`, { error: error.message });
  }

  return routes;
}

export function processRouteGroup(
  groupNode: SyntaxNode,
  parentMiddleware: string[],
  routes: LaravelRoute[],
  processedNodes: Set<SyntaxNode>,
  filePath: string,
  content: string,
  parentPrefix: string = ''
): void {
  processedNodes.add(groupNode);
  const groupMiddleware = getRouteGroupMiddleware(groupNode, content);
  const accumulatedMiddleware = [...parentMiddleware, ...groupMiddleware];

  const groupPrefix = getRouteGroupPrefix(groupNode, content);
  const accumulatedPrefix = parentPrefix + (groupPrefix ? `/${groupPrefix}` : '');

  // Traverse only the immediate children of this group, not descendants of nested groups
  traverseGroupChildren(groupNode, innerNode => {
    if (innerNode === groupNode) {
      return true; // Continue traversing
    }

    if (isRouteGroup(innerNode) && !processedNodes.has(innerNode)) {
      // Process the nested group - it will handle its own routes
      processRouteGroup(
        innerNode,
        accumulatedMiddleware,
        routes,
        processedNodes,
        filePath,
        content,
        accumulatedPrefix
      );
      // Don't traverse into this nested group's children - it already processed them
      return false;
    } else if (isRouteDefinition(innerNode) && !processedNodes.has(innerNode)) {
      processedNodes.add(innerNode);
      const routeDef = parseRouteDefinition(innerNode, filePath, content, accumulatedPrefix);
      if (Array.isArray(routeDef)) {
        routeDef.forEach(route => {
          route.middleware = [...accumulatedMiddleware, ...route.middleware];
          routes.push(route);
        });
      } else if (routeDef) {
        routeDef.middleware = [...accumulatedMiddleware, ...routeDef.middleware];
        routes.push(routeDef);
      }
    }

    return true; // Continue traversing other children
  });
}

export function isRouteDefinition(node: SyntaxNode): boolean {
  // Check for Route::method() calls (scoped_call_expression in tree-sitter-php)
  if (node.type === 'scoped_call_expression') {
    // First child should be the class name (Route)
    // Second child should be the scope operator (::)
    // Third child should be the method name
    if (node.children && node.children.length >= 3) {
      const className = node.children[0];
      const methodName = node.children[2];

      if (className?.text === 'Route' && methodName) {
        const method = methodName.text;
        // Only treat actual route registration methods as route definitions
        // Exclude route group configuration methods like middleware(), prefix(), name()
        return [
          'get',
          'post',
          'put',
          'delete',
          'patch',
          'options',
          'any',
          'match',
          'resource',
          'apiResource',
          'group',
        ].includes(method);
      }
    }
  }

  // Check for $router->method() calls (member_call_expression)
  if (node.type === 'member_call_expression') {
    const firstChild = node.children && node.children[0];
    if (firstChild && (firstChild.text === '$router' || firstChild.text === '$route')) {
      return true;
    }
  }

  return false;
}

export function parseRouteDefinition(
  node: SyntaxNode,
  filePath: string,
  content: string,
  groupPrefix: string = ''
): LaravelRoute | LaravelRoute[] | null {
  try {
    const method = getRouteMethod(node);
    if (!method) return null;

    // Handle resource routes
    if (method === 'resource' || method === 'apiResource') {
      const handler = getRouteHandler(node, content);
      if (!handler) return null;

      const path = getRoutePath(node, content);
      if (!path) return null;

      // Apply Laravel route file prefix conventions before expanding resource routes
      // Exception: /sanctum routes should NOT get the /api prefix even when defined in api.php
      // Laravel Sanctum routes must be accessible without /api/ prefix for CORS/auth reasons
      const isSanctumRoute = path.startsWith('/sanctum/') || path.startsWith('sanctum/');
      const filePrefix = isSanctumRoute ? '' : getRouteFilePrefix(filePath);
      const fullPath = filePrefix + groupPrefix + (path.startsWith('/') ? path : '/' + path);

      return expandResourceRoute(fullPath, handler.controller, method === 'apiResource', filePath);
    }

    // Handle regular routes
    const path = getRoutePath(node, content);
    if (!path) return null;

    // Apply Laravel route file prefix conventions
    // Exception: /sanctum routes should NOT get the /api prefix even when defined in api.php
    // Laravel Sanctum routes must be accessible without /api/ prefix for CORS/auth reasons
    const isSanctumRoute = path.startsWith('/sanctum/') || path.startsWith('sanctum/');
    const filePrefix = isSanctumRoute ? '' : getRouteFilePrefix(filePath);

    // Apply file prefix, then group prefix
    const fullPath = filePrefix + groupPrefix + (path.startsWith('/') ? path : '/' + path);

    const handler = getRouteHandler(node, content);
    const middleware = getRouteMiddleware(node, content) || [];
    const routeName = getRouteName(node, content);

    const route: LaravelRoute = {
      type: 'route',
      name: routeName || `${method.toUpperCase()} ${fullPath}`,
      filePath,
      path: fullPath,
      method: method.toUpperCase(),
      controller: handler?.controller,
      action: handler?.action,
      middleware,
      routeName,
      framework: 'laravel',
      metadata: {
        parameters: extractRouteParameters(fullPath),
        closureLineNumber: handler?.closureLineNumber,
      },
    };

    return route;
  } catch (error) {
    logger.warn(`Failed to parse route definition at ${filePath}`, { error });
    return null;
  }
}

export function expandResourceRoute(
  resourcePath: string,
  controller: string,
  isApiResource: boolean,
  filePath: string
): LaravelRoute[] {
  const routes: LaravelRoute[] = [];
  const actions = isApiResource
    ? [
        { method: 'GET', action: 'index', path: resourcePath },
        { method: 'POST', action: 'store', path: resourcePath },
        { method: 'GET', action: 'show', path: `${resourcePath}/{id}` },
        { method: 'PUT', action: 'update', path: `${resourcePath}/{id}` },
        { method: 'DELETE', action: 'destroy', path: `${resourcePath}/{id}` },
      ]
    : [
        { method: 'GET', action: 'index', path: resourcePath },
        { method: 'GET', action: 'create', path: `${resourcePath}/create` },
        { method: 'POST', action: 'store', path: resourcePath },
        { method: 'GET', action: 'show', path: `${resourcePath}/{id}` },
        { method: 'GET', action: 'edit', path: `${resourcePath}/{id}/edit` },
        { method: 'PUT', action: 'update', path: `${resourcePath}/{id}` },
        { method: 'DELETE', action: 'destroy', path: `${resourcePath}/{id}` },
      ];

  for (const { method, action, path } of actions) {
    routes.push({
      type: 'route',
      name: `${controller}@${action}`,
      filePath,
      path,
      method,
      controller,
      action,
      middleware: [],
      framework: 'laravel',
      metadata: {
        resourceRoute: true,
        parameters: extractRouteParameters(path),
      },
    });
  }

  return routes;
}

export function isRouteFile(filePath: string): boolean {
  return filePath.includes('/routes/') || filePath.includes('\\routes\\');
}

export function getRouteFilePrefix(filePath: string): string {
  if (filePath.includes('/routes/api.php') || filePath.includes('\\routes\\api.php')) {
    return '/api';
  }
  if (filePath.includes('/routes/web.php') || filePath.includes('\\routes\\web.php')) {
    return '';
  }
  return '';
}

export function getRouteMethod(node: SyntaxNode): string | null {
  // For scoped_call_expression (Route::get())
  const methodName = node.childForFieldName('name');
  if (methodName) {
    return methodName.text;
  }

  // Fallback to checking children
  if (node.children && node.children.length > 0) {
    const lastChild = node.children[node.children.length - 1];
    if (lastChild && lastChild.type === 'name') {
      return lastChild.text;
    }
  }

  return null;
}

export function getRoutePath(node: SyntaxNode, content: string): string | null {
  const args = node.childForFieldName('arguments');
  if (!args) return null;

  // First argument is typically the path
  for (const child of args.children) {
    if (child.type === 'argument') {
      const stringNode = child.children.find(c => c.type === 'string');
      if (stringNode) {
        return extractLaravelStringLiteral(stringNode, content);
      }
    }
  }

  return null;
}

export function getRouteHandler(
  node: SyntaxNode,
  content: string
): { controller?: string; action?: string; closureLineNumber?: number } | null {
  const args = node.childForFieldName('arguments');
  if (!args) return null;

  // Look for second argument (handler)
  let argCount = 0;
  for (const child of args.children) {
    if (child.type === 'argument') {
      argCount++;
      if (argCount === 2) {
        // Check for array syntax ['Controller', 'action']
        const arrayNode = child.children.find(c => c.type === 'array_creation_expression');
        if (arrayNode) {
          const elements = getArrayElements(arrayNode, content);
          if (elements.length >= 1) {
            const controller = elements[0].replace(/::class$/, '');
            const action = elements.length > 1 ? elements[1] : undefined;
            return { controller, action };
          }
        }

        // Check for string syntax 'Controller@action'
        const stringNode = child.children.find(c => c.type === 'string');
        if (stringNode) {
          const handlerStr = extractLaravelStringLiteral(stringNode, content);
          const parts = handlerStr.split('@');
          return {
            controller: parts[0],
            action: parts.length > 1 ? parts[1] : undefined,
          };
        }

        // Check for closure
        const closureNode = child.children?.find(
          c => c.type === 'anonymous_function' || c.type === 'arrow_function'
        );
        if (closureNode) {
          return {
            action: 'Closure',
            closureLineNumber: closureNode.startPosition.row + 1
          };
        }
      }
    }
  }

  return null;
}

export function getRouteMiddleware(node: SyntaxNode, content: string): string[] | null {
  let currentNode: SyntaxNode | null = node;

  // Traverse up to find method chaining
  while (currentNode && currentNode.parent) {
    if (currentNode.parent.type === 'member_call_expression') {
      const methodName = currentNode.parent.childForFieldName('name');
      if (methodName && methodName.text === 'middleware') {
        const args = currentNode.parent.childForFieldName('arguments');
        if (args) {
          // Could be a string or an array
          for (const child of args.children) {
            if (child.type === 'argument') {
              const stringNode = child.children.find(c => c.type === 'string');
              if (stringNode) {
                return [extractLaravelStringLiteral(stringNode, content)];
              }

              const arrayNode = child.children.find(c => c.type === 'array_creation_expression');
              if (arrayNode) {
                return getArrayElements(arrayNode, content);
              }
            }
          }
        }
      }
      currentNode = currentNode.parent;
    } else {
      break;
    }
  }

  return null;
}

export function getRouteName(node: SyntaxNode, content: string): string | null {
  let currentNode: SyntaxNode | null = node;

  // Traverse up to find method chaining
  while (currentNode && currentNode.parent) {
    if (currentNode.parent.type === 'member_call_expression') {
      const methodName = currentNode.parent.childForFieldName('name');
      if (methodName && methodName.text === 'name') {
        const args = currentNode.parent.childForFieldName('arguments');
        if (args) {
          for (const child of args.children) {
            if (child.type === 'argument') {
              const stringNode = child.children.find(c => c.type === 'string');
              if (stringNode) {
                return extractLaravelStringLiteral(stringNode, content);
              }
            }
          }
        }
      }
      currentNode = currentNode.parent;
    } else {
      break;
    }
  }

  return null;
}

export function getCurrentRouteGroup(node: SyntaxNode): string | null {
  // Implementation would traverse up to find parent Route::group call
  // Simplified for now
  return null;
}

export function extractRouteParameters(path: string): string[] {
  const params: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match;

  while ((match = regex.exec(path)) !== null) {
    params.push(match[1]);
  }

  return params;
}

export function getRouteConstraints(node: SyntaxNode, content: string): any {
  // Look for where() method calls
  let currentNode: SyntaxNode | null = node;

  while (currentNode && currentNode.parent) {
    if (currentNode.parent.type === 'member_call_expression') {
      const methodName = currentNode.parent.childForFieldName('name');
      if (methodName && methodName.text === 'where') {
        // Extract constraints - simplified
        return {};
      }
      currentNode = currentNode.parent;
    } else {
      break;
    }
  }

  return {};
}

export function getRouteDomain(node: SyntaxNode, content: string): string | null {
  // Look for domain() method calls in route groups
  return null;
}

function isDirectRouteGroupCall(node: SyntaxNode): boolean {
  if (node.type !== 'scoped_call_expression') {
    return false;
  }

  const firstChild = node.children && node.children[0];
  const methodName = node.childForFieldName('name');
  return firstChild?.text === 'Route' && methodName?.text === 'group';
}

function isChainedRouteGroupCall(node: SyntaxNode): boolean {
  if (node.type !== 'member_call_expression') {
    return false;
  }

  const methodName = node.childForFieldName('name');
  if (methodName?.text !== 'group') {
    return false;
  }

  let current: SyntaxNode | null = node.childForFieldName('object');
  while (current) {
    if (current.type === 'scoped_call_expression') {
      const className = current.children?.[0];
      return className?.text === 'Route';
    }

    if (current.type === 'member_call_expression') {
      current = current.childForFieldName('object');
      continue;
    }

    break;
  }

  return false;
}

export function isRouteGroup(node: SyntaxNode): boolean {
  return isDirectRouteGroupCall(node) || isChainedRouteGroupCall(node);
}

export function getRouteGroupMiddleware(node: SyntaxNode, content: string): string[] {
  const middleware: string[] = [];

  // Look for first argument being an array with 'middleware' key
  const args = node.childForFieldName('arguments');
  if (!args) return middleware;

  for (const child of args.children) {
    if (child.type === 'argument') {
      const arrayNode = child.children.find(c => c.type === 'array_creation_expression');
      if (arrayNode) {
        // Parse array for 'middleware' key
        for (const element of arrayNode.children) {
          if (element.type === 'array_element_initializer') {
            const keyNode = element.children.find(c => c.type === 'string');
            if (keyNode && extractLaravelStringLiteral(keyNode, content) === 'middleware') {
              // Find the value after the arrow
              const arrowIndex = element.children.findIndex(c => c.type === '=>');
              if (arrowIndex !== -1 && arrowIndex + 1 < element.children.length) {
                const valueNode = element.children[arrowIndex + 1];
                if (valueNode.type === 'string') {
                  middleware.push(extractLaravelStringLiteral(valueNode, content));
                } else if (valueNode.type === 'array_creation_expression') {
                  middleware.push(...getArrayElements(valueNode, content));
                }
              }
            }
          }
        }
      }
      break; // Only check first argument
    }
  }

  return middleware;
}

export function getRouteGroupPrefix(node: SyntaxNode, content: string): string {
  let currentNode: SyntaxNode | null = node;

  while (currentNode) {
    if (currentNode.type === 'member_call_expression') {
      const nameNode = currentNode.childForFieldName('name');

      if (nameNode && nameNode.text === 'prefix') {
        const argsNode = currentNode.childForFieldName('arguments');
        if (argsNode) {
          for (const child of argsNode.children) {
            if (child.type === 'argument') {
              const stringNode = child.children.find(c => c.type === 'string');
              if (stringNode) {
                const prefix = extractLaravelStringLiteral(stringNode, content);
                return prefix.startsWith('/') ? prefix.substring(1) : prefix;
              }
            }
          }
        }
      }

      currentNode = currentNode.childForFieldName('object');
    } else if (currentNode.type === 'scoped_call_expression') {
      const className = currentNode.children && currentNode.children[0];
      const methodName = currentNode.childForFieldName('name');

      if (className && className.text === 'Route' && methodName && methodName.text === 'prefix') {
        const argsNode = currentNode.childForFieldName('arguments');
        if (argsNode) {
          for (const child of argsNode.children) {
            if (child.type === 'argument') {
              const stringNode = child.children.find(c => c.type === 'string');
              if (stringNode) {
                const prefix = extractLaravelStringLiteral(stringNode, content);
                return prefix.startsWith('/') ? prefix.substring(1) : prefix;
              }
            }
          }
        }
      }
      break;
    } else {
      break;
    }
  }

  return '';
}
