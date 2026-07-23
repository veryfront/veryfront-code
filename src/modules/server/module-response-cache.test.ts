import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

  get(key: string): Promise<string | null> {
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

  it("rejects empty required cache identities", () => {
    for (
      const field of [
        "projectIdentity",
        "projectDir",
        "releaseId",
        "runtimeVersion",
        "modulePath",
      ] as const
    ) {
      const options = { ...baseKeyOptions("module.js"), [field]: "" };
      try {
        buildReleaseModuleResponseCacheKey(options);
        throw new Error(`Expected ${field} to be rejected`);
      } catch (error) {
        assertEquals(error instanceof RangeError, true);
      }
    }
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

  it("returns defensive copies of memory entries", async () => {
    const cacheKey = "release-module-response:defensive";
    const entry: ReleaseModuleResponseCacheEntry = {
      body: "export const value = 1;",
      status: 200,
      headers: [["cache-control", "no-cache"]],
    };
    await rememberReleaseModuleResponse(cacheKey, entry);

    const first = await getReleaseModuleResponse(cacheKey);
    first?.entry.headers.push(["set-cookie", "unsafe=true"]);
    first!.entry.body = "mutated";

    const second = await getReleaseModuleResponse(cacheKey);
    assertEquals(second?.entry, entry);
  });

  it("rejects invalid response entries before caching", async () => {
    await assertRejects(
      () =>
        rememberReleaseModuleResponse("release-module-response:invalid", {
          body: "export default 1;",
          status: 99,
          headers: [["set-cookie", "unsafe=true"]],
        }),
      TypeError,
      "Invalid release module response cache entry",
    );
  });

  it("rejects ambiguous or response-controlled headers", async () => {
    for (
      const headers of [
        [["content-length", "1"]],
        [["x-test", "one"], ["X-Test", "two"]],
      ]
    ) {
      await assertRejects(
        () =>
          rememberReleaseModuleResponse("release-module-response:headers", {
            body: "export default 1;",
            status: 200,
            headers: headers as Array<[string, string]>,
          }),
        TypeError,
        "Invalid release module response cache entry",
      );
    }
  });

  it("ignores malformed distributed response entries", async () => {
    const distributedCache = new FakeDistributedCache();
    const cacheKey = "release-module-response:malformed";
    distributedCache.values.set(
      cacheKey,
      JSON.stringify({ body: "ok", status: 200, headers: [["x-test", "bad\r\nvalue"]] }),
    );
    __setReleaseModuleResponseDistributedCacheForTests(distributedCache);

    assertEquals(await getReleaseModuleResponse(cacheKey), undefined);
  });
});
