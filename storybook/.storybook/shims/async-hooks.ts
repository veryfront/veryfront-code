export class AsyncLocalStorage<T> {
  #store: T | undefined;

  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    const previous = this.#store;
    this.#store = store;
    try {
      return callback(...args);
    } finally {
      this.#store = previous;
    }
  }

  enterWith(store: T): void {
    this.#store = store;
  }

  getStore(): T | undefined {
    return this.#store;
  }

  disable(): void {
    this.#store = undefined;
  }
}
