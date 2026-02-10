import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { clearSSRModuleCache, SSRModuleLoader } from "./index.ts";
import { globalInProgress, globalModuleCache } from "./cache/memory.ts";
import { verifiedHttpBundlePaths } from "./http-bundle-helpers.ts";
import { buildSSRModuleCacheKey } from "../../../cache/keys.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { computeConfigHashSync } from "../../../cache/config-hash.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";

describe("SSRModuleLoader", { sanitizeResources: false, sanitizeOps: false }, () => {
  it("isolates cache by projectId", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "Widget.tsx");

    try {
      await mkdir(componentsDir, { recursive: true });

      const sourceA = "export default function WidgetA() { return null; }";
      const sourceB = "export default function WidgetB() { return null; }";

      await writeTextFile(filePath, sourceA);

      const loaderA = new SSRModuleLoader({
        projectDir,
        projectId: "project-a",
        contentSourceId: "local-main",
        adapter: denoAdapter,
        dev: true,
      });

      const loaderB = new SSRModuleLoader({
        projectDir,
        projectId: "project-b",
        contentSourceId: "local-main",
        adapter: denoAdapter,
        dev: true,
      });

      const componentA = await loaderA.loadModule(filePath, sourceA);
      const componentB = await loaderB.loadModule(filePath, sourceB);

      assertEquals(componentA.name, "WidgetA");
      assertEquals(componentB.name, "WidgetB");
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("invalidates cache when import fails with 'Cannot find module' (P1)", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-p1-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "CacheInvalTest.tsx");
    const projectId = "project-p1-test";
    const contentSourceId = "local-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function CacheInvalTest() { return null; }";
      const contentHash = hashCodeHex(source);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const uniqueId = crypto.randomUUID().slice(0, 8);
      const brokenTempPath = join(projectDir, `broken-${uniqueId}.mjs`);
      await writeTextFile(
        brokenTempPath,
        `import { missing } from "./this-file-does-not-exist-${uniqueId}.mjs";\nexport default function CacheInvalTest() { return null; }`,
      );

      const fakeEntry = { tempPath: brokenTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, fakeEntry);
      globalModuleCache.set(filePathCacheKey, fakeEntry);

      verifiedHttpBundlePaths.set(`${brokenTempPath}:${contentHash}`, true);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      try {
        await loader.loadModule(filePath, source);
        assert(false, "Expected loadModule to throw");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert(
          msg.includes("Cannot find module") || msg.includes("Module not found"),
          `Expected module-not-found error, got: ${msg}`,
        );
      }

      assertEquals(
        globalModuleCache.has(filePathCacheKey),
        false,
        "Cache entry should be invalidated after 'Cannot find module' error",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("keeps cache when import fails with a non-module-resolution error", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-non-resolution-error-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "CacheRetainOnRuntimeError.tsx");
    const projectId = "project-runtime-error-test";
    const contentSourceId = "local-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function CacheRetainOnRuntimeError() { return null; }";
      const contentHash = hashCodeHex(source);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const runtimeErrorTempPath = join(projectDir, `runtime-error-${crypto.randomUUID()}.mjs`);
      await writeTextFile(
        runtimeErrorTempPath,
        `throw new Error("intentional-runtime-error");\nexport default function CacheRetainOnRuntimeError() { return null; }`,
      );

      const fakeEntry = { tempPath: runtimeErrorTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, fakeEntry);
      globalModuleCache.set(filePathCacheKey, fakeEntry);
      verifiedHttpBundlePaths.set(`${runtimeErrorTempPath}:${contentHash}`, true);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      try {
        await loader.loadModule(filePath, source);
        assert(false, "Expected loadModule to throw runtime error");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert(msg.includes("intentional-runtime-error"), `Unexpected error message: ${msg}`);
      }

      assertEquals(
        globalModuleCache.has(filePathCacheKey),
        true,
        "Cache entry should remain for non-module-resolution import failures",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("retains cache when import succeeds", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-retain-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "Good.tsx");

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function Good() { return null; }";
      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId: "project-retain-test",
        contentSourceId: "local-main",
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "Good");

      const matchingKeys = [...globalModuleCache.keys()].filter((k) =>
        k.includes("project-retain-test")
      );
      assert(
        matchingKeys.length > 0,
        "Expected cache entries to be retained after successful import",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("throws missing dependency error before dynamic import when local import is unavailable", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-missing-dep-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "NeedsMissingDependency.tsx");

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = [
        `import Missing from "./does-not-exist.js";`,
        `export default function NeedsMissingDependency() {`,
        `  return Missing;`,
        `}`,
      ].join("\n");

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId: "project-missing-dep-test",
        contentSourceId: "local-main",
        adapter: denoAdapter,
        dev: true,
      });

      try {
        await loader.loadModule(filePath, source);
        assert(false, "Expected loadModule to throw for missing dependency");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert(
          msg.includes("missing dependencies") &&
            msg.includes("./does-not-exist.js"),
          `Expected missing dependency details in error, got: ${msg}`,
        );
      }
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("invalidates stale cache entries with unresolved _vf_modules imports and retransforms", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-unresolved-vf-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "RebuildAfterStaleCache.tsx");
    const projectId = "project-unresolved-vf-test";
    const contentSourceId = "local-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function RebuildAfterStaleCache() { return null; }";
      const contentHash = hashCodeHex(source);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const staleTempPath = join(projectDir, `stale-unresolved-${crypto.randomUUID()}.mjs`);
      await writeTextFile(
        staleTempPath,
        [
          `import x from "/_vf_modules/react@18.3.1/some-module.js";`,
          `export default function Stale() { return x; }`,
        ].join("\n"),
      );

      const staleEntry = { tempPath: staleTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, staleEntry);
      globalModuleCache.set(filePathCacheKey, staleEntry);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "RebuildAfterStaleCache");

      const rebuiltEntry = globalModuleCache.get(contentCacheKey);
      assert(
        !!rebuiltEntry && rebuiltEntry.tempPath !== staleTempPath,
        "Expected stale cache entry to be replaced with retransformed output",
      );
      assertEquals(
        verifiedHttpBundlePaths.get(`${staleTempPath}:${contentHash}`),
        undefined,
        "Expected stale verification marker to be cleared",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("retries transform when stale in-progress promise rejects", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-stale-in-progress-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "RetryAfterInProgressError.tsx");
    const projectId = "project-stale-in-progress";
    const contentSourceId = "local-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function RetryAfterInProgressError() { return null; }";
      await writeTextFile(filePath, source);

      const contentHash = hashCodeHex(source);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const staleInProgress = Promise.reject(new Error("stale in-progress transform failed"));
      staleInProgress.catch(() => {});
      globalInProgress.set(contentCacheKey, staleInProgress);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "RetryAfterInProgressError");
      assertEquals(globalInProgress.has(contentCacheKey), false);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });
});
