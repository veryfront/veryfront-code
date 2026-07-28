import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects, assertThrows } from "#veryfront/testing/assert";
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
    this.entry = null;
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
    const call = fake.calls[0];
    assertExists(call);
    assertEquals(call.method, "set");
    assertEquals(call.args[0], "k2");
    assertEquals(call.args[1], entry);
    entry.token = "mutated";
    assertEquals(fake.entry?.token, "t-2");
    assertEquals(Object.isFrozen(fake.entry), true);
  });

  it("turns an already expired write into a backend deletion", async () => {
    const fake = new FakeCache();
    fake.entry = makeEntry("current");
    const traced = new TracingTokenCache(fake);

    await traced.set("key", {
      token: "expired",
      expiresAt: Date.now() - 1,
      scope: "production",
    });

    assertEquals(fake.calls, [{ method: "delete", args: ["key"] }]);
    assertEquals(fake.entry, null);
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

  it("can close its wrapper without closing a borrowed backend", async () => {
    const fake = new FakeCache();
    const traced = new TracingTokenCache(fake, { closeInner: false });

    await traced.close();
    await traced.close();

    assertEquals(fake.calls, []);
    await assertRejects(
      () => traced.get("closed"),
      Error,
      "closed",
    );
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

  it("snapshots backend operations at construction", async () => {
    const fake = new FakeCache();
    fake.entry = makeEntry("original");
    const traced = new TracingTokenCache(fake);
    fake.get = () => Promise.resolve(makeEntry("replacement"));

    assertEquals((await traced.get("key"))?.token, "original");
    assertEquals(fake.calls, [{ method: "get", args: ["key"] }]);
  });

  it("rejects accessor-backed operations without invoking them", () => {
    const fake = new FakeCache();
    let reads = 0;
    Object.defineProperty(fake, "get", {
      get() {
        reads++;
        return () => Promise.resolve(null);
      },
    });

    assertThrows(
      () => new TracingTokenCache(fake),
      TypeError,
      "data function",
    );
    assertEquals(reads, 0);
  });

  it("rejects invalid span policy", () => {
    const fake = new FakeCache();
    assertThrows(
      () => new TracingTokenCache(fake, { spanPrefix: "Cache Invalid" }),
      TypeError,
      "spanPrefix",
    );
    const accessorOptions = Object.defineProperty({}, "spanPrefix", {
      get: () => "cache.dynamic",
    });
    assertThrows(
      () => new TracingTokenCache(fake, accessorOptions),
      TypeError,
      "data property",
    );
    assertThrows(
      () => new TracingTokenCache(fake, { closeInner: "yes" } as never),
      TypeError,
      "boolean",
    );
  });

  it("validates backend statistics without invoking accessors", async () => {
    const fake = new FakeCache();
    let reads = 0;
    fake.stats = () => {
      const stats = Object.create(null);
      Object.defineProperty(stats, "hits", {
        get() {
          reads++;
          return 1;
        },
      });
      return Promise.resolve(stats as CacheStats);
    };
    const traced = new TracingTokenCache(fake);

    await assertRejects(
      () => traced.stats(),
      TypeError,
      "invalid statistics",
    );
    assertEquals(reads, 0);
  });

  it("validates backend entries and booleans at the boundary", async () => {
    const fake = new FakeCache();
    let reads = 0;
    fake.get = () => {
      const value = Object.create(null);
      Object.defineProperty(value, "token", {
        get() {
          reads++;
          return "token";
        },
      });
      return Promise.resolve(value as TokenCacheEntry);
    };
    fake.has = () => Promise.resolve("yes" as never);
    const traced = new TracingTokenCache(fake);

    await assertRejects(
      () => traced.get("key"),
      TypeError,
      "entry is invalid",
    );
    assertEquals(reads, 0);
    await assertRejects(
      () => traced.has("key"),
      TypeError,
      "invalid has result",
    );
    await assertRejects(
      () => traced.get(""),
      TypeError,
      "bounded non-empty",
    );
  });

  it("closes once and rejects subsequent operations", async () => {
    const fake = new FakeCache();
    const traced = new TracingTokenCache(fake);

    await traced.close();
    await traced.close();

    assertEquals(fake.calls, [{ method: "close", args: [] }]);
    await assertRejects(() => traced.get("key"), Error, "closed");
  });
});
