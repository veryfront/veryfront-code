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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum concurrent renders per pod.
 * Configurable via RENDER_MAX_CONCURRENT env var.
 * Prevents one pod from being overwhelmed when multiple projects have issues.
 */
export const RENDER_MAX_CONCURRENT = getEnvNumber("RENDER_MAX_CONCURRENT") ?? 30;

/**
 * Maximum concurrent renders per project (noisy-neighbor protection).
 * Defaults to ceil(RENDER_MAX_CONCURRENT / 3) so no single project can consume
 * more than ~1/3 of pod capacity. Set to 0 to disable per-project limits.
 * Configurable via RENDER_PER_PROJECT_LIMIT env var.
 */
export const RENDER_PER_PROJECT_LIMIT = getEnvNumber("RENDER_PER_PROJECT_LIMIT") ??
  Math.ceil(RENDER_MAX_CONCURRENT / 3);

/**
 * Timeout for acquiring render permit (ms).
 * If semaphore cannot be acquired within this time, request fails fast with 503.
 */
export const RENDER_ACQUIRE_TIMEOUT_MS = 5_000;

/** Maximum time to wait for a project lock before giving up (10 seconds) */
export const LOCK_TIMEOUT_MS = 10_000;

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
          reject(new Error(`Lock acquisition timeout after ${timeoutMs}ms`));
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
export const RENDER_MAX_QUEUE_SIZE = 100;

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

function getProjectMutex(projectId: string): Mutex {
  let mutex = projectMutexes.get(projectId);
  if (!mutex) {
    mutex = new Mutex();
    projectMutexes.set(projectId, mutex);
  }
  return mutex;
}

// ---------------------------------------------------------------------------
// Slot Functions
// ---------------------------------------------------------------------------

/**
 * Acquire a lock for a specific project. Returns a release function.
 */
export function acquireProjectLock(
  projectId: string,
): Promise<() => void> {
  return getProjectMutex(projectId).acquire(LOCK_TIMEOUT_MS);
}

/**
 * Attempt to acquire a project render slot with proper locking.
 * Returns true if acquired, false if limit reached.
 */
export async function acquireProjectSlot(
  projectId: string,
): Promise<boolean> {
  if (RENDER_PER_PROJECT_LIMIT <= 0) return true;

  const release = await acquireProjectLock(projectId);
  try {
    const current = projectRenderCounts.get(projectId) ?? 0;
    if (current >= RENDER_PER_PROJECT_LIMIT) return false;

    projectRenderCounts.set(projectId, current + 1);
    return true;
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

  const release = await acquireProjectLock(projectId);
  try {
    const current = projectRenderCounts.get(projectId) ?? 0;
    if (current <= 1) {
      projectRenderCounts.delete(projectId);
      projectMutexes.delete(projectId);
      return;
    }
    projectRenderCounts.set(projectId, current - 1);
  } finally {
    release();
  }
}
