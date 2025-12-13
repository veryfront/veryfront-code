/**
 * LRU (Least Recently Used) tracker using a Map for O(1) operations.
 * Map maintains insertion order, so we can efficiently track access order
 * by deleting and re-inserting keys.
 */
export class LRUTracker {
  private accessOrder: Map<string, boolean> = new Map();

  update(key: string): void {
    // Delete and re-insert to move to end (most recently used)
    this.accessOrder.delete(key);
    this.accessOrder.set(key, true);
  }

  remove(key: string): void {
    this.accessOrder.delete(key);
  }

  getLRU(): string | undefined {
    // First key in Map is the least recently used
    const firstKey = this.accessOrder.keys().next();
    return firstKey.done ? undefined : firstKey.value;
  }

  get size(): number {
    return this.accessOrder.size;
  }

  clear(): void {
    this.accessOrder.clear();
  }
}
