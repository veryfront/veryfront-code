import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  deleteEnv,
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { CacheBackends } from "#veryfront/cache/backend.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import {
  DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC,
  LOCAL_DEV_SSR_MODULE_TTL_SEC,
} from "../constants.ts";

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

describe("SSR module distributed cache on a local dev server", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  it("keeps transformed code across a restart with no configuration", async () => {
    useLocalDevEnvironment();
    const cacheDir = await makeTempDir({ prefix: "vf-dev-ssr-cache-" });

    await runWithCacheDir(cacheDir, async () => {
      const bundlePath = join(cacheDir, "veryfront-http-bundle", "react.mjs");
      const code = `import "file://${bundlePath}";\nexport default 1;\n`;

      const firstRun = await import("./redis.ts?dev-disk-first-run");
      assertEquals(await firstRun.initializeSSRDistributedCache(), true);
      assertEquals(firstRun.isSSRDistributedCacheEnabled(), true);
      assertEquals(await firstRun.getFromRedis("dev-disk-key"), null);
      await firstRun.setInRedis("dev-disk-key", code);

      // A fresh module instance holds no memoized backend and no cached entry,
      // so anything it returns came back from disk.
      const afterRestart = await import("./redis.ts?dev-disk-after-restart");
      assertEquals(await afterRestart.initializeSSRDistributedCache(), true);
      assertEquals(await afterRestart.getFromRedis("dev-disk-key"), code);
    });
  });

  it("isolates automatic disk caches by project cache directory", async () => {
    useLocalDevEnvironment();
    const firstCacheDir = await makeTempDir({ prefix: "vf-dev-ssr-cache-first-" });
    const secondCacheDir = await makeTempDir({ prefix: "vf-dev-ssr-cache-second-" });
    const cache = await import("./redis.ts?dev-disk-project-scope");

    try {
      await runWithCacheDir(firstCacheDir, async () => {
        assertEquals(await cache.initializeSSRDistributedCache(), true);
        await cache.setInRedis("shared-key", "export default 'first';");
      });

      await runWithCacheDir(secondCacheDir, async () => {
        assertEquals(await cache.initializeSSRDistributedCache(), true);
        assertEquals(await cache.getFromRedis("shared-key"), null);
        await cache.setInRedis("shared-key", "export default 'second';");
      });

      await runWithCacheDir(firstCacheDir, async () => {
        assertEquals(await cache.getFromRedis("shared-key"), "export default 'first';");
      });
    } finally {
      await remove(firstCacheDir, { recursive: true });
      await remove(secondCacheDir, { recursive: true });
    }
  });

  it("rebuilds a cached parent when an imported file changes while stopped", async () => {
    useLocalDevEnvironment();
    const cacheDir = await makeTempDir({ prefix: "vf-dev-ssr-cache-" });
    const projectDir = await makeTempDir({ prefix: "vf-dev-ssr-project-" });
    const parentPath = join(projectDir, "page.ts");
    const dependencyPath = join(projectDir, "message.ts");
    const parentSource = [
      `import { message } from "./message.ts";`,
      `export default function readMessage() { return message; }`,
    ].join("\n");

    try {
      await mkdir(projectDir, { recursive: true });
      await writeTextFile(parentPath, parentSource);
      await writeTextFile(dependencyPath, `export const message = "before";`);

      await runWithCacheDir(cacheDir, async () => {
        // The loader reads project files through the adapter, so it must be the
        // one for the runtime this test is running on, not always Deno's.
        const { runtime } = await import("#veryfront/platform");
        const adapter = await runtime.get();
        const { SSRModuleLoader } = await import("../loader.ts?dev-disk-parent-restart");
        const memory = await import("./memory.ts");
        const persistent = await import("./redis.ts");
        assertEquals(await persistent.initializeSSRDistributedCache(), true);

        const createLoader = () =>
          new SSRModuleLoader({
            projectDir,
            projectId: "dev-disk-parent-restart",
            contentSourceId: "preview-main",
            adapter,
            dev: true,
          });

        const firstLoader = createLoader();
        const first = await firstLoader.loadRawModule(parentPath, parentSource);
        assertEquals((first.default as () => string)(), "before");

        const parentFileKey = (firstLoader as unknown as {
          cache: { getCacheKey(filePath: string): string };
        }).cache.getCacheKey(parentPath);
        const parentEntry = memory.globalModuleCache.get(parentFileKey);
        const parentContentKey = parentEntry
          ? [...memory.globalModuleCache.entries()].find(([key, entry]) =>
            key !== parentFileKey && entry === parentEntry
          )?.[0]
          : undefined;
        if (!parentEntry || !parentContentKey) {
          throw new Error("Expected the first parent transform in the module cache");
        }
        await persistent.setInRedis(
          parentContentKey,
          await readTextFile(parentEntry.tempPath),
        );

        memory.clearSSRModuleCache();
        await writeTextFile(dependencyPath, `export const message = "after";`);

        const afterRestart = await createLoader().loadRawModule(parentPath, parentSource);
        assertEquals((afterRestart.default as () => string)(), "after");
      });
    } finally {
      await remove(projectDir, { recursive: true });
      await remove(cacheDir, { recursive: true });
    }
  });

  it("falls back to a miss when the cache directory cannot be created", async () => {
    useLocalDevEnvironment();
    const tempDir = await makeTempDir({ prefix: "vf-dev-ssr-cache-" });
    const blockedRoot = join(tempDir, "blocked");
    await writeFile(blockedRoot, new Uint8Array([0]));

    await runWithCacheDir(join(blockedRoot, "cache"), async () => {
      const cache = await import("./redis.ts?dev-disk-unwritable");
      await cache.initializeSSRDistributedCache();

      // A failed write must never surface to the render path.
      await cache.setInRedis("dev-disk-key", "export default 1;");
      assertEquals(await cache.getFromRedis("dev-disk-key"), null);
    });
  });

  it("keeps entries long enough to outlive a restart", async () => {
    useLocalDevEnvironment();
    const writes: Array<number | undefined> = [];
    const original = CacheBackends.ssrModule;
    CacheBackends.ssrModule = () =>
      Promise.resolve({
        type: "disk" as const,
        get: () => Promise.resolve(null),
        set: (_key: string, _value: string, ttlSeconds?: number) => {
          writes.push(ttlSeconds);
          return Promise.resolve();
        },
        del: () => Promise.resolve(),
      });

    try {
      const cache = await import("./redis.ts?dev-disk-ttl");
      await cache.setInRedis("dev-disk-key", "export default 1;");

      assertEquals(writes, [LOCAL_DEV_SSR_MODULE_TTL_SEC]);
      // A dev-server restart must land inside the window, not outside it.
      assertEquals(LOCAL_DEV_SSR_MODULE_TTL_SEC > DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC, true);
    } finally {
      CacheBackends.ssrModule = original;
    }
  });

  it("stays disabled for a production runtime without a distributed cache", async () => {
    useLocalDevEnvironment();
    const { setEnv } = await import("#veryfront/testing/deno-compat.ts");
    setEnv("NODE_ENV", "production");

    const cache = await import("./redis.ts?dev-disk-production");
    assertEquals(await cache.initializeSSRDistributedCache(), false);
    assertEquals(cache.isSSRDistributedCacheEnabled(), false);
  });
});
