import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { register, reset } from "../../extensions/contracts.ts";
import { createCache, createCacheFromEnv, MemoryCache, TracingTokenCache } from "./index.ts";
import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";

class FakeTokenCache implements TokenCache {
  private entries = new Map<string, TokenCacheEntry>();
  closed = false;

  get(key: string): Promise<TokenCacheEntry | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    this.entries.set(key, entry);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.entries.has(key));
  }

  stats(): Promise<CacheStats> {
    return Promise.resolve({
      hits: 0,
      misses: 0,
      size: this.entries.size,
      type: "redis",
    });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

describe("proxy cache factory", () => {
  let previousCacheType: string | undefined;

  beforeEach(() => {
    reset();
    previousCacheType = Deno.env.get("CACHE_TYPE");
    Deno.env.delete("CACHE_TYPE");
  });

  afterEach(() => {
    reset();
    if (previousCacheType === undefined) Deno.env.delete("CACHE_TYPE");
    else Deno.env.set("CACHE_TYPE", previousCacheType);
  });

  it("constructs an explicitly configured memory cache", async () => {
    const cache = await createCache({
      type: "memory",
      options: { maxSize: 10, cleanupInterval: 0 },
    });

    assertEquals(cache instanceof MemoryCache, true);
    await cache.close();
  });

  it("fails closed when Redis is selected without its extension contract", async () => {
    await assertRejects(
      () => createCache({ type: "redis" }),
      Error,
      "no TokenCacheStore is registered",
    );

    Deno.env.set("CACHE_TYPE", "redis");
    await assertRejects(
      () => createCacheFromEnv(),
      Error,
      "no TokenCacheStore is registered",
    );
  });

  it("wraps a registered Redis contract with stable tracing", async () => {
    const backend = new FakeTokenCache();
    register<TokenCache>("TokenCacheStore", backend);
    const cache = await createCache({ type: "redis" });

    assertEquals(cache instanceof TracingTokenCache, true);
    await cache.set("key", {
      token: "token",
      expiresAt: Date.now() + 60_000,
      scope: "production",
    });
    assertEquals((await cache.get("key"))?.token, "token");
    await cache.close();
    assertEquals(backend.closed, true);
  });

  it("closes created Redis stores but leaves borrowed stores open", async () => {
    Deno.env.set("CACHE_TYPE", "redis");
    const created = new FakeTokenCache();
    const ownedCache = await createCacheFromEnv({
      redisStore: Object.freeze({ kind: "created", store: created }),
    });
    await ownedCache.close();
    assertEquals(created.closed, true);

    const borrowed = new FakeTokenCache();
    const borrowedCache = await createCacheFromEnv({
      redisStore: Object.freeze({ kind: "borrowed", store: borrowed }),
    });
    await borrowedCache.close();
    assertEquals(borrowed.closed, false);
  });

  it("rejects unknown cache types and obsolete inline Redis options", async () => {
    await assertRejects(
      () => createCache({ type: "unknown" } as never),
      TypeError,
      "memory or redis",
    );

    await assertRejects(
      () =>
        createCache({
          type: "redis",
          options: { url: "redis://localhost" },
        } as never),
      TypeError,
      "ext-cache-redis",
    );

    Deno.env.set("CACHE_TYPE", "Memory");
    await assertRejects(
      () => createCacheFromEnv(),
      TypeError,
      "CACHE_TYPE",
    );
  });

  it("rejects dynamic and misspelled factory options without coercion", async () => {
    let typeCoercions = 0;
    const hostileType = {
      toString() {
        typeCoercions++;
        return "memory";
      },
    };
    await assertRejects(
      () => createCache({ type: hostileType } as never),
      TypeError,
      "memory or redis",
    );
    assertEquals(typeCoercions, 0);

    await assertRejects(
      () => createCache({ type: "memory", option: {} } as never),
      TypeError,
      "unknown option",
    );

    let optionReads = 0;
    const accessorOptions = Object.defineProperty(
      { type: "memory" },
      "options",
      {
        get() {
          optionReads++;
          return {};
        },
      },
    );
    await assertRejects(
      () => createCache(accessorOptions as never),
      TypeError,
      "data property",
    );
    assertEquals(optionReads, 0);
  });
});
