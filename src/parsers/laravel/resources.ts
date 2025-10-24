import { SyntaxNode } from 'tree-sitter';
import { LaravelResource } from './types';
import { traverseNode, getClassName, getClassNamespace } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-resources');

export function extractLaravelResources(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelResource[] {
  const resources: LaravelResource[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'class_declaration') {
      const classText = content.substring(node.startIndex, node.endIndex);
      if (classText.includes('extends') && classText.includes('Resource')) {
        const resource = parseResource(node, content, filePath);
        if (resource) {
          resources.push(resource);
        }
      }
    }
  });

  return resources;
}

function parseResource(
  node: SyntaxNode,
  content: string,
  filePath: string
): LaravelResource | null {
  try {
    const name = getClassName(node, content);
    if (!name) return null;

    const classText = content.substring(node.startIndex, node.endIndex);

    return {
      type: 'resource',
      name,
      filePath,
      framework: 'laravel',
      toArrayMethod: classText.includes('function toArray') ? 'toArray' : '',
      withMethod: extractWithMethod(classText),
      additionalData: {},
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse resource`, { error: error.message });
    return null;
  }
}

function extractWithMethod(classText: string): string {
  const withMatch = classText.match(/function\s+(with[A-Z][a-zA-Z]*)/);
  return withMatch ? withMatch[1] : '';
}
