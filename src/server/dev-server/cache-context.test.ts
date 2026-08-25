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
      "the dev server cache defaults to the project cache dir",
    );
    await runWithDevServerCacheDir(projectDir, async () => {
      assertEquals(
        getCacheBaseDir(),
        join(projectDir, ".cache"),
        "runWithDevServerCacheDir must scope the cache base dir to the project",
      );
    }, () => undefined);
  });

  it("preserves an explicitly configured framework cache root", () => {
    assertEquals(
      resolveDevServerCacheDir(
        "/projects/selected",
        (key) => key === "VERYFRONT_CACHE_DIR" ? "/configured/cache" : undefined,
      ),
      "/configured/cache",
      "VERYFRONT_CACHE_DIR is honoured",
    );
    assertEquals(
      resolveDevServerCacheDir(
        "/projects/selected",
        (key) => key === "VF_CACHE_DIR" ? "/alias/cache" : undefined,
      ),
      "/alias/cache",
      "the VF_CACHE_DIR alias is honoured",
    );
    assertEquals(
      resolveDevServerCacheDir(
        "/projects/selected",
        (key) => key === "VERYFRONT_CACHE_DIR" ? "/configured/cache" : "/alias/cache",
      ),
      "/configured/cache",
      "VERYFRONT_CACHE_DIR wins over the alias",
    );
  });
});
