/**
 * Rate Limiting Middleware Tests
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { createRateLimiter, RateLimitPresets } from "./middleware.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";

describe("Rate Limiting Middleware", () => {
  it("should allow requests within limit", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter({
      maxRequests: 5,
      windowMs: 60000,
      strategy: "fixed-window",
      store,
    });

    const request = new Request("http://localhost/test");
    const next = () => Promise.resolve(new Response("OK"));

    // First 5 requests should succeed
    for (let i = 0; i < 5; i++) {
      const response = await limiter(request, next);
      assertEquals(response.status, 200);
      assertExists(response.headers.get("X-RateLimit-Limit"));
    }

    store.destroy();
  });

  it("should block requests exceeding limit", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter({
      maxRequests: 3,
      windowMs: 60000,
      strategy: "fixed-window",
      store,
    });

    const request = new Request("http://localhost/test");
    const next = () => Promise.resolve(new Response("OK"));

    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      const response = await limiter(request, next);
      assertEquals(response.status, 200);
    }

    // 4th request should be blocked
    const blockedResponse = await limiter(request, next);
    assertEquals(blockedResponse.status, 429);
    assertExists(blockedResponse.headers.get("X-RateLimit-Limit"));
    assertExists(blockedResponse.headers.get("Retry-After"));

    store.destroy();
  });

  it("should add rate limit headers", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter({
      maxRequests: 10,
      windowMs: 60000,
      store,
    });

    const request = new Request("http://localhost/test");
    const next = () => Promise.resolve(new Response("OK"));

    const response = await limiter(request, next);

    assertEquals(response.headers.get("X-RateLimit-Limit"), "10");
    assertExists(response.headers.get("X-RateLimit-Remaining"));
    assertExists(response.headers.get("X-RateLimit-Reset"));

    store.destroy();
  });

  it("should skip rate limiting when skip function returns true", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter({
      maxRequests: 1,
      windowMs: 60000,
      skip: (request) => request.headers.get("x-skip") === "true",
      store,
    });

    const request = new Request("http://localhost/test", {
      headers: { "x-skip": "true" },
    });
    const next = () => Promise.resolve(new Response("OK"));

    // Should allow unlimited requests when skip returns true
    for (let i = 0; i < 10; i++) {
      const response = await limiter(request, next);
      assertEquals(response.status, 200);
    }

    store.destroy();
  });

  it("should use custom key generator", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60000,
      keyGenerator: (request) => request.headers.get("x-api-key") || "default",
      store,
    });

    const next = () => Promise.resolve(new Response("OK"));

    // User 1 makes 2 requests
    const req1 = new Request("http://localhost/test", {
      headers: { "x-api-key": "user1" },
    });
    await limiter(req1, next);
    await limiter(req1, next);

    // User 1's 3rd request should be blocked
    const blocked1 = await limiter(req1, next);
    assertEquals(blocked1.status, 429);

    // User 2 should have separate limit
    const req2 = new Request("http://localhost/test", {
      headers: { "x-api-key": "user2" },
    });
    const response2 = await limiter(req2, next);
    assertEquals(response2.status, 200);

    store.destroy();
  });

  it("should work with preset configurations", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = RateLimitPresets.strict(store);
    const request = new Request("http://localhost/test");
    const next = () => Promise.resolve(new Response("OK"));

    const response = await limiter(request, next);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("X-RateLimit-Limit"), "10");

    store.destroy();
  });
});
