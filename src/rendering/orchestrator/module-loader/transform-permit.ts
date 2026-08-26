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
import {
  getTransformSemaphore,
  releaseTransformSlot,
  tryAcquireTransformSlot,
} from "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts";
import {
  getMaxConcurrentTransforms,
  getTransformAcquireTimeoutMs,
} from "#veryfront/modules/react-loader/ssr-module-loader/constants.ts";

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

interface ModuleTransformPermitOptions {
  /** Stable tenant identity used by the shared per-project capacity guard. */
  projectId: string;
  /** Development is single-tenant and bypasses only the per-project guard. */
  dev: boolean;
  /** Cancellation for the transform flight or its owner. */
  signal?: AbortSignal;
  /** Owner deadline that already bounds the complete module-loading stage. */
  ownerDeadlineSignal?: AbortSignal;
}

/**
 * Run `work` while holding a permit from the shared transform semaphore.
 *
 * Callers must invoke this only around leaf transform work — after singleflight
 * dedupe and cache-hit checks, and never across recursive dependency fan-out —
 * so neither followers of an in-flight transform nor coordinating ancestors
 * consume capacity while another transform computes on their behalf.
 *
 * A module-loading owner already supplies its idle and hard deadline, so that
 * signal remains the only clock for the wait. Standalone callers without an
 * owner deadline use a liveness window: concrete transform progress or permit
 * turnover re-arms it, while a genuinely stuck pool still fails. The transform
 * flight signal always aborts a queued wait when no caller remains.
 */
export async function withModuleTransformPermit<T>(
  options: ModuleTransformPermitOptions,
  work: (reportProgress: () => void) => Promise<T>,
): Promise<T> {
  const bypassProjectLimit = options.dev;
  const cancellationSignal = options.signal ?? options.ownerDeadlineSignal;
  const projectAcquired = await tryAcquireTransformSlot(
    options.projectId,
    options.ownerDeadlineSignal ? Infinity : getTransformAcquireTimeoutMs(options.dev),
    bypassProjectLimit,
    cancellationSignal,
  );
  if (!projectAcquired) {
    throw TIMEOUT_ERROR.create({
      detail: "Project module transform capacity was not available before the deadline",
    });
  }

  const useSemaphore = getMaxConcurrentTransforms() > 0;
  // Resolve the singleton once so release always returns the permit to the
  // exact semaphore it was drawn from, even if a test resets shared state.
  const semaphore = useSemaphore ? getTransformSemaphore() : undefined;
  let semaphoreAcquired = false;
  let activeCounted = false;

  try {
    if (semaphore) {
      if (options.ownerDeadlineSignal) {
        // The owner already enforces the module-loading idle and hard
        // deadlines. Do not add a shorter permit deadline. The flight signal
        // still cancels this wait when every caller detaches.
        semaphoreAcquired = await semaphore.tryAcquire(Infinity, { signal: cancellationSignal });
      } else {
        const stallTimeoutMs = stallTimeoutOverrideForTestsMs ?? MODULE_TRANSFORM_STALL_TIMEOUT_MS;
        for (;;) {
          const generationBefore = permitActivityGeneration;
          semaphoreAcquired = await semaphore.tryAcquire(stallTimeoutMs, {
            signal: cancellationSignal,
          });
          if (semaphoreAcquired) break;
          if (permitActivityGeneration === generationBefore) {
            throw TIMEOUT_ERROR.create({
              detail: `Timed out waiting for a module transform permit: no transform ` +
                `progress for ${stallTimeoutMs}ms ` +
                `(available: ${semaphore.available}, waiting: ${semaphore.waiting})`,
            });
          }
          // A holder either reported transform progress or the pool cycled, so
          // this is a long but live queue. Re-arm the liveness window.
        }
      }
      if (!semaphoreAcquired) {
        throw TIMEOUT_ERROR.create({
          detail: "Module transform capacity was not available before the deadline",
        });
      }
      permitActivityGeneration++;
    }

    activeModuleTransformCount++;
    activeCounted = true;
    await moduleTransformActivityObserverForTests?.(activeModuleTransformCount);
    return await work(() => {
      permitActivityGeneration++;
    });
  } finally {
    if (activeCounted) activeModuleTransformCount--;
    if (semaphore && semaphoreAcquired) {
      permitActivityGeneration++;
      semaphore.release();
    }
    releaseTransformSlot(options.projectId, bypassProjectLimit);
  }
}
