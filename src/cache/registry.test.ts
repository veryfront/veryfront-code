/**
 * Cache Registry Tests
 *
 * Tests MapCacheStore, LRUCacheStore, isKeyForProject,
 * isKeyForProjectEnvironment, extractProjectIdFromKey,
 * and CacheRegistry instance operations.
 *
 * @module cache/registry.test
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  cacheRegistry,
  extractProjectIdFromKey,
  isKeyForProject,
  isKeyForProjectEnvironment,
  LRUCacheStore,
  MapCacheStore,
  registerLRUCache,
  registerMapCache,
} from "./registry.ts";

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
    keys: () => IterableIterator<string>;
    readonly size: number;
    delete: (key: string) => boolean;
    set: (key: string, value: unknown) => void;
    _map: Map<string, unknown>;
  } {
    const map = new Map<string, unknown>();

    return {
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

  it("should match projectId anywhere in parts", () => {
    assertEquals(isKeyForProject("a:b:c:project123", "project123"), true);
  });

  it("should return false for non-matching key", () => {
    assertEquals(isKeyForProject("a:b:c", "project123"), false);
  });

  it("should return false for single-part key", () => {
    assertEquals(isKeyForProject("nocolon", "project123"), false);
  });

  it("should handle empty string projectId", () => {
    assertEquals(isKeyForProject("a::b", ""), true);
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

  it("should match files cache with env source type", () => {
    assertEquals(
      isKeyForProjectEnvironment("files:env:proj1:preview:path", "proj1", "preview"),
      true,
    );
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
    registerMapCache("proj-store", m);

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
    registerMapCache("count-store", m);
    assertEquals(cacheRegistry.countKeysForProject("proj1"), 2);
  });

  it("should delete keys for a project", () => {
    const m = new Map<string, unknown>([
      ["x:proj1:a", 1],
      ["x:proj1:b", 2],
      ["x:proj2:c", 3],
    ]);
    registerMapCache("del-store", m);

    const deleted = cacheRegistry.deleteKeysForProject("proj1");
    assertEquals(deleted, 2);
    assertEquals(m.size, 1);
  });

  it("should delete keys for project environment", () => {
    const m = new Map<string, unknown>([
      ["proj1:production:r1:v1", 1],
      ["proj1:preview:b1:v1", 2],
      ["proj1:production:r2:v2", 3],
    ]);
    registerMapCache("env-store", m);

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
    registerMapCache("cs-store", m);

    const deleted = cacheRegistry.deleteKeysForContentSource("proj1", "abc");
    assertEquals(deleted, 2);
    assertEquals(m.size, 1);
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

  it("should clear all stores", () => {
    registerMapCache("x", new Map());
    registerMapCache("y", new Map());
    cacheRegistry.clear();
    assertEquals(cacheRegistry.getStoreNames().length, 0);
  });

  it("should handle stores without deleteWhere gracefully", () => {
    const minimalStore = {
      name: "minimal",
      keys: () => ["a:proj1:x"][Symbol.iterator](),
      size: () => 1,
    };
    cacheRegistry.register(minimalStore);

    const deleted = cacheRegistry.deleteKeysForProject("proj1");
    assertEquals(deleted, 0);
  });
});
