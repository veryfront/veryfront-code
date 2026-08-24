/**
 * Integration coverage for `bundleMdx`'s sibling `.mdx` import path.
 *
 * This case cannot live in the colocated unit test
 * (`src/build/renderer/services/mdx-bundler.test.ts`): the sibling source is
 * read through a module-level `const fs = createFileSystem()` in
 * `src/build/renderer/services/mdx-bundler.ts`, and neither `BundlerOptions`
 * nor `createFileSystem()` exposes an injection point for that read. Proving
 * the import is resolved, compiled and registered as a `.js` output therefore
 * requires a real on-disk sibling file, which is a host filesystem effect and
 * only permitted in integration tests.
 */

import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { withTempDir } from "#veryfront/testing/index.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { bundleMdx } from "#veryfront/build/renderer/services/mdx-bundler.ts";
import type {
  BundleResult,
  BundlerOptions,
} from "#veryfront/build/renderer/types/bundler-types.ts";

function createBundleResult(): BundleResult {
  return {
    outputs: new Map(),
    errors: [],
    warnings: [],
    dependencies: new Map(),
  };
}

describe("build/renderer/services/mdx-bundler sibling imports", () => {
  it("should compile sibling .mdx imports into .js outputs", async () => {
    await withTempDir(async (directory) => {
      await Deno.writeTextFile(join(directory, "sibling.mdx"), "# Sibling\n");
      const source = {
        path: join(directory, "page.mdx"),
        content: 'import Sibling from "./sibling.mdx";\n\n# Page\n',
      };
      const result = createBundleResult();
      const options: BundlerOptions = {
        sources: [],
        projectDir: directory,
        mode: "production",
      };
      let compileCalls = 0;
      const compileFn = async (src: string, _opts: BundlerOptions) => {
        compileCalls++;
        return `compiled: ${src}`;
      };

      await bundleMdx(source, options, result, compileFn);

      assertEquals(compileCalls, 1, "sibling .mdx imports are compiled");
      assertEquals(result.errors, [], "a resolvable .mdx import produces no errors");
      const sibling = result.outputs.get(join(directory, "sibling.js"));
      assertExists(sibling, "compiled .mdx import is registered as a .js output");
      assertEquals(
        sibling.content,
        "compiled: # Sibling\n",
        "the .js output carries the compiled sibling source",
      );
    });
  });
});
