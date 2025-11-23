export class LRUTracker {
  private accessOrder: string[] = [];

  update(key: string): void {
    this.accessOrder = this.accessOrder.filter((k) => k !== key);

    this.accessOrder.push(key);
  }

  remove(key: string): void {
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
  }

  getLRU(): string | undefined {
    return this.accessOrder[0];
  }

  get size(): number {
    return this.accessOrder.length;
  }

  clear(): void {
    this.accessOrder = [];
  }
}
