/** Coalesce concurrent asynchronous work by key without caching completed results. */
export class Singleflight<T> {
  private inflight = new Map<string, Promise<T>>();

  /** Run an operation once for all callers that use the same in-flight key. */
  do(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    let resolvePromise!: (value: T | PromiseLike<T>) => void;
    let rejectPromise!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    this.inflight.set(key, promise);

    let result: Promise<T>;
    try {
      result = operation();
    } catch (error) {
      this.inflight.delete(key);
      rejectPromise(error);
      return promise;
    }

    Promise.resolve(result).then(
      (resolved) => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
        resolvePromise(resolved);
      },
      (error) => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
        rejectPromise(error);
      },
    );

    return promise;
  }

  has(key: string): boolean {
    return this.inflight.has(key);
  }

  get size(): number {
    return this.inflight.size;
  }
}
