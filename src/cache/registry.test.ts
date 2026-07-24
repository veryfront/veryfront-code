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
  buildRedisCacheKeyPrefix,
  registerOwnedRedisCacheKeyPrefix,
  registerOwnedRedisCacheNamespace,
} from "./backends/redis-keyspace.ts";
import {
  buildFileCacheKeyPrefix,
  buildFileOperationCacheKey,
  buildSSRModuleCacheKey,
} from "./keys/index.ts";
import { buildReleaseModuleResponseCacheKey } from "#veryfront/modules/server/module-response-cache.ts";
import { createProjectCSSRequestContext } from "#veryfront/html/styles-builder/project-css-cache.ts";

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

  it("should match projectId in redis-prefixed keys", () => {
    assertEquals(
      isKeyForProject("veryfront:ssr-module:v1:project123:path", "project123"),
      true,
    );
    assertEquals(
      isKeyForProject("vf:ssr-module:v1:project123:release-r1:path", "project123"),
      true,
    );
    assertEquals(
      isKeyForProject("vf:cache:file:branch:project123:main:path", "project123"),
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

  // Redis-prefixed keys (veryfront:ssr-module:, etc.)
  it("should strip veryfront:ssr-module: prefix", () => {
    assertEquals(
      isKeyForProjectEnvironment(
        "veryfront:ssr-module:v2:proj1:release-abc:file",
        "proj1",
        "production",
      ),
      true,
    );
  });

  it("should strip veryfront:file-cache: prefix", () => {
    assertEquals(
      isKeyForProjectEnvironment(
        "veryfront:file-cache:file:branch:proj1:main:path",
        "proj1",
        "preview",
      ),
      true,
    );
  });

  it("should strip veryfront:transform: prefix", () => {
    assertEquals(
      isKeyForProjectEnvironment(
        "veryfront:transform:proj1:production:key:v1",
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

  it("should scan every Redis page when deleting project keys", async () => {
    const deletedBatches: string[][] = [];
    let targetPrefixScans = 0;
    const targetKey = "veryfront:ssr-module:v1:target:release-r1:file.ts";
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) => {
            if (options?.MATCH !== "veryfront:ssr-module:*") {
              return Promise.resolve({ cursor: 0, keys: [] });
            }
            targetPrefixScans++;
            if (targetPrefixScans === 1) {
              return Promise.resolve({
                cursor: 1,
                keys: Array.from(
                  { length: 1_000 },
                  (_, index) => `veryfront:ssr-module:v1:other:release-r1:${index}`,
                ),
              });
            }
            return Promise.resolve({ cursor: 0, keys: [targetKey] });
          },
          del: (keys) => {
            const batch = Array.isArray(keys) ? [...keys] : [keys];
            deletedBatches.push(batch);
            return Promise.resolve(batch.length);
          },
        }),
    });

    assertEquals(await registry.deleteRedisKeysForProject({ projectId: "target" }), 1);
    assertEquals(targetPrefixScans, 2);
    assertEquals(deletedBatches, [[targetKey]]);
  });

  it("should scan only built-in namespaces with reversible project ownership", async () => {
    const keysByPattern = new Map<string, string[]>([
      ["vf:module:*", ["vf:module:v1:target:release-r1:file.ts"]],
      ["vf:render:*", ["vf:render:target:production:release-r1:v1:page"]],
      ["vf:http-module:*", ["vf:http-module:v1:target:release-r1:manifest"]],
      ["vf:project-css:*", ["vf:project-css:v1:target:release-r1:styles"]],
      ["vf:workflow:*", ["vf:workflow:v1:target:release-r1:must-not-delete"]],
    ]);
    const scannedPatterns: string[] = [];
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) => {
            const pattern = options?.MATCH ?? "";
            scannedPatterns.push(pattern);
            return Promise.resolve({ cursor: 0, keys: keysByPattern.get(pattern) ?? [] });
          },
          del: (keys) => {
            const batch = Array.isArray(keys) ? keys : [keys];
            deletedKeys.push(...batch);
            return Promise.resolve(batch.length);
          },
        }),
    });

    assertEquals(await registry.deleteRedisKeysForProject({ projectId: "target" }), 1);
    assertEquals(
      scannedPatterns.includes("vf:render:*") &&
        scannedPatterns.includes("vf:project-css:*") &&
        !scannedPatterns.includes("vf:module:*") &&
        !scannedPatterns.includes("vf:http-module:*"),
      true,
    );
    assertEquals(scannedPatterns.includes("vf:workflow:*"), false);
    assertEquals(deletedKeys, ["vf:render:target:production:release-r1:v1:page"]);
  });

  it("should never infer project ownership for opaque configured or content-addressed keys", async () => {
    const configuredPrefix = buildRedisCacheKeyPrefix("configured");
    registerOwnedRedisCacheKeyPrefix(configuredPrefix);
    const fileKey = `vf:cache:${
      buildFileOperationCacheKey(
        buildFileCacheKeyPrefix({
          sourceType: "branch",
          projectSlug: "target-slug",
          branch: "main",
        }),
        "src/index.ts",
      )
    }`;
    const projectCssKey = `vf:project-css:${
      createProjectCSSRequestContext("target-slug", undefined, new Set(["flex"]), {
        environment: "preview",
      }).cacheKey
    }`;
    const ssrKey = `vf:ssr-module:${
      buildSSRModuleCacheKey(
        "test",
        "target",
        "preview-main:src/page.tsx",
      )
    }`;
    const moduleKey = `vf:module:${await buildReleaseModuleResponseCacheKey({
      projectIdentity: "target",
      projectDir: "/workspace/target",
      projectSlug: "target",
      branch: "main",
      releaseId: "release-1",
      runtimeVersion: "1",
      modulePath: "/@vite/env",
    })}`;
    const opaqueConfiguredKey = `${configuredPrefix}blob:target:opaque`;
    const keysByPattern = new Map<string, string[]>([
      ["vf:cache:*", [fileKey]],
      ["vf:project-css:*", [projectCssKey]],
      ["vf:ssr-module:*", [ssrKey]],
      ["vf:module:*", [moduleKey]],
      ["vf:configured:*", [opaqueConfiguredKey]],
    ]);
    const scannedPatterns: string[] = [];
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) => {
            const pattern = options?.MATCH ?? "";
            scannedPatterns.push(pattern);
            return Promise.resolve({ cursor: 0, keys: keysByPattern.get(pattern) ?? [] });
          },
          del: (keys) => {
            const batch = Array.isArray(keys) ? keys : [keys];
            deletedKeys.push(...batch);
            return Promise.resolve(batch.length);
          },
        }),
    });

    assertEquals(
      await registry.getRedisKeysForProject({ projectId: "target-slug" }),
      new Map(),
    );
    assertEquals(
      await registry.deleteRedisKeysForProject({
        projectId: "target",
        projectSlug: "target-slug",
      }),
      3,
    );
    assertEquals(deletedKeys.sort(), [fileKey, projectCssKey, ssrKey].sort());
    assertEquals(scannedPatterns.includes("vf:module:*"), false);
    assertEquals(scannedPatterns.includes("vf:configured:*"), false);
  });

  it("should apply exact namespace ownership when deleting one Redis environment", async () => {
    const previewFileKey = `vf:cache:${
      buildFileOperationCacheKey(
        buildFileCacheKeyPrefix({
          sourceType: "branch",
          projectSlug: "target-slug",
          branch: "main",
        }),
        "src/preview.ts",
      )
    }`;
    const productionFileKey = `vf:cache:${
      buildFileOperationCacheKey(
        buildFileCacheKeyPrefix({
          sourceType: "release",
          projectSlug: "target-slug",
          releaseId: "release-1",
        }),
        "src/production.ts",
      )
    }`;
    const namedEnvironmentFileKey = `vf:cache:${
      buildFileOperationCacheKey(
        buildFileCacheKeyPrefix({
          sourceType: "environment",
          projectSlug: "target-slug",
          environmentName: "Staging",
          releaseId: "release-2",
        }),
        "src/staging.ts",
      )
    }`;
    const previewSsrKey = `vf:ssr-module:${
      buildSSRModuleCacheKey(
        "test",
        "target-id",
        "preview-main:src/preview.tsx",
      )
    }`;
    const productionSsrKey = `vf:ssr-module:${
      buildSSRModuleCacheKey(
        "test",
        "target-id",
        "release-1:src/production.tsx",
      )
    }`;
    const localSsrKey = `vf:ssr-module:${
      buildSSRModuleCacheKey(
        "test",
        "target-id",
        "local-main:src/local.tsx",
      )
    }`;
    const previewCssKey = `vf:project-css:${
      createProjectCSSRequestContext("target-slug", undefined, new Set(["flex"]), {
        environment: "preview",
      }).cacheKey
    }`;
    const productionCssKey = `vf:project-css:${
      createProjectCSSRequestContext("target-slug", undefined, new Set(["grid"]), {
        environment: "production",
      }).cacheKey
    }`;
    const keysByPattern = new Map<string, string[]>([
      ["vf:cache:*", [previewFileKey, productionFileKey, namedEnvironmentFileKey]],
      ["vf:ssr-module:*", [previewSsrKey, productionSsrKey, localSsrKey]],
      ["vf:project-css:*", [previewCssKey, productionCssKey]],
    ]);
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) =>
            Promise.resolve({
              cursor: 0,
              keys: keysByPattern.get(options?.MATCH ?? "") ?? [],
            }),
          del: (keys) => {
            const batch = Array.isArray(keys) ? keys : [keys];
            deletedKeys.push(...batch);
            return Promise.resolve(batch.length);
          },
        }),
    });

    assertEquals(
      await registry.deleteRedisKeysForProjectEnvironment(
        { projectId: "target-id", projectSlug: "target-slug" },
        "preview",
      ),
      4,
    );
    assertEquals(
      deletedKeys.sort(),
      [previewFileKey, previewSsrKey, localSsrKey, previewCssKey].sort(),
    );

    deletedKeys.length = 0;
    assertEquals(
      await registry.deleteRedisKeysForProjectEnvironment(
        { projectId: "target-id", projectSlug: "target-slug" },
        "production",
      ),
      4,
    );
    assertEquals(
      deletedKeys.sort(),
      [productionFileKey, namedEnvironmentFileKey, productionSsrKey, productionCssKey].sort(),
    );
  });

  it("should scan an explicitly owned configured namespace as a literal prefix", async () => {
    const prefix = buildRedisCacheKeyPrefix("configured*[assets]");
    registerOwnedRedisCacheNamespace({
      prefix,
      matchProjectOwnership: (key) => {
        const parts = key.split(":");
        return parts[0] === "v1" && parts[1] ? { projectId: parts[1] } : null;
      },
    });
    const expectedPattern = "vf:configured\\*\\[assets\\]:*";
    const targetKey = `${prefix}v1:target:release-r1:asset`;
    const scannedPatterns: string[] = [];
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) => {
            const pattern = options?.MATCH ?? "";
            scannedPatterns.push(pattern);
            return Promise.resolve({
              cursor: 0,
              keys: pattern === expectedPattern ? [targetKey] : [],
            });
          },
          del: (keys) => {
            const batch = Array.isArray(keys) ? keys : [keys];
            deletedKeys.push(...batch);
            return Promise.resolve(batch.length);
          },
        }),
    });

    assertEquals(await registry.deleteRedisKeysForProject({ projectId: "target" }), 1);
    assertEquals(scannedPatterns.includes(expectedPattern), true);
    assertEquals(deletedKeys, [targetKey]);
  });

  it("should reject ownership upgrades for an existing opaque namespace", () => {
    assertThrows(
      () =>
        registerOwnedRedisCacheNamespace({
          prefix: "vf:transform:",
          matchProjectOwnership: (key) => ({ projectId: key }),
        }),
      TypeError,
      "already registered without project ownership",
    );
  });

  it("should not reinterpret a nested opaque namespace using its parent schema", async () => {
    const projectId = "nested-opaque-project";
    const prefix = `vf:render:${projectId}:`;
    registerOwnedRedisCacheKeyPrefix(prefix);
    const opaqueKey = `${prefix}preview:release-r1:v1:page`;
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) =>
            Promise.resolve({
              cursor: 0,
              keys: options?.MATCH === "vf:render:*" ? [opaqueKey] : [],
            }),
          del: (keys) => {
            const batch = Array.isArray(keys) ? keys : [keys];
            deletedKeys.push(...batch);
            return Promise.resolve(batch.length);
          },
        }),
    });

    assertEquals(await registry.getRedisKeysForProject({ projectId }), new Map());
    assertEquals(await registry.deleteRedisKeysForProject({ projectId }), 0);
    assertEquals(deletedKeys, []);
  });

  it("should reject ownership claims that overlap non-cache Redis data", () => {
    for (const prefix of ["vf:workflow:", "vf:token:", "vf:token:render:"]) {
      assertThrows(
        () => registerOwnedRedisCacheKeyPrefix(prefix),
        TypeError,
        "reserved non-cache namespace",
      );
    }
  });

  it("should reject missing or empty Redis project identities before scanning", async () => {
    const registry = new CacheRegistry({
      isConfigured: () => false,
      getClient: () => Promise.reject(new Error("must not connect")),
    });

    await assertRejects(
      () => registry.deleteRedisKeysForProject({}),
      TypeError,
      "requires a projectId or projectSlug",
    );
    await assertRejects(
      () => registry.getRedisKeysForProject({ projectSlug: " " }),
      TypeError,
      "must be a non-empty string",
    );
  });

  it("should apply the Redis listing limit after project filtering", async () => {
    let targetPrefixScans = 0;
    const targetKey = "vf:cache:file:branch:target:main:path.ts";
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) => {
            if (options?.MATCH !== "vf:cache:*") {
              return Promise.resolve({ cursor: 0, keys: [] });
            }
            targetPrefixScans++;
            if (targetPrefixScans === 1) {
              return Promise.resolve({
                cursor: "7",
                keys: Array.from(
                  { length: 1_000 },
                  (_, index) => `vf:cache:file:branch:other:main:${index}`,
                ),
              });
            }
            // SCAN may legally return duplicates; listings should not count
            // the same cache key twice or let duplicates consume the limit.
            return Promise.resolve({ cursor: "0", keys: [targetKey, targetKey] });
          },
          del: () => Promise.resolve(0),
        }),
    });

    assertEquals(
      await registry.getRedisKeysForProject({ projectSlug: "target" }),
      new Map([["vf:cache", [targetKey]]]),
    );
    assertEquals(targetPrefixScans, 2);
  });

  it("should finish scanning before deleting any matching Redis keys", async () => {
    const projectId = "scan-stability-target";
    const firstKey = `vf:render:${projectId}:preview:release-r1:v1:first`;
    const secondKey = `vf:render:${projectId}:preview:release-r1:v1:second`;
    let redisMutated = false;
    let renderScans = 0;
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) => {
            if (options?.MATCH !== "vf:render:*") {
              return Promise.resolve({ cursor: 0, keys: [] });
            }
            renderScans++;
            if (renderScans === 1) {
              return Promise.resolve({ cursor: 1, keys: [firstKey] });
            }
            // Model the weak traversal behavior an implementation can observe
            // after mutating the keyspace before its cursor reaches this page.
            return Promise.resolve({
              cursor: 0,
              keys: redisMutated ? [] : [secondKey],
            });
          },
          del: (keys) => {
            redisMutated = true;
            const batch = Array.isArray(keys) ? keys : [keys];
            deletedKeys.push(...batch);
            return Promise.resolve(batch.length);
          },
        }),
    });

    assertEquals(await registry.deleteRedisKeysForProject({ projectId }), 2);
    assertEquals(renderScans, 2);
    assertEquals(deletedKeys.sort(), [firstKey, secondKey].sort());
  });

  it("should preserve legacy string project-ID calls without matching slugs", async () => {
    const idKey = "vf:render:legacy-id:preview:release-r1:v1:page";
    const slugKey = `vf:cache:${
      buildFileOperationCacheKey(
        buildFileCacheKeyPrefix({
          sourceType: "branch",
          projectSlug: "legacy-id",
          branch: "main",
        }),
        "src/page.ts",
      )
    }`;
    const deletedKeys: string[] = [];
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) =>
            Promise.resolve({
              cursor: 0,
              keys: options?.MATCH === "vf:render:*"
                ? [idKey]
                : options?.MATCH === "vf:cache:*"
                ? [slugKey]
                : [],
            }),
          del: (keys) => {
            const batch = Array.isArray(keys) ? keys : [keys];
            deletedKeys.push(...batch);
            return Promise.resolve(batch.length);
          },
        }),
    });

    assertEquals(
      await registry.getRedisKeysForProject("legacy-id"),
      new Map([
        ["vf:render", [idKey]],
      ]),
    );
    assertEquals(await registry.deleteRedisKeysForProject("legacy-id"), 1);
    assertEquals(deletedKeys, [idKey]);
  });

  it("should propagate Redis deletion failures", async () => {
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: () => Promise.reject(new Error("redis unavailable")),
          del: () => Promise.resolve(0),
        }),
    });

    await assertRejects(
      () => registry.deleteRedisKeysForProject({ projectId: "target" }),
      Error,
      "redis unavailable",
    );
  });

  it("should abort deletion before mutation when Redis repeats a SCAN cursor", async () => {
    let deleteCalls = 0;
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: () =>
            Promise.resolve({
              cursor: 7,
              keys: ["vf:render:target:preview:branch-main:v1:page"],
            }),
          del: () => {
            deleteCalls++;
            return Promise.resolve(1);
          },
        }),
    });

    await assertRejects(
      () => registry.deleteRedisKeysForProject({ projectId: "target" }),
      Error,
      "repeated a cursor",
    );
    assertEquals(deleteCalls, 0);
  });

  it("should reject invalid Redis DEL counts", async () => {
    const registry = new CacheRegistry({
      isConfigured: () => true,
      getClient: () =>
        Promise.resolve({
          scan: (_cursor, options) =>
            Promise.resolve({
              cursor: 0,
              keys: options?.MATCH === "vf:render:*"
                ? ["vf:render:target:preview:branch-main:v1:page"]
                : [],
            }),
          del: () => Promise.resolve(2),
        }),
    });

    await assertRejects(
      () => registry.deleteRedisKeysForProject({ projectId: "target" }),
      TypeError,
      "invalid DEL count",
    );
  });
});
