import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromError } from "#veryfront/errors/veryfront-error.ts";
import { createRateLimiter, rateLimitMiddleware } from "./limiter.ts";

describe("createRateLimiter", () => {
  it("enforces fixed-window limits per identifier and resets after the window expires", () => {
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;

    try {
      const limiter = createRateLimiter({
        strategy: "fixed-window",
        maxRequests: 2,
        windowMs: 1_000,
        identify: (context) => String(context.userId ?? "default"),
      });

      const first = limiter.check({ userId: "user-1" });
      const second = limiter.check({ userId: "user-1" });
      const denied = limiter.check({ userId: "user-1" });
      const otherUser = limiter.check({ userId: "user-2" });

      assertEquals(first.allowed, true);
      assertEquals(first.remaining, 1);
      assertEquals(second.allowed, true);
      assertEquals(second.remaining, 0);
      assertEquals(denied.allowed, false);
      assertEquals(denied.retryAfter, 1);
      assertEquals(otherUser.allowed, true);
      assertEquals(otherUser.remaining, 1);

      now = 2_001;

      const resetWindow = limiter.check({ userId: "user-1" });

      assertEquals(resetWindow.allowed, true);
      assertEquals(resetWindow.remaining, 1);
    } finally {
      Date.now = originalNow;
    }
  });

  it("supports reset and clear for tracked identifiers", () => {
    const limiter = createRateLimiter({
      strategy: "fixed-window",
      maxRequests: 2,
      windowMs: 1_000,
      identify: (context) => String(context.userId ?? "default"),
    });

    limiter.check({ userId: "user-1" });
    limiter.reset({ userId: "user-1" });

    const afterReset = limiter.check({ userId: "user-1" });
    limiter.check({ userId: "user-2" });
    limiter.clear();
    const afterClear = limiter.check({ userId: "user-2" });

    assertEquals(afterReset.remaining, 1);
    assertEquals(afterClear.remaining, 1);
  });

  it("refills token buckets over time and reports retry-after when exhausted", () => {
    const originalNow = Date.now;
    let now = 10_000;
    Date.now = () => now;

    try {
      const limiter = createRateLimiter({
        strategy: "token-bucket",
        maxRequests: 2,
        windowMs: 2_000,
        identify: (context) => String(context.clientId ?? "default"),
      });

      const first = limiter.check({ clientId: "client-1" });
      const second = limiter.check({ clientId: "client-1" });
      const denied = limiter.check({ clientId: "client-1" });

      assertEquals(first.allowed, true);
      assertEquals(first.remaining, 1);
      assertEquals(second.allowed, true);
      assertEquals(second.remaining, 0);
      assertEquals(denied.allowed, false);
      assertEquals(denied.retryAfter, 1);

      now += 1_100;

      const afterRefill = limiter.check({ clientId: "client-1" });
      const otherClient = limiter.check({ clientId: "client-2" });

      assertEquals(afterRefill.allowed, true);
      assertEquals(afterRefill.remaining, 0);
      assertEquals(otherClient.allowed, true);
      assertEquals(otherClient.remaining, 1);
    } finally {
      Date.now = originalNow;
    }
  });

  it("implements sliding-window limits without token refills", () => {
    const originalNow = Date.now;
    let now = 10_000;
    Date.now = () => now;

    try {
      const limiter = createRateLimiter({
        strategy: "sliding-window",
        maxRequests: 2,
        windowMs: 1_000,
      });

      assertEquals(limiter.check().allowed, true);
      now += 500;
      assertEquals(limiter.check().allowed, true);
      assertEquals(limiter.check().allowed, false);

      now += 501;
      const afterOldestRequestExpires = limiter.check();
      assertEquals(afterOldestRequestExpires.allowed, true);
      assertEquals(afterOldestRequestExpires.remaining, 0);
    } finally {
      Date.now = originalNow;
    }
  });

  it("rejects invalid limiter configuration", () => {
    assertThrows(
      () =>
        createRateLimiter({
          strategy: "fixed-window",
          maxRequests: 0,
          windowMs: 1_000,
        }),
      Error,
      "maxRequests must be a positive safe integer",
    );
    assertThrows(
      () =>
        createRateLimiter({
          strategy: "fixed-window",
          maxRequests: 1,
          windowMs: Number.POSITIVE_INFINITY,
        }),
      Error,
      "windowMs must be a positive safe integer",
    );
  });

  it("bounds tracked identifier state", () => {
    const limiter = createRateLimiter({
      strategy: "fixed-window",
      maxRequests: 1,
      windowMs: 60_000,
      maxIdentifiers: 2,
      identify: (context) => String(context.userId),
    });

    limiter.check({ userId: "user-a" });
    limiter.check({ userId: "user-b" });
    limiter.check({ userId: "user-c" });

    assertEquals(limiter.check({ userId: "user-a" }).allowed, true);
  });
});

describe("rateLimitMiddleware", () => {
  it("returns the next result when the request is allowed", async () => {
    const middleware = rateLimitMiddleware({
      strategy: "fixed-window",
      maxRequests: 1,
      windowMs: 1_000,
      identify: (context) => String(context.userId ?? "default"),
    });

    const result = await middleware({ userId: "user-1" }, async () => "ok");

    assertEquals(result, "ok");
  });

  it("throws an agent error with the configured message when the limit is exceeded", async () => {
    const middleware = rateLimitMiddleware({
      strategy: "fixed-window",
      maxRequests: 1,
      windowMs: 1_000,
      identify: (context) => String(context.userId ?? "default"),
      errorMessage: "Too many requests",
    });

    await middleware({ userId: "user-1" }, async () => "ok");

    try {
      await middleware({ userId: "user-1" }, async () => "ok");
      throw new Error("Expected middleware to reject rate-limited request");
    } catch (error) {
      const vfError = fromError(error);
      assertEquals(vfError?.type, "agent");
      assertEquals(vfError?.message, "Too many requests");
    }
  });
});
