/**
 * Integration coverage for the SSR VF Modules package-root skip guard.
 *
 * `transformFrameworkCode` must link files that sit outside the framework
 * source directories (published dnt runtime helpers such as `_dnt.shims.js`)
 * as-is instead of recompiling them into the transform cache. Driving that
 * guard for real needs an on-disk package layout, so the case lives here
 * rather than in the colocated unit suite.
 *
 * @see src/transforms/pipeline/stages/ssr-vf-modules/transform.ts
 */

import { assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  createFileSystem,
  mkdir,
  withTempDir,
  writeTextFile,
} from "#veryfront/testing/deno-compat";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  frameworkFileCache,
  transformFrameworkCode,
} from "#veryfront/transforms/pipeline/stages/ssr-vf-modules/index.ts";

describe("ssr-vf-modules package-root linking", () => {
  it("links a package-root helper as-is instead of recursively transforming it", async () => {
    await withTempDir(async (tmp) => {
      const srcDir = `${tmp}/src`;
      await mkdir(srcDir, { recursive: true });
      const helperPath = `${tmp}/_dnt.shims.js`;
      await writeTextFile(helperPath, "export const shim = 1;\n");
      const ownerPath = `${srcDir}/owner.ts`;
      const ownerContent = [
        `import { shim } from "../_dnt.shims.js";`,
        `export const y = shim;`,
      ].join("\n");

      try {
        const transformed = await transformFrameworkCode(
          ownerContent,
          ownerPath,
          { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() },
        );

        assertStringIncludes(
          transformed,
          `from "file://${helperPath}"`,
          "a file outside FRAMEWORK_ROOT/src is linked as-is, not recursively transformed",
        );
      } finally {
        for (const key of frameworkFileCache.keys()) {
          if (key.includes(tmp)) frameworkFileCache.delete(key);
        }
        // The bundler keeps its esbuild service child alive between calls, so
        // shut it down inside the case to keep the resource sanitizers on.
        await stopEsbuild();
      }
    }, { prefix: "vf-vfmod-pkgroot-" });
  });
});
