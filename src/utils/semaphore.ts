/**
 * Semaphore: Concurrency Limiter
 *
 * Limits concurrent operations to prevent resource exhaustion.
 *
 * @module utils/semaphore
 */

import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { SEMAPHORE_TIMEOUT, SERVICE_OVERLOADED } from "#veryfront/errors/error-registry/server.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

const DEFAULT_SEMAPHORE_NAME = "default";
const DEFAULT_MAX_QUEUE_SIZE = 1_024;
const MAX_CONFIGURED_QUEUE_SIZE = 100_000;
const MAX_SEMAPHORE_NAME_LENGTH = 256;
const MAX_REGISTERED_SEMAPHORES = 1_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

interface SemaphoreOptions {
  acquireTimeoutMs?: number;
  maxQueueSize?: number;
  name?: string;
}

interface ResolvedSemaphoreConfig {
  acquireTimeoutMs: number;
  maxQueueSize: number;
  maxPermits: number;
  name: string;
}

function invalidSemaphoreConfig(message: string): Error {
  return INVALID_ARGUMENT.create({ message });
}

function resolveSemaphoreConfig(
  maxPermits: number,
  options: SemaphoreOptions,
): ResolvedSemaphoreConfig {
  if (options === null || typeof options !== "object") {
    throw invalidSemaphoreConfig("Semaphore options must be an object");
  }

  let acquireTimeoutMs: unknown;
  let maxQueueSize: unknown;
  let name: unknown;
  try {
    acquireTimeoutMs = options.acquireTimeoutMs;
    maxQueueSize = options.maxQueueSize;
    name = options.name;
  } catch {
    throw invalidSemaphoreConfig("Semaphore options are not readable");
  }

  if (!Number.isSafeInteger(maxPermits) || maxPermits <= 0) {
    throw invalidSemaphoreConfig("Semaphore maxPermits must be a positive safe integer");
  }

  const resolvedTimeout = acquireTimeoutMs ?? 0;
  if (
    !Number.isSafeInteger(resolvedTimeout) || (resolvedTimeout as number) < 0 ||
    (resolvedTimeout as number) > MAX_TIMER_DELAY_MS
  ) {
    throw invalidSemaphoreConfig(
      `Semaphore acquireTimeoutMs must be a non-negative safe integer no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }

  const resolvedMaxQueueSize = maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  if (
    !Number.isSafeInteger(resolvedMaxQueueSize) ||
    (resolvedMaxQueueSize as number) < 0 ||
    (resolvedMaxQueueSize as number) > MAX_CONFIGURED_QUEUE_SIZE
  ) {
    throw invalidSemaphoreConfig(
      `Semaphore maxQueueSize must be a non-negative safe integer no greater than ${MAX_CONFIGURED_QUEUE_SIZE}`,
    );
  }

  const resolvedName = name ?? DEFAULT_SEMAPHORE_NAME;
  if (
    typeof resolvedName !== "string" || resolvedName.length === 0 ||
    resolvedName.length > MAX_SEMAPHORE_NAME_LENGTH ||
    hasControlCharacters(resolvedName)
  ) {
    throw invalidSemaphoreConfig("Semaphore name must be a safe non-empty string");
  }

  return {
    acquireTimeoutMs: resolvedTimeout as number,
    maxQueueSize: resolvedMaxQueueSize as number,
    maxPermits,
    name: resolvedName,
  };
}

/**
 * Thrown when a semaphore acquire exceeds its configured timeout.
 *
 * Extends {@link VeryfrontError} so it carries registry slug/status/category
 * and RFC-9457 fields, while remaining `instanceof SemaphoreTimeoutError` for
 * existing catch sites.
 */
export class SemaphoreTimeoutError extends VeryfrontError {
  constructor(_name: string, timeoutMs: number) {
    super(`Semaphore acquire timed out after ${timeoutMs}ms`, {
      slug: SEMAPHORE_TIMEOUT.slug,
      category: SEMAPHORE_TIMEOUT.category,
      status: SEMAPHORE_TIMEOUT.status,
      title: SEMAPHORE_TIMEOUT.title,
      suggestion: SEMAPHORE_TIMEOUT.suggestion,
      context: { timeoutMs },
    });
    this.name = "SemaphoreTimeoutError";
  }
}

interface WaitingTask {
  enqueued: boolean;
  next: WaitingTask | undefined;
  previous: WaitingTask | undefined;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | undefined;
}

export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly maxQueueSize: number;
  private waitingHead: WaitingTask | undefined;
  private waitingTail: WaitingTask | undefined;
  private waitingSize = 0;
  private readonly acquireTimeoutMs: number;
  private readonly semaphoreName: string;

  constructor(
    maxPermits: number,
    options: SemaphoreOptions = {},
  ) {
    const config = resolveSemaphoreConfig(maxPermits, options);
    this.maxPermits = config.maxPermits;
    this.permits = config.maxPermits;
    this.maxQueueSize = config.maxQueueSize;
    this.acquireTimeoutMs = config.acquireTimeoutMs;
    this.semaphoreName = config.name;
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

    if (this.waitingSize >= this.maxQueueSize) {
      return Promise.reject(
        SERVICE_OVERLOADED.create({
          message: "Semaphore waiting queue capacity reached",
        }),
      );
    }

    return new Promise<void>((resolve, reject) => {
      const task: WaitingTask = {
        enqueued: false,
        next: undefined,
        previous: undefined,
        reject,
        resolve,
        timeoutId: undefined,
      };

      if (this.acquireTimeoutMs > 0) {
        task.timeoutId = setTimeout(() => {
          if (!this.removeWaitingTask(task)) return;
          task.timeoutId = undefined;
          reject(
            new SemaphoreTimeoutError(this.semaphoreName, this.acquireTimeoutMs),
          );
        }, this.acquireTimeoutMs);
      }

      this.enqueueWaitingTask(task);
    });
  }

  private enqueueWaitingTask(task: WaitingTask): void {
    task.previous = this.waitingTail;
    task.enqueued = true;
    if (this.waitingTail) {
      this.waitingTail.next = task;
    } else {
      this.waitingHead = task;
    }
    this.waitingTail = task;
    this.waitingSize++;
  }

  private removeWaitingTask(task: WaitingTask): boolean {
    if (!task.enqueued) return false;

    if (task.previous) {
      task.previous.next = task.next;
    } else {
      this.waitingHead = task.next;
    }
    if (task.next) {
      task.next.previous = task.previous;
    } else {
      this.waitingTail = task.previous;
    }

    task.enqueued = false;
    task.next = undefined;
    task.previous = undefined;
    this.waitingSize--;
    return true;
  }

  private dequeueWaitingTask(): WaitingTask | undefined {
    const task = this.waitingHead;
    if (task) this.removeWaitingTask(task);
    return task;
  }

  private release(): void {
    const next = this.dequeueWaitingTask();
    if (!next) {
      this.permits++;
      return;
    }

    if (next.timeoutId !== undefined) {
      clearTimeout(next.timeoutId);
      next.timeoutId = undefined;
    }
    next.resolve();
  }

  get active(): number {
    return this.maxPermits - this.permits;
  }

  get waitingCount(): number {
    return this.waitingSize;
  }
}

interface SemaphoreEntry {
  acquireTimeoutMs: number;
  maxQueueSize: number;
  maxPermits: number;
  semaphore: Semaphore;
}

const semaphores = new Map<string, SemaphoreEntry>();

function ensureSemaphoreRegistryCapacity(): void {
  if (semaphores.size < MAX_REGISTERED_SEMAPHORES) return;
  throw SERVICE_OVERLOADED.create({
    message: "Semaphore registry capacity reached",
  });
}

export function getSemaphore(
  name: string,
  maxPermits: number,
  options?: { acquireTimeoutMs?: number; maxQueueSize?: number },
): Semaphore {
  if (options !== undefined && (options === null || typeof options !== "object")) {
    throw invalidSemaphoreConfig("Semaphore options must be an object");
  }

  let acquireTimeoutMs: unknown;
  let maxQueueSize: unknown;
  try {
    acquireTimeoutMs = options?.acquireTimeoutMs;
    maxQueueSize = options?.maxQueueSize;
  } catch {
    throw invalidSemaphoreConfig("Semaphore options are not readable");
  }

  const config = resolveSemaphoreConfig(maxPermits, {
    acquireTimeoutMs: acquireTimeoutMs as number | undefined,
    maxQueueSize: maxQueueSize as number | undefined,
    name,
  });
  const existing = semaphores.get(name);
  if (existing) {
    if (
      existing.maxPermits !== config.maxPermits ||
      existing.acquireTimeoutMs !== config.acquireTimeoutMs ||
      existing.maxQueueSize !== config.maxQueueSize
    ) {
      throw invalidSemaphoreConfig(
        "Semaphore name is already configured with different options",
      );
    }
    return existing.semaphore;
  }

  ensureSemaphoreRegistryCapacity();
  const sem = new Semaphore(config.maxPermits, {
    acquireTimeoutMs: config.acquireTimeoutMs,
    maxQueueSize: config.maxQueueSize,
    name: config.name,
  });
  semaphores.set(name, {
    acquireTimeoutMs: config.acquireTimeoutMs,
    maxQueueSize: config.maxQueueSize,
    maxPermits: config.maxPermits,
    semaphore: sem,
  });
  return sem;
}
