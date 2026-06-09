import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
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
      const cacheDir = await Deno.makeTempDir();
      const cachedPaths = new Map<string, string>();
      __injectCachesForTests({ cachedPaths });
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createSuffixCacheBackend({
          "code:123": "export const recovered = true;\n",
          "hash:123": "https://esm.sh/recovered@1",
        }))
      );

      try {
        const recovered = await recoverHttpBundleByHash(
          "123",
          cacheDir,
          () => Promise.resolve(null),
        );

        assertEquals(recovered, true);
        assertEquals(
          await Deno.readTextFile(join(cacheDir, "http-123.mjs")),
          "export const recovered = true;\n",
        );
        assertEquals([...cachedPaths.values()], [join(cacheDir, "http-123.mjs")]);
      } finally {
        await Deno.remove(cacheDir, { recursive: true });
      }
    });

    it("falls back to original URL re-fetch when distributed cache has URL metadata but no code", async () => {
      const cacheDir = await Deno.makeTempDir();
      const calls: Array<{ url: string; cacheDir: string }> = [];
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createSuffixCacheBackend({
          "hash:404": "https://esm.sh/fallback@1",
        }))
      );

      try {
        const recovered = await recoverHttpBundleByHash(
          "404",
          cacheDir,
          (url, options) => {
            calls.push({ url, cacheDir: options.cacheDir });
            return Promise.resolve(join(cacheDir, "http-404.mjs"));
          },
        );

        assertEquals(recovered, true);
        assertEquals(calls, [{ url: "https://esm.sh/fallback@1", cacheDir }]);
      } finally {
        await Deno.remove(cacheDir, { recursive: true });
      }
    });
  });

  describe("ensureHttpBundlesExist", () => {
    it("returns an empty array for an empty bundle list without touching the cache", async () => {
      const failed = await ensureHttpBundlesExist(
        [],
        "/tmp/does-not-matter",
        () => Promise.resolve(null),
      );
      assertEquals(failed, []);
    });

    it("reports missing bundles as failed when no distributed cache is available", async () => {
      const cacheDir = await Deno.makeTempDir();
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
        await Deno.remove(cacheDir, { recursive: true });
      }
    });

    it("treats already-present local bundles as satisfied (not failed)", async () => {
      const cacheDir = await Deno.makeTempDir();
      try {
        // A bundle that already exists locally with no transitive deps.
        const present = join(cacheDir, "http-100.mjs");
        await Deno.writeTextFile(present, "export const x = 1;\n");

        const failed = await ensureHttpBundlesExist(
          [{ path: present, hash: "100" }],
          cacheDir,
          () => Promise.resolve(null),
        );
        assertEquals(failed, []);
      } finally {
        await Deno.remove(cacheDir, { recursive: true });
      }
    });
  });

  describe("invalidateHttpBundle", () => {
    it("removes an existing local bundle file and returns true", async () => {
      const cacheDir = await Deno.makeTempDir();
      try {
        const cachePath = join(cacheDir, "http-555.mjs");
        await Deno.writeTextFile(cachePath, "export const y = 2;\n");

        const result = await invalidateHttpBundle("555", cacheDir);
        assertEquals(result, true);

        // The local file should be gone.
        let stillExists = true;
        try {
          await Deno.stat(cachePath);
        } catch {
          stillExists = false;
        }
        assert(!stillExists, "expected local bundle file to be removed");
      } finally {
        await Deno.remove(cacheDir, { recursive: true });
      }
    });

    it("returns true even when the local bundle file does not exist", async () => {
      const cacheDir = await Deno.makeTempDir();
      try {
        const result = await invalidateHttpBundle("does-not-exist", cacheDir);
        assertEquals(result, true);
      } finally {
        await Deno.remove(cacheDir, { recursive: true });
      }
    });
  });
});
