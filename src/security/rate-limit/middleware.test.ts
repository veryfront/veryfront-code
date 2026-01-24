/**
 * Rate Limiting Middleware Tests
 */

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

describe("Rate Limiting Middleware", () => {
  it("should allow requests within limit", async () => {
    const store = new MemoryRateLimitStore();
    try {
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
    } finally {
      store.destroy();
    }
  });

  it("should block requests exceeding limit", async () => {
    const store = new MemoryRateLimitStore();
    try {
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
    } finally {
      store.destroy();
    }
  });

  it("should add rate limit headers", async () => {
    const store = new MemoryRateLimitStore();
    try {
      const limiter = createRateLimiter({
        maxRequests: 10,
        windowMs: 60000,
        store,
      });

      const request = createRequest();
      const next = createNext();

      const response = await limiter(request, next);

      assertEquals(response.headers.get("X-RateLimit-Limit"), "10");
      assertExists(response.headers.get("X-RateLimit-Remaining"));
      assertExists(response.headers.get("X-RateLimit-Reset"));
    } finally {
      store.destroy();
    }
  });

  it("should skip rate limiting when skip function returns true", async () => {
    const store = new MemoryRateLimitStore();
    try {
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
    } finally {
      store.destroy();
    }
  });

  it("should use custom key generator", async () => {
    const store = new MemoryRateLimitStore();
    try {
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
    } finally {
      store.destroy();
    }
  });

  it("should work with preset configurations", async () => {
    const store = new MemoryRateLimitStore();
    try {
      const limiter = RateLimitPresets.strict(store);
      const request = createRequest();
      const next = createNext();

      const response = await limiter(request, next);
      assertEquals(response.status, 200);
      assertEquals(response.headers.get("X-RateLimit-Limit"), "10");
    } finally {
      store.destroy();
    }
  });
});
