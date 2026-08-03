import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { clearMDXRendererCache, mdxRenderer } from "#veryfront/transforms/mdx/index.ts";

async function withIsolatedCache<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const cacheDir = await makeTempDir({ prefix: "veryfront_mdx_index_test_" });
  const projectDir = await makeTempDir({ prefix: "veryfront_mdx_index_project_" });

  try {
    return await runWithCacheDir(cacheDir, async () => {
      clearMDXRendererCache();

      try {
        return await fn(projectDir);
      } finally {
        clearMDXRendererCache();
      }
    });
  } finally {
    try {
      await remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup errors.
    }

    try {
      await remove(projectDir, { recursive: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}

describe("MDXRenderer.loadModuleESM", () => {
  it("preserves the positional loadModuleESM signature", async () => {
    await withIsolatedCache(async (projectDir) => {
      const compiled = `
        export const marker = "legacy-signature";
        export default marker;
      `;

      const mod = await mdxRenderer.loadModuleESM(
        compiled,
        undefined,
        "test-mdx",
        projectDir,
        "test-mdx",
        "test",
      );

      assertEquals(mod.default as unknown, "legacy-signature");
    });
  });

  it("treats an explicit undefined options argument as empty options", async () => {
    const compiled = `
      export const marker = "undefined-options";
      export default marker;
    `;

    await assertRejects(
      () => mdxRenderer.loadModuleESM(compiled, undefined),
      Error,
      "Missing projectId for MDX ESM cache directory",
    );
  });
});
