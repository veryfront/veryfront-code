import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { AdapterRegistry, getLocalAdapter, resetLocalAdapter, runtime } from "./registry.ts";
import { createMockAdapter } from "./mock.ts";
import type { RuntimeId } from "./base.ts";

const expectedRuntime: RuntimeId = isDeno ? "deno" : isNode ? "node" : isBun ? "bun" : "deno";

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("registry.ts", () => {
  describe("runtime registry", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should auto-detect and return adapter", async () => {
      const adapter = await runtime.get();

      assertExists(adapter);
      assertExists(adapter.id);
      assertExists(adapter.name);
      assertExists(adapter.fs);
      assertExists(adapter.env);
    });

    it("should return same instance on multiple calls", async () => {
      const adapter1 = await runtime.get();
      const adapter2 = await runtime.get();

      assertEquals(adapter1, adapter2);
    });

    it("should detect current runtime", async () => {
      const adapter = await runtime.get();
      assertEquals(adapter.id, expectedRuntime);
    });

    it("should report initialized status", async () => {
      assertEquals(runtime.isInitialized(), false);

      await runtime.get();

      assertEquals(runtime.isInitialized(), true);
    });

    it("should throw on getSync before initialization", () => {
      assertThrows(() => runtime.getSync(), Error, "RuntimeAdapter not initialized");
    });

    it("should return adapter on getSync after initialization", async () => {
      await runtime.get();

      const adapter = runtime.getSync();
      assertExists(adapter);
      assertEquals(adapter.id, expectedRuntime);
    });
  });

  describe("runtime.set", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should allow setting custom adapter", async () => {
      await runtime.set(createMockAdapter());

      const adapter = await runtime.get();
      assertEquals(adapter.id, "memory");
    });

    it("should throw on invalid adapter", async () => {
      await assertRejects(() => runtime.set({} as any), Error, "Invalid adapter");
      await assertRejects(() => runtime.set(null as never), Error, "Invalid adapter");

      for (const missing of ["id", "name", "fs", "env", "server"] as const) {
        const adapter = createMockAdapter();
        delete (adapter as unknown as Record<string, unknown>)[missing];
        await assertRejects(
          () => runtime.set(adapter),
          Error,
          "Invalid adapter",
          `an adapter missing ${missing} must be rejected at set() time`,
        );
      }
    });

    it("should replace existing adapter", async () => {
      await runtime.get();
      assertEquals((await runtime.get()).id, expectedRuntime);

      await runtime.set(createMockAdapter());

      assertEquals((await runtime.get()).id, "memory");
    });
  });

  describe("runtime.reset", () => {
    it("should clear initialized state", async () => {
      await runtime.get();
      assertEquals(runtime.isInitialized(), true);

      await runtime.reset();

      assertEquals(runtime.isInitialized(), false);
    });

    it("should allow re-initialization after reset", async () => {
      await runtime.get();
      await runtime.reset();

      const adapter = await runtime.get();
      assertExists(adapter);
    });
  });

  describe("getLocalAdapter", () => {
    afterEach(async () => {
      await resetLocalAdapter();
    });

    it("should return local runtime adapter", async () => {
      const adapter = await getLocalAdapter();

      assertExists(adapter);
      assertEquals(adapter.id, expectedRuntime);
    });

    it("should return same instance on multiple calls", async () => {
      const adapter1 = await getLocalAdapter();
      const adapter2 = await getLocalAdapter();

      assertEquals(adapter1, adapter2);
    });

    it("should be independent from main runtime registry", async () => {
      await runtime.set(createMockAdapter());

      const localAdapter = await getLocalAdapter();

      assertEquals((await runtime.get()).id, "memory");
      assertEquals(localAdapter.id, expectedRuntime);
    });
  });

  describe("resetLocalAdapter", () => {
    it("should reset local adapter registry", async () => {
      const adapter1 = await getLocalAdapter();
      await resetLocalAdapter();
      const adapter2 = await getLocalAdapter();

      assertExists(adapter1);
      assertExists(adapter2);
    });
  });

  describe("registerLoader", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should throw when registering duplicate loader without overwrite", () => {
      assertThrows(
        () => runtime.registerLoader(expectedRuntime, async () => createMockAdapter()),
        Error,
        "already registered",
      );
    });

    it("should succeed with overwrite: true", () => {
      const originalLoader = async () => {
        const { denoAdapter } = await import("./deno.ts");
        return denoAdapter;
      };

      runtime.registerLoader(expectedRuntime, async () => createMockAdapter(), { overwrite: true });

      // Restore original loader
      runtime.registerLoader(expectedRuntime, originalLoader, { overwrite: true });
    });

    it("should register a new custom runtime loader and use it", async () => {
      const mockAdapter = createMockAdapter();
      runtime.registerLoader("memory" as RuntimeId, async () => mockAdapter, { overwrite: true });

      // Verify the loader works by setting and getting through the registry
      await runtime.set(mockAdapter);
      assertEquals((await runtime.get()).id, "memory");
    });
  });

  describe("runtime.set - error handling", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should rollback to old adapter when new adapter initialize() throws", async () => {
      await runtime.set(createMockAdapter());
      assertEquals(runtime.isInitialized(), true);

      const badAdapter = createMockAdapter();
      let failedCandidateShutdowns = 0;
      badAdapter.initialize = () => Promise.reject(new Error("init failed"));
      badAdapter.shutdown = () => {
        failedCandidateShutdowns++;
        return Promise.resolve();
      };

      await assertRejects(() => runtime.set(badAdapter), Error, "init failed");

      // Should have rolled back to old adapter
      assertEquals(runtime.isInitialized(), true);
      assertEquals((await runtime.get()).id, "memory");
      assertEquals(failedCandidateShutdowns, 1);
    });

    it("should remain uninitialized when initialize() throws with no prior adapter", async () => {
      const badAdapter = createMockAdapter();
      badAdapter.initialize = () => Promise.reject(new Error("init failed"));

      await assertRejects(() => runtime.set(badAdapter), Error, "init failed");

      assertEquals(runtime.isInitialized(), false);
    });

    it("surfaces old adapter shutdown failure after committing the replacement", async () => {
      const oldAdapter = createMockAdapter();
      const socketFailure = new Error("socket close failed");
      const watcherFailure = new Error("watcher close failed");
      const shutdownFailure = new AggregateError(
        [socketFailure, watcherFailure],
        "adapter resources remained live",
      );
      oldAdapter.shutdown = () => Promise.reject(shutdownFailure);
      const replacement = createMockAdapter();

      await runtime.set(oldAdapter);
      assertEquals(runtime.isInitialized(), true);

      const error = await assertRejects(() => runtime.set(replacement));
      assertEquals(error, shutdownFailure);
      assertEquals(runtime.isInitialized(), true);
      assertEquals(await runtime.get(), replacement);
    });

    it("aggregates initialization and failed-candidate cleanup failures", async () => {
      const oldAdapter = createMockAdapter();
      const badAdapter = createMockAdapter();
      const initializationFailure = new Error("initialization failed");
      const socketFailure = new Error("candidate socket close failed");
      const watcherFailure = new Error("candidate watcher close failed");
      const cleanupFailure = new AggregateError(
        [socketFailure, watcherFailure],
        "candidate resources remained live",
      );
      badAdapter.initialize = () => Promise.reject(initializationFailure);
      badAdapter.shutdown = () => Promise.reject(cleanupFailure);

      await runtime.set(oldAdapter);
      const error = await assertRejects(
        () => runtime.set(badAdapter),
        AggregateError,
        "initialization failed and cleanup also failed",
      ) as AggregateError;

      assertEquals(error.errors, [initializationFailure, cleanupFailure]);
      assertEquals(runtime.isInitialized(), true);
      assertEquals(await runtime.get(), oldAdapter);
    });
  });

  describe("runtime.reset - error handling", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("clears state while surfacing shutdown failure", async () => {
      const adapter = createMockAdapter();
      const socketFailure = new Error("socket close failed");
      const watcherFailure = new Error("watcher close failed");
      const shutdownFailure = new AggregateError(
        [socketFailure, watcherFailure],
        "adapter resources remained live",
      );
      adapter.shutdown = () => Promise.reject(shutdownFailure);

      await runtime.set(adapter);
      assertEquals(runtime.isInitialized(), true);

      const error = await assertRejects(() => runtime.reset());

      assertEquals(error, shutdownFailure);
      assertEquals(runtime.isInitialized(), false);
    });
  });

  describe("resetLocalAdapter - edge cases", () => {
    it("should not throw when no local registry exists", async () => {
      await resetLocalAdapter();
      // Should not throw
    });
  });

  describe("concurrent access", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should handle concurrent get calls", async () => {
      const [a, b, c] = await Promise.all([runtime.get(), runtime.get(), runtime.get()]);

      assertEquals(a, b);
      assertEquals(b, c);
    });

    it("refuses getSync and reports uninitialized while a replacement is in flight", async () => {
      const registry = new AdapterRegistry();
      const initializationStarted = createDeferred();
      const release = createDeferred();
      const installed = createMockAdapter();
      const replacement = createMockAdapter();
      replacement.initialize = async () => {
        initializationStarted.resolve();
        await release.promise;
      };

      await registry.set(installed);
      const pending = registry.set(replacement);
      await initializationStarted.promise;

      assertEquals(
        registry.isInitialized(),
        false,
        "isInitialized must report false while an operation is in flight",
      );
      assertThrows(
        () => registry.getSync(),
        Error,
        "transitioning",
        "getSync must refuse to hand back an adapter that is being replaced",
      );

      release.resolve();
      await pending;

      assertEquals(
        registry.isInitialized(),
        true,
        "the registry must report initialized once the operation settles",
      );
      assertEquals(
        registry.getSync(),
        replacement,
        "getSync must return the replacement after the transition completes",
      );
      await registry.reset();
    });

    it("serializes an explicit set after an in-flight automatic initialization", async () => {
      const registry = new AdapterRegistry();
      const loaderStarted = createDeferred();
      const releaseLoader = createDeferred();
      const automaticallyLoaded = createMockAdapter();
      const explicitlySet = createMockAdapter();
      let automaticShutdowns = 0;
      let explicitInitializations = 0;

      automaticallyLoaded.shutdown = () => {
        automaticShutdowns++;
        return Promise.resolve();
      };
      explicitlySet.initialize = () => {
        explicitInitializations++;
        return Promise.resolve();
      };
      registry.registerLoader(
        expectedRuntime,
        async () => {
          loaderStarted.resolve();
          await releaseLoader.promise;
          return automaticallyLoaded;
        },
        { overwrite: true },
      );

      const automaticGet = registry.get();
      await loaderStarted.promise;
      const explicitSet = registry.set(explicitlySet);
      const getAfterExplicitSet = registry.get();
      releaseLoader.resolve();

      assertEquals(await automaticGet, automaticallyLoaded);
      await explicitSet;
      assertEquals(await getAfterExplicitSet, explicitlySet);
      assertEquals(await registry.get(), explicitlySet);
      assertEquals(explicitInitializations, 1);
      assertEquals(automaticShutdowns, 1);
      await registry.reset();
    });

    it("does not resurrect an adapter when reset follows an in-flight get", async () => {
      const registry = new AdapterRegistry();
      const loaderStarted = createDeferred();
      const releaseLoader = createDeferred();
      const automaticallyLoaded = createMockAdapter();
      let shutdowns = 0;

      automaticallyLoaded.shutdown = () => {
        shutdowns++;
        return Promise.resolve();
      };
      registry.registerLoader(
        expectedRuntime,
        async () => {
          loaderStarted.resolve();
          await releaseLoader.promise;
          return automaticallyLoaded;
        },
        { overwrite: true },
      );

      const automaticGet = registry.get();
      await loaderStarted.promise;
      const reset = registry.reset();
      releaseLoader.resolve();

      assertEquals(await automaticGet, automaticallyLoaded);
      await reset;
      assertEquals(registry.isInitialized(), false);
      assertEquals(shutdowns, 1);
    });

    it("treats setting the active adapter as an idempotent operation", async () => {
      const registry = new AdapterRegistry();
      const adapter = createMockAdapter();
      let initializations = 0;
      let shutdowns = 0;

      adapter.initialize = () => {
        initializations++;
        return Promise.resolve();
      };
      adapter.shutdown = () => {
        shutdowns++;
        return Promise.resolve();
      };

      await registry.set(adapter);
      await registry.set(adapter);

      assertEquals(await registry.get(), adapter);
      assertEquals(initializations, 1);
      assertEquals(shutdowns, 0);
      await registry.reset();
      assertEquals(shutdowns, 1);
    });

    it("serializes concurrent replacements and shuts down the superseded adapter", async () => {
      const registry = new AdapterRegistry();
      const firstInitializationStarted = createDeferred();
      const releaseFirstInitialization = createDeferred();
      const first = createMockAdapter();
      const second = createMockAdapter();
      let firstShutdowns = 0;

      first.initialize = async () => {
        firstInitializationStarted.resolve();
        await releaseFirstInitialization.promise;
      };
      first.shutdown = () => {
        firstShutdowns++;
        return Promise.resolve();
      };

      const setFirst = registry.set(first);
      await firstInitializationStarted.promise;
      const setSecond = registry.set(second);
      releaseFirstInitialization.resolve();

      await Promise.all([setFirst, setSecond]);
      assertEquals(await registry.get(), second);
      assertEquals(firstShutdowns, 1);
      await registry.reset();
    });
  });
});
