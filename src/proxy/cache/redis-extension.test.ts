import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type {
  TokenCacheEntry,
  TokenCacheStats,
  TokenCacheStore,
} from "../../extensions/cache/index.ts";
import {
  acquireRedisTokenCacheStoreFromEnv,
  ensureRedisTokenCacheStoreFromEnv,
} from "./redis-extension.ts";

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

  it("reports disabled, borrowed, and created ownership explicitly", async () => {
    const disabled = await acquireRedisTokenCacheStoreFromEnv({
      readEnv: environment({ CACHE_TYPE: "memory" }),
    });
    assertEquals(disabled, { kind: "disabled", store: null });

    const existing = new FakeRedisStore();
    const borrowed = await acquireRedisTokenCacheStoreFromEnv({
      readEnv: environment({ CACHE_TYPE: "redis" }),
      resolveStore: () => existing,
    });
    assertEquals(borrowed.kind, "borrowed");
    assertStrictEquals(borrowed.store, existing);

    let registered: TokenCacheStore | undefined;
    const created = await acquireRedisTokenCacheStoreFromEnv({
      readEnv: environment({
        CACHE_TYPE: "redis",
        REDIS_URL: "redis://redis.example.com",
      }),
      resolveStore: () => undefined,
      registerStore: (store) => {
        registered = store;
      },
      importModule: () =>
        Promise.resolve({
          RedisTokenCacheStore: FakeRedisStore,
        }),
    });
    assertEquals(created.kind, "created");
    assertStrictEquals(created.store, registered);
  });

  it("singleflights close ownership for a created store", async () => {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let rawCloseCalls = 0;
    const rawCloseArgumentCounts: number[] = [];
    class SlowCloseStore extends FakeRedisStore {
      override async close(): Promise<void> {
        rawCloseCalls++;
        rawCloseArgumentCounts.push(arguments.length);
        await closeGate;
      }
    }

    const acquisition = await acquireRedisTokenCacheStoreFromEnv({
      readEnv: environment({
        CACHE_TYPE: "redis",
        REDIS_URL: "redis://redis.example.com",
      }),
      resolveStore: () => undefined,
      registerStore: () => {},
      importModule: () => Promise.resolve({ RedisTokenCacheStore: SlowCloseStore }),
    });
    if (acquisition.kind !== "created") {
      throw new Error("Expected a created Redis store");
    }

    const firstClose = acquisition.store.close();
    const secondClose = acquisition.store.close();
    assertStrictEquals(secondClose, firstClose);
    await Promise.resolve();
    assertEquals(rawCloseCalls, 1);

    releaseClose();
    await Promise.all([firstClose, secondClose]);
    assertStrictEquals(acquisition.store.close(), firstClose);
    assertEquals(rawCloseCalls, 1);
    assertEquals(rawCloseArgumentCounts, [0]);
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
    let malformedStore: MalformedStore | undefined;
    class MalformedStore {
      closed = false;

      constructor() {
        malformedStore = this;
      }

      get(): Promise<null> {
        return Promise.resolve(null);
      }

      close(): Promise<void> {
        this.closed = true;
        return Promise.resolve();
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
    assertEquals(malformedStore?.closed, true);
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

  it("uses the validated close snapshot when registration mutates the store", async () => {
    const registrationFailure = new Error("registration conflict");
    let constructed: MutableCloseStore | undefined;
    let closeAccessorReads = 0;
    class MutableCloseStore extends FakeRedisStore {
      closeCalls = 0;

      constructor() {
        super();
        constructed = this;
      }

      override close(): Promise<void> {
        this.closeCalls++;
        return Promise.resolve();
      }
    }

    const failure = await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://redis.example.com",
          }),
          resolveStore: () => undefined,
          registerStore: () => {
            Object.defineProperty(constructed!, "close", {
              configurable: true,
              get() {
                closeAccessorReads++;
                throw new Error("mutable close accessor must not run");
              },
            });
            throw registrationFailure;
          },
          importModule: () => Promise.resolve({ RedisTokenCacheStore: MutableCloseStore }),
        }),
      Error,
      "Failed to register",
    ) as Error;

    assertStrictEquals(failure.cause, registrationFailure);
    assertEquals(constructed?.closeCalls, 1);
    assertEquals(closeAccessorReads, 0);
  });

  it("preserves registration and cleanup failures together", async () => {
    const registrationFailure = new Error("registration conflict");
    const cleanupFailure = new Error("Redis close failed");
    class RejectingCloseStore extends FakeRedisStore {
      override close(): Promise<void> {
        return Promise.reject(cleanupFailure);
      }
    }

    const failure = await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://redis.example.com",
          }),
          resolveStore: () => undefined,
          registerStore: () => {
            throw registrationFailure;
          },
          importModule: () => Promise.resolve({ RedisTokenCacheStore: RejectingCloseStore }),
        }),
      Error,
      "Failed to register",
    ) as Error;

    assertEquals(failure.cause instanceof AggregateError, true);
    assertEquals((failure.cause as AggregateError).errors, [
      registrationFailure,
      cleanupFailure,
    ]);
  });

  it("rolls back a store published by an asynchronous registrar", async () => {
    const registrationFailure = new Error("registration conflict");
    let registered: TokenCacheStore | undefined;
    let constructed: FakeRedisStore | undefined;
    let unregisterCalls = 0;
    class CapturedStore extends FakeRedisStore {
      constructor() {
        super();
        constructed = this;
      }
    }

    const failure = await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://redis.example.com",
          }),
          resolveStore: () => registered,
          registerStore: async (store) => {
            registered = store;
            await Promise.resolve();
            throw registrationFailure;
          },
          unregisterStore: () => {
            unregisterCalls++;
            registered = undefined;
          },
          importModule: () => Promise.resolve({ RedisTokenCacheStore: CapturedStore }),
        }),
      Error,
      "Failed to register",
    ) as Error;

    assertEquals(failure.cause instanceof TypeError, true);
    assertStringIncludes(
      (failure.cause as TypeError).message,
      "must complete synchronously",
    );
    assertEquals(registered, undefined);
    assertEquals(unregisterCalls, 1);
    assertEquals(constructed?.closed, true);
  });

  it("does not wait for a contract-violating registration thenable", async () => {
    let registered: TokenCacheStore | undefined;
    let constructed: FakeRedisStore | undefined;
    class CapturedStore extends FakeRedisStore {
      constructor() {
        super();
        constructed = this;
      }
    }

    let failure: unknown;
    const attempt = ensureRedisTokenCacheStoreFromEnv({
      readEnv: environment({
        CACHE_TYPE: "redis",
        REDIS_URL: "redis://redis.example.com",
      }),
      resolveStore: () => registered,
      registerStore: (store) => {
        registered = store;
        return new Promise<void>(() => {});
      },
      unregisterStore: () => {
        registered = undefined;
      },
      importModule: () => Promise.resolve({ RedisTokenCacheStore: CapturedStore }),
    }).catch((error) => {
      failure = error;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(failure instanceof Error, true);
    assertEquals((failure as Error).cause instanceof TypeError, true);
    assertEquals(registered, undefined);
    assertEquals(constructed?.closed, true);
    await attempt;
  });

  it("preserves registration, registry rollback, and close failures", async () => {
    const registrationFailure = new Error("registration conflict");
    const unregisterFailure = new Error("registry rollback failed");
    const cleanupFailure = new Error("Redis close failed");
    let registered: TokenCacheStore | undefined;
    class RejectingCloseStore extends FakeRedisStore {
      override close(): Promise<void> {
        return Promise.reject(cleanupFailure);
      }
    }

    const failure = await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://redis.example.com",
          }),
          resolveStore: () => registered,
          registerStore: (store) => {
            registered = store;
            throw registrationFailure;
          },
          unregisterStore: () => {
            throw unregisterFailure;
          },
          importModule: () => Promise.resolve({ RedisTokenCacheStore: RejectingCloseStore }),
        }),
      Error,
      "Failed to register",
    ) as Error;

    assertEquals(failure.cause instanceof AggregateError, true);
    assertEquals((failure.cause as AggregateError).errors, [
      registrationFailure,
      unregisterFailure,
      cleanupFailure,
    ]);
    assertEquals(registered !== undefined, true);
  });

  it("preserves invalid-contract and cleanup failures together", async () => {
    const cleanupFailure = new Error("Redis close failed");
    class InvalidRejectingStore {
      get(): Promise<null> {
        return Promise.resolve(null);
      }

      close(): Promise<void> {
        return Promise.reject(cleanupFailure);
      }
    }

    const failure = await assertRejects(
      () =>
        ensureRedisTokenCacheStoreFromEnv({
          readEnv: environment({
            CACHE_TYPE: "redis",
            REDIS_URL: "redis://redis.example.com",
          }),
          resolveStore: () => undefined,
          importModule: () => Promise.resolve({ RedisTokenCacheStore: InvalidRejectingStore }),
        }),
      Error,
      "Failed to initialize",
    ) as Error;

    assertEquals(failure.cause instanceof AggregateError, true);
    const [contractFailure, preservedCleanupFailure] = (failure.cause as AggregateError).errors;
    assertEquals(contractFailure instanceof TypeError, true);
    assertStrictEquals(preservedCleanupFailure, cleanupFailure);
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
