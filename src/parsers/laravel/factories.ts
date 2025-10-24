import { SyntaxNode } from 'tree-sitter';
import { LaravelFactory } from './types';
import { traverseNode, getClassName, getClassNamespace } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-factories');

export function extractLaravelFactories(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelFactory[] {
  const factories: LaravelFactory[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'class_declaration') {
      const classText = content.substring(node.startIndex, node.endIndex);
      if (classText.includes('extends Factory')) {
        const factory = parseFactory(node, content, filePath);
        if (factory) {
          factories.push(factory);
        }
      }
    }
  });

  return factories;
}

function parseFactory(node: SyntaxNode, content: string, filePath: string): LaravelFactory | null {
  try {
    const name = getClassName(node, content);
    if (!name) return null;

    const classText = content.substring(node.startIndex, node.endIndex);

    return {
      type: 'factory',
      name,
      filePath,
      framework: 'laravel',
      model: extractFactoryModel(classText),
      states: extractFactoryStates(classText),
      definition: {},
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse factory`, { error: error.message });
    return null;
  }
}

function extractFactoryModel(classText: string): string {
  const modelMatch = classText.match(/\$model\s*=\s*([A-Z][a-zA-Z]*)/);
  return modelMatch ? modelMatch[1] : '';
}

function extractFactoryStates(classText: string): string[] {
  const states: string[] = [];
  const stateMatches = classText.match(/function\s+([a-zA-Z]+)\s*\(/g);
  if (stateMatches) {
    states.push(
      ...stateMatches
        .map(match => {
          const [, state] = match.match(/function\s+([a-zA-Z]+)\s*\(/) || [];
          return state || '';
        })
        .filter(state => state !== 'definition' && state !== '__construct')
    );
  }
  return states;
}
