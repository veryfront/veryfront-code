import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fixedWindowStrategy, slidingWindowStrategy, tokenBucketStrategy } from "./strategies.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";
import type { RateLimitConfig } from "./types.ts";

function createConfig(overrides?: Partial<RateLimitConfig>): RateLimitConfig {
  return {
    maxRequests: 5,
    windowMs: 60000,
    ...overrides,
  };
}

describe("fixedWindowStrategy", () => {
  it("should allow requests under the limit", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 3 });

    const result = await fixedWindowStrategy("test-key", config, store);
    assertEquals(result.allowed, true);
    assertEquals(result.remaining, 2);

    store.destroy();
  });

  it("should track remaining requests correctly", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 3 });

    await fixedWindowStrategy("key", config, store);
    await fixedWindowStrategy("key", config, store);
    const result = await fixedWindowStrategy("key", config, store);

    assertEquals(result.allowed, true);
    assertEquals(result.remaining, 0);

    store.destroy();
  });

  it("should deny requests over the limit", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 2 });

    await fixedWindowStrategy("key", config, store);
    await fixedWindowStrategy("key", config, store);
    const result = await fixedWindowStrategy("key", config, store);

    assertEquals(result.allowed, false);
    assertEquals(result.remaining, 0);

    store.destroy();
  });

  it("should provide a reset time in the future", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig();
    const before = Date.now();

    const result = await fixedWindowStrategy("key", config, store);

    assertEquals(result.resetTime >= before, true);

    store.destroy();
  });

  it("should track separate keys independently", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 1 });

    await fixedWindowStrategy("key-a", config, store);
    const resultA = await fixedWindowStrategy("key-a", config, store);
    const resultB = await fixedWindowStrategy("key-b", config, store);

    assertEquals(resultA.allowed, false);
    assertEquals(resultB.allowed, true);

    store.destroy();
  });
});

describe("slidingWindowStrategy", () => {
  it("should allow requests under the limit", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 3 });

    const result = await slidingWindowStrategy("test-key", config, store);
    assertEquals(result.allowed, true);
    assertEquals(result.remaining, 2);

    store.destroy();
  });

  it("should deny requests over the limit", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 2 });

    await slidingWindowStrategy("key", config, store);
    await slidingWindowStrategy("key", config, store);
    const result = await slidingWindowStrategy("key", config, store);

    assertEquals(result.allowed, false);
    assertEquals(result.remaining, 0);

    store.destroy();
  });

  it("should track timestamps within the window", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 5 });

    await slidingWindowStrategy("key", config, store);
    await slidingWindowStrategy("key", config, store);

    const state = store.getState("key");
    assertEquals(state !== undefined, true);
    assertEquals(state!.requestTimestamps !== undefined, true);
    assertEquals(state!.requestTimestamps!.length, 2);

    store.destroy();
  });
});

describe("tokenBucketStrategy", () => {
  it("should allow first request (full bucket)", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 5 });

    const result = await tokenBucketStrategy("key", config, store);
    assertEquals(result.allowed, true);

    store.destroy();
  });

  it("should track remaining tokens after requests", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 5 });

    const first = await tokenBucketStrategy("key", config, store);
    assertEquals(first.allowed, true);

    const second = await tokenBucketStrategy("key", config, store);
    assertEquals(second.allowed, true);
    assertEquals(second.remaining < first.remaining, true);

    store.destroy();
  });

  it("should deny when bucket is empty", async () => {
    const store = new MemoryRateLimitStore();
    const config = createConfig({ maxRequests: 2 });

    await tokenBucketStrategy("key", config, store);
    await tokenBucketStrategy("key", config, store);
    const result = await tokenBucketStrategy("key", config, store);

    assertEquals(result.allowed, false);
    assertEquals(result.remaining, 0);

    store.destroy();
  });
});
