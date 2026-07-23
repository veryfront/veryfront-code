import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getLocalAdapter, resetLocalAdapter, runtime } from "./registry.ts";
import { createMockAdapter } from "./mock.ts";
import type { RuntimeAdapter, RuntimeId } from "./base.ts";

const expectedRuntime: RuntimeId = isDeno ? "deno" : isNode ? "node" : isBun ? "bun" : "deno";

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function loadExpectedRuntimeAdapter(): Promise<RuntimeAdapter> {
  if (expectedRuntime === "bun") return (await import("./bun.ts")).bunAdapter;
  if (expectedRuntime === "node") return (await import("./node.ts")).nodeAdapter;
  return (await import("./deno.ts")).denoAdapter;
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
    });

    it("rejects structurally incomplete adapters without changing state", async () => {
      const incomplete = createMockAdapter() as RuntimeAdapter & {
        serve?: RuntimeAdapter["serve"];
      };
      Reflect.deleteProperty(incomplete, "serve");

      await assertRejects(() => runtime.set(incomplete), Error, "Invalid adapter");

      assertEquals(runtime.isInitialized(), false);
    });

    it("initializes the same adapter instance only once", async () => {
      const adapter = createMockAdapter();
      let initializeCalls = 0;
      adapter.initialize = () => {
        initializeCalls++;
        return Promise.resolve();
      };

      await runtime.set(adapter);
      await runtime.set(adapter);

      assertEquals(initializeCalls, 1);
    });

    it("coalesces concurrent initialization of the same adapter", async () => {
      const adapter = createMockAdapter();
      const releaseInitialization = createDeferred<void>();
      let initializeCalls = 0;
      adapter.initialize = async () => {
        initializeCalls++;
        await releaseInitialization.promise;
      };

      const first = runtime.set(adapter);
      const second = runtime.set(adapter);
      releaseInitialization.resolve();
      await Promise.all([first, second]);

      assertEquals(initializeCalls, 1);
    });

    it("lets a later set restore the active adapter while replacement initializes", async () => {
      const activeAdapter = createMockAdapter();
      const replacement = createMockAdapter();
      const initializationStarted = createDeferred<void>();
      const releaseInitialization = createDeferred<void>();
      replacement.initialize = async () => {
        initializationStarted.resolve();
        await releaseInitialization.promise;
      };

      await runtime.set(activeAdapter);
      const pendingReplacement = runtime.set(replacement);
      await initializationStarted.promise;

      try {
        const restoreActive = runtime.set(activeAdapter);
        releaseInitialization.resolve();
        await Promise.all([pendingReplacement, restoreActive]);

        assertEquals(runtime.getSync(), activeAdapter);
      } finally {
        releaseInitialization.resolve();
        await pendingReplacement.catch(() => {});
      }
    });

    it("does not coalesce a set with the same adapter from before reset", async () => {
      const adapter = createMockAdapter();
      const initializationStarted = createDeferred<void>();
      const releaseInitialization = createDeferred<void>();
      let initializeCalls = 0;
      adapter.initialize = async () => {
        initializeCalls++;
        if (initializeCalls === 1) {
          initializationStarted.resolve();
          await releaseInitialization.promise;
        }
      };

      const staleSet = runtime.set(adapter);
      await initializationStarted.promise;
      const pendingReset = runtime.reset();
      const currentSet = runtime.set(adapter);

      try {
        releaseInitialization.resolve();
        await Promise.all([staleSet, pendingReset, currentSet]);

        assertEquals(runtime.getSync(), adapter);
        assertEquals(initializeCalls, 2);
      } finally {
        releaseInitialization.resolve();
        await Promise.allSettled([staleSet, pendingReset, currentSet]);
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
      await runtime.reset();
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

    it("owns a different adapter instance from the global registry", async () => {
      const globalAdapter = await runtime.get();
      const localAdapter = await getLocalAdapter();

      assertEquals(globalAdapter === localAdapter, false);
    });

    it("keeps a local server running when the global registry resets", async () => {
      const localAdapter = await getLocalAdapter();
      await runtime.get();
      const server = await localAdapter.serve(() => new Response("local"), {
        hostname: "127.0.0.1",
        port: 0,
      });

      try {
        await runtime.reset();
        const response = await fetch(`http://${server.addr.hostname}:${server.addr.port}/`);
        assertEquals(await response.text(), "local");
      } finally {
        await server.stop();
      }
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
      runtime.registerLoader(expectedRuntime, loadExpectedRuntimeAdapter, { overwrite: true });
    });

    it("should throw when registering duplicate loader without overwrite", () => {
      assertThrows(
        () => runtime.registerLoader(expectedRuntime, async () => createMockAdapter()),
        Error,
        "already registered",
      );
    });

    it("should succeed with overwrite: true", () => {
      runtime.registerLoader(expectedRuntime, async () => createMockAdapter(), { overwrite: true });
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
      badAdapter.initialize = () => Promise.reject(new Error("init failed"));

      await assertRejects(() => runtime.set(badAdapter), Error, "init failed");

      // Should have rolled back to old adapter
      assertEquals(runtime.isInitialized(), true);
      assertEquals((await runtime.get()).id, "memory");
    });

    it("should remain uninitialized when initialize() throws with no prior adapter", async () => {
      const badAdapter = createMockAdapter();
      badAdapter.initialize = () => Promise.reject(new Error("init failed"));

      await assertRejects(() => runtime.set(badAdapter), Error, "init failed");

      assertEquals(runtime.isInitialized(), false);
    });

    it("should succeed when old adapter shutdown() throws", async () => {
      const oldAdapter = createMockAdapter();
      oldAdapter.shutdown = () => Promise.reject(new Error("shutdown failed"));

      await runtime.set(oldAdapter);
      assertEquals(runtime.isInitialized(), true);

      // Setting a new adapter should succeed despite old shutdown failure
      await runtime.set(createMockAdapter());
      assertEquals(runtime.isInitialized(), true);
    });
  });

  describe("runtime.reset - error handling", () => {
    afterEach(async () => {
      await runtime.reset();
    });

    it("should clear state even when shutdown() throws", async () => {
      const adapter = createMockAdapter();
      adapter.shutdown = () => Promise.reject(new Error("shutdown failed"));

      await runtime.set(adapter);
      assertEquals(runtime.isInitialized(), true);

      await runtime.reset();

      assertEquals(runtime.isInitialized(), false);
    });

    it("does not expose an adapter while reset waits for shutdown", async () => {
      const shutdownStarted = createDeferred<void>();
      const releaseShutdown = createDeferred<void>();
      const adapter = createMockAdapter();
      adapter.shutdown = async () => {
        shutdownStarted.resolve();
        await releaseShutdown.promise;
      };

      await runtime.set(adapter);
      const pendingReset = runtime.reset();
      await shutdownStarted.promise;

      try {
        assertEquals(runtime.isInitialized(), false);
        assertThrows(() => runtime.getSync(), Error, "RuntimeAdapter not initialized");
      } finally {
        releaseShutdown.resolve();
        await pendingReset;
      }
    });

    it("finishes an old shutdown before reinstalling the same adapter", async () => {
      const shutdownStarted = createDeferred<void>();
      const releaseShutdown = createDeferred<void>();
      const adapter = createMockAdapter();
      let alive = false;
      adapter.initialize = () => {
        alive = true;
        return Promise.resolve();
      };
      adapter.shutdown = async () => {
        shutdownStarted.resolve();
        await releaseShutdown.promise;
        alive = false;
      };

      await runtime.set(adapter);
      const pendingReset = runtime.reset();
      await shutdownStarted.promise;
      const reinstall = runtime.set(adapter);

      try {
        releaseShutdown.resolve();
        await Promise.all([pendingReset, reinstall]);

        assertEquals(runtime.getSync(), adapter);
        assertEquals(alive, true);
      } finally {
        releaseShutdown.resolve();
        await Promise.allSettled([pendingReset, reinstall]);
      }
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
      runtime.registerLoader(expectedRuntime, loadExpectedRuntimeAdapter, { overwrite: true });
    });

    it("should handle concurrent get calls", async () => {
      const [a, b, c] = await Promise.all([runtime.get(), runtime.get(), runtime.get()]);

      assertEquals(a, b);
      assertEquals(b, c);
    });

    it("keeps a manually set adapter when auto-initialization finishes later", async () => {
      const loaderStarted = createDeferred<void>();
      const releaseLoader = createDeferred<void>();
      const detectedAdapter = createMockAdapter();
      const manualAdapter = createMockAdapter();

      runtime.registerLoader(
        expectedRuntime,
        async () => {
          loaderStarted.resolve();
          await releaseLoader.promise;
          return detectedAdapter;
        },
        { overwrite: true },
      );

      const pendingGet = runtime.get();
      await loaderStarted.promise;
      await runtime.set(manualAdapter);
      releaseLoader.resolve();

      assertEquals(await pendingGet, manualAdapter);
      assertEquals(runtime.getSync(), manualAdapter);
    });

    it("keeps the registry reset when auto-initialization finishes later", async () => {
      const loaderStarted = createDeferred<void>();
      const releaseLoader = createDeferred<void>();

      runtime.registerLoader(
        expectedRuntime,
        async () => {
          loaderStarted.resolve();
          await releaseLoader.promise;
          return createMockAdapter();
        },
        { overwrite: true },
      );

      const pendingGet = runtime.get();
      await loaderStarted.promise;
      await runtime.reset();
      releaseLoader.resolve();

      await assertRejects(
        () => pendingGet,
        Error,
        "initialization was superseded by a registry change",
      );
      assertEquals(runtime.isInitialized(), false);
      assertThrows(() => runtime.getSync(), Error, "RuntimeAdapter not initialized");
    });

    it("rejects malformed adapters returned by loaders", async () => {
      const malformed = createMockAdapter() as RuntimeAdapter & {
        capabilities?: RuntimeAdapter["capabilities"];
      };
      Reflect.deleteProperty(malformed, "capabilities");
      runtime.registerLoader(expectedRuntime, async () => malformed, { overwrite: true });

      await assertRejects(() => runtime.get(), Error, "Invalid adapter");

      assertEquals(runtime.isInitialized(), false);
    });
  });
});
