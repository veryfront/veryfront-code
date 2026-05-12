import "#veryfront/schemas/_test-setup.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { optimizeBundle } from "./optimizer.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

function createBundleResult(
  outputs?: Array<{ path: string; content: string; type: string }>,
): BundleResult {
  const result: BundleResult = {
    outputs: new Map(),
    errors: [],
    warnings: [],
    dependencies: new Map(),
  };
  for (const o of outputs ?? []) {
    result.outputs.set(o.path, o);
  }
  return result;
}

function createOptions(mode: "development" | "production"): BundlerOptions {
  return {
    sources: [],
    projectDir: "/tmp/test",
    mode,
  };
}

describe(
  "build/renderer/services/optimizer",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      if ((globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) return;
      await esbuild.stop();
    });

    describe("optimizeBundle", () => {
      it("should return undefined in development mode", () => {
        const result = createBundleResult();
        const options = createOptions("development");
        const returnValue = optimizeBundle(result, options);
        assertEquals(returnValue, undefined, "should skip optimization in development mode");
      });

      it("should return a promise in production mode", () => {
        const result = createBundleResult([
          { path: "app.js", content: "const x = 1;", type: "js" },
        ]);
        const options = createOptions("production");
        const returnValue = optimizeBundle(result, options);
        assertEquals(
          returnValue instanceof Promise,
          true,
          "should return a promise in production mode",
        );
      });

      it("should minify JS outputs in production mode", async () => {
        const result = createBundleResult([
          {
            path: "app.js",
            content: "const   greeting   =   'hello world';  console.log(  greeting  );",
            type: "js",
          },
        ]);
        const options = createOptions("production");
        await optimizeBundle(result, options);

        const output = result.outputs.get("app.js");
        assertEquals(
          output!.content.length <
            "const   greeting   =   'hello world';  console.log(  greeting  );"
              .length,
          true,
          "minified content should be shorter than original",
        );
      });

      it("should not modify non-JS outputs", async () => {
        const cssContent = ".container { display: flex; padding: 1rem; }";
        const result = createBundleResult([
          { path: "style.css", content: cssContent, type: "css" },
        ]);
        const options = createOptions("production");
        await optimizeBundle(result, options);

        const output = result.outputs.get("style.css");
        assertEquals(output!.content, cssContent, "CSS content should remain unchanged");
      });

      it("should handle empty outputs map in production", async () => {
        const result = createBundleResult();
        const options = createOptions("production");
        await optimizeBundle(result, options);
        assertEquals(result.outputs.size, 0, "empty outputs should remain empty");
      });

      it("should handle mixed JS and non-JS outputs", async () => {
        const cssContent = ".btn { color: red; }";
        const result = createBundleResult([
          { path: "app.js", content: "const x = 1;", type: "js" },
          { path: "style.css", content: cssContent, type: "css" },
          { path: "data.json", content: '{"key": "value"}', type: "json" },
        ]);
        const options = createOptions("production");
        await optimizeBundle(result, options);

        assertEquals(
          result.outputs.get("style.css")!.content,
          cssContent,
          "CSS should be untouched",
        );
        assertEquals(
          result.outputs.get("data.json")!.content,
          '{"key": "value"}',
          "JSON should be untouched",
        );
      });

      it("should handle multiple JS outputs", async () => {
        const result = createBundleResult([
          { path: "a.js", content: "const a  =  1;", type: "js" },
          { path: "b.js", content: "const b  =  2;", type: "js" },
        ]);
        const options = createOptions("production");
        await optimizeBundle(result, options);

        assertEquals(typeof result.outputs.get("a.js")!.content, "string", "a.js should be string");
        assertEquals(typeof result.outputs.get("b.js")!.content, "string", "b.js should be string");
      });
    });
  },
);
