import { SyntaxNode } from 'tree-sitter';
import * as path from 'path';
import { LaravelMiddleware } from './types';
import {
  traverseNode,
  getClassName,
  getMethodName,
} from './ast-helpers';

const logger = console; // TODO: Use proper logger

export async function extractLaravelMiddleware(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): Promise<LaravelMiddleware[]> {
  const middleware: LaravelMiddleware[] = [];

  if (!isMiddlewareFile(filePath, content)) {
    return middleware;
  }

  try {
    traverseNode(rootNode, node => {
      if (node.type === 'class_declaration' && implementsMiddleware(content, node)) {
        const middlewareEntity = parseMiddleware(node, filePath, content);
        if (middlewareEntity) {
          middleware.push(middlewareEntity);
        }
      }
    });
  } catch (error) {
    logger.error(`Middleware extraction failed for ${filePath}`, { error: error.message });
  }

  return middleware;
}

export function isMiddlewareFile(filePath: string, content: string): boolean {
  return (
    filePath.includes('/app/Http/Middleware/') ||
    path.basename(filePath).endsWith('Middleware.php') ||
    content.includes('implements Middleware') ||
    content.includes('extends Middleware')
  );
}

export function implementsMiddleware(content: string, node: SyntaxNode): boolean {
  const className = getClassName(node, content);
  if (!className) return false;

  const pattern = new RegExp(`class\\s+${className}.*implements.*Middleware`);
  return pattern.test(content) || content.includes('function handle(');
}

export function parseMiddleware(
  node: SyntaxNode,
  filePath: string,
  content: string
): LaravelMiddleware | null {
  try {
    const className = getClassName(node, content);
    if (!className) return null;

    const handleMethod = getMiddlewareHandleMethod(node, content);
    const parameters = getMiddlewareParameters(node, content);

    return {
      type: 'middleware',
      name: className,
      filePath,
      framework: 'laravel',
      handleMethod,
      parameters,
      metadata: {
        global: isGlobalMiddleware(filePath),
        route: isRouteMiddleware(content, className),
        group: getMiddlewareGroup(content, className),
        terminable: isTerminableMiddleware(node, content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse middleware`, { error: error.message });
    return null;
  }
}

export function getMiddlewareHandleMethod(node: SyntaxNode, content: string): string | null {
  let handleMethod = null;
  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName === 'handle') {
        handleMethod = content.slice(child.startIndex, child.endIndex);
      }
    }
  });
  return handleMethod;
}

export function getMiddlewareParameters(node: SyntaxNode, content: string): string[] {
  const parameters: string[] = [];

  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName === 'handle') {
        // Find the parameter list for the handle method
        traverseNode(child, paramNode => {
          if (paramNode.type === 'formal_parameters') {
            const paramContent = content.slice(paramNode.startIndex, paramNode.endIndex);

            // Parse parameters: handle($request, Closure $next, $role, $permission)
            // We want everything after $request and Closure $next
            const paramMatches = paramContent.match(/\$(\w+)/g);
            if (paramMatches && paramMatches.length > 2) {
              // Skip $request and $next (first two parameters)
              for (let i = 2; i < paramMatches.length; i++) {
                const param = paramMatches[i].substring(1); // Remove $
                parameters.push(param);
              }
            }
          }
        });
      }
    }
  });

  return parameters;
}

export function isTerminableMiddleware(node: SyntaxNode, content: string): boolean {
  let hasTerminateMethod = false;

  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName === 'terminate') {
        hasTerminateMethod = true;
      }
    }
  });

  return hasTerminateMethod;
}

export function isGlobalMiddleware(filePath: string): boolean {
  // This is a simplified check based on file location
  return (
    filePath.includes('/app/Http/Middleware/') &&
    (filePath.includes('TrustProxies') || filePath.includes('EncryptCookies'))
  );
}

export function isRouteMiddleware(content: string, className: string): boolean {
  // This is a simplified implementation
  return true;
}

export function getMiddlewareGroup(content: string, className: string): string | null {
  // This is a simplified implementation
  return null;
}
