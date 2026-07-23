import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { TokenCacheStore } from "#veryfront/extensions/cache/index.ts";
import { createCache, createCacheFromEnv, ResilientCache } from "./index.ts";
import type { CacheStats, TokenCacheEntry } from "./types.ts";

class FakeTokenCacheStore implements TokenCacheStore {
  private readonly entries = new Map<string, TokenCacheEntry>();
  closeCount = 0;

  get(key: string): Promise<TokenCacheEntry | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    this.entries.set(key, { ...entry });
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
    return Promise.resolve({ hits: 0, misses: 0, size: this.entries.size, type: "redis" });
  }

  close(): Promise<void> {
    this.closeCount++;
    return Promise.resolve();
  }
}

describe("proxy cache factory", () => {
  let previousStore: TokenCacheStore | undefined;
  let previousCacheType: string | undefined;

  beforeEach(() => {
    previousStore = tryResolve<TokenCacheStore>("TokenCacheStore");
    unregister("TokenCacheStore");
    previousCacheType = Deno.env.get("CACHE_TYPE");
    Deno.env.delete("CACHE_TYPE");
  });

  afterEach(() => {
    unregister("TokenCacheStore");
    if (previousStore) register("TokenCacheStore", previousStore);
    if (previousCacheType === undefined) Deno.env.delete("CACHE_TYPE");
    else Deno.env.set("CACHE_TYPE", previousCacheType);
  });

  it("fails fast when Redis is explicitly requested without its extension", async () => {
    await assertRejects(
      () =>
        createCache({
          type: "redis",
          options: { url: "redis://127.0.0.1:6379" },
        }),
      Error,
      "Missing extension",
    );
  });

  it("uses the same resilient Redis composition for explicit and environment factories", async () => {
    const store = new FakeTokenCacheStore();
    register("TokenCacheStore", store);

    const explicit = await createCache({
      type: "redis",
      options: { url: "redis://127.0.0.1:6379" },
    });
    Deno.env.set("CACHE_TYPE", "redis");
    const fromEnvironment = await createCacheFromEnv();

    assertEquals(explicit instanceof ResilientCache, true);
    assertEquals(fromEnvironment instanceof ResilientCache, true);
    await explicit.close();
    await fromEnvironment.close();
    assertEquals(store.closeCount, 2);
  });

  it("rejects unsupported CACHE_TYPE values instead of silently selecting memory", async () => {
    Deno.env.set("CACHE_TYPE", "memroy");
    await assertRejects(() => createCacheFromEnv(), TypeError, "CACHE_TYPE");
  });

  it("rejects malformed direct factory selections", async () => {
    await assertRejects(
      () => createCache({ type: "disk" } as never),
      TypeError,
      "cache type",
    );
    await assertRejects(
      () => createCache(null as never),
      TypeError,
      "options",
    );
  });
});
