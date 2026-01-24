/**
 * Semaphore: Concurrency Limiter
 *
 * Limits concurrent operations to prevent resource exhaustion.
 *
 * @module utils/semaphore
 */

export class SemaphoreTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`Semaphore '${name}' acquire timeout after ${timeoutMs}ms`);
    this.name = "SemaphoreTimeoutError";
  }
}

interface WaitingTask {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly waiting: WaitingTask[] = [];
  private readonly acquireTimeoutMs: number;
  private readonly semaphoreName: string;

  constructor(
    maxPermits: number,
    options: { acquireTimeoutMs?: number; name?: string } = {},
  ) {
    this.maxPermits = maxPermits;
    this.permits = maxPermits;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 0;
    this.semaphoreName = options.name ?? "default";
  }

  /** Acquire permit, execute operation, release automatically */
  async acquire<T>(operation: () => Promise<T>): Promise<T> {
    await this.waitForPermit();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private waitForPermit(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const task: WaitingTask = { resolve, reject };

      if (this.acquireTimeoutMs > 0) {
        task.timeoutId = setTimeout(() => {
          const idx = this.waiting.indexOf(task);
          if (idx !== -1) this.waiting.splice(idx, 1);
          reject(
            new SemaphoreTimeoutError(this.semaphoreName, this.acquireTimeoutMs),
          );
        }, this.acquireTimeoutMs);
      }

      this.waiting.push(task);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      if (next.timeoutId) clearTimeout(next.timeoutId);
      next.resolve();
      return;
    }
    this.permits++;
  }

  get active(): number {
    return this.maxPermits - this.permits;
  }

  get waitingCount(): number {
    return this.waiting.length;
  }
}

const semaphores = new Map<string, Semaphore>();

export function getSemaphore(
  name: string,
  maxPermits: number,
  options?: { acquireTimeoutMs?: number },
): Semaphore {
  const existing = semaphores.get(name);
  if (existing) return existing;

  const sem = new Semaphore(maxPermits, { ...options, name });
  semaphores.set(name, sem);
  return sem;
}
