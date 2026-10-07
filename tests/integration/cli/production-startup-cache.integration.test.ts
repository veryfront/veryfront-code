import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { clearProductionStartupCaches } from "../../../cli/commands/serve/command.ts";

describe("production startup dependency seed", () => {
  it("retains a declared seed and clears it when the seed declaration is absent", async () => {
    const { makeTempDir, readTextFile, writeTextFile, exists, remove } = await import(
      "#veryfront/compat/fs.ts"
    );
    const { join } = await import("#veryfront/compat/path");
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const { getLocalFs, getMdxEsmSsrCacheDir } = await import("veryfront/transforms/mdx-cache");
    const root = await makeTempDir({ prefix: "production-seed-" });
    try {
      await runWithCacheDir(root, async () => {
        const dependency = join(root, "veryfront-http-bundle", "http-seeded.mjs");
        await getLocalFs().mkdir(join(dependency, ".."), { recursive: true });
        await writeTextFile(dependency, "export const seeded = true;");
        const derived = join(await getMdxEsmSsrCacheDir("19.2.4", "source"), "stale.mjs");
        await getLocalFs().mkdir(join(derived, ".."), { recursive: true });
        await writeTextFile(derived, "export const stale = true;");
        await withEnv(
          { VERYFRONT_RUNTIME_CACHE_SEED: "materialized-dependencies" },
          () => clearProductionStartupCaches(),
        );
        assertEquals(await exists(derived), false);
        assertEquals(await readTextFile(dependency), "export const seeded = true;");
        await withEnv({ VERYFRONT_RUNTIME_CACHE_SEED: "" }, () => clearProductionStartupCaches());
        assertEquals(await exists(dependency), false);
      });
    } finally {
      await remove(root, { recursive: true });
    }
  });
});
