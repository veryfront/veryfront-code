
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { optimizeBundle } from "../../../../../src/build/renderer/services/optimizer.ts";
import type {
  BundleResult,
  BundlerOptions,
} from "../../../../../src/build/renderer/types/bundler-types.ts";
import { withTestContext } from "../../../../_helpers/context.ts";

describe(
  "Bundle Optimizer",
  
  () => {
    describe("optimizeBundle", () => {
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

          const result: BundleResult = {
            outputs: new Map([
              [
                "/test/app.js",
                {
                  path: "/test/app.js",
                  content: originalContent,
                  type: "js",
                },
              ],
            ]),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

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

          const result: BundleResult = {
            outputs: new Map([
              [
                "/test/app.js",
                {
                  path: "/test/app.js",
                  content: originalCode,
                  type: "js",
                },
              ],
            ]),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

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

          const result: BundleResult = {
            outputs: new Map([
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
            ]),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

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

          const result: BundleResult = {
            outputs: new Map([
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
            ]),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const originalSizes = {
            app: result.outputs.get("/test/app.js")!.content.length,
            utils: result.outputs.get("/test/utils.js")!.content.length,
            lib: result.outputs.get("/test/lib.js")!.content.length,
          };

          await optimizeBundle(result, options);

          const appSize = result.outputs.get("/test/app.js")!.content.length;
          const utilsSize = result.outputs.get("/test/utils.js")!.content.length;
          const libSize = result.outputs.get("/test/lib.js")!.content.length;

          assertEquals(appSize <= originalSizes.app, true);
          assertEquals(utilsSize <= originalSizes.utils, true);
          assertEquals(libSize <= originalSizes.lib, true);
        });
      });

      it("handles modern JavaScript features", async () => {
        await withTestContext("optimizer-modern-js", async (context) => {
          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "production",
          };

          const result: BundleResult = {
            outputs: new Map([
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
            ]),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

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

          const result: BundleResult = {
            outputs: new Map([
              [
                "/test/broken.js",
                {
                  path: "/test/broken.js",
                  content: invalidCode,
                  type: "js",
                },
              ],
            ]),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

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

          const result: BundleResult = {
            outputs: new Map([
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
            ]),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

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

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

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

          const result: BundleResult = {
            outputs: new Map([
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
            ]),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

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

          const largeCode = Array.from({ length: 100 }, (_, i) => `
            function func${i}() {
              const value = ${i};
              const doubled = value * 2;
              return doubled;
            }
          `).join("\n");

          const result: BundleResult = {
            outputs: new Map([
              [
                "/test/large.js",
                {
                  path: "/test/large.js",
                  content: largeCode,
                  type: "js",
                },
              ],
            ]),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const originalSize = largeCode.length;

          await optimizeBundle(result, options);

          const output = result.outputs.get("/test/large.js")!;
          const optimizedSize = output.content.length;

          assertEquals(optimizedSize < originalSize * 0.7, true);
        });
      });
    });
  },
);
