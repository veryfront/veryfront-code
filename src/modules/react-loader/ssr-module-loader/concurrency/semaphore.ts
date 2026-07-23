/** Default timeout for acquiring a semaphore permit (ms) */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 100;
const DEFAULT_MAX_QUEUE_SIZE = 256;

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

export class Semaphore {
  private permits: number;
  private readonly capacity: number;
  private readonly maxQueueSize: number;
  private waitQueue: Array<{ resolve: () => void }> = [];

  constructor(permits: number, options?: { maxQueueSize?: number }) {
    assertNonNegativeSafeInteger(permits, "permits");
    const maxQueueSize = options?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    assertNonNegativeSafeInteger(maxQueueSize, "maxQueueSize");

    this.permits = permits;
    this.capacity = permits;
    this.maxQueueSize = maxQueueSize;
  }

  tryAcquire(timeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS): Promise<boolean> {
    assertNonNegativeSafeInteger(timeoutMs, "timeoutMs");

    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve(true);
    }

    if (this.waitQueue.length >= this.maxQueueSize) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;

      const onAcquire = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(true);
      };

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;

        const index = this.waitQueue.findIndex((w) => w.resolve === onAcquire);
        if (index !== -1) this.waitQueue.splice(index, 1);

        resolve(false);
      }, timeoutMs);

      this.waitQueue.push({ resolve: onAcquire });
    });
  }

  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next.resolve();
      return;
    }

    if (this.permits < this.capacity) this.permits++;
  }

  get available(): number {
    return this.permits;
  }

  get waiting(): number {
    return this.waitQueue.length;
  }
}
