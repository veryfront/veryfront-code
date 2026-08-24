import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { exists, makeTempDir, readTextFile, remove } from "#veryfront/testing/deno-compat.ts";
import { MockCacheBackend } from "#veryfront/cache/testing/index.ts";
import { tokenizeAllVeryFrontPaths } from "#veryfront/cache";
import { buildMdxEsmModuleRecoveryCacheKey } from "../cache-format.ts";
import { ensureMdxModuleDependencies } from "./dependency-recovery.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { __setDistributedCacheAccessorForTests } from "#veryfront/transforms/esm/http-cache-wrapper.ts";

const noopLog = {
  debug: () => {},
  warn: () => {},
  info: () => {},
  error: () => {},
  child: () => noopLog,
} as never;

describe("module-fetcher/dependency-recovery", () => {
  it("recovers nested vfmod dependencies for the current content source", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-vfmod-recovery-" });
    const distributedCache = new MockCacheBackend({ type: "redis", ignoreTtl: true });
    const sourceDir = join(getMdxEsmCacheDir(), "project-a", "preview-main");
    const childPath = join(sourceDir, "vfmod-child.mjs");
    const grandChildPath = join(sourceDir, "vfmod-grandchild.mjs");

    try {
      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "preview-main", "vfmod-child.mjs"),
        tokenizeAllVeryFrontPaths(
          [
            `import grandChild from "file://${grandChildPath}";`,
            `export default grandChild;`,
          ].join("\n"),
        ),
      );

      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "preview-main", "vfmod-grandchild.mjs"),
        tokenizeAllVeryFrontPaths(`export default "ok";`),
      );

      const result = await ensureMdxModuleDependencies(
        `import child from "file://${childPath}"; export default child;`,
        {
          projectId: "project-a",
          contentSourceId: "preview-main",
          distributedCache,
          log: noopLog,
        },
      );

      assertEquals(result.missing.length, 0);
      assertEquals(result.recovered.length, 2);
      assertEquals(
        await readTextFile(childPath),
        [
          `import grandChild from "file://${grandChildPath}";`,
          `export default grandChild;`,
        ].join("\n"),
      );
      assertEquals(await readTextFile(grandChildPath), `export default "ok";`);
    } finally {
      await remove(sourceDir, { recursive: true }).catch(() => {});
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not recover vfmods from another content source", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-vfmod-recovery-scope-" });
    const distributedCache = new MockCacheBackend({ type: "redis", ignoreTtl: true });
    const sourceDir = join(getMdxEsmCacheDir(), "project-a", "preview-main");
    const childPath = join(sourceDir, "vfmod-child.mjs");

    try {
      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "release-42", "vfmod-child.mjs"),
        tokenizeAllVeryFrontPaths(`export default "wrong-source";`),
      );

      const result = await ensureMdxModuleDependencies(
        `import child from "file://${childPath}"; export default child;`,
        {
          projectId: "project-a",
          contentSourceId: "preview-main",
          distributedCache,
          log: noopLog,
        },
      );

      assertEquals(result.recovered.length, 0);
      assertEquals(result.missing, [childPath]);
    } finally {
      await remove(sourceDir, { recursive: true }).catch(() => {});
      await remove(tempDir, { recursive: true });
    }
  });

  it("reports a vfmod as missing when its HTTP bundles cannot be restored", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-vfmod-recovery-bundles-" });
    const distributedCache = new MockCacheBackend({ type: "redis", ignoreTtl: true });
    const sourceDir = join(getMdxEsmCacheDir(), "project-a", "preview-main");
    const childPath = join(sourceDir, "vfmod-child.mjs");
    // A bundle hash that is not present locally and cannot be restored: the
    // HTTP bundle cache backend is forced to null, so recovery fails without
    // touching the network.
    const bundlePath = join(getHttpBundleCacheDir(), "http-deadbeefdeadbeef.mjs");

    __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
    try {
      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "preview-main", "vfmod-child.mjs"),
        tokenizeAllVeryFrontPaths(
          [
            `import bundle from "file://${bundlePath}";`,
            `export default bundle;`,
          ].join("\n"),
        ),
      );

      const result = await ensureMdxModuleDependencies(
        `import child from "file://${childPath}"; export default child;`,
        {
          projectId: "project-a",
          contentSourceId: "preview-main",
          distributedCache,
          log: noopLog,
        },
      );

      assertEquals(
        result.recovered,
        [],
        "a vfmod with unrestorable HTTP bundles must not count as recovered",
      );
      assertEquals(
        result.missing,
        [childPath],
        "it must be reported missing so the caller rebuilds",
      );
      assertEquals(
        await exists(childPath),
        false,
        "the unusable vfmod must not be written to disk",
      );
    } finally {
      __setDistributedCacheAccessorForTests(null);
      await remove(sourceDir, { recursive: true }).catch(() => {});
      await remove(tempDir, { recursive: true });
    }
  });
});
