import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { basename, join } from "#veryfront/compat/path/index.ts";
import {
  getHttpBundleCacheDir,
  getMdxEsmCacheDir,
  runWithCacheDir,
} from "#veryfront/utils/cache-dir.ts";
import { FRAMEWORK_ROOT } from "../constants.ts";
import { buildMdxEsmModuleRecoveryCacheKey } from "../cache-format.ts";
import { cacheModule } from "./module-cache.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { __injectCachesForTests } from "#veryfront/transforms/esm/transform-cache.ts";
import {
  readDistributedCache,
  resolveMdxDistributedTransformCacheKey,
  writeDistributedCache,
} from "./distributed-cache.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

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
  readonly getCalls: string[] = [];
  readonly setCalls: SetCall[] = [];
  readonly failingGetKeys = new Set<string>();

  get(key: string): Promise<string | null> {
    this.getCalls.push(key);
    if (this.failingGetKeys.has(key)) {
      return Promise.reject(new Error(`get failed for ${key}`));
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

async function waitForSetKeys(cache: FakeDistributedCache, keys: string[]): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (keys.every((key) => cache.setCalls.some((call) => call.key === key))) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
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

  it("invalidates cached code whose HTTP bundles are gone", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log, entries } = createCapturingLogger();
      const bundlePath = join(getHttpBundleCacheDir(), "http-deadbeefdeadbeef.mjs");
      cache.values.set(
        "transform:stale-bundle",
        `import bundle from "file://${bundlePath}"; export default bundle;`,
      );

      const result = await readCache(cache, "transform:stale-bundle", projectDir, log);

      assertEquals(
        result?.code,
        null,
        "cached code whose HTTP bundles are missing must not be reused",
      );
      assertEquals(
        entries.some((entry) =>
          entry.level === "warn" && entry.message.includes("Cached HTTP bundle validation failed")
        ),
        true,
        "the failed bundle validation must be reported",
      );
    });
  });

  it("invalidates cached code with incompatible framework paths", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log, entries } = createCapturingLogger();
      cache.values.set(
        "transform:foreign",
        'import foo from "https://esm.sh/_vf_modules/lib.js"; export default foo;',
      );

      const result = await readCache(cache, "transform:foreign", projectDir, log);

      assertEquals(
        result?.code,
        null,
        "cached code from a foreign framework root must not be reused",
      );
      const warning = entries.find((entry) =>
        entry.level === "warn" && entry.message.includes("incompatible framework paths")
      );
      assertEquals(
        warning !== undefined,
        true,
        "an incompatible framework path must be reported as a warning",
      );
      assertEquals(
        (warning?.metadata as { frameworkRoot?: string } | undefined)?.frameworkRoot,
        FRAMEWORK_ROOT,
        "the warning must name the framework root this pod expects",
      );
    });
  });

  it("invalidates cached code whose vfmod dependency is absent on this pod", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log, entries } = createCapturingLogger();
      const missingDependency = join(
        getMdxEsmCacheDir(),
        "project-a",
        "preview-main",
        `vfmod-absent-${crypto.randomUUID()}.mjs`,
      );
      cache.values.set(
        "transform:missing-dep",
        `import dep from "file://${missingDependency}"; export default dep;`,
      );

      const result = await readCache(cache, "transform:missing-dep", projectDir, log);

      assertEquals(
        result?.code,
        null,
        "cached code referencing a vfmod file absent on this pod is invalidated",
      );
      assertEquals(
        entries.some((entry) => entry.message.includes("missing file dependencies, invalidating")),
        true,
        "the invalidation must be reported",
      );
    });
  });

  it("recovers a missing vfmod dependency from the distributed cache", async () => {
    await withTempDir(async (projectDir) => {
      await withTempDir((cacheDir) =>
        runWithCacheDir(cacheDir, async () => {
          const cache = new FakeDistributedCache();
          const { log } = createCapturingLogger();
          const dependencyPath = join(
            getMdxEsmCacheDir(),
            "project-a",
            "preview-main",
            `vfmod-recovered-${crypto.randomUUID()}.mjs`,
          );
          const cachedCode = `import dep from "file://${dependencyPath}"; export default dep;`;
          cache.values.set("transform:recoverable", cachedCode);
          cache.values.set(
            buildMdxEsmModuleRecoveryCacheKey(
              "project-a",
              "preview-main",
              basename(dependencyPath),
            ),
            "export default 1;",
          );

          const result = await readCache(cache, "transform:recoverable", projectDir, log);

          // Surviving the missing-dependency check is only possible once the
          // recovery entry has restored the vfmod file this code imports.
          assertEquals(
            result?.code,
            cachedCode,
            "recovered cached code must survive the missing-dependency check",
          );
        })
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

    // dependency-recovery.ts looks the entry up by the file name cacheModule
    // writes locally, so the two producers must agree on that name.
    const localPath = await withTempDir((esmCacheDir) =>
      cacheModule("app/page.mdx", moduleCode, esmCacheDir, new Map<string, string>(), log)
    );
    assertEquals(typeof localPath, "string", "cacheModule must write the module locally");
    const expectedRecoveryKey = buildMdxEsmModuleRecoveryCacheKey(
      "project-a",
      "preview-main",
      basename(localPath!),
    );
    await waitForSetKeys(cache, ["transform:write", expectedRecoveryKey]);
    const primary = cache.values.get("transform:write");
    const recovery = cache.setCalls.find((call) => call.key === expectedRecoveryKey);
    assertEquals(
      recovery?.key,
      expectedRecoveryKey,
      "recovery key must carry the same file name cacheModule writes locally",
    );

    assertEquals(
      primary?.includes("file://__VF_CACHE_DIR__/veryfront-mdx-esm/project-a/child.mjs"),
      true,
    );
    assertEquals(primary?.includes("/tmp/build/.cache"), false);
    assertEquals(cache.setCalls[0]?.ttlSeconds, TRANSFORM_DISTRIBUTED_TTL_SEC);
    assertEquals(recovery?.ttlSeconds, TRANSFORM_DISTRIBUTED_TTL_SEC);
    assertEquals(recovery?.value, primary);
  });

  it("publishes recursive framework vfmods for fresh-worker recovery", async () => {
    await withTempDir(async (tempDir) => {
      const cacheDir = join(tempDir, ".cache", "veryfront-mdx-esm", "framework");
      const tenantCacheDir = join(tempDir, ".cache", "veryfront-mdx-esm", "project-a");
      const childPath = join(cacheDir, "vfmod-child.mjs");
      const grandchildPath = join(cacheDir, "vfmod-grandchild.mjs");
      const tenantPath = join(tenantCacheDir, "vfmod-tenant.mjs");
      await Deno.mkdir(cacheDir, { recursive: true });
      await Deno.mkdir(tenantCacheDir, { recursive: true });
      await Deno.writeTextFile(grandchildPath, `export const value = 1;`);
      await Deno.writeTextFile(tenantPath, `export const tenant = true;`);
      await Deno.writeTextFile(
        childPath,
        `import { value } from "file://${grandchildPath}"; export default value;`,
      );

      const cache = new FakeDistributedCache();
      const { log } = createCapturingLogger();
      const parentCode = [
        `import child from "file://${childPath}";`,
        `import { tenant } from "file://${tenantPath}";`,
        `export default tenant ? child : null;`,
      ].join("\n");
      writeDistributedCache(
        cache,
        "transform:framework-entry",
        "project-a",
        "preview-main",
        parentCode,
        "_vf_modules/_veryfront/react/runtime/core.js",
        log,
      );

      const childKey = buildMdxEsmModuleRecoveryCacheKey(
        "project-a",
        "preview-main",
        basename(childPath),
      );
      const grandchildKey = buildMdxEsmModuleRecoveryCacheKey(
        "project-a",
        "preview-main",
        basename(grandchildPath),
      );
      await waitForSetKeys(cache, [
        grandchildKey,
        childKey,
        "transform:framework-entry",
      ]);
      assertEquals(cache.values.has(childKey), true);
      assertEquals(cache.values.has(grandchildKey), true);
      assertEquals(
        cache.values.has(
          buildMdxEsmModuleRecoveryCacheKey(
            "project-a",
            "preview-main",
            basename(tenantPath),
          ),
        ),
        false,
      );
      assertEquals(cache.values.get(childKey)?.includes(tempDir), false);
      assertEquals(
        cache.values.get(childKey)?.includes(
          "file://__VF_CACHE_DIR__/veryfront-mdx-esm/framework/vfmod-grandchild.mjs",
        ),
        true,
      );
      assertEquals(
        cache.setCalls.every((call) => call.ttlSeconds === TRANSFORM_DISTRIBUTED_TTL_SEC),
        true,
      );
      const publishedKeys = cache.setCalls.map((call) => call.key);
      assertEquals(publishedKeys.indexOf(grandchildKey) < publishedKeys.indexOf(childKey), true);
      assertEquals(
        publishedKeys.indexOf(childKey) < publishedKeys.indexOf("transform:framework-entry"),
        true,
      );
    });
  });

  it("hashes keys whose fully prefixed identity exceeds API constraints", async () => {
    const prefix = "transform:";
    const boundaryKey = "k".repeat(512 - prefix.length);
    const oversizedKey = `${boundaryKey}k`;
    const unsafeKey = "_vf_modules/app/(marketing)/[slug].tsx";

    assertEquals(
      await resolveMdxDistributedTransformCacheKey(boundaryKey),
      boundaryKey,
    );
    assertEquals(
      await resolveMdxDistributedTransformCacheKey(oversizedKey),
      `sha256:${await computeHash(`${prefix}${oversizedKey}`)}`,
    );
    assertEquals(
      await resolveMdxDistributedTransformCacheKey(unsafeKey),
      `sha256:${await computeHash(`${prefix}${unsafeKey}`)}`,
    );
  });

  it("uses the same bounded identity for long transform and manifest reads and writes", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log } = createCapturingLogger();
      const longKey = `mdx:${"nested/".repeat(90)}module:content`;
      const primaryKey = await resolveMdxDistributedTransformCacheKey(longKey);
      const manifestKey = await resolveMdxDistributedTransformCacheKey(`${longKey}:bm`);

      cache.values.set(primaryKey, "export const cached = true;");
      const result = await readCache(cache, longKey, projectDir, log);

      assertEquals(result?.code, "export const cached = true;");
      assertEquals(cache.getCalls.includes(primaryKey), true);
      assertEquals(cache.getCalls.includes(manifestKey), true);

      writeDistributedCache(
        cache,
        longKey,
        "project-a",
        "preview-main",
        `import "./http-deadbeef.mjs"; export const written = true;`,
        "app/page.mdx",
        log,
      );
      await waitForSetKeys(cache, [primaryKey, manifestKey]);

      assertEquals(cache.setCalls.some((call) => call.key === primaryKey), true);
      assertEquals(cache.setCalls.some((call) => call.key === manifestKey), true);
      assertEquals(cache.setCalls.some((call) => call.key === longKey), false);
      assertEquals(cache.setCalls.some((call) => call.key === `${longKey}:bm`), false);
    });
  });

  it("uses the same safe identity for short unsafe transform and manifest reads and writes", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeDistributedCache();
      const { log } = createCapturingLogger();
      const unsafeKey = "_vf_modules/app/(marketing)/[slug].tsx";
      const primaryKey = await resolveMdxDistributedTransformCacheKey(unsafeKey);
      const manifestKey = await resolveMdxDistributedTransformCacheKey(`${unsafeKey}:bm`);

      cache.values.set(primaryKey, "export const cached = true;");
      const result = await readCache(cache, unsafeKey, projectDir, log);

      assertEquals(result?.code, "export const cached = true;");
      assertEquals(cache.getCalls.includes(primaryKey), true);
      assertEquals(cache.getCalls.includes(manifestKey), true);

      writeDistributedCache(
        cache,
        unsafeKey,
        "project-a",
        "preview-main",
        `import "./http-deadbeef.mjs"; export const written = true;`,
        "app/(marketing)/[slug].mdx",
        log,
      );
      await waitForSetKeys(cache, [primaryKey, manifestKey]);

      assertEquals(cache.setCalls.some((call) => call.key === primaryKey), true);
      assertEquals(cache.setCalls.some((call) => call.key === manifestKey), true);
      assertEquals(cache.setCalls.some((call) => call.key === unsafeKey), false);
      assertEquals(cache.setCalls.some((call) => call.key === `${unsafeKey}:bm`), false);
    });
  });
});
