/**
 * Godot Traversal Queue
 *
 * Optimized priority queue for BFS traversal in Godot feature discovery.
 * Processes symbols breadth-first by depth, ensuring we discover
 * nearby symbols before distant transitive dependencies.
 *
 * Performance: O(1) dequeue by maintaining depth-grouped buckets
 * instead of O(n) linear search on every dequeue operation.
 */

import type { GodotTraversalDirection } from './symbol-classifier';

export interface GodotQueueItem {
  id: number;
  depth: number;
  direction: GodotTraversalDirection;
}

export class GodotTraversalQueue {
  private depthBuckets: Map<number, GodotQueueItem[]> = new Map();
  private currentMinDepth: number = Infinity;
  private totalSize: number = 0;
  private maxSize: number;
  private maxDepth: number;

  constructor(maxSize: number, maxDepth: number) {
    this.maxSize = maxSize;
    this.maxDepth = maxDepth;
  }

  /**
   * Add item to queue.
   * Respects max depth - items beyond max depth are silently dropped.
   *
   * Performance: O(1) - just pushes to depth bucket
   */
  enqueue(item: GodotQueueItem): void {
    if (item.depth > this.maxDepth) {
      return;
    }

    if (this.totalSize >= this.maxSize) {
      return;
    }

    const bucket = this.depthBuckets.get(item.depth);
    if (bucket) {
      bucket.push(item);
    } else {
      this.depthBuckets.set(item.depth, [item]);
    }

    this.totalSize++;

    if (item.depth < this.currentMinDepth) {
      this.currentMinDepth = item.depth;
    }
  }

  /**
   * Get next item (FIFO - breadth-first).
   * Lower depth items are processed first.
   *
   * Performance: O(1) amortized - processes current depth bucket,
   * then advances to next depth level when bucket is empty.
   */
  getNextItem(): GodotQueueItem | undefined {
    if (this.totalSize === 0) {
      return undefined;
    }

    while (this.currentMinDepth <= this.maxDepth) {
      const bucket = this.depthBuckets.get(this.currentMinDepth);
      if (bucket && bucket.length > 0) {
        this.totalSize--;
        const item = bucket.shift();

        if (bucket.length === 0) {
          this.depthBuckets.delete(this.currentMinDepth);
        }

        return item;
      }

      this.currentMinDepth++;
    }

    return undefined;
  }

  /**
   * Check if queue is empty.
   *
   * Performance: O(1)
   */
  isEmpty(): boolean {
    return this.totalSize === 0;
  }

  /**
   * Get current queue size.
   *
   * Performance: O(1)
   */
  size(): number {
    return this.totalSize;
  }

  /**
   * Prune queue if it grows too large.
   * Removes highest depth items first.
   *
   * Performance: O(k) where k is number of depth levels
   */
  pruneIfNeeded(): void {
    if (this.totalSize <= this.maxSize * 0.9) {
      return;
    }

    const targetSize = Math.floor(this.maxSize * 0.8);
    const depths = Array.from(this.depthBuckets.keys()).sort((a, b) => b - a);

    for (const depth of depths) {
      if (this.totalSize <= targetSize) {
        break;
      }

      const bucket = this.depthBuckets.get(depth);
      if (bucket) {
        const itemsToRemove = Math.min(bucket.length, this.totalSize - targetSize);
        bucket.splice(-itemsToRemove);
        this.totalSize -= itemsToRemove;

        if (bucket.length === 0) {
          this.depthBuckets.delete(depth);
        }
      }
    }

    this.updateMinDepth();
  }

  /**
   * Update currentMinDepth after pruning or deletion.
   */
  private updateMinDepth(): void {
    if (this.totalSize === 0) {
      this.currentMinDepth = Infinity;
      return;
    }

    const depths = Array.from(this.depthBuckets.keys());
    this.currentMinDepth = Math.min(...depths);
  }
}
