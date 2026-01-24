export class Singleflight<T> {
  private inflight = new Map<string, Promise<T>>();

  async do(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = operation();
    this.inflight.set(key, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  has(key: string): boolean {
    return this.inflight.has(key);
  }

  get size(): number {
    return this.inflight.size;
  }
}
