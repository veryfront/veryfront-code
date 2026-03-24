import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { validateCachedBundlesByManifestOrCode } from "./cached-bundle-validation.ts";

describe("validateCachedBundlesByManifestOrCode", () => {
  async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await makeTempDir({ prefix: "vf-cached-bundle-validation-" });
    try {
      await fn(dir);
    } finally {
      await remove(dir, { recursive: true });
    }
  }

  it("falls back to code validation when the manifest is missing", async () => {
    await withTempDir(async (cacheDir) => {
      await writeTextFile(join(cacheDir, "http-111111.mjs"), "export const a = 1;");

      const result = await validateCachedBundlesByManifestOrCode(
        'import "./http-111111.mjs";',
        "missing-manifest-id",
        cacheDir,
      );

      assertEquals(result.valid, true);
      assertEquals(result.source, "code");
      assertEquals(result.failedHashes, []);
    });
  });

  it("returns bundle_missing when code fallback cannot recover bundles", async () => {
    await withTempDir(async (cacheDir) => {
      const result = await validateCachedBundlesByManifestOrCode(
        'import "./http-222222.mjs";',
        "missing-manifest-id",
        cacheDir,
      );

      assertEquals(result.valid, false);
      assertEquals(result.source, "code");
      assertEquals(result.reason, "bundle_missing");
      assertEquals(result.failedHashes, ["222222"]);
    });
  });
});
