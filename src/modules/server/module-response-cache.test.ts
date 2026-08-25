import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import {
  __setReleaseModuleResponseDistributedCacheForTests,
  buildReleaseModuleResponseCacheKey,
  clearReleaseModuleResponseCache,
  getReleaseModuleResponse,
  type ReleaseModuleResponseCacheEntry,
  rememberReleaseModuleResponse,
} from "./module-response-cache.ts";

// Mirrors the distributed cache backend's key validator
// (veryfront-api `CACHE_KEY_PATTERN`): only alphanumeric, underscore, colon,
// dot, hyphen, and forward slash are accepted by GET/SET operations.
const CACHE_KEY_PATTERN = /^[a-zA-Z0-9_:.\-/]+$/;
const API_CACHE_KEY_MAX_LENGTH = 512;
const CANONICAL_PIN_KEY = "on:z7bg3qnfgtcb";
const CHANGED_CANONICAL_PIN_KEY = "on:z7bg3qnfgtcc";

function baseKeyOptions(modulePath: string) {
  return {
    projectIdentity: "94af4820-ce16-44e0-9fc4-cd8688f3cc1d",
    projectDir: "/srv/releases/tomcode",
    projectSlug: "tomcode",
    branch: null,
    releaseId: "4dcecc2c-dd99-4005-bed7-a9203efa0f37",
    runtimeVersion: "0.1.1040",
    reactVersion: "18.3.1",
    releaseDependencyManifestVersion: 7,
    modulePath,
  };
}

class FakeDistributedCache implements CacheBackend {
  readonly type = "redis" as const;
  readonly values = new Map<string, string>();
  readonly ttlSeconds = new Map<string, number | undefined>();
  readonly getKeys: string[] = [];

  get(key: string): Promise<string | null> {
    this.getKeys.push(key);
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.values.set(key, value);
    this.ttlSeconds.set(key, ttlSeconds);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.values.delete(key);
    this.ttlSeconds.delete(key);
    return Promise.resolve();
  }
}

describe("release module response cache", () => {
  afterEach(() => {
    __setReleaseModuleResponseDistributedCacheForTests(undefined);
    clearReleaseModuleResponseCache();
  });

  it("recovers release module responses from distributed cache when local cache is empty", async () => {
    const distributedCache = new FakeDistributedCache();
    __setReleaseModuleResponseDistributedCacheForTests(distributedCache);

    const cacheKey = "release-module-response:test";
    const entry: ReleaseModuleResponseCacheEntry = {
      body: "export const value = 1;\n",
      status: 200,
      headers: [["cache-control", "public, max-age=31536000, immutable"]],
    };

    await rememberReleaseModuleResponse(cacheKey, entry);
    clearReleaseModuleResponseCache();

    const recovered = await getReleaseModuleResponse(cacheKey);

    assertEquals(recovered?.source, "distributed");
    assertEquals(recovered?.entry, entry);
    assertEquals(typeof distributedCache.ttlSeconds.get(cacheKey), "number");
  });

  it("serves a remembered response from the in-memory cache without touching the distributed backend", async () => {
    const distributedCache = new FakeDistributedCache();
    __setReleaseModuleResponseDistributedCacheForTests(distributedCache);

    const cacheKey = "release-module-response:memory";
    const entry: ReleaseModuleResponseCacheEntry = {
      body: "export const value = 1;\n",
      status: 200,
      headers: [["cache-control", "public, max-age=31536000, immutable"]],
    };

    await rememberReleaseModuleResponse(cacheKey, entry);

    const hit = await getReleaseModuleResponse(cacheKey);

    assertEquals(hit?.source, "memory", "a remembered response must be served from the local LRU");
    assertEquals(hit?.entry, entry, "the local LRU must return the remembered entry");
    assertEquals(
      distributedCache.getKeys.length,
      0,
      "a local hit must not call the distributed backend",
    );
  });

  it("warms the in-memory cache from a distributed hit", async () => {
    const distributedCache = new FakeDistributedCache();
    __setReleaseModuleResponseDistributedCacheForTests(distributedCache);

    const cacheKey = "release-module-response:warm";
    const entry: ReleaseModuleResponseCacheEntry = {
      body: "export const value = 1;\n",
      status: 200,
      headers: [["cache-control", "public, max-age=31536000, immutable"]],
    };

    await rememberReleaseModuleResponse(cacheKey, entry);
    clearReleaseModuleResponseCache();

    const first = await getReleaseModuleResponse(cacheKey);
    assertEquals(
      first?.source,
      "distributed",
      "an empty local cache must fall back to distributed",
    );

    const second = await getReleaseModuleResponse(cacheKey);
    assertEquals(second?.source, "memory", "a distributed hit must warm the local LRU");
    assertEquals(second?.entry, entry, "the warmed local entry must match the distributed entry");
    assertEquals(
      distributedCache.getKeys.length,
      1,
      "the second read must not re-query the distributed backend",
    );
  });

  it("rejects malformed distributed payloads instead of serving them", async () => {
    for (
      const raw of [
        "not json",
        '{"body":123,"status":200,"headers":[]}',
        '{"body":"x","status":"200","headers":[]}',
        '{"body":"x","status":200,"headers":[["a"]]}',
      ]
    ) {
      const distributedCache = new FakeDistributedCache();
      __setReleaseModuleResponseDistributedCacheForTests(distributedCache);

      const cacheKey = "release-module-response:malformed";
      distributedCache.values.set(cacheKey, raw);
      clearReleaseModuleResponseCache();

      assertEquals(
        await getReleaseModuleResponse(cacheKey),
        undefined,
        `malformed distributed payload must not be served: ${raw}`,
      );
    }
  });

  it("builds cache keys within the distributed backend's allowed charset", () => {
    // Request paths that previously produced HTTP 400 "Cache key contains
    // invalid characters" from api-cache-backend (issue #5559).
    for (
      const modulePath of [
        "@vite/env",
        "_veryfront/chat/index.js",
        "@/components/ResponsiveImage",
        "deps/@scope/pkg@1.2.3.js",
      ]
    ) {
      const key = buildReleaseModuleResponseCacheKey(baseKeyOptions(modulePath));
      assertEquals(
        CACHE_KEY_PATTERN.test(key),
        true,
        `key must satisfy cache validator for modulePath "${modulePath}": ${key}`,
      );
      assertEquals(key.includes("\0"), false, "key must not contain NUL separators");
      assertEquals(key.includes("@"), false, "key must not contain '@'");
    }
  });

  it("produces distinct keys for distinct module paths", () => {
    const a = buildReleaseModuleResponseCacheKey(baseKeyOptions("@vite/env"));
    // Differs from "@vite/env" only by a character the readable form clamps to
    // "-"; the path hash keeps the keys apart.
    const b = buildReleaseModuleResponseCacheKey(baseKeyOptions("-vite/env"));
    assertEquals(a === b, false);
  });

  it("isolates responses by dependency pinning flag and package map state", () => {
    const unkeyed = buildReleaseModuleResponseCacheKey(
      baseKeyOptions("@vite/env"),
    );
    const flagOff = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      dependencyPinningCacheKey: "off",
    });
    const firstPins = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      dependencyPinningCacheKey: CANONICAL_PIN_KEY,
    });
    const changedPins = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      dependencyPinningCacheKey: CHANGED_CANONICAL_PIN_KEY,
    });

    assertEquals(new Set([flagOff, firstPins, changedPins]).size, 3);
    assertEquals(flagOff, unkeyed);
  });

  it("isolates responses by the configured server external package set", () => {
    const baseline = buildReleaseModuleResponseCacheKey(baseKeyOptions("@vite/env"));
    const knex = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      serverExternalPackages: ["knex"],
    });
    const prismaAndKnex = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      serverExternalPackages: ["@prisma/client", "knex"],
    });
    const reordered = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      serverExternalPackages: ["knex", "@prisma/client"],
    });

    assertEquals(knex === baseline, false);
    assertEquals(prismaAndKnex === knex, false);
    assertEquals(reordered, prismaAndKnex);
  });

  it("isolates pin-on responses by module server origin without changing flag-off keys", () => {
    const unkeyed = buildReleaseModuleResponseCacheKey(
      baseKeyOptions("@vite/env"),
    );
    const flagOffFirstOrigin = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      dependencyPinningCacheKey: "off",
      moduleServerOrigin: "https://first.example.test",
    });
    const flagOffSecondOrigin = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      dependencyPinningCacheKey: "off",
      moduleServerOrigin: "https://second.example.test",
    });
    const pinOnFirstOrigin = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      moduleServerOrigin: "https://first.example.test",
    });
    const pinOnSecondOrigin = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions("@vite/env"),
      dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      moduleServerOrigin: "https://second.example.test",
    });

    assertEquals(flagOffFirstOrigin, unkeyed);
    assertEquals(flagOffSecondOrigin, unkeyed);
    assertEquals(pinOnFirstOrigin === pinOnSecondOrigin, false);
  });

  it("bounds the complete distributed key and uses the same identity for reads and writes", async () => {
    const distributedCache = new FakeDistributedCache();
    __setReleaseModuleResponseDistributedCacheForTests(distributedCache);
    const rawCacheKey = buildReleaseModuleResponseCacheKey({
      ...baseKeyOptions(`src/${"nested/".repeat(58)}module.tsx`),
      dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      moduleServerOrigin: "https://preview.example.test",
    });
    const entry: ReleaseModuleResponseCacheEntry = {
      body: "export const value = 1;\n",
      status: 200,
      headers: [["cache-control", "public, max-age=31536000, immutable"]],
    };

    await rememberReleaseModuleResponse(rawCacheKey, entry);

    const distributedKeys = [...distributedCache.values.keys()];
    assertEquals(distributedKeys.length, 1);
    assertEquals(distributedKeys[0] === rawCacheKey, false);
    const completeDistributedKey = `module:${distributedKeys[0]}`;
    assertEquals(completeDistributedKey.length <= API_CACHE_KEY_MAX_LENGTH, true);
    assertEquals(CACHE_KEY_PATTERN.test(completeDistributedKey), true);

    clearReleaseModuleResponseCache();
    const recovered = await getReleaseModuleResponse(rawCacheKey);
    assertEquals(recovered?.source, "distributed");
    assertEquals(recovered?.entry, entry);
  });

  it("does not use disk cache backends for release module responses", async () => {
    const diskCache = new FakeDistributedCache();
    Object.defineProperty(diskCache, "type", { value: "disk" });
    __setReleaseModuleResponseDistributedCacheForTests(diskCache);

    const cacheKey = "release-module-response:disk";
    const entry: ReleaseModuleResponseCacheEntry = {
      body: "export const value = 1;\n",
      status: 200,
      headers: [["cache-control", "public, max-age=31536000, immutable"]],
    };

    await rememberReleaseModuleResponse(cacheKey, entry);
    clearReleaseModuleResponseCache();

    const recovered = await getReleaseModuleResponse(cacheKey);

    assertEquals(recovered, undefined);
    assertEquals(diskCache.values.size, 0);
  });
});
