import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  deleteEnv,
  makeTempDir,
  readDir,
  setEnv,
  writeFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { buildSSRModuleCacheKey } from "#veryfront/cache/keys.ts";
import {
  CacheBackends,
  isLocalDevDiskCacheEnabled,
  isPersistentLocalCacheEnabled,
} from "./factory.ts";

const ENV_KEYS = [
  "NODE_ENV",
  "VERYFRONT_ENV",
  "DENO_ENV",
  "REDIS_URL",
  "PROXY_MODE",
  "VERYFRONT_API_BASE_URL",
  "VF_CACHE_BACKEND",
  "VF_DISK_CACHE_DIR",
] as const;

/** Put the process in the state a `veryfront dev` server runs in. */
function useLocalDevEnvironment(): void {
  for (const key of ENV_KEYS) deleteEnv(key);
}

describe("local dev disk cache gating", () => {
  it("turns on for a local dev server with no distributed cache", () => {
    useLocalDevEnvironment();

    assertEquals(isLocalDevDiskCacheEnabled(), true);
  });

  it("stays off for a production runtime", () => {
    useLocalDevEnvironment();
    setEnv("NODE_ENV", "production");

    assertEquals(isLocalDevDiskCacheEnabled(), false);
  });

  it("stays off when the hosted API cache is available", () => {
    useLocalDevEnvironment();
    setEnv("PROXY_MODE", "1");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.example.test");

    assertEquals(isLocalDevDiskCacheEnabled(), false);
  });

  it("stays off when Redis backs the transform cache", () => {
    useLocalDevEnvironment();
    setEnv("REDIS_URL", "redis://localhost:6379");

    assertEquals(isLocalDevDiskCacheEnabled(), false);
  });

  it("stays off when you choose a backend explicitly", () => {
    useLocalDevEnvironment();
    setEnv("VF_CACHE_BACKEND", "memory");

    assertEquals(isLocalDevDiskCacheEnabled(), false);
  });
});

describe("persistent local cache availability", () => {
  it("reports a cache to initialize for a local dev server", () => {
    useLocalDevEnvironment();

    // The dev server gates the cache initializers on this. Without it the SSR
    // module cache stays disabled and the loader skips reads and writes.
    assertEquals(isPersistentLocalCacheEnabled(), true);
  });

  it("reports a cache to initialize when the disk backend is configured explicitly", () => {
    useLocalDevEnvironment();
    setEnv("NODE_ENV", "production");
    setEnv("VF_CACHE_BACKEND", "disk");

    assertEquals(isPersistentLocalCacheEnabled(), true);
  });

  it("reports nothing to initialize for a memory-only runtime", () => {
    useLocalDevEnvironment();
    setEnv("NODE_ENV", "production");

    assertEquals(isPersistentLocalCacheEnabled(), false);
  });
});

describe("SSR module cache backend selection", () => {
  it("resolves the disk backend for a local dev server", async () => {
    useLocalDevEnvironment();

    const backend = await CacheBackends.ssrModule();

    assertEquals(backend.type, "disk");
  });

  it("resolves the memory backend for a production runtime without a distributed cache", async () => {
    useLocalDevEnvironment();
    setEnv("NODE_ENV", "production");

    const backend = await CacheBackends.ssrModule();

    assertEquals(backend.type, "memory");
  });
});

describe("SSR module cache persistence across a dev-server restart", () => {
  const CODE = 'export default function Page() { return "ok"; }';

  function cacheKey(options?: {
    runtimeVersion?: string;
    projectId?: string;
    contentHash?: string;
  }): string {
    return buildSSRModuleCacheKey(
      options?.runtimeVersion ?? "1.0.0",
      options?.projectId ?? "project-a",
      `preview-main:19.1.1:cfg:/app/pages/index.tsx:${options?.contentHash ?? "hash-1"}`,
    );
  }

  it("reads a cold-written entry back from a fresh cache instance", async () => {
    useLocalDevEnvironment();
    const cacheDir = await makeTempDir({ prefix: "vf-dev-disk-cache-" });

    await runWithCacheDir(cacheDir, async () => {
      const coldStart = await CacheBackends.ssrModule();
      assertEquals(await coldStart.get(cacheKey()), null);
      await coldStart.set(cacheKey(), CODE, 3600);

      // A new backend instance over the same directory is what a restarted dev
      // server sees: no in-memory state, only what reached the disk.
      const afterRestart = await CacheBackends.ssrModule();
      assertEquals(await afterRestart.get(cacheKey()), CODE);
    });
  });

  it("misses when the source content, framework version, or project changes", async () => {
    useLocalDevEnvironment();
    const cacheDir = await makeTempDir({ prefix: "vf-dev-disk-cache-" });

    await runWithCacheDir(cacheDir, async () => {
      const backend = await CacheBackends.ssrModule();
      await backend.set(cacheKey(), CODE, 3600);

      const afterRestart = await CacheBackends.ssrModule();
      assertNotEquals(cacheKey({ contentHash: "hash-2" }), cacheKey());
      assertEquals(await afterRestart.get(cacheKey({ contentHash: "hash-2" })), null);
      assertEquals(await afterRestart.get(cacheKey({ runtimeVersion: "2.0.0" })), null);
      assertEquals(await afterRestart.get(cacheKey({ projectId: "project-b" })), null);
    });
  });

  it("treats a corrupt entry as a miss", async () => {
    useLocalDevEnvironment();
    const cacheDir = await makeTempDir({ prefix: "vf-dev-disk-cache-" });

    await runWithCacheDir(cacheDir, async () => {
      const backend = await CacheBackends.ssrModule();
      await backend.set(cacheKey(), CODE, 3600);

      const entryDir = join(cacheDir, "veryfront-files", "ssr-module");
      for await (const entry of readDir(entryDir)) {
        if (!entry.name.endsWith(".vfcache")) continue;
        await writeFile(join(entryDir, entry.name), new Uint8Array([1, 2, 3, 4]));
      }

      const afterRestart = await CacheBackends.ssrModule();
      assertEquals(await afterRestart.get(cacheKey()), null);
    });
  });

  it("reports a miss instead of failing when the cache directory cannot be created", async () => {
    useLocalDevEnvironment();
    const tempDir = await makeTempDir({ prefix: "vf-dev-disk-cache-" });
    // A regular file where the cache root must be makes every mkdir fail, which
    // is the durable stand-in for a read-only or full disk.
    const blockedRoot = join(tempDir, "blocked");
    await writeFile(blockedRoot, new Uint8Array([0]));

    await runWithCacheDir(join(blockedRoot, "cache"), async () => {
      const backend = await CacheBackends.ssrModule();

      assertEquals(await backend.get(cacheKey()), null);
    });
  });
});
