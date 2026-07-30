import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { TokenCacheStore } from "../extensions/cache/index.ts";
import type { CacheFromEnvOptions } from "./cache/index.ts";
import type { CacheStats, TokenCache, TokenCacheEntry } from "./cache/types.ts";
import { acquireProxyStartupCache } from "./startup-cache.ts";
import { createProxyStartupRollback } from "./startup-rollback.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeStore implements TokenCacheStore {
  closeCalls = 0;

  get(_key: string): Promise<TokenCacheEntry | null> {
    return Promise.resolve(null);
  }
  set(_key: string, _entry: TokenCacheEntry): Promise<void> {
    return Promise.resolve();
  }
  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }
  clear(): Promise<void> {
    return Promise.resolve();
  }
  has(_key: string): Promise<boolean> {
    return Promise.resolve(false);
  }
  stats(): Promise<CacheStats> {
    return Promise.resolve({ hits: 0, misses: 0, size: 0, type: "extension" });
  }
  close(): Promise<void> {
    this.closeCalls++;
    return Promise.resolve();
  }
}

class FakeStartupCache implements TokenCache {
  closeCalls = 0;

  constructor(
    private readonly store: TokenCacheStore | null,
    private readonly closeStore: boolean,
    private readonly events: string[],
  ) {}

  get(_key: string): Promise<TokenCacheEntry | null> {
    return Promise.resolve(null);
  }
  set(_key: string, _entry: TokenCacheEntry): Promise<void> {
    return Promise.resolve();
  }
  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }
  clear(): Promise<void> {
    return Promise.resolve();
  }
  has(_key: string): Promise<boolean> {
    return Promise.resolve(false);
  }
  stats(): Promise<CacheStats> {
    return Promise.resolve({ hits: 0, misses: 0, size: 0, type: "extension" });
  }
  async close(): Promise<void> {
    this.closeCalls++;
    this.events.push("cache");
    if (this.closeStore) {
      this.events.push("store");
      await this.store?.close();
    }
  }
}

class RejectingStartupCache extends FakeStartupCache {
  constructor(
    store: FakeStore,
    private readonly failureEvents: string[],
    private readonly closeError: Error,
  ) {
    super(store, false, failureEvents);
  }

  override close(): Promise<void> {
    this.closeCalls++;
    this.failureEvents.push("cache");
    return Promise.reject(this.closeError);
  }
}

class DelayedStoreClosingCache implements TokenCache {
  closeCalls = 0;

  constructor(
    private readonly store: TokenCacheStore,
    private readonly closeGate: Promise<void>,
    private readonly events: string[],
  ) {}

  get(_key: string): Promise<TokenCacheEntry | null> {
    return Promise.resolve(null);
  }
  set(_key: string, _entry: TokenCacheEntry): Promise<void> {
    return Promise.resolve();
  }
  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }
  clear(): Promise<void> {
    return Promise.resolve();
  }
  has(_key: string): Promise<boolean> {
    return Promise.resolve(false);
  }
  stats(): Promise<CacheStats> {
    return Promise.resolve({ hits: 0, misses: 0, size: 0, type: "extension" });
  }
  async close(): Promise<void> {
    this.closeCalls++;
    this.events.push("cache");
    await this.closeGate;
    await this.store.close();
  }
}

function cacheFactory(
  events: string[],
  receive?: (options: CacheFromEnvOptions) => void,
): (options: CacheFromEnvOptions) => Promise<TokenCache> {
  return (options) => {
    receive?.(options);
    const acquisition = options.extensionStore;
    const store = acquisition?.store ?? null;
    return Promise.resolve(
      new FakeStartupCache(
        store,
        acquisition?.kind === "created",
        events,
      ),
    );
  };
}

describe("proxy startup cache ownership", () => {
  it("closes and unregisters a created store that resolves after cancellation", async () => {
    const storeReady = deferred<Readonly<{ kind: "created"; store: TokenCacheStore }>>();
    const acquisitionStarted = deferred<void>();
    const store = new FakeStore();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    let registered: TokenCacheStore | undefined;
    let cacheCreations = 0;

    const acquiring = acquireProxyStartupCache(
      rollback,
      {
        acquireExtensionStore: () => {
          acquisitionStarted.resolve();
          return storeReady.promise;
        },
        createCache: (options) => {
          cacheCreations++;
          return cacheFactory([])(options);
        },
        resolveRegisteredStore: () => registered,
        registerStore: (value) => {
          registered = value;
        },
        unregisterStore: () => {
          registered = undefined;
        },
      },
      controller.signal,
    );
    await acquisitionStarted.promise;
    controller.abort(interruption);
    registered = store;
    storeReady.resolve(Object.freeze({ kind: "created", store }));

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(store.closeCalls, 1);
    assertEquals(registered, undefined);
    assertEquals(cacheCreations, 0);
  });

  it("reports late registry and store cleanup failures together", async () => {
    const closeError = new Error("store close failed");
    const restorationError = new Error("registry restoration failed");
    class RejectingStore extends FakeStore {
      override close(): Promise<void> {
        this.closeCalls++;
        return Promise.reject(closeError);
      }
    }
    const storeReady = deferred<Readonly<{ kind: "created"; store: TokenCacheStore }>>();
    const acquisitionStarted = deferred<void>();
    const store = new RejectingStore();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const cleanupFailures: Array<{ step: string; error?: unknown }> = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
      reportCleanupFailure: (failure) => {
        cleanupFailures.push({
          step: failure.step,
          ...(failure.status === "failed" ? { error: failure.error } : {}),
        });
      },
    });
    let registered: TokenCacheStore | undefined;

    const acquiring = acquireProxyStartupCache(
      rollback,
      {
        acquireExtensionStore: () => {
          acquisitionStarted.resolve();
          return storeReady.promise;
        },
        createCache: cacheFactory([]),
        resolveRegisteredStore: () => registered,
        registerStore: (value) => {
          registered = value;
        },
        unregisterStore: () => {
          throw restorationError;
        },
      },
      controller.signal,
    );
    await acquisitionStarted.promise;
    controller.abort(interruption);
    registered = store;
    storeReady.resolve(Object.freeze({ kind: "created", store }));

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(store.closeCalls, 1);
    assertEquals(cleanupFailures.length, 1);
    assertEquals(cleanupFailures[0]?.step, "extension-token-cache-acquisition");
    const cleanupError = cleanupFailures[0]?.error;
    assertEquals(cleanupError instanceof AggregateError, true);
    assertEquals(
      cleanupError instanceof AggregateError ? cleanupError.errors : [],
      [restorationError, closeError],
    );
  });

  it("rejects and observes an asynchronous late unregister operation", async () => {
    const storeReady = deferred<Readonly<{ kind: "created"; store: TokenCacheStore }>>();
    const acquisitionStarted = deferred<void>();
    const store = new FakeStore();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const registryRejection = new Error("late unregister rejected");
    const cleanupFailures: Array<{ step: string; error?: unknown }> = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
      reportCleanupFailure: (failure) => {
        cleanupFailures.push({
          step: failure.step,
          ...(failure.status === "failed" ? { error: failure.error } : {}),
        });
      },
    });
    let registered: TokenCacheStore | undefined;

    const acquiring = acquireProxyStartupCache(
      rollback,
      {
        acquireExtensionStore: () => {
          acquisitionStarted.resolve();
          return storeReady.promise;
        },
        createCache: cacheFactory([]),
        resolveRegisteredStore: () => registered,
        registerStore: (value) => {
          registered = value;
        },
        unregisterStore: () => {
          registered = undefined;
          return Promise.reject(registryRejection);
        },
      },
      controller.signal,
    );
    await acquisitionStarted.promise;
    controller.abort(interruption);
    registered = store;
    storeReady.resolve(Object.freeze({ kind: "created", store }));

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(store.closeCalls, 1);
    assertEquals(registered, undefined);
    assertEquals(cleanupFailures.length, 1);
    assertEquals(cleanupFailures[0]?.step, "extension-token-cache-acquisition");
    assertEquals(cleanupFailures[0]?.error instanceof TypeError, true);
    assertEquals(
      (cleanupFailures[0]?.error as TypeError).message,
      "Late Proxy extension store unregistration must complete synchronously",
    );
  });

  it("transfers late cache cleanup and closes a created store exactly once", async () => {
    const events: string[] = [];
    const store = new FakeStore();
    const cacheReady = deferred<TokenCache>();
    const cacheCreationStarted = deferred<void>();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    let registered: TokenCacheStore | undefined;
    const cache = new FakeStartupCache(store, true, events);

    const acquiring = acquireProxyStartupCache(
      rollback,
      {
        acquireExtensionStore: () => {
          registered = store;
          return Promise.resolve(Object.freeze({ kind: "created" as const, store }));
        },
        createCache: () => {
          cacheCreationStarted.resolve();
          return cacheReady.promise;
        },
        resolveRegisteredStore: () => registered,
        registerStore: (value) => {
          registered = value;
          events.push("restore");
        },
        unregisterStore: () => {
          registered = undefined;
          events.push("restore");
        },
      },
      controller.signal,
    );
    await cacheCreationStarted.promise;
    controller.abort(interruption);
    cacheReady.resolve(cache);

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(events, ["cache", "store", "restore"]);
    assertEquals(cache.closeCalls, 1);
    assertEquals(store.closeCalls, 1);
    assertEquals(registered, undefined);
  });

  it("keeps direct store cleanup when a late cache close fails", async () => {
    const events: string[] = [];
    class EventStore extends FakeStore {
      override close(): Promise<void> {
        events.push("store");
        return super.close();
      }
    }
    const store = new EventStore();
    const cacheReady = deferred<TokenCache>();
    const cacheCreationStarted = deferred<void>();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const cacheCloseError = new Error("cache close failed");
    const cleanupFailures: Array<{ step: string; error?: unknown }> = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
      reportCleanupFailure: (failure) => {
        cleanupFailures.push({
          step: failure.step,
          ...(failure.status === "failed" ? { error: failure.error } : {}),
        });
      },
    });
    let registered: TokenCacheStore | undefined;
    const cache = new RejectingStartupCache(store, events, cacheCloseError);

    const acquiring = acquireProxyStartupCache(
      rollback,
      {
        acquireExtensionStore: () => {
          registered = store;
          return Promise.resolve(Object.freeze({ kind: "created" as const, store }));
        },
        createCache: () => {
          cacheCreationStarted.resolve();
          return cacheReady.promise;
        },
        resolveRegisteredStore: () => registered,
        registerStore: (value) => {
          registered = value;
        },
        unregisterStore: () => {
          registered = undefined;
        },
      },
      controller.signal,
    );
    await cacheCreationStarted.promise;
    controller.abort(interruption);
    cacheReady.resolve(cache);

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(events, ["cache", "store"]);
    assertEquals(cache.closeCalls, 1);
    assertEquals(store.closeCalls, 1);
    assertEquals(registered, undefined);
    assertEquals(cleanupFailures.length, 1);
    assertEquals(cleanupFailures[0]?.step, "token-cache-acquisition");
    assertStrictEquals(cleanupFailures[0]?.error, cacheCloseError);
  });

  it("shares store close when late cache cleanup crosses the rollback deadline", async () => {
    const store = new FakeStore();
    const events: string[] = [];
    const closeGate = deferred<void>();
    const cacheReady = deferred<TokenCache>();
    const cacheCreationStarted = deferred<void>();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 5 });
    let registered: TokenCacheStore | undefined;
    let cache: DelayedStoreClosingCache | undefined;

    const acquiring = acquireProxyStartupCache(
      rollback,
      {
        acquireExtensionStore: () => {
          registered = store;
          return Promise.resolve(Object.freeze({ kind: "created" as const, store }));
        },
        createCache: (options) => {
          const selectedStore = options.extensionStore?.store;
          if (!selectedStore) throw new Error("expected created store");
          cache = new DelayedStoreClosingCache(
            selectedStore,
            closeGate.promise,
            events,
          );
          cacheCreationStarted.resolve();
          return cacheReady.promise;
        },
        resolveRegisteredStore: () => registered,
        registerStore: (value) => {
          registered = value;
        },
        unregisterStore: () => {
          registered = undefined;
        },
      },
      controller.signal,
    );
    await cacheCreationStarted.promise;
    controller.abort(interruption);
    cacheReady.resolve(cache!);

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }
    assertStrictEquals(rejection, interruption);
    assertEquals(events, ["cache"]);
    assertEquals(store.closeCalls, 1);

    closeGate.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(store.closeCalls, 1);
    assertEquals(cache?.closeCalls, 1);
    assertEquals(registered, undefined);
  });

  it("does not invoke an accessor masquerading as a provisional close", async () => {
    let closeAccessorReads = 0;
    const malformed = {
      get: "not-a-function",
      set() {
        return Promise.resolve();
      },
      delete() {
        return Promise.resolve();
      },
      clear() {
        return Promise.resolve();
      },
      has() {
        return Promise.resolve(false);
      },
      stats() {
        return Promise.resolve({ hits: 0, misses: 0, size: 0, type: "extension" as const });
      },
    } as Record<string, unknown>;
    Object.defineProperty(malformed, "close", {
      get() {
        closeAccessorReads++;
        throw new Error("close accessor must not run");
      },
    });
    const store = malformed as unknown as TokenCacheStore;
    let registered: TokenCacheStore | undefined = store;
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });

    await assertRejects(
      () =>
        acquireProxyStartupCache(rollback, {
          acquireExtensionStore: () =>
            Promise.resolve(Object.freeze({
              kind: "created" as const,
              store,
            })),
          createCache: cacheFactory([]),
          resolveRegisteredStore: () => registered,
          registerStore: (value) => {
            registered = value;
          },
          unregisterStore: () => {
            registered = undefined;
          },
        }),
      TypeError,
      "operation must be a data function",
    );

    assertEquals(closeAccessorReads, 0);
  });

  it("rolls back a created store when post-acquisition validation fails", async () => {
    let closeCalls = 0;
    const malformed = {
      get: "not-a-function",
      set() {
        return Promise.resolve();
      },
      delete() {
        return Promise.resolve();
      },
      clear() {
        return Promise.resolve();
      },
      has() {
        return Promise.resolve(false);
      },
      stats() {
        return Promise.resolve({ hits: 0, misses: 0, size: 0, type: "extension" as const });
      },
      close() {
        closeCalls++;
        return Promise.resolve();
      },
    } as unknown as TokenCacheStore;
    let registered: TokenCacheStore | undefined;
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });

    await assertRejects(
      () =>
        acquireProxyStartupCache(rollback, {
          acquireExtensionStore: () => {
            registered = malformed;
            return Promise.resolve(Object.freeze({
              kind: "created",
              store: malformed,
            }));
          },
          createCache: cacheFactory([]),
          resolveRegisteredStore: () => registered,
          registerStore: (value) => {
            registered = value;
          },
          unregisterStore: () => {
            registered = undefined;
          },
        }),
      TypeError,
      "data function",
    );

    assertEquals(closeCalls, 1);
    assertEquals(registered, undefined);
  });

  it("transfers a created store through cache and handler, then restores the registry", async () => {
    const events: string[] = [];
    const store = new FakeStore();
    let registered: TokenCacheStore | undefined;
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    const startupCache = await acquireProxyStartupCache(rollback, {
      acquireExtensionStore: () => {
        registered = store;
        return Promise.resolve(Object.freeze({ kind: "created", store }));
      },
      createCache: cacheFactory(events),
      resolveRegisteredStore: () => registered,
      registerStore: (value) => {
        registered = value;
        events.push("restore");
      },
      unregisterStore: () => {
        registered = undefined;
        events.push("restore");
      },
    });
    rollback.own("proxy-handler", async () => {
      events.push("handler");
      await startupCache.cache.close();
      startupCache.transferToHandler();
    });

    await assertRejects(
      () => rollback.run(() => Promise.reject(new Error("later failure"))),
      Error,
      "later failure",
    );

    assertEquals(events, ["handler", "cache", "store", "restore"]);
    assertEquals(store.closeCalls, 1);
    assertEquals(registered, undefined);
  });

  it("does not wait for an asynchronous previous-store restoration", async () => {
    const previousStore = new FakeStore();
    const createdStore = new FakeStore();
    let registered: TokenCacheStore | undefined = previousStore;
    const cleanupFailures: Array<{ step: string; error?: unknown }> = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
      reportCleanupFailure: (failure) => {
        cleanupFailures.push({
          step: failure.step,
          ...(failure.status === "failed" ? { error: failure.error } : {}),
        });
      },
    });

    await acquireProxyStartupCache(rollback, {
      acquireExtensionStore: () => {
        registered = createdStore;
        return Promise.resolve(Object.freeze({
          kind: "created" as const,
          store: createdStore,
        }));
      },
      createCache: cacheFactory([]),
      resolveRegisteredStore: () => registered,
      registerStore: (value) => {
        registered = value;
        return new Promise<void>(() => {});
      },
      unregisterStore: () => {
        registered = undefined;
      },
    });

    await assertRejects(
      () => rollback.run(() => Promise.reject(new Error("later failure"))),
      Error,
      "later failure",
    );

    assertStrictEquals(registered, previousStore);
    assertEquals(createdStore.closeCalls, 1);
    assertEquals(cleanupFailures.length, 1);
    assertEquals(cleanupFailures[0]?.step, "token-cache-store-registration");
    assertEquals(cleanupFailures[0]?.error instanceof TypeError, true);
    assertEquals(
      (cleanupFailures[0]?.error as TypeError).message,
      "Proxy startup cache registration restoration must complete synchronously",
    );
  });

  it("restores a created-store registration after handler cleanup times out", async () => {
    const store = new FakeStore();
    const handlerCloseGate = deferred<void>();
    const cache = new FakeStartupCache(store, true, []);
    let registered: TokenCacheStore | undefined;
    const failures: Array<{ step: string; status: string }> = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 5,
      reportCleanupFailure: ({ step, status }) => {
        failures.push({ step, status });
      },
    });
    const startupCache = await acquireProxyStartupCache(rollback, {
      acquireExtensionStore: () => {
        registered = store;
        return Promise.resolve(Object.freeze({ kind: "created", store }));
      },
      createCache: () => Promise.resolve(cache),
      resolveRegisteredStore: () => registered,
      registerStore: (value) => {
        registered = value;
      },
      unregisterStore: () => {
        registered = undefined;
      },
    });
    rollback.own("proxy-handler", async () => {
      await handlerCloseGate.promise;
      await startupCache.cache.close();
      startupCache.transferToHandler();
    });

    await assertRejects(
      () => rollback.run(() => Promise.reject(new Error("listener failed"))),
      Error,
      "listener failed",
    );

    assertEquals(failures, [
      { step: "proxy-handler", status: "timeout" },
      { step: "token-cache", status: "timeout" },
    ]);
    assertEquals(registered, undefined);
    assertEquals(cache.closeCalls, 1);
    assertEquals(store.closeCalls, 1);

    handlerCloseGate.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(cache.closeCalls, 1);
    assertEquals(store.closeCalls, 1);
  });

  it("restores a created-store registration after handler cleanup fails", async () => {
    const store = new FakeStore();
    const cache = new FakeStartupCache(store, true, []);
    let registered: TokenCacheStore | undefined;
    const failures: Array<{ step: string; status: string }> = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
      reportCleanupFailure: ({ step, status }) => {
        failures.push({ step, status });
      },
    });
    await acquireProxyStartupCache(rollback, {
      acquireExtensionStore: () => {
        registered = store;
        return Promise.resolve(Object.freeze({ kind: "created", store }));
      },
      createCache: () => Promise.resolve(cache),
      resolveRegisteredStore: () => registered,
      registerStore: (value) => {
        registered = value;
      },
      unregisterStore: () => {
        registered = undefined;
      },
    });
    rollback.own("proxy-handler", () => {
      throw new Error("handler close failed");
    });

    await assertRejects(
      () => rollback.run(() => Promise.reject(new Error("listener failed"))),
      Error,
      "listener failed",
    );

    assertEquals(failures, [{ step: "proxy-handler", status: "failed" }]);
    assertEquals(registered, undefined);
    assertEquals(cache.closeCalls, 1);
    assertEquals(store.closeCalls, 1);
  });

  it("keeps a created-store registration when listener readiness commits", async () => {
    const store = new FakeStore();
    let registered: TokenCacheStore | undefined;
    let restorationCalls = 0;
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    const startupCache = await acquireProxyStartupCache(rollback, {
      acquireExtensionStore: () => {
        registered = store;
        return Promise.resolve(Object.freeze({ kind: "created", store }));
      },
      createCache: cacheFactory([]),
      resolveRegisteredStore: () => registered,
      registerStore: (value) => {
        registered = value;
        restorationCalls++;
      },
      unregisterStore: () => {
        registered = undefined;
        restorationCalls++;
      },
    });
    rollback.own("proxy-handler", async () => {
      await startupCache.cache.close();
      startupCache.transferToHandler();
    });

    assertEquals(rollback.commit(), true);
    assertStrictEquals(registered, store);
    assertEquals(restorationCalls, 0);
    assertEquals(store.closeCalls, 0);
  });

  it("never closes or unregisters a borrowed store", async () => {
    const events: string[] = [];
    const borrowed = new FakeStore();
    let registered: TokenCacheStore | undefined = borrowed;
    let restoreCalls = 0;
    let received: CacheFromEnvOptions | undefined;
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    const startupCache = await acquireProxyStartupCache(rollback, {
      acquireExtensionStore: () =>
        Promise.resolve(Object.freeze({
          kind: "borrowed",
          store: borrowed,
        })),
      createCache: cacheFactory(events, (options) => {
        received = options;
      }),
      resolveRegisteredStore: () => registered,
      registerStore: (value) => {
        registered = value;
        restoreCalls++;
      },
      unregisterStore: () => {
        registered = undefined;
        restoreCalls++;
      },
    });
    rollback.own("proxy-handler", async () => {
      await startupCache.cache.close();
      startupCache.transferToHandler();
    });

    await assertRejects(
      () => rollback.run(() => Promise.reject(new Error("listener failed"))),
      Error,
      "listener failed",
    );

    assertStrictEquals(received?.extensionStore?.store, borrowed);
    assertEquals(received?.extensionStore?.kind, "borrowed");
    assertEquals(events, ["cache"]);
    assertEquals(borrowed.closeCalls, 0);
    assertStrictEquals(registered, borrowed);
    assertEquals(restoreCalls, 0);
  });
});
