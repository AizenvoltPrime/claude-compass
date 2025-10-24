import { SyntaxNode } from 'tree-sitter';
import { LaravelFormRequest } from './types';
import { traverseNode, getClassName, getClassNamespace } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-form-requests');

export function extractLaravelFormRequests(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelFormRequest[] {
  const formRequests: LaravelFormRequest[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'class_declaration') {
      const classText = content.substring(node.startIndex, node.endIndex);
      if (classText.includes('extends FormRequest')) {
        const formRequest = parseFormRequest(node, content, filePath);
        if (formRequest) {
          formRequests.push(formRequest);
        }
      }
    }
  });

  return formRequests;
}

function parseFormRequest(
  node: SyntaxNode,
  content: string,
  filePath: string
): LaravelFormRequest | null {
  try {
    const name = getClassName(node, content);
    if (!name) return null;

    const classText = content.substring(node.startIndex, node.endIndex);

    return {
      type: 'form_request',
      name,
      filePath,
      framework: 'laravel',
      rules: extractRules(classText),
      messages: extractMessages(classText),
      authorize: classText.includes('function authorize'),
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse form request`, { error: error.message });
    return null;
  }
}

function extractRules(classText: string): Record<string, string> {
  const rules: Record<string, string> = {};
  const rulesMatch = classText.match(/function\s+rules\s*\(\)[\s\S]*?return\s*\[([\s\S]*?)\];/);
  if (rulesMatch) {
    const rulesContent = rulesMatch[1];
    const ruleMatches = rulesContent.match(/'([^']*?)'\s*=>\s*'([^']*?)'/g);
    if (ruleMatches) {
      ruleMatches.forEach(match => {
        const [, field, rule] = match.match(/'([^']*?)'\s*=>\s*'([^']*?)'/) || [];
        if (field && rule) {
          rules[field] = rule;
        }
      });
    }
  }
  return rules;
}

function extractMessages(classText: string): Record<string, string> {
  const messages: Record<string, string> = {};
  const messagesMatch = classText.match(
    /function\s+messages\s*\(\)[\s\S]*?return\s*\[([\s\S]*?)\];/
  );
  if (messagesMatch) {
    const messagesContent = messagesMatch[1];
    const messageMatches = messagesContent.match(/'([^']*?)'\s*=>\s*'([^']*?)'/g);
    if (messageMatches) {
      messageMatches.forEach(match => {
        const [, field, message] = match.match(/'([^']*?)'\s*=>\s*'([^']*?)'/) || [];
        if (field && message) {
          messages[field] = message;
        }
      });
    }
  }
  return messages;
}
