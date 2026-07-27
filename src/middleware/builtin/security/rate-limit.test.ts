import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { MiddlewareContext } from "../../core/context.ts";
import { authRateLimit, MemoryRateLimitStore, rateLimit } from "./rate-limit.ts";

(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

describe("MemoryRateLimitStore", () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    store = new MemoryRateLimitStore(60000);
  });

  afterEach(() => {
    store.destroy();
  });

  describe("increment", () => {
    it("should increment count for new key", async () => {
      const entry = await store.increment("test-key", 60000);

      assertEquals(entry.count, 1);
      assertExists(entry.resetAt);
    });

    it("should increment existing key", async () => {
      await store.increment("test-key", 60000);
      const entry = await store.increment("test-key", 60000);

      assertEquals(entry.count, 2);
    });

    it("should track separate keys independently", async () => {
      await store.increment("key1", 60000);
      await store.increment("key1", 60000);
      const entry2 = await store.increment("key2", 60000);

      assertEquals(entry2.count, 1);
    });

    it("should reset expired entries", async () => {
      const shortWindow = scaleMs(50);
      const entry1 = await store.increment("test-key", shortWindow);
      assertEquals(entry1.count, 1);

      await delay(120);

      const entry2 = await store.increment("test-key", shortWindow);
      assertEquals(entry2.count, 1);
    });
  });

  describe("reset", () => {
    it("should delete key from store", async () => {
      await store.increment("test-key", 60000);
      await store.reset("test-key");

      const entry = await store.increment("test-key", 60000);
      assertEquals(entry.count, 1);
    });

    it("should handle non-existent key", async () => {
      await store.reset("non-existent");
    });
  });

  it("should reject new identities at capacity without evicting active limits", async () => {
    const boundedStore = new MemoryRateLimitStore(60000, { maxEntries: 1 });

    try {
      await boundedStore.increment("existing", 60000);

      await assertRejects(
        () => boundedStore.increment("overflow", 60000),
        RangeError,
        "capacity",
      );

      const existing = await boundedStore.increment("existing", 60000);
      assertEquals(existing.count, 2);
    } finally {
      boundedStore.destroy();
    }
  });

  it("should release retained entries when destroyed", async () => {
    const boundedStore = new MemoryRateLimitStore(60000, { maxEntries: 1 });
    await boundedStore.increment("first", 60000);

    boundedStore.destroy();

    const replacement = await boundedStore.increment("second", 60000);
    assertEquals(replacement.count, 1);
    boundedStore.destroy();
  });

  it("should honor the host cleanup-disable flag", () => {
    const globals = globalThis as Record<string, unknown>;
    const previousGlobalFlag = globals.__vfDisableLruInterval;
    const previousHostFlag = getHostEnv("VF_DISABLE_LRU_INTERVAL");
    globals.__vfDisableLruInterval = false;
    setEnv("VF_DISABLE_LRU_INTERVAL", "1");

    const disabledStore = new MemoryRateLimitStore(60000);
    try {
      const internals = disabledStore as unknown as {
        cleanupInterval?: ReturnType<typeof setInterval>;
      };
      assertEquals(internals.cleanupInterval, undefined);
    } finally {
      disabledStore.destroy();
      if (previousGlobalFlag === undefined) {
        delete globals.__vfDisableLruInterval;
      } else {
        globals.__vfDisableLruInterval = previousGlobalFlag;
      }
      if (previousHostFlag === undefined) {
        deleteEnv("VF_DISABLE_LRU_INTERVAL");
      } else {
        setEnv("VF_DISABLE_LRU_INTERVAL", previousHostFlag);
      }
    }
  });

  it("should reject invalid capacity and window configuration", () => {
    for (const maxEntries of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new MemoryRateLimitStore(60000, { maxEntries }),
        RangeError,
      );
    }

    for (const windowMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(() => new MemoryRateLimitStore(windowMs), RangeError);
    }
  });
});

describe("rateLimit middleware", () => {
  function createContext(ip: string = "127.0.0.1", path: string = "/"): MiddlewareContext {
    return new MiddlewareContext(
      new Request(`https://example.com${path}`, {
        headers: { "x-forwarded-for": ip },
      }),
    );
  }

  it("should allow requests under limit", async () => {
    const middleware = rateLimit({ maxRequests: 5, windowMs: 60000 });
    const ctx = createContext();
    let nextCalled = false;

    const response = await middleware(ctx, () => {
      nextCalled = true;
      return Promise.resolve(new Response("OK"));
    });

    assertEquals(nextCalled, true);
    assertEquals(await response?.text(), "OK");
  });

  it("should block requests over limit", async () => {
    const middleware = rateLimit({ maxRequests: 2, windowMs: 60000 });

    for (let i = 0; i < 2; i++) {
      await middleware(createContext("same-ip"), () => Promise.resolve(new Response("OK")));
    }

    const response = await middleware(
      createContext("same-ip"),
      () => Promise.resolve(new Response("OK")),
    );

    assertEquals(response?.status, 429);
    assertExists(response?.headers.get("Retry-After"));
  });

  it("should accept numeric arguments (legacy API)", async () => {
    const middleware = rateLimit(3, 60000);
    const response = await middleware(createContext(), () => Promise.resolve(new Response("OK")));

    assertEquals(response?.status, 200);
  });

  it("should use default values when no options provided", async () => {
    const middleware = rateLimit();
    const response = await middleware(createContext(), () => Promise.resolve(new Response("OK")));

    assertEquals(response?.status, 200);
  });

  it("should validate numeric configuration before creating middleware", () => {
    for (const maxRequests of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => rateLimit({ maxRequests }),
        RangeError,
      );
    }

    for (const windowMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => rateLimit({ windowMs }),
        RangeError,
      );
    }
  });

  it("should fail closed when the rate-limit store is unavailable", async () => {
    let nextCalled = false;
    const middleware = rateLimit({
      store: {
        increment: () => Promise.reject(new Error("backend unavailable")),
        reset: () => Promise.resolve(),
      },
    });

    const response = await middleware(createContext(), () => {
      nextCalled = true;
      return Promise.resolve(new Response("OK"));
    });

    assertEquals(response?.status, 503);
    assertEquals(response?.headers.get("Retry-After"), "60");
    assertEquals(response?.headers.get("Cache-Control"), "no-store");
    assertEquals(nextCalled, false);
  });

  it("should throttle repeated rate-limit store failure logs", async () => {
    const originalConsoleError = console.error;
    let loggedFailures = 0;
    console.error = () => {
      loggedFailures++;
    };

    try {
      const middleware = rateLimit({
        store: {
          increment: () => Promise.reject(new Error("backend unavailable")),
          reset: () => Promise.resolve(),
        },
      });

      const first = await middleware(
        createContext(),
        () => Promise.resolve(new Response("OK")),
      );
      const second = await middleware(
        createContext(),
        () => Promise.resolve(new Response("OK")),
      );

      assertEquals(first?.status, 503);
      assertEquals(second?.status, 503);
      assertEquals(loggedFailures, 1);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("should fail closed when a store returns an invalid counter", async () => {
    const middleware = rateLimit({
      store: {
        increment: () => Promise.resolve({ count: Number.NaN, resetAt: Date.now() + 1000 }),
        reset: () => Promise.resolve(),
      },
    });

    const response = await middleware(
      createContext(),
      () => Promise.resolve(new Response("OK")),
    );

    assertEquals(response?.status, 503);
  });

  it("should reject oversized custom keys before calling the store", async () => {
    let incrementCalled = false;
    const middleware = rateLimit({
      keyGenerator: () => "x".repeat(1025),
      store: {
        increment: () => {
          incrementCalled = true;
          return Promise.resolve({ count: 1, resetAt: Date.now() + 1000 });
        },
        reset: () => Promise.resolve(),
      },
    });

    await assertRejects(
      async () => {
        await middleware(
          createContext(),
          () => Promise.resolve(new Response("OK")),
        );
      },
      RangeError,
      "1024",
    );
    assertEquals(incrementCalled, false);
  });

  it("should use custom key generator", async () => {
    let capturedKey = "";
    const middleware = rateLimit({
      maxRequests: 10,
      windowMs: 60000,
      keyGenerator: (req) => {
        capturedKey = req.headers.get("x-api-key") ?? "anonymous";
        return capturedKey;
      },
    });

    const ctx = new MiddlewareContext(
      new Request("https://example.com/", {
        headers: { "x-api-key": "my-api-key" },
      }),
    );

    await middleware(ctx, () => Promise.resolve(new Response("OK")));

    assertEquals(capturedKey, "my-api-key");
  });

  it("should track different IPs separately when proxy is trusted", async () => {
    const middleware = rateLimit({ maxRequests: 1, windowMs: 60000, trustProxy: true });

    await middleware(createContext("ip-1"), () => Promise.resolve(new Response("OK")));

    const response1 = await middleware(
      createContext("ip-1"),
      () => Promise.resolve(new Response("OK")),
    );
    assertEquals(response1?.status, 429);

    const response2 = await middleware(
      createContext("ip-2"),
      () => Promise.resolve(new Response("OK")),
    );
    assertEquals(response2?.status, 200);
  });

  it("ignores X-Forwarded-For by default so it cannot be used to bypass limits", async () => {
    // Untrusted default: forwarded IPs are not honoured, so rotating
    // X-Forwarded-For does NOT mint a fresh bucket. Both requests share the
    // stable fallback key and the second is blocked.
    const middleware = rateLimit({ maxRequests: 1, windowMs: 60000 });

    await middleware(createContext("ip-1"), () => Promise.resolve(new Response("OK")));

    const response = await middleware(
      createContext("ip-2"),
      () => Promise.resolve(new Response("OK")),
    );
    assertEquals(response?.status, 429);
  });

  it("should use the rightmost forwarded IP from a proxy chain when trusted", async () => {
    const middleware = rateLimit({ maxRequests: 1, windowMs: 60000, trustProxy: true });

    await middleware(
      createContext("198.51.100.1, 203.0.113.8"),
      () => Promise.resolve(new Response("OK")),
    );

    const response = await middleware(
      createContext("192.0.2.5, 203.0.113.8"),
      () => Promise.resolve(new Response("OK")),
    );

    assertEquals(response?.status, 429);
  });

  it("should keep store-only auth preset callers working", async () => {
    const store = new MemoryRateLimitStore(60000);
    const middleware = authRateLimit(store);

    try {
      const response = await middleware(
        createContext(),
        () => Promise.resolve(new Response("OK")),
      );
      assertEquals(response?.status, 200);
    } finally {
      store.destroy();
    }
  });

  it("should separate trusted proxy clients in the auth preset", async () => {
    const middleware = authRateLimit({ trustProxy: true });

    for (let i = 0; i < 5; i++) {
      const response = await middleware(
        createContext("198.51.100.1"),
        () => Promise.resolve(new Response("OK")),
      );
      assertEquals(response?.status, 200);
    }

    const blocked = await middleware(
      createContext("198.51.100.1"),
      () => Promise.resolve(new Response("OK")),
    );
    assertEquals(blocked?.status, 429);

    const secondClient = await middleware(
      createContext("203.0.113.8"),
      () => Promise.resolve(new Response("OK")),
    );
    assertEquals(secondClient?.status, 200);
  });

  it("should keep auth preset proxy headers untrusted by default", async () => {
    const middleware = authRateLimit();

    for (let i = 0; i < 5; i++) {
      const response = await middleware(
        createContext(`198.51.100.${i + 1}`),
        () => Promise.resolve(new Response("OK")),
      );
      assertEquals(response?.status, 200);
    }

    const rotatedHeader = await middleware(
      createContext("203.0.113.8"),
      () => Promise.resolve(new Response("OK")),
    );
    assertEquals(rotatedHeader?.status, 429);
  });

  it("should let the auth preset use a custom client key generator", async () => {
    const middleware = authRateLimit({
      keyGenerator: (request) => request.headers.get("x-api-key") ?? "anonymous",
    });
    const createApiKeyContext = (apiKey: string) =>
      new MiddlewareContext(
        new Request("https://example.com/", { headers: { "x-api-key": apiKey } }),
      );

    for (let i = 0; i < 5; i++) {
      const response = await middleware(
        createApiKeyContext("client-a"),
        () => Promise.resolve(new Response("OK")),
      );
      assertEquals(response?.status, 200);
    }

    const blocked = await middleware(
      createApiKeyContext("client-a"),
      () => Promise.resolve(new Response("OK")),
    );
    assertEquals(blocked?.status, 429);

    const secondClient = await middleware(
      createApiKeyContext("client-b"),
      () => Promise.resolve(new Response("OK")),
    );
    assertEquals(secondClient?.status, 200);
  });
});
