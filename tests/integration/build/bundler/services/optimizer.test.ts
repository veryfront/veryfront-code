/**
 * Bundle Optimizer Tests
 *
 * Comprehensive tests for bundle optimization service covering:
 * - Production optimization
 * - Minification
 * - Target transformation
 * - Error handling
 * - Development mode skip
 */

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import * as esbuild from "esbuild";
import { optimizeBundle } from "../../../../../src/build/renderer/services/optimizer.ts";
import type {
  BundleResult,
  BundlerOptions,
} from "../../../../../src/build/renderer/types/bundler-types.ts";
import { withTestContext } from "../../../../_helpers/context.ts";

function createResult(
  outputs: Array<[string, BundleResult["outputs"] extends Map<string, infer V> ? V : never]>,
): BundleResult {
  return {
    outputs: new Map(outputs),
    errors: [],
    warnings: [],
    dependencies: new Map(),
  };
}

describe(
  "Bundle Optimizer",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      // Only stop esbuild if a test explicitly opted to keep it alive
      if (!(globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) {
        await esbuild.stop();
      }
    });

    it("optimizes bundle in production mode", async () => {
      await withTestContext("optimizer-production", async (context) => {
        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const originalContent = `
          // This is a comment that should be removed
          function helloWorld() {
            const message = "Hello, World!";
            console.log(message);
            return message;
          }

          export default helloWorld;
        `;

        const result = createResult([
          [
            "/test/app.js",
            {
              path: "/test/app.js",
              content: originalContent,
              type: "js",
            },
          ],
        ]);

        await optimizeBundle(result, options);

        const output = result.outputs.get("/test/app.js")!;
        const optimized = output.content;

        assertEquals(optimized.length < originalContent.length, true);
        assertEquals(optimized.includes("// This is a comment"), false);
        assertEquals(optimized.includes("Hello, World!"), true);
      });
    });

    it("skips optimization in development mode", async () => {
      await withTestContext("optimizer-development", async (context) => {
        const originalCode = `
          // Development comment
          function test() {
            const value = 42;
            return value;
          }
        `;

        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "development",
        };

        const result = createResult([
          [
            "/test/app.js",
            {
              path: "/test/app.js",
              content: originalCode,
              type: "js",
            },
          ],
        ]);

        await optimizeBundle(result, options);

        const output = result.outputs.get("/test/app.js")!;
        assertEquals(output.content, originalCode);
      });
    });

    it("only optimizes JS files", async () => {
      await withTestContext("optimizer-file-types", async (context) => {
        const jsCode = "function test() { return 42; }";
        const cssCode = ".button { padding: 20px; }";

        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult([
          [
            "/test/app.js",
            {
              path: "/test/app.js",
              content: jsCode,
              type: "js",
            },
          ],
          [
            "/test/styles.css",
            {
              path: "/test/styles.css",
              content: cssCode,
              type: "css",
            },
          ],
        ]);

        await optimizeBundle(result, options);

        const jsOutput = result.outputs.get("/test/app.js")!;
        const cssOutput = result.outputs.get("/test/styles.css")!;

        assertEquals(jsOutput.content !== jsCode, true);
        assertEquals(cssOutput.content, cssCode);
      });
    });

    it("handles multiple JS files", async () => {
      await withTestContext("optimizer-multiple", async (context) => {
        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult([
          [
            "/test/app.js",
            {
              path: "/test/app.js",
              content: 'function app() { return "app"; }',
              type: "js",
            },
          ],
          [
            "/test/utils.js",
            {
              path: "/test/utils.js",
              content: 'function utils() { return "utils"; }',
              type: "js",
            },
          ],
          [
            "/test/lib.js",
            {
              path: "/test/lib.js",
              content: 'function lib() { return "lib"; }',
              type: "js",
            },
          ],
        ]);

        const originalSizes = {
          app: result.outputs.get("/test/app.js")!.content.length,
          utils: result.outputs.get("/test/utils.js")!.content.length,
          lib: result.outputs.get("/test/lib.js")!.content.length,
        };

        await optimizeBundle(result, options);

        assertEquals(
          result.outputs.get("/test/app.js")!.content.length <= originalSizes.app,
          true,
        );
        assertEquals(
          result.outputs.get("/test/utils.js")!.content.length <= originalSizes.utils,
          true,
        );
        assertEquals(
          result.outputs.get("/test/lib.js")!.content.length <= originalSizes.lib,
          true,
        );
      });
    });

    it("handles modern JavaScript features", async () => {
      await withTestContext("optimizer-modern-js", async (context) => {
        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult([
          [
            "/test/modern.js",
            {
              path: "/test/modern.js",
              content: `
                  // ES2020+ features
                  const data = { a: 1, b: 2 };
                  const merged = { ...data, c: 3 };
                  const optional = data?.nested?.value;
                  const nullish = data.value ?? "default";

                  async function fetchData() {
                    const response = await fetch("/api");
                    return response.json();
                  }

                  export { merged, optional, nullish, fetchData };
                `,
              type: "js",
            },
          ],
        ]);

        await optimizeBundle(result, options);

        const output = result.outputs.get("/test/modern.js")!;

        assertExists(output.content);
        assertEquals(output.content.length > 0, true);
        assertEquals(output.content.includes("fetch") || output.content.includes("async"), true);
      });
    });

    it("handles syntax errors gracefully", async () => {
      await withTestContext("optimizer-syntax-error", async (context) => {
        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const invalidCode = `
          function broken() {
            const x = ;  // Syntax error
          }
        `;

        const result = createResult([
          [
            "/test/broken.js",
            {
              path: "/test/broken.js",
              content: invalidCode,
              type: "js",
            },
          ],
        ]);

        await optimizeBundle(result, options);

        assertExists(result.outputs.get("/test/broken.js"));
      });
    });

    it("transforms arrow functions", async () => {
      await withTestContext("optimizer-arrows", async (context) => {
        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult([
          [
            "/test/arrows.js",
            {
              path: "/test/arrows.js",
              content: `
                  const add = (a, b) => a + b;
                  const greet = name => \`Hello, \${name}!\`;
                  const numbers = [1, 2, 3].map(n => n * 2);
                  export { add, greet, numbers };
                `,
              type: "js",
            },
          ],
        ]);

        await optimizeBundle(result, options);

        const output = result.outputs.get("/test/arrows.js")!;

        assertEquals(output.content.length < 150, true);
        assertExists(output.content);
      });
    });

    it("handles empty output set", async () => {
      await withTestContext("optimizer-empty", async (context) => {
        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult([]);

        await optimizeBundle(result, options);

        assertEquals(result.outputs.size, 0);
      });
    });

    it("preserves output metadata", async () => {
      await withTestContext("optimizer-metadata", async (context) => {
        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult([
          [
            "/test/page.js",
            {
              path: "/test/page.js",
              content: 'function page() { return "page"; }',
              type: "js",
              meta: {
                title: "Test Page",
                description: "A test page",
              },
            },
          ],
        ]);

        await optimizeBundle(result, options);

        const output = result.outputs.get("/test/page.js")!;

        assertExists(output.meta);
        assertEquals(output.meta.title, "Test Page");
        assertEquals(output.meta.description, "A test page");
        assertEquals(output.path, "/test/page.js");
        assertEquals(output.type, "js");
      });
    });

    it("handles large files efficiently", async () => {
      await withTestContext("optimizer-large", async (context) => {
        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const largeCode = Array.from(
          { length: 100 },
          (_, i) => `
          function func${i}() {
            const value = ${i};
            const doubled = value * 2;
            return doubled;
          }
        `,
        ).join("\n");

        const result = createResult([
          [
            "/test/large.js",
            {
              path: "/test/large.js",
              content: largeCode,
              type: "js",
            },
          ],
        ]);

        await optimizeBundle(result, options);

        const output = result.outputs.get("/test/large.js")!;
        assertEquals(output.content.length < largeCode.length * 0.7, true);
      });
    });
  },
);
