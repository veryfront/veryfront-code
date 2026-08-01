import "#veryfront/schemas/_test-setup.ts";
/**
 * Cache Registry Tests
 *
 * Tests MapCacheStore, LRUCacheStore, isKeyForProject,
 * isKeyForProjectEnvironment, extractProjectIdFromKey,
 * and CacheRegistry instance operations.
 *
 * @module cache/registry.test
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  CacheRegistry,
  cacheRegistry,
  type CacheRegistryDistributedProvider,
  extractProjectIdFromKey,
  isKeyForProject,
  isKeyForProjectEnvironment,
  LRUCacheStore,
  MapCacheStore,
  registerLRUCache,
  registerMapCache,
  structuredCacheStoreProjectOwnership,
} from "./registry.ts";
import {
  buildDistributedCacheKeyPrefix,
  registerOwnedDistributedCacheKeyPrefix,
  registerOwnedDistributedCacheNamespace,
} from "./backends/distributed-keyspace.ts";
import {
  buildFileCacheKeyPrefix,
  buildFileOperationCacheKey,
  buildRenderCachePrefix,
  buildSSRModuleCacheKey,
} from "./keys/index.ts";
import { buildPreparedProjectCSSCacheKey, buildProjectCSSCacheKey } from "./keys/project-css.ts";

interface FakeDistributedProviderOptions {
  readonly configured?: boolean;
  readonly keysByPrefix?: ReadonlyMap<string, readonly string[]>;
  readonly truncatedPrefixes?: ReadonlySet<string>;
  readonly onDelete?: (keys: readonly string[]) => number | Promise<number>;
  readonly onList?: (prefix: string, limit: number) => void;
}

function createDistributedProvider(
  options: FakeDistributedProviderOptions = {},
): CacheRegistryDistributedProvider {
  return {
    isConfigured: () => options.configured ?? true,
    listKeys: ({ prefix, limit }) => {
      options.onList?.(prefix, limit);
      const keys = [...(options.keysByPrefix?.get(prefix) ?? [])].slice(0, limit);
      return Promise.resolve({
        keys,
        truncated: options.truncatedPrefixes?.has(prefix) ?? false,
      });
    },
    deleteKeys: (keys) => Promise.resolve(options.onDelete?.(keys) ?? keys.length),
  };
}

describe("MapCacheStore", () => {
  it("should expose name", () => {
    const store = new MapCacheStore("test", new Map());
    assertEquals(store.name, "test");
  });

  it("should report size", () => {
    const map = new Map<string, unknown>([
      ["a", 1],
      ["b", 2],
    ]);
    const store = new MapCacheStore("test", map);
    assertEquals(store.size(), 2);
  });

  it("should iterate keys", () => {
    const map = new Map<string, unknown>([
      ["a", 1],
      ["b", 2],
    ]);
    const store = new MapCacheStore("test", map);
    assertEquals([...store.keys()].sort(), ["a", "b"]);
  });

  it("should delete matching keys", () => {
    const map = new Map<string, unknown>([
      ["proj1:a", 1],
      ["proj2:b", 2],
      ["proj1:c", 3],
    ]);
    const store = new MapCacheStore("test", map);
    const deleted = store.deleteWhere((key) => key.startsWith("proj1:"));
    assertEquals(deleted, 2);
    assertEquals(map.size, 1);
    assertEquals(map.has("proj2:b"), true);
  });

  it("should return 0 when no keys match predicate", () => {
    const map = new Map<string, unknown>([["a", 1]]);
    const store = new MapCacheStore("test", map);
    assertEquals(store.deleteWhere(() => false), 0);
    assertEquals(map.size, 1);
  });
});

describe("LRUCacheStore", () => {
  function createMockLRU(): {
    get: (key: string) => unknown;
    keys: () => IterableIterator<string>;
    readonly size: number;
    delete: (key: string) => boolean;
    set: (key: string, value: unknown) => void;
    _map: Map<string, unknown>;
  } {
    const map = new Map<string, unknown>();

    return {
      get: (key: string) => map.get(key),
      keys: () => map.keys(),
      get size() {
        return map.size;
      },
      delete: (key: string) => map.delete(key),
      set: (key: string, value: unknown) => {
        map.set(key, value);
      },
      _map: map,
    };
  }

  it("should expose name", () => {
    const store = new LRUCacheStore("lru-test", createMockLRU());
    assertEquals(store.name, "lru-test");
  });

  it("should report size", () => {
    const lru = createMockLRU();
    lru.set("a", 1);
    lru.set("b", 2);

    const store = new LRUCacheStore("test", lru);
    assertEquals(store.size(), 2);
  });

  it("should delete matching keys", () => {
    const lru = createMockLRU();
    lru.set("proj1:a", 1);
    lru.set("proj2:b", 2);

    const store = new LRUCacheStore("test", lru);
    const deleted = store.deleteWhere((key) => key.startsWith("proj1:"));
    assertEquals(deleted, 1);
    assertEquals(lru.size, 1);
  });
});

describe("isKeyForProject", () => {
  it("should match projectId at position 1", () => {
    assertEquals(isKeyForProject("prefix:project123:rest", "project123"), true);
  });

  it("should match projectId at position 2", () => {
    assertEquals(isKeyForProject("prefix:other:project123:rest", "project123"), true);
  });

  it("should match projectId in versioned keys", () => {
    assertEquals(isKeyForProject("v1:project123:path", "project123"), true);
  });

  it("should match projectId in distributed-cache namespaces", () => {
    assertEquals(
      isKeyForProject("vf:cache:ssr-module:v1:project123:path", "project123"),
      true,
    );
    assertEquals(
      isKeyForProject("vf:cache:ssr-module:v1:project123:release-r1:path", "project123"),
      true,
    );
    assertEquals(
      isKeyForProject("vf:cache:default:file:branch:project123:main:path", "project123"),
      true,
    );
  });

  it("should match projectId in render cache keys", () => {
    assertEquals(
      isKeyForProject("project123:production:release-1:v1", "project123"),
      true,
    );
  });

  it("should not match projectId deep in unrelated parts", () => {
    assertEquals(isKeyForProject("a:b:c:project123", "project123"), false);
  });

  it("should return false for non-matching key", () => {
    assertEquals(isKeyForProject("a:b:c", "project123"), false);
  });

  it("should return false for single-part key", () => {
    assertEquals(isKeyForProject("nocolon", "project123"), false);
  });

  it("should handle empty string projectId", () => {
    assertEquals(isKeyForProject("a::b", ""), false);
  });
});

describe("isKeyForProjectEnvironment", () => {
  // Render cache keys: {projectId}:{environment}:{releaseKey}:{version}
  it("should match production environment in render cache keys", () => {
    assertEquals(
      isKeyForProjectEnvironment("proj1:production:release-1:v1", "proj1", "production"),
      true,
    );
  });

  it("should match preview environment in render cache keys", () => {
    assertEquals(
      isKeyForProjectEnvironment("proj1:preview:branch-main:v1", "proj1", "preview"),
      true,
    );
  });

  it("should return false for wrong environment", () => {
    assertEquals(
      isKeyForProjectEnvironment("proj1:production:release-1:v1", "proj1", "preview"),
      false,
    );
  });

  // SSR module cache keys: v{version}:{projectId}:{contentSourceId}:...
  it("should match preview via SSR module key with preview prefix", () => {
    assertEquals(
      isKeyForProjectEnvironment("v19:proj1:preview-draft:hash", "proj1", "preview"),
      true,
    );
  });

  it("should match preview via SSR module key with 'preview' contentSourceId", () => {
    assertEquals(
      isKeyForProjectEnvironment("v2:proj1:preview:file.js", "proj1", "preview"),
      true,
    );
  });

  it("should match production via SSR module key with release prefix", () => {
    assertEquals(
      isKeyForProjectEnvironment("v19:proj1:release-abc:hash", "proj1", "production"),
      true,
    );
  });

  it("should match production via SSR module key with 'production' contentSourceId", () => {
    assertEquals(
      isKeyForProjectEnvironment("v2:proj1:production:file.js", "proj1", "production"),
      true,
    );
  });

  it("should match production via SSR module key with 'latest' contentSourceId", () => {
    assertEquals(
      isKeyForProjectEnvironment("v2:proj1:latest:file.js", "proj1", "production"),
      true,
    );
  });

  it("should match production via prod- prefix", () => {
    assertEquals(
      isKeyForProjectEnvironment("v2:proj1:prod-xyz:file.js", "proj1", "production"),
      true,
    );
  });

  it("should match production via production- prefix", () => {
    assertEquals(
      isKeyForProjectEnvironment("v2:proj1:production-xyz:file.js", "proj1", "production"),
      true,
    );
  });

  // Layout component cache keys: layout:{projectId}:{contentSourceId}:...
  it("should match layout cache key preview", () => {
    assertEquals(
      isKeyForProjectEnvironment("layout:proj1:preview-main:comp", "proj1", "preview"),
      true,
    );
  });

  it("should match layout cache key production", () => {
    assertEquals(
      isKeyForProjectEnvironment("layout:proj1:release-v1:comp", "proj1", "production"),
      true,
    );
  });

  // File/dir/stat cache keys
  it("should match file cache branch as preview", () => {
    assertEquals(
      isKeyForProjectEnvironment("file:branch:proj1:main:path", "proj1", "preview"),
      true,
    );
  });

  it("should match file cache release as production", () => {
    assertEquals(
      isKeyForProjectEnvironment("file:release:proj1:v1:path", "proj1", "production"),
      true,
    );
  });

  it("should match stat cache branch as preview", () => {
    assertEquals(
      isKeyForProjectEnvironment("stat:branch:proj1:main:path", "proj1", "preview"),
      true,
    );
  });

  it("should match dir cache release as production", () => {
    assertEquals(
      isKeyForProjectEnvironment("dir:release:proj1:v1:path", "proj1", "production"),
      true,
    );
  });

  it("should classify real named-environment file cache keys as production", () => {
    const key = buildFileOperationCacheKey(
      buildFileCacheKeyPrefix({
        sourceType: "environment",
        projectSlug: "proj1",
        environmentName: "Staging",
        releaseId: "release/1",
      }),
      "src/page.ts",
    );

    assertEquals(
      isKeyForProjectEnvironment(key, "proj1", "production"),
      true,
    );
    assertEquals(isKeyForProjectEnvironment(key, "proj1", "preview"), false);
  });

  it("classifies encoded render project identities without losing ownership", () => {
    const projectId = "project:one-\ud800";
    const key = `${buildRenderCachePrefix(projectId, "production", "release/one")}:page`;

    assertEquals(isKeyForProject(key, projectId), true);
    assertEquals(isKeyForProjectEnvironment(key, projectId, "production"), true);
  });

  // Proxy cache keys: proxy:{projectSlug}:{environment}:{qualifier}
  it("should match proxy cache key production", () => {
    assertEquals(
      isKeyForProjectEnvironment("proxy:myslug:production:token", "myslug", "production"),
      true,
    );
  });

  it("should match proxy cache key preview", () => {
    assertEquals(
      isKeyForProjectEnvironment("proxy:myslug:preview:token", "myslug", "preview"),
      true,
    );
  });

  // Canonical distributed-cache namespaces.
  it("should strip the SSR module namespace", () => {
    assertEquals(
      isKeyForProjectEnvironment(
        "vf:cache:ssr-module:v2:proj1:release-abc:file",
        "proj1",
        "production",
      ),
      true,
    );
  });

  it("should strip the default file-cache namespace", () => {
    assertEquals(
      isKeyForProjectEnvironment(
        "vf:cache:default:file:branch:proj1:main:path",
        "proj1",
        "preview",
      ),
      true,
    );
  });

  it("should strip the transform namespace", () => {
    assertEquals(
      isKeyForProjectEnvironment(
        "vf:cache:transform:proj1:production:key:v1",
        "proj1",
        "production",
      ),
      true,
    );
  });

  it("should return false for non-project key", () => {
    assertEquals(isKeyForProjectEnvironment("other:data:stuff", "proj1", "production"), false);
  });

  it("should return null environment for ambiguous key", () => {
    assertEquals(
      isKeyForProjectEnvironment("a:proj1:unknown-prefix:data", "proj1", "production"),
      false,
    );
  });
});

describe("extractProjectIdFromKey", () => {
  it("should extract second part as projectId", () => {
    assertEquals(extractProjectIdFromKey("prefix:project123:rest"), "project123");
  });

  it("should return null for single-part key", () => {
    assertEquals(extractProjectIdFromKey("nocolon"), null);
  });

  it("should return empty string for key like 'a::b'", () => {
    assertEquals(extractProjectIdFromKey("a::b"), "");
  });
});

describe("CacheRegistry", () => {
  beforeEach(() => cacheRegistry.clear());
  afterEach(() => cacheRegistry.clear());

  it("should register and retrieve a store by name", () => {
    registerMapCache("my-store", new Map());
    const store = cacheRegistry.get("my-store");
    assertExists(store);
    assertEquals(store.name, "my-store");
  });

  it("should list registered store names", () => {
    registerMapCache("s1", new Map());
    registerMapCache("s2", new Map());

    const names = cacheRegistry.getStoreNames();
    assertEquals(names.includes("s1"), true);
    assertEquals(names.includes("s2"), true);
  });

  it("should unregister a store", () => {
    registerMapCache("temp", new Map());
    assertEquals(cacheRegistry.unregister("temp"), true);
    assertEquals(cacheRegistry.get("temp"), undefined);
  });

  it("should return false when unregistering non-existent store", () => {
    assertEquals(cacheRegistry.unregister("nope"), false);
  });

  it("should get all keys across stores", () => {
    registerMapCache("s1", new Map<string, unknown>([["a:p:x", 1]]));
    registerMapCache("s2", new Map<string, unknown>([["b:p:y", 2]]));

    const allKeys = cacheRegistry.getAllKeys();
    assertEquals(allKeys.get("s1"), ["a:p:x"]);
    assertEquals(allKeys.get("s2"), ["b:p:y"]);
  });

  it("should get keys for a specific project", () => {
    const m = new Map<string, unknown>([
      ["x:proj1:data", 1],
      ["x:proj2:data", 2],
    ]);
    registerMapCache("proj-store", m, structuredCacheStoreProjectOwnership);

    const keys = cacheRegistry.getKeysForProject("proj1");
    assertEquals(keys.get("proj-store")?.length, 1);
    assertEquals(keys.get("proj-store")?.[0], "x:proj1:data");
  });

  it("should count keys for a project", () => {
    const m = new Map<string, unknown>([
      ["x:proj1:a", 1],
      ["x:proj1:b", 2],
      ["x:proj2:c", 3],
    ]);
    registerMapCache("count-store", m, structuredCacheStoreProjectOwnership);
    assertEquals(cacheRegistry.countKeysForProject("proj1"), 2);
  });

  it("should delete keys for a project", () => {
    const m = new Map<string, unknown>([
      ["x:proj1:a", 1],
      ["x:proj1:b", 2],
      ["x:proj2:c", 3],
    ]);
    registerMapCache("del-store", m, structuredCacheStoreProjectOwnership);

    const deleted = cacheRegistry.deleteKeysForProject("proj1");
    assertEquals(deleted, 2);
    assertEquals(m.size, 1);
  });

  it("should not infer project ownership for an opaque local store", () => {
    const m = new Map<string, unknown>([["opaque:proj1:data", 1]]);
    registerMapCache("opaque-store", m);

    assertEquals(cacheRegistry.getKeysForProject("proj1"), new Map());
    assertEquals(cacheRegistry.countKeysForProject("proj1"), 0);
    assertEquals(cacheRegistry.deleteKeysForProject("proj1"), 0);
    assertEquals(m.size, 1);
  });

  it("should delete keys for project environment", () => {
    const m = new Map<string, unknown>([
      ["proj1:production:r1:v1", 1],
      ["proj1:preview:b1:v1", 2],
      ["proj1:production:r2:v2", 3],
    ]);
    registerMapCache("env-store", m, structuredCacheStoreProjectOwnership);

    const deleted = cacheRegistry.deleteKeysForProjectEnvironment("proj1", "production");
    assertEquals(deleted, 2);
    assertEquals(m.size, 1);
  });

  it("should delete keys for content source", () => {
    const m = new Map<string, unknown>([
      ["v2:proj1:release-abc:file1", 1],
      ["v2:proj1:release-abc:file2", 2],
      ["v2:proj1:preview-main:file3", 3],
    ]);
    registerMapCache("cs-store", m, structuredCacheStoreProjectOwnership);

    const deleted = cacheRegistry.deleteKeysForContentSource("proj1", "abc");
    assertEquals(deleted, 2);
    assertEquals(m.size, 1);
  });

  it("should delete real file-cache keys for encoded branch and release IDs", () => {
    const branchKey = buildFileOperationCacheKey(
      buildFileCacheKeyPrefix({
        sourceType: "branch",
        projectSlug: "proj1",
        branch: "feature/foo",
      }),
      "src/branch.ts",
    );
    const releaseKey = buildFileOperationCacheKey(
      buildFileCacheKeyPrefix({
        sourceType: "release",
        projectSlug: "proj1",
        releaseId: "release/one",
      }),
      "src/release.ts",
    );
    const m = new Map<string, unknown>([
      [branchKey, 1],
      [releaseKey, 2],
    ]);
    registerMapCache(
      "encoded-content-source-store",
      m,
      structuredCacheStoreProjectOwnership,
    );

    assertEquals(cacheRegistry.deleteKeysForContentSource("proj1", "feature/foo"), 1);
    assertEquals(m.has(branchKey), false);
    assertEquals(cacheRegistry.deleteKeysForContentSource("proj1", "release/one"), 1);
    assertEquals(m.size, 0);
  });

  it("deletes encoded render keys for an exact content source", () => {
    const projectId = "project:one-\ud800";
    const key = `${buildRenderCachePrefix(projectId, "production", "release/one")}:page`;
    const m = new Map<string, unknown>([[key, 1]]);
    registerMapCache(
      "encoded-render-content-source-store",
      m,
      structuredCacheStoreProjectOwnership,
    );

    assertEquals(cacheRegistry.deleteKeysForContentSource(projectId, "release/one"), 1);
    assertEquals(m.size, 0);
  });

  it("should get stats with sample keys", () => {
    const m = new Map<string, unknown>();
    for (let i = 0; i < 10; i++) m.set(`key-${i}:proj:data`, i);
    registerMapCache("stats-store", m);

    const stats = cacheRegistry.getStats();
    assertEquals(stats.length, 1);
    assertEquals(stats[0]!.name, "stats-store");
    assertEquals(stats[0]!.size, 10);
    assertEquals(stats[0]!.sampleKeys.length, 5);
  });

  it("should register LRU cache via helper", () => {
    const lru = {
      _keys: ["a"],
      get() {
        return undefined;
      },
      keys() {
        return this._keys[Symbol.iterator]();
      },
      size: 1,
      delete() {
        return true;
      },
    };

    registerLRUCache("lru-test", lru);
    const store = cacheRegistry.get("lru-test");
    assertExists(store);
    assertEquals(store.size(), 1);
  });

  it("should replace existing store on duplicate registration (no throw)", () => {
    registerMapCache("dup", new Map<string, unknown>([["old", 1]]));
    registerMapCache("dup", new Map<string, unknown>([["new", 2]]));

    const store = cacheRegistry.get("dup");
    assertExists(store);
    assertEquals([...store.keys()], ["new"]);
  });

  it("rejects malformed store names before retaining them", () => {
    const registry = new CacheRegistry();
    const makeStore = (name: string) => new MapCacheStore(name, new Map());

    assertThrows(() => registry.register(makeStore("")), TypeError);
    assertThrows(() => registry.register(makeStore(" leading")), TypeError);
    assertThrows(() => registry.register(makeStore("line\nbreak")), TypeError);
    assertThrows(() => registry.register(makeStore("x".repeat(257))), TypeError);
    assertEquals(registry.getStoreNames(), []);
  });

  it("bounds the number of independently registered stores", () => {
    const registry = new CacheRegistry();
    for (let index = 0; index < 1_000; index++) {
      registry.register(new MapCacheStore(`store-${index}`, new Map()));
    }

    assertThrows(
      () => registry.register(new MapCacheStore("overflow", new Map())),
      RangeError,
      "at most 1000",
    );
    assertEquals(registry.getStoreNames().length, 1_000);
  });

  it("should not let an old registration dispose its replacement", () => {
    const oldStore = new MapCacheStore("owned", new Map([["old", 1]]));
    const replacement = new MapCacheStore("owned", new Map([["new", 2]]));
    const disposeOldStore = cacheRegistry.register(oldStore);
    cacheRegistry.register(replacement);

    assertEquals(disposeOldStore(), false);
    assertEquals(cacheRegistry.get("owned"), replacement);
  });

  it("should clear all stores", () => {
    registerMapCache("x", new Map());
    registerMapCache("y", new Map());
    cacheRegistry.clear();
    assertEquals(cacheRegistry.getStoreNames().length, 0);
  });

  it("should handle stores without deleteWhere gracefully", () => {
    const minimalStore = {
      name: "minimal",
      get: () => undefined,
      keys: () => ["a:proj1:x"][Symbol.iterator](),
      size: () => 1,
    };
    cacheRegistry.register(minimalStore);

    const deleted = cacheRegistry.deleteKeysForProject("proj1");
    assertEquals(deleted, 0);
  });

  it("returns no distributed keys when no provider is configured", async () => {
    let listCalls = 0;
    const registry = new CacheRegistry(createDistributedProvider({
      configured: false,
      onList: () => listCalls++,
    }));

    assertEquals(await registry.listDistributedKeys("vf:cache:render:"), []);
    assertEquals(listCalls, 0);
  });

  it("applies the public listing limit after filtering", async () => {
    const prefix = "vf:cache:render:";
    const requestedLimits: number[] = [];
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        [prefix, [
          prefix + "other:preview:branch:v1:first",
          prefix + "target:preview:branch:v1:first",
          prefix + "target:preview:branch:v1:second",
        ]],
      ]),
      onList: (_prefix, limit) => requestedLimits.push(limit),
    }));

    assertEquals(
      await registry.listDistributedKeys(prefix, 1, (key) => key.includes(":target:")),
      [prefix + "target:preview:branch:v1:first"],
    );
    assertEquals(requestedLimits, [100_000]);
    await assertRejects(
      () => registry.listDistributedKeys(prefix, -1),
      RangeError,
      "non-negative integer",
    );
    assertEquals(await registry.listDistributedKeys(prefix, 0), []);
  });

  it("rejects a partial diagnostic listing instead of returning incomplete keys", async () => {
    const prefix = "vf:cache:render:";
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([[prefix, [prefix + "target:preview:branch:v1:page"]]]),
      truncatedPrefixes: new Set([prefix]),
    }));

    await assertRejects(
      () => registry.listDistributedKeys(prefix),
      RangeError,
      "traversal limit",
    );
  });

  it("finds only keys whose registered namespace owns the project identity", async () => {
    const fileKey = "vf:cache:default:" + buildFileOperationCacheKey(
      buildFileCacheKeyPrefix({
        sourceType: "branch",
        projectSlug: "target-slug",
        branch: "main",
      }),
      "src/page.ts",
    );
    const renderKey = "vf:cache:render:target-id:preview:branch-main:v1:page";
    const ssrKey = "vf:cache:ssr-module:" +
      buildSSRModuleCacheKey("test", "target-id", "preview-main:src/page.tsx");
    const projectCssScope = "target-slug";
    const projectCssKey = "vf:cache:project-css:" + buildProjectCSSCacheKey({
      projectScope: projectCssScope,
      environment: "preview",
      stylesheetHash: "a".repeat(64),
      candidatesHash: "b".repeat(64),
      profileHash: "c".repeat(64),
    });
    const opaqueKey = "vf:cache:module:v1:target-id:preview:opaque";
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        ["vf:cache:default:", [fileKey]],
        ["vf:cache:render:", [renderKey]],
        ["vf:cache:ssr-module:", [ssrKey]],
        ["vf:cache:project-css:", [projectCssKey]],
        ["vf:cache:module:", [opaqueKey]],
      ]),
    }));

    assertEquals(
      await registry.getDistributedKeysForProject({
        projectId: "target-id",
        projectSlug: projectCssScope,
      }),
      new Map([
        ["vf:cache:default", [fileKey]],
        ["vf:cache:project-css", [projectCssKey]],
        ["vf:cache:render", [renderKey]],
        ["vf:cache:ssr-module", [ssrKey]],
      ]),
    );
  });

  it("associates a framed project CSS key with the exact raw arbitrary scope", async () => {
    const projectCssScope = "target:slug*/Malmö-\ud800";
    const projectCssKey = "vf:cache:project-css:" + buildProjectCSSCacheKey({
      projectScope: projectCssScope,
      environment: "production",
      stylesheetHash: "a".repeat(64),
      candidatesHash: "b".repeat(64),
      profileHash: "c".repeat(64),
    });
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([["vf:cache:project-css:", [projectCssKey]]]),
    }));

    assertEquals(
      await registry.getDistributedKeysForProject({ projectSlug: projectCssScope }),
      new Map([["vf:cache:project-css", [projectCssKey]]]),
    );
    assertEquals(
      await registry.getDistributedKeysForProject({ projectSlug: "target" }),
      new Map(),
    );
  });

  it("classifies encoded project CSS environments without orphaning custom environments", async () => {
    const projectScope = "environment:scope";
    const buildKey = (environment: string) =>
      "vf:cache:project-css:" + buildProjectCSSCacheKey({
        projectScope,
        environment,
        stylesheetHash: "a".repeat(64),
        candidatesHash: "b".repeat(64),
        profileHash: "c".repeat(64),
      });
    const previewKey = buildKey("preview");
    const productionKey = buildKey("production");
    const customKey = buildKey("staging:blue");
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        ["vf:cache:project-css:", [previewKey, productionKey, customKey]],
      ]),
      onDelete: (keys) => {
        deletedKeys.push(...keys);
        return keys.length;
      },
    }));

    assertEquals(
      await registry.getDistributedKeysForProject({ projectSlug: projectScope }),
      new Map([["vf:cache:project-css", [previewKey, productionKey, customKey]]]),
    );
    assertEquals(
      await registry.deleteDistributedKeysForProjectEnvironment(
        { projectSlug: projectScope },
        "preview",
      ),
      1,
    );
    assertEquals(deletedKeys, [previewKey]);
  });

  it("owns only exact framed prepared CSS scopes and classifies canonical environments", async () => {
    const projectScope = "prepared:scope*/Malmö-\ud800";
    const buildKey = (environment: string, identity: string) =>
      "vf:cache:prepared-project-css:" + buildPreparedProjectCSSCacheKey({
        projectScope,
        environment,
        identityHash: identity.repeat(64),
      });
    const previewKey = buildKey("preview", "a");
    const productionKey = buildKey("production", "b");
    const customKey = buildKey("staging:blue", "c");
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        ["vf:cache:prepared-project-css:", [previewKey, productionKey, customKey]],
      ]),
      onDelete: (keys) => {
        deletedKeys.push(...keys);
        return keys.length;
      },
    }));

    assertEquals(
      await registry.getDistributedKeysForProject({ projectSlug: projectScope }),
      new Map([
        ["vf:cache:prepared-project-css", [previewKey, productionKey, customKey]],
      ]),
    );
    assertEquals(
      await registry.getDistributedKeysForProject({ projectSlug: "prepared" }),
      new Map(),
    );
    assertEquals(
      await registry.deleteDistributedKeysForProjectEnvironment(
        { projectSlug: projectScope },
        "preview",
      ),
      1,
    );
    assertEquals(deletedKeys, [previewKey]);
  });

  it("neither lists nor deletes the exact retired v4 project CSS schema", async () => {
    const legacyKey = `vf:cache:project-css:legacy-project:preview:v4:${"a".repeat(64)}:${
      "b".repeat(64)
    }:${"c".repeat(64)}`;
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([["vf:cache:project-css:", [legacyKey]]]),
      onDelete: (keys) => {
        deletedKeys.push(...keys);
        return keys.length;
      },
    }));

    assertEquals(
      await registry.getDistributedKeysForProject({ projectSlug: "legacy-project" }),
      new Map(),
    );
    assertEquals(
      await registry.deleteDistributedKeysForProject({ projectSlug: "legacy-project" }),
      0,
    );
    assertEquals(deletedKeys, []);
  });

  it("neither lists nor deletes the retired prepared project CSS schema", async () => {
    const legacyKey = `vf:cache:prepared-project-css:legacy-prepared:preview:prepared:v4:${
      "a".repeat(64)
    }:${"b".repeat(64)}:${"c".repeat(64)}:${"d".repeat(64)}:${"e".repeat(64)}`;
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([["vf:cache:prepared-project-css:", [legacyKey]]]),
      onDelete: (keys) => {
        deletedKeys.push(...keys);
        return keys.length;
      },
    }));

    assertEquals(
      await registry.getDistributedKeysForProject({ projectSlug: "legacy-prepared" }),
      new Map(),
    );
    assertEquals(
      await registry.deleteDistributedKeysForProject({ projectSlug: "legacy-prepared" }),
      0,
    );
    assertEquals(deletedKeys, []);
  });

  it("completes every bounded listing before deleting shared keys", async () => {
    const firstKey = "vf:cache:render:target:preview:branch:v1:first";
    const secondKey = "vf:cache:ssr-module:v1:target:preview-main:second";
    let mutated = false;
    const listedPrefixes: string[] = [];
    const deletedBatches: string[][] = [];
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        ["vf:cache:render:", [firstKey]],
        ["vf:cache:ssr-module:", [secondKey]],
      ]),
      onList: (prefix) => {
        assertEquals(mutated, false);
        listedPrefixes.push(prefix);
      },
      onDelete: (keys) => {
        mutated = true;
        deletedBatches.push([...keys]);
        return keys.length;
      },
    }));

    assertEquals(
      await registry.deleteDistributedKeysForProject({ projectId: "target" }),
      2,
    );
    assertEquals(listedPrefixes.length > 2, true);
    assertEquals(deletedBatches.map((batch) => batch.toSorted()), [
      [firstKey, secondKey].toSorted(),
    ]);
  });

  it("refuses a truncated provider listing before mutation", async () => {
    let deleteCalls = 0;
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        [
          "vf:cache:render:",
          ["vf:cache:render:target:preview:branch:v1:page"],
        ],
      ]),
      truncatedPrefixes: new Set(["vf:cache:render:"]),
      onDelete: () => {
        deleteCalls++;
        return 1;
      },
    }));

    await assertRejects(
      () => registry.deleteDistributedKeysForProject({ projectId: "target" }),
      RangeError,
      "traversal limit",
    );
    assertEquals(deleteCalls, 0);
  });

  it("keeps local keys intact when shared invalidation cannot be planned", async () => {
    const localKey = "v1:target:preview-main:file";
    const local = new Map<string, unknown>([[localKey, 1]]);
    const registry = new CacheRegistry(createDistributedProvider({
      truncatedPrefixes: new Set(["vf:cache:render:"]),
    }));
    registry.register(
      new MapCacheStore("local", local, structuredCacheStoreProjectOwnership),
    );

    await assertRejects(
      () => registry.deleteAllKeysForProjectAsync("target"),
      RangeError,
      "traversal limit",
    );
    assertEquals(local.has(localKey), true);
  });

  it("does not reinterpret an opaque nested namespace through its parent", async () => {
    const projectId = "nested-opaque-project";
    const prefix = "vf:cache:render:" + projectId + ":";
    registerOwnedDistributedCacheKeyPrefix(prefix);
    const opaqueKey = prefix + "preview:branch:v1:page";
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        ["vf:cache:render:", [opaqueKey]],
      ]),
      onDelete: (keys) => {
        deletedKeys.push(...keys);
        return keys.length;
      },
    }));

    assertEquals(await registry.getDistributedKeysForProject({ projectId }), new Map());
    assertEquals(await registry.deleteDistributedKeysForProject({ projectId }), 0);
    assertEquals(deletedKeys, []);
  });

  it("supports an explicitly registered project-ownership matcher", async () => {
    const prefix = buildDistributedCacheKeyPrefix("registry-custom-owned");
    registerOwnedDistributedCacheNamespace({
      prefix,
      matchProjectOwnership: (key) => {
        const [version, projectId] = key.split(":");
        return version === "v1" && projectId ? { projectId } : null;
      },
    });
    const targetKey = prefix + "v1:target:asset";
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([[prefix, [targetKey]]]),
    }));

    assertEquals(
      await registry.getDistributedKeysForProject({ projectId: "target" }),
      new Map([[prefix.slice(0, -1), [targetKey]]]),
    );
  });

  it("filters project deletion by environment", async () => {
    const previewKey = "vf:cache:render:target:preview:branch:v1:page";
    const productionKey = "vf:cache:render:target:production:release:v1:page";
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        ["vf:cache:render:", [previewKey, productionKey]],
      ]),
      onDelete: (keys) => {
        deletedKeys.push(...keys);
        return keys.length;
      },
    }));

    assertEquals(
      await registry.deleteDistributedKeysForProjectEnvironment(
        { projectId: "target" },
        "preview",
      ),
      1,
    );
    assertEquals(deletedKeys, [previewKey]);
  });

  it("validates project identities before consulting provider availability", async () => {
    const registry = new CacheRegistry(createDistributedProvider({ configured: false }));

    await assertRejects(
      () => registry.deleteDistributedKeysForProject({}),
      TypeError,
      "requires a projectId or projectSlug",
    );
    await assertRejects(
      () => registry.getDistributedKeysForProject({ projectSlug: " " }),
      TypeError,
      "must be a non-empty string",
    );
  });

  it("propagates provider deletion failures", async () => {
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        [
          "vf:cache:render:",
          ["vf:cache:render:target:preview:branch:v1:page"],
        ],
      ]),
      onDelete: () => Promise.reject(new Error("provider unavailable")),
    }));

    await assertRejects(
      () => registry.deleteDistributedKeysForProject({ projectId: "target" }),
      Error,
      "provider unavailable",
    );
  });

  it("combines local and distributed project keys without renaming either tier", async () => {
    const local = new Map<string, unknown>([["layout:target:preview:page", true]]);
    const distributedKey = "vf:cache:render:target:preview:branch:v1:page";
    const registry = new CacheRegistry(createDistributedProvider({
      keysByPrefix: new Map([
        ["vf:cache:render:", [distributedKey]],
      ]),
    }));
    registry.register(
      new MapCacheStore("local", local, structuredCacheStoreProjectOwnership),
    );

    assertEquals(
      await registry.getAllKeysForProjectAsync("target", true),
      {
        memory: new Map([["local", ["layout:target:preview:page"]]]),
        distributed: new Map([["vf:cache:render", [distributedKey]]]),
      },
    );
  });
});
