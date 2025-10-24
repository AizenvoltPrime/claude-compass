import { SyntaxNode } from 'tree-sitter';
import * as path from 'path';
import { LaravelServiceProvider } from './types';
import { traverseNode, getClassName, getMethodName } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-service-providers');

export function extractLaravelServiceProviders(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelServiceProvider[] {
  const providers: LaravelServiceProvider[] = [];

  if (!isServiceProviderFile(filePath, content)) {
    return providers;
  }

  try {
    traverseNode(rootNode, node => {
      if (node.type === 'class_declaration' && extendsServiceProvider(content, node)) {
        const provider = parseServiceProvider(node, filePath, content);
        if (provider) {
          providers.push(provider);
        }
      }
    });
  } catch (error) {
    logger.error(`Service provider extraction failed for ${filePath}`, { error: error.message });
  }

  return providers;
}

function isServiceProviderFile(filePath: string, content: string): boolean {
  return (
    filePath.includes('/app/Providers/') ||
    path.basename(filePath).endsWith('ServiceProvider.php') ||
    content.includes('extends ServiceProvider')
  );
}

function extendsServiceProvider(content: string, node: SyntaxNode): boolean {
  const className = getClassName(node, content);
  if (!className) return false;

  const pattern = new RegExp(`class\\s+${className}\\s+extends\\s+ServiceProvider`);
  return pattern.test(content);
}

function parseServiceProvider(
  node: SyntaxNode,
  filePath: string,
  content: string
): LaravelServiceProvider | null {
  try {
    const className = getClassName(node, content);
    if (!className) return null;

    const registerMethod = getProviderRegisterMethod(node, content);
    const bootMethod = getProviderBootMethod(node, content);
    const bindings = getProviderBindings(node, content);

    return {
      type: 'service_provider',
      name: className,
      filePath,
      framework: 'laravel',
      registerMethod,
      bootMethod,
      bindings,
      metadata: {
        deferred: isDeferredProvider(content),
        provides: getProviderProvides(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse service provider`, { error: error.message });
    return null;
  }
}

function getProviderRegisterMethod(node: SyntaxNode, content: string): string | null {
  let registerMethod = null;
  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName === 'register') {
        registerMethod = content.slice(child.startIndex, child.endIndex);
      }
    }
  });
  return registerMethod;
}

function getProviderBootMethod(node: SyntaxNode, content: string): string | null {
  let bootMethod = null;
  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName === 'boot') {
        bootMethod = content.slice(child.startIndex, child.endIndex);
      }
    }
  });
  return bootMethod;
}

function getProviderBindings(_node: SyntaxNode, _content: string): string[] {
  return [];
}

function isDeferredProvider(content: string): boolean {
  return content.includes('protected $defer = true');
}

function getProviderProvides(content: string): string[] {
  const provides: string[] = [];

  const providesMethodMatch = content.match(/public\s+function\s+provides\(\)\s*\{([^}]+)\}/s);
  if (providesMethodMatch) {
    const methodBody = providesMethodMatch[1];

    const returnMatch = methodBody.match(/return\s*\[([^\]]+)\]/s);
    if (returnMatch) {
      const arrayContent = returnMatch[1];

      const serviceMatches = arrayContent.match(/['"]([^'"]+)['"]/g);
      if (serviceMatches) {
        for (const match of serviceMatches) {
          const service = match.slice(1, -1);
          provides.push(service);
        }
      }
    }
  }

  return provides;
}
