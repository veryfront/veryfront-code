import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { SSRModuleLoader } from "./loader.ts";
import { clearSSRModuleCache, getTransformSemaphore } from "./cache/index.ts";
import { TRANSFORM_ACQUIRE_TIMEOUT_MS } from "./constants.ts";
import type { TransformCapacityErrorMode } from "./loader-helpers.ts";

type TransformCapacityRunner = (
  filePath: string,
  mode: TransformCapacityErrorMode,
  operation: () => Promise<string>,
  signal?: AbortSignal,
) => Promise<string>;

/** Call the private capacity guard directly so the test stays off the transform pipeline. */
function transformCapacity(loader: SSRModuleLoader): TransformCapacityRunner {
  const internal = loader as unknown as { withTransformCapacity: TransformCapacityRunner };
  return internal.withTransformCapacity.bind(loader);
}

function createLoader(projectId: string, dev: boolean): SSRModuleLoader {
  return new SSRModuleLoader({
    projectDir: "/projects/capacity",
    projectId,
    adapter: denoAdapter,
    dev,
  });
}

/** Take every free permit so the next acquire has to queue. */
async function exhaustTransformPermits(): Promise<number> {
  const semaphore = getTransformSemaphore();
  let taken = 0;
  while (semaphore.available > 0) {
    await semaphore.tryAcquire(0);
    taken++;
  }
  return taken;
}

function releaseTransformPermits(count: number): void {
  const semaphore = getTransformSemaphore();
  for (let i = 0; i < count; i++) semaphore.release();
}

type Outcome = { ok: true; value: string } | { ok: false; error: Error };

function settle(promise: Promise<string>): Promise<Outcome> {
  return promise.then(
    (value): Outcome => ({ ok: true, value }),
    (error): Outcome => ({
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }),
  );
}

describe("modules/react-loader/ssr-module-loader/transform-capacity", () => {
  it("should fail fast with the real queue depth when production capacity is exhausted", async () => {
    clearSSRModuleCache();
    const loader = createLoader("capacity-production", false);
    const held = await exhaustTransformPermits();
    const time = new FakeTime();

    try {
      const outcome = settle(
        transformCapacity(loader)(
          "/projects/capacity/page.tsx",
          "build",
          () => Promise.resolve("ran"),
        ),
      );

      await time.tickAsync(TRANSFORM_ACQUIRE_TIMEOUT_MS + 1);
      const result = await outcome;

      assert(!result.ok, "production must shed load instead of queueing past the deadline");
      assertStringIncludes(
        result.error.message,
        "Transform capacity exceeded (1 waiting)",
        "the diagnostic must count the waiter that timed out",
      );
    } finally {
      time.restore();
      releaseTransformPermits(held);
      clearSSRModuleCache();
    }
  });

  it("returns the semaphore permit after a completed transform", async () => {
    clearSSRModuleCache();
    const loader = createLoader("capacity-release", false);
    const semaphore = getTransformSemaphore();
    const availableBefore = semaphore.available;

    try {
      assertEquals(
        await transformCapacity(loader)(
          "/projects/capacity/ok.tsx",
          "build",
          () => Promise.resolve("ran"),
        ),
        "ran",
        "a transform within capacity must run its operation",
      );

      assertEquals(
        semaphore.available,
        availableBefore,
        "a completed transform must return its semaphore permit",
      );
    } finally {
      clearSSRModuleCache();
    }
  });

  it("should queue a dev burst past the production deadline and succeed once permits free", async () => {
    clearSSRModuleCache();
    const loader = createLoader("capacity-dev", true);
    let held = await exhaustTransformPermits();
    const semaphore = getTransformSemaphore();
    const time = new FakeTime();

    try {
      const burst = Array.from({ length: 4 }, (_, index) =>
        settle(
          transformCapacity(loader)(
            `/projects/capacity/tab-${index}.tsx`,
            "build",
            () => Promise.resolve(`tab-${index}`),
          ),
        ));

      await time.tickAsync(TRANSFORM_ACQUIRE_TIMEOUT_MS + 1);
      assertEquals(
        semaphore.waiting,
        4,
        "dev requests must still be queued after the production deadline passes",
      );

      releaseTransformPermits(held);
      held = 0;

      const results = await Promise.all(burst);
      assertEquals(
        results.map((result) => (result.ok ? result.value : result.error.message)),
        ["tab-0", "tab-1", "tab-2", "tab-3"],
        "every queued dev request must run instead of erroring",
      );
    } finally {
      time.restore();
      releaseTransformPermits(held);
      clearSSRModuleCache();
    }
  });

  it("should remove a queued dev transform when its final observer is cancelled", async () => {
    clearSSRModuleCache();
    const controller = new AbortController();
    const loader = createLoader("capacity-cancelled", true);
    let held = await exhaustTransformPermits();
    const semaphore = getTransformSemaphore();
    let operationRan = false;

    try {
      const outcome = settle(
        transformCapacity(loader)(
          "/projects/capacity/cancelled.tsx",
          "build",
          () => {
            operationRan = true;
            return Promise.resolve("ran");
          },
          controller.signal,
        ),
      );
      await Promise.resolve();
      assertEquals(semaphore.waiting, 1);

      const reason = new DOMException("render cancelled", "AbortError");
      controller.abort(reason);
      await Promise.resolve();
      const waitingAfterAbort = semaphore.waiting;

      releaseTransformPermits(held);
      held = 0;
      const result = await outcome;

      assertEquals(waitingAfterAbort, 0, "the cancelled waiter must leave the queue");
      assertEquals(operationRan, false, "cancelled transform work must not start");
      assert(!result.ok, "the render abort must reject the queued acquisition");
      assertStringIncludes(result.error.message, "render cancelled");
    } finally {
      releaseTransformPermits(held);
      clearSSRModuleCache();
    }
  });
});
