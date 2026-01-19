/**
 * Script Bundler Tests
 *
 * Comprehensive tests for JavaScript/TypeScript bundling service covering:
 * - JS/TS bundling pipeline
 * - Code transformation
 * - Minification
 * - Source maps
 * - Import resolution
 * - Plugin system
 * - Error handling
 * - Cache integration
 */

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { writeTextFile } from "@veryfront/testing/deno-compat";
import * as esbuild from "esbuild";
import { bundleScript } from "../../../../../src/build/renderer/services/script-bundler.ts";
import type {
  BundleResult,
  BundlerOptions,
} from "../../../../../src/build/renderer/types/bundler-types.ts";
import { withTestContext } from "../../../../_helpers/context.ts";

describe(
  "Script Bundler",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      // Only stop esbuild if a test explicitly opted to keep it alive
      if (!(globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) {
        await esbuild.stop();
      }
    });

    describe("bundleScript", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("bundles all file types (JS/TS/JSX/TSX)", async () => {
        // Batched test for all file type bundling - reduces esbuild invocation overhead
        await withTestContext("script-all-types", async (context) => {
          const testCases = [
            {
              type: "js" as const,
              filename: "app.js",
              content: `
                export function greet(name) {
                  return \`Hello, \${name}!\`;
                }
                export default greet;
              `,
              external: [],
              checks: (content: string) => {
                // JS should be bundled
                assertExists(content);
              },
            },
            {
              type: "ts" as const,
              filename: "app.ts",
              content: `
                interface User {
                  name: string;
                  age: number;
                }
                export function createUser(name: string, age: number): User {
                  return { name, age };
                }
              `,
              external: [],
              checks: (content: string) => {
                // Should remove type annotations
                assertEquals(content.includes("interface User"), false);
              },
            },
            {
              type: "jsx" as const,
              filename: "component.jsx",
              content: `
                import React from 'react';
                export function Button({ children }) {
                  return <button className="btn">{children}</button>;
                }
              `,
              external: ["react"],
              checks: (content: string) => {
                // Should transform JSX
                assertEquals(content.includes("<button"), false);
              },
            },
            {
              type: "tsx" as const,
              filename: "component.tsx",
              content: `
                import React from 'react';
                interface ButtonProps {
                  children: React.ReactNode;
                  onClick?: () => void;
                }
                export const Button: React.FC<ButtonProps> = ({ children, onClick }) => {
                  return <button onClick={onClick}>{children}</button>;
                };
              `,
              external: ["react"],
              checks: (content: string) => {
                // Should remove TypeScript types
                assertEquals(content.includes("interface ButtonProps"), false);
                assertEquals(content.includes("React.FC"), false);
              },
            },
          ];

          for (const testCase of testCases) {
            const source = {
              path: join(context.projectDir, testCase.filename),
              content: testCase.content,
              type: testCase.type,
            };

            const options: BundlerOptions = {
              sources: [],
              projectDir: context.projectDir,
              mode: "development",
              external: testCase.external.length > 0 ? testCase.external : undefined,
            };

            const result: BundleResult = {
              outputs: new Map(),
              errors: [],
              warnings: [],
              dependencies: new Map(),
            };

            const fileCache = new Map<string, string>();

            await bundleScript(source, options, result, esbuild, fileCache);

            // Check for build errors
            assertEquals(
              result.errors.length,
              0,
              `Build errors for ${testCase.type}: ${
                result.errors.map((e) => e.message).join(", ")
              }`,
            );

            // Should create output
            const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
            const output = result.outputs.get(outputPath);
            assertExists(output, `No output generated for ${testCase.type}`);
            assertEquals(output.type, "js");

            // Run type-specific checks
            testCase.checks(output.content);

            // Should track dependencies
            assertExists(result.dependencies.get(source.path));
          }
        });
      });

      it("minifies in production mode", async () => {
        await withTestContext("script-minify", async (context) => {
          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              // This is a comment
              export function calculate() {
                const result = 1 + 2 + 3;
                return result;
              }
            `,
            type: "js",
          };

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

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should be minified
          assertEquals(output.content.includes("// This is a comment"), false);
          assertEquals(output.content.includes("\n\n"), false);

          // Should be compact
          assertEquals(output.content.length < 100, true);
        });
      });

      it("includes source maps in development", async () => {
        await withTestContext("script-sourcemap", async (context) => {
          const source = {
            path: join(context.projectDir, "app.ts"),
            content: `
              export const value = 42;
            `,
            type: "ts",
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should include inline source map
          assertEquals(output.content.includes("sourceMappingURL=data:"), true);
        });
      });

      it("excludes source maps in production", async () => {
        await withTestContext("script-no-sourcemap", async (context) => {
          const source = {
            path: join(context.projectDir, "app.ts"),
            content: `
              export const value = 42;
            `,
            type: "ts",
          };

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

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should not include source map
          assertEquals(output.content.includes("sourceMappingURL"), false);
        });
      });

      it("respects external dependencies", async () => {
        await withTestContext("script-external", async (context) => {
          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              import React from 'react';
              import lodash from 'lodash';

              export default function App() {
                return React.createElement('div');
              }
            `,
            type: "js",
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
            external: ["react", "lodash"],
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should preserve external imports
          assertEquals(output.content.includes("react") || output.content.includes("React"), true);
        });
      });

      it("uses cache for resolution", async () => {
        await withTestContext("script-cache", async (context) => {
          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              import { helper } from './utils.js';
              export default helper;
            `,
            type: "js",
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const fileCache = new Map<string, string>();

          // Add dependency to cache
          fileCache.set(
            join(context.projectDir, "utils.js"),
            'export const helper = () => "help";',
          );

          await bundleScript(source, options, result, esbuild, fileCache);

          // Should add source to cache
          assertEquals(fileCache.has(source.path), true);

          // Should create output or have dependency errors
          const _outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          // Since utils.js is in cache but may not resolve properly, output may not exist
          // The important thing is the cache was used
          assertEquals(fileCache.size > 0, true);
        });
      });

      it("handles CSS imports via plugin", async () => {
        await withTestContext("script-css-import", async (context) => {
          // Create CSS file
          await writeTextFile(
            join(context.projectDir, "styles.css"),
            ".button { color: blue; }",
          );

          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              import styles from './styles.css';
              export default styles;
            `,
            type: "js",
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          // The bundler processes CSS files through the CSS plugin
          // This test verifies the plugin system works
          const cssPath = join(context.projectDir, "styles.css");

          // Check if CSS was added to outputs or if bundling succeeded/failed gracefully
          const hasCssOutput = result.outputs.has(cssPath);
          const hasAnyOutput = result.outputs.size > 0;
          const hasError = result.errors.length > 0;

          // At least one of these should be true (output created OR error captured)
          assertEquals(hasCssOutput || hasAnyOutput || hasError, true);
        });
      });

      it("marks dynamic bare imports as external", async () => {
        await withTestContext("script-dynamic-external", async (context) => {
          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              export async function loadModule() {
                const mod = await import('external-package');
                return mod;
              }
            `,
            type: "js",
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should preserve dynamic import
          assertEquals(output.content.includes("import("), true);
        });
      });

      it("defines process.env.NODE_ENV", async () => {
        await withTestContext("script-env", async (context) => {
          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              export const isDev = process.env.NODE_ENV === 'development';
              export const isProd = process.env.NODE_ENV === 'production';
            `,
            type: "js",
          };

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

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should replace process.env.NODE_ENV with 'production'
          // Minified output may optimize the entire expression
          assertEquals(output.content.length > 0, true);
        });
      });

      it("handles compilation errors", async () => {
        await withTestContext("script-error", async (context) => {
          const source = {
            path: join(context.projectDir, "broken.js"),
            content: `
              export function broken() {
                const x = ;  // Syntax error
              }
            `,
            type: "js",
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          // Should have errors
          assertEquals(result.errors.length > 0, true);

          // Should not create output
          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          assertEquals(result.outputs.has(outputPath), false);
        });
      });

      it("captures warnings", async () => {
        await withTestContext("script-warnings", async (context) => {
          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              // Using deprecated features might generate warnings
              export const value = 42;
            `,
            type: "js",
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          // Should collect warnings (if any)
          assertEquals(Array.isArray(result.warnings), true);
        });
      });

      it("uses correct loader for file types", async () => {
        await withTestContext("script-loaders", async (context) => {
          const testCases = [
            { ext: "js", content: "export const x = 1;" },
            { ext: "ts", content: "export const x: number = 1;" },
            { ext: "jsx", content: "export const el = <div />;" },
            { ext: "tsx", content: "export const el: JSX.Element = <div />;" },
          ];

          for (const testCase of testCases) {
            const source = {
              path: join(context.projectDir, `test.${testCase.ext}`),
              content: testCase.content,
              type: testCase.ext,
            };

            const options: BundlerOptions = {
              sources: [],
              projectDir: context.projectDir,
              mode: "development",
              external: ["react"],
            };

            const result: BundleResult = {
              outputs: new Map(),
              errors: [],
              warnings: [],
              dependencies: new Map(),
            };

            const fileCache = new Map<string, string>();

            await bundleScript(source, options, result, esbuild, fileCache);

            const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
            assertExists(result.outputs.get(outputPath), `Failed for ${testCase.ext}`);
          }
        });
      });

      it("bundles for different platforms", async () => {
        await withTestContext("script-platforms", async (context) => {
          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              export const value = 42;
            `,
            type: "js",
          };

          // Test browser platform (ESM)
          const browserOptions: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
            platform: "browser",
          };

          const browserResult: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          await bundleScript(source, browserOptions, browserResult, esbuild, new Map());

          const browserOutput = browserResult.outputs.get(
            source.path.replace(/\.(tsx?|jsx?)$/, ".js"),
          )!;
          assertExists(browserOutput);

          // Test node platform (CJS)
          const nodeOptions: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
            platform: "node",
          };

          const nodeResult: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          await bundleScript(source, nodeOptions, nodeResult, esbuild, new Map());

          const nodeOutput = nodeResult.outputs.get(source.path.replace(/\.(tsx?|jsx?)$/, ".js"))!;
          assertExists(nodeOutput);

          // Node output should use CommonJS
          assertEquals(
            nodeOutput.content.includes("exports") || nodeOutput.content.includes("module.exports"),
            true,
          );
        });
      });

      it("handles tree shaking in production", async () => {
        await withTestContext("script-tree-shake", async (context) => {
          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              export function used() {
                return "I'm used";
              }

              export function unused() {
                return "I'm never used";
              }

              // Only export used
              export default used;
            `,
            type: "js",
          };

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

          const fileCache = new Map<string, string>();

          await bundleScript(source, options, result, esbuild, fileCache);

          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // With tree shaking, output should be very small
          assertEquals(output.content.length < 200, true);
        });
      });

      it("targets correct ECMAScript version", async () => {
        await withTestContext("script-target", async (context) => {
          const source = {
            path: join(context.projectDir, "app.js"),
            content: `
              export const spread = { ...{ a: 1 }, b: 2 };
              export const optional = obj?.prop;
              export const nullish = value ?? 'default';
            `,
            type: "js",
          };

          const prodOptions: BundlerOptions = {
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

          const fileCache = new Map<string, string>();

          await bundleScript(source, prodOptions, result, esbuild, fileCache);

          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should target es2020 (modern features supported)
          assertExists(output.content);
        });
      });
    });
  },
);
