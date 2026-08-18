import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { getMdxEsmCacheDir, runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { clearMDXRendererCache, mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import {
  clearModulePathCache,
  getModulePathCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { MDX_MODULE_DEV_COMPILE_VARIANT } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";

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

describe("MDXRenderer.loadModuleESM render mode", () => {
  // Transforming a real module starts esbuild's child process; stop it so the
  // handle does not leak into a later suite.
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  /**
   * Load a compiled MDX entry that imports one `/_vf_modules/*` module and
   * report the compile mode the ESM loader used for that import, read back
   * from the module path cache keys the loader wrote.
   */
  async function loadEntryAndCollectModuleCacheKeys(
    mode: "development" | "production" | undefined,
  ): Promise<string[]> {
    const cacheDir = await makeTempDir({ prefix: "veryfront_mdx_mode_cache_" });
    const projectDir = await makeTempDir({ prefix: "veryfront_mdx_mode_project_" });
    const projectId = `mdx-mode-${crypto.randomUUID()}`;
    const contentSourceId = `release-${crypto.randomUUID()}`;

    try {
      await mkdir(join(projectDir, "lib"), { recursive: true });
      await writeTextFile(
        join(projectDir, "lib/label.js"),
        `export const label = "compiled-by-mode";`,
      );

      return await runWithCacheDir(cacheDir, async () => {
        clearMDXRendererCache();
        clearModulePathCache();

        try {
          const mod = await mdxRenderer.loadModuleESM(
            `import { label } from "/_vf_modules/lib/label.js";\nexport default label;`,
            {
              adapter: await getLocalAdapter(),
              projectId,
              projectDir,
              projectSlug: "mdx-mode",
              contentSourceId,
              reactVersion: "19.1.1",
              isLocalProject: true,
              mode,
            },
          );
          assertEquals(mod.default as unknown, "compiled-by-mode");

          const esmCacheDir = join(
            getMdxEsmCacheDir(),
            encodeURIComponent(projectId),
            encodeURIComponent(contentSourceId),
          );
          return [...(await getModulePathCache(esmCacheDir)).keys()];
        } finally {
          clearMDXRendererCache();
          clearModulePathCache();
        }
      });
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => undefined);
      await remove(projectDir, { recursive: true }).catch(() => undefined);
    }
  }

  it("compiles the entry's modules for the requested render mode", async () => {
    const developmentKeys = await loadEntryAndCollectModuleCacheKeys("development");
    const productionKeys = await loadEntryAndCollectModuleCacheKeys("production");

    assertEquals(developmentKeys.length > 0, true);
    assertEquals(productionKeys.length > 0, true);
    // The compile mode decides minification, tree shaking and the inline
    // sourcemap, so a development render and a production render must not
    // meet on one module cache key.
    assertEquals(
      developmentKeys.every((key) => key.includes(MDX_MODULE_DEV_COMPILE_VARIANT)),
      true,
      `expected development keys to carry the compile-mode segment: ${developmentKeys}`,
    );
    assertEquals(
      productionKeys.some((key) => key.includes(MDX_MODULE_DEV_COMPILE_VARIANT)),
      false,
      `expected no development key from a production render: ${productionKeys}`,
    );
  });

  it("compiles for production when no render mode is requested", async () => {
    const keys = await loadEntryAndCollectModuleCacheKeys(undefined);

    assertEquals(keys.length > 0, true);
    assertEquals(keys.some((key) => key.includes(MDX_MODULE_DEV_COMPILE_VARIANT)), false);
  });
});
