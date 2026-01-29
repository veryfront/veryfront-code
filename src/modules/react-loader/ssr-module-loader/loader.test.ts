import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { clearSSRModuleCache, SSRModuleLoader } from "./index.ts";
import { globalModuleCache } from "./cache/memory.ts";
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
    const filePath = join(projectDir, "components", "CacheInvalTest.tsx");
    const projectId = "project-p1-test";
    const contentSourceId = "local-main";

    try {
      await mkdir(join(projectDir, "components"), { recursive: true });

      const source = "export default function CacheInvalTest() { return null; }";
      const contentHash = hashCodeHex(source);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      // Build the cache keys the loader would use
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

      // Create a temp .mjs file that imports a non-existent module.
      // Use a unique filename so Deno's module cache won't have it.
      const uniqueId = crypto.randomUUID().slice(0, 8);
      const brokenTempPath = join(projectDir, `broken-${uniqueId}.mjs`);
      await writeTextFile(
        brokenTempPath,
        `import { missing } from "./this-file-does-not-exist-${uniqueId}.mjs";\nexport default function CacheInvalTest() { return null; }`,
      );

      // Pre-populate globalModuleCache as if the transform had already succeeded
      const fakeEntry = { tempPath: brokenTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, fakeEntry);
      globalModuleCache.set(filePathCacheKey, fakeEntry);

      // Mark HTTP bundle verification as done so transform doesn't re-verify
      const verifyKey = `${brokenTempPath}:${contentHash}`;
      verifiedHttpBundlePaths.set(verifyKey, true);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      // loadModule should fail at import() with "Cannot find module",
      // and P1 logic should delete the cache entry
      let threw = false;
      try {
        await loader.loadModule(filePath, source);
      } catch (err) {
        threw = true;
        const msg = err instanceof Error ? err.message : String(err);
        assert(
          msg.includes("Cannot find module") || msg.includes("Module not found"),
          `Expected module-not-found error, got: ${msg}`,
        );
      }
      assert(threw, "Expected loadModule to throw");

      // P1: the filePathCacheKey should have been deleted from globalModuleCache
      assertEquals(
        globalModuleCache.has(filePathCacheKey),
        false,
        "Cache entry should be invalidated after 'Cannot find module' error",
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

      // Cache should be retained for successful loads
      const cacheKeys = [...globalModuleCache.keys()];
      const matchingKeys = cacheKeys.filter((k) => k.includes("project-retain-test"));
      assert(
        matchingKeys.length > 0,
        "Expected cache entries to be retained after successful import",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });
});
