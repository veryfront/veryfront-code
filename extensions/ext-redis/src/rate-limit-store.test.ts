import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isVeryfrontError, TIMEOUT_ERROR } from "veryfront/errors";
import { MAX_RATE_LIMIT_KEY_LENGTH } from "veryfront/extensions/distributed/rate-limit-support";
import { ClientClosedError } from "redis";
import { type RedisRateLimitOptions, RedisRateLimitStore } from "./index.ts";

async function outcomeWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<"resolved" | "rejected" | "pending"> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<"pending">((resolve) => {
    timeoutId = setTimeout(() => resolve("pending"), timeoutMs);
  });

  try {
    return await Promise.race([
      promise.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      guard,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function createMockRedisClient(): {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  eval: (
    script: string,
    options: { keys: string[]; arguments: string[] },
  ) => Promise<[number, number]>;
  incr: (key: string) => Promise<number>;
  pExpire: (key: string, ms: number) => Promise<boolean>;
  pTTL: (key: string) => Promise<number>;
  del: (key: string) => Promise<number>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  _emit: (event: string, ...args: unknown[]) => void;
  _evalCalls: number;
  _incrCalls: number;
  _pExpireCalls: number;
  _connectCalls: number;
  _disconnectCalls: number;
  _store: Map<string, { count: number; ttl: number }>;
} {
  const store = new Map<string, { count: number; ttl: number }>();
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  let evalCalls = 0;
  let incrCalls = 0;
  let pExpireCalls = 0;
  let connectCalls = 0;
  let disconnectCalls = 0;

  return {
    connect: () => {
      connectCalls += 1;
      return Promise.resolve();
    },
    disconnect: () => {
      disconnectCalls += 1;
      return Promise.resolve();
    },
    eval: (_script: string, options: { keys: string[]; arguments: string[] }) => {
      evalCalls += 1;
      const key = options.keys[0];
      if (!key) throw new Error("Expected eval key");
      const windowMs = Number(options.arguments[0]);
      const entry = store.get(key) ?? { count: 0, ttl: -1 };
      entry.count += 1;
      if (entry.ttl < 0) entry.ttl = windowMs;
      store.set(key, entry);
      return Promise.resolve([entry.count, entry.ttl]);
    },
    incr: (key: string) => {
      incrCalls += 1;
      const entry = store.get(key) ?? { count: 0, ttl: -1 };
      entry.count += 1;
      store.set(key, entry);
      return Promise.resolve(entry.count);
    },
    pExpire: (key: string, ms: number) => {
      pExpireCalls += 1;
      const entry = store.get(key);
      if (entry) entry.ttl = ms;
      return Promise.resolve(true);
    },
    pTTL: (key: string) => {
      const entry = store.get(key);
      return Promise.resolve(entry?.ttl ?? -2);
    },
    del: (key: string) => {
      const deleted = store.has(key) ? 1 : 0;
      store.delete(key);
      return Promise.resolve(deleted);
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
    },
    _emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    get _evalCalls() {
      return evalCalls;
    },
    get _incrCalls() {
      return incrCalls;
    },
    get _pExpireCalls() {
      return pExpireCalls;
    },
    get _connectCalls() {
      return connectCalls;
    },
    get _disconnectCalls() {
      return disconnectCalls;
    },
    _store: store,
  };
}

function createStoreWithMock(
  options?: RedisRateLimitOptions,
): {
  rateStore: RedisRateLimitStore;
  mockClient: ReturnType<typeof createMockRedisClient>;
} {
  const rateStore = new RedisRateLimitStore(options);
  const mockClient = createMockRedisClient();

  // deno-lint-ignore no-explicit-any
  (rateStore as any).client = mockClient;

  return { rateStore, mockClient };
}

async function withTimeoutUnrefProbe<T>(run: () => Promise<T>): Promise<{
  result: T;
  unrefCalls: number;
}> {
  const runtime = globalThis as unknown as {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };
  const originalSetTimeout = runtime.setTimeout;
  const originalClearTimeout = runtime.clearTimeout;
  let unrefCalls = 0;

  runtime.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const inner = originalSetTimeout(handler, timeout, ...args);
    return {
      inner,
      unref() {
        unrefCalls++;
      },
    } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  runtime.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
    const inner = (id as unknown as { inner?: ReturnType<typeof setTimeout> } | undefined)
      ?.inner;
    originalClearTimeout(inner ?? id);
  }) as typeof clearTimeout;

  try {
    return { result: await run(), unrefCalls };
  } finally {
    runtime.setTimeout = originalSetTimeout;
    runtime.clearTimeout = originalClearTimeout;
  }
}

async function withTimeoutRefGuard<T>(run: () => Promise<T>): Promise<T> {
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    return await run();
  } finally {
    clearInterval(keepAlive);
  }
}

function assert_reset_at_is_future(resetAt: number): void {
  assertEquals(resetAt > Date.now() - 1000, true);
}

describe("middleware/builtin/security/redis-rate-limit", () => {
  describe("RedisRateLimitStore", () => {
    describe("constructor", () => {
      it("should use default key prefix", () => {
        const store = new RedisRateLimitStore();
        // deno-lint-ignore no-explicit-any
        assertEquals((store as any).keyPrefix, "veryfront:ratelimit:");
      });

      it("should accept custom key prefix", () => {
        const store = new RedisRateLimitStore({ keyPrefix: "custom:" });
        // deno-lint-ignore no-explicit-any
        assertEquals((store as any).keyPrefix, "custom:");
      });

      it("should reject invalid options before connecting", () => {
        assertThrows(
          () =>
            new RedisRateLimitStore({
              keyPrefix: "x".repeat(MAX_RATE_LIMIT_KEY_LENGTH + 1),
            }),
          RangeError,
          "1024",
        );
        assertThrows(
          () => new RedisRateLimitStore({ url: 42 as never }),
          TypeError,
          "url",
        );
        for (const timeout of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
          assertThrows(
            () => new RedisRateLimitStore({ connectTimeoutMs: timeout }),
            RangeError,
            "connectTimeoutMs",
          );
          assertThrows(
            () => new RedisRateLimitStore({ operationTimeoutMs: timeout }),
            RangeError,
            "operationTimeoutMs",
          );
        }
      });
    });

    describe("increment", () => {
      it("should increment count for a new key", async () => {
        const { rateStore } = createStoreWithMock();
        const entry = await rateStore.increment("test-key", 60000);
        assertEquals(entry.count, 1);
        assert_reset_at_is_future(entry.resetAt);
      });

      it("should set expiry on first increment", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        await rateStore.increment("key1", 60000);
        const storedEntry = mockClient._store.get("veryfront:ratelimit:key1");
        assertEquals(storedEntry?.ttl, 60000);
      });

      it("should increment and set missing TTL in one Redis eval", async () => {
        const { rateStore, mockClient } = createStoreWithMock();

        const entry = await rateStore.increment("key1", 60000);

        assertEquals(entry.count, 1);
        assertEquals(mockClient._evalCalls, 1);
        assertEquals(mockClient._incrCalls, 0);
        assertEquals(mockClient._pExpireCalls, 0);
      });

      it("should increment count for existing key", async () => {
        const { rateStore } = createStoreWithMock();
        await rateStore.increment("key1", 60000);
        const entry = await rateStore.increment("key1", 60000);
        assertEquals(entry.count, 2);
      });

      it("should use custom key prefix", async () => {
        const { rateStore, mockClient } = createStoreWithMock({ keyPrefix: "app:" });
        await rateStore.increment("user-1", 30000);
        assertEquals(mockClient._store.has("app:user-1"), true);
      });

      it("should handle pTTL returning -1 by re-setting expiry", async () => {
        const { rateStore, mockClient } = createStoreWithMock();

        await rateStore.increment("key1", 60000);

        const stored = mockClient._store.get("veryfront:ratelimit:key1");
        if (!stored) throw new Error("Expected key to exist in mock store");
        stored.ttl = -1;

        const result = await rateStore.increment("key1", 60000);
        assertEquals(result.count, 2);

        const updated = mockClient._store.get("veryfront:ratelimit:key1");
        if (!updated) throw new Error("Expected key to exist in mock store");
        assertEquals(updated.ttl, 60000);
      });

      it("should return resetAt based on pTTL", async () => {
        const { rateStore } = createStoreWithMock();
        const before = Date.now();
        const entry = await rateStore.increment("key1", 60000);
        const diff = entry.resetAt - before;
        assertEquals(diff >= 59000 && diff <= 61000, true);
      });

      it("should reject invalid keys and windows before Redis evaluation", async () => {
        const { rateStore, mockClient } = createStoreWithMock();

        await assertRejects(
          () => rateStore.increment("x".repeat(MAX_RATE_LIMIT_KEY_LENGTH + 1), 1000),
          RangeError,
          "1024",
        );
        for (const invalidKey of ["", " \t ", "tenant\u0000member", "tenant\u0085member"]) {
          await assertRejects(
            () => rateStore.increment(invalidKey, 1000),
            TypeError,
            "visible text without control characters",
          );
        }
        await assertRejects(
          () => rateStore.increment("key", 0),
          RangeError,
          "windowMs",
        );
        assertEquals(mockClient._evalCalls, 0);
      });

      it("should reject unsafe Redis counter results", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        mockClient.eval = () => Promise.resolve([Number.MAX_SAFE_INTEGER + 1, 1000]);

        await assertRejects(
          () => rateStore.increment("key", 1000),
          Error,
          "invalid count",
        );
      });

      it("should bound commands and retire a client that stops responding", async () => {
        const { rateStore, mockClient } = createStoreWithMock({
          operationTimeoutMs: 1,
        });
        mockClient.eval = () => new Promise<never>(() => {});

        const error = await withTimeoutRefGuard(() =>
          assertRejects(
            () => rateStore.increment("key", 1000),
            Error,
            "timed out",
          )
        );

        assertEquals(isVeryfrontError(error), true);
        assertEquals(isVeryfrontError(error) ? error.slug : undefined, TIMEOUT_ERROR.slug);
        assertEquals(mockClient._disconnectCalls, 1);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
      });

      it("unrefs the operation timeout so it does not hold the process open", async () => {
        const { rateStore, mockClient } = createStoreWithMock({
          operationTimeoutMs: 1,
        });
        mockClient.eval = () => new Promise<never>(() => {});

        const { result: error, unrefCalls } = await withTimeoutUnrefProbe(() =>
          assertRejects(
            () => rateStore.increment("key", 1000),
            Error,
            "timed out",
          )
        );

        assertEquals(isVeryfrontError(error), true);
        assertEquals(unrefCalls, 1);
      });

      it("does not retire a client for an unrelated TimeoutError name", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        mockClient.eval = () => {
          const error = new Error("foreign timeout");
          error.name = "TimeoutError";
          return Promise.reject(error);
        };

        const error = await assertRejects(
          () => rateStore.increment("key", 1000),
          Error,
          "foreign timeout",
        );

        if (!(error instanceof Error)) throw new Error("Expected Redis client error");
        assertEquals(error.name, "TimeoutError");
        assertEquals(mockClient._disconnectCalls, 0);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, mockClient);
      });
    });

    describe("reset", () => {
      it("should delete the key from the store", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        await rateStore.increment("key1", 60000);
        assertEquals(mockClient._store.has("veryfront:ratelimit:key1"), true);

        await rateStore.reset("key1");
        assertEquals(mockClient._store.has("veryfront:ratelimit:key1"), false);
      });

      it("should not throw when resetting non-existent key", async () => {
        const { rateStore } = createStoreWithMock();
        await rateStore.reset("nonexistent");
      });

      it("should reject an invalid key before loading or connecting Redis", async () => {
        const rateStore = new RedisRateLimitStore();
        let factoryLoads = 0;
        // deno-lint-ignore no-explicit-any
        (rateStore as any).loadClientFactory = () => {
          factoryLoads++;
          return Promise.resolve(() => createMockRedisClient());
        };

        await assertRejects(
          () => rateStore.reset("x".repeat(MAX_RATE_LIMIT_KEY_LENGTH + 1)),
          RangeError,
          "1024",
        );
        assertEquals(factoryLoads, 0);
      });
    });

    describe("destroy", () => {
      it("should disconnect the client", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        await rateStore.destroy();
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
        assertEquals(mockClient._disconnectCalls, 1);
      });

      it("should be safe to call when no client exists", async () => {
        const store = new RedisRateLimitStore();
        await store.destroy();
      });

      it("should be safe to call multiple times", async () => {
        const { rateStore } = createStoreWithMock();
        await rateStore.destroy();
        await rateStore.destroy();
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
      });

      it("should treat already-closed clients as destroyed", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        let disconnectAttempts = 0;
        mockClient.disconnect = () => {
          disconnectAttempts++;
          return Promise.reject(new ClientClosedError());
        };

        await rateStore.destroy();
        await rateStore.destroy();

        assertEquals(disconnectAttempts, 1);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
      });

      it("should retain a failed disconnect so shutdown can retry it", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        let disconnectAttempts = 0;
        mockClient.disconnect = () => {
          disconnectAttempts++;
          return disconnectAttempts === 1
            ? Promise.reject(new Error("disconnect unavailable"))
            : Promise.resolve();
        };

        await assertRejects(
          () => rateStore.destroy(),
          Error,
          "disconnect unavailable",
        );
        await rateStore.destroy();

        assertEquals(disconnectAttempts, 2);
      });
    });

    describe("reset", () => {
      it("should reject invalid keys before connecting", async () => {
        const rateStore = new RedisRateLimitStore();
        const mockClient = createMockRedisClient();

        // deno-lint-ignore no-explicit-any
        (rateStore as any).loadClientFactory = () => Promise.resolve(() => mockClient);

        await assertRejects(
          () => rateStore.reset("x".repeat(MAX_RATE_LIMIT_KEY_LENGTH + 1)),
          RangeError,
          "1024",
        );

        assertEquals(mockClient._connectCalls, 0);
      });
    });

    describe("ensureClient", () => {
      it("should reuse existing client", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        await rateStore.increment("a", 1000);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, mockClient);
      });

      it("should clear cached clients when redis emits error or end", () => {
        const { rateStore, mockClient } = createStoreWithMock();

        // deno-lint-ignore no-explicit-any
        (rateStore as any).attachClientLifecycleHandlers(mockClient);
        // deno-lint-ignore no-explicit-any
        (rateStore as any).clientPromise = Promise.resolve(mockClient);

        mockClient._emit("error", new Error("network partition"));
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).clientPromise, null);
        assertEquals(mockClient._disconnectCalls, 1);

        // deno-lint-ignore no-explicit-any
        (rateStore as any).client = mockClient;
        // deno-lint-ignore no-explicit-any
        (rateStore as any).clientPromise = Promise.resolve(mockClient);
        // deno-lint-ignore no-explicit-any
        (rateStore as any).attachClientLifecycleHandlers(mockClient);

        mockClient._emit("end");
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).clientPromise, null);
      });

      it("should share one pending connection across concurrent operations", async () => {
        const rateStore = new RedisRateLimitStore();
        const mockClient = createMockRedisClient();
        let factoryCalls = 0;

        // deno-lint-ignore no-explicit-any
        (rateStore as any).loadClientFactory = () =>
          Promise.resolve(() => {
            factoryCalls++;
            return mockClient;
          });

        await Promise.all([
          rateStore.increment("a", 1000),
          rateStore.increment("b", 1000),
        ]);

        assertEquals(factoryCalls, 1);
        assertEquals(mockClient._connectCalls, 1);
        assertEquals(mockClient._evalCalls, 2);
      });

      it("should configure a bounded non-reconnecting client connection", async () => {
        const rateStore = new RedisRateLimitStore({ connectTimeoutMs: 1_250 });
        const mockClient = createMockRedisClient();
        let factoryOptions: {
          url?: string;
          socket?: {
            connectTimeout?: number;
            reconnectStrategy?: false;
          };
        } | undefined;

        // deno-lint-ignore no-explicit-any
        (rateStore as any).loadClientFactory = () =>
          Promise.resolve((options: typeof factoryOptions) => {
            factoryOptions = options;
            return mockClient;
          });

        await rateStore.increment("bounded", 1000);

        assertEquals(factoryOptions?.socket?.connectTimeout, 1_250);
        assertEquals(factoryOptions?.socket?.reconnectStrategy, false);
      });

      it("should disconnect a connection that finishes after destroy", async () => {
        const rateStore = new RedisRateLimitStore();
        const mockClient = createMockRedisClient();
        let connectStarted = false;
        let resolveConnect!: () => void;
        mockClient.connect = () => {
          connectStarted = true;
          return new Promise<void>((resolve) => {
            resolveConnect = resolve;
          });
        };

        // deno-lint-ignore no-explicit-any
        (rateStore as any).loadClientFactory = () => Promise.resolve(() => mockClient);

        const incrementPromise = rateStore.increment("pending", 1000);
        for (let attempt = 0; attempt < 10 && !connectStarted; attempt++) {
          await Promise.resolve();
        }
        assertEquals(connectStarted, true);

        const destroyPromise = rateStore.destroy();
        resolveConnect();

        await assertRejects(
          () => incrementPromise,
          Error,
          "superseded",
        );
        await destroyPromise;

        assertEquals(mockClient._disconnectCalls, 1);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).clientPromise, null);
      });

      it("should reconnect after destroy without stale events clearing the replacement", async () => {
        const rateStore = new RedisRateLimitStore();
        const firstClient = createMockRedisClient();
        const secondClient = createMockRedisClient();
        const clients = [firstClient, secondClient];
        let factoryCalls = 0;

        // deno-lint-ignore no-explicit-any
        (rateStore as any).loadClientFactory = () =>
          Promise.resolve(() => {
            const client = clients[factoryCalls++];
            if (!client) throw new Error("Unexpected Redis client factory call");
            return client;
          });

        await rateStore.increment("first", 1000);
        await rateStore.destroy();
        await rateStore.increment("second", 1000);

        firstClient._emit("end");

        assertEquals(factoryCalls, 2);
        assertEquals(firstClient._disconnectCalls, 1);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, secondClient);
      });

      it("should keep one pending client through transient connection errors", async () => {
        const rateStore = new RedisRateLimitStore();
        const mockClient = createMockRedisClient();
        let factoryCalls = 0;
        let resolveConnect!: () => void;
        mockClient.connect = () =>
          new Promise<void>((resolve) => {
            resolveConnect = resolve;
          });

        // deno-lint-ignore no-explicit-any
        (rateStore as any).loadClientFactory = () =>
          Promise.resolve(() => {
            factoryCalls++;
            return mockClient;
          });

        const first = rateStore.increment("first", 1000);
        for (let attempt = 0; attempt < 10 && factoryCalls === 0; attempt++) {
          await Promise.resolve();
        }
        mockClient._emit("error", new Error("transient connect failure"));
        const second = rateStore.increment("second", 1000);
        resolveConnect();

        await Promise.all([first, second]);
        assertEquals(factoryCalls, 1);
        assertEquals(mockClient._connectCalls, 0);
        assertEquals(mockClient._evalCalls, 2);
      });

      it("should not wait indefinitely for a pending connection during destroy", async () => {
        const rateStore = new RedisRateLimitStore();
        const mockClient = createMockRedisClient();
        let connectStarted = false;
        mockClient.connect = () => {
          connectStarted = true;
          return new Promise<void>(() => {});
        };

        // deno-lint-ignore no-explicit-any
        (rateStore as any).loadClientFactory = () => Promise.resolve(() => mockClient);

        const incrementPromise = rateStore.increment("pending", 1000);
        incrementPromise.catch(() => {});
        for (let attempt = 0; attempt < 10 && !connectStarted; attempt++) {
          await Promise.resolve();
        }

        await rateStore.destroy();

        assertEquals(connectStarted, true);
        assertEquals(mockClient._disconnectCalls, 1);
        const outcome = await outcomeWithin(incrementPromise, 50);
        assertEquals(outcome, "rejected");
      });

      it("should attach pending rejection handling before destroy cancels it", async () => {
        const rateStore = new RedisRateLimitStore();
        const mockClient = createMockRedisClient();
        let connectStarted = false;
        mockClient.connect = () => {
          connectStarted = true;
          return new Promise<void>(() => {});
        };

        // deno-lint-ignore no-explicit-any
        (rateStore as any).loadClientFactory = () => Promise.resolve(() => mockClient);

        const incrementPromise = rateStore.increment("pending", 1000);
        for (let attempt = 0; attempt < 10 && !connectStarted; attempt++) {
          await Promise.resolve();
        }

        // deno-lint-ignore no-explicit-any
        const pending = (rateStore as any).clientPromise as Promise<unknown> | null;
        let cancelObserved = false;
        let catchAttachedBeforeCancel = false;
        if (pending) {
          const originalCatch = pending.catch.bind(pending);
          Object.defineProperty(pending, "catch", {
            configurable: true,
            value: (...args: Parameters<Promise<unknown>["catch"]>) => {
              if (!cancelObserved) catchAttachedBeforeCancel = true;
              return originalCatch(...args);
            },
          });
        }
        // deno-lint-ignore no-explicit-any
        const originalCancel = (rateStore as any).cancelPendingConnection as
          | (() => void)
          | null;
        // deno-lint-ignore no-explicit-any
        (rateStore as any).cancelPendingConnection = () => {
          cancelObserved = true;
          originalCancel?.();
        };

        await rateStore.destroy();

        if (!pending) throw new Error("Expected pending connection promise");
        assertEquals(catchAttachedBeforeCancel, true);
        const pendingOutcome = await outcomeWithin(pending, 50);
        await assertRejects(
          () => incrementPromise,
          Error,
          "superseded",
        );
        assertEquals(pendingOutcome, "rejected");
      });
    });
  });
});
