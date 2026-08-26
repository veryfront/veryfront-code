/**
 * Renderer Concurrency Layer
 *
 * Manages concurrency control for the shared multi-tenant renderer:
 * - Global render semaphore (limits total concurrent renders per pod)
 * - Per-project slot management (noisy-neighbor protection)
 * - Mutex-based locking for race-free slot acquisition
 *
 * @module rendering/renderer-concurrency
 */

import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { getEnvNumber } from "#veryfront/compat/process.ts";
import { RENDER_ERROR } from "#veryfront/errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum concurrent renders per pod.
 * Configurable via RENDER_MAX_CONCURRENT env var.
 * Prevents one pod from being overwhelmed when multiple projects have issues.
 */
export const RENDER_MAX_CONCURRENT = getEnvNumber("RENDER_MAX_CONCURRENT", 30);

/**
 * Maximum concurrent renders per project (noisy-neighbor protection).
 * Defaults to ceil(RENDER_MAX_CONCURRENT / 3) so no single project can consume
 * more than ~1/3 of pod capacity. Set to 0 to disable per-project limits.
 * Configurable via RENDER_PER_PROJECT_LIMIT env var.
 */
export const RENDER_PER_PROJECT_LIMIT = getEnvNumber(
  "RENDER_PER_PROJECT_LIMIT",
  Math.ceil(RENDER_MAX_CONCURRENT / 3),
);

/**
 * Maximum queued foreground renders per project.
 * Defaults to one additional per-project concurrency window. Background work
 * never enters this queue.
 */
export const RENDER_PER_PROJECT_QUEUE_SIZE = Math.max(
  0,
  getEnvNumber(
    "RENDER_PER_PROJECT_QUEUE_SIZE",
    Math.max(0, RENDER_PER_PROJECT_LIMIT),
  ),
);

/** Maximum requests that may wait on one deduplicated cacheable render. */
export const RENDER_SINGLEFLIGHT_MAX_FOLLOWERS = Math.max(
  0,
  getEnvNumber("RENDER_SINGLEFLIGHT_MAX_FOLLOWERS", 20),
);

/**
 * Timeout for acquiring render permit (ms).
 * This is the total foreground admission budget across project and global
 * capacity gates. Background work does not wait.
 */
export const RENDER_ACQUIRE_TIMEOUT_MS = 5_000;

/** Maximum time to wait for a project lock before giving up (10 seconds) */
const LOCK_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Mutex
// ---------------------------------------------------------------------------

/**
 * Promise-based mutex with atomic lock state transitions.
 * No TOCTOU race: `acquire()` synchronously marks the lock as held when
 * uncontested, and `release()` atomically hands the lock to the next waiter.
 */
export class Mutex {
  private queue: Array<(release: () => void) => void> = [];
  private locked = false;

  acquire(timeoutMs?: number): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }

    return new Promise<() => void>((resolve, reject) => {
      let settled = false;

      const onAcquire = (release: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        resolve(release);
      };

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs !== undefined && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          const idx = this.queue.indexOf(onAcquire);
          if (idx !== -1) this.queue.splice(idx, 1);
          reject(RENDER_ERROR.create({ detail: `Lock acquisition timeout after ${timeoutMs}ms` }));
        }, timeoutMs);
      }

      this.queue.push(onAcquire);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next(() => this.release());
    } else {
      this.locked = false;
    }
  }

  get waiting(): number {
    return this.queue.length;
  }
}

// ---------------------------------------------------------------------------
// Global State
// ---------------------------------------------------------------------------

/**
 * Global render semaphore - limits concurrent renders across all projects per pod.
 * This is a last-line defense against resource exhaustion.
 */
const RENDER_MAX_QUEUE_SIZE = 100;

export const renderSemaphore = new Semaphore(RENDER_MAX_CONCURRENT, {
  maxQueueSize: RENDER_MAX_QUEUE_SIZE,
});

/**
 * Per-project active render counter. Prevents a single noisy tenant from
 * monopolizing the global semaphore and starving other projects.
 * Only enforced when RENDER_PER_PROJECT_LIMIT > 0.
 */
export const projectRenderCounts = new Map<string, number>();

/**
 * Per-project mutexes for serializing slot acquire/release within the same project.
 * Each project gets its own mutex so different projects don't block each other.
 */
const projectMutexes = new Map<string, Mutex>();

interface ProjectSlotWaiter {
  resolve: (acquired: boolean) => void;
  reject: (reason?: unknown) => void;
  settled: boolean;
  timeoutId?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const projectSlotWaitQueues = new Map<string, ProjectSlotWaiter[]>();

function getProjectMutex(projectId: string): Mutex {
  let mutex = projectMutexes.get(projectId);
  if (!mutex) {
    mutex = new Mutex();
    projectMutexes.set(projectId, mutex);
  }
  return mutex;
}

function getProjectSlotWaitQueue(projectId: string): ProjectSlotWaiter[] {
  let queue = projectSlotWaitQueues.get(projectId);
  if (!queue) {
    queue = [];
    projectSlotWaitQueues.set(projectId, queue);
  }
  return queue;
}

function cleanupProjectSlotWaiter(waiter: ProjectSlotWaiter): void {
  if (waiter.timeoutId !== undefined) clearTimeout(waiter.timeoutId);
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  }
}

// ---------------------------------------------------------------------------
// Slot Functions
// ---------------------------------------------------------------------------

/**
 * Acquire a lock for a specific project. Returns a release function.
 */
function acquireProjectLock(
  projectId: string,
): Promise<() => void> {
  return getProjectMutex(projectId).acquire(LOCK_TIMEOUT_MS);
}

/**
 * Attempt to acquire a project render slot with proper locking. Foreground
 * callers may opt into a bounded FIFO wait; background callers use the
 * fail-fast default.
 */
export async function acquireProjectSlot(
  projectId: string,
  options: {
    wait?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<boolean> {
  const { signal } = options;
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
  }

  if (RENDER_PER_PROJECT_LIMIT <= 0) return true;

  const release = await acquireProjectLock(projectId);
  try {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }

    const current = projectRenderCounts.get(projectId) ?? 0;
    if (current < RENDER_PER_PROJECT_LIMIT) {
      projectRenderCounts.set(projectId, current + 1);
      return true;
    }

    if (!options.wait || RENDER_PER_PROJECT_QUEUE_SIZE <= 0) return false;

    const timeoutMs = options.timeoutMs ?? RENDER_ACQUIRE_TIMEOUT_MS;
    if (timeoutMs <= 0) return false;

    const queue = getProjectSlotWaitQueue(projectId);
    if (queue.length >= RENDER_PER_PROJECT_QUEUE_SIZE) return false;

    return new Promise<boolean>((resolve, reject) => {
      const waiter: ProjectSlotWaiter = {
        resolve,
        reject,
        settled: false,
        signal,
      };

      const removeWaiter = (): void => {
        const index = queue.indexOf(waiter);
        if (index !== -1) queue.splice(index, 1);
        if (queue.length === 0 && projectSlotWaitQueues.get(projectId) === queue) {
          projectSlotWaitQueues.delete(projectId);
        }
      };
      const settleWithoutSlot = (reason?: unknown): void => {
        if (waiter.settled) return;
        waiter.settled = true;
        removeWaiter();
        cleanupProjectSlotWaiter(waiter);
        if (reason !== undefined) {
          reject(reason);
        } else {
          resolve(false);
        }
      };

      waiter.onAbort = () =>
        settleWithoutSlot(
          signal?.reason ?? new DOMException("The operation was aborted", "AbortError"),
        );
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal?.aborted) {
        waiter.onAbort();
        return;
      }

      if (Number.isFinite(timeoutMs)) {
        waiter.timeoutId = setTimeout(() => settleWithoutSlot(), timeoutMs);
      }

      queue.push(waiter);
    });
  } finally {
    release();
  }
}

/**
 * Release a project render slot with proper locking.
 */
export async function releaseProjectSlot(
  projectId: string,
): Promise<void> {
  if (RENDER_PER_PROJECT_LIMIT <= 0) return;

  const mutex = getProjectMutex(projectId);
  const release = await mutex.acquire(LOCK_TIMEOUT_MS);
  let deleteIdleMutex = false;
  try {
    const current = projectRenderCounts.get(projectId) ?? 0;
    const queue = projectSlotWaitQueues.get(projectId);
    let next: ProjectSlotWaiter | undefined;
    while ((next = queue?.shift())) {
      if (next.settled) continue;
      next.settled = true;
      cleanupProjectSlotWaiter(next);
      if (queue?.length === 0) projectSlotWaitQueues.delete(projectId);
      projectRenderCounts.set(projectId, Math.max(1, current));
      next.resolve(true);
      return;
    }
    if (queue?.length === 0) projectSlotWaitQueues.delete(projectId);

    if (current <= 1) {
      projectRenderCounts.delete(projectId);
      deleteIdleMutex = mutex.waiting === 0 && !projectSlotWaitQueues.has(projectId);
      return;
    }
    projectRenderCounts.set(projectId, current - 1);
  } finally {
    release();
    if (
      deleteIdleMutex &&
      !projectRenderCounts.has(projectId) &&
      projectMutexes.get(projectId) === mutex
    ) {
      projectMutexes.delete(projectId);
    }
  }
}
