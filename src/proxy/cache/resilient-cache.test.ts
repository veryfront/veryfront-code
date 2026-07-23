import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { ResilientCache } from "./resilient-cache.ts";
import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";

class ControlledCache implements TokenCache {
  readonly entries = new Map<string, TokenCacheEntry>();
  getCalls = 0;
  setCalls = 0;
  deleteCalls = 0;
  clearCalls = 0;
  statsCalls = 0;
  closeCalls = 0;
  failGet = false;
  failSet = false;
  failDelete = false;
  failClear = false;
  failStats = false;
  failClose = false;

  get(key: string): Promise<TokenCacheEntry | null> {
    this.getCalls++;
    if (this.failGet) return Promise.reject(new Error("primary unavailable"));
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    this.setCalls++;
    if (this.failSet) return Promise.reject(new Error("primary unavailable"));
    this.entries.set(key, { ...entry });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.deleteCalls++;
    if (this.failDelete) return Promise.reject(new Error("primary unavailable"));
    this.entries.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.clearCalls++;
    if (this.failClear) return Promise.reject(new Error("primary unavailable"));
    this.entries.clear();
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    return this.get(key).then((entry) => entry !== null);
  }

  stats(): Promise<CacheStats> {
    this.statsCalls++;
    if (this.failStats) return Promise.reject(new Error("primary unavailable"));
    return Promise.resolve({
      hits: 0,
      misses: 0,
      size: this.entries.size,
      type: "redis",
    });
  }

  close(): Promise<void> {
    this.closeCalls++;
    if (this.failClose) return Promise.reject(new Error("redis://user:password@private-host"));
    return Promise.resolve();
  }
}

class DelayedGetCache extends ControlledCache {
  readonly getStarted: Promise<void>;
  private signalGetStarted!: () => void;
  private readonly allowGet: Promise<void>;
  private releasePendingGet!: () => void;

  constructor() {
    super();
    this.getStarted = new Promise((resolve) => {
      this.signalGetStarted = resolve;
    });
    this.allowGet = new Promise((resolve) => {
      this.releasePendingGet = resolve;
    });
  }

  override async get(key: string): Promise<TokenCacheEntry | null> {
    this.getCalls++;
    this.signalGetStarted();
    await this.allowGet;
    return this.entries.get(key) ?? null;
  }

  releaseGet(): void {
    this.releasePendingGet();
  }
}

class DelayedStatsCache extends ControlledCache {
  readonly statsStarted: Promise<void>;
  private signalStatsStarted!: () => void;
  private readonly allowStats: Promise<void>;
  private releasePendingStats!: () => void;

  constructor() {
    super();
    this.statsStarted = new Promise((resolve) => {
      this.signalStatsStarted = resolve;
    });
    this.allowStats = new Promise((resolve) => {
      this.releasePendingStats = resolve;
    });
  }

  override async stats(): Promise<CacheStats> {
    this.statsCalls++;
    this.signalStatsStarted();
    await this.allowStats;
    return { hits: 0, misses: 0, size: this.entries.size, type: "redis" };
  }

  releaseStats(): void {
    this.releasePendingStats();
  }
}

class DelayedClearCache extends ControlledCache {
  readonly clearStarted: Promise<void>;
  delayClear = false;
  private signalClearStarted!: () => void;
  private readonly allowClear: Promise<void>;
  private releasePendingClear!: () => void;

  constructor() {
    super();
    this.clearStarted = new Promise((resolve) => {
      this.signalClearStarted = resolve;
    });
    this.allowClear = new Promise((resolve) => {
      this.releasePendingClear = resolve;
    });
  }

  override async clear(): Promise<void> {
    this.clearCalls++;
    if (this.failClear) throw new Error("primary unavailable");
    if (this.delayClear) {
      this.signalClearStarted();
      await this.allowClear;
    }
    this.entries.clear();
  }

  releaseClear(): void {
    this.releasePendingClear();
  }
}

class SynchronouslyThrowingCloseCache extends ControlledCache {
  override close(): Promise<void> {
    this.closeCalls++;
    throw new Error("redis://user:password@private-host");
  }
}

function entry(token: string): TokenCacheEntry {
  return {
    token,
    expiresAt: Date.now() + 60_000,
    scope: "production",
  };
}

describe("ResilientCache", () => {
  let now: number;
  let originalDateNow: () => number;

  beforeEach(() => {
    now = 1_700_000_000_000;
    originalDateNow = Date.now;
    Date.now = () => now;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  it("counts only consecutive primary failures", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);

    for (let attempt = 0; attempt < 3; attempt++) {
      primary.failGet = true;
      await cache.get("key");
      primary.failGet = false;
      await cache.get("key");
    }

    assertEquals(cache.getStatus(), {
      usingFallback: false,
      failureCount: 0,
      circuitOpenedAt: null,
    });
  });

  it("does not misclassify or retry a fallback read failure as a primary failure", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    fallback.failGet = true;
    const cache = new ResilientCache(primary, fallback);

    await assertRejects(() => cache.get("key"), Error, "primary unavailable");

    assertEquals(fallback.getCalls, 1);
    assertEquals(cache.getStatus().failureCount, 0);
    assertEquals(cache.getStatus().usingFallback, false);
  });

  it("replays a delete made while open before trusting the primary again", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);
    await cache.set("key", entry("old"));

    primary.failGet = true;
    await cache.get("key");
    await cache.get("key");
    await cache.get("key");
    await cache.delete("key");

    primary.failGet = false;
    now += 30_001;
    assertEquals(await cache.get("key"), null);
    assertEquals(primary.entries.has("key"), false);
  });

  it("replays a set made while open before trusting the primary again", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);
    await cache.set("key", entry("old"));

    primary.failGet = true;
    await cache.get("key");
    await cache.get("key");
    await cache.get("key");
    await cache.set("key", entry("new"));

    primary.failGet = false;
    now += 30_001;
    assertEquals((await cache.get("key"))?.token, "new");
    assertEquals(primary.entries.get("key")?.token, "new");
  });

  it("allows only one half-open recovery probe", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);
    await fallback.set("key", entry("fallback"));

    primary.failGet = true;
    await cache.get("key");
    await cache.get("key");
    await cache.get("key");
    primary.failGet = false;
    now += 30_001;
    primary.getCalls = 0;

    const results = await Promise.all([cache.get("key"), cache.get("key")]);

    assertEquals(results.map((value) => value?.token), ["fallback", "fallback"]);
    assertEquals(primary.getCalls, 1);
  });

  it("opens immediately after a failed mutation to prevent divergent reads", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);
    primary.failSet = true;

    await cache.set("key", entry("fallback"));

    assertEquals(cache.getStatus().usingFallback, true);
    assertEquals((await cache.get("key"))?.token, "fallback");
  });

  it("does not let an older successful read close a circuit opened by a newer delete", async () => {
    const primary = new DelayedGetCache();
    const fallback = new ControlledCache();
    const cachedEntry = entry("stale");
    primary.entries.set("key", cachedEntry);
    fallback.entries.set("key", cachedEntry);
    const cache = new ResilientCache(primary, fallback);

    const staleRead = cache.get("key");
    await primary.getStarted;
    primary.failDelete = true;
    await cache.delete("key");
    primary.failDelete = false;
    primary.releaseGet();

    assertEquals(await staleRead, null);
    assertEquals(cache.getStatus().usingFallback, true);
    now += 30_001;
    assertEquals(await cache.get("key"), null);
    assertEquals(primary.entries.has("key"), false);
  });

  it("rechecks the journal after an asynchronous recovery probe", async () => {
    const primary = new DelayedStatsCache();
    const fallback = new ControlledCache();
    const cachedEntry = entry("stale");
    primary.entries.set("key", cachedEntry);
    fallback.entries.set("key", cachedEntry);
    const cache = new ResilientCache(primary, fallback, { failureThreshold: 1 });

    primary.failGet = true;
    await cache.get("key");
    primary.failGet = false;
    now += 30_001;

    const recoveryRead = cache.get("key");
    await primary.statsStarted;
    await cache.delete("key");
    primary.releaseStats();

    assertEquals(await recoveryRead, null);
    assertEquals(primary.entries.has("key"), false);
  });

  it("replays mutations after a newer clear queued during recovery", async () => {
    const primary = new DelayedClearCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);

    primary.failClear = true;
    await cache.clear();
    primary.failClear = false;
    primary.delayClear = true;
    now += 30_001;

    const recoveryRead = cache.get("new-key");
    await primary.clearStarted;
    await cache.clear();
    await cache.set("new-key", entry("new-token"));
    primary.releaseClear();

    assertEquals((await recoveryRead)?.token, "new-token");
    assertEquals(primary.entries.get("new-key")?.token, "new-token");
  });

  it("replays a clear made while open before accepting primary values", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);
    await cache.set("key", entry("old"));

    primary.failGet = true;
    await cache.get("key");
    await cache.get("key");
    await cache.get("key");
    await cache.clear();

    primary.failGet = false;
    now += 30_001;
    assertEquals(await cache.get("key"), null);
    assertEquals(primary.entries.size, 0);
  });

  it("starts a new cooldown after a failed half-open replay", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);
    await cache.set("key", entry("old"));

    primary.failGet = true;
    await cache.get("key");
    await cache.get("key");
    await cache.get("key");
    await cache.delete("key");
    now += 30_001;
    primary.failGet = false;
    primary.failDelete = true;
    await cache.get("key");
    const failedProbeCalls = primary.deleteCalls;

    primary.failDelete = false;
    await cache.get("key");
    assertEquals(primary.deleteCalls, failedProbeCalls);
    now += 30_001;
    await cache.get("key");
    assertEquals(primary.entries.has("key"), false);
  });

  it("bounds pending mutations by clearing stale primary state on recovery", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback, { maxPendingMutations: 2 });
    primary.failSet = true;
    await cache.set("key-1", entry("one"));
    await cache.set("key-2", entry("two"));
    await cache.set("key-3", entry("three"));

    primary.failSet = false;
    now += 30_001;
    await cache.get("key-3");

    assertEquals(primary.clearCalls, 1);
    assertEquals(primary.entries.get("key-3")?.token, "three");
    assertEquals((await cache.get("key-1"))?.token, "one");
  });

  it("validates circuit options and cache ownership", () => {
    const primary = new ControlledCache();
    assertThrows(
      () => new ResilientCache(primary, primary),
      TypeError,
      "different instances",
    );
    for (
      const options of [
        { circuitOpenDurationMs: -1 },
        { failureThreshold: 0 },
        { maxPendingMutations: 0 },
      ]
    ) {
      assertThrows(
        () => new ResilientCache(primary, new ControlledCache(), options),
        RangeError,
      );
    }
  });

  it("closes both caches once and rejects later operations", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);

    await cache.close();
    await cache.close();

    assertEquals(primary.closeCalls, 1);
    assertEquals(fallback.closeCalls, 1);
    await assertRejects(() => cache.get("key"), Error, "closed");
  });

  it("attempts both closes without exposing backend error details", async () => {
    const primary = new ControlledCache();
    const fallback = new ControlledCache();
    primary.failClose = true;
    const cache = new ResilientCache(primary, fallback);

    const error = await assertRejects(
      () => cache.close(),
      Error,
      "Failed to close one or more token caches",
    );

    assertEquals(primary.closeCalls, 1);
    assertEquals(fallback.closeCalls, 1);
    assertEquals((error as Error).message.includes("password"), false);
  });

  it("attempts both closes when one backend throws synchronously", async () => {
    const primary = new SynchronouslyThrowingCloseCache();
    const fallback = new ControlledCache();
    const cache = new ResilientCache(primary, fallback);

    const error = await assertRejects(
      () => cache.close(),
      Error,
      "Failed to close one or more token caches",
    );

    assertEquals(primary.closeCalls, 1);
    assertEquals(fallback.closeCalls, 1);
    assertEquals((error as Error).message.includes("password"), false);
  });
});
