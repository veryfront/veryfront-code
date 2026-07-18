import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRateLimiter, RateLimitPresets } from "./middleware.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";
import type { RateLimitStore } from "./types.ts";

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

  it("should ignore X-Forwarded-For when trustProxy is false", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        store,
      });

      const next = createNext();

      const req1 = createRequest({ "x-forwarded-for": "198.51.100.1" });
      const req2 = createRequest({ "x-forwarded-for": "203.0.113.8" });

      const res1 = await limiter(req1, next);
      assertEquals(res1.status, 200);

      const res2 = await limiter(req2, next);
      assertEquals(res2.status, 429);
    });
  });

  it("should ignore X-Real-IP when trustProxy is false", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        store,
      });

      const next = createNext();

      const req1 = createRequest({ "x-real-ip": "198.51.100.1" });
      const req2 = createRequest({ "x-real-ip": "203.0.113.8" });

      const res1 = await limiter(req1, next);
      assertEquals(res1.status, 200);

      const res2 = await limiter(req2, next);
      assertEquals(res2.status, 429);
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

  it("should use the rightmost IP from X-Forwarded-For when trustProxy is true", async () => {
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        trustProxy: true,
        store,
      });

      const next = createNext();

      const req = createRequest({ "x-forwarded-for": "198.51.100.1, 203.0.113.8" });
      const res = await limiter(req, next);
      assertEquals(res.status, 200);

      const req2 = createRequest({ "x-forwarded-for": "192.0.2.5, 203.0.113.8" });
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

  it("should fail closed with 503 when store throws (SEC-001)", async () => {
    // Simulate a store outage (e.g. Redis down). The middleware must NOT
    // call next() in the catch branch — that would silently bypass rate
    // limiting and reopen brute-force / scraping / credential-stuffing
    // surfaces. Expect a 503 with Retry-After: 60 instead.
    const failingStore: RateLimitStore = {
      increment: () => Promise.reject(new Error("store unavailable")),
      get: () => Promise.reject(new Error("store unavailable")),
      reset: () => Promise.reject(new Error("store unavailable")),
      resetAll: () => Promise.reject(new Error("store unavailable")),
    };

    const limiter = createRateLimiter({
      maxRequests: 5,
      windowMs: 60000,
      strategy: "fixed-window",
      store: failingStore,
    });

    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      return Promise.resolve(new Response("OK"));
    };

    const response = await limiter(createRequest(), next);

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("Retry-After"), "60");
    assertEquals(nextCalled, false, "next() must not be invoked when the store fails");
  });

  it("should NOT swallow downstream handler errors", async () => {
    // Downstream handler exceptions must propagate to the normal error handler
    // rather than being reclassified as a rate-limit outage (503 + Retry-After).
    // Masking application faults as rate-limit signals hides real problems and
    // causes clients to back off incorrectly.
    await withStore(async (store) => {
      const limiter = createRateLimiter({
        maxRequests: 5,
        windowMs: 60000,
        strategy: "fixed-window",
        store,
      });

      let nextCalled = false;
      const downstreamError = new Error("handler boom");
      const next = () => {
        nextCalled = true;
        return Promise.reject(downstreamError);
      };

      const err = await assertRejects(
        () => limiter(createRequest(), next),
        Error,
        "handler boom",
      );
      assertEquals(err, downstreamError, "the original error must propagate unchanged");
      assertEquals(nextCalled, true, "next() must have been invoked");
    });
  });

  it("should NOT swallow onRateLimitExceeded callback errors", async () => {
    // User-supplied callback errors must propagate to the normal error handler
    // rather than being masked as a 503 rate-limit outage.
    await withStore(async (store) => {
      const callbackError = new Error("callback boom");

      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        strategy: "fixed-window",
        store,
        onRateLimitExceeded: () => {
          throw callbackError;
        },
      });

      const request = createRequest();
      const next = createNext();

      // First request consumes the only token allowed by the limit.
      const ok = await limiter(request, next);
      assertEquals(ok.status, 200);

      // Second request triggers the callback, which throws — the error must
      // propagate (NOT become a 503).
      const err = await assertRejects(
        () => limiter(request, next),
        Error,
        "callback boom",
      );
      assertEquals(err, callbackError, "the original callback error must propagate unchanged");
    });
  });
});
