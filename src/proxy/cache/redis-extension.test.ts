import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type {
  TokenCacheEntry,
  TokenCacheStats,
  TokenCacheStore,
} from "../../extensions/cache/index.ts";
import { ensureRedisTokenCacheStoreFromEnv } from "./redis-extension.ts";

class FakeRedisStore implements TokenCacheStore {
  closed = false;

  get(_key: string): Promise<TokenCacheEntry | null> {
    return Promise.resolve(null);
  }

  set(_key: string, _entry: TokenCacheEntry): Promise<void> {
    return Promise.resolve();
  }

  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }

  has(_key: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  stats(): Promise<TokenCacheStats> {
    return Promise.resolve({
      hits: 0,
      misses: 0,
      size: 0,
      type: "redis",
    });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function environment(
  values: Readonly<Record<string, string | undefined>>,
): (name: string) => string | undefined {
  return (name) => values[name];
}

describe("Redis cache extension bootstrap", () => {
  it("does nothing when Redis is not explicitly selected", async () => {
    let imports = 0;
    const result = await ensureRedisTokenCacheStoreFromEnv({
      readEnv: environment({ CACHE_TYPE: "memory" }),
      importModule: () => {
        imports++;
        return Promise.resolve({});
      },
    });

    assertEquals(result, null);
    assertEquals(imports, 0);
  });

  it("reuses an already registered store without requiring duplicate config", async () => {
    const existing = new FakeRedisStore();
    let imports = 0;
    const result = await ensureRedisTokenCacheStoreFromEnv({
      readEnv: environment({ CACHE_TYPE: "redis" }),
      resolveStore: () => existing,
      importModule: () => {
        imports++;
        return Promise.resolve({});
      },
    });

    assertEquals(result, existing);
    assertEquals(imports, 0);
  });

  it("requires a valid Redis URL and namespace", async () => {
    await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({ CACHE_TYPE: "redis" }),
          resolveStore: () => undefined,
        }),
      Error,
      "REDIS_URL is required",
    );
    await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "https://redis.example.com",
          }),
          resolveStore: () => undefined,
        }),
      TypeError,
      "redis:// or rediss://",
    );
    await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://redis.example.com",
            REDIS_PREFIX: "vf:*",
          }),
          resolveStore: () => undefined,
        }),
      TypeError,
      "glob metacharacters",
    );
  });

  it("loads, validates, and registers one configured store", async () => {
    let constructedOptions: Record<string, unknown> | null = null;
    let registered: TokenCacheStore | null = null;
    let importCalls = 0;
    class ConfiguredStore extends FakeRedisStore {
      constructor(options: Record<string, unknown>) {
        super();
        constructedOptions = options;
      }
    }

    const store = await ensureRedisTokenCacheStoreFromEnv({
      readEnv: environment({
        CACHE_TYPE: "redis",
        REDIS_URL: "rediss://redis.example.com:6380/1",
        REDIS_PREFIX: "vf:test:",
        REDIS_PASSWORD: "secret",
      }),
      resolveStore: () => undefined,
      registerStore: (value) => {
        registered = value;
      },
      importModule: () => {
        importCalls++;
        return Promise.resolve({ RedisTokenCacheStore: ConfiguredStore });
      },
    });

    assertEquals(store, registered);
    assertEquals(importCalls, 1);
    assertEquals(constructedOptions, {
      url: "rediss://redis.example.com:6380/1",
      prefix: "vf:test:",
      password: "secret",
    });
    assertEquals(Object.isFrozen(constructedOptions), true);
  });

  it("does not invoke an accessor masquerading as the store export", async () => {
    let reads = 0;
    const module = Object.defineProperty({}, "RedisTokenCacheStore", {
      get() {
        reads++;
        return FakeRedisStore;
      },
    });

    await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://redis.example.com",
          }),
          resolveStore: () => undefined,
          importModule: () => Promise.resolve(module),
        }),
      Error,
      "data property",
    );
    assertEquals(reads, 0);
  });

  it("rejects malformed stores before registration", async () => {
    let registrations = 0;
    class MalformedStore {
      get(): Promise<null> {
        return Promise.resolve(null);
      }
    }

    await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://redis.example.com",
          }),
          resolveStore: () => undefined,
          registerStore: () => {
            registrations++;
          },
          importModule: () => Promise.resolve({ RedisTokenCacheStore: MalformedStore }),
        }),
      Error,
      "Failed to initialize",
    );
    assertEquals(registrations, 0);
  });

  it("closes a new store if contract registration fails", async () => {
    const captured: { store: FakeRedisStore | null } = { store: null };
    class CapturedStore extends FakeRedisStore {
      constructor() {
        super();
        captured.store = this;
      }
    }

    await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://redis.example.com",
          }),
          resolveStore: () => undefined,
          registerStore: () => {
            throw new Error("registration conflict");
          },
          importModule: () => Promise.resolve({ RedisTokenCacheStore: CapturedStore }),
        }),
      Error,
      "Failed to register",
    );
    assertEquals(captured.store?.closed, true);
  });

  it("wraps import failures without exposing Redis credentials", async () => {
    const error = await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://user:supersecret@redis.example.com",
            REDIS_PASSWORD: "another-secret",
          }),
          resolveStore: () => undefined,
          importModule: () => Promise.reject(new Error("module unavailable")),
        }),
      Error,
      "requires @veryfront/ext-cache-redis",
    ) as Error;

    assertEquals(error.message.includes("supersecret"), false);
    assertEquals(error.message.includes("another-secret"), false);
  });
});
