/**
 * EsbuildBundler smoke tests — verifies the adapter correctly invokes
 * esbuild and maps its results into the Bundler contract shape.
 *
 * @module extensions/ext-bundler-esbuild/esbuild-bundler.test
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { EsbuildBundler } from "./esbuild-bundler.ts";

describe({
  name: "EsbuildBundler.transform",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("compiles TS to JS", async () => {
    const bundler = new EsbuildBundler();
    const result = await bundler.transform({
      code: "const x: number = 1; export default x;",
      loader: "ts",
      format: "esm",
    });
    assertExists(result.code);
    assertEquals(result.code.includes("const x"), true);
    assertEquals(Array.isArray(result.warnings), true);
    await bundler.stop();
  });

  it("strips types in tsx", async () => {
    const bundler = new EsbuildBundler();
    const result = await bundler.transform({
      code: "const x: number = 1;",
      loader: "ts",
    });
    // Type annotation should be gone
    assertEquals(result.code.includes(": number"), false);
    await bundler.stop();
  });
});

describe({
  name: "EsbuildBundler.bundle",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("bundles a stdin entry into an in-memory output", async () => {
    const bundler = new EsbuildBundler();
    try {
      const result = await bundler.bundle({
        stdin: {
          contents: "export const hello = 'world';",
          resolveDir: ".",
          sourcefile: "entry.ts",
          loader: "ts",
        },
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
      });

      assertEquals(result.errors.length, 0);
      assertEquals(result.outputFiles.length, 1);
      const out = result.outputFiles[0]!;
      assertExists(out.text);
      assertEquals(out.text.includes("hello"), true);
    } finally {
      await bundler.stop();
    }
  });
});
