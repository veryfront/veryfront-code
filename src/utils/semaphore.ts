/**
 * Semaphore: Concurrency Limiter
 *
 * Limits concurrent operations to prevent resource exhaustion.
 *
 * @module utils/semaphore
 */

import { SEMAPHORE_TIMEOUT } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { MAX_TIMER_DELAY_MS } from "./constants/limits.ts";

/**
 * Thrown when a semaphore acquire exceeds its configured timeout.
 *
 * Extends {@link VeryfrontError} so it carries registry slug/status/category
 * and RFC-9457 fields, while remaining `instanceof SemaphoreTimeoutError` for
 * existing catch sites.
 */
export class SemaphoreTimeoutError extends VeryfrontError {
  constructor(name: string, timeoutMs: number) {
    super(`Semaphore '${name}' acquire timeout after ${timeoutMs}ms`, {
      slug: SEMAPHORE_TIMEOUT.slug,
      category: SEMAPHORE_TIMEOUT.category,
      status: SEMAPHORE_TIMEOUT.status,
      title: SEMAPHORE_TIMEOUT.title,
      suggestion: SEMAPHORE_TIMEOUT.suggestion,
      context: { name, timeoutMs },
    });
    this.name = "SemaphoreTimeoutError";
  }
}

interface WaitingTask {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export interface SemaphoreOptions {
  acquireTimeoutMs?: number;
  name?: string;
  maxQueueSize?: number;
}

interface NormalizedSemaphoreConfig {
  maxPermits: number;
  acquireTimeoutMs: number;
  maxQueueSize: number;
}

const DEFAULT_MAX_QUEUE_SIZE = 10_000;
const DEFAULT_MAX_NAMED_SEMAPHORES = 1_000;
const MAX_SEMAPHORE_NAME_LENGTH = 256;

function normalizeSemaphoreConfig(
  maxPermits: number,
  options: SemaphoreOptions,
): NormalizedSemaphoreConfig {
  if (!Number.isSafeInteger(maxPermits) || maxPermits <= 0) {
    throw new RangeError("Semaphore maxPermits must be a positive safe integer");
  }
  const acquireTimeoutMs = options.acquireTimeoutMs ?? 0;
  if (
    !Number.isSafeInteger(acquireTimeoutMs) ||
    acquireTimeoutMs < 0 ||
    acquireTimeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Semaphore acquireTimeoutMs must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  if (!Number.isSafeInteger(maxQueueSize) || maxQueueSize < 0) {
    throw new RangeError("Semaphore maxQueueSize must be a non-negative safe integer");
  }
  return { maxPermits, acquireTimeoutMs, maxQueueSize };
}

function validateSemaphoreName(name: string): string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > MAX_SEMAPHORE_NAME_LENGTH ||
    /[\p{Cc}]/u.test(name)
  ) {
    throw new RangeError(
      `Semaphore name must contain 1-${MAX_SEMAPHORE_NAME_LENGTH} characters without controls`,
    );
  }
  return name;
}

/** Raised when bounded semaphore admission has no queue capacity remaining. */
export class SemaphoreQueueFullError extends VeryfrontError {
  constructor(name: string, maxQueueSize: number) {
    super(`Semaphore '${name}' wait queue is full (${maxQueueSize})`, {
      slug: SEMAPHORE_TIMEOUT.slug,
      category: SEMAPHORE_TIMEOUT.category,
      status: SEMAPHORE_TIMEOUT.status,
      title: SEMAPHORE_TIMEOUT.title,
      suggestion: SEMAPHORE_TIMEOUT.suggestion,
      context: { name, maxQueueSize },
    });
    this.name = "SemaphoreQueueFullError";
  }
}

export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly waiting: WaitingTask[] = [];
  private readonly acquireTimeoutMs: number;
  private readonly semaphoreName: string;
  private readonly maxQueueSize: number;

  constructor(
    maxPermits: number,
    options: SemaphoreOptions = {},
  ) {
    const config = normalizeSemaphoreConfig(maxPermits, options);
    this.maxPermits = config.maxPermits;
    this.permits = config.maxPermits;
    this.acquireTimeoutMs = config.acquireTimeoutMs;
    this.maxQueueSize = config.maxQueueSize;
    this.semaphoreName = validateSemaphoreName(options.name ?? "default");
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
    if (this.waiting.length >= this.maxQueueSize) {
      return Promise.reject(
        new SemaphoreQueueFullError(this.semaphoreName, this.maxQueueSize),
      );
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
    if (!next) {
      this.permits++;
      return;
    }

    if (next.timeoutId) clearTimeout(next.timeoutId);
    next.resolve();
  }

  get active(): number {
    return this.maxPermits - this.permits;
  }

  get waitingCount(): number {
    return this.waiting.length;
  }
}

interface SemaphoreRegistryEntry {
  semaphore: Semaphore;
  config: NormalizedSemaphoreConfig;
}

export interface SemaphoreRegistry {
  readonly size: number;
  get(
    name: string,
    maxPermits: number,
    options?: Omit<SemaphoreOptions, "name">,
  ): Semaphore;
  clear(): void;
}

export function createSemaphoreRegistry(
  maxSemaphores = DEFAULT_MAX_NAMED_SEMAPHORES,
): SemaphoreRegistry {
  if (!Number.isSafeInteger(maxSemaphores) || maxSemaphores <= 0) {
    throw new RangeError("Semaphore registry capacity must be a positive safe integer");
  }
  const entries = new Map<string, SemaphoreRegistryEntry>();

  return {
    get size() {
      return entries.size;
    },
    get(name, maxPermits, options = {}) {
      const validatedName = validateSemaphoreName(name);
      const config = normalizeSemaphoreConfig(maxPermits, options);
      const existing = entries.get(validatedName);
      if (existing) {
        if (
          existing.config.maxPermits !== config.maxPermits ||
          existing.config.acquireTimeoutMs !== config.acquireTimeoutMs ||
          existing.config.maxQueueSize !== config.maxQueueSize
        ) {
          throw new Error(
            `Semaphore '${validatedName}' was requested with different configuration`,
          );
        }
        return existing.semaphore;
      }

      if (entries.size >= maxSemaphores) {
        throw new Error(
          `Semaphore registry capacity of ${maxSemaphores} has been reached`,
        );
      }
      const semaphore = new Semaphore(maxPermits, {
        ...options,
        name: validatedName,
      });
      entries.set(validatedName, { semaphore, config });
      return semaphore;
    },
    clear() {
      entries.clear();
    },
  };
}

const defaultRegistry = createSemaphoreRegistry();

export function getSemaphore(
  name: string,
  maxPermits: number,
  options?: Omit<SemaphoreOptions, "name">,
): Semaphore {
  return defaultRegistry.get(name, maxPermits, options);
}
