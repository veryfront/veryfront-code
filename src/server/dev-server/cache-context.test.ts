import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { resolveDevServerCacheDir, runWithDevServerCacheDir } from "./cache-context.ts";

describe("dev server cache context", () => {
  it("anchors every dev-server entry point to the selected project", async () => {
    const projectDir = "/projects/selected";

    assertEquals(
      resolveDevServerCacheDir(projectDir, () => undefined),
      join(projectDir, ".cache"),
    );
    await runWithDevServerCacheDir(projectDir, async () => {
      assertEquals(getCacheBaseDir(), join(projectDir, ".cache"));
    }, () => undefined);
  });

  it("preserves an explicitly configured framework cache root", () => {
    assertEquals(
      resolveDevServerCacheDir(
        "/projects/selected",
        (key) => key === "VERYFRONT_CACHE_DIR" ? "/configured/cache" : undefined,
      ),
      "/configured/cache",
    );
  });
});
