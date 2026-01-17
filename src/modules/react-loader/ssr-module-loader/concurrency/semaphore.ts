/**
 * Semaphore for Concurrency Control
 *
 * Simple semaphore for limiting concurrent operations.
 * Prevents memory spikes from too many parallel ESM transformations.
 *
 * @module module-system/react-loader/ssr-module-loader/concurrency/semaphore
 */

/**
 * Simple semaphore for limiting concurrent operations.
 */
export class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * Acquire a permit. Resolves immediately if one is available,
   * otherwise waits until one becomes available.
   */
  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Release a permit. If there are waiting requests, the first one is granted.
   */
  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  /**
   * Get the number of available permits.
   */
  get available(): number {
    return this.permits;
  }

  /**
   * Get the number of requests waiting for a permit.
   */
  get waiting(): number {
    return this.waitQueue.length;
  }
}
