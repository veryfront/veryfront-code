import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { validateCachedBundlesByManifestOrCode } from "#veryfront/transforms/esm/cached-bundle-validation.ts";
import {
  createBundleManifest,
  storeBundleManifest,
} from "#veryfront/transforms/esm/bundle-manifest.ts";

// The manifest branch only runs when a distributed cache backend is available,
// and the only way to configure one is the VF_DISK_CACHE_DIR host variable.
// That process effect is why these cases live in the integration suite while the
// hermetic code-fallback cases stay colocated with the source.
describe("validateCachedBundlesByManifestOrCode manifest branch", () => {
  async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await makeTempDir({ prefix: "vf-cached-bundle-validation-" });
    try {
      await fn(dir);
    } finally {
      await remove(dir, { recursive: true });
    }
  }

  // bundle-manifest resolves its distributed cache lazily and memoizes the first
  // backend it sees, so a disk backend has to be configured before the first
  // manifest is stored or loaded anywhere in this file.
  let originalDiskCacheDir: string | undefined;
  let distributedDir = "";

  beforeAll(async () => {
    distributedDir = await makeTempDir({ prefix: "vf-cached-bundle-validation-cache-" });
    originalDiskCacheDir = getHostEnv("VF_DISK_CACHE_DIR");
    setEnv("VF_DISK_CACHE_DIR", distributedDir);
  });

  afterAll(async () => {
    if (originalDiskCacheDir === undefined) deleteEnv("VF_DISK_CACHE_DIR");
    else setEnv("VF_DISK_CACHE_DIR", originalDiskCacheDir);
    await remove(distributedDir, { recursive: true });
  });

  it("validates through the manifest when every manifest bundle is present", async () => {
    await withTempDir(async (cacheDir) => {
      const hash = "aaa111";
      const code = "export const a = 1;";
      await writeTextFile(join(cacheDir, `http-${hash}.mjs`), code);
      const manifest = await createBundleManifest([
        { hash, url: "https://esm.sh/a@1", sizeBytes: code.length },
      ]);
      await storeBundleManifest(manifest);

      const result = await validateCachedBundlesByManifestOrCode(
        code,
        manifest.manifestId,
        cacheDir,
      );

      assertEquals(
        result,
        { valid: true, failedHashes: [], source: "manifest" },
        "a manifest whose bundles exist validates through the manifest path",
      );
    });
  });

  it("reports an unrecoverable manifest instead of masking it with a code scan", async () => {
    await withTempDir(async (cacheDir) => {
      const hash = "bbb222";
      const code = "export const b = 2;";
      const manifest = await createBundleManifest([
        { hash, url: "https://esm.sh/b@2", sizeBytes: code.length },
      ]);
      await storeBundleManifest(manifest);

      const result = await validateCachedBundlesByManifestOrCode(
        code,
        manifest.manifestId,
        cacheDir,
      );

      assertEquals(result.source, "manifest", "an unrecoverable manifest is reported as such");
      assertEquals(result.valid, false, "a manifest with a missing bundle is not valid");
      assertEquals(result.reason, "bundle_missing", "the missing bundle is the stated reason");
      assertEquals(result.failedHashes, [hash], "the missing bundle hash is reported");
    });
  });
});
