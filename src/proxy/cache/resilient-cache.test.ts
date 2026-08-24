import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { waitFor } from "#veryfront/testing";
import { ResilientCache } from "./resilient-cache.ts";
import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";

type CacheMethod = keyof TokenCache;

class FakeCache implements TokenCache {
  readonly calls = new Map<CacheMethod, number>();
  readonly failures = new Set<CacheMethod>();
  readonly entries = new Map<string, TokenCacheEntry>();
  hasGate?: Promise<void>;
  onHas?: () => void;
  setGate?: Promise<void>;
  onSet?: () => void;
  type: CacheStats["type"];

  constructor(type: CacheStats["type"]) {
    this.type = type;
  }

  seed(key: string, entry: TokenCacheEntry): void {
    this.entries.set(key, entry);
  }

  private async call(method: CacheMethod): Promise<void> {
    this.calls.set(method, (this.calls.get(method) ?? 0) + 1);
    if (method === "has") {
      this.onHas?.();
      if (this.hasGate) await this.hasGate;
    }
    if (method === "set") {
      this.onSet?.();
      if (this.setGate) await this.setGate;
    }
    if (this.failures.has(method)) {
      throw new Error(`${String(method)} failed`);
    }
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
    await this.call("get");
    return this.entries.get(key) ?? null;
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    await this.call("set");
    this.entries.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    await this.call("delete");
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    await this.call("clear");
    this.entries.clear();
  }

  async has(key: string): Promise<boolean> {
    await this.call("has");
    return this.entries.has(key);
  }

  async stats(): Promise<CacheStats> {
    await this.call("stats");
    return {
      hits: 0,
      misses: 0,
      size: this.entries.size,
      type: this.type,
    };
  }

  async close(): Promise<void> {
    await this.call("close");
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
  it("reads from primary and writes through both backends", async () => {
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    const cache = new ResilientCache(primary, fallback);

    await cache.set("key", entry("token"));

    assertEquals((await cache.get("key"))?.token, "token");
    assertEquals(primary.calls.get("set"), 1);
    assertEquals(fallback.calls.get("set"), 1);
    assertEquals(fallback.calls.get("get"), undefined);
    await cache.close();
  });

  it("treats an already expired write as a deletion on both backends", async () => {
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.seed("key", entry("current"));
    fallback.seed("key", entry("current"));
    const cache = new ResilientCache(primary, fallback);

    await cache.set("key", {
      token: "expired",
      expiresAt: Date.now() - 1,
      scope: "production",
    });

    assertEquals(primary.entries.has("key"), false);
    assertEquals(fallback.entries.has("key"), false);
    assertEquals(primary.calls.get("set"), undefined);
    assertEquals(primary.calls.get("delete"), 1);
    await cache.close();
  });

  it("preserves mutation order while the primary is slow", async () => {
    let releaseFirstSet!: () => void;
    let markFirstSetStarted!: () => void;
    const setGate = new Promise<void>((resolve) => {
      releaseFirstSet = resolve;
    });
    const firstSetStarted = new Promise<void>((resolve) => {
      markFirstSetStarted = resolve;
    });
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.setGate = setGate;
    primary.onSet = markFirstSetStarted;
    const cache = new ResilientCache(primary, fallback);

    const first = cache.set("key", entry("first"));
    await firstSetStarted;
    const second = cache.set("key", entry("second"));
    await Promise.resolve();
    await Promise.resolve();

    assertEquals(primary.calls.get("set"), 1);
    assertEquals(fallback.calls.get("set"), 1);
    releaseFirstSet();
    await Promise.all([first, second]);

    assertEquals(primary.entries.get("key")?.token, "second");
    assertEquals(fallback.entries.get("key")?.token, "second");
    await cache.close();
  });

  it("rejects mutation overload instead of growing an unbounded queue", async () => {
    let releaseFirstSet!: () => void;
    let markFirstSetStarted!: () => void;
    const setGate = new Promise<void>((resolve) => {
      releaseFirstSet = resolve;
    });
    const firstSetStarted = new Promise<void>((resolve) => {
      markFirstSetStarted = resolve;
    });
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.setGate = setGate;
    primary.onSet = markFirstSetStarted;
    const cache = new ResilientCache(primary, fallback);
    const writes = [cache.set("key-0", entry("token"))];
    await firstSetStarted;

    for (let index = 1; index < 10_000; index++) {
      writes.push(cache.set(`key-${index}`, entry("token")));
    }
    assertEquals(cache.getStatus().queuedMutations, 10_000);
    await assertRejects(
      () => cache.set("overflow", entry("token")),
      Error,
      "queue is full",
    );

    releaseFirstSet();
    await Promise.all(writes);
    assertEquals(cache.getStatus().queuedMutations, 0);
    await cache.close();
  });

  it("counts only consecutive primary read failures", async () => {
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    fallback.seed("key", entry("fallback"));
    primary.seed("key", entry("primary"));
    const cache = new ResilientCache(primary, fallback);

    primary.failures.add("get");
    assertEquals((await cache.get("key"))?.token, "fallback");
    assertEquals(cache.getStatus().failureCount, 1);

    primary.failures.delete("get");
    assertEquals((await cache.get("key"))?.token, "primary");
    assertEquals(cache.getStatus().failureCount, 0);
    assertEquals(cache.getStatus().state, "closed");
    await cache.close();
  });

  it("does not let best-effort statistics hide a read outage", async () => {
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    fallback.seed("key", entry("fallback"));
    primary.failures.add("get");
    const cache = new ResilientCache(primary, fallback);

    await cache.get("key");
    await cache.stats();

    assertEquals(cache.getStatus().failureCount, 1);
    await cache.close();
  });

  it("opens after consecutive read failures and skips primary while open", async () => {
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    fallback.seed("key", entry("fallback"));
    primary.failures.add("get");
    const cache = new ResilientCache(primary, fallback);

    await cache.get("key");
    await cache.get("key");
    await cache.get("key");
    assertEquals(cache.getStatus().state, "open");
    assertEquals(primary.calls.get("get"), 3);

    await cache.get("key");
    assertEquals(primary.calls.get("get"), 3);
    assertEquals(fallback.calls.get("get"), 4);
    await cache.close();
  });

  it("shares one half-open recovery probe across concurrent callers", async () => {
    let now = 0;
    let releaseProbe!: () => void;
    let markProbeStarted!: () => void;
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.seed("key", entry("primary"));
    fallback.seed("key", entry("fallback"));
    primary.failures.add("get");
    const cache = new ResilientCache(primary, fallback, {
      failureThreshold: 1,
      openDurationMs: 10,
      now: () => now,
    });
    await cache.get("key");
    primary.failures.delete("get");
    now = 10;
    primary.hasGate = probeGate;
    primary.onHas = markProbeStarted;

    const first = cache.get("key");
    await probeStarted;
    const second = cache.get("key");
    await Promise.resolve();
    assertEquals(primary.calls.get("has"), 1);
    releaseProbe();

    assertEquals((await first)?.token, "primary");
    assertEquals((await second)?.token, "primary");
    assertEquals(primary.calls.get("has"), 1);
    assertEquals(cache.getStatus().state, "closed");
    await cache.close();
  });

  it("installs recovery ownership before an extension can re-enter", async () => {
    let now = 0;
    const probeGate = Promise.withResolvers<void>();
    const probeStarted = Promise.withResolvers<void>();
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.failures.add("get");
    const cache = new ResilientCache(primary, fallback, {
      failureThreshold: 1,
      openDurationMs: 10,
      now: () => now,
    });
    await cache.get("key");
    primary.failures.delete("get");
    now = 10;
    primary.hasGate = probeGate.promise;

    let reentered = false;
    let reentrantLookup: Promise<CacheStats> | undefined;
    primary.onHas = () => {
      if (!reentered) {
        reentered = true;
        reentrantLookup = cache.stats();
      }
      probeStarted.resolve();
    };

    const ownerLookup = cache.stats();
    await probeStarted.promise;
    await Promise.resolve();
    assertEquals(primary.calls.get("has"), 1);

    probeGate.resolve();
    await Promise.all([ownerLookup, reentrantLookup!]);
    assertEquals(primary.calls.get("has"), 1);
    assertEquals(cache.getStatus().state, "closed");
    await cache.close();
  });

  it("joins recovery started by a reentrant clock callback", async () => {
    const clock = { cache: null as ResilientCache | null };
    let armClockReentry = false;
    let reentered = false;
    let reentrantLookup: Promise<CacheStats> | undefined;
    const probeGate = Promise.withResolvers<void>();
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.failures.add("get");
    const cache = new ResilientCache(primary, fallback, {
      failureThreshold: 1,
      openDurationMs: 0,
      now: () => {
        if (armClockReentry && !reentered) {
          reentered = true;
          if (!clock.cache) throw new Error("Cache must be initialized before clock re-entry");
          reentrantLookup = clock.cache.stats();
        }
        return 0;
      },
    });
    clock.cache = cache;
    await cache.get("key");
    primary.failures.delete("get");
    primary.hasGate = probeGate.promise;
    armClockReentry = true;

    const ownerLookup = cache.stats();
    await Promise.resolve();
    assertEquals(primary.calls.get("has"), 1);

    probeGate.resolve();
    await Promise.all([ownerLookup, reentrantLookup!]);
    assertEquals(primary.calls.get("has"), 1);
    assertEquals(cache.getStatus().state, "closed");
    await cache.close();
  });

  it("replays a failed invalidation before trusting recovered primary data", async () => {
    let now = 0;
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.seed("key", entry("stale"));
    fallback.seed("key", entry("stale"));
    primary.failures.add("delete");
    const cache = new ResilientCache(primary, fallback, {
      openDurationMs: 10,
      now: () => now,
    });

    await cache.delete("key");
    assertEquals(cache.getStatus().state, "open");
    assertEquals(primary.entries.has("key"), true);
    assertEquals(fallback.entries.has("key"), false);

    primary.failures.delete("delete");
    now = 10;
    assertEquals(await cache.get("key"), null);
    assertEquals(primary.entries.has("key"), false);
    assertEquals(cache.getStatus().pendingMutations, 0);
    assertEquals(cache.getStatus().state, "closed");
    await cache.close();
  });

  it("replays the owned snapshot of a write that failed on primary", async () => {
    let now = 0;
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.failures.add("set");
    const cache = new ResilientCache(primary, fallback, {
      openDurationMs: 10,
      now: () => now,
    });
    const value = entry("original");

    await cache.set("key", value);
    value.token = "mutated";
    primary.failures.delete("set");
    now = 10;

    assertEquals((await cache.get("key"))?.token, "original");
    assertEquals(cache.getStatus().pendingMutations, 0);
    await cache.close();
  });

  it("deletes rather than replays a journaled write that expired while the circuit was open", async () => {
    let now = 0;
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.failures.add("set");
    const cache = new ResilientCache(primary, fallback, {
      openDurationMs: 10,
      now: () => now,
    });
    // The replay's expiry check reads the real clock, so the journaled entry
    // needs a real short TTL rather than the injected test clock.
    const expiresAt = Date.now() + 25;

    await cache.set("key", { token: "stale", expiresAt, scope: "production" });
    assertEquals(
      cache.getStatus().state,
      "open",
      "the failed primary write must open the circuit",
    );

    primary.failures.delete("set");
    await waitFor(() => Date.now() >= expiresAt, {
      interval: 5,
      timeout: 1_000,
      message: "the journaled entry never reached its expiry",
    });
    now = 10;
    await cache.get("key");

    assertEquals(
      primary.entries.has("key"),
      false,
      "an entry that expired while the circuit was open must be deleted, not replayed, on recovery",
    );
    assertEquals(
      primary.calls.get("delete"),
      1,
      "recovery must issue exactly one delete for the expired journal entry",
    );
    assertEquals(
      cache.getStatus().pendingMutations,
      0,
      "the journal must be drained once the replay completes",
    );
    await cache.close();
  });

  it("replays a failed clear before trusting recovered primary data", async () => {
    let now = 0;
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.seed("stale", entry("stale"));
    fallback.seed("stale", entry("stale"));
    primary.failures.add("clear");
    const cache = new ResilientCache(primary, fallback, {
      openDurationMs: 10,
      now: () => now,
    });

    await cache.clear();
    assertEquals(cache.getStatus().pendingClear, true);
    assertEquals(primary.entries.has("stale"), true);

    primary.failures.delete("clear");
    now = 10;
    assertEquals(await cache.get("stale"), null);
    assertEquals(primary.entries.has("stale"), false);
    assertEquals(cache.getStatus().pendingClear, false);
    await cache.close();
  });

  it("keeps the recovery journal bounded after repeated overflow", async () => {
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.failures.add("set");
    const cache = new ResilientCache(primary, fallback, {
      openDurationMs: 60_000,
    });
    await cache.set("initial", entry("token"));
    primary.failures.delete("set");

    for (let index = 0; index < 20_050; index++) {
      await cache.set(`key-${index}`, entry("token"));
    }

    assertEquals(cache.getStatus().pendingClear, true);
    assertEquals(cache.getStatus().pendingMutations <= 10_000, true);
    await cache.close();
  });

  it("keeps the circuit open when reconciliation fails", async () => {
    let now = 0;
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    fallback.seed("key", entry("fallback"));
    primary.failures.add("delete");
    const cache = new ResilientCache(primary, fallback, {
      openDurationMs: 10,
      now: () => now,
    });
    await cache.delete("other");
    primary.failures.delete("delete");
    primary.failures.add("has");
    now = 10;

    assertEquals((await cache.get("key"))?.token, "fallback");
    assertEquals(cache.getStatus().state, "open");
    assertEquals(cache.getStatus().pendingMutations, 1);
    await cache.close();
  });

  it("closes both backends and reports teardown failures", async () => {
    const primary = new FakeCache("extension");
    const fallback = new FakeCache("memory");
    primary.failures.add("close");
    const cache = new ResilientCache(primary, fallback);

    await assertRejects(
      () => cache.close(),
      AggregateError,
      "Failed to close resilient cache backends",
    );
    await assertRejects(() => cache.get("key"), Error, "closed");
    assertEquals(primary.calls.get("close"), 1);
    assertEquals(fallback.calls.get("close"), 1);
  });

  it("validates construction policy", () => {
    const primary = new FakeCache("extension");
    assertThrows(
      () => new ResilientCache(primary, primary),
      TypeError,
      "distinct",
    );
    assertThrows(
      () =>
        new ResilientCache(primary, new FakeCache("memory"), {
          failureThreshold: 0,
        }),
      RangeError,
      "failureThreshold",
    );
    assertThrows(
      () =>
        new ResilientCache(primary, new FakeCache("memory"), {
          now: () => Number.NaN,
        }),
      TypeError,
      "invalid time",
    );

    let accessorReads = 0;
    const accessorBackend = Object.defineProperty(
      Object.create(FakeCache.prototype),
      "get",
      {
        get() {
          accessorReads++;
          return () => Promise.resolve(null);
        },
      },
    );
    assertThrows(
      () =>
        new ResilientCache(
          accessorBackend,
          new FakeCache("memory"),
        ),
      TypeError,
      "data function",
    );
    assertEquals(accessorReads, 0);
  });
});
