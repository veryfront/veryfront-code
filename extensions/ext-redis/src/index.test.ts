import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExtensionContext, ExtensionLogger } from "veryfront/extensions";
import {
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "veryfront/extensions/distributed";
import {
  buildRevisionedCacheKey,
  isRevisionedCacheBackend,
} from "veryfront/extensions/distributed/cache-support";
import { createRedisExtensionRuntime } from "./extension-factory.ts";
import factory from "./index.ts";
import type { RedisClient, RedisClientManager } from "./redis-client-manager.ts";
import { MemoryCacheBackend } from "../../../src/cache/backends/memory.ts";

const logger: ExtensionLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createContext(provided: Map<string, unknown>): ExtensionContext {
  return {
    config: {},
    logger,
    provide<T>(name: string, implementation: T) {
      provided.set(name, implementation);
    },
    get<T>(name: string): T | undefined {
      return provided.get(name) as T | undefined;
    },
    require<T>(name: string): T {
      const implementation = provided.get(name);
      if (implementation === undefined) throw new Error(`Missing ${name}`);
      return implementation as T;
    },
  };
}

function createCacheManager(memoryPolicy = "noeviction"): RedisClientManager {
  const values = new Map<string, string>();
  const client: RedisClient = {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    get: (key) => Promise.resolve(values.get(key) ?? null),
    mGet: (keys) => Promise.resolve(keys.map((key) => values.get(key) ?? null)),
    set: (key, value, options) => {
      if (options?.NX && values.has(key)) return Promise.resolve(null);
      values.set(key, value);
      return Promise.resolve("OK");
    },
    del: () => Promise.resolve(0),
    scan: () => Promise.resolve({ cursor: "0", keys: [] }),
    expire: () => Promise.resolve(1),
    ttl: () => Promise.resolve(-1),
    eval: () => Promise.resolve([0, "1"]),
    info: (section) =>
      Promise.resolve(
        section === "server"
          ? "# Server\r\nredis_version:7.4.1\r\nredis_mode:standalone\r\n"
          : section === "cluster"
          ? "# Cluster\r\ncluster_enabled:0\r\n"
          : `# Memory\r\nmaxmemory_policy:${memoryPolicy}\r\n`,
      ),
    isOpen: true,
  };
  return {
    isConfigured: () => true,
    getClient: () => Promise.resolve(client),
    disconnect: () => Promise.resolve(),
  };
}

function createStatefulProviderCacheManager(): {
  manager: RedisClientManager;
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  const client: RedisClient = {
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
    scan: (_cursor, options) => {
      const literalPrefix = options?.MATCH?.replace(/\\([\\*?\[\]])/g, "$1").slice(0, -1) ?? "";
      return Promise.resolve({
        cursor: "0",
        keys: [...values.keys()].filter((key) => key.startsWith(literalPrefix)),
      });
    },
    expire: () => Promise.resolve(1),
    ttl: () => Promise.resolve(-1),
    eval: (_script, options) => {
      if (options.arguments[1] === "vf-logical-delete-v1") {
        let live = 0;
        for (let index = 0; index < options.keys.length; index++) {
          const raw = values.get(options.keys[index]!);
          if (raw === undefined) continue;
          if (options.arguments[0]![index] === "0" || raw.startsWith("\0VFCAS1\0p\0")) {
            live++;
          }
        }
        for (const key of options.keys) values.delete(key);
        return Promise.resolve(live);
      }

      const [dataKey, counterKey] = options.keys;
      const allocate = () => {
        const revision = (BigInt(values.get(counterKey!)!) + 1n).toString();
        values.set(counterKey!, revision);
        return revision;
      };
      const raw = values.get(dataKey!);
      if (options.arguments.length === 0) {
        if (raw === undefined) {
          const revision = allocate();
          values.set(dataKey!, `\0VFCAS1\0a\0${revision}\0`);
          return Promise.resolve([0, revision]);
        }
        const [, , state, revision, payload] = raw.split("\0");
        return Promise.resolve(state === "p" ? [1, revision, payload ?? ""] : [0, revision]);
      }

      const [, , , currentRevision] = raw?.split("\0") ?? [];
      if (currentRevision !== options.arguments[0]) return Promise.resolve(0);
      const revision = allocate();
      if (options.arguments[1] === "d") {
        values.set(dataKey!, `\0VFCAS1\0a\0${revision}\0`);
      } else {
        values.set(dataKey!, `\0VFCAS1\0p\0${revision}\0${options.arguments[2]}`);
      }
      return Promise.resolve(1);
    },
    info: (section) =>
      Promise.resolve(
        section === "server"
          ? "# Server\r\nredis_version:7.4.1\r\nredis_mode:standalone\r\n"
          : section === "cluster"
          ? "# Cluster\r\ncluster_enabled:0\r\n"
          : "# Memory\r\nmaxmemory_policy:noeviction\r\n",
      ),
    isOpen: true,
  };
  return {
    manager: {
      isConfigured: () => true,
      getClient: () => Promise.resolve(client),
      disconnect: () => Promise.resolve(),
    },
    values,
  };
}

describe("ext-redis provider lifecycle", () => {
  it("declares only the aggregate provider and explicit activation", async () => {
    const extension = factory();
    assertEquals(extension.name, "ext-redis");
    assertEquals(extension.contracts?.provides, [DistributedRuntimeProviderName]);

    const manifest = JSON.parse(
      await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
    );
    assertEquals(manifest.veryfront.activation, "explicit");
    assertEquals(manifest.veryfront.contracts, extension.contracts);
    assertEquals(manifest.veryfront.capabilities, extension.capabilities);
  });

  it("registers factories without opening a connection and invalidates them on teardown", async () => {
    const extension = factory({ url: "rediss://not-contacted.example" });
    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    const provider = provided.get(DistributedRuntimeProviderName) as DistributedRuntimeProvider;

    assertEquals(provider.id, "redis@5.11.0");
    assertEquals(provider.getWorkflowWorkerEnvironment(), {
      REDIS_URL: "rediss://not-contacted.example",
    });
    const store = provider.createRenderCacheStore({});
    await extension.teardown!();

    await store.destroy();
    assertThrows(
      () => provider.createRenderCacheStore({}),
      Error,
      "not active",
    );
  });

  it("transfers provider-created workflow backend ownership to the caller", async () => {
    const extension = factory({
      url: "redis://127.0.0.1:1",
      connectTimeoutMs: 1,
    });
    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    const provider = provided.get(DistributedRuntimeProviderName) as DistributedRuntimeProvider;
    const backend = provider.createWorkflowBackend({ prefix: "ownership-test" });
    const destroyBackend = backend.destroy.bind(backend);
    let backendDestroyCalls = 0;
    backend.destroy = async () => {
      backendDestroyCalls++;
      await destroyBackend();
    };

    await extension.teardown!();
    assertEquals(backendDestroyCalls, 0);

    await backend.destroy();
    assertEquals(backendDestroyCalls, 1);
  });

  it("singleflights teardown and retains failed cleanup for an explicit retry", async () => {
    const extension = factory({ url: "rediss://not-contacted.example" });
    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    const provider = provided.get(DistributedRuntimeProviderName) as DistributedRuntimeProvider;
    const store = provider.createRenderCacheStore({});
    let attempts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.destroy = async () => {
      attempts++;
      await gate;
      if (attempts === 1) throw new Error("first close failed");
    };

    const first = extension.teardown!() as Promise<void>;
    const concurrent = extension.teardown!() as Promise<void>;
    assertStrictEquals(concurrent, first);
    await Promise.resolve();
    assertEquals(attempts, 1);
    release();
    await assertRejects(() => first, Error, "first close failed");

    await extension.teardown!();
    assertEquals(attempts, 2);
  });

  it("can retry setup after registration itself fails", async () => {
    const extension = factory();
    const rejectedContext = {
      ...createContext(new Map()),
      provide: () => {
        throw new Error("registry unavailable");
      },
    };
    assertThrows(
      () => extension.setup!(rejectedContext),
      Error,
      "registry unavailable",
    );

    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    assertEquals(provided.has(DistributedRuntimeProviderName), true);
    await extension.teardown!();
  });

  it("negotiates revisioned storage on provider-created supported Redis backends", async () => {
    const extension = createRedisExtensionRuntime(
      { url: "redis://127.0.0.1:6379" },
      { createClientManager: () => createCacheManager() },
    );
    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    const provider = provided.get(DistributedRuntimeProviderName) as DistributedRuntimeProvider;

    const backend = await provider.createCacheBackend({ keyPrefix: "vf:cache:test:" });

    assertEquals(isRevisionedCacheBackend(backend), true);
    await extension.teardown!();
  });

  it("registers direct provider cache namespaces for logical administration", async () => {
    const fixture = createStatefulProviderCacheManager();
    const extension = createRedisExtensionRuntime(
      { url: "redis://127.0.0.1:6379" },
      { createClientManager: () => fixture.manager },
    );
    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    const provider = provided.get(DistributedRuntimeProviderName) as DistributedRuntimeProvider;
    const keyPrefix = `vf:cache:provider-direct-${crypto.randomUUID()}:`;
    const backend = await provider.createCacheBackend({ keyPrefix });
    const administration = provider.getCacheAdministration();
    const absentKey = buildRevisionedCacheKey("absent");
    const presentKey = buildRevisionedCacheKey("present");

    await backend.getWithRevision!(absentKey);
    const initialPresent = await backend.getWithRevision!(presentKey);
    assertEquals(
      await backend.compareExchange!(presentKey, initialPresent.revision, {
        kind: "set",
        value: "present-value",
        expiresAtMs: 2_000_000_000_000,
      }),
      true,
    );
    const physicalAbsent = `${keyPrefix}${absentKey}`;
    const physicalPresent = `${keyPrefix}${presentKey}`;

    assertEquals(await administration.listKeys({ prefix: keyPrefix, limit: 10 }), {
      keys: [physicalPresent],
      truncated: false,
    });
    assertEquals(await administration.deleteKeys([physicalAbsent, physicalPresent]), 1);
    assertEquals(fixture.values.has(physicalAbsent), false);
    assertEquals(fixture.values.has(physicalPresent), false);
    await extension.teardown!();
  });

  it("keeps provider-created unsafe Redis and ordinary backends incapable", async () => {
    const extension = createRedisExtensionRuntime(
      { url: "redis://127.0.0.1:6379" },
      { createClientManager: () => createCacheManager("allkeys-lru") },
    );
    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    const provider = provided.get(DistributedRuntimeProviderName) as DistributedRuntimeProvider;

    const backend = await provider.createCacheBackend({ keyPrefix: "vf:cache:test:" });
    const ordinary = {
      type: "memory" as const,
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
    };

    assertEquals(isRevisionedCacheBackend(backend), false);
    assertEquals(backend.type, "distributed");
    await backend.set("ordinary", "ordinary-value", 60);
    assertEquals(await backend.get("ordinary"), "ordinary-value");
    assertEquals(isRevisionedCacheBackend(ordinary), false);
    assertEquals(isRevisionedCacheBackend(new MemoryCacheBackend()), false);
    await extension.teardown!();
  });
});
