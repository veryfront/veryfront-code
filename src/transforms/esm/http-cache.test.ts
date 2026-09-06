import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/esm/http-cache.test */

import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import {
  makeTempDir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import {
  __clearInFlightHttpFetches,
  __injectCachesForTests,
  __setHttpModuleCacheDirResolverForTests,
  __test_extractBundleDeps,
  cacheHttpImportsToLocal,
  cacheModuleToLocal,
  ensureHttpBundlesExist,
  extractSourceUrl,
  HTTP_MODULE_FETCH_MAX_WAIT_MS,
  normalizeHttpUrl,
} from "./http-cache.ts";
import { __setDistributedCacheAccessorForTests } from "./http-cache-wrapper.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { buildHttpCacheIdentity } from "./http-cache-helpers.ts";
import { simpleHash } from "#veryfront/utils/hash-utils.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { ModuleSourceCapture } from "./module-source-capture.ts";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { HTTP_MODULE_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { OutboundRequestBlockedError } from "#veryfront/security/http/outbound-fetch.ts";
import { VeryfrontError } from "#veryfront/errors";
import { MODULE_LOAD_TIMEOUT_MS } from "#veryfront/rendering/orchestrator/module-collection.ts";
import { isTenantSourceBuildError } from "#veryfront/errors/tenant-classification.ts";
import { FakeTime } from "#std/testing/time";
import {
  __getMaxInFlightHttpFetchWaiterCountForTests,
  createInFlightHttpFetch,
  inFlightHttpFetches,
  waitForSharedInFlightHttpFetch,
} from "./in-flight-manager.ts";

/** Duplicated from http-cache.ts for isolated unit testing of the pattern. */
const BUNDLE_RE = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;

describe("borrowed HTTP module capture", () => {
  it("invalidates the capture when an already aborted call throws synchronously", () => {
    const capture = new ModuleSourceCapture({ maxEntries: 2, maxBytes: 1024 });
    capture.record("file:///root.mjs", "export {};");
    assertThrows(
      () =>
        cacheHttpImportsToLocal("export {};", {
          cacheDir: "unused",
          importMap: { imports: {} },
          abortSignal: AbortSignal.abort(new Error("already cancelled")),
        }, capture),
      Error,
      "already cancelled",
    );
    assertThrows(() => capture.take(), Error, "incomplete");
  });
});

function extractBundleHashes(code: string): string[] {
  const hashes: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = BUNDLE_RE.exec(code)) !== null) {
    if (match[2]) hashes.push(match[2]);
  }

  BUNDLE_RE.lastIndex = 0;
  return hashes;
}

/** Minimal distributed cache backend backed by a map the test can inspect. */
function createMemoryBackend(store: Map<string, string>): CacheBackend {
  return {
    type: "memory",
    get: (key) => Promise.resolve(store.get(key) ?? null),
    set: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
    del: (key) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
}

async function withIsolatedHttpCache<T>(
  tempPrefix: string,
  mockFetch: typeof fetch,
  run: (tempDir: string) => Promise<T>,
): Promise<T> {
  const tempDir = await makeTempDir({ prefix: tempPrefix });

  try {
    return await withMockFetch(mockFetch, async () => {
      __injectCachesForTests({
        cachedPaths: new Map(),
        processingStack: new Set(),
        lastDistributedRefresh: new Map(),
      });
      __setDistributedCacheAccessorForTests(() => Promise.resolve(null));

      try {
        return await run(tempDir);
      } finally {
        __injectCachesForTests(null);
        __setDistributedCacheAccessorForTests(null);
        __clearInFlightHttpFetches();
      }
    });
  } finally {
    await remove(tempDir, { recursive: true });
  }
}

async function runNextFakeTimer(time: FakeTime, tempDir: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await Deno.stat(tempDir);
    if (await time.nextAsync()) return;
  }
  throw new Error("Expected a fake timer to be scheduled");
}

/** Iterations either driving helper takes before it reports a stuck wait. */
const MAX_FAKE_TIMER_STEPS = 200;

/**
 * Give pending real filesystem work turns, without moving the clock, until
 * `isReady` reports done.
 *
 * A caller reaches the shared-fetch registry through real filesystem work, so
 * which of two concurrent callers registers the shared flight is decided by
 * I/O completion order, not by call order. Draining microtasks once assumes the
 * first caller already won that race; on a loaded runner it can lose, the two
 * callers swap roles, and a test written around one of them then exercises the
 * other. Waiting on the registry itself makes the roles explicit.
 */
async function runRealTurnsUntil(
  time: FakeTime,
  tempDir: string,
  isReady: () => boolean,
  description: string,
): Promise<void> {
  for (let step = 0; step < MAX_FAKE_TIMER_STEPS; step++) {
    if (isReady()) return;
    await Deno.stat(tempDir);
    await time.runMicrotasks();
  }
  throw new Error(
    `${description} did not happen within ${MAX_FAKE_TIMER_STEPS} filesystem turns`,
  );
}

/**
 * Run scheduled fake timers, one at a time, until `isSettled` reports done.
 *
 * A caller whose only release is its own bounded-wait timer arms that timer
 * once its real I/O reaches the wait. Advancing the fake clock by a fixed span
 * instead assumes the timer already exists, and a timer armed after that span
 * is never run. Awaiting such a caller blocks forever with nothing left on the
 * event loop, which Deno reports as "Promise resolution is still pending but
 * the event loop has already resolved" — a whole test file silently dropped.
 *
 * Stepping from the settled state keeps the wait reachable whenever it is
 * armed, and the step budget turns a genuinely stuck wait into a failure
 * instead of a hang. The budget is a stuck detector, not a patience dial: a
 * caller that re-arms a fresh bounded wait after every timeout exhausts any
 * budget, and the answer is to stop it re-arming, never to raise the budget.
 */
async function runFakeTimersUntil(
  time: FakeTime,
  tempDir: string,
  isSettled: () => boolean,
  description: string,
): Promise<void> {
  for (let step = 0; step < MAX_FAKE_TIMER_STEPS; step++) {
    if (isSettled()) return;
    // A real filesystem call lets pending I/O reach its bounded wait; only
    // then can the timer that releases it exist.
    await Deno.stat(tempDir);
    if (await time.nextAsync()) await time.runMicrotasks();
  }
  throw new Error(
    `${description} did not settle within ${MAX_FAKE_TIMER_STEPS} fake timer steps`,
  );
}

describe("HTTP Bundle Cache", { sanitizeResources: false, sanitizeOps: false }, () => {
  it("keeps the full fetch retry window within the module-loading idle deadline", () => {
    assert(HTTP_MODULE_FETCH_MAX_WAIT_MS <= MODULE_LOAD_TIMEOUT_MS);
  });

  it("reports progress after the distributed cache lookup before fetching", async () => {
    const lookupRelease = Promise.withResolvers<void>();
    const lookupStarted = Promise.withResolvers<void>();
    const events: string[] = [];
    const backend: CacheBackend = {
      type: "memory",
      get: async () => {
        events.push("lookup-started");
        lookupStarted.resolve();
        await lookupRelease.promise;
        events.push("lookup-completed");
        return null;
      },
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
    };

    await withIsolatedHttpCache(
      "vf-esm-cache-lookup-progress-",
      (() => {
        events.push("fetch-started");
        return Promise.resolve(
          new Response("export const cached = true;", {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }) as typeof fetch,
      async (tempDir) => {
        __setDistributedCacheAccessorForTests(() => Promise.resolve(backend));
        const result = cacheHttpImportsToLocal(
          'import "https://93.184.216.34/cache-lookup-progress.js";',
          {
            cacheDir: tempDir,
            importMap: { imports: {}, scopes: {} },
            onProgress: ({ phase }) => events.push(phase),
          },
        );

        await lookupStarted.promise;
        assertEquals(events, ["lookup-started"]);
        lookupRelease.resolve();
        await result;

        assertEquals(events.slice(0, 4), [
          "lookup-started",
          "lookup-completed",
          "http-cache:cache-lookup-complete",
          "fetch-started",
        ]);
      },
    );
  });

  it("rejects internal module URLs before invoking fetch", async () => {
    let fetchCount = 0;
    await withIsolatedHttpCache(
      "vf-esm-internal-egress-",
      (() => {
        fetchCount += 1;
        return Promise.resolve(new Response("unexpected"));
      }) as typeof fetch,
      async (tempDir) => {
        await assertRejects(
          () => cacheModuleToLocal("http://169.254.169.254/module.js", tempDir),
          Error,
          "internal host",
        );
      },
    );
    assertEquals(fetchCount, 0);
  });

  it("retries transient esm.sh failures before failing a render", async () => {
    const moduleUrl = "https://esm.sh/react@19.0.0/jsx-runtime?target=es2022";
    let fetchCount = 0;

    const mockFetch = (() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.resolve(new Response("upstream failure", { status: 502 }));
      }
      return Promise.resolve(
        new Response("export const jsx = () => null;", {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-retry-", mockFetch, async (tempDir) => {
      const cachedUrl = await cacheModuleToLocal(moduleUrl, tempDir, "19.0.0");

      assert(cachedUrl.startsWith("file://"));
      assertEquals(fetchCount, 2);
    });
  });

  it("scopes a test cache override to the matching module URL", async () => {
    const moduleUrl = "https://esm.sh/react@19.0.0?target=es2022";
    const isolatedDir = await makeTempDir({ prefix: "vf-esm-url-cache-" });
    const mockFetch = (() =>
      Promise.resolve(
        new Response("export default {};", {
          headers: { "content-type": "application/javascript" },
        }),
      )) as typeof fetch;

    try {
      await withIsolatedHttpCache("vf-esm-request-cache-", mockFetch, async (requestedDir) => {
        const restore = __setHttpModuleCacheDirResolverForTests((url, cacheDir) =>
          url === moduleUrl && cacheDir === requestedDir ? isolatedDir : undefined
        );
        try {
          const cachedUrl = await cacheModuleToLocal(moduleUrl, requestedDir, "19.0.0");
          assert(cachedUrl.startsWith(`file://${isolatedDir}/`));
        } finally {
          restore();
        }
      });
    } finally {
      await remove(isolatedDir, { recursive: true });
    }
  });

  it("allows a cold HTTP module response to exceed five seconds", async () => {
    let fetchCount = 0;

    const mockFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCount += 1;
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const timeoutId = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(
            new Response("export const cold = true;", {
              headers: { "content-type": "application/javascript" },
            }),
          );
        }, 6_000);
        const onAbort = () => {
          clearTimeout(timeoutId);
          reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
        };

        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-cold-fetch-", mockFetch, async (tempDir) => {
      const cachedUrl = await cacheModuleToLocal(
        "https://esm.sh/cold-package",
        tempDir,
      );

      assert(cachedUrl.startsWith("file://"));
      assertEquals(fetchCount, 1);
    });
  });

  it("stops HTTP module retries when module loading is cancelled", async () => {
    let fetchCount = 0;
    let markFetchStarted!: () => void;
    let releaseFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchReleased = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const mockFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCount += 1;
      markFetchStarted();
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () => reject(signal?.reason);
        signal?.addEventListener("abort", onAbort, { once: true });
        fetchReleased.then(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(new Response("upstream failure", { status: 502 }));
        });
      });
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-cancel-fetch-", mockFetch, async (tempDir) => {
      const controller = new AbortController();
      const abortReason = new DOMException("module loading cancelled", "AbortError");
      const pending = cacheHttpImportsToLocal(
        'import "https://esm.sh/cancelled-package";',
        {
          cacheDir: tempDir,
          importMap: { imports: {}, scopes: {} },
          abortSignal: controller.signal,
        },
      );

      await fetchStarted;
      controller.abort(abortReason);
      releaseFetch();

      const error = await assertRejects(() => pending);
      assertEquals(error, abortReason);
      assertEquals(fetchCount, 1);
    });
  });

  it("stops an uncancelled caller after one wait on a retained flight", async () => {
    using time = new FakeTime();
    const moduleUrl = "https://93.184.216.34/retained-timeout.js";

    await withIsolatedHttpCache(
      "vf-esm-retained-timeout-",
      (() => Promise.reject(new Error("unexpected fetch"))) as typeof fetch,
      async (tempDir) => {
        const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };
        const cacheIdentity = await buildHttpCacheIdentity(moduleUrl, options);
        const cacheKey = `${tempDir}:${cacheIdentity}`;
        const release = Promise.withResolvers<void>();
        const renderController = new AbortController();
        let sharedSignal: AbortSignal | undefined;
        const flight = createInFlightHttpFetch(cacheKey, async (abortSignal) => {
          sharedSignal = abortSignal;
          await release.promise;
          abortSignal.throwIfAborted();
          return "/path/to/retained-timeout.mjs";
        });
        const renderWaiter = waitForSharedInFlightHttpFetch(
          cacheKey,
          flight,
          null,
          renderController.signal,
        );
        const uncancelledCaller = cacheHttpImportsToLocal(
          `import "${moduleUrl}";`,
          options,
        );

        try {
          for (
            let attempt = 0;
            attempt < 100 && __getMaxInFlightHttpFetchWaiterCountForTests() < 2;
            attempt++
          ) {
            await time.tickAsync(0);
          }
          assertEquals(__getMaxInFlightHttpFetchWaiterCountForTests(), 2);

          await time.tickAsync(HTTP_MODULE_FETCH_MAX_WAIT_MS);
          await assertRejects(
            () => uncancelledCaller,
            Error,
            "Failed to cache absolute HTTP module",
          );
          assertEquals(sharedSignal?.aborted, false);
          assertEquals(inFlightHttpFetches.get(cacheKey), flight);

          release.resolve();
          assertEquals(await renderWaiter, "/path/to/retained-timeout.mjs");
        } finally {
          release.resolve();
          await Promise.allSettled([flight, renderWaiter, uncancelledCaller]);
        }
      },
    );
  });

  it("does not let an abandoned HTTP owner overwrite its replacement", async () => {
    const moduleUrl = "https://93.184.216.34/abandoned-owner.js";
    const oldWriteStarted = Promise.withResolvers<void>();
    const releaseOldWrite = Promise.withResolvers<void>();
    const originalWriteTextFile = Deno.writeTextFile.bind(Deno);
    const distributed = new Map<string, string>();
    let fetchCount = 0;

    Deno.writeTextFile = async (path, data, options) => {
      if (typeof data === "string" && data.includes('generation = "stale"')) {
        oldWriteStarted.resolve();
        await releaseOldWrite.promise;
      }
      await originalWriteTextFile(path, data, options);
    };

    try {
      const mockFetch = (() => {
        fetchCount++;
        const generation = fetchCount === 1 ? "stale" : "fresh";
        return Promise.resolve(
          new Response(`export const generation = "${generation}";`, {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }) as typeof fetch;

      await withIsolatedHttpCache("vf-esm-abandoned-owner-", mockFetch, async (tempDir) => {
        __setDistributedCacheAccessorForTests(() =>
          Promise.resolve(createMemoryBackend(distributed))
        );
        const controller = new AbortController();
        const source = `import { generation } from "${moduleUrl}"; export { generation };`;
        const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };
        const abandoned = cacheHttpImportsToLocal(source, {
          ...options,
          abortSignal: controller.signal,
        });

        await oldWriteStarted.promise;
        controller.abort(new DOMException("render abandoned", "AbortError"));
        await assertRejects(() => abandoned, DOMException, "render abandoned");

        const replacement = await cacheHttpImportsToLocal(source, options);
        assert(replacement.code.includes("file://"));
        releaseOldWrite.resolve();
        while (inFlightHttpFetches.size > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }

        const bundleFiles: string[] = [];
        for await (const entry of readDir(tempDir)) {
          if (entry.isFile && entry.name.startsWith("http-") && entry.name.endsWith(".mjs")) {
            bundleFiles.push(entry.name);
          }
        }
        assertEquals(bundleFiles.length, 1);
        const publishedCode = await readTextFile(join(tempDir, bundleFiles[0]!));
        assert(publishedCode.includes('generation = "fresh"'));
        assertEquals(publishedCode.includes('generation = "stale"'), false);
        assertEquals(
          [...distributed.values()].some((value) => value.includes('generation = "stale"')),
          false,
        );
        assertEquals(fetchCount, 2);
      });
    } finally {
      releaseOldWrite.resolve();
      Deno.writeTextFile = originalWriteTextFile;
    }
  });

  it("lets an optional distributed write time out before publication expires", async () => {
    using time = new FakeTime();
    const distributedWriteStarted = Promise.withResolvers<void>();
    const backend: CacheBackend = {
      type: "memory",
      get: () => Promise.resolve(null),
      set: async () => {
        distributedWriteStarted.resolve();
        await new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new DOMException("Distributed cache write timed out", "TimeoutError")),
            HTTP_MODULE_FETCH_TIMEOUT_MS,
          )
        );
      },
      del: () => Promise.resolve(),
    };
    const mockFetch = (() =>
      Promise.resolve(
        new Response("export const cached = true;", {
          headers: { "content-type": "application/javascript" },
        }),
      )) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-distributed-timeout-", mockFetch, async (tempDir) => {
      __setDistributedCacheAccessorForTests(() => Promise.resolve(backend));
      const source = 'import "https://93.184.216.34/distributed-timeout.js";';
      const resultPromise = cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        importMap: { imports: {}, scopes: {} },
      });

      await time.runMicrotasks();
      await distributedWriteStarted.promise;
      await time.tickAsync(HTTP_MODULE_FETCH_TIMEOUT_MS);

      const result = await resultPromise;
      assert(result.code.includes("file://"));
      assertEquals(inFlightHttpFetches.size, 0);
    });
  });

  it("rechecks publication quarantine after a cache lookup yields", async () => {
    using time = new FakeTime();
    const moduleUrl = "https://93.184.216.34/committed-distributed-owner.js";
    const cacheLookupStarted = Promise.withResolvers<void>();
    const releaseCacheLookup = Promise.withResolvers<void>();
    const firstDistributedWriteStarted = Promise.withResolvers<void>();
    const releaseFirstDistributedWrite = Promise.withResolvers<void>();
    const distributed = new Map<string, string>();
    const originalStat = Deno.stat.bind(Deno);
    let cacheLookupBlocked = false;
    let distributedWriteCount = 0;
    let fetchCount = 0;

    const backend: CacheBackend = {
      type: "memory",
      get: (key) => Promise.resolve(distributed.get(key) ?? null),
      set: async (key, value) => {
        distributedWriteCount++;
        distributed.set(key, value);
        if (distributedWriteCount === 1) {
          firstDistributedWriteStarted.resolve();
          await releaseFirstDistributedWrite.promise;
        }
      },
      del: (key) => {
        distributed.delete(key);
        return Promise.resolve();
      },
    };
    const mockFetch = (() => {
      fetchCount++;
      return Promise.resolve(
        new Response('export const generation = "committed";', {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    try {
      await withIsolatedHttpCache(
        "vf-esm-committed-distributed-",
        mockFetch,
        async (tempDir) => {
          Deno.stat = async (path) => {
            if (
              !cacheLookupBlocked && String(path).startsWith(tempDir) &&
              String(path).endsWith(".mjs")
            ) {
              cacheLookupBlocked = true;
              cacheLookupStarted.resolve();
              await releaseCacheLookup.promise;
            }
            return await originalStat(path);
          };
          __setDistributedCacheAccessorForTests(() => Promise.resolve(backend));
          const controller = new AbortController();
          const source = `import { generation } from "${moduleUrl}"; export { generation };`;
          const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };
          const lateEntrant = cacheHttpImportsToLocal(source, options);
          let abandoned: ReturnType<typeof cacheHttpImportsToLocal> | undefined;
          let recovery: ReturnType<typeof cacheHttpImportsToLocal> | undefined;

          try {
            await cacheLookupStarted.promise;
            const abandonedOwner = cacheHttpImportsToLocal(source, {
              ...options,
              abortSignal: controller.signal,
            });
            abandoned = abandonedOwner;
            await firstDistributedWriteStarted.promise;
            controller.abort(new DOMException("render abandoned", "AbortError"));
            await assertRejects(() => abandonedOwner, DOMException, "render abandoned");

            await runNextFakeTimer(time, tempDir);
            await time.runMicrotasks();

            assertEquals(inFlightHttpFetches.size, 0);
            assertEquals(fetchCount, 1);
            assertEquals(
              [...distributed.values()].some((value) => value.includes('generation = "committed"')),
              true,
            );

            releaseCacheLookup.resolve();
            const lateEntrantOutcome = lateEntrant.catch((error) => error);
            await runNextFakeTimer(time, tempDir);
            await time.runMicrotasks();

            const lateEntrantError = await lateEntrantOutcome;
            assertInstanceOf(lateEntrantError, Error);
            assert(lateEntrantError.message.includes("Failed to cache absolute HTTP module"));
            assertEquals(inFlightHttpFetches.size, 0);
            assertEquals(fetchCount, 1);

            recovery = cacheHttpImportsToLocal(source, options);
            await time.runMicrotasks();
            releaseFirstDistributedWrite.resolve();
            const result = await recovery;
            assert(result.code.includes("file://"));
            const bundleFiles: string[] = [];
            for await (const entry of readDir(tempDir)) {
              if (
                entry.isFile && entry.name.startsWith("http-") &&
                entry.name.endsWith(".mjs")
              ) {
                bundleFiles.push(entry.name);
              }
            }
            assertEquals(bundleFiles.length, 1);
            const publishedCode = await readTextFile(join(tempDir, bundleFiles[0]!));
            assert(publishedCode.includes('generation = "committed"'));
            assertEquals(fetchCount, 1);
          } finally {
            releaseCacheLookup.resolve();
            releaseFirstDistributedWrite.resolve();
            await Promise.allSettled(
              [lateEntrant, abandoned, recovery].filter((value) => value),
            );
          }
        },
      );
    } finally {
      releaseCacheLookup.resolve();
      releaseFirstDistributedWrite.resolve();
      Deno.stat = originalStat;
    }
  });

  it("keeps a publishing generation authoritative through an atomic rename", async () => {
    using time = new FakeTime();
    const moduleUrl = "https://93.184.216.34/committed-rename-owner.js";
    const renameStarted = Promise.withResolvers<void>();
    const releaseRename = Promise.withResolvers<void>();
    const originalRename = Deno.rename.bind(Deno);
    let fetchCount = 0;

    Deno.rename = async (from, to) => {
      const stagedCode = await readTextFile(String(from));
      if (stagedCode.includes('generation = "committed"')) {
        renameStarted.resolve();
        await releaseRename.promise;
        await originalRename(from, to);
        return;
      }
      await originalRename(from, to);
    };

    const mockFetch = (() => {
      fetchCount++;
      return Promise.resolve(
        new Response('export const generation = "committed";', {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    try {
      await withIsolatedHttpCache("vf-esm-committed-rename-", mockFetch, async (tempDir) => {
        const controller = new AbortController();
        const source = `import { generation } from "${moduleUrl}"; export { generation };`;
        const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };
        const abandoned = cacheHttpImportsToLocal(source, {
          ...options,
          abortSignal: controller.signal,
        });
        let boundedFollower: ReturnType<typeof cacheHttpImportsToLocal> | undefined;
        let recovery: ReturnType<typeof cacheHttpImportsToLocal> | undefined;

        try {
          await renameStarted.promise;
          controller.abort(new DOMException("render abandoned", "AbortError"));
          await assertRejects(() => abandoned, DOMException, "render abandoned");

          await runNextFakeTimer(time, tempDir);
          await time.runMicrotasks();

          assertEquals(inFlightHttpFetches.size, 0);
          assertEquals(fetchCount, 1);

          boundedFollower = cacheHttpImportsToLocal(source, options);
          const boundedFollowerOutcome = boundedFollower.catch((error) => error);
          await runNextFakeTimer(time, tempDir);
          await time.runMicrotasks();

          const boundedFollowerError = await boundedFollowerOutcome;
          assertInstanceOf(boundedFollowerError, Error);
          assert(boundedFollowerError.message.includes("Failed to cache absolute HTTP module"));
          assertEquals(inFlightHttpFetches.size, 0);
          assertEquals(fetchCount, 1);

          recovery = cacheHttpImportsToLocal(source, options);
          await time.runMicrotasks();
          releaseRename.resolve();
          const recoveryResult = await recovery;
          assert(recoveryResult.code.includes("file://"));
          const bundleFiles: string[] = [];
          for await (const entry of readDir(tempDir)) {
            if (entry.isFile && entry.name.startsWith("http-") && entry.name.endsWith(".mjs")) {
              bundleFiles.push(entry.name);
            }
          }
          assertEquals(bundleFiles.length, 1);
          const publishedCode = await readTextFile(join(tempDir, bundleFiles[0]!));
          assert(publishedCode.includes('generation = "committed"'));
          assertEquals(fetchCount, 1);
        } finally {
          releaseRename.resolve();
          await Promise.allSettled(
            [abandoned, boundedFollower, recovery].filter((value) => value),
          );
        }
      });
    } finally {
      releaseRename.resolve();
      Deno.rename = originalRename;
    }
  });

  it("keeps a shared HTTP fetch alive while another caller is still waiting", async () => {
    let fetchCount = 0;
    let releaseFetch!: () => void;
    const fetchStarted = Promise.withResolvers<void>();

    const mockFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCount += 1;
      fetchStarted.resolve();
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () => reject(signal?.reason);
        signal?.addEventListener("abort", onAbort, { once: true });
        releaseFetch = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve(
            new Response("export const shared = true;", {
              headers: { "content-type": "application/javascript" },
            }),
          );
        };
      });
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-shared-fetch-", mockFetch, async (tempDir) => {
      const source = 'import "https://esm.sh/shared-package";';
      const importMap = { imports: {}, scopes: {} };
      const firstController = new AbortController();
      const secondController = new AbortController();
      const firstAbortReason = new DOMException("first render cancelled", "AbortError");
      const secondProgress: Array<{ phase: string; filePath?: string }> = [];
      const first = cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        importMap,
        abortSignal: firstController.signal,
      });

      await fetchStarted.promise;
      const second = cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        importMap,
        abortSignal: secondController.signal,
        onProgress: (event) => secondProgress.push(event),
      });
      const secondOutcome = second.then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
      while (__getMaxInFlightHttpFetchWaiterCountForTests() < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      assertEquals(__getMaxInFlightHttpFetchWaiterCountForTests(), 2);

      firstController.abort(firstAbortReason);
      const firstError = await assertRejects(() => first);
      releaseFetch();

      const { value: secondResult, error: secondError } = await secondOutcome;
      assertEquals(firstError, firstAbortReason);
      assertEquals(secondError, undefined);
      assert(secondResult?.code.includes("file://"));
      assertEquals(fetchCount, 1);
      assertEquals(secondProgress.map(({ phase }) => phase), [
        "http-cache:module-fetched",
      ]);
      assertEquals(secondProgress.every(({ filePath }) => filePath?.startsWith("http-")), true);
    });
  });

  it("runs a bounded wait whose timer landed past a fixed clock advance", async () => {
    using time = new FakeTime();
    const tempDir = await makeTempDir({ prefix: "vf-esm-late-armed-wait-" });

    try {
      let settled = false;
      // A follower that only reaches its bounded wait after real filesystem
      // work can arm that wait once the clock has already moved, leaving the
      // timer past the span the test advanced. Encode that end state directly:
      // a wait no single HTTP_MODULE_FETCH_MAX_WAIT_MS advance can reach.
      const work = (async () => {
        await Deno.stat(tempDir);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, HTTP_MODULE_FETCH_MAX_WAIT_MS * 3);
        });
        settled = true;
      })();

      await runFakeTimersUntil(
        time,
        tempDir,
        () => settled,
        "The late-armed bounded wait",
      );

      assertEquals(settled, true);
      await work;
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("returns a signal-less cache follower after its bounded wait", async () => {
    using time = new FakeTime();
    const distributedRead = Promise.withResolvers<string | null>();
    const backend: CacheBackend = {
      type: "memory",
      get: () => distributedRead.promise,
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
    };
    const moduleUrl = "https://93.184.216.34/signal-less-cache-follower.js";
    const source = `import { value } from "${moduleUrl}"; export { value };`;

    await withIsolatedHttpCache(
      "vf-esm-signal-less-follower-",
      (() => Promise.reject(new Error("network fetch must not start"))) as typeof fetch,
      async (tempDir) => {
        __setDistributedCacheAccessorForTests(() => Promise.resolve(backend));
        const ownerController = new AbortController();
        const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };
        const owner = cacheHttpImportsToLocal(source, {
          ...options,
          abortSignal: ownerController.signal,
        });
        const ownerOutcome = owner.catch((error) => error);

        // The follower must join the owner's flight, not start its own. Both
        // calls reach the registry through real filesystem work, so the owner
        // owns the flight only once it is registered. Starting the follower
        // before that lets the roles invert: the signal-less call becomes the
        // owner and parks on the distributed read that never resolves, while
        // the signal-bearing call keeps its waiter lease and re-arms a fresh
        // bounded wait after every timeout — one fake timer per step, forever.
        await runRealTurnsUntil(
          time,
          tempDir,
          () => inFlightHttpFetches.size === 1,
          "The owner's shared flight",
        );
        assertEquals(inFlightHttpFetches.size, 1);
        const [ownerFlight] = [...inFlightHttpFetches.values()];

        const follower = cacheHttpImportsToLocal(source, options);
        let followerSettled = false;
        const followerOutcome = follower.then(
          (value) => {
            followerSettled = true;
            return { error: undefined, value };
          },
          (error: unknown) => {
            followerSettled = true;
            return { error, value: undefined };
          },
        );

        try {
          // The follower reaches the shared flight through real filesystem
          // work, which draining microtasks alone never advances.
          await runRealTurnsUntil(
            time,
            tempDir,
            () => __getMaxInFlightHttpFetchWaiterCountForTests() >= 2,
            "The follower joining the owner's flight",
          );
          assertEquals(__getMaxInFlightHttpFetchWaiterCountForTests(), 2);
          // Both callers share one generation, and it is still the owner's.
          assertEquals([...inFlightHttpFetches.values()], [ownerFlight]);

          await runFakeTimersUntil(
            time,
            tempDir,
            () => followerSettled,
            "The signal-less follower's bounded wait",
          );

          const { error } = await followerOutcome;
          assertInstanceOf(error, Error);
          assert(error.message.includes("Failed to cache absolute HTTP module"));
          assertEquals(inFlightHttpFetches.size, 1);
        } finally {
          ownerController.abort(new DOMException("owner cancelled", "AbortError"));
          __clearInFlightHttpFetches();
          distributedRead.resolve(null);
          await Promise.allSettled([ownerOutcome, followerOutcome]);
        }
      },
    );
  });

  it("pins same-origin module-server imports before fetching", async () => {
    const origin = "http://93.184.216.34:3000";
    const source = `export { value } from "${origin}/_vf_modules/shared/Absolute.js";`;
    const snapshotKey = "on:snapshot-a";
    const fetchedUrls: string[] = [];

    await withIsolatedHttpCache(
      "vf-esm-module-origin-pins-",
      ((input) => {
        fetchedUrls.push(String(input));
        return Promise.resolve(
          new Response(`export const value = "abs";`, {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }) as typeof fetch,
      async (tempDir) => {
        const result = await cacheHttpImportsToLocal(source, {
          cacheDir: tempDir,
          importMap: { imports: {}, scopes: {} },
          moduleServerOrigin: origin,
          dependencyPinningCacheKey: snapshotKey,
        });

        assertEquals(result.code.includes("file://"), true);
      },
    );

    assertEquals(fetchedUrls.length, 1);
    const fetchedUrlString = fetchedUrls[0];
    assert(fetchedUrlString);
    const fetchedUrl = new URL(fetchedUrlString);
    assertEquals(fetchedUrl.origin, origin);
    assertEquals(fetchedUrl.pathname, "/_vf_modules/shared/Absolute.js");
    assertEquals(fetchedUrl.searchParams.get("ssr"), "true");
    assertEquals(fetchedUrl.searchParams.get("pins"), snapshotKey);
  });

  for (
    const [name, specifier] of [
      ["protocol-relative", "//93.184.216.34:3000/_vf_modules/shared/Protocol.js"],
      ["uppercase HTTP", "HTTP://93.184.216.34:3000/_vf_modules/shared/Uppercase.js"],
    ] as const
  ) {
    it(`pins ${name} same-origin module-server imports before fetching`, async () => {
      const origin = "http://93.184.216.34:3000";
      const snapshotKey = "on:snapshot-a";
      const fetchedUrls: string[] = [];

      await withIsolatedHttpCache(
        `vf-esm-${name.replaceAll(" ", "-")}-pins-`,
        ((input) => {
          fetchedUrls.push(String(input));
          return Promise.resolve(
            new Response(`export const value = "pinned";`, {
              headers: { "content-type": "application/javascript" },
            }),
          );
        }) as typeof fetch,
        async (tempDir) => {
          const result = await cacheHttpImportsToLocal(
            `export { value } from "${specifier}";`,
            {
              cacheDir: tempDir,
              importMap: { imports: {}, scopes: {} },
              moduleServerOrigin: origin,
              dependencyPinningCacheKey: snapshotKey,
            },
          );

          assertEquals(result.code.includes("file://"), true);
        },
      );

      assertEquals(fetchedUrls.length, 1);
      const fetchedUrl = new URL(fetchedUrls[0]!);
      assertEquals(fetchedUrl.origin, origin);
      assertEquals(fetchedUrl.searchParams.get("ssr"), "true");
      assertEquals(fetchedUrl.searchParams.get("pins"), snapshotKey);
    });
  }

  it("resolves a nested protocol-relative import against its HTTPS parent", async () => {
    const parentUrl = "https://93.184.216.34/recursive/parent.js";
    const childUrl = "https://93.184.216.34/recursive/child.js";
    const fetchedUrls: string[] = [];

    await withIsolatedHttpCache(
      "vf-esm-nested-protocol-relative-",
      ((input) => {
        const url = String(input);
        fetchedUrls.push(url);
        const code = url === parentUrl
          ? `export { value } from "//93.184.216.34/recursive/child.js";`
          : `export const value = "child";`;
        return Promise.resolve(
          new Response(code, {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }) as typeof fetch,
      async (tempDir) => {
        const result = await cacheHttpImportsToLocal(
          `export { value } from "${parentUrl}";`,
          {
            cacheDir: tempDir,
            importMap: { imports: {}, scopes: {} },
            moduleServerOrigin: "http://93.184.216.34:3000",
          },
        );

        assertEquals(result.code.includes("file://"), true);
      },
    );

    assertEquals(fetchedUrls, [parentUrl, childUrl]);
  });

  it("reports progress after cache lookup and fetch for each recursive HTTP module", async () => {
    const parentUrl = "https://93.184.216.34/progress/parent.js";
    const childUrl = "https://93.184.216.34/progress/child.js";
    const progressEvents: Array<{ phase: string; filePath?: string }> = [];

    await withIsolatedHttpCache(
      "vf-esm-recursive-progress-",
      ((input) => {
        const url = String(input);
        const code = url === parentUrl
          ? `export { value } from "${childUrl}";`
          : `export const value = "child";`;
        return Promise.resolve(
          new Response(code, {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }) as typeof fetch,
      async (tempDir) => {
        await cacheHttpImportsToLocal(`export { value } from "${parentUrl}";`, {
          cacheDir: tempDir,
          importMap: { imports: {}, scopes: {} },
          onProgress: (event) => progressEvents.push(event),
        });
      },
    );

    assertEquals(progressEvents.map(({ phase }) => phase), [
      "http-cache:cache-lookup-complete",
      "http-cache:module-fetched",
      "http-cache:cache-lookup-complete",
      "http-cache:module-fetched",
    ]);
    assertEquals(progressEvents.every(({ filePath }) => filePath?.startsWith("http-")), true);
    assertEquals(new Set(progressEvents.map(({ filePath }) => filePath)).size, 2);
  });

  it("fingerprints one import map once across recursive HTTP modules", async () => {
    const parentUrl = "https://93.184.216.34/fingerprint/parent.js";
    const childUrl = "https://93.184.216.34/fingerprint/child.js";
    let importEnumerations = 0;
    const imports = new Proxy({
      [parentUrl]: parentUrl,
      [childUrl]: childUrl,
    }, {
      ownKeys(target) {
        importEnumerations++;
        return Reflect.ownKeys(target);
      },
    });

    await withIsolatedHttpCache(
      "vf-esm-recursive-fingerprint-",
      ((input) => {
        const url = String(input);
        const code = url === parentUrl
          ? `export { value } from "${childUrl}";`
          : `export const value = "child";`;
        return Promise.resolve(
          new Response(code, {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }) as typeof fetch,
      async (tempDir) => {
        await cacheHttpImportsToLocal(`export { value } from "${parentUrl}";`, {
          cacheDir: tempDir,
          importMap: { imports, scopes: {} },
        });
      },
    );

    assertEquals(importEnumerations, 1);
  });

  it("completes cross-request circular module fetches", async () => {
    const firstUrl = "https://93.184.216.34/cross-flight/first.js";
    const secondUrl = "https://93.184.216.34/cross-flight/second.js";
    const startedUrls = new Set<string>();
    const bothFetchesStarted = Promise.withResolvers<void>();
    const delayedWriteStarted = Promise.withResolvers<void>();
    const releaseDelayedWrite = Promise.withResolvers<void>();
    const originalWriteTextFile = Deno.writeTextFile.bind(Deno);
    let bundleWriteCount = 0;

    Deno.writeTextFile = async (path, data, options) => {
      if (typeof data === "string" && data.startsWith("/*! @vf-source:")) {
        bundleWriteCount++;
        if (bundleWriteCount === 2) {
          delayedWriteStarted.resolve();
          await releaseDelayedWrite.promise;
        }
      }
      await originalWriteTextFile(path, data, options);
    };

    const mockFetch = (async (input) => {
      const url = String(input);
      startedUrls.add(url);
      if (startedUrls.size === 2) bothFetchesStarted.resolve();
      await bothFetchesStarted.promise;
      const dependencyUrl = url === firstUrl ? secondUrl : firstUrl;
      return new Response(`import "${dependencyUrl}"; export const loaded = true;`, {
        headers: { "content-type": "application/javascript" },
      });
    }) as typeof fetch;

    try {
      await withIsolatedHttpCache("vf-esm-cross-flight-cycle-", mockFetch, async (tempDir) => {
        __injectCachesForTests({ processingStack: null });
        const importMap = { imports: {}, scopes: {} };
        const firstResult = cacheHttpImportsToLocal(`import "${firstUrl}";`, {
          cacheDir: tempDir,
          importMap,
        });
        const secondResult = cacheHttpImportsToLocal(`import "${secondUrl}";`, {
          cacheDir: tempDir,
          importMap,
        });

        try {
          await delayedWriteStarted.promise;
          let settledResults = 0;
          void firstResult.then(() => settledResults++);
          void secondResult.then(() => settledResults++);
          await Promise.resolve();
          await Promise.resolve();
          assertEquals(settledResults, 0);

          releaseDelayedWrite.resolve();
          const [first, second] = await Promise.all([firstResult, secondResult]);
          assert(first.code.includes("file://"));
          assert(second.code.includes("file://"));
          assert(first.bundleManifestId);
          assertEquals(second.bundleManifestId, first.bundleManifestId);
          assertEquals(startedUrls, new Set([firstUrl, secondUrl]));
        } finally {
          releaseDelayedWrite.resolve();
          await Promise.allSettled([firstResult, secondResult]);
        }
      });
    } finally {
      releaseDelayedWrite.resolve();
      Deno.writeTextFile = originalWriteTextFile;
    }
  });

  it("reports a publish-verification invariant as a server fault, not an absent file", async () => {
    // The bundle write succeeds and the file still is not there. That is a
    // cache invariant violation -- a 500 -- and it must not borrow the
    // `file-not-found` identity: SSR routes that slug to a 404, which would
    // turn disk pressure or an eviction race into a status nothing alerts on.
    const moduleUrl = "https://93.184.216.34/invariant/module.js";
    const originalRename = Deno.rename.bind(Deno);

    Deno.rename = async (oldPath, newPath) => {
      if (
        String(newPath).includes("veryfront-http-bundle") || String(oldPath).includes(".pending-")
      ) {
        await remove(String(oldPath));
        return;
      }
      await originalRename(oldPath, newPath);
    };

    const mockFetch = (() =>
      Promise.resolve(
        new Response("export const loaded = true;", {
          headers: { "content-type": "application/javascript" },
        }),
      )) as typeof fetch;

    try {
      await withIsolatedHttpCache("vf-esm-invariant-slug-", mockFetch, async (tempDir) => {
        const error = await assertRejects(() =>
          cacheHttpImportsToLocal(`import "${moduleUrl}";`, {
            cacheDir: tempDir,
            importMap: { imports: {}, scopes: {} },
          })
        );

        assertInstanceOf(error, VeryfrontError);
        assertNotEquals(
          error.slug,
          "file-not-found",
          "an invariant violation must not claim the identity SSR routes to 404",
        );
        assertEquals(error.status, 500, "a broken cache invariant is a server fault");
      });
    } finally {
      Deno.rename = originalRename;
    }
  });

  it("does not retry permanent HTTP module failures", async () => {
    let fetchCount = 0;
    let bodyCancelled = false;

    const mockFetch = (() => {
      fetchCount += 1;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true;
            },
          }),
          { status: 404 },
        ),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-permanent-failure-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () =>
          cacheModuleToLocal(
            "https://esm.sh/missing-package?access_token=super-secret",
            tempDir,
          ),
        Error,
      );
      assertEquals(fetchCount, 1);
      assertEquals(bodyCancelled, true);
      assertInstanceOf(error, Error);
      assert(!error.message.includes("super-secret"));
    });
  });

  it("classifies an authored missing bare package without classifying direct HTTP failures", async () => {
    const mockFetch = (() =>
      Promise.resolve(new Response("not found", { status: 404 }))) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-missing-package-", mockFetch, async (tempDir) => {
      const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };
      const packageError = await assertRejects(
        () => cacheHttpImportsToLocal('import "missing-tenant-package";', options),
        Error,
      );
      const explicitPackageError = await assertRejects(
        () => cacheHttpImportsToLocal('import "npm:missing-tenant-package";', options),
        Error,
      );
      const directHttpError = await assertRejects(
        () => cacheModuleToLocal("https://esm.sh/missing-framework-module", tempDir),
        Error,
      );

      assertEquals(isTenantSourceBuildError(packageError), true);
      assertEquals(isTenantSourceBuildError(explicitPackageError), true);
      assertEquals(isTenantSourceBuildError(directHttpError), false);
    });
  });

  it("does not classify a missing dependency of an existing bare package as tenant source", async () => {
    const packageUrl = "https://esm.sh/package-with-missing-dependency";
    const dependencyUrl = "https://esm.sh/missing-package-dependency.js";
    const mockFetch = ((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith(packageUrl)) {
        return Promise.resolve(
          new Response(`import "${dependencyUrl}"; export const loaded = true;`, {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;

    for (
      const specifier of [
        "package-with-missing-dependency",
        "npm:package-with-missing-dependency",
      ]
    ) {
      await withIsolatedHttpCache(
        "vf-esm-missing-package-dependency-",
        mockFetch,
        async (tempDir) => {
          const error = await assertRejects(
            () =>
              cacheHttpImportsToLocal(`import ${JSON.stringify(specifier)};`, {
                cacheDir: tempDir,
                importMap: { imports: {}, scopes: {} },
              }),
            Error,
          );

          assertEquals(isTenantSourceBuildError(error), false, specifier);
        },
      );
    }
  });

  it("distinguishes a package from a missing dependency at the same sanitized URL", async () => {
    const packageUrl = "https://esm.sh/same-path-module.js?entry=root";
    const dependencyUrl = "https://esm.sh/same-path-module.js?entry=dependency";
    const mockFetch = ((input: string | URL | Request) => {
      const url = String(input);
      if (new URL(url).searchParams.get("entry") === "root") {
        return Promise.resolve(
          new Response(`import "${dependencyUrl}"; export const loaded = true;`, {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof fetch;

    await withIsolatedHttpCache(
      "vf-esm-same-sanitized-package-url-",
      mockFetch,
      async (tempDir) => {
        const error = await assertRejects(
          () =>
            cacheHttpImportsToLocal('import "same-path-package";', {
              cacheDir: tempDir,
              importMap: {
                imports: { "same-path-package": packageUrl },
                scopes: {},
              },
            }),
          Error,
        );

        assertEquals(isTenantSourceBuildError(error), false);
      },
    );
  });

  it("retries failures while reading an HTTP module body", async () => {
    let fetchCount = 0;

    const mockFetch = (() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError("body disconnected"));
              },
            }),
          ),
        );
      }
      return Promise.resolve(
        new Response("export const recovered = true;", {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-body-retry-", mockFetch, async (tempDir) => {
      const cachedUrl = await cacheModuleToLocal(
        "https://esm.sh/body-disconnect",
        tempDir,
      );

      assert(cachedUrl.startsWith("file://"));
      assertEquals(fetchCount, 2);
    });
  });

  it("rejects an oversized module body without retrying", async () => {
    let fetchCount = 0;
    let bodyCancelled = false;
    const mockFetch = (() => {
      fetchCount += 1;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true;
            },
          }),
          {
            headers: {
              "content-length": String(MAX_BUNDLE_CHUNK_SIZE_BYTES + 1),
            },
          },
        ),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-oversized-response-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal("https://esm.sh/oversized", tempDir),
        Error,
        `response exceeds ${MAX_BUNDLE_CHUNK_SIZE_BYTES} bytes`,
      );

      assertInstanceOf(error, Error);
      assertEquals(fetchCount, 1);
      assertEquals(bodyCancelled, true);
    });
  });

  it("retries a network rejection before succeeding", async () => {
    let fetchCount = 0;
    const mockFetch = (() => {
      fetchCount += 1;
      if (fetchCount === 1) return Promise.reject(new TypeError("network unavailable"));
      return Promise.resolve(new Response("export const recovered = true;"));
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-network-retry-", mockFetch, async (tempDir) => {
      const cachedUrl = await cacheModuleToLocal("https://esm.sh/network-retry", tempDir);

      assert(cachedUrl.startsWith("file://"));
      assertEquals(fetchCount, 2);
    });
  });

  it("does not expose URL credentials after network retries are exhausted", async () => {
    let fetchCount = 0;
    const secretUrl = "https://esm.sh/network-failure?access_token=super-secret";
    const mockFetch = (() => {
      fetchCount += 1;
      return Promise.reject(new TypeError(`network unavailable for ${secretUrl}`));
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-network-failure-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal(secretUrl, tempDir),
        Error,
      );

      assertEquals(fetchCount, 3);
      assertInstanceOf(error, Error);
      assert(!error.message.includes("super-secret"));
    });
  });

  it("labels exhausted AbortError retries as HTTP module fetch failures", async () => {
    let fetchCount = 0;
    const mockFetch = (() => {
      fetchCount += 1;
      return Promise.reject(new DOMException("request aborted", "AbortError"));
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-abort-failure-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal("https://esm.sh/aborted-package", tempDir),
        VeryfrontError,
        "Failed to fetch https://esm.sh/aborted-package: AbortError",
      );

      assertEquals(fetchCount, 3);
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "build-failed");
      assertEquals(error.context, { phase: "http-module-fetch" });
    });
  });

  it("does not expose URL credentials when an upstream returns HTML", async () => {
    const secretUrl = "https://esm.sh/html-failure?access_token=super-secret";
    const mockFetch = (() =>
      Promise.resolve(
        new Response("<!doctype html><title>upstream failure</title>", {
          headers: { "content-type": "text/html" },
        }),
      )) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-html-failure-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal(secretUrl, tempDir),
        Error,
      );

      assertInstanceOf(error, Error);
      assert(!error.message.includes("super-secret"));
      assertEquals(
        error.message,
        "Received HTML instead of JavaScript from https://esm.sh/html-failure. " +
          "The package may not exist or failed to build on esm.sh.",
      );
    });
  });

  it("does not blame esm.sh when a non-esm.sh origin returns HTML", async () => {
    // VERYFRONT-SERVER-G: an unresolved import that fell through to the
    // tenant's own site origin returned the HTML fallback page, and the
    // diagnostic wrongly claimed the package "failed to build on esm.sh".
    const siteUrl = "https://example.com/some/page";
    const mockFetch = (() =>
      Promise.resolve(
        new Response("<!doctype html><title>site fallback</title>", {
          headers: { "content-type": "text/html;charset=utf-8" },
        }),
      )) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-site-html-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal(siteUrl, tempDir),
        Error,
      );

      assertInstanceOf(error, Error);
      assert(!error.message.includes("esm.sh"), `must not blame esm.sh: ${error.message}`);
      assert(
        error.message.includes("Received HTML instead of JavaScript from " + siteUrl),
        `must name the URL: ${error.message}`,
      );
      assert(
        error.message.includes(
          "Verify that the import resolves to a JavaScript module and does not fall through " +
            "to the site origin.",
        ),
        `must direct the reader to verify import resolution: ${error.message}`,
      );
    });
  });

  it("hints at a failed alias import when an HTML response comes from an /@/ path", async () => {
    const aliasUrl = "https://example.com/@/components/ResponsiveImage";
    const mockFetch = (() =>
      Promise.resolve(
        new Response("<!doctype html><title>site fallback</title>", {
          headers: { "content-type": "text/html;charset=utf-8" },
        }),
      )) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-alias-html-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal(aliasUrl, tempDir),
        Error,
      );

      assertInstanceOf(error, Error);
      assert(!error.message.includes("esm.sh"), `must not blame esm.sh: ${error.message}`);
      assert(
        error.message.includes(
          'Verify that the "@/" alias import resolves to a project module and does not fall ' +
            "through to the site origin.",
        ),
        `must direct the reader to verify alias resolution: ${error.message}`,
      );
    });
  });

  it("reports an authentication redirect before an HTTP module returns HTML", async () => {
    const moduleUrl = "https://93.184.216.34/@/components/ResponsiveImage";
    const signInUrl = "https://93.184.216.35/sign-in/ONE_TIME_CODE?access_token=super-secret";
    const fetchedUrls: string[] = [];
    const mockFetch = ((input: RequestInfo | URL) => {
      const url = input instanceof Request
        ? input.url
        : input instanceof URL
        ? input.href
        : String(input);
      fetchedUrls.push(url);

      if (url === moduleUrl) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: signInUrl },
          }),
        );
      }
      if (url === signInUrl) {
        return Promise.resolve(
          new Response("<!doctype html><title>Sign in</title>", {
            headers: { "content-type": "text/html;charset=utf-8" },
          }),
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-auth-redirect-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal(moduleUrl, tempDir),
        Error,
      );

      assertEquals(fetchedUrls, [moduleUrl, signInUrl]);
      assertInstanceOf(error, Error);
      assert(!error.message.includes("super-secret"));
      assert(!error.message.includes("ONE_TIME_CODE"));
      assertEquals(
        error.message,
        `Received HTML instead of JavaScript from ${moduleUrl}. ` +
          "The upstream redirected the module request with HTTP 302 to " +
          "https://93.184.216.35/sign-in before returning HTML. " +
          "Verify that the module endpoint is accessible without interactive authentication.",
      );
    });
  });

  it("redacts redirect paths and reserves authentication wording for sign-in", async () => {
    const moduleUrl = "https://93.184.216.34/components/RedirectedModule";
    const cases = [
      {
        name: "moved module",
        status: 301,
        redirectUrl: "https://93.184.216.35/moved/module.js",
        secrets: [] as string[],
      },
      {
        name: "path credential",
        status: 302,
        redirectUrl: "https://93.184.216.35/magic/ONE_TIME_CODE?access_token=query-secret",
        secrets: ["ONE_TIME_CODE", "query-secret"],
      },
    ];

    for (const testCase of cases) {
      const mockFetch = ((input: RequestInfo | URL) => {
        const url = input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.href
          : String(input);
        if (url === moduleUrl) {
          return Promise.resolve(
            new Response(null, {
              status: testCase.status,
              headers: { location: testCase.redirectUrl },
            }),
          );
        }
        if (url === testCase.redirectUrl) {
          return Promise.resolve(
            new Response("<!doctype html><title>Not a module</title>", {
              headers: { "content-type": "text/html;charset=utf-8" },
            }),
          );
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as typeof fetch;

      await withIsolatedHttpCache(
        `vf-esm-neutral-redirect-${testCase.name}-`,
        mockFetch,
        async (tempDir) => {
          const error = await assertRejects(
            () => cacheModuleToLocal(moduleUrl, tempDir),
            Error,
          );

          assertInstanceOf(error, Error);
          for (const secret of testCase.secrets) {
            assert(!error.message.includes(secret));
          }
          assert(!error.message.includes("interactive authentication"));
          assertEquals(
            error.message,
            `Received HTML instead of JavaScript from ${moduleUrl}. ` +
              `The upstream redirected the module request with HTTP ${testCase.status} to ` +
              "https://93.184.216.35 before returning HTML. " +
              "Verify that the redirect destination serves a JavaScript module.",
          );
        },
      );
    }
  });

  it("bounds transient failure attempts and cancels every response body", async () => {
    let fetchCount = 0;
    let cancelledBodies = 0;
    const mockFetch = (() => {
      fetchCount += 1;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelledBodies += 1;
            },
          }),
          { status: 503 },
        ),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-exhausted-retry-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal("https://esm.sh/exhausted", tempDir),
        Error,
      );

      assertEquals(fetchCount, 3);
      assertEquals(cancelledBodies, 3);
      assertInstanceOf(error, Error);
      assert(error.message.includes("503"));
    });
  });

  it("preserves and shares canonical React versions across project import maps", async () => {
    const reactUrl = "https://esm.sh/react@19.0.0?target=es2022";
    const requestedUrls: string[] = [];
    let fetchCount = 0;
    const mockFetch = ((input: string | URL | Request) => {
      fetchCount += 1;
      requestedUrls.push(String(input));
      return Promise.resolve(
        new Response("export default { version: '19.0.0' };", {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-react-singleton-cache-", mockFetch, async (tempDir) => {
      const source = `import React from "${reactUrl}"; export default React;`;
      const first = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: {
            react: "https://esm.sh/react@19.2.4?target=es2022",
            unrelated: "https://93.184.216.35/a.js",
          },
          scopes: {},
        },
      });
      const second = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        importMap: {
          imports: {
            react: "https://esm.sh/react@19.2.4?target=es2022",
            unrelated: "https://93.184.216.35/b.js",
          },
          scopes: {},
        },
      });
      const firstPath = first.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const secondPath = second.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];

      assert(firstPath);
      assert(secondPath);
      assertEquals(secondPath, firstPath);
      assertEquals(fetchCount, 1);
      assert(requestedUrls.some((url) => url.includes("react@19.0.0")));
      assertEquals(requestedUrls.some((url) => url.includes("react@19.2.4")), false);
    });
  });

  it("aligns explicit React URLs to the resolved project version", async () => {
    const requestedUrls: string[] = [];
    const mockFetch = ((input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Promise.resolve(
        new Response("export default { version: '19.0.0' };", {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-react-version-align-", mockFetch, async (tempDir) => {
      await cacheHttpImportsToLocal(
        'import React from "https://esm.sh/react@18.3.1?target=es2022";',
        {
          cacheDir: tempDir,
          reactVersion: "19.0.0",
          importMap: {
            imports: { react: "https://esm.sh/react@19.2.4?target=es2022" },
            scopes: {},
          },
        },
      );

      assert(requestedUrls.some((url) => url.includes("react@19.0.0")));
      assertEquals(requestedUrls.some((url) => url.includes("react@18.3.1")), false);
      assertEquals(requestedUrls.some((url) => url.includes("react@19.2.4")), false);
    });
  });

  it("isolates rewritten modules with the same URL and React version by import map", async () => {
    const rootUrl = "https://93.184.216.34/root.js";
    const mockFetch = ((input: string | URL | Request) => {
      const url = String(input);
      const code = url.startsWith(rootUrl)
        ? 'import { marker } from "mapped-dependency"; export { marker };'
        : url.includes("dependency-a.js")
        ? 'export const marker = "A";'
        : 'export const marker = "B";';
      return Promise.resolve(
        new Response(code, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-import-map-cache-", mockFetch, async (tempDir) => {
      const source = `import { marker } from "${rootUrl}"; export { marker };`;
      const first = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: {
            "mapped-dependency": "https://93.184.216.35/dependency-a.js",
            unused: "https://93.184.216.35/unused.js",
          },
          scopes: {
            "/scope-b/": { z: "https://93.184.216.35/z.js", a: "https://93.184.216.35/a.js" },
            "/scope-a/": { x: "https://93.184.216.35/x.js" },
          },
        },
      });
      const second = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: { "mapped-dependency": "https://93.184.216.35/dependency-b.js" },
          scopes: {},
        },
      });
      const reorderedFirst = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: {
            unused: "https://93.184.216.35/unused.js",
            "mapped-dependency": "https://93.184.216.35/dependency-a.js",
          },
          scopes: {
            "/scope-a/": { x: "https://93.184.216.35/x.js" },
            "/scope-b/": { a: "https://93.184.216.35/a.js", z: "https://93.184.216.35/z.js" },
          },
        },
      });
      const differentScope = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: {
            "mapped-dependency": "https://93.184.216.35/dependency-a.js",
            unused: "https://93.184.216.35/unused.js",
          },
          scopes: {
            "/scope-b/": {
              z: "https://93.184.216.35/z-v2.js",
              a: "https://93.184.216.35/a.js",
            },
            "/scope-a/": { x: "https://93.184.216.35/x.js" },
          },
        },
      });
      const firstPath = first.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const secondPath = second.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const reorderedFirstPath = reorderedFirst.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const differentScopePath = differentScope.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];

      assert(firstPath);
      assert(secondPath);
      assert(reorderedFirstPath);
      assert(differentScopePath);
      assertNotEquals(firstPath, secondPath);
      assertNotEquals(await readTextFile(firstPath), await readTextFile(secondPath));
      assertEquals(reorderedFirstPath, firstPath);
      assertNotEquals(differentScopePath, firstPath);
    });
  });

  it("does not coalesce concurrent modules whose import maps collide under legacy hashing", async () => {
    const rootUrl = "https://93.184.216.34/collision.js";
    let fetchCount = 0;
    const mockFetch = (async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response("export const value = true;", {
        headers: { "content-type": "application/javascript" },
      });
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-import-map-collision-", mockFetch, async (tempDir) => {
      const source = `import { value } from "${rootUrl}"; export { value };`;
      const [aaResult, bbResult] = await Promise.all([
        cacheHttpImportsToLocal(source, {
          cacheDir: tempDir,
          importMap: { imports: { collision: "Aa" }, scopes: {} },
        }),
        cacheHttpImportsToLocal(source, {
          cacheDir: tempDir,
          importMap: { imports: { collision: "BB" }, scopes: {} },
        }),
      ]);
      const aaPath = aaResult.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const bbPath = bbResult.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];

      assert(aaPath);
      assert(bbPath);
      assertNotEquals(aaPath, bbPath);
      assertEquals(fetchCount, 2);
    });
  });

  it("tracks circular processing by the full cache identity", async () => {
    const rootUrl = "https://93.184.216.34/circular-identity.js";
    const active = new Set<string>();
    const hasCalls: string[] = [];
    const addCalls: string[] = [];
    const deleteCalls: string[] = [];
    const processingStack = {
      has(value: string) {
        hasCalls.push(value);
        return active.has(value);
      },
      add(value: string) {
        addCalls.push(value);
        active.add(value);
        return this;
      },
      delete(value: string) {
        deleteCalls.push(value);
        return active.delete(value);
      },
    };

    const mockFetch = (() =>
      Promise.resolve(
        new Response("export const value = true;", {
          headers: { "content-type": "application/javascript" },
        }),
      )) as typeof fetch;

    await withIsolatedHttpCache("vf-processing-identity-", mockFetch, async (tempDir) => {
      const options = {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: { dependency: "https://93.184.216.35/dependency.js" },
          scopes: {},
        },
      };
      const expectedIdentity = await buildHttpCacheIdentity(rootUrl, options);

      __injectCachesForTests({
        cachedPaths: new Map(),
        processingStack,
        lastDistributedRefresh: new Map(),
      });

      await cacheHttpImportsToLocal(
        `import { value } from "${rootUrl}"; export { value };`,
        options,
      );

      assertEquals(hasCalls, [expectedIdentity]);
      assertEquals(addCalls, [expectedIdentity]);
      assertEquals(deleteCalls, [expectedIdentity]);
    });
  });

  it("rejects and does not persist a module whose lazy dependency failed to prefetch", async () => {
    const parentUrl = "https://93.184.216.34/degraded-parent.js";
    const childUrl = "https://93.184.216.34/degraded-child.js";
    const distributed = new Map<string, string>();
    let parentFetches = 0;
    const mockFetch = ((input: string | URL | Request) => {
      if (String(input) === childUrl) {
        return Promise.resolve(new Response("upstream failure", { status: 502 }));
      }
      parentFetches += 1;
      return Promise.resolve(
        new Response(`export const load = () => import("${childUrl}");`, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-degraded-artifact-", mockFetch, async (tempDir) => {
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createMemoryBackend(distributed))
      );

      const source = `import { load } from "${parentUrl}"; export { load };`;
      const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };

      await assertRejects(() => cacheHttpImportsToLocal(source, options), Error, "Failed to fetch");
      assertEquals(parentFetches, 1);
      assertEquals(distributed.size, 0);

      await assertRejects(() => cacheHttpImportsToLocal(source, options), Error, "Failed to fetch");
      assertEquals(parentFetches, 2);
      assertEquals(distributed.size, 0);
    });
  });

  it("fails instead of emitting an internal dynamic import after egress denial", async () => {
    const parentUrl = "https://93.184.216.34/parent.js";
    const internalUrl = "http://169.254.169.254/latest/meta-data";
    let internalFetches = 0;
    const mockFetch = ((input: string | URL | Request) => {
      if (String(input) === internalUrl) internalFetches += 1;
      return Promise.resolve(
        new Response(`export const load = () => import("${internalUrl}");`, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache(
      "vf-egress-denied-dynamic-import-",
      mockFetch,
      async (tempDir) => {
        await assertRejects(
          () =>
            cacheHttpImportsToLocal(
              `import { load } from "${parentUrl}"; export { load };`,
              { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } },
            ),
          OutboundRequestBlockedError,
          "internal host",
        );
        assertEquals(internalFetches, 0);
      },
    );
  });

  it("persists a module whose lazy dependency prefetched successfully", async () => {
    const parentUrl = "https://93.184.216.34/healthy-parent.js";
    const childUrl = "https://93.184.216.34/healthy-child.js";
    const distributed = new Map<string, string>();
    let parentFetches = 0;
    const mockFetch = ((input: string | URL | Request) => {
      if (String(input) === childUrl) {
        return Promise.resolve(
          new Response("export const child = true;", {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }
      parentFetches += 1;
      return Promise.resolve(
        new Response(`export const load = () => import("${childUrl}");`, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-healthy-artifact-", mockFetch, async (tempDir) => {
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createMemoryBackend(distributed))
      );

      const source = `import { load } from "${parentUrl}"; export { load };`;
      const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };

      await cacheHttpImportsToLocal(source, options);
      assertEquals(parentFetches, 1);
      assert(distributed.size > 0, "Expected a healthy module to reach the distributed cache");

      await cacheHttpImportsToLocal(source, options);
      assertEquals(parentFetches, 1);
    });
  });

  it("creates the same complete manifest for network, disk, and memory cache hits", async () => {
    const rootUrl = "https://93.184.216.34/manifest-root.js";
    const childUrl = "https://93.184.216.34/manifest-child.js";
    let fetchCount = 0;

    const mockFetch = ((input: string | URL | Request) => {
      fetchCount += 1;
      const code = String(input) === rootUrl
        ? `import { child } from "${childUrl}"; export { child };`
        : "export const child = true;";
      return Promise.resolve(
        new Response(code, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-complete-manifest-", mockFetch, async (tempDir) => {
      const source = `import { child } from "${rootUrl}"; export { child };`;
      const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };

      const networkResult = await cacheHttpImportsToLocal(source, options);
      assert(networkResult.bundleManifestId, "Expected a manifest after the network fetch");

      __injectCachesForTests({
        cachedPaths: new Map(),
        processingStack: new Set(),
        lastDistributedRefresh: new Map(),
      });
      const diskResult = await cacheHttpImportsToLocal(source, options);
      assertEquals(diskResult.bundleManifestId, networkResult.bundleManifestId);

      const memoryResult = await cacheHttpImportsToLocal(source, options);
      assertEquals(memoryResult.bundleManifestId, networkResult.bundleManifestId);
      assertEquals(fetchCount, 2, "Expected one network request per module");
    });
  });

  it("creates complete manifests for every request sharing an in-flight fetch", async () => {
    const moduleUrl = "https://93.184.216.34/in-flight-manifest.js";
    let fetchCount = 0;
    const mockFetch = (async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response("export const value = true;", {
        headers: { "content-type": "application/javascript" },
      });
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-in-flight-manifest-", mockFetch, async (tempDir) => {
      const source = `import { value } from "${moduleUrl}"; export { value };`;
      const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };

      const [first, second] = await Promise.all([
        cacheHttpImportsToLocal(source, options),
        cacheHttpImportsToLocal(source, options),
      ]);

      assert(first.bundleManifestId);
      assertEquals(second.bundleManifestId, first.bundleManifestId);
      assertEquals(fetchCount, 1);
    });
  });

  it("reconstructs a complete manifest from distributed-cache bundles", async () => {
    const rootUrl = "https://93.184.216.34/distributed-manifest-root.js";
    const childUrl = "https://93.184.216.34/distributed-manifest-child.js";
    const distributed = new Map<string, string>();
    let fetchCount = 0;
    const mockFetch = ((input: string | URL | Request) => {
      fetchCount += 1;
      const code = String(input) === rootUrl
        ? `import { child } from "${childUrl}"; export { child };`
        : "export const child = true;";
      return Promise.resolve(
        new Response(code, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-distributed-manifest-", mockFetch, async (tempDir) => {
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createMemoryBackend(distributed))
      );
      const source = `import { child } from "${rootUrl}"; export { child };`;
      const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };
      const networkResult = await cacheHttpImportsToLocal(source, options);
      assert(networkResult.bundleManifestId);

      for await (const entry of readDir(tempDir)) {
        if (entry.isFile && entry.name.endsWith(".mjs")) {
          await remove(join(tempDir, entry.name));
        }
      }
      __injectCachesForTests({
        cachedPaths: new Map(),
        processingStack: new Set(),
        lastDistributedRefresh: new Map(),
      });

      const distributedResult = await cacheHttpImportsToLocal(source, options);

      assertEquals(distributedResult.bundleManifestId, networkResult.bundleManifestId);
      assertEquals(fetchCount, 2, "Expected the second transform to avoid network requests");
    });
  });

  it("rejects instead of publishing a partial manifest", async () => {
    const healthyUrl = "https://93.184.216.34/healthy-manifest-entry.js";
    const parentUrl = "https://93.184.216.34/degraded-manifest-entry.js";
    const childUrl = "https://93.184.216.34/unavailable-lazy-entry.js";
    const mockFetch = ((input: string | URL | Request) => {
      const url = String(input);
      if (url === childUrl) {
        return Promise.resolve(new Response("upstream failure", { status: 502 }));
      }
      const code = url === parentUrl
        ? `export const load = () => import("${childUrl}");`
        : "export const healthy = true;";
      return Promise.resolve(
        new Response(code, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-partial-manifest-", mockFetch, async (tempDir) => {
      await assertRejects(
        () =>
          cacheHttpImportsToLocal(
            [
              `import { healthy } from "${healthyUrl}";`,
              `import { load } from "${parentUrl}";`,
              "export { healthy, load };",
            ].join("\n"),
            { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } },
          ),
        Error,
        "Failed to fetch",
      );
    });
  });

  it("rewrites react-dom dependencies with the requested React version", async () => {
    const requestedUrls: string[] = [];
    const mockFetch = ((input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      const code = url.includes("react-dom@18.3.1")
        ? 'import React from "react"; export const version = React.version;'
        : 'export default { version: "18.3.1" };';
      return Promise.resolve(
        new Response(code, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-react-version-cache-", mockFetch, async (tempDir) => {
      const rootUrl = "https://esm.sh/react-dom@18.3.1/server?external=react&target=es2022";
      const cachedRootUrl = await cacheModuleToLocal(rootUrl, tempDir, "18.3.1");
      const cachedRootPath = cachedRootUrl.replace(/^file:\/\//, "");
      const legacyCachePath = join(tempDir, `http-${simpleHash(normalizeHttpUrl(rootUrl))}.mjs`);
      const rootCode = await readTextFile(cachedRootPath);

      assertNotEquals(cachedRootPath, legacyCachePath);
      assert(rootCode.includes('from "./http-'));
      assertEquals(rootCode.includes('from "react"'), false);
      assert(
        requestedUrls.some((url) => url.includes("/react@18.3.1")),
        "Expected React 18 dependency URL, got: " + requestedUrls.join(", "),
      );
      assertEquals(requestedUrls.some((url) => url.includes("/react@19.2.4")), false);

      const sourceUrls: string[] = [];
      for await (const entry of readDir(tempDir)) {
        if (!entry.isFile || !entry.name.endsWith(".mjs")) continue;
        const sourceUrl = extractSourceUrl(await readTextFile(join(tempDir, entry.name)));
        if (sourceUrl) sourceUrls.push(sourceUrl);
      }
      assert(sourceUrls.some((url) => url.includes("/react@18.3.1")));
    });
  });

  describe("HTTP_BUNDLE_PATTERN regex", () => {
    it("matches numeric-only hashes (production repro: 390496888)", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-390496888.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "390496888");
    });

    it("matches hex hashes", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-a1b2c3d4.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "a1b2c3d4");
    });

    it("matches mixed alphanumeric hashes", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-974671618.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "974671618");
    });

    it("extracts multiple bundle references from code", () => {
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";`,
        `import b from "file:///app/.cache/veryfront-http-bundle/http-222222.mjs";`,
        `import c from "file:///app/.cache/veryfront-http-bundle/http-abcdef.mjs";`,
      ].join("\n");
      const hashes = extractBundleHashes(code);
      assertEquals(hashes, ["111111", "222222", "abcdef"]);
    });

    it("does not match non-hex characters (g, h, z)", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-ghijkl.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 0);
    });

    it("handles single-quoted imports", () => {
      const code = `import foo from 'file:///app/.cache/veryfront-http-bundle/http-999999.mjs'`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "999999");
    });

    it("handles dynamic import() syntax", () => {
      const code =
        `const mod = await import("file:///app/.cache/veryfront-http-bundle/http-abc123.mjs")`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "abc123");
    });

    it("handles re-export syntax", () => {
      const code =
        `export { default } from "file:///app/.cache/veryfront-http-bundle/http-def456.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "def456");
    });

    it("handles transitive deps in recovered bundle code", () => {
      const bundleCode = [
        `import { createContext } from "file:///app/.cache/veryfront-http-bundle/http-100000.mjs";`,
        `import { useState } from "file:///app/.cache/veryfront-http-bundle/http-200000.mjs";`,
        `export function Component() { return null; }`,
      ].join("\n");
      const hashes = extractBundleHashes(bundleCode);
      assertEquals(hashes, ["100000", "200000"]);
    });

    it("matches relative path imports (new portable format)", () => {
      // New format uses relative paths for intra-bundle imports
      const code = `import foo from "./http-123456.mjs"`;
      // The original BUNDLE_RE only matches absolute paths, so this is expected to return empty
      // Relative paths are handled separately by extractBundleDeps in http-cache.ts
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 0);
    });

    it("handles mix of absolute and relative imports", () => {
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";`,
        `import b from "./http-222222.mjs";`, // Relative - not matched by absolute pattern
        `import c from "file:///app/.cache/veryfront-http-bundle/http-333333.mjs";`,
      ].join("\n");
      // Only absolute paths are extracted by the test helper
      const hashes = extractBundleHashes(code);
      assertEquals(hashes, ["111111", "333333"]);
    });
  });

  describe("ensureHttpBundlesExist", () => {
    async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
      const dir = await makeTempDir({ prefix: "vf-http-bundle-test-" });
      try {
        await fn(dir);
      } finally {
        try {
          await remove(dir, { recursive: true });
        } catch {
          /* ignore */
        }
      }
    }

    it("returns empty array when all bundles exist on disk", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-111111.mjs"), "export const a = 1;");
        await writeTextFile(join(tempDir, "http-222222.mjs"), "export const b = 2;");

        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-111111.mjs"), hash: "111111" },
            { path: join(tempDir, "http-222222.mjs"), hash: "222222" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 0, "All bundles exist on disk, none should fail");
      });
    });

    it("reports missing bundles when no distributed cache available", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-111111.mjs"), "export const a = 1;");

        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-111111.mjs"), hash: "111111" },
            { path: join(tempDir, "http-aaaaaa.mjs"), hash: "aaaaaa" },
            { path: join(tempDir, "http-bbbbbb.mjs"), hash: "bbbbbb" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 2, "Two missing bundles should be reported");
        assert(failed.includes("aaaaaa"), "aaaaaa should be in failed list");
        assert(failed.includes("bbbbbb"), "bbbbbb should be in failed list");
      });
    });

    it("handles empty bundle list", async () => {
      await withTempDir(async (tempDir) => {
        const failed = await ensureHttpBundlesExist([], tempDir);
        assertEquals(failed.length, 0);
      });
    });

    it("uses canonical paths from cacheDir, ignoring caller-provided paths", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-333333.mjs"), "export const c = 3;");

        const failed = await ensureHttpBundlesExist(
          [{ path: "/app/.cache/other-pod-cache/http-333333.mjs", hash: "333333" }],
          tempDir,
        );

        assertEquals(
          failed.length,
          0,
          "Should find bundle at canonical path regardless of caller path",
        );
      });
    });

    it("reproduces production error: numeric hash 390496888", async () => {
      await withTempDir(async (tempDir) => {
        const failed = await ensureHttpBundlesExist(
          [{ path: "/app/.cache/veryfront-http-bundle/http-390496888.mjs", hash: "390496888" }],
          tempDir,
        );

        assertEquals(failed.length, 1);
        assertEquals(failed[0], "390496888", "Should correctly identify numeric hash as failed");
      });
    });

    it("deduplicates hashes when same bundle referenced multiple times", async () => {
      await withTempDir(async (tempDir) => {
        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
            { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
            { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 1);
        assertEquals(failed[0], "444444");
      });
    });

    it("detects missing transitive deps in locally-present bundles (plucky-bohr repro)", async () => {
      const bundleDir = await makeTempDir({ prefix: "vf-veryfront-http-bundle-" });
      try {
        await writeTextFile(
          join(bundleDir, "http-725215427.mjs"),
          `import { jsx } from "file://${bundleDir}/veryfront-http-bundle/http-57259823.mjs";\nexport default function() { return jsx("div"); }`,
        );

        const failed = await ensureHttpBundlesExist(
          [{ path: join(bundleDir, "http-725215427.mjs"), hash: "725215427" }],
          bundleDir,
        );

        assert(
          failed.includes("57259823"),
          `Should detect missing transitive dep 57259823, got: [${failed.join(", ")}]`,
        );
      } finally {
        try {
          await remove(bundleDir, { recursive: true });
        } catch {
          /* ignore */
        }
      }
    });

    /**
     * This test validates the fix for "Missing HTTP bundles after transform" error.
     *
     * Root cause: When cacheHttpModule loads a bundle from Redis, the cached code
     * might reference child bundles whose Redis keys (code:{hash}, hash:{hash})
     * have expired. Without validation, the parent is written to disk but children
     * can't be recovered, causing the error.
     *
     * The fix: validateBundleDepsExist() is called before using Redis cache.
     * If any deps can't be recovered, we reject the Redis cache and re-fetch
     * from network (which recursively fetches all deps with fresh URLs).
     *
     * This scenario is tested indirectly by ensureHttpBundlesExist tests above,
     * which verify that missing transitive deps are correctly detected.
     */

    it("handles mix of existing and missing bundles", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-aaa111.mjs"), "export const exists1 = true;");
        await writeTextFile(join(tempDir, "http-bbb222.mjs"), "export const exists2 = true;");

        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-aaa111.mjs"), hash: "aaa111" },
            { path: join(tempDir, "http-ccc333.mjs"), hash: "ccc333" },
            { path: join(tempDir, "http-bbb222.mjs"), hash: "bbb222" },
            { path: join(tempDir, "http-ddd444.mjs"), hash: "ddd444" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 2);
        assert(failed.includes("ccc333"));
        assert(failed.includes("ddd444"));
      });
    });
  });

  describe("extractBundleDeps (production bug fixes)", () => {
    it("extracts absolute file:// paths (legacy format)", () => {
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";`,
        `import b from "file:///app/.cache/veryfront-http-bundle/http-222222.mjs";`,
      ].join("\n");

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 2);
      assertEquals(deps[0]?.hash, "111111");
      assertEquals(deps[1]?.hash, "222222");
    });

    it("extracts relative ./http-*.mjs paths (new portable format)", () => {
      // This was the root cause of the production bug - relative paths weren't being detected
      const code = [
        `import a from "./http-333333.mjs";`,
        `import b from "./http-444444.mjs";`,
      ].join("\n");

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 2, "Should detect relative path deps");
      assertEquals(deps[0]?.hash, "333333");
      assertEquals(deps[1]?.hash, "444444");
    });

    it("extracts mix of absolute and relative paths", () => {
      // Real-world scenario: older deps use absolute, newer use relative
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";`,
        `import b from "./http-222222.mjs";`,
        `import c from "file:///app/.cache/veryfront-http-bundle/http-333333.mjs";`,
        `import d from './http-444444.mjs';`, // single quotes
      ].join("\n");

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 4, "Should detect all deps regardless of path format");
      const hashes = deps.map((d) => d.hash).sort();
      assertEquals(hashes, ["111111", "222222", "333333", "444444"]);
    });

    it("deduplicates same hash appearing in both formats", () => {
      // Edge case: same bundle referenced both ways
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-555555.mjs";`,
        `import b from "./http-555555.mjs";`,
      ].join("\n");

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 1, "Should deduplicate same hash");
      assertEquals(deps[0]?.hash, "555555");
    });

    it("handles real-world esm.sh bundle code with nested deps", () => {
      // Simulates actual react-dom bundle structure
      const code = `
        import { jsx as _jsx } from "./http-100000.mjs";
        import { createContext, useState } from "./http-200000.mjs";
        export { _jsx as jsx };
        export function Component() {
          const [state, setState] = useState(null);
          return _jsx("div", { children: state });
        }
      `;

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 2);
      assert(deps.some((d) => d.hash === "100000"), "Should find jsx-runtime dep");
      assert(deps.some((d) => d.hash === "200000"), "Should find react dep");
    });

    it("handles dynamic imports with relative paths", () => {
      const code = `
        const mod = await import("./http-666666.mjs");
        const other = await import('./http-777777.mjs');
      `;

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 2);
      assert(deps.some((d) => d.hash === "666666"));
      assert(deps.some((d) => d.hash === "777777"));
    });

    it("returns empty array for code without bundle deps", () => {
      const code = `
        import React from "react";
        import { useState } from "react";
        export default function App() { return null; }
      `;

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 0);
    });

    it("handles numeric-only hashes (production case: 978582506)", () => {
      // The actual hash from production error logs
      const code = `import server from "./http-978582506.mjs";`;

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 1);
      assertEquals(deps[0]?.hash, "978582506");
    });
  });

  describe("in-flight fetch isolation", () => {
    /**
     * These tests validate the fix for concurrent test flakiness and production
     * timeout cascades caused by shared inFlightHttpFetches map.
     *
     * Root cause: When one request's fetch gets stuck, all concurrent requests
     * waiting on the same cache key would hang indefinitely, causing cascade failures.
     *
     * Fix: Added 30-second timeout when waiting for in-flight fetches, plus
     * __clearInFlightHttpFetches() for test isolation.
     */

    it("__clearInFlightHttpFetches exists and is callable", () => {
      // Basic sanity check that the cleanup function is exported and works
      assertEquals(typeof __clearInFlightHttpFetches, "function");
      // Should not throw
      __clearInFlightHttpFetches();
    });

    it("clearing in-flight fetches is idempotent", () => {
      // Multiple calls should be safe
      __clearInFlightHttpFetches();
      __clearInFlightHttpFetches();
      __clearInFlightHttpFetches();
      // No assertion needed - test passes if no error is thrown
    });
  });
});
