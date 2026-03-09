import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRateLimiter, RateLimitPresets } from "./middleware.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";

function createNext(): () => Promise<Response> {
  return () => Promise.resolve(new Response("OK"));
}

function createRequest(headers?: HeadersInit): Request {
  return new Request("http://localhost/test", headers ? { headers } : undefined);
}

async function withStore(test: (store: MemoryRateLimitStore) => Promise<void>): Promise<void> {
  const store = new MemoryRateLimitStore();
  try {
    await test(store);
  } finally {
    store.destroy();
  }
}

describe("Rate Limiting Middleware", () => {
  it("should allow requests within limit", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 5,
        windowMs: 60000,
        strategy: "fixed-window",
        store,
      });

      const request = createRequest();
      const next = createNext();

      for (let i = 0; i < 5; i++) {
        const response = await limiter(request, next);
        assertEquals(response.status, 200);
        assertExists(response.headers.get("X-RateLimit-Limit"));
      }
    });
  });

  it("should block requests exceeding limit", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 3,
        windowMs: 60000,
        strategy: "fixed-window",
        store,
      });

      const request = createRequest();
      const next = createNext();

      for (let i = 0; i < 3; i++) {
        const response = await limiter(request, next);
        assertEquals(response.status, 200);
      }

      const blockedResponse = await limiter(request, next);
      assertEquals(blockedResponse.status, 429);
      assertExists(blockedResponse.headers.get("X-RateLimit-Limit"));
      assertExists(blockedResponse.headers.get("Retry-After"));
    });
  });

  it("should add rate limit headers", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 10,
        windowMs: 60000,
        store,
      });

      const response = await limiter(createRequest(), createNext());

      assertEquals(response.headers.get("X-RateLimit-Limit"), "10");
      assertExists(response.headers.get("X-RateLimit-Remaining"));
      assertExists(response.headers.get("X-RateLimit-Reset"));
    });
  });

  it("should skip rate limiting when skip function returns true", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        skip: (request) => request.headers.get("x-skip") === "true",
        store,
      });

      const request = createRequest({ "x-skip": "true" });
      const next = createNext();

      for (let i = 0; i < 10; i++) {
        const response = await limiter(request, next);
        assertEquals(response.status, 200);
      }
    });
  });

  it("should use custom key generator", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 60000,
        keyGenerator: (request) => request.headers.get("x-api-key") ?? "default",
        store,
      });

      const next = createNext();

      const req1 = createRequest({ "x-api-key": "user1" });
      await limiter(req1, next);
      await limiter(req1, next);

      const blocked1 = await limiter(req1, next);
      assertEquals(blocked1.status, 429);

      const req2 = createRequest({ "x-api-key": "user2" });
      const response2 = await limiter(req2, next);
      assertEquals(response2.status, 200);
    });
  });

  it("should use rightmost X-Forwarded-For IP when trustProxy is false (default)", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        store,
      });

      const next = createNext();

      // Without trustProxy, use the rightmost (proxy-added) IP — not client-spoofable
      // Same rightmost IP = same bucket
      const req1 = createRequest({ "x-forwarded-for": "spoofed1, 10.0.0.1" });
      const req2 = createRequest({ "x-forwarded-for": "spoofed2, 10.0.0.1" });

      const res1 = await limiter(req1, next);
      assertEquals(res1.status, 200);

      // Same rightmost IP should be rate limited regardless of spoofed leftmost
      const res2 = await limiter(req2, next);
      assertEquals(res2.status, 429);
    });
  });

  it("should allow different rightmost IPs when trustProxy is false", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        store,
      });

      const next = createNext();

      // Different rightmost IPs = different buckets (per-client throttling preserved)
      const req1 = createRequest({ "x-forwarded-for": "spoofed, 10.0.0.1" });
      const req2 = createRequest({ "x-forwarded-for": "spoofed, 10.0.0.2" });

      const res1 = await limiter(req1, next);
      assertEquals(res1.status, 200);

      const res2 = await limiter(req2, next);
      assertEquals(res2.status, 200);
    });
  });

  it("should use X-Forwarded-For when trustProxy is true", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        trustProxy: true,
        store,
      });

      const next = createNext();

      const req1 = createRequest({ "x-forwarded-for": "1.2.3.4" });
      const req2 = createRequest({ "x-forwarded-for": "5.6.7.8" });

      const res1 = await limiter(req1, next);
      assertEquals(res1.status, 200);

      // Different forwarded IP = different key, so should be allowed
      const res2 = await limiter(req2, next);
      assertEquals(res2.status, 200);
    });
  });

  it("should use first IP from X-Forwarded-For chain when trustProxy is true", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        trustProxy: true,
        store,
      });

      const next = createNext();

      const req = createRequest({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 172.16.0.1" });
      const res = await limiter(req, next);
      assertEquals(res.status, 200);

      // Same first IP should be rate limited
      const req2 = createRequest({ "x-forwarded-for": "1.2.3.4, 99.99.99.99" });
      const res2 = await limiter(req2, next);
      assertEquals(res2.status, 429);
    });
  });

  it("should work with preset configurations", async () => {
    await withStore(async (store) => {
      const limiter = RateLimitPresets.strict(store);
      const response = await limiter(createRequest(), createNext());

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("X-RateLimit-Limit"), "10");
    });
  });
});
