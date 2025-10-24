import { SyntaxNode } from 'tree-sitter';
import { LaravelTrait } from './types';
import { traverseNode, getClassNamespace, getMethodName, isPublicMethod } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-traits');

export function extractLaravelTraits(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelTrait[] {
  const traits: LaravelTrait[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'trait_declaration') {
      const trait = parseTrait(node, content, filePath);
      if (trait) {
        traits.push(trait);
      }
    }
  });

  return traits;
}

function parseTrait(node: SyntaxNode, content: string, filePath: string): LaravelTrait | null {
  try {
    const name = getTraitName(node, content);
    if (!name) return null;

    return {
      type: 'trait',
      name,
      filePath,
      framework: 'laravel',
      methods: getPublicMethods(node, content),
      properties: getProperties(node, content),
      uses: extractTraitUses(node, content),
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse trait`, { error: error.message });
    return null;
  }
}

function getTraitName(node: SyntaxNode, content: string): string | null {
  for (const child of node.children) {
    if (child.type === 'name') {
      return content.substring(child.startIndex, child.endIndex);
    }
  }
  return null;
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

function getProperties(node: SyntaxNode, content: string): string[] {
  const properties: string[] = [];
  traverseNode(node, child => {
    if (child.type === 'property_declaration') {
      const propertyText = content.substring(child.startIndex, child.endIndex);
      const propertyMatch = propertyText.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (propertyMatch) {
        properties.push(propertyMatch[1]);
      }
    }
  });
  return properties;
}

function extractTraitUses(node: SyntaxNode, content: string): string[] {
  const uses: string[] = [];
  traverseNode(node, child => {
    if (child.type === 'use_declaration') {
      const useText = content.substring(child.startIndex, child.endIndex);
      const useMatch = useText.match(/use\s+([A-Z][a-zA-Z]*)/);
      if (useMatch) {
        uses.push(useMatch[1]);
      }
    }
  });
  return uses;
}
