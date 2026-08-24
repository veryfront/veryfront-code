import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isVeryfrontError, TIMEOUT_ERROR } from "#veryfront/errors";
import { MAX_RATE_LIMIT_KEY_LENGTH } from "./rate-limit-validation.ts";
import { type RedisRateLimitOptions, RedisRateLimitStore } from "./redis-rate-limit.ts";

interface MockRedisClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  _evalCalls: number;
  _delCalls: number;
  _lastKey?: string;
  _lastWindow?: string;
}

function createMockRedisClient(
  result: unknown = [1, 60_000],
): MockRedisClient {
  let evalCalls = 0;
  let delCalls = 0;
  const client: MockRedisClient = {
    eval: (_script, options) => {
      evalCalls++;
      client._lastKey = options.keys[0];
      client._lastWindow = options.arguments[0];
      return Promise.resolve(result);
    },
    del: (key) => {
      delCalls++;
      client._lastKey = key;
      return Promise.resolve(1);
    },
    get _evalCalls() {
      return evalCalls;
    },
    get _delCalls() {
      return delCalls;
    },
  };
  return client;
}

function createStoreWithMock(
  options?: RedisRateLimitOptions,
  client = createMockRedisClient(),
  closeError?: Error,
): {
  store: RedisRateLimitStore;
  client: MockRedisClient;
  getClientCalls: () => number;
  closeCalls: () => number;
} {
  const store = new RedisRateLimitStore(options);
  let getClientCalls = 0;
  let closeCalls = 0;
  let closed = false;
  (store as unknown as {
    connection: {
      getClient(): Promise<MockRedisClient>;
      close(): Promise<void>;
    };
  }).connection = {
    getClient: () => {
      getClientCalls++;
      return Promise.resolve(client);
    },
    close: () => {
      if (!closed) {
        closeCalls++;
        closed = true;
      }
      return closeError ? Promise.reject(closeError) : Promise.resolve();
    },
  };
  return {
    store,
    client,
    getClientCalls: () => getClientCalls,
    closeCalls: () => closeCalls,
  };
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

describe("provider-backed RedisRateLimitStore", () => {
  describe("constructor", () => {
    it("uses the stable default key prefix", () => {
      const store = new RedisRateLimitStore();
      assertEquals(
        (store as unknown as { keyPrefix: string }).keyPrefix,
        "veryfront:ratelimit:",
      );
    });

    it("accepts a custom key prefix", () => {
      const store = new RedisRateLimitStore({ keyPrefix: "tenant:" });
      assertEquals(
        (store as unknown as { keyPrefix: string }).keyPrefix,
        "tenant:",
      );
    });

    it("rejects malformed options before opening a provider connection", () => {
      assertThrows(
        () => new RedisRateLimitStore(null as never),
        TypeError,
        "options",
      );
      assertThrows(
        () => new RedisRateLimitStore({ url: 42 as never }),
        TypeError,
        "url",
      );
      assertThrows(
        () => new RedisRateLimitStore({ keyPrefix: "x".repeat(MAX_RATE_LIMIT_KEY_LENGTH + 1) }),
        RangeError,
        "1024",
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
    it("preserves the Redis key and window contract", async () => {
      const { store, client } = createStoreWithMock({ keyPrefix: "custom:" });
      const entry = await store.increment("user-1", 30_000);

      assertEquals(entry.count, 1);
      assertEquals(entry.resetAt > Date.now(), true);
      assertEquals(client._lastKey, "custom:user-1");
      assertEquals(client._lastWindow, "30000");
      assertEquals(client._evalCalls, 1);
    });

    it("uses the admitted Redis TTL for resetAt", async () => {
      const before = Date.now();
      const { store } = createStoreWithMock(undefined, createMockRedisClient([2, 1_500]));
      const entry = await store.increment("user", 30_000);

      assertEquals(entry.count, 2);
      assertEquals(entry.resetAt >= before + 1_500, true);
      assertEquals(entry.resetAt <= Date.now() + 1_500, true);
    });

    it("falls back to the configured window when Redis reports no TTL", async () => {
      const before = Date.now();
      const { store } = createStoreWithMock(undefined, createMockRedisClient([1, -1]));
      const entry = await store.increment("user", 2_000);

      assertEquals(entry.resetAt >= before + 2_000, true);
      assertEquals(entry.resetAt <= Date.now() + 2_000, true);
    });

    it("validates keys and windows before opening a provider connection", async () => {
      const { store, client, getClientCalls } = createStoreWithMock();

      await assertRejects(
        () => store.increment("x".repeat(MAX_RATE_LIMIT_KEY_LENGTH + 1), 1_000),
        RangeError,
        "1024",
      );
      await assertRejects(
        () => store.increment("key", 0),
        RangeError,
        "windowMs",
      );
      assertEquals(getClientCalls(), 0);
      assertEquals(client._evalCalls, 0);
    });

    it("rejects malformed Redis eval envelopes", async () => {
      for (const result of [null, {}, [], [1]]) {
        const { store } = createStoreWithMock(undefined, createMockRedisClient(result));
        await assertRejects(
          () => store.increment("key", 1_000),
          Error,
          "invalid result",
        );
      }
    });

    it("rejects non-positive or unsafe counters", async () => {
      for (const count of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        const { store } = createStoreWithMock(
          undefined,
          createMockRedisClient([count, 1_000]),
        );
        await assertRejects(
          () => store.increment("key", 1_000),
          Error,
          "invalid count",
        );
      }
    });

    it("rejects unsafe TTL values", async () => {
      for (const ttl of [1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        const { store } = createStoreWithMock(
          undefined,
          createMockRedisClient([1, ttl]),
        );
        await assertRejects(
          () => store.increment("key", 1_000),
          Error,
          "invalid TTL",
        );
      }
    });

    it("bounds commands and retires a provider connection after timeout", async () => {
      const client = createMockRedisClient();
      client.eval = () => new Promise<never>(() => {});
      const { store, closeCalls } = createStoreWithMock(
        { operationTimeoutMs: 1 },
        client,
      );

      const error = await withTimeoutRefGuard(() =>
        assertRejects(
          () => store.increment("key", 1_000),
          Error,
          "timed out",
        )
      );
      assertEquals(isVeryfrontError(error), true);
      assertEquals(isVeryfrontError(error) ? error.slug : undefined, TIMEOUT_ERROR.slug);
      assertEquals(closeCalls(), 1);
    });

    it("swallows a close failure while retiring a timed-out connection", async () => {
      const client = createMockRedisClient();
      client.eval = () => new Promise<never>(() => {});
      const { store, closeCalls } = createStoreWithMock(
        { operationTimeoutMs: 1 },
        client,
        new Error("close failed"),
      );

      const error = await withTimeoutRefGuard(() =>
        assertRejects(
          () => store.increment("key", 1_000),
          Error,
          "timed out",
        )
      );

      assertEquals(
        isVeryfrontError(error) ? error.slug : undefined,
        TIMEOUT_ERROR.slug,
        "a bounded operation must still reject with the timeout error",
      );
      assertEquals(
        closeCalls(),
        1,
        "the timed-out connection must still be retired once",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it("unrefs the operation timeout so it does not hold the process open", async () => {
      const client = createMockRedisClient();
      client.eval = () => new Promise<never>(() => {});
      const { store } = createStoreWithMock({ operationTimeoutMs: 1 }, client);

      const { result: error, unrefCalls } = await withTimeoutUnrefProbe(() =>
        assertRejects(
          () => store.increment("key", 1_000),
          Error,
          "timed out",
        )
      );

      assertEquals(isVeryfrontError(error), true);
      assertEquals(unrefCalls, 1);
    });

    it("does not retire a provider connection for an unrelated TimeoutError name", async () => {
      const client = createMockRedisClient();
      client.eval = () => {
        const error = new Error("foreign timeout");
        error.name = "TimeoutError";
        return Promise.reject(error);
      };
      const { store, closeCalls } = createStoreWithMock(undefined, client);

      const error = await assertRejects(
        () => store.increment("key", 1_000),
        Error,
        "foreign timeout",
      );

      if (!(error instanceof Error)) throw new Error("Expected Redis client error");
      assertEquals(error.name, "TimeoutError");
      assertEquals(closeCalls(), 0);
    });
  });

  describe("reset", () => {
    it("deletes the prefixed key", async () => {
      const { store, client } = createStoreWithMock({ keyPrefix: "custom:" });
      await store.reset("user-1");

      assertEquals(client._lastKey, "custom:user-1");
      assertEquals(client._delCalls, 1);
    });

    it("validates the key before opening a provider connection", async () => {
      const { store, client, getClientCalls } = createStoreWithMock();
      await assertRejects(
        () => store.reset("tenant\u0000member"),
        TypeError,
        "control characters",
      );
      assertEquals(getClientCalls(), 0);
      assertEquals(client._delCalls, 0);
    });

    it("bounds delete commands and retires the connection after timeout", async () => {
      const client = createMockRedisClient();
      client.del = () => new Promise<never>(() => {});
      const { store, closeCalls } = createStoreWithMock(
        { operationTimeoutMs: 1 },
        client,
      );

      await withTimeoutRefGuard(() =>
        assertRejects(
          () => store.reset("key"),
          Error,
          "timed out",
        )
      );
      assertEquals(closeCalls(), 1);
    });
  });

  describe("destroy", () => {
    it("closes its provider-owned connection", async () => {
      const { store, closeCalls } = createStoreWithMock();
      await store.destroy();
      assertEquals(closeCalls(), 1);
    });

    it("is idempotent at the store boundary", async () => {
      const { store, closeCalls } = createStoreWithMock();
      await store.destroy();
      await store.destroy();
      assertEquals(closeCalls(), 1);
    });
  });
});
