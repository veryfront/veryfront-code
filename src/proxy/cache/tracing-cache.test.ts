import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { TracingTokenCache } from "./tracing-cache.ts";
import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";

type CallRecord = { method: string; args: unknown[] };

class FakeCache implements TokenCache {
  readonly calls: CallRecord[] = [];
  entry: TokenCacheEntry | null = null;
  hasResult = false;
  statsResult: CacheStats = { hits: 0, misses: 0, size: 0, type: "redis" };

  get(key: string): Promise<TokenCacheEntry | null> {
    this.calls.push({ method: "get", args: [key] });
    return Promise.resolve(this.entry);
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    this.calls.push({ method: "set", args: [key, entry] });
    this.entry = entry;
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.calls.push({ method: "delete", args: [key] });
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.calls.push({ method: "clear", args: [] });
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    this.calls.push({ method: "has", args: [key] });
    return Promise.resolve(this.hasResult);
  }

  stats(): Promise<CacheStats> {
    this.calls.push({ method: "stats", args: [] });
    return Promise.resolve(this.statsResult);
  }

  close(): Promise<void> {
    this.calls.push({ method: "close", args: [] });
    return Promise.resolve();
  }
}

function makeEntry(token: string): TokenCacheEntry {
  return { token, expiresAt: Date.now() + 60_000, scope: "production" };
}

describe("TracingTokenCache", () => {
  it("delegates get() to the inner cache and returns its result", async () => {
    const fake = new FakeCache();
    fake.entry = makeEntry("t-1");
    const traced = new TracingTokenCache(fake);

    const result = await traced.get("k1");

    assertEquals(result?.token, "t-1");
    assertEquals(fake.calls, [{ method: "get", args: ["k1"] }]);
  });

  it("delegates set() with key and entry", async () => {
    const fake = new FakeCache();
    const traced = new TracingTokenCache(fake);
    const entry = makeEntry("t-2");

    await traced.set("k2", entry);

    assertEquals(fake.calls.length, 1);
    assertEquals(fake.calls[0].method, "set");
    assertEquals(fake.calls[0].args[0], "k2");
    assertEquals(fake.calls[0].args[1], entry);
  });

  it("delegates delete()", async () => {
    const fake = new FakeCache();
    const traced = new TracingTokenCache(fake);

    await traced.delete("k3");

    assertEquals(fake.calls, [{ method: "delete", args: ["k3"] }]);
  });

  it("delegates clear()", async () => {
    const fake = new FakeCache();
    const traced = new TracingTokenCache(fake);

    await traced.clear();

    assertEquals(fake.calls, [{ method: "clear", args: [] }]);
  });

  it("delegates has() and propagates boolean", async () => {
    const fake = new FakeCache();
    fake.hasResult = true;
    const traced = new TracingTokenCache(fake);

    assertEquals(await traced.has("k4"), true);
    assertEquals(fake.calls, [{ method: "has", args: ["k4"] }]);
  });

  it("delegates stats() and propagates the snapshot", async () => {
    const fake = new FakeCache();
    fake.statsResult = { hits: 5, misses: 2, size: 7, type: "redis" };
    const traced = new TracingTokenCache(fake);

    const stats = await traced.stats();

    assertEquals(stats, { hits: 5, misses: 2, size: 7, type: "redis" });
    assertEquals(fake.calls, [{ method: "stats", args: [] }]);
  });

  it("delegates close()", async () => {
    const fake = new FakeCache();
    const traced = new TracingTokenCache(fake);

    await traced.close();

    assertEquals(fake.calls, [{ method: "close", args: [] }]);
  });

  it("propagates errors thrown by the inner cache", async () => {
    const fake: TokenCache = {
      get: () => Promise.reject(new Error("boom")),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      has: () => Promise.resolve(false),
      stats: () => Promise.resolve({ hits: 0, misses: 0, size: 0, type: "redis" as const }),
      close: () => Promise.resolve(),
    };
    const traced = new TracingTokenCache(fake);

    let caught: unknown = null;
    try {
      await traced.get("k");
    } catch (error) {
      caught = error;
    }

    assertEquals(caught instanceof Error, true);
    assertEquals((caught as Error).message, "boom");
  });

  it("accepts a custom spanPrefix without altering behavior", async () => {
    // We cannot easily spy on the proxy tracer from here (withSpan is a
    // pass-through when OTEL is disabled, which is the default in tests),
    // so this mostly asserts the option does not regress delegation.
    const fake = new FakeCache();
    const traced = new TracingTokenCache(fake, { spanPrefix: "cache.custom" });

    await traced.get("k5");

    assertEquals(fake.calls, [{ method: "get", args: ["k5"] }]);
  });
});
