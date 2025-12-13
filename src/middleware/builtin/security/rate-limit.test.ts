import { describe, it, beforeEach, afterEach } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { MemoryRateLimitStore, rateLimit } from "./rate-limit.ts";
import { MiddlewareContext } from "../../core/context.ts";
import { HTTP_TOO_MANY_REQUESTS } from "@veryfront/utils/constants/http.ts";

// Disable LRU interval for tests
beforeEach(() => {
  (globalThis as Record<string, unknown>).__vfDisableLruInterval = true;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__vfDisableLruInterval;
});

describe("MemoryRateLimitStore", () => {
  it("should increment count for a key", async () => {
    const store = new MemoryRateLimitStore(60000);
    const entry = await store.increment("test-key", 60000);

    assertEquals(entry.count, 1);
    assertExists(entry.resetAt);
  });

  it("should increment count multiple times for same key", async () => {
    const store = new MemoryRateLimitStore(60000);
    await store.increment("test-key", 60000);
    const entry = await store.increment("test-key", 60000);

    assertEquals(entry.count, 2);
  });

  it("should reset count after window expires", async () => {
    const store = new MemoryRateLimitStore(50);
    await store.increment("test-key", 50);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const entry = await store.increment("test-key", 50);

    assertEquals(entry.count, 1);
  });

  it("should handle multiple keys independently", async () => {
    const store = new MemoryRateLimitStore(60000);
    await store.increment("key1", 60000);
    await store.increment("key1", 60000);
    await store.increment("key2", 60000);

    const entry1 = await store.increment("key1", 60000);
    const entry2 = await store.increment("key2", 60000);

    assertEquals(entry1.count, 3);
    assertEquals(entry2.count, 2);
  });

  it("should reset a key", async () => {
    const store = new MemoryRateLimitStore(60000);
    await store.increment("test-key", 60000);
    await store.increment("test-key", 60000);
    await store.reset("test-key");
    const entry = await store.increment("test-key", 60000);

    assertEquals(entry.count, 1);
  });

  it("should destroy cleanup interval", () => {
    const store = new MemoryRateLimitStore(60000);
    store.destroy();
    // Should not throw
  });
});

describe("rateLimit", () => {
  it("should allow requests under the limit", async () => {
    const middleware = rateLimit(5, 60000);
    const req = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
      },
    });
    const ctx = new MiddlewareContext(req);
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      return Promise.resolve(new Response("OK"));
    };

    const response = await middleware(ctx, next);

    assertEquals(nextCalled, true);
    assertExists(response);
    assertEquals(response.status, 200);
  });

  it("should block requests over the limit", async () => {
    const middleware = rateLimit(2, 60000);
    const req = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    await middleware(ctx, next);
    await middleware(ctx, next);
    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_TOO_MANY_REQUESTS);
    assertExists(response.headers.get("Retry-After"));
  });

  it("should use default values when no options provided", async () => {
    const middleware = rateLimit();
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
  });

  it("should accept options object", async () => {
    const middleware = rateLimit({ maxRequests: 5, windowMs: 60000 });
    const req = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, 200);
  });

  it("should use custom key generator", async () => {
    let generatedKey = "";
    const middleware = rateLimit({
      maxRequests: 2,
      windowMs: 60000,
      keyGenerator: (req) => {
        const key = req.headers.get("x-api-key") || "default";
        generatedKey = key;
        return key;
      },
    });
    const req = new Request("http://localhost/test", {
      headers: {
        "x-api-key": "custom-key-123",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    await middleware(ctx, next);

    assertEquals(generatedKey, "custom-key-123");
  });

  it("should use custom store", async () => {
    const customStore = new MemoryRateLimitStore(60000);
    const middleware = rateLimit({
      maxRequests: 2,
      windowMs: 60000,
      store: customStore,
    });
    const req = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, 200);
  });

  it("should handle multiple clients independently", async () => {
    const middleware = rateLimit(2, 60000);
    const req1 = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
      },
    });
    const req2 = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "192.168.1.2",
      },
    });
    const ctx1 = new MiddlewareContext(req1);
    const ctx2 = new MiddlewareContext(req2);
    const next = () => Promise.resolve(new Response("OK"));

    await middleware(ctx1, next);
    await middleware(ctx1, next);
    const response1 = await middleware(ctx1, next);

    const response2 = await middleware(ctx2, next);

    assertExists(response1);
    assertEquals(response1.status, HTTP_TOO_MANY_REQUESTS);
    assertExists(response2);
    assertEquals(response2.status, 200);
  });

  it("should use anonymous as default key when no x-forwarded-for", async () => {
    const middleware = rateLimit(2, 60000);
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    await middleware(ctx, next);
    await middleware(ctx, next);
    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_TOO_MANY_REQUESTS);
  });

  it("should include retry-after header in seconds", async () => {
    const middleware = rateLimit(1, 10000);
    const req = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    await middleware(ctx, next);
    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_TOO_MANY_REQUESTS);
    const retryAfter = response.headers.get("Retry-After");
    assertExists(retryAfter);
    const retrySeconds = parseInt(retryAfter, 10);
    assertEquals(retrySeconds > 0, true);
    assertEquals(retrySeconds <= 10, true);
  });

  it("should accept number arguments", async () => {
    const middleware = rateLimit(10, 60000);
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, 200);
  });

  it("should reset limit after window expires", async () => {
    const middleware = rateLimit(1, 100);
    const req = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    await middleware(ctx, next);
    const blocked = await middleware(ctx, next);
    assertExists(blocked);
    assertEquals(blocked.status, HTTP_TOO_MANY_REQUESTS);

    await new Promise((resolve) => setTimeout(resolve, 150));

    const allowed = await middleware(ctx, next);
    assertExists(allowed);
    assertEquals(allowed.status, 200);
  });
});
