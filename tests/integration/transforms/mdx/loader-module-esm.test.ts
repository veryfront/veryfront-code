import "#veryfront/schemas/_test-setup.ts";

// Relocated from the colocated unit test: driving loadModuleESM end to end
// needs a real cache directory, a real project directory and the esbuild
// child process, none of which belong at the unit boundary.

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import type { MDXModule } from "#veryfront/transforms/mdx/types.ts";
import { loadModuleESM } from "#veryfront/transforms/mdx/esm-module-loader/loader.ts";
import type { ESMLoaderContext } from "#veryfront/transforms/mdx/esm-module-loader/types.ts";

/** Load a compiled program through the real loader entry point. */
async function loadCompiledModule(code: string): Promise<MDXModule> {
  const cacheDir = await makeTempDir({ prefix: "vf-mdx-loader-cache-" });
  const projectDir = await makeTempDir({ prefix: "vf-mdx-loader-project-" });
  const adapter = await getLocalAdapter();

  try {
    return await runWithCacheDir(cacheDir, () =>
      loadModuleESM(code, {
        moduleCache: new LRUCache({ maxEntries: 10 }),
        adapter,
        projectId: `mdx-loader-${crypto.randomUUID()}`,
        projectDir,
        projectSlug: "mdx-loader",
        contentSourceId: "release-1",
        reactVersion: "19.1.1",
        isLocalProject: true,
      } as ESMLoaderContext));
  } finally {
    await remove(cacheDir, { recursive: true }).catch(() => undefined);
    await remove(projectDir, { recursive: true }).catch(() => undefined);
  }
}

describe("esm-module-loader/loader loadModuleESM", () => {
  // Transforming a real module starts esbuild's child process; stop it so the
  // handle does not leak into a later suite.
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("loads a compiled program and exposes its exports", async () => {
    const mod = await loadCompiledModule(
      `export const marker = "loaded-through-loader";\nexport default marker;`,
    );

    assertEquals(
      mod.default as unknown,
      "loaded-through-loader",
      "the loader must evaluate the compiled program and return its module namespace",
    );
  });

  describe("MDXLayout auto-export", () => {
    it("auto-exports a declared but unexported MDXLayout", async () => {
      const mod = await loadCompiledModule(
        `const MDXLayout = () => "layout";\nexport default "page";\n`,
      );

      assertExists(
        (mod as Record<string, unknown>).__vfLayout,
        "a declared MDXLayout must be re-exported as __vfLayout",
      );
    });

    it("does not auto-export a let-bound MDXLayout", async () => {
      const mod = await loadCompiledModule(
        `let MDXLayout = () => "layout";\nMDXLayout = MDXLayout;\nexport default "page";\n`,
      );

      assertEquals(
        (mod as Record<string, unknown>).__vfLayout,
        undefined,
        "only a const MDXLayout declaration triggers the auto-export",
      );
    });

    it("does not duplicate an existing MDXLayout export", async () => {
      const mod = await loadCompiledModule(
        `const MDXLayout = () => "layout";\nexport { MDXLayout as __vfLayout };\nexport default "page";\n`,
      );

      assertExists(
        (mod as Record<string, unknown>).__vfLayout,
        "an already-exported MDXLayout loads without a duplicate export",
      );
    });

    it("exports no layout when the module declares none", async () => {
      const mod = await loadCompiledModule(`export const foo = 1;\nexport default "page";\n`);

      assertEquals(
        (mod as Record<string, unknown>).__vfLayout,
        undefined,
        "a module without MDXLayout gets no __vfLayout export",
      );
    });
  });
});
