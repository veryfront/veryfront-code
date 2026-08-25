import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromError } from "#veryfront/errors/legacy-error-codec.ts";
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
      assertEquals(first.resetAt, 2_000, "the fixed window reports the end of the current window");
      assertEquals(
        denied.resetAt,
        2_000,
        "a denied request reports the same window end, not a past timestamp",
      );

      now = 2_001;

      const resetWindow = limiter.check({ userId: "user-1" });

      assertEquals(resetWindow.allowed, true);
      assertEquals(resetWindow.remaining, 1);
      assertEquals(
        resetWindow.resetAt,
        3_001,
        "a new window reports a new reset timestamp",
      );
    } finally {
      Date.now = originalNow;
    }
  });

  it("reports the time left in the window rather than the whole window when denying", () => {
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;

    try {
      const limiter = createRateLimiter({
        strategy: "fixed-window",
        maxRequests: 1,
        windowMs: 60_000,
        identify: (context) => String(context.userId ?? "default"),
      });

      const first = limiter.check({ userId: "user-1" });
      assertEquals(first.allowed, true, "the first request in a fresh window is allowed");
      assertEquals(first.resetAt, 61_000, "the window ends one windowMs after it opened");

      now = 60_000;

      const denied = limiter.check({ userId: "user-1" });

      assertEquals(denied.allowed, false, "a second request inside the window is denied");
      assertEquals(
        denied.retryAfter,
        1,
        "retry-after counts the seconds left in the window, not the window length",
      );
      assertEquals(
        denied.resetAt,
        61_000,
        "a mid-window denial still reports the original window end",
      );
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
      assertEquals(first.resetAt, 12_000, "a new bucket reports one window ahead");
      assertEquals(
        denied.resetAt,
        12_000,
        "an exhausted bucket reports a future reset timestamp",
      );

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

  it("includes the retry hint in the default rate-limit message", async () => {
    const originalNow = Date.now;
    Date.now = () => 1_000;

    try {
      const middleware = rateLimitMiddleware({
        strategy: "fixed-window",
        maxRequests: 1,
        windowMs: 1_000,
        identify: (context) => String(context.userId ?? "default"),
      });

      await middleware({ userId: "user-1" }, async () => "ok");

      try {
        await middleware({ userId: "user-1" }, async () => "ok");
        throw new Error("Expected middleware to reject rate-limited request");
      } catch (error) {
        const vfError = fromError(error);
        assertEquals(vfError?.type, "agent", "a rate-limit rejection is an agent error");
        assertStringIncludes(
          vfError?.message ?? "",
          "Try again in 1 seconds",
          "the default message carries the retry-after hint",
        );
      }
    } finally {
      Date.now = originalNow;
    }
  });
});
