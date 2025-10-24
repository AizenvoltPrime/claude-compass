import { SyntaxNode } from 'tree-sitter';
import { LaravelPolicy } from './types';
import { traverseNode, getClassName, getClassNamespace, getMethodName, isPublicMethod } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-policies');

export function extractLaravelPolicies(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelPolicy[] {
  const policies: LaravelPolicy[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'class_declaration') {
      const classText = content.substring(node.startIndex, node.endIndex);
      if (classText.includes('Policy') || filePath.includes('/Policies/')) {
        const policy = parsePolicy(node, content, filePath);
        if (policy) {
          policies.push(policy);
        }
      }
    }
  });

  return policies;
}

function parsePolicy(node: SyntaxNode, content: string, filePath: string): LaravelPolicy | null {
  try {
    const name = getClassName(node, content);
    if (!name) return null;

    const classText = content.substring(node.startIndex, node.endIndex);

    return {
      type: 'policy',
      name,
      filePath,
      framework: 'laravel',
      methods: getPublicMethods(node, content),
      model: extractPolicyModel(classText),
      usesHandlesAuthorization: classText.includes('HandlesAuthorization'),
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse policy`, { error: error.message });
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

function extractPolicyModel(classText: string): string {
  const modelMatch = classText.match(/\$([A-Z][a-zA-Z]*)/);
  return modelMatch ? modelMatch[1] : '';
}
