import { SyntaxNode } from 'tree-sitter';
import { LaravelService } from './types';
import { traverseNode, getClassName, getClassNamespace, getMethodName, isPublicMethod } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-services');

export function extractLaravelServices(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelService[] {
  const services: LaravelService[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'class_declaration') {
      const classText = content.substring(node.startIndex, node.endIndex);
      if (classText.includes('Service') || filePath.includes('/Services/')) {
        const service = parseService(node, content, filePath);
        if (service) {
          services.push(service);
        }
      }
    }
  });

  return services;
}

function parseService(node: SyntaxNode, content: string, filePath: string): LaravelService | null {
  try {
    const name = getClassName(node, content);
    if (!name) return null;

    return {
      type: 'service',
      name,
      filePath,
      framework: 'laravel',
      methods: getPublicMethods(node, content),
      dependencies: extractServiceDependencies(content),
      namespace: getClassNamespace(content),
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse service`, { error: error.message });
    return null;
  }
}

function getPublicMethods(node: SyntaxNode, content: string): string[] {
  const methods: string[] = [];
  traverseNode(node, child => {
    if (child.type === 'method_declaration' && isPublicMethod(child, content)) {
      const methodName = getMethodName(child, content);
      if (methodName && !methodName.startsWith('__')) {
        methods.push(methodName);
      }
    }
  });
  return methods;
}

function extractServiceDependencies(content: string): string[] {
  const dependencies: string[] = [];
  const useMatches = content.match(/use\s+([A-Z][a-zA-Z\\]*);/g);
  if (useMatches) {
    dependencies.push(
      ...useMatches
        .map(match => {
          const [, dependency] = match.match(/use\s+([A-Z][a-zA-Z\\]*);/) || [];
          return dependency || '';
        })
        .filter(Boolean)
    );
  }
  return dependencies;
}
