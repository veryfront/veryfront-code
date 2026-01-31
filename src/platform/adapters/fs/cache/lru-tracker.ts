export class LRUTracker {
  private accessOrder: string[] = [];

  update(key: string): void {
    this.remove(key);
    this.accessOrder.push(key);
  }

  remove(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index === -1) return;
    this.accessOrder.splice(index, 1);
  }

  getLRU(): string | undefined {
    return this.accessOrder[0];
  }

  get size(): number {
    return this.accessOrder.length;
  }

  clear(): void {
    this.accessOrder.length = 0;
  }
}
