import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";
import { MiddlewareContext } from "../../core/context.ts";
import { authRateLimit, MemoryRateLimitStore, rateLimit } from "./rate-limit.ts";

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

    it("does not expose mutable internal entries", async () => {
      const first = await store.increment("test-key", 60000);
      first.count = 10_000;
      first.resetAt = 0;

      const second = await store.increment("test-key", 60000);

      assertEquals(second.count, 2);
      assertEquals(second.resetAt > Date.now(), true);
    });

    it("keeps far-future reset timestamps within the safe integer range", async () => {
      const entry = await store.increment("long-window", Number.MAX_SAFE_INTEGER);

      assertEquals(entry.resetAt, Number.MAX_SAFE_INTEGER);
    });

    it("uses a bounded overflow bucket for excess client keys", async () => {
      const boundedStore = new MemoryRateLimitStore(60000, 2);
      try {
        await boundedStore.increment("one", 60000);
        await boundedStore.increment("two", 60000);
        const firstOverflow = await boundedStore.increment("three", 60000);
        const secondOverflow = await boundedStore.increment("four", 60000);

        assertEquals(firstOverflow.count, 1);
        assertEquals(secondOverflow.count, 2);
      } finally {
        boundedStore.destroy();
      }
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

  it("rejects invalid limits and windows", () => {
    for (
      const options of [
        { maxRequests: 0, windowMs: 60000 },
        { maxRequests: 1.5, windowMs: 60000 },
        { maxRequests: 1, windowMs: 0 },
        { maxRequests: 1, windowMs: Number.POSITIVE_INFINITY },
      ]
    ) {
      assertThrows(
        () => rateLimit(options),
        TypeError,
        "positive safe integer",
      );
    }
  });

  it("rejects malformed collaborators during configuration", () => {
    assertThrows(
      () => rateLimit({ store: {} as never }),
      TypeError,
      "store",
    );
    assertThrows(
      () => rateLimit({ keyGenerator: "key" as never }),
      TypeError,
      "keyGenerator",
    );
    assertThrows(
      () => rateLimit({ trustProxy: "yes" as never }),
      TypeError,
      "trustProxy",
    );
  });

  it("rejects malformed entries returned by a custom store", async () => {
    const middleware = rateLimit({
      store: {
        increment: () => Promise.resolve(null as never),
        reset: () => Promise.resolve(),
      },
    });

    let error: unknown;
    try {
      await middleware(createContext(), () => Promise.resolve(new Response("OK")));
    } catch (cause) {
      error = cause;
    }

    assertEquals(error instanceof TypeError, true);
    assertEquals((error as Error).message.includes("Rate limit stores"), true);
  });

  it("should use default values when no options provided", async () => {
    const middleware = rateLimit();
    const response = await middleware(createContext(), () => Promise.resolve(new Response("OK")));

    assertEquals(response?.status, 200);
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

  it("does not allow runtime objects to override the auth preset limit", async () => {
    const store = new MemoryRateLimitStore(60000);
    const middleware = authRateLimit(
      {
        store,
        maxRequests: 100,
        windowMs: 60000,
      } as unknown as Parameters<typeof authRateLimit>[0],
    );

    try {
      for (let index = 0; index < 5; index += 1) {
        const response = await middleware(
          createContext(),
          () => Promise.resolve(new Response("OK")),
        );
        assertEquals(response?.status, 200);
      }
      const blocked = await middleware(
        createContext(),
        () => Promise.resolve(new Response("OK")),
      );
      assertEquals(blocked?.status, 429);
    } finally {
      store.destroy();
    }
  });
});
