/**
 * Traversal Queue Manager
 *
 * Manages BFS queue with safety checks, pruning, and depth filtering.
 * Prevents queue explosion through size limits and depth-based prioritization.
 */

import type { TraversalDirection } from './symbol-classifier';
import { createComponentLogger } from '../../../../utils/logger';

const logger = createComponentLogger('traversal-queue');

export interface QueueItem {
  id: number;
  depth: number;
  direction: TraversalDirection;
}

export class TraversalQueue {
  private queue: QueueItem[];

  constructor(
    private readonly maxSize: number,
    private readonly maxDepth: number
  ) {
    this.queue = [];
  }

  enqueue(item: QueueItem): void {
    this.queue.push(item);
  }

  dequeue(): QueueItem | undefined {
    return this.queue.shift();
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  size(): number {
    return this.queue.length;
  }

  pruneIfNeeded(): void {
    if (this.queue.length <= this.maxSize) {
      return;
    }

    logger.warn('Queue size exceeded, pruning', { queueSize: this.queue.length });
    this.queue.sort((a, b) => a.depth - b.depth);
    this.queue.splice(this.maxSize);
  }

  getNextItem(): QueueItem | undefined {
    const item = this.dequeue();
    if (!item) {
      return undefined;
    }

    if (item.depth >= this.maxDepth) {
      return undefined;
    }

    return item;
  }
}
