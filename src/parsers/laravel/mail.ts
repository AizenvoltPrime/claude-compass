import { SyntaxNode } from 'tree-sitter';
import { LaravelMail } from './types';
import { traverseNode, getClassName, getClassNamespace } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-mail');

export function extractLaravelMail(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelMail[] {
  const mailClasses: LaravelMail[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'class_declaration') {
      const classText = content.substring(node.startIndex, node.endIndex);
      if (classText.includes('extends Mailable')) {
        const mail = parseMail(node, content, filePath);
        if (mail) {
          mailClasses.push(mail);
        }
      }
    }
  });

  return mailClasses;
}

function parseMail(node: SyntaxNode, content: string, filePath: string): LaravelMail | null {
  try {
    const name = getClassName(node, content);
    if (!name) return null;

    const classText = content.substring(node.startIndex, node.endIndex);

    return {
      type: 'mail',
      name,
      filePath,
      framework: 'laravel',
      shouldQueue: classText.includes('ShouldQueue'),
      view: extractView(classText),
      subject: extractSubject(classText),
      markdown: classText.includes('markdown('),
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse mail`, { error: error.message });
    return null;
  }
}

function extractView(classText: string): string {
  const viewMatch = classText.match(/view\s*\(\s*['"]([^'"]*)['"]/);
  return viewMatch ? viewMatch[1] : '';
}

function extractSubject(classText: string): string {
  const subjectMatch = classText.match(/subject\s*\(\s*['"]([^'"]*)['"]/);
  return subjectMatch ? subjectMatch[1] : '';
}
