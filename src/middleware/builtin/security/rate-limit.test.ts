import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { MemoryRateLimitStore, rateLimit } from "./rate-limit.ts";
import { MiddlewareContext } from "../../core/context.ts";

// Disable LRU interval during tests
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
      // Use a very short window for testing
      const shortWindow = 10;
      const entry1 = await store.increment("test-key", shortWindow);
      assertEquals(entry1.count, 1);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should reset to 1 after expiry
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
      // Should not throw
      await store.reset("non-existent");
    });
  });
});

describe("rateLimit middleware", () => {
  function createContext(
    ip: string = "127.0.0.1",
    path: string = "/",
  ): MiddlewareContext {
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

    // Make 2 requests (at limit)
    for (let i = 0; i < 2; i++) {
      const ctx = createContext("same-ip");
      await middleware(ctx, () => Promise.resolve(new Response("OK")));
    }

    // Third request should be blocked
    const ctx = createContext("same-ip");
    const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

    assertEquals(response?.status, 429);
    assertExists(response?.headers.get("Retry-After"));
  });

  it("should accept numeric arguments (legacy API)", async () => {
    const middleware = rateLimit(3, 60000);
    const ctx = createContext();

    const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

    assertEquals(response?.status, 200);
  });

  it("should use default values when no options provided", async () => {
    const middleware = rateLimit();
    const ctx = createContext();

    const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

    assertEquals(response?.status, 200);
  });

  it("should use custom key generator", async () => {
    let capturedKey = "";
    const middleware = rateLimit({
      maxRequests: 10,
      windowMs: 60000,
      keyGenerator: (req) => {
        capturedKey = req.headers.get("x-api-key") || "anonymous";
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

  it("should track different IPs separately", async () => {
    const middleware = rateLimit({ maxRequests: 1, windowMs: 60000 });

    // First IP
    const ctx1 = createContext("ip-1");
    await middleware(ctx1, () => Promise.resolve(new Response("OK")));

    // Second request from first IP should be blocked
    const ctx2 = createContext("ip-1");
    const response1 = await middleware(ctx2, () => Promise.resolve(new Response("OK")));
    assertEquals(response1?.status, 429);

    // Different IP should be allowed
    const ctx3 = createContext("ip-2");
    const response2 = await middleware(ctx3, () => Promise.resolve(new Response("OK")));
    assertEquals(response2?.status, 200);
  });
});
