import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { __injectCachesForTests } from "#veryfront/transforms/esm/transform-cache.ts";
import { readDistributedCache, writeDistributedCache } from "./distributed-cache.ts";

interface LogEntry {
  level: "debug" | "warn" | "info" | "error";
  message: string;
  metadata?: unknown;
}

interface SetCall {
  key: string;
  value: string;
  ttlSeconds?: number;
}

class FakeDistributedCache implements CacheBackend {
  readonly type = "redis" as const;
  readonly values = new Map<string, string>();
  readonly setCalls: SetCall[] = [];
  readonly failingGetKeys = new Set<string>();
  readonly failingGetMessages = new Map<string, string>();

  get(key: string): Promise<string | null> {
    if (this.failingGetKeys.has(key)) {
      return Promise.reject(new Error(this.failingGetMessages.get(key) ?? `get failed for ${key}`));
    }
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.setCalls.push({ key, value, ttlSeconds });
    this.values.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

function createCapturingLogger(): { log: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const log = {
    debug(message: string, metadata?: unknown) {
      entries.push({ level: "debug", message, metadata });
    },
    warn(message: string, metadata?: unknown) {
      entries.push({ level: "warn", message, metadata });
    },
    info(message: string, metadata?: unknown) {
      entries.push({ level: "info", message, metadata });
    },
    error(message: string, metadata?: unknown) {
      entries.push({ level: "error", message, metadata });
    },
    child: () => log,
  } as unknown as Logger;
  return { log, entries };
}

function installDistributedCache(cache: FakeDistributedCache): void {
  __injectCachesForTests({ cacheBackend: cache });
}

async function readCache(
  cache: FakeDistributedCache,
  transformCacheKey: string,
  projectDir: string,
  log: Logger,
) {
  installDistributedCache(cache);
  return await readDistributedCache(
    transformCacheKey,
    "project-a",
    "preview-main",
    "app/page.mdx",
    "project-a",
    projectDir,
    undefined,
    log,
  );
}

describe("module-fetcher/distributed-cache", () => {
  afterEach(() => {
    __injectCachesForTests(null);
  });

  it("returns a reusable distributed cache handle on cache miss", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log } = createCapturingLogger();

      const result = await readCache(cache, "transform:missing", projectDir, log);

      assertEquals(result?.code, null);
      assertStrictEquals(result?.distributedCache, cache);
    });
  });

  it("returns validated cached module code on cache hit", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log, entries } = createCapturingLogger();
      cache.values.set("transform:hit", "export const value = 1;");

      const result = await readCache(cache, "transform:hit", projectDir, log);

      assertEquals(result?.code, "export const value = 1;");
      assertEquals(
        entries.some((entry) => entry.message.includes("Distributed transform cache HIT")),
        true,
      );
    });
  });

  it("invalidates cached code with unresolved vf module imports", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log, entries } = createCapturingLogger();
      cache.values.set(
        "transform:stale",
        'import stale from "/_vf_modules/_veryfront/stale.mjs"; export default stale;',
      );

      const result = await readCache(cache, "transform:stale", projectDir, log);

      assertEquals(result?.code, null);
      assertEquals(
        entries.some((entry) =>
          entry.level === "warn" && entry.message.includes("unresolved imports")
        ),
        true,
      );
    });
  });

  it("keeps the distributed cache handle when backend get fails", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log, entries } = createCapturingLogger();
      cache.failingGetKeys.add("transform:fails");

      const result = await readCache(cache, "transform:fails", projectDir, log);

      assertEquals(result?.code, null);
      assertStrictEquals(result?.distributedCache, cache);
      assertEquals(
        entries.some((entry) => entry.message.includes("Distributed cache get failed")),
        true,
      );
    });
  });

  it("does not log project identity, cache keys, local paths, or raw errors", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log, entries } = createCapturingLogger();
      const transformCacheKey = "transform:private-project-id:secret-cache-key";
      cache.values.set(transformCacheKey, "export const value = 1;");
      cache.failingGetKeys.add(`${transformCacheKey}:bm`);
      cache.failingGetMessages.set(`${transformCacheKey}:bm`, "raw-backend-message-with-secret");
      installDistributedCache(cache);

      await readDistributedCache(
        transformCacheKey,
        "private-project-id",
        "private-content-source",
        "/private/project/pages/private-module.ts?token=secret-value",
        "private-project-slug",
        projectDir,
        undefined,
        log,
      );

      const output = JSON.stringify(entries);
      for (
        const sensitive of [
          "private-project-id",
          "private-content-source",
          "secret-cache-key",
          "/private/project",
          "secret-value",
          "private-project-slug",
          "raw-backend-message-with-secret",
        ]
      ) {
        assertEquals(output.includes(sensitive), false, sensitive);
      }
    });
  });

  it("writes portable transform and recovery entries with the distributed TTL", async () => {
    const cache = new FakeDistributedCache();
    const { log } = createCapturingLogger();
    const moduleCode = [
      'import child from "file:///tmp/build/.cache/veryfront-mdx-esm/project-a/child.mjs";',
      "export default child;",
    ].join("\n");

    writeDistributedCache(
      cache,
      "transform:write",
      "project-a",
      "preview-main",
      moduleCode,
      "app/page.mdx",
      log,
    );

    const primary = cache.values.get("transform:write");
    const recovery = cache.setCalls.find((call) => call.key.endsWith(":vfmod"));

    assertEquals(
      primary?.includes("file://__VF_CACHE_DIR__/veryfront-mdx-esm/project-a/child.mjs"),
      true,
    );
    assertEquals(primary?.includes("/tmp/build/.cache"), false);
    assertEquals(cache.setCalls[0]?.ttlSeconds, TRANSFORM_DISTRIBUTED_TTL_SEC);
    assertEquals(recovery?.ttlSeconds, TRANSFORM_DISTRIBUTED_TTL_SEC);
    assertEquals(recovery?.value, primary);
  });
});
