/**
 * Process-wide concurrency bound for module transform work.
 *
 * Draws permits from the SSR module loader's configurable transform semaphore
 * (`SSR_MAX_CONCURRENT_TRANSFORMS`), so orchestrator module transforms and SSR
 * component transforms share one operator-controlled capacity pool instead of
 * stacking independent limits.
 *
 * @module rendering/orchestrator/module-loader/transform-permit
 */

import { TIMEOUT_ERROR } from "#veryfront/errors";
import { getTransformSemaphore } from "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts";
import { getMaxConcurrentTransforms } from "#veryfront/modules/react-loader/ssr-module-loader/constants.ts";

/**
 * How long a transform may wait for a permit while the pool shows no activity
 * at all before the wait is declared stuck.
 *
 * This is deliberately a liveness window, not an absolute deadline: a wide
 * cold module graph can hold thousands of waiters, and the last of them waits
 * for nearly the whole graph. As long as permits keep cycling the queue is
 * healthy and every waiter keeps waiting; only a full window with zero permit
 * activity — nothing acquired, nothing released — means the holders are wedged
 * and waiting longer cannot help.
 */
const MODULE_TRANSFORM_STALL_TIMEOUT_MS = 30_000;

/**
 * Permit activity generation counter: bumped every time this path acquires or
 * releases a permit. A waiter that saw no generation change across an entire
 * stall window observed a pool that is not moving.
 */
let permitActivityGeneration = 0;

let activeModuleTransformCount = 0;

let stallTimeoutOverrideForTestsMs: number | undefined;

let moduleTransformActivityObserverForTests:
  | ((activeCount: number) => void | Promise<void>)
  | undefined;

/**
 * Observe (and optionally stall) transforms while they hold a permit; tests
 * only. Pass undefined to clear.
 */
export function __setModuleTransformActivityObserverForTests(
  observer: ((activeCount: number) => void | Promise<void>) | undefined,
): void {
  moduleTransformActivityObserverForTests = observer;
}

/** Shrink the no-progress stall window; tests only. Pass undefined to clear. */
export function __setModuleTransformStallTimeoutForTests(
  timeoutMs: number | undefined,
): void {
  stallTimeoutOverrideForTestsMs = timeoutMs;
}

/**
 * Run `work` while holding a permit from the shared transform semaphore.
 *
 * Callers must invoke this only around leaf transform work — after singleflight
 * dedupe and cache-hit checks, and never across recursive dependency fan-out —
 * so neither followers of an in-flight transform nor coordinating ancestors
 * consume capacity while another transform computes on their behalf.
 *
 * Waiting is liveness-based rather than deadline-based: each stall window that
 * observes any permit activity re-arms, so a saturated-but-moving pool never
 * times out a healthy waiter, while a genuinely stuck pool still fails after
 * one full window. `signal` aborts the wait immediately, tying a waiter's
 * lifetime to its request rather than to a clock.
 */
export async function withModuleTransformPermit<T>(
  signal: AbortSignal | undefined,
  work: () => Promise<T>,
): Promise<T> {
  // Operators disable the transform cap by configuring it to 0; mirror the SSR
  // loader and run unbounded rather than inventing a parallel limit.
  if (getMaxConcurrentTransforms() <= 0) {
    activeModuleTransformCount++;
    try {
      await moduleTransformActivityObserverForTests?.(activeModuleTransformCount);
      return await work();
    } finally {
      activeModuleTransformCount--;
    }
  }

  // Resolve the singleton once so the release below always returns the permit
  // to the exact semaphore it was drawn from, even if a test-side cache clear
  // swaps the singleton mid-flight.
  const semaphore = getTransformSemaphore();
  const stallTimeoutMs = stallTimeoutOverrideForTestsMs ?? MODULE_TRANSFORM_STALL_TIMEOUT_MS;

  for (;;) {
    const generationBefore = permitActivityGeneration;
    const acquired = await semaphore.tryAcquire(stallTimeoutMs, { signal });
    if (acquired) break;
    if (permitActivityGeneration === generationBefore) {
      throw TIMEOUT_ERROR.create({
        detail: `Timed out waiting for a module transform permit: no transform ` +
          `completed for ${stallTimeoutMs}ms ` +
          `(available: ${semaphore.available}, waiting: ${semaphore.waiting})`,
      });
    }
    // The pool moved while this waiter was queued, so the queue is healthy and
    // merely long. Re-arm the window and keep waiting.
  }

  permitActivityGeneration++;
  activeModuleTransformCount++;
  try {
    await moduleTransformActivityObserverForTests?.(activeModuleTransformCount);
    return await work();
  } finally {
    activeModuleTransformCount--;
    permitActivityGeneration++;
    semaphore.release();
  }
}
