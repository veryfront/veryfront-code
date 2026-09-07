import "#veryfront/schemas/_test-setup.ts";

// Relocated from the colocated unit test: driving loadModuleESM end to end
// needs a real cache directory, a real project directory and the esbuild
// child process, none of which belong at the unit boundary.

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  makeTempDir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import type { MDXModule } from "#veryfront/transforms/mdx/types.ts";
import { loadModuleESM } from "#veryfront/transforms/mdx/esm-module-loader/loader.ts";
import type { ESMLoaderContext } from "#veryfront/transforms/mdx/esm-module-loader/types.ts";
import { buildMdxJsxCacheFileName } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import {
  __jsxCacheInternals,
  JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS,
} from "#veryfront/transforms/mdx/esm-module-loader/jsx-cache.ts";
import { getLocalFs } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { transformJsxImports } from "#veryfront/transforms/mdx/esm-module-loader/import-transformer.ts";

it("rearms idle cleanup when the initial sweep finishes before a transform writes", async () => {
  const cacheDir = await makeTempDir({ prefix: "vf-mdx-idle-sweep-" });
  const adapter = await getLocalAdapter();
  const read = adapter.fs.readFileBytesWithinLimit;
  try {
    adapter.fs.readFileBytesWithinLimit = async () => {
      __jsxCacheInternals.scheduleJsxCachePruneRetry(cacheDir, 0);
      for (
        let attempt = 0;
        attempt < 100 && __jsxCacheInternals.hasScheduledJsxCachePrune(cacheDir);
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assertEquals(__jsxCacheInternals.hasScheduledJsxCachePrune(cacheDir), false);
      return new TextEncoder().encode("export const value = 1;");
    };
    const result = await transformJsxImports(
      'import { value } from "file:///project/Value.ts";',
      adapter,
      cacheDir,
      "/project",
    );
    assertEquals(result.includes("jsx-"), true);
    assertEquals(__jsxCacheInternals.hasScheduledJsxCachePrune(cacheDir), true);
  } finally {
    adapter.fs.readFileBytesWithinLimit = read;
    __jsxCacheInternals.cancelScheduledJsxCachePrunes();
    await __jsxCacheInternals.waitForJsxCacheMaintenanceForTests();
    await remove(cacheDir, { recursive: true });
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  }
});

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

  it("recovers a lazy JSX artifact after the real parent loader releases its scope", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-mdx-lazy-loader-" });
    const source = "export const value = 17;";
    const artifact = join(cacheDir, buildMdxJsxCacheFileName("/project/Lazy.tsx", source));
    try {
      await writeTextFile(artifact, source);
      const context = {
        moduleCache: new LRUCache({ maxEntries: 10 }),
        adapter: await getLocalAdapter(),
        projectId: "lazy-loader",
        projectDir: cacheDir,
        projectSlug: "lazy-loader",
        contentSourceId: "release-1",
        reactVersion: "19.1.1",
        esmCacheDir: cacheDir,
        isLocalProject: true,
      } as ESMLoaderContext;
      const code = `export const Symbol = "authored";
export const load = () => import(${JSON.stringify(`file://${artifact}`)});`;
      const module = await runWithCacheDir(cacheDir, () => loadModuleESM(code, context));
      context.moduleCache.clear();
      const reloaded = await runWithCacheDir(cacheDir, () => loadModuleESM(code, context));
      assertEquals(
        (reloaded as { load: unknown }).load === (module as { load: unknown }).load,
        true,
        "unchanged parents must reuse their native module after an application cache eviction",
      );
      for await (const entry of readDir(cacheDir)) {
        if (!entry.isDirectory) continue;
        for await (const child of readDir(join(cacheDir, entry.name))) {
          assertEquals(
            child.name.endsWith(".mjs"),
            false,
            "process-specific lazy parent modules must be retired after evaluation",
          );
        }
      }
      assertEquals(__jsxCacheInternals.isLazyArtifactRetained(artifact), false);
      await remove(artifact);
      const load = (module as { load: () => Promise<{ value: number }> }).load;
      assertEquals((await load()).value, 17);
      assertEquals(await readTextFile(artifact), source);
    } finally {
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(cacheDir, { recursive: true });
    }
  });

  it("rediscovers temporary parents after failed cleanup without an in-memory retry", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-mdx-parent-cleanup-" });
    const source = "export const value = 23;";
    const artifact = join(cacheDir, buildMdxJsxCacheFileName("/project/Lazy.tsx", source));
    const fs = getLocalFs();
    const removeFile = fs.remove;
    let orphan: string | undefined;
    try {
      await writeTextFile(artifact, source);
      fs.remove = (path, options) => {
        if (path.endsWith(".mjs") && path !== artifact) {
          orphan = path;
          return Promise.reject(new Error("EBUSY"));
        }
        return removeFile.call(fs, path, options);
      };
      await runWithCacheDir(cacheDir, () =>
        loadModuleESM(
          `export const load = () => import(${JSON.stringify(`file://${artifact}`)});`,
          {
            moduleCache: new LRUCache({ maxEntries: 10 }),
            adapter: undefined,
            projectId: "parent-cleanup",
            projectDir: cacheDir,
            projectSlug: "parent-cleanup",
            contentSourceId: "release-1",
            reactVersion: "19.1.1",
            esmCacheDir: cacheDir,
            isLocalProject: true,
          } as ESMLoaderContext,
        ));
      assertExists(orphan);
      assertEquals(await fs.exists(orphan), true);
      fs.remove = removeFile;
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await __jsxCacheInternals.collectExcessJsxArtifacts(
        cacheDir,
        new Map(),
        Date.now() + JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS + 60_000,
      );
      assertEquals(await fs.exists(orphan), false);
    } finally {
      fs.remove = removeFile;
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(cacheDir, { recursive: true });
    }
  });

  it("cleans temporary parents after the evaluated project replaces array intrinsics", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-mdx-parent-array-" });
    const source = "export const value = 37;";
    const artifact = join(cacheDir, buildMdxJsxCacheFileName("/project/Arrays.tsx", source));
    const push = Array.prototype.push;
    const sort = Array.prototype.sort;
    const iterator = Array.prototype[Symbol.iterator];
    let evaluated = false;
    try {
      await writeTextFile(artifact, source);
      try {
        await runWithCacheDir(cacheDir, () =>
          loadModuleESM(
            `export const load = () => import(${JSON.stringify(`file://${artifact}`)});
const poison = () => { throw new Error("tenant replaced an array intrinsic"); };
Array.prototype.push = poison;
Array.prototype.sort = poison;
Array.prototype[Symbol.iterator] = poison;`,
            {
              moduleCache: new LRUCache({ maxEntries: 10 }),
              adapter: undefined,
              projectId: "parent-array",
              projectDir: cacheDir,
              projectSlug: "parent-array",
              contentSourceId: "release-1",
              reactVersion: "19.1.1",
              esmCacheDir: cacheDir,
              isLocalProject: true,
            } as ESMLoaderContext,
          )).catch(() => undefined);
      } finally {
        evaluated = Array.prototype.push !== push;
        Array.prototype.push = push;
        Array.prototype.sort = sort;
        Array.prototype[Symbol.iterator] = iterator;
      }
      assertEquals(evaluated, true, "the project must reach evaluation before cleanup is checked");
      for await (const entry of readDir(cacheDir)) {
        if (entry.isFile && entry.name.endsWith(".mjs")) {
          assertEquals(join(cacheDir, entry.name), artifact);
        }
      }
    } finally {
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(cacheDir, { recursive: true });
    }
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
