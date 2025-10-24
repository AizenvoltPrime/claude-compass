import { SyntaxNode } from 'tree-sitter';
import { LaravelObserver } from './types';
import { traverseNode, getClassName, getClassNamespace, getMethodName, isPublicMethod } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-observers');

export function extractLaravelObservers(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelObserver[] {
  const observers: LaravelObserver[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'class_declaration') {
      const classText = content.substring(node.startIndex, node.endIndex);
      if (classText.includes('Observer') || filePath.includes('/Observers/')) {
        const observer = parseObserver(node, content, filePath);
        if (observer) {
          observers.push(observer);
        }
      }
    }
  });

  return observers;
}

function parseObserver(
  node: SyntaxNode,
  content: string,
  filePath: string
): LaravelObserver | null {
  try {
    const name = getClassName(node, content);
    if (!name) return null;

    const classText = content.substring(node.startIndex, node.endIndex);

    return {
      type: 'observer',
      name,
      filePath,
      framework: 'laravel',
      model: extractObserverModel(classText),
      observedEvents: extractObservedEvents(classText),
      methods: getPublicMethods(node, content),
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse observer`, { error: error.message });
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

function extractObserverModel(classText: string): string {
  const modelMatch = classText.match(/([A-Z][a-zA-Z]*)Observer/);
  return modelMatch ? modelMatch[1] : '';
}

function extractObservedEvents(classText: string): string[] {
  const events = [
    'creating',
    'created',
    'updating',
    'updated',
    'saving',
    'saved',
    'deleting',
    'deleted',
    'restoring',
    'restored',
  ];
  return events.filter(event => classText.includes(`function ${event}`));
}
