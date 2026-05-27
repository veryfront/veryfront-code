import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { transformFrameworkCode } from "./transform.ts";
import { MAX_RELATIVE_IMPORT_DEPTH } from "./constants.ts";

// esbuild starts a child process that lives across tests, so we disable sanitizers
describe("transformFrameworkCode depth-limit fallback", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  it("rewrites relative imports in the fallback to absolute file:// URLs so the cached output is loadable", async () => {
    const tmp = await Deno.makeTempDir({ prefix: "vf-vfmod-fallback-" });
    const srcDir = `${tmp}/src/utils/constants`;
    await Deno.mkdir(srcDir, { recursive: true });
    const buildJs = `${srcDir}/build.js`;
    await Deno.writeTextFile(buildJs, "export const DEFAULT_BUILD_CONCURRENCY = 4;\n");
    const buffersJs = `${srcDir}/buffers.js`;
    await Deno.writeTextFile(buffersJs, "export const BUFFER_SIZE_1_KB = 1024;\n");

    const ownerPath = `${srcDir}/owner.js`;
    const ownerContent = [
      `import { DEFAULT_BUILD_CONCURRENCY } from "./build.js";`,
      `import { BUFFER_SIZE_1_KB } from "./buffers.js";`,
      `export const sum = DEFAULT_BUILD_CONCURRENCY + BUFFER_SIZE_1_KB;`,
    ].join("\n");
    await Deno.writeTextFile(ownerPath, ownerContent);

    try {
      const transformed = await transformFrameworkCode(
        ownerContent,
        ownerPath,
        { reactVersion: "19.1.1", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // The fallback should not leave bare ./foo.js imports in cached output:
      assertEquals(transformed.includes('from "./build.js"'), false);
      assertEquals(transformed.includes('from "./buffers.js"'), false);
      // It should rewrite them to file:// URLs pointing at the resolved sources:
      assertStringIncludes(transformed, `from "file://${buildJs}"`);
      assertStringIncludes(transformed, `from "file://${buffersJs}"`);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("leaves bare-package imports alone in the fallback output", async () => {
    const tmp = await Deno.makeTempDir({ prefix: "vf-vfmod-fallback-" });
    const srcDir = `${tmp}/src`;
    await Deno.mkdir(srcDir, { recursive: true });
    const sourcePath = `${srcDir}/uses-react.js`;
    const sourceContent = [
      `import React from "react";`,
      `export const cls = React;`,
    ].join("\n");
    await Deno.writeTextFile(sourcePath, sourceContent);

    try {
      const transformed = await transformFrameworkCode(
        sourceContent,
        sourcePath,
        { reactVersion: "19.1.1", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // Bare specifier `react` is the runtime's responsibility — fallback
      // must not invent a file:// URL for it.
      assertStringIncludes(transformed, 'from "react"');
      assert(!transformed.includes("file://"));
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
