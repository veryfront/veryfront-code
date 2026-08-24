import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import {
  ensureHttpBundlesExist,
  invalidateHttpBundle,
  recoverHttpBundleByHash,
} from "./bundle-recovery.ts";
import { __injectCachesForTests } from "./http-cache-state.ts";
import { __setDistributedCacheAccessorForTests } from "./http-cache-wrapper.ts";
import { buildHttpCacheIdentity, hashHttpCacheIdentity } from "./http-cache-helpers.ts";
import { markDegradedArtifact } from "./degraded-artifact.ts";
import { MAX_CACHED_HTTP_BUNDLE_BYTES } from "./http-bundle-file.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";

function createSuffixCacheBackend(entries: Record<string, string>): CacheBackend {
  const values = new Map(Object.entries(entries));

  function suffixKey(key: string): string {
    const match = /^[^:]+:([^:]+):(.+)$/.exec(key);
    if (!match) return key;
    return `${match[1]}:${match[2]}`;
  }

  return {
    type: "memory",
    get: (key) => Promise.resolve(values.get(suffixKey(key)) ?? null),
    set: (key, value) => {
      values.set(suffixKey(key), value);
      return Promise.resolve();
    },
    del: (key) => {
      values.delete(suffixKey(key));
      return Promise.resolve();
    },
  };
}

// Force the distributed cache to be unavailable so the recovery/invalidation
// code paths are fully deterministic and never touch a real backend.
beforeEach(() => {
  __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
});

afterEach(() => {
  __setDistributedCacheAccessorForTests(null);
  __injectCachesForTests(null);
});

describe("transforms/esm/bundle-recovery", () => {
  describe("recoverHttpBundleByHash", () => {
    it("writes code recovered by hash from distributed cache and refreshes local path state", async () => {
      const cacheDir = await makeTempDir();
      const cachedPaths = new Map<string, string>();
      const url = "https://esm.sh/recovered@1";
      const hash = await hashHttpCacheIdentity(
        await buildHttpCacheIdentity(url, { importMap: { imports: {}, scopes: {} } }),
      );
      __injectCachesForTests({ cachedPaths });
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createSuffixCacheBackend({
          [`code:${hash}`]: "export const recovered = true;\n",
          [`hash:${hash}`]: url,
        }))
      );

      try {
        const recovered = await recoverHttpBundleByHash(
          hash,
          cacheDir,
          () => Promise.resolve(null),
        );

        assertEquals(recovered, true);
        assertEquals(
          await readTextFile(join(cacheDir, `http-${hash}.mjs`)),
          "export const recovered = true;\n",
        );
        assertEquals([...cachedPaths.values()], [join(cacheDir, `http-${hash}.mjs`)]);
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });

    it("restores the canonical React and import-map identity during recovery", async () => {
      const cacheDir = await makeTempDir();
      const cachedPaths = new Map<string, string>();
      const url = "https://esm.sh/recovered@1";
      const identity = {
        url,
        reactVersion: "18.3.1",
        importMap: {
          imports: { dependency: "https://cdn.example.com/dependency@2.js" },
          scopes: { "/app/": { scoped: "https://cdn.example.com/scoped@3.js" } },
        },
      };
      const cacheIdentity = await buildHttpCacheIdentity(url, identity);
      const hash = await hashHttpCacheIdentity(cacheIdentity);
      __injectCachesForTests({ cachedPaths });
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createSuffixCacheBackend({
          [`code:${hash}`]: "export const recovered = true;\n",
          [`hash:${hash}`]: url,
          [`identity:${hash}`]: JSON.stringify(identity),
        }))
      );

      try {
        const recovered = await recoverHttpBundleByHash(
          hash,
          cacheDir,
          () => Promise.resolve(null),
        );

        assertEquals(recovered, true);
        const cacheKey = [...cachedPaths.keys()][0];
        assert(cacheKey);
        assertEquals(cacheKey, `${cacheDir}:${cacheIdentity}`);
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });

    it("falls back to original URL re-fetch when distributed cache has URL metadata but no code", async () => {
      const cacheDir = await makeTempDir();
      const importMap = {
        imports: { dependency: "https://cdn.example.com/dependency@2.js" },
        scopes: { "/app/": { scoped: "https://cdn.example.com/scoped@3.js" } },
      };
      const calls: Array<{
        url: string;
        cacheDir: string;
        reactVersion?: string;
        importMap: typeof importMap;
      }> = [];
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createSuffixCacheBackend({
          "hash:404": "https://esm.sh/fallback@1",
          "identity:404": JSON.stringify({
            url: "https://esm.sh/fallback@1",
            reactVersion: "18.3.1",
            importMap,
          }),
        }))
      );

      try {
        const recovered = await recoverHttpBundleByHash(
          "404",
          cacheDir,
          (url, options) => {
            calls.push({
              url,
              cacheDir: options.cacheDir,
              reactVersion: options.reactVersion,
              importMap: options.importMap as typeof importMap,
            });
            return Promise.resolve(join(cacheDir, "http-404.mjs"));
          },
        );

        assertEquals(recovered, true);
        assertEquals(calls, [{
          url: "https://esm.sh/fallback@1",
          cacheDir,
          reactVersion: "18.3.1",
          importMap,
        }]);
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });

    it("materializes URL re-fetches under a legacy numeric bundle path", async () => {
      const cacheDir = await makeTempDir();
      const legacyHash = "390496888";
      const url = "https://esm.sh/legacy@1";
      const regeneratedPath = join(cacheDir, `http-${"a".repeat(64)}.mjs`);
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createSuffixCacheBackend({
          [`hash:${legacyHash}`]: url,
        }))
      );

      try {
        const recovered = await recoverHttpBundleByHash(
          legacyHash,
          cacheDir,
          async () => {
            await writeTextFile(regeneratedPath, "export const recovered = true;\n");
            return regeneratedPath;
          },
        );

        assertEquals(recovered, true);
        assertEquals(
          await readTextFile(join(cacheDir, `http-${legacyHash}.mjs`)),
          "export const recovered = true;\n",
        );
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });

    it("refuses cached code that fails the direct-recovery guard", async () => {
      const rejectedCodeCases: Array<[string, string]> = [
        ["a degraded artifact", markDegradedArtifact("export const x = 1;")],
        [
          "code carrying another pod's absolute cache paths",
          `import "file:///other-pod/.cache/veryfront-http-bundle/http-abc.mjs";\n`,
        ],
        [
          "code larger than the cached bundle byte limit",
          `export const big = "${"x".repeat(MAX_CACHED_HTTP_BUNDLE_BYTES)}";`,
        ],
      ];

      for (const [label, cachedCode] of rejectedCodeCases) {
        const cacheDir = await makeTempDir();
        const hash = "abc123";
        const url = "https://esm.sh/rejected@1";
        const refetched: string[] = [];
        __setDistributedCacheAccessorForTests(() =>
          Promise.resolve(createSuffixCacheBackend({
            [`code:${hash}`]: cachedCode,
            [`hash:${hash}`]: url,
          }))
        );

        try {
          const recovered = await recoverHttpBundleByHash(
            hash,
            cacheDir,
            (requestedUrl) => {
              refetched.push(requestedUrl);
              return Promise.resolve(null);
            },
          );

          assertEquals(refetched, [url], `${label} falls through to URL re-fetch`);
          assertEquals(recovered, false, `${label} is not reported as a successful recovery`);
          await assertRejects(
            () => readTextFile(join(cacheDir, `http-${hash}.mjs`)),
            `${label} must never be written to the canonical bundle path`,
          );
        } finally {
          await remove(cacheDir, { recursive: true });
        }
      }
    });
  });

  describe("ensureHttpBundlesExist", () => {
    it("materializes distributed-cache hits and their transitive deps on disk", async () => {
      const cacheDir = await makeTempDir();
      const hashA = "aaa111";
      const hashB = "bbb222";
      const codeA = `import "./http-${hashB}.mjs";\nexport const a = 1;\n`;
      const codeB = "export const b = 2;\n";
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createSuffixCacheBackend({
          [`code:${hashA}`]: codeA,
          [`hash:${hashA}`]: "https://esm.sh/a@1",
          [`code:${hashB}`]: codeB,
          [`hash:${hashB}`]: "https://esm.sh/b@1",
        }))
      );

      try {
        const failed = await ensureHttpBundlesExist(
          [{ path: join(cacheDir, `http-${hashA}.mjs`), hash: hashA }],
          cacheDir,
          () => Promise.resolve(null),
        );

        assertEquals(failed, [], "a distributed-cache hit satisfies the bundle");
        assertEquals(
          await readTextFile(join(cacheDir, `http-${hashA}.mjs`)),
          codeA,
          "the recovered bundle is materialized at the canonical path",
        );
        assertEquals(
          await readTextFile(join(cacheDir, `http-${hashB}.mjs`)),
          codeB,
          "transitive deps of a recovered bundle are recovered too",
        );
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });

    it("reports a transitive dep the distributed cache cannot supply", async () => {
      const cacheDir = await makeTempDir();
      const hashA = "aaa111";
      const hashB = "bbb222";
      const codeA = `import "./http-${hashB}.mjs";\nexport const a = 1;\n`;
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createSuffixCacheBackend({
          [`code:${hashA}`]: codeA,
          [`hash:${hashA}`]: "https://esm.sh/a@1",
        }))
      );

      try {
        const failed = await ensureHttpBundlesExist(
          [{ path: join(cacheDir, `http-${hashA}.mjs`), hash: hashA }],
          cacheDir,
          () => Promise.resolve(null),
        );

        assertEquals(
          failed,
          [hashB],
          "an unrecoverable transitive dep is reported as failed",
        );
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });

    it("returns an empty array for an empty bundle list without touching the cache", async () => {
      const failed = await ensureHttpBundlesExist(
        [],
        "/tmp/does-not-matter",
        () => Promise.resolve(null),
      );
      assertEquals(failed, []);
    });

    it("reports missing bundles as failed when no distributed cache is available", async () => {
      const cacheDir = await makeTempDir();
      try {
        const failed = await ensureHttpBundlesExist(
          [{ path: join(cacheDir, "http-999.mjs"), hash: "999" }],
          cacheDir,
          // cacheHttpModule should never be reached because the cache is
          // unavailable; if it were, returning null keeps the test honest.
          () => Promise.resolve(null),
        );
        assertEquals(failed, ["999"]);
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });

    it("treats already-present local bundles as satisfied (not failed)", async () => {
      const cacheDir = await makeTempDir();
      try {
        // A bundle that already exists locally with no transitive deps.
        const present = join(cacheDir, "http-100.mjs");
        await writeTextFile(present, "export const x = 1;\n");

        const failed = await ensureHttpBundlesExist(
          [{ path: present, hash: "100" }],
          cacheDir,
          () => Promise.resolve(null),
        );
        assertEquals(failed, []);
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });
  });

  describe("invalidateHttpBundle", () => {
    it("removes an existing local bundle file and returns true", async () => {
      const cacheDir = await makeTempDir();
      try {
        const cachePath = join(cacheDir, "http-555.mjs");
        await writeTextFile(cachePath, "export const y = 2;\n");

        const result = await invalidateHttpBundle("555", cacheDir);
        assertEquals(result, true);

        // The local file should be gone.
        let stillExists = true;
        try {
          await stat(cachePath);
        } catch {
          stillExists = false;
        }
        assert(!stillExists, "expected local bundle file to be removed");
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });

    it("returns true even when the local bundle file does not exist", async () => {
      const cacheDir = await makeTempDir();
      try {
        const result = await invalidateHttpBundle("deadbeef", cacheDir);
        assertEquals(result, true);
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });

    it("rejects invalid hashes before constructing a filesystem path", async () => {
      const parentDir = await makeTempDir();
      const cacheDir = join(parentDir, "cache");
      const sentinelPath = join(parentDir, "sentinel.mjs");
      try {
        await mkdir(cacheDir);
        await writeTextFile(sentinelPath, "keep");

        const result = await invalidateHttpBundle("../sentinel", cacheDir);

        assertEquals(result, false);
        assertEquals(await readTextFile(sentinelPath), "keep");
      } finally {
        await remove(parentDir, { recursive: true });
      }
    });
  });
});
