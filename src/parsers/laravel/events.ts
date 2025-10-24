import { SyntaxNode } from 'tree-sitter';
import { LaravelEvent, LaravelListener } from './types';
import { traverseNode, getClassName, getClassNamespace } from './ast-helpers';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('laravel-events');

export function extractLaravelEvents(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelEvent[] {
  const events: LaravelEvent[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'class_declaration') {
      const classText = content.substring(node.startIndex, node.endIndex);
      if (classText.includes('ShouldBroadcast')) {
        const event = parseEvent(node, content, filePath);
        if (event) {
          events.push(event);
        }
      }
    }
  });

  return events;
}

export function extractLaravelListeners(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): LaravelListener[] {
  const listeners: LaravelListener[] = [];

  traverseNode(rootNode, node => {
    if (node.type === 'class_declaration') {
      const classText = content.substring(node.startIndex, node.endIndex);
      if (classText.includes('function handle') || filePath.includes('/Listeners/')) {
        const listener = parseListener(node, content, filePath);
        if (listener) {
          listeners.push(listener);
        }
      }
    }
  });

  return listeners;
}

function parseEvent(node: SyntaxNode, content: string, filePath: string): LaravelEvent | null {
  try {
    const name = getClassName(node, content);
    if (!name) return null;

    const classText = content.substring(node.startIndex, node.endIndex);

    return {
      type: 'event',
      name,
      filePath,
      framework: 'laravel',
      shouldBroadcast: classText.includes('ShouldBroadcast'),
      broadcastType: classText.includes('ShouldBroadcastNow')
        ? 'ShouldBroadcastNow'
        : 'ShouldBroadcast',
      channels: extractChannels(classText),
      broadcastWith: {},
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse event`, { error: error.message });
    return null;
  }
}

function parseListener(
  node: SyntaxNode,
  content: string,
  filePath: string
): LaravelListener | null {
  try {
    const name = getClassName(node, content);
    if (!name) return null;

    const classText = content.substring(node.startIndex, node.endIndex);

    return {
      type: 'listener',
      name,
      filePath,
      framework: 'laravel',
      event: extractListenerEvent(classText),
      handleMethod: 'handle',
      shouldQueue: classText.includes('ShouldQueue'),
      metadata: {
        namespace: getClassNamespace(content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse listener`, { error: error.message });
    return null;
  }
}

function extractChannels(classText: string): string[] {
  const channels: string[] = [];
  const channelsMatch = classText.match(
    /function\s+broadcastOn\s*\(\)[\s\S]*?return\s*\[([\s\S]*?)\];/
  );
  if (channelsMatch) {
    const channelsContent = channelsMatch[1];
    const channelMatches = channelsContent.match(/'([^']*?)'/g);
    if (channelMatches) {
      channels.push(...channelMatches.map(match => match.replace(/'/g, '')));
    }
  }
  return channels;
}

function extractListenerEvent(classText: string): string {
  const eventMatch = classText.match(/function\s+handle\s*\(\s*([A-Z][a-zA-Z]*)/);
  return eventMatch ? eventMatch[1] : '';
}
