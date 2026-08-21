import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildRevisionedCacheKey,
  CacheValueTooLargeError,
  isRevisionedCacheBackend,
  MAX_CACHE_REVISION_LENGTH,
  MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH,
  REVISIONED_CACHE_KEY_PREFIX,
} from "veryfront/extensions/distributed/cache-support";
import { MAX_CACHE_TTL_SECONDS } from "#veryfront/cache/backends/ttl.ts";
import { compileCacheGlob } from "#veryfront/cache/backends/glob.ts";
import {
  buildPreparedProjectCSSCacheKey,
  buildPreparedProjectCSSCacheScopePrefix,
  buildProjectCSSCacheKey,
  buildProjectCSSCacheScopePrefix,
} from "#veryfront/cache/keys/project-css.ts";
import { RedisCacheBackend } from "./cache-backend.ts";
import type { RedisClient, RedisClientManager } from "./redis-client-manager.ts";

const SUPPORTED_SERVER_INFO = "# Server\r\nredis_version:7.4.1\r\nredis_mode:standalone\r\n";
const STANDALONE_CLUSTER_INFO = "# Cluster\r\ncluster_enabled:0\r\n";
const NO_EVICTION_MEMORY_INFO = "# Memory\r\nmaxmemory_policy:noeviction\r\n";
const TEST_PREFIX = "vf:cache:test:";
const TEST_COUNTER_KEY = `\0vf:cache:atomic:v1:counter:${TEST_PREFIX}`;

interface TestRedisClient extends RedisClient {
  readonly values: Map<string, string>;
}

function createRedisClient(
  overrides: Partial<RedisClient> = {},
): TestRedisClient {
  const values = new Map<string, string>();
  const client: TestRedisClient = {
    values,
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    get: (key) => Promise.resolve(values.get(key) ?? null),
    mGet: (keys) => Promise.resolve(keys.map((key) => values.get(key) ?? null)),
    set: (key, value, options) => {
      if (options?.NX && values.has(key)) return Promise.resolve(null);
      values.set(key, value);
      return Promise.resolve("OK");
    },
    del: (keys) => {
      let deleted = 0;
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (values.delete(key)) deleted++;
      }
      return Promise.resolve(deleted);
    },
    scan: () => Promise.resolve({ cursor: 0, keys: [] }),
    expire: () => Promise.resolve(1),
    ttl: () => Promise.resolve(-1),
    incr: () => Promise.reject(new Error("unexpected Redis INCR")),
    pExpire: () => Promise.reject(new Error("unexpected Redis PEXPIRE")),
    pTTL: () => Promise.reject(new Error("unexpected Redis PTTL")),
    eval: () => Promise.reject(new Error("unexpected Redis EVAL")),
    info: (section) => {
      if (section === "server") return Promise.resolve(SUPPORTED_SERVER_INFO);
      if (section === "cluster") return Promise.resolve(STANDALONE_CLUSTER_INFO);
      if (section === "memory") return Promise.resolve(NO_EVICTION_MEMORY_INFO);
      return Promise.resolve("");
    },
    isOpen: true,
    ...overrides,
  };
  return client;
}

function createManager(
  client: RedisClient,
  options: { configured?: boolean; onAcquire?: () => void; onDisconnect?: () => void } = {},
): RedisClientManager {
  return {
    getClient: () => {
      options.onAcquire?.();
      return Promise.resolve(client);
    },
    disconnect: () => {
      options.onDisconnect?.();
      return Promise.resolve();
    },
    isConfigured: () => options.configured ?? true,
  };
}

function createBackend(
  overrides: Partial<RedisClient> = {},
  options: {
    prefix?: string;
    configured?: boolean;
    onAcquire?: () => void;
    onDisconnect?: () => void;
  } = {},
): { backend: RedisCacheBackend; client: TestRedisClient } {
  const client = createRedisClient(overrides);
  const backend = new RedisCacheBackend(options.prefix ?? TEST_PREFIX, {
    clientManager: createManager(client, options),
  });
  return { backend, client };
}

function record(state: "p" | "a", revision: string, payload = ""): string {
  return `\0VFCAS1\0${state}\0${revision}\0${payload}`;
}

type EvalCall = {
  script: string;
  options: { keys: string[]; arguments: string[] };
};

class StatefulAtomicRedisClient implements RedisClient {
  readonly evalCalls: EvalCall[] = [];
  readonly infoCalls: Array<string | undefined> = [];
  readonly setCalls: Array<{
    key: string;
    value: string;
    options?: { EX?: number; NX?: boolean };
  }> = [];
  readonly records = new Map<
    string,
    { kind: "present" | "absent"; revision: string; value?: string; expiresAtMs: number }
  >();
  counter: string | null = null;
  counterTtl = -1;
  nowMs = 1_000;
  ordinaryGetCalls = 0;
  ordinarySetCalls = 0;
  ordinaryDeleteCalls = 0;
  isOpen = true;

  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    this.ordinaryGetCalls++;
    return Promise.resolve(key === TEST_COUNTER_KEY ? this.counter : null);
  }

  mGet(keys: string[]): Promise<Array<string | null>> {
    return Promise.resolve(keys.map(() => null));
  }

  set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean },
  ): Promise<string | null> {
    this.ordinarySetCalls++;
    this.setCalls.push({ key, value, options });
    if (key === TEST_COUNTER_KEY) {
      if (options?.NX && this.counter !== null) return Promise.resolve(null);
      this.counter = value;
    }
    return Promise.resolve("OK");
  }

  del(keys: string | string[]): Promise<number> {
    this.ordinaryDeleteCalls++;
    let deleted = 0;
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (key === TEST_COUNTER_KEY && this.counter !== null) {
        this.counter = null;
        deleted++;
      } else if (this.records.delete(key)) {
        deleted++;
      }
    }
    return Promise.resolve(deleted);
  }

  scan(): Promise<{ cursor: number; keys: string[] }> {
    return Promise.resolve({ cursor: 0, keys: [] });
  }

  expire(): Promise<number> {
    return Promise.resolve(1);
  }

  ttl(key: string): Promise<number> {
    return Promise.resolve(key === TEST_COUNTER_KEY ? this.counterTtl : -1);
  }

  incr(): Promise<number> {
    return Promise.reject(new Error("unexpected Redis INCR"));
  }

  pExpire(): Promise<boolean> {
    return Promise.reject(new Error("unexpected Redis PEXPIRE"));
  }

  pTTL(): Promise<number> {
    return Promise.reject(new Error("unexpected Redis PTTL"));
  }

  info(section?: "server" | "memory" | "cluster"): Promise<string> {
    this.infoCalls.push(section);
    if (section === "server") return Promise.resolve(SUPPORTED_SERVER_INFO);
    if (section === "cluster") return Promise.resolve(STANDALONE_CLUSTER_INFO);
    if (section === "memory") return Promise.resolve(NO_EVICTION_MEMORY_INFO);
    return Promise.resolve("");
  }

  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    this.evalCalls.push({
      script,
      options: { keys: [...options.keys], arguments: [...options.arguments] },
    });
    if (this.counter === null) return Promise.reject(new Error("atomic counter is missing"));
    if (this.counterTtl !== -1) return Promise.reject(new Error("atomic counter must not expire"));
    if (!/^(0|[1-9]\d*)$/.test(this.counter)) {
      return Promise.reject(new Error("atomic counter is malformed"));
    }
    if (
      this.counter.length > 19 ||
      (this.counter.length === 19 && this.counter > "9223372036854775807")
    ) {
      return Promise.reject(new Error("atomic counter is out of range"));
    }

    const [dataKey] = options.keys;
    const existing = this.readRecord(dataKey!);
    if (options.arguments.length === 0) {
      const current = existing ?? this.writeAbsent(dataKey!);
      return Promise.resolve(
        current.kind === "present" ? [1, current.revision, current.value] : [0, current.revision],
      );
    }

    const [expectedRevision, operation, value, deadline] = options.arguments;
    if (!existing) {
      this.writeAbsent(dataKey!);
      return Promise.resolve(0);
    }
    if (existing.revision !== expectedRevision) return Promise.resolve(0);
    const revision = this.allocateRevision();
    if (operation === "d" && options.arguments.length === 2) {
      this.records.set(dataKey!, {
        kind: "absent",
        revision,
        expiresAtMs: this.nowMs + 300_000,
      });
      return Promise.resolve(1);
    }
    if (operation !== "s" || options.arguments.length !== 4 || deadline === undefined) {
      return Promise.reject(new Error("invalid atomic mutation"));
    }
    const expiresAtMs = Number(deadline);
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
      return Promise.reject(new Error("invalid atomic deadline"));
    }
    if (expiresAtMs <= this.nowMs) {
      this.records.set(dataKey!, {
        kind: "absent",
        revision,
        expiresAtMs: this.nowMs + 300_000,
      });
    } else {
      this.records.set(dataKey!, {
        kind: "present",
        revision,
        value: value!,
        expiresAtMs,
      });
    }
    return Promise.resolve(1);
  }

  private readRecord(key: string) {
    const current = this.records.get(key);
    if (current && current.expiresAtMs <= this.nowMs) {
      this.records.delete(key);
      return undefined;
    }
    return current;
  }

  private writeAbsent(key: string) {
    const current = {
      kind: "absent" as const,
      revision: this.allocateRevision(),
      expiresAtMs: this.nowMs + 300_000,
    };
    this.records.set(key, current);
    return current;
  }

  private allocateRevision(): string {
    const next = BigInt(this.counter!) + 1n;
    if (next > 9_223_372_036_854_775_807n) throw new Error("atomic counter overflow");
    this.counter = next.toString();
    return this.counter;
  }
}

describe("RedisCacheBackend ordinary cache behavior", () => {
  it("keeps the redis type and validates namespace boundaries", () => {
    assertEquals(new RedisCacheBackend().type, "redis");
    assertThrows(() => new RedisCacheBackend("vf:ambiguous"), TypeError, "end with ':'");
    assertThrows(
      () => new RedisCacheBackend("vf:unsafe:\n"),
      TypeError,
      "control characters",
    );
  });

  it("returns fail-soft misses when no Redis client is configured", async () => {
    const { backend } = createBackend({}, { configured: false });

    assertEquals(await backend.get("any-key"), null);
    assertEquals(
      await backend.getBatch(["a", "b"]),
      new Map([["a", null], ["b", null]]),
    );
    await assertRejects(() => backend.set("key", "value"), Error, "not configured");
    await assertRejects(() => backend.del("key"), Error, "not configured");
    await assertRejects(() => backend.delByPattern("*"), Error, "not configured");
  });

  it("uses one atomic STRLEN and GET script for ordinary bounded reads", async () => {
    const evalCalls: Array<{ script: string; keys: string[]; arguments: string[] }> = [];
    let ordinaryGets = 0;
    const { backend } = createBackend({
      get: () => {
        ordinaryGets++;
        return Promise.resolve("must-not-read");
      },
      eval: (script, options) => {
        evalCalls.push({
          script,
          keys: [...options.keys],
          arguments: [...options.arguments],
        });
        if (options.keys[0]?.endsWith(":missing")) return Promise.resolve([0]);
        if (options.keys[0]?.endsWith(":empty")) return Promise.resolve([1, ""]);
        return Promise.resolve(options.arguments[0] === "1" ? [2, "2"] : [1, "é"]);
      },
    });

    assertEquals(await backend.getWithinLimit("missing", 0), null);
    assertEquals(await backend.getWithinLimit("empty", 0), "");
    assertEquals(await backend.getWithinLimit("unicode", 2), "é");
    const overflow = await assertRejects(
      () => backend.getWithinLimit("unicode", 1),
      CacheValueTooLargeError,
      "1 UTF-8 bytes",
    );
    assertEquals(
      overflow instanceof CacheValueTooLargeError ? overflow.maximumBytes : null,
      1,
    );
    assertEquals(ordinaryGets, 0);
    assertEquals(evalCalls.length, 4);
    assertEquals(evalCalls[2]?.keys, [`${TEST_PREFIX}unicode`]);
    assertEquals(evalCalls.map(({ arguments: args }) => args), [
      ["0", "ordinary"],
      ["0", "ordinary"],
      ["2", "ordinary"],
      ["1", "ordinary"],
    ]);
    assertEquals(evalCalls[0]?.script.includes("STRLEN"), true);
    assertEquals(evalCalls[0]?.script.includes("GET"), true);
  });

  it("returns only an admitted logical payload for bounded revisioned reads", async () => {
    const evalCalls: Array<{ script: string; keys: string[]; arguments: string[] }> = [];
    const key = buildRevisionedCacheKey("unicode");
    const { backend } = createBackend({
      eval: (script, options) => {
        evalCalls.push({
          script,
          keys: [...options.keys],
          arguments: [...options.arguments],
        });
        return Promise.resolve(options.arguments[0] === "1" ? [2, "2"] : [1, "é"]);
      },
    });

    assertEquals(await backend.getWithinLimit(key, 2), "é");
    await assertRejects(
      () => backend.getWithinLimit(key, 1),
      CacheValueTooLargeError,
      "1 UTF-8 bytes",
    );
    assertEquals(evalCalls.map(({ arguments: args }) => args), [
      ["2", "revisioned"],
      ["1", "revisioned"],
    ]);
    assertEquals(evalCalls[0]?.keys, [`${TEST_PREFIX}${key}`]);
    assertEquals(evalCalls[0]?.script.includes("GETRANGE"), true);
  });

  it("post-verifies UTF-8 boundaries including lone surrogates", async () => {
    const value = "\ud800x\udc00y😀";
    let evalCalls = 0;
    let ordinaryGets = 0;
    let disconnects = 0;
    const { backend } = createBackend({
      get: () => {
        ordinaryGets++;
        return Promise.resolve("must-not-read");
      },
      eval: () => {
        evalCalls++;
        return Promise.resolve([1, value]);
      },
    }, { onDisconnect: () => disconnects++ });

    assertEquals(await backend.getWithinLimit("surrogates", 12), value);
    await assertRejects(
      () => backend.getWithinLimit("surrogates", 11),
      CacheValueTooLargeError,
      "11 UTF-8 bytes",
    );
    assertEquals(evalCalls, 2);
    assertEquals(ordinaryGets, 0);
    assertEquals(disconnects, 0);
  });

  it("resets malformed overflow responses without classifying them as typed overflow", async () => {
    for (const response of [[2, "1"], [2, "02"], [2, ""]]) {
      let disconnects = 0;
      const { backend } = createBackend({
        eval: () => Promise.resolve(response),
      }, { onDisconnect: () => disconnects++ });

      assertEquals(await backend.getWithinLimit("oversized", 1), null);
      assertEquals(disconnects, 1);
    }

    let disconnects = 0;
    const { backend } = createBackend({
      eval: () => Promise.resolve([2, "2"]),
    }, { onDisconnect: () => disconnects++ });
    await assertRejects(
      () => backend.getWithinLimit("oversized", 1),
      CacheValueTooLargeError,
    );
    assertEquals(disconnects, 0);
  });

  it("translates Redis TTL sentinel values", async () => {
    let ttl = 12;
    const keys: string[] = [];
    const { backend } = createBackend({
      ttl: (key) => {
        keys.push(key);
        return Promise.resolve(ttl);
      },
    });

    assertEquals(await backend.getRemainingTtlSeconds("key"), 12);
    ttl = -1;
    assertEquals(await backend.getRemainingTtlSeconds("key"), Infinity);
    ttl = -2;
    assertEquals(await backend.getRemainingTtlSeconds("key"), null);
    assertEquals(keys, [`${TEST_PREFIX}key`, `${TEST_PREFIX}key`, `${TEST_PREFIX}key`]);
  });

  it("expires non-positive TTL entries without SET EX 0", async () => {
    const store = new Map<string, string>();
    const setExpiries: number[] = [];
    const { backend } = createBackend({
      get: (key) => Promise.resolve(store.get(key) ?? null),
      mGet: (keys) => Promise.resolve(keys.map((key) => store.get(key) ?? null)),
      set: (key, value, options) => {
        setExpiries.push(options?.EX ?? Number.NaN);
        store.set(key, value);
        return Promise.resolve("OK");
      },
      del: (keys) => {
        let deleted = 0;
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (store.delete(key)) deleted++;
        }
        return Promise.resolve(deleted);
      },
    });

    await backend.set("existing", "old", 60);
    await backend.set("existing", "replacement", 0);
    await backend.set("fractional", "value", 0.1);
    await backend.setBatch([
      { key: "negative", value: "value", ttl: -1 },
      { key: "positive", value: "value", ttl: 30 },
      { key: "fractional-batch", value: "value", ttl: 1.01 },
    ]);

    assertEquals(await backend.get("existing"), null);
    assertEquals(
      await backend.getBatch(["negative", "positive"]),
      new Map([["negative", null], ["positive", "value"]]),
    );
    assertEquals(setExpiries, [60, 1, 30, 2]);
  });

  it("waits for every batch write before reporting a failure", async () => {
    let releaseSlowWrite!: () => void;
    const slowWriteReleased = new Promise<void>((resolve) => releaseSlowWrite = resolve);
    let markSlowWriteStarted!: () => void;
    const slowWriteStarted = new Promise<void>((resolve) => markSlowWriteStarted = resolve);
    let disconnects = 0;
    const { backend } = createBackend({
      set: async (key) => {
        if (key.endsWith(":failed")) throw new Error("redis set failed");
        markSlowWriteStarted();
        await slowWriteReleased;
        return "OK";
      },
    }, { onDisconnect: () => disconnects++ });
    let settled = false;

    const write = backend.setBatch([
      { key: "failed", value: "value" },
      { key: "slow", value: "value" },
    ]).then(
      () => null,
      (error: unknown) => error,
    ).finally(() => settled = true);
    await slowWriteStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settledBeforeSibling = settled;
    releaseSlowWrite();

    assertEquals(settledBeforeSibling, false);
    const error = await write;
    assertEquals(error instanceof Error, true);
    assertEquals(error instanceof Error ? error.message : null, "redis set failed");
    assertEquals(disconnects, 1);
  });

  it("propagates write and deletion failures and resets the manager", async () => {
    let disconnects = 0;
    const failingWrite = createBackend({
      set: () => Promise.reject(new Error("redis set failed")),
    }, { onDisconnect: () => disconnects++ }).backend;
    await assertRejects(() => failingWrite.set("key", "value"), Error, "redis set failed");

    const failingDelete = createBackend({
      del: () => Promise.reject(new Error("redis delete failed")),
    }, { onDisconnect: () => disconnects++ }).backend;
    await assertRejects(() => failingDelete.del("key"), Error, "redis delete failed");

    const failingScan = createBackend({
      scan: () => Promise.reject(new Error("redis scan failed")),
    }, { onDisconnect: () => disconnects++ }).backend;
    await assertRejects(() => failingScan.delByPattern("*"), Error, "redis scan failed");
    assertEquals(disconnects, 3);
  });

  it("reacquires a client after command failure", async () => {
    let active = 0;
    let disconnects = 0;
    const written: string[] = [];
    const clients = [
      createRedisClient({ set: () => Promise.reject(new Error("stale connection")) }),
      createRedisClient({
        set: (key) => {
          written.push(key);
          return Promise.resolve("OK");
        },
      }),
    ];
    const manager: RedisClientManager = {
      getClient: () => Promise.resolve(clients[Math.min(active, clients.length - 1)]!),
      disconnect: () => {
        disconnects++;
        active++;
        return Promise.resolve();
      },
      isConfigured: () => true,
    };
    const backend = new RedisCacheBackend(TEST_PREFIX, { clientManager: manager });

    await assertRejects(() => backend.set("page", "first"), Error, "stale connection");
    await backend.set("page", "second");

    assertEquals(disconnects, 1);
    assertEquals(written, [`${TEST_PREFIX}page`]);
  });

  it("rejects oversized batches and validates all TTLs before acquiring a client", async () => {
    const { backend } = createBackend({}, { configured: false });
    const keys = Array.from({ length: 101 }, (_, index) => `key-${index}`);

    await assertRejects(() => backend.getBatch(keys), RangeError, "at most 100 items");
    await assertRejects(
      () => backend.setBatch(keys.map((key) => ({ key, value: "value" }))),
      RangeError,
      "at most 100 items",
    );
    await assertRejects(
      () => backend.setBatch([{ key: "valid", value: "value", ttl: 60 }]),
      Error,
      "not configured",
    );
    await assertRejects(
      () => backend.setBatch([{ key: "key", value: "value", ttl: Number.NaN }]),
      RangeError,
      "finite number of seconds",
    );
    await assertRejects(
      () =>
        backend.setBatch([
          { key: "valid", value: "value", ttl: 60 },
          { key: "unsafe", value: "value", ttl: MAX_CACHE_TTL_SECONDS + 1 },
        ]),
      RangeError,
      "finite number of seconds at most",
    );
    await backend.setBatch([]);
    assertEquals((await backend.getBatch([])).size, 0);
  });

  it("uses one MGET and falls back to fail-soft GET operations", async () => {
    const mGetCalls: string[][] = [];
    const { backend } = createBackend({
      mGet: (keys) => {
        mGetCalls.push([...keys]);
        return Promise.resolve(["value-a", null, "value-c"]);
      },
    });
    assertEquals(
      await backend.getBatch(["a", "b", "c"]),
      new Map([
        ["a", "value-a"],
        ["b", null],
        ["c", "value-c"],
      ]),
    );
    assertEquals(mGetCalls, [[`${TEST_PREFIX}a`, `${TEST_PREFIX}b`, `${TEST_PREFIX}c`]]);

    const getCalls: string[] = [];
    const fallback = createBackend({
      mGet: () => Promise.reject(new Error("MGET unavailable")),
      get: (key) => {
        getCalls.push(key);
        return Promise.resolve(key.endsWith(":b") ? null : `single:${key}`);
      },
    }).backend;
    const values = await fallback.getBatch(["a", "b", "c"]);
    assertEquals(getCalls, [`${TEST_PREFIX}a`, `${TEST_PREFIX}b`, `${TEST_PREFIX}c`]);
    assertEquals(
      values,
      new Map([
        ["a", `single:${TEST_PREFIX}a`],
        ["b", null],
        ["c", `single:${TEST_PREFIX}c`],
      ]),
    );
  });

  it("decodes revisioned frames for ordinary reads and fails closed on malformed frames", async () => {
    let disconnects = 0;
    const reserved = buildRevisionedCacheKey("module");
    const malformed = buildRevisionedCacheKey("malformed");
    const { backend } = createBackend({
      get: (key) => {
        if (key.endsWith(reserved)) return Promise.resolve(record("p", "7", "payload\0raw"));
        if (key.endsWith(malformed)) return Promise.resolve("legacy-unframed");
        return Promise.resolve(null);
      },
      mGet: () =>
        Promise.resolve([
          record("p", "8", "batch-value"),
          record("a", "9"),
        ]),
    }, { onDisconnect: () => disconnects++ });

    assertEquals(await backend.get(reserved), "payload\0raw");
    assertEquals(await backend.get(malformed), null);
    assertEquals(
      await backend.getBatch([
        buildRevisionedCacheKey("present"),
        buildRevisionedCacheKey("absent"),
      ]),
      new Map([
        [buildRevisionedCacheKey("present"), "batch-value"],
        [buildRevisionedCacheKey("absent"), null],
      ]),
    );
    assertEquals(disconnects, 1);
  });

  it("fails closed when ordinary reads target any malformed prefix-owned key", async () => {
    const malformedKeys = [
      REVISIONED_CACHE_KEY_PREFIX,
      `${REVISIONED_CACHE_KEY_PREFIX}control\0suffix`,
      `${REVISIONED_CACHE_KEY_PREFIX}${REVISIONED_CACHE_KEY_PREFIX}nested`,
      `${REVISIONED_CACHE_KEY_PREFIX}${"x".repeat(MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH + 1)}`,
    ];
    let disconnects = 0;
    const { backend } = createBackend({
      get: () => Promise.resolve(record("p", "7", "must-not-leak")),
      mGet: (keys) => Promise.resolve(keys.map(() => record("p", "8", "must-not-leak"))),
    }, { onDisconnect: () => disconnects++ });

    for (const key of malformedKeys) {
      assertEquals(await backend.get(key), null);
    }
    assertEquals(
      await backend.getBatch(malformedKeys),
      new Map(malformedKeys.map((key) => [key, null])),
    );
    assertEquals(disconnects > 0, true);
  });

  it("rejects every prefix-owned ordinary write and the whole batch before client acquisition", async () => {
    let acquisitions = 0;
    let writes = 0;
    const { backend } = createBackend({
      set: () => {
        writes++;
        return Promise.resolve("OK");
      },
    }, { onAcquire: () => acquisitions++ });
    const reservedKeys = [
      buildRevisionedCacheKey("module"),
      REVISIONED_CACHE_KEY_PREFIX,
      `${REVISIONED_CACHE_KEY_PREFIX}control\0suffix`,
      `${REVISIONED_CACHE_KEY_PREFIX}${REVISIONED_CACHE_KEY_PREFIX}nested`,
      `${REVISIONED_CACHE_KEY_PREFIX}${"x".repeat(MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH + 1)}`,
    ];

    for (const key of reservedKeys) {
      await assertRejects(() => backend.set(key, "value"), TypeError, "reserved");
      await assertRejects(
        () =>
          backend.setBatch([
            { key: "ordinary-sibling", value: "value" },
            { key, value: "reserved" },
          ]),
        TypeError,
        "reserved",
      );
    }
    assertEquals(acquisitions, 0);
    assertEquals(writes, 0);
  });

  it("allows explicit broad invalidation of a reserved physical record", async () => {
    const reserved = buildRevisionedCacheKey("module");
    const { backend, client } = createBackend();
    client.values.set(`${TEST_PREFIX}${reserved}`, record("a", "1"));

    await backend.del(reserved);

    assertEquals(client.values.has(`${TEST_PREFIX}${reserved}`), false);
  });
});

describe("RedisCacheBackend pattern deletion", () => {
  it("escapes only its literal namespace prefix", async () => {
    let match = "";
    const { backend } = createBackend({
      scan: (_cursor, options) => {
        match = options?.MATCH ?? "";
        return Promise.resolve({ cursor: 0, keys: [] });
      },
    }, { prefix: "vf:cache:te*st?:" });

    assertEquals(await backend.delByPattern("project:*"), 0);
    assertEquals(match, "vf:cache:te\\*st\\?:project:*");
  });

  it("isolates framed CSS scopes containing Redis glob metacharacters", async () => {
    const digest = "a".repeat(64);
    const suffix = "scope-suffix";
    const cases = [
      {
        targetKey: buildProjectCSSCacheKey({
          projectScope: `*${suffix}`,
          environment: "preview-vf-sanitized",
          stylesheetHash: digest,
          candidatesHash: digest,
          profileHash: digest,
        }),
        unrelatedKey: buildProjectCSSCacheKey({
          projectScope: `other-${suffix}`,
          environment: "preview",
          stylesheetHash: digest,
          candidatesHash: digest,
          profileHash: digest,
        }),
        pattern: `${buildProjectCSSCacheScopePrefix(`*${suffix}`)}*`,
      },
      ...[
        [`colon:${suffix}`, `colon-parent-${suffix}`],
        [`Malmö/東京-${suffix}`, `Malmö/大阪-${suffix}`],
        [`lone-high-\ud800-${suffix}`, `replacement-�-${suffix}`],
        ["a".repeat(256), `${"a".repeat(255)}b`],
      ].map(([projectScope, unrelatedScope]) => ({
        targetKey: buildProjectCSSCacheKey({
          projectScope: projectScope!,
          environment: "preview",
          stylesheetHash: digest,
          candidatesHash: digest,
          profileHash: digest,
        }),
        unrelatedKey: buildProjectCSSCacheKey({
          projectScope: unrelatedScope!,
          environment: "preview",
          stylesheetHash: digest,
          candidatesHash: digest,
          profileHash: digest,
        }),
        pattern: `${buildProjectCSSCacheScopePrefix(projectScope!)}*`,
      })),
      {
        targetKey: buildPreparedProjectCSSCacheKey({
          projectScope: `?${suffix}`,
          environment: "preview-vf-sanitized",
          identityHash: digest,
        }),
        unrelatedKey: buildPreparedProjectCSSCacheKey({
          projectScope: `x${suffix}`,
          environment: "preview",
          identityHash: digest,
        }),
        pattern: `${buildPreparedProjectCSSCacheScopePrefix(`?${suffix}`)}*`,
      },
    ];

    for (const entry of cases) {
      const remaining = new Set([
        `${TEST_PREFIX}${entry.targetKey}`,
        `${TEST_PREFIX}${entry.unrelatedKey}`,
      ]);
      const { backend } = createBackend({
        scan: (_cursor, options) => {
          const glob = compileCacheGlob(options?.MATCH ?? "")!;
          return Promise.resolve({
            cursor: 0,
            keys: [...remaining].filter((key) => glob.test(key)),
          });
        },
        eval: (_script, options) => {
          let deleted = 0;
          for (const key of options.keys) {
            if (remaining.delete(key)) deleted++;
          }
          return Promise.resolve(deleted);
        },
      });

      assertEquals(await backend.delByPattern(entry.pattern), 1);
      assertEquals(remaining, new Set([`${TEST_PREFIX}${entry.unrelatedKey}`]));
    }
  });

  it("completes SCAN before bounded deletion and rejects repeated cursors", async () => {
    let scans = 0;
    let deletes = 0;
    const complete = createBackend({
      scan: () => {
        scans++;
        assertEquals(deletes, 0);
        return Promise.resolve({
          cursor: scans === 1 ? 7 : 0,
          keys: [`${TEST_PREFIX}${scans}`],
        });
      },
      eval: (_script, options) => {
        deletes++;
        return Promise.resolve(options.keys.length);
      },
    }).backend;

    assertEquals(await complete.delByPattern("*"), 2);
    assertEquals(scans, 2);
    assertEquals(deletes, 1);

    let repeatedDeletes = 0;
    const repeated = createBackend({
      scan: () => Promise.resolve({ cursor: 1, keys: [`${TEST_PREFIX}page`] }),
      eval: () => {
        repeatedDeletes++;
        return Promise.resolve(1);
      },
    }).backend;
    await assertRejects(() => repeated.delByPattern("*"), Error, "repeated a cursor");
    assertEquals(repeatedDeletes, 0);
  });

  it("keeps delete batches bounded after a complete physical scan", async () => {
    let scanCalls = 0;
    const deleteBatches: string[][] = [];
    const { backend } = createBackend({
      scan: () => {
        scanCalls++;
        return Promise.resolve({
          cursor: scanCalls < 50 ? scanCalls : 0,
          keys: Array.from(
            { length: 250 },
            (_, index) => `${TEST_PREFIX}${scanCalls}:${index}`,
          ),
        });
      },
      eval: (_script, options) => {
        const batch = [...options.keys];
        deleteBatches.push(batch);
        return Promise.resolve(batch.length);
      },
    });

    assertEquals(await backend.delByPattern("*"), 12_500);
    assertEquals(scanCalls, 50);
    assertEquals(deleteBatches.every((batch) => batch.length <= 1_000), true);
    assertEquals(deleteBatches.map((batch) => batch.length), [
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      500,
    ]);
  });

  it("counts only live revisioned records while deleting tombstones", async () => {
    const keys = [
      `${TEST_PREFIX}ordinary`,
      `${TEST_PREFIX}${buildRevisionedCacheKey("present")}`,
      `${TEST_PREFIX}${buildRevisionedCacheKey("absent")}`,
    ];
    const remaining = new Set(keys);
    const { backend } = createBackend({
      scan: () => Promise.resolve({ cursor: 0, keys }),
      eval: (_script, options) => {
        assertEquals(options.arguments, ["011", "vf-logical-delete-v1"]);
        for (const key of options.keys) remaining.delete(key);
        return Promise.resolve(2);
      },
    });

    assertEquals(await backend.delByPattern("*"), 2);
    assertEquals(remaining.size, 0);
  });

  it("counts a frame-looking ordinary value as live and deletes it", async () => {
    const key = `${TEST_PREFIX}ordinary:vf:revisioned:v1:suffix`;
    let deleted = false;
    const { backend } = createBackend({
      scan: () => Promise.resolve({ cursor: 0, keys: [key] }),
      eval: (_script, options) => {
        assertEquals(options.keys, [key]);
        assertEquals(options.arguments, ["0", "vf-logical-delete-v1"]);
        deleted = true;
        return Promise.resolve(1);
      },
    });

    assertEquals(await backend.delByPattern("*"), 1);
    assertEquals(deleted, true);
  });

  it("classifies every prefix-owned logical key as revisioned during pattern deletion", async () => {
    const malformedReservedKey = `${TEST_PREFIX}${REVISIONED_CACHE_KEY_PREFIX}`;
    let evalCalls = 0;
    const { backend } = createBackend({
      scan: () => Promise.resolve({ cursor: 0, keys: [malformedReservedKey] }),
      eval: (_script, options) => {
        evalCalls++;
        assertEquals(options.arguments, ["1", "vf-logical-delete-v1"]);
        return Promise.reject(new Error("malformed reserved record"));
      },
    });

    await assertRejects(
      () => backend.delByPattern("*"),
      Error,
      "malformed reserved record",
    );
    assertEquals(evalCalls, 1);
  });

  it("rejects physical traversal beyond 100,000 keys before deletion", async () => {
    let evalCalls = 0;
    const { backend } = createBackend({
      scan: () =>
        Promise.resolve({
          cursor: 0,
          keys: Array.from({ length: 100_001 }, (_, index) => `${TEST_PREFIX}${index}`),
        }),
      eval: () => {
        evalCalls++;
        return Promise.resolve(0);
      },
    });

    await assertRejects(
      () => backend.delByPattern("*"),
      RangeError,
      "safe key limit",
    );
    assertEquals(evalCalls, 0);
  });

  it("rejects invalid Redis DEL counts", async () => {
    const { backend } = createBackend({ del: () => Promise.resolve(2) });
    await assertRejects(() => backend.del("page"), TypeError, "invalid count");
  });
});

describe("RedisCacheBackend revisioned capability", () => {
  function createAtomicBackend(client = new StatefulAtomicRedisClient()) {
    return {
      client,
      backend: new RedisCacheBackend(TEST_PREFIX, {
        clientManager: createManager(client),
      }),
    };
  }

  it("publishes both own methods together only after a supported probe", async () => {
    const { backend, client } = createAtomicBackend();

    assertEquals(isRevisionedCacheBackend(backend), false);
    assertEquals(Object.hasOwn(backend, "getWithRevision"), false);
    assertEquals(Object.hasOwn(backend, "compareExchange"), false);
    assertEquals(await backend.initialize(), true);
    assertEquals(isRevisionedCacheBackend(backend), true);
    assertEquals(Object.hasOwn(backend, "getWithRevision"), true);
    assertEquals(Object.hasOwn(backend, "compareExchange"), true);
    assertEquals(client.infoCalls, ["server", "cluster", "memory"]);
    assertEquals(client.setCalls, [{ key: TEST_COUNTER_KEY, value: "0", options: { NX: true } }]);
  });

  it("performs one EVAL with exact keys and no ordinary fallback for each atomic read", async () => {
    const { backend, client } = createAtomicBackend();
    await backend.initialize();
    const key = buildRevisionedCacheKey("module");
    const getCalls = client.ordinaryGetCalls;
    const setCalls = client.ordinarySetCalls;
    const deleteCalls = client.ordinaryDeleteCalls;

    assertEquals(await backend.getWithRevision!(key), { value: null, revision: "1" });
    assertEquals(client.evalCalls.length, 1);
    assertEquals(client.evalCalls[0]!.options, {
      keys: [`${TEST_PREFIX}${key}`, TEST_COUNTER_KEY],
      arguments: [],
    });
    assertEquals(client.evalCalls[0]!.script.length > 0, true);
    assertEquals(client.ordinaryGetCalls, getCalls);
    assertEquals(client.ordinarySetCalls, setCalls);
    assertEquals(client.ordinaryDeleteCalls, deleteCalls);
  });

  it("passes the original absolute deadline and exact mutation arguments in one EVAL", async () => {
    const { backend, client } = createAtomicBackend();
    await backend.initialize();
    const ordinaryBaseline = {
      get: client.ordinaryGetCalls,
      set: client.ordinarySetCalls,
      del: client.ordinaryDeleteCalls,
    };
    const key = buildRevisionedCacheKey("module");
    const initial = await backend.getWithRevision!(key);
    const expiresAtMs = 2_000_000_000_123;

    assertEquals(
      await backend.compareExchange!(key, initial.revision, {
        kind: "set",
        value: "raw\0payload",
        expiresAtMs,
      }),
      true,
    );
    assertEquals(client.records.get(`${TEST_PREFIX}${key}`)?.expiresAtMs, expiresAtMs);
    const created = await backend.getWithRevision!(key);
    assertEquals(created.value, "raw\0payload");
    assertEquals(
      await backend.compareExchange!(key, created.revision, { kind: "delete" }),
      true,
    );

    assertEquals(client.evalCalls[1]!.options, {
      keys: [`${TEST_PREFIX}${key}`, TEST_COUNTER_KEY],
      arguments: [initial.revision, "s", "raw\0payload", String(expiresAtMs)],
    });
    assertEquals(client.evalCalls[3]!.options, {
      keys: [`${TEST_PREFIX}${key}`, TEST_COUNTER_KEY],
      arguments: [created.revision, "d"],
    });
    assertEquals(client.records.get(`${TEST_PREFIX}${key}`)?.kind, "absent");
    assertEquals(client.evalCalls.length, 4);
    assertEquals({
      get: client.ordinaryGetCalls,
      set: client.ordinarySetCalls,
      del: client.ordinaryDeleteCalls,
    }, ordinaryBaseline);
  });

  it("rejects hostile runtime mutations before client acquisition or Redis mutation", async () => {
    let accessorReads = 0;
    const accessorMutation = {};
    Object.defineProperty(accessorMutation, "kind", {
      enumerable: true,
      get() {
        accessorReads++;
        return "delete";
      },
    });
    const throwingMutation = new Proxy({}, {
      ownKeys() {
        throw new Error("ownKeys trap must not escape");
      },
      get() {
        throw new Error("get trap must not escape");
      },
    });
    const inheritedDelete = Object.create({ kind: "delete" });
    const invalidCalls: Array<readonly [unknown, unknown]> = [
      [1, { kind: "delete" }],
      ["1", null],
      ["1", []],
      ["1", { kind: "unknown" }],
      ["1", { kind: "delete", extra: true }],
      ["1", inheritedDelete],
      ["1", accessorMutation],
      ["1", throwingMutation],
      ["1", { kind: "set", value: 1, expiresAtMs: 2_000 }],
      ["1", { kind: "set", value: "value", expiresAtMs: "2000" }],
      ["1", { kind: "set", value: "value", expiresAtMs: 0 }],
      ["1", { kind: "set", value: "value", expiresAtMs: Number.NaN }],
      ["1", {
        kind: "set",
        value: "value",
        expiresAtMs: Number.MAX_SAFE_INTEGER + 1,
      }],
    ];

    for (const [expectedRevision, mutation] of invalidCalls) {
      const client = new StatefulAtomicRedisClient();
      let acquisitions = 0;
      const backend = new RedisCacheBackend(TEST_PREFIX, {
        clientManager: createManager(client, { onAcquire: () => acquisitions++ }),
      });
      assertEquals(await backend.initialize(), true);
      const invoke = backend.compareExchange! as unknown as (
        key: string,
        expectedRevision: unknown,
        mutation: unknown,
      ) => Promise<boolean>;

      await assertRejects(
        () => invoke(buildRevisionedCacheKey("runtime-boundary"), expectedRevision, mutation),
        TypeError,
      );
      assertEquals(acquisitions, 1);
      assertEquals(client.evalCalls.length, 0);
      assertEquals(client.counter, "0");
      assertEquals(client.records.size, 0);
    }
    assertEquals(accessorReads, 0);
  });

  it("rejects a nonreserved atomic key without EVAL or ordinary commands", async () => {
    const { backend, client } = createAtomicBackend();
    await backend.initialize();
    const baseline = {
      eval: client.evalCalls.length,
      get: client.ordinaryGetCalls,
      set: client.ordinarySetCalls,
      del: client.ordinaryDeleteCalls,
    };

    await assertRejects(() => backend.getWithRevision!("ordinary"), TypeError, "reserved");
    await assertRejects(
      () => backend.compareExchange!("ordinary", "1", { kind: "delete" }),
      TypeError,
      "reserved",
    );
    assertEquals({
      eval: client.evalCalls.length,
      get: client.ordinaryGetCalls,
      set: client.ordinarySetCalls,
      del: client.ordinaryDeleteCalls,
    }, baseline);
  });

  it("advances revisions for same-byte sets and absent deletes but not mismatches", async () => {
    const { backend } = createAtomicBackend();
    await backend.initialize();
    const key = buildRevisionedCacheKey("module");
    const absent = await backend.getWithRevision!(key);
    assertEquals(
      await backend.compareExchange!(key, "stale", { kind: "delete" }),
      false,
    );
    assertEquals(await backend.getWithRevision!(key), absent);

    assertEquals(await backend.compareExchange!(key, absent.revision, { kind: "delete" }), true);
    const deletedAgain = await backend.getWithRevision!(key);
    assertNotEquals(deletedAgain.revision, absent.revision);
    assertEquals(
      await backend.compareExchange!(key, deletedAgain.revision, {
        kind: "set",
        value: "same",
        expiresAtMs: Date.now() + 60_000,
      }),
      true,
    );
    const firstSet = await backend.getWithRevision!(key);
    assertEquals(
      await backend.compareExchange!(key, firstSet.revision, {
        kind: "set",
        value: "same",
        expiresAtMs: Date.now() + 60_000,
      }),
      true,
    );
    const secondSet = await backend.getWithRevision!(key);
    assertEquals(secondSet.value, "same");
    assertNotEquals(secondSet.revision, firstSet.revision);
  });

  it("canonicalizes raw deletion and tombstone expiry to fresh absent revisions", async () => {
    const { backend, client } = createAtomicBackend();
    await backend.initialize();
    const key = buildRevisionedCacheKey("module");
    const physicalKey = `${TEST_PREFIX}${key}`;
    const first = await backend.getWithRevision!(key);

    client.records.delete(physicalKey);
    const afterRawDelete = await backend.getWithRevision!(key);
    assertNotEquals(afterRawDelete.revision, first.revision);
    client.nowMs += 300_001;
    const afterTombstoneExpiry = await backend.getWithRevision!(key);
    assertNotEquals(afterTombstoneExpiry.revision, afterRawDelete.revision);
    assertEquals(afterTombstoneExpiry.value, null);
  });

  it("turns an accepted already-expired set into a five-minute tombstone", async () => {
    const { backend, client } = createAtomicBackend();
    await backend.initialize();
    const key = buildRevisionedCacheKey("module");
    const initial = await backend.getWithRevision!(key);
    const expectedExpiry = client.nowMs + 300_000;

    assertEquals(
      await backend.compareExchange!(key, initial.revision, {
        kind: "set",
        value: "too-late",
        expiresAtMs: client.nowMs,
      }),
      true,
    );

    assertEquals(client.records.get(`${TEST_PREFIX}${key}`), {
      kind: "absent",
      revision: "2",
      expiresAtMs: expectedExpiry,
    });
  });

  it("invalidates stale expectations when the data record disappeared", async () => {
    const { backend, client } = createAtomicBackend();
    await backend.initialize();
    const key = buildRevisionedCacheKey("module");
    const first = await backend.getWithRevision!(key);
    client.records.delete(`${TEST_PREFIX}${key}`);

    assertEquals(await backend.compareExchange!(key, first.revision, { kind: "delete" }), false);
    const current = await backend.getWithRevision!(key);
    assertNotEquals(current.revision, first.revision);
  });

  it("propagates native EVAL and response failures and resets the connection", async () => {
    for (
      const evalResult of [
        () => Promise.reject(new Error("native eval failed")),
        () => Promise.resolve([1, "01", "value"]),
        () => Promise.resolve([0, "x".repeat(MAX_CACHE_REVISION_LENGTH + 1)]),
      ]
    ) {
      let disconnects = 0;
      const client = createRedisClient({ eval: evalResult });
      const backend = new RedisCacheBackend(TEST_PREFIX, {
        clientManager: createManager(client, { onDisconnect: () => disconnects++ }),
      });
      assertEquals(await backend.initialize(), true);

      await assertRejects(() => backend.getWithRevision!(buildRevisionedCacheKey("module")));
      assertEquals(disconnects, 1);
    }
  });

  it("strictly parses integer exchange responses", async () => {
    for (const [raw, expected] of [[0, false], [1, true]] as const) {
      const client = createRedisClient({ eval: () => Promise.resolve(raw) });
      const backend = new RedisCacheBackend(TEST_PREFIX, {
        clientManager: createManager(client),
      });
      await backend.initialize();
      assertEquals(
        await backend.compareExchange!(buildRevisionedCacheKey("key"), "1", {
          kind: "delete",
        }),
        expected,
      );
    }

    const client = createRedisClient({ eval: () => Promise.resolve(true) });
    const backend = new RedisCacheBackend(TEST_PREFIX, { clientManager: createManager(client) });
    await backend.initialize();
    await assertRejects(
      () => backend.compareExchange!(buildRevisionedCacheKey("key"), "1", { kind: "delete" }),
      TypeError,
    );
  });

  it("fails closed when the protected counter is missing, expiring, malformed, or overflows", async () => {
    const missing = createAtomicBackend();
    await missing.backend.initialize();
    missing.client.counter = null;
    await assertRejects(
      () => missing.backend.getWithRevision!(buildRevisionedCacheKey("missing")),
      Error,
      "missing",
    );
    assertEquals(missing.client.counter, null);
    assertEquals(Object.hasOwn(missing.backend, "getWithRevision"), false);
    assertEquals(Object.hasOwn(missing.backend, "compareExchange"), false);

    const expiring = new StatefulAtomicRedisClient();
    expiring.counterTtl = 60;
    const expiringBackend = createAtomicBackend(expiring).backend;
    assertEquals(await expiringBackend.initialize(), true);
    assertEquals(isRevisionedCacheBackend(expiringBackend), false);

    const malformed = new StatefulAtomicRedisClient();
    malformed.counter = "01";
    const malformedBackend = createAtomicBackend(malformed).backend;
    assertEquals(await malformedBackend.initialize(), true);
    assertEquals(isRevisionedCacheBackend(malformedBackend), false);

    const overflow = new StatefulAtomicRedisClient();
    overflow.counter = "9223372036854775807";
    const overflowBackend = createAtomicBackend(overflow).backend;
    assertEquals(await overflowBackend.initialize(), true);
    assertEquals(isRevisionedCacheBackend(overflowBackend), true);
    await assertRejects(
      () => overflowBackend.getWithRevision!(buildRevisionedCacheKey("overflow")),
      Error,
      "overflow",
    );
  });

  it("keeps ordinary caching usable on unsafe or unverifiable Redis topology", async () => {
    const cases: Array<Partial<RedisClient>> = [
      {
        info: (section) =>
          Promise.resolve(
            section === "server"
              ? "# Server\r\nredis_version:6.2.0\r\n"
              : section === "cluster"
              ? STANDALONE_CLUSTER_INFO
              : NO_EVICTION_MEMORY_INFO,
          ),
      },
      {
        info: (section) =>
          Promise.resolve(
            section === "server"
              ? "# Server\r\nredis_version:8.0.0\r\n"
              : section === "cluster"
              ? STANDALONE_CLUSTER_INFO
              : NO_EVICTION_MEMORY_INFO,
          ),
      },
      {
        info: (section) =>
          Promise.resolve(
            section === "cluster"
              ? "# Cluster\r\ncluster_enabled:1\r\n"
              : section === "server"
              ? SUPPORTED_SERVER_INFO
              : NO_EVICTION_MEMORY_INFO,
          ),
      },
      {
        info: (section) =>
          Promise.resolve(
            section === "memory"
              ? "# Memory\r\nmaxmemory_policy:allkeys-lru\r\n"
              : section === "server"
              ? SUPPORTED_SERVER_INFO
              : STANDALONE_CLUSTER_INFO,
          ),
      },
      { info: () => Promise.resolve("malformed") },
      {
        info: (section) =>
          Promise.resolve(
            section === "server"
              ? "# Server\r\nredis_version:7.4.1\r\nredis_version:7.4.2\r\n"
              : section === "cluster"
              ? STANDALONE_CLUSTER_INFO
              : NO_EVICTION_MEMORY_INFO,
          ),
      },
      {
        info: (section) =>
          Promise.resolve(
            section === "cluster"
              ? "# Cluster\r\ncluster_enabled:0\r\ncluster_enabled:1\r\n"
              : section === "server"
              ? SUPPORTED_SERVER_INFO
              : NO_EVICTION_MEMORY_INFO,
          ),
      },
      {
        info: (section) =>
          Promise.resolve(
            section === "memory"
              ? "# Memory\r\nmaxmemory_policy:volatile-invented\r\n"
              : section === "server"
              ? SUPPORTED_SERVER_INFO
              : STANDALONE_CLUSTER_INFO,
          ),
      },
      { info: () => Promise.reject(new Error("INFO unavailable")) },
    ];

    for (const overrides of cases) {
      const { backend, client } = createBackend(overrides);
      client.values.set(`${TEST_PREFIX}ordinary`, "ordinary-value");

      assertEquals(await backend.initialize(), true);
      assertEquals(isRevisionedCacheBackend(backend), false);
      assertEquals(Object.hasOwn(backend, "getWithRevision"), false);
      assertEquals(Object.hasOwn(backend, "compareExchange"), false);
      assertEquals(await backend.get("ordinary"), "ordinary-value");
    }
  });

  it("requires exactly one visible standalone redis_mode while ordinary caching remains usable", async () => {
    const invalidServerInfo = [
      "# Server\r\nredis_version:7.4.1\r\n",
      "# Server\r\nredis_version:7.4.1\r\nredis_mode:standalone\r\nredis_mode:standalone\r\n",
      "# Server\r\nredis_version:7.4.1\r\nredis_mode:standalone\x01\r\n",
      "# Server\r\nredis_version:7.4.1\r\nredis_mode:sentinel\r\n",
      "# Server\r\nredis_version:7.4.1\r\nredis_mode:cluster\r\n",
    ];

    for (const serverInfo of invalidServerInfo) {
      const { backend } = createBackend({
        info: (section) =>
          Promise.resolve(
            section === "server"
              ? serverInfo
              : section === "cluster"
              ? STANDALONE_CLUSTER_INFO
              : NO_EVICTION_MEMORY_INFO,
          ),
      });

      assertEquals(await backend.initialize(), true);
      assertEquals(Object.hasOwn(backend, "getWithRevision"), false);
      assertEquals(Object.hasOwn(backend, "compareExchange"), false);
      await backend.set("ordinary", "ordinary-value", 60);
      assertEquals(await backend.get("ordinary"), "ordinary-value");
    }
  });

  it("fails closed for counter probe and SET NX anomalies", async () => {
    const cases: Array<{
      overrides?: Partial<RedisClient>;
      counter?: string;
    }> = [
      { overrides: { set: () => Promise.resolve("PONG") } },
      { overrides: { set: () => Promise.reject(new Error("SET NX failed")) } },
      { overrides: { ttl: () => Promise.resolve(-2) } },
      { counter: "+1" },
      { counter: "-1" },
      { counter: " 1" },
      { counter: "1 " },
      { counter: "9223372036854775808" },
    ];

    for (const scenario of cases) {
      const { backend, client } = createBackend(scenario.overrides);
      if (scenario.counter !== undefined) {
        client.values.set(TEST_COUNTER_KEY, scenario.counter);
      }
      assertEquals(await backend.initialize(), true);
      assertEquals(isRevisionedCacheBackend(backend), false);
      assertEquals(Object.hasOwn(backend, "getWithRevision"), false);
      assertEquals(Object.hasOwn(backend, "compareExchange"), false);
    }
  });

  it("withdraws and restores both own methods across safe, unsafe, error, and safe probes", async () => {
    let mode: "safe" | "unsafe" | "error" = "safe";
    const { backend } = createBackend({
      info: (section) => {
        if (mode === "error") return Promise.reject(new Error("INFO failed"));
        if (section === "server") return Promise.resolve(SUPPORTED_SERVER_INFO);
        if (section === "cluster") return Promise.resolve(STANDALONE_CLUSTER_INFO);
        return Promise.resolve(
          mode === "safe"
            ? NO_EVICTION_MEMORY_INFO
            : "# Memory\r\nmaxmemory_policy:allkeys-lru\r\n",
        );
      },
    });

    for (
      const [nextMode, capable] of [
        ["safe", true],
        ["unsafe", false],
        ["error", false],
        ["safe", true],
      ] as const
    ) {
      mode = nextMode;
      assertEquals(await backend.initialize(), true);
      assertEquals(isRevisionedCacheBackend(backend), capable);
      assertEquals(Object.hasOwn(backend, "getWithRevision"), capable);
      assertEquals(Object.hasOwn(backend, "compareExchange"), capable);
    }
  });

  it("accepts only real Redis 7 volatile eviction policies", async () => {
    for (const policy of ["volatile-lru", "volatile-lfu", "volatile-random", "volatile-ttl"]) {
      const { backend } = createBackend({
        info: (section) =>
          Promise.resolve(
            section === "memory"
              ? `# Memory\r\nmaxmemory_policy:${policy}\r\n`
              : section === "server"
              ? SUPPORTED_SERVER_INFO
              : STANDALONE_CLUSTER_INFO,
          ),
      });

      assertEquals(await backend.initialize(), true);
      assertEquals(isRevisionedCacheBackend(backend), true);
      assertExists(backend.getWithRevision);
      assertExists(backend.compareExchange);
    }
  });
});
