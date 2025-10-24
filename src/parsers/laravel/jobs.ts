import { SyntaxNode } from 'tree-sitter';
import * as path from 'path';
import { LaravelJob } from './types';
import {
  traverseNode,
  getClassName,
  getMethodName,
} from './ast-helpers';

const logger = console; // TODO: Use proper logger

export async function extractLaravelJobs(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): Promise<LaravelJob[]> {
  const jobs: LaravelJob[] = [];

  if (!isJobFile(filePath, content)) {
    return jobs;
  }

  try {
    traverseNode(rootNode, node => {
      if (node.type === 'class_declaration' && implementsShouldQueue(content, node)) {
        const job = parseJob(node, filePath, content);
        if (job) {
          jobs.push(job);
        }
      }
    });
  } catch (error) {
    logger.error(`Job extraction failed for ${filePath}`, { error: error.message });
  }

  return jobs;
}

export function isJobFile(filePath: string, content: string): boolean {
  return (
    filePath.includes('/app/Jobs/') ||
    path.basename(filePath).endsWith('Job.php') ||
    content.includes('implements ShouldQueue')
  );
}

export function implementsShouldQueue(content: string, node: SyntaxNode): boolean {
  const className = getClassName(node, content);
  if (!className) return false;

  const pattern = new RegExp(`class\\s+${className}.*implements.*ShouldQueue`);
  return pattern.test(content);
}

export function parseJob(node: SyntaxNode, filePath: string, content: string): LaravelJob | null {
  try {
    const className = getClassName(node, content);
    if (!className) return null;

    const handleMethod = getJobHandleMethod(node, content);
    const queueConnection = getJobQueueConnection(node, content);
    const attempts = getJobAttempts(node, content);
    const timeout = getJobTimeout(node, content);

    return {
      type: 'job',
      name: className,
      filePath,
      framework: 'laravel',
      handleMethod,
      queueConnection,
      attempts,
      timeout,
      metadata: {
        dispatchable: isDispatchableJob(content, className),
        serializable: isSerializableJob(content, className),
        queueable: isQueueableJob(content, className),
        batchable: isBatchableJob(content, className),
        queue: getJobQueue(node, content),
        delay: getJobDelay(node, content),
        hasFailedMethod: hasFailedMethod(node, content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse job`, { error: error.message });
    return null;
  }
}

export function getJobHandleMethod(node: SyntaxNode, content: string): string | null {
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

export function getJobQueueConnection(node: SyntaxNode, content: string): string | null {
  const connectionMatch = content.match(/public\s+\$connection\s*=\s*['"]([^'"]+)['"]/);
  return connectionMatch ? connectionMatch[1] : null;
}

export function getJobAttempts(node: SyntaxNode, content: string): number | null {
  const attemptsMatch = content.match(/public\s+\$tries\s*=\s*(\d+)/);
  return attemptsMatch ? parseInt(attemptsMatch[1], 10) : null;
}

export function getJobTimeout(node: SyntaxNode, content: string): number | null {
  const timeoutMatch = content.match(/public\s+\$timeout\s*=\s*(\d+)/);
  return timeoutMatch ? parseInt(timeoutMatch[1], 10) : null;
}

export function isDispatchableJob(content: string, className: string): boolean {
  return content.includes('use Dispatchable');
}

export function isSerializableJob(content: string, className: string): boolean {
  return content.includes('use SerializesModels');
}

export function isQueueableJob(content: string, className: string): boolean {
  return content.includes('use Queueable');
}

export function isBatchableJob(content: string, className: string): boolean {
  // Check for Batchable trait usage in various forms
  return (
    content.includes('use Batchable') ||
    content.includes('Batchable;') ||
    /use\s+.*Batchable/.test(content)
  );
}

export function getJobQueue(node: SyntaxNode, content: string): string | null {
  const queueMatch = content.match(/public\s+\$queue\s*=\s*['"]([^'"]+)['"]/);
  return queueMatch ? queueMatch[1] : null;
}

export function getJobDelay(node: SyntaxNode, content: string): number | null {
  const delayMatch = content.match(/public\s+\$delay\s*=\s*(\d+)/);
  return delayMatch ? parseInt(delayMatch[1], 10) : null;
}

export function hasFailedMethod(node: SyntaxNode, content: string): boolean {
  let failedMethodExists = false;

  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName === 'failed') {
        failedMethodExists = true;
      }
    }
  });

  return failedMethodExists;
}
