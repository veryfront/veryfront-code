/**
 * Renderer Concurrency Layer
 *
 * Manages concurrency control for the shared multi-tenant renderer:
 * - Global render semaphore (limits total concurrent renders per pod)
 * - Per-project slot management (noisy-neighbor protection)
 * - Lock primitives for race-free slot acquisition
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
export const RENDER_ACQUIRE_TIMEOUT_MS = 5000;

/** Maximum time to wait for a lock before giving up (10 seconds) */
export const LOCK_TIMEOUT_MS = 10_000;

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
 * Lock map to prevent race conditions in acquireProjectSlot/releaseProjectSlot.
 * Each project has its own lock to allow concurrent access across different projects
 * while serializing access within the same project.
 *
 * The race condition: Without locking, concurrent requests can read the same count,
 * both pass the limit check, and both increment - allowing 2*limit concurrent renders.
 */
export const projectSlotLocks = new Map<string, Promise<void>>();

// ---------------------------------------------------------------------------
// Lock Functions
// ---------------------------------------------------------------------------

/**
 * Acquire a lock for a specific project. Returns a release function.
 * Uses a retry loop to ensure atomicity - avoids TOCTOU race conditions.
 */
export async function acquireProjectLock(projectId: string): Promise<() => void> {
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
      throw new Error(`Lock acquisition timeout for project: ${projectId}`);
    }

    const existingLock = projectSlotLocks.get(projectId);
    if (existingLock) {
      await existingLock;
      continue;
    }

    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    if (projectSlotLocks.has(projectId)) {
      continue;
    }

    projectSlotLocks.set(projectId, lockPromise);

    return () => {
      releaseLock();
      if (projectSlotLocks.get(projectId) === lockPromise) {
        projectSlotLocks.delete(projectId);
      }
    };
  }
}

/**
 * Attempt to acquire a project render slot with proper locking.
 * Returns true if acquired, false if limit reached.
 */
export async function acquireProjectSlot(projectId: string): Promise<boolean> {
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
export async function releaseProjectSlot(projectId: string): Promise<void> {
  if (RENDER_PER_PROJECT_LIMIT <= 0) return;

  const release = await acquireProjectLock(projectId);
  try {
    const current = projectRenderCounts.get(projectId) ?? 0;
    if (current <= 1) {
      projectRenderCounts.delete(projectId);
      return;
    }
    projectRenderCounts.set(projectId, current - 1);
  } finally {
    release();
  }
}
