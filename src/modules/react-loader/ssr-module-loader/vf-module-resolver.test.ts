import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { clearModulePathCache } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { findVfModuleImports, resolveVfModuleImports } from "./vf-module-resolver.ts";

describe("modules/react-loader/ssr-module-loader/vf-module-resolver", () => {
  describe("findVfModuleImports", () => {
    it("finds /_vf_modules imports and normalizes paths", async () => {
      const code = [
        `import a from "/_vf_modules/react@18/index.js";`,
        `import b from "file:///_vf_modules/lodash@4/chunk.js";`,
      ].join("\n");

      assertEquals(await findVfModuleImports(code), [
        {
          specifier: "/_vf_modules/react@18/index.js",
          path: "_vf_modules/react@18/index.js",
        },
        {
          specifier: "file:///_vf_modules/lodash@4/chunk.js",
          path: "_vf_modules/lodash@4/chunk.js",
        },
      ]);
    });

    it("strips query params from normalized paths", async () => {
      const code = `import a from "/_vf_modules/react@18/index.js?ssr=true";`;
      assertEquals(await findVfModuleImports(code), [
        {
          specifier: "/_vf_modules/react@18/index.js?ssr=true",
          path: "_vf_modules/react@18/index.js",
        },
      ]);
    });

    it("does not match import-looking text in strings or comments", async () => {
      const code = `
        const text = 'from "/_vf_modules/react@18/index.js"';
        // import a from "/_vf_modules/commented.js";
      `;
      assertEquals(await findVfModuleImports(code), []);
    });

    it("returns empty array when code has no /_vf_modules imports", async () => {
      const code = `import x from "./local.js";`;
      assertEquals(await findVfModuleImports(code), []);
    });
  });
});

/**
 * `/_vf_modules/*` imports are fetched and compiled for every SSR module, so
 * the render mode has to reach the module fetcher. A production render that
 * compiled these modules in development mode shipped unminified, un-tree-shaken
 * code with an inline sourcemap of the project source, and because the compile
 * mode was absent from the module cache identity the two modes could also be
 * served each other's artifacts.
 */
describe("modules/react-loader/ssr-module-loader/vf-module-resolver compile mode", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  const MODULE_SOURCE = [
    "function unusedHelper() { return 2; }",
    "export const used = () => 1;",
  ].join("\n");

  async function resolveModuleArtifact(dev: boolean, projectDir: string): Promise<string> {
    const code = [
      `import { used } from "/_vf_modules/util.js";`,
      `export default used;`,
    ].join("\n");

    const resolved = await resolveVfModuleImports(code, {
      filePath: join(projectDir, "page.tsx"),
      projectId: "compile-mode-project",
      contentSourceId: "release-compile-mode",
      adapter: { fs: {} } as unknown as RuntimeAdapter,
      projectDir,
      dev,
    });

    const cachedPath = /file:\/\/([^"']+)/.exec(resolved)?.[1];
    assert(cachedPath !== undefined, "Expected the _vf_modules import to resolve to a cache file");
    return cachedPath;
  }

  it("compiles _vf_modules imports for production without an inline sourcemap", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-compile-mode-cache-" });
    const projectDir = await makeTempDir({ prefix: "vf-compile-mode-project-" });
    await writeTextFile(join(projectDir, "util.ts"), MODULE_SOURCE);

    try {
      await runWithCacheDir(cacheDir, async () => {
        // The development render runs first so a production render that ignored
        // the compile mode would be served this artifact from the module caches.
        const devPath = await resolveModuleArtifact(true, projectDir);
        const devCode = await readTextFile(devPath);
        assertEquals(devCode.includes("sourceMappingURL=data:"), true);
        assertEquals(devCode.includes("unusedHelper"), true);

        const productionPath = await resolveModuleArtifact(false, projectDir);
        assertNotEquals(productionPath, devPath);

        const productionCode = await readTextFile(productionPath);
        assertEquals(productionCode.includes("sourceMappingURL=data:"), false);
        assertEquals(productionCode.includes("unusedHelper"), false);
        assertEquals(productionCode.includes("__name"), false);
      });
    } finally {
      clearModulePathCache();
      await remove(cacheDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true }).catch(() => {});
    }
  });
});
