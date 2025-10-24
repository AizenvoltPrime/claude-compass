import { SyntaxNode } from 'tree-sitter';
import * as path from 'path';
import { LaravelController } from './types';
import {
  traverseNode,
  getClassName,
  getMethodName,
  getClassNamespace,
  isPublicMethod,
} from './ast-helpers';

const logger = console; // TODO: Use proper logger

export async function extractLaravelControllers(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): Promise<LaravelController[]> {
  const controllers: LaravelController[] = [];

  if (!isControllerFile(filePath, content)) {
    return controllers;
  }

  try {
    traverseNode(rootNode, node => {
      if (node.type === 'class_declaration' && extendsController(content, node)) {
        const controller = parseController(node, filePath, content);
        if (controller) {
          controllers.push(controller);
        }
      } else if (node.type === 'ERROR' && hasControllerPatternInError(content, node)) {
        // Handle malformed PHP code that still contains controller patterns
        const controller = parseControllerFromError(node, filePath, content);
        if (controller) {
          controllers.push(controller);
        }
      }
    });
  } catch (error) {
    logger.error(`Controller extraction failed for ${filePath}`, { error: error.message });
  }

  return controllers;
}

export function isControllerFile(filePath: string, content: string): boolean {
  return (
    filePath.includes('/app/Http/Controllers/') ||
    path.basename(filePath).endsWith('Controller.php') ||
    content.includes('extends Controller') ||
    content.includes('extends BaseController')
  );
}

export function extendsController(content: string, node: SyntaxNode): boolean {
  if (node.type !== 'class_declaration') return false;

  let baseClause = node.childForFieldName('base_clause');

  if (!baseClause) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'base_clause') {
        baseClause = child;
        break;
      }
    }
  }

  if (!baseClause) {
    return false;
  }

  const baseClass = content.substring(baseClause.startIndex, baseClause.endIndex);
  return baseClass.includes('Controller') || baseClass.includes('BaseController');
}

export function parseController(
  node: SyntaxNode,
  filePath: string,
  content: string
): LaravelController | null {
  try {
    const className = getClassName(node, content);
    if (!className) return null;

    const actions = getControllerActions(node, content);
    const middleware = getControllerMiddleware(node, content);
    const isResource = isResourceController(actions);

    return {
      type: 'controller',
      name: className,
      filePath,
      framework: 'laravel',
      actions,
      middleware,
      resourceController: isResource,
      metadata: {
        namespace: getClassNamespace(content),
        traits: getControllerTraits(node, content),
        dependencies: getConstructorDependencies(node, content),
        isApiController: isApiController(filePath, content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse controller`, { error: error.message });
    return null;
  }
}

export function getControllerMiddleware(node: SyntaxNode, content: string): string[] {
  const middleware: string[] = [];

  // Look for constructor method in the class
  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName === '__construct') {
        // Parse the constructor body for $this->middleware() calls
        const constructorBody = content.slice(child.startIndex, child.endIndex);

        // Find $this->middleware() calls
        const middlewareMatches = constructorBody.match(
          /\$this->middleware\(\s*['"]([^'"]+)['"]\s*\)/g
        );
        if (middlewareMatches) {
          for (const match of middlewareMatches) {
            const middlewareMatch = match.match(/['"]([^'"]+)['"]/);
            if (middlewareMatch) {
              middleware.push(middlewareMatch[1]);
            }
          }
        }
      }
    }
  });

  return middleware;
}

export function isResourceController(actions: string[]): boolean {
  const resourceMethods = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];
  return resourceMethods.every(method => actions.includes(method));
}

export function isApiController(filePath: string, content: string): boolean {
  // Check if file path contains /Api/ directory
  if (filePath.includes('/Api/')) {
    return true;
  }

  // Check if namespace contains Api
  const namespace = getClassNamespace(content);
  if (namespace && namespace.includes('\\Api\\')) {
    return true;
  }

  return false;
}

export function getControllerActions(
  node: SyntaxNode,
  content: string
): string[] {
  const actions: string[] = [];
  traverseNode(node, child => {
    if (child.type === 'method_declaration' && isPublicMethod(child, content)) {
      const methodName = getMethodName(child, content);
      if (methodName && !methodName.startsWith('__')) {
        actions.push(methodName);
      }
    }
  });
  return actions;
}

export function getControllerTraits(node: SyntaxNode, content: string): string[] {
  // This is a simplified implementation
  return [];
}

export function getConstructorDependencies(node: SyntaxNode, content: string): string[] {
  // This is a simplified implementation
  return [];
}

export function hasControllerPatternInError(content: string, node: SyntaxNode): boolean {
  const nodeText = content.slice(node.startIndex, node.endIndex);
  return /class\s+\w+Controller\s+extends\s+(Controller|BaseController)/.test(nodeText);
}

export function parseControllerFromError(
  node: SyntaxNode,
  filePath: string,
  content: string
): LaravelController | null {
  try {
    const nodeText = content.slice(node.startIndex, node.endIndex);

    // Extract class name using regex
    const classMatch = nodeText.match(
      /class\s+(\w+Controller)\s+extends\s+(Controller|BaseController)/
    );
    if (!classMatch) return null;

    const className = classMatch[1];

    // Extract method names from the malformed code
    const actions: string[] = [];
    const methodMatches = nodeText.matchAll(/public\s+function\s+(\w+)\s*\(/g);
    for (const match of methodMatches) {
      if (match[1] && !match[1].startsWith('__')) {
        actions.push(match[1]);
      }
    }

    return {
      type: 'controller',
      name: className,
      filePath,
      framework: 'laravel',
      actions,
      middleware: [], // Can't reliably extract from malformed code
      resourceController: false, // Can't determine from malformed code
      metadata: {
        namespace: getClassNamespace(content),
        traits: [],
        dependencies: [],
        isApiController: isApiController(filePath, content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        malformed: true, // Flag to indicate this was extracted from malformed code
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse controller from error node`, { error: error.message });
    return null;
  }
}
