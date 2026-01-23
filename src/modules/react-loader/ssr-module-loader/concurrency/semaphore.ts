/**
 * Semaphore for Concurrency Control
 *
 * Semaphore with timeout support for limiting concurrent operations.
 * Prevents memory spikes from too many parallel ESM transformations
 * while failing fast under overload instead of queueing forever.
 *
 * @module module-system/react-loader/ssr-module-loader/concurrency/semaphore
 */

/**
 * Semaphore with timeout support for concurrency control.
 *
 * IMPORTANT: Only use tryAcquire() with a timeout - never use blocking acquire
 * patterns as they can cause deadlocks when multiple concurrent operations
 * compete for limited permits.
 */
export class Semaphore {
  private permits: number;
  private waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * Try to acquire a permit within a timeout.
   * Returns true if acquired, false if timed out.
   *
   * This is the only way to acquire permits - it fails fast instead of
   * blocking forever, preventing deadlocks when multiple concurrent
   * operations compete for limited permits.
   *
   * @param timeoutMs - Maximum time to wait for a permit (default: 100ms)
   * @returns true if permit acquired, false if timed out
   */
  tryAcquire(timeoutMs = 100): Promise<boolean> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Remove from queue
        const index = this.waitQueue.findIndex((w) => w.resolve === onAcquire);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        resolve(false);
      }, timeoutMs);

      const onAcquire = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(true);
      };

      const onReject = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(false);
      };

      this.waitQueue.push({ resolve: onAcquire, reject: onReject });
    });
  }

  /**
   * Release a permit. If there are waiting requests, the first one is granted.
   */
  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next.resolve();
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
