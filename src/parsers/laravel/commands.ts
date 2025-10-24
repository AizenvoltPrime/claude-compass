import { SyntaxNode } from 'tree-sitter';
import * as path from 'path';
import { LaravelCommand } from './types';
import {
  traverseNode,
  getClassName,
  getMethodName,
} from './ast-helpers';

const logger = console; // TODO: Use proper logger

export async function extractArtisanCommands(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): Promise<LaravelCommand[]> {
  const commands: LaravelCommand[] = [];

  if (!isCommandFile(filePath, content)) {
    return commands;
  }

  try {
    traverseNode(rootNode, node => {
      if (node.type === 'class_declaration' && extendsCommand(content, node)) {
        const command = parseCommand(node, filePath, content);
        if (command) {
          commands.push(command);
        }
      }
    });
  } catch (error) {
    logger.error(`Command extraction failed for ${filePath}`, { error: error.message });
  }

  return commands;
}

export function isCommandFile(filePath: string, content: string): boolean {
  return (
    filePath.includes('/app/Console/Commands/') ||
    path.basename(filePath).endsWith('Command.php') ||
    content.includes('extends Command')
  );
}

export function extendsCommand(content: string, node: SyntaxNode): boolean {
  const className = getClassName(node, content);
  if (!className) return false;

  const pattern = new RegExp(`class\\s+${className}\\s+extends\\s+Command`);
  return pattern.test(content);
}

export function parseCommand(node: SyntaxNode, filePath: string, content: string): LaravelCommand | null {
  try {
    const className = getClassName(node, content);
    if (!className) return null;

    const signature = getCommandSignature(node, content);
    const description = getCommandDescription(node, content);
    const handleMethod = getCommandHandleMethod(node, content);

    return {
      type: 'command',
      name: className,
      filePath,
      framework: 'laravel',
      signature,
      description,
      handleMethod,
      metadata: {
        arguments: getCommandArguments(signature),
        options: getCommandOptions(signature),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse command`, { error: error.message });
    return null;
  }
}

export function getCommandSignature(node: SyntaxNode, content: string): string | null {
  const signatureMatch = content.match(/protected\s+\$signature\s*=\s*['"]([^'"]+)['"]/);
  return signatureMatch ? signatureMatch[1] : null;
}

export function getCommandDescription(node: SyntaxNode, content: string): string | null {
  const descriptionMatch = content.match(/protected\s+\$description\s*=\s*['"]([^'"]+)['"]/);
  return descriptionMatch ? descriptionMatch[1] : null;
}

export function getCommandHandleMethod(node: SyntaxNode, content: string): string | null {
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

export function getCommandArguments(signature: string | null): string[] {
  if (!signature) return [];

  const argMatches = signature.match(/\{([^}]+)\}/g);
  if (!argMatches) return [];

  const args: string[] = [];
  for (const match of argMatches) {
    const content = match.slice(1, -1); // Remove { }

    // Skip options (that start with --)
    if (content.trim().startsWith('--')) continue;

    // Extract argument name (everything before : or space)
    const nameMatch = content.match(/^([^:\s]+)/);
    if (nameMatch) {
      args.push(nameMatch[1]);
    }
  }

  return args;
}

export function getCommandOptions(signature: string | null): string[] {
  if (!signature) return [];

  const options: string[] = [];
  const argMatches = signature.match(/\{([^}]+)\}/g);
  if (!argMatches) return [];

  for (const match of argMatches) {
    const content = match.slice(1, -1); // Remove { }

    // Only process options (that start with --)
    if (!content.trim().startsWith('--')) continue;

    // Extract option name: --format=csv -> format, --force -> force
    const optionMatch = content.match(/--([^=:\s]+)/);
    if (optionMatch) {
      options.push(optionMatch[1]);
    }
  }

  return options;
}
