import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { SSRModuleLoader } from "#veryfront/modules/react-loader/ssr-module-loader/loader.ts";
import {
  clearSSRModuleCache,
  getTransformSemaphore,
  getTransformStats,
} from "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts";
import { TRANSFORM_ACQUIRE_TIMEOUT_MS } from "#veryfront/modules/react-loader/ssr-module-loader/constants.ts";
import type { TransformCapacityErrorMode } from "#veryfront/modules/react-loader/ssr-module-loader/loader-helpers.ts";

/**
 * The per-project transform slot ledger only exists when
 * SSR_TRANSFORM_PER_PROJECT_LIMIT is above zero, and every test suite runs with
 * it pinned to 0. Reading and writing that variable is a process effect, so
 * these two cases live here instead of beside the source: the colocated unit
 * file keeps the assertions that hold without touching the host environment.
 */

const PER_PROJECT_LIMIT_ENV = "SSR_TRANSFORM_PER_PROJECT_LIMIT";

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

function createLoader(projectId: string): SSRModuleLoader {
  return new SSRModuleLoader({
    projectDir: "/projects/capacity",
    projectId,
    adapter: denoAdapter,
    dev: false,
  });
}

/**
 * clearSSRModuleCache() re-reads the limit and rebuilds the global semaphore,
 * so it has to run after every change for the new value to take effect.
 */
function setPerProjectLimit(limit: string | undefined): void {
  if (limit === undefined) deleteEnv(PER_PROJECT_LIMIT_ENV);
  else setEnv(PER_PROJECT_LIMIT_ENV, limit);
  clearSSRModuleCache();
}

async function withPerProjectLimit(
  limit: string,
  action: () => Promise<void>,
): Promise<void> {
  const previousLimit = getEnv(PER_PROJECT_LIMIT_ENV);
  setPerProjectLimit(limit);
  try {
    await action();
  } finally {
    setPerProjectLimit(previousLimit);
  }
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

describe("ssr-module-loader transform capacity project slots", () => {
  it("returns the project slot when a transform is shed at the global deadline", async () => {
    await withPerProjectLimit("2", async () => {
      const projectId = "capacity-production";
      const loader = createLoader(projectId);
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
          "Transform capacity exceeded",
          "the shed transform must report a capacity failure",
        );
        assertEquals(
          getTransformStats().activeProjects.has(projectId),
          false,
          "a shed transform must still return its project slot",
        );
      } finally {
        time.restore();
        releaseTransformPermits(held);
      }
    });
  });

  it("returns the project slot after a completed transform", async () => {
    await withPerProjectLimit("2", async () => {
      const projectId = "capacity-release";
      const loader = createLoader(projectId);

      assertEquals(
        getTransformStats().perProjectLimit,
        2,
        "the per-project slot ledger must be active for this case to mean anything",
      );
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
        getTransformStats().activeProjects.has(projectId),
        false,
        "a completed transform must return its per-project slot",
      );
    });
  });
});
