import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { bundleScript } from "./script-bundler.ts";
import * as esbuild from "esbuild";
import type { BundleResult } from "../types/bundler-types.ts";

function createBundleResult(): BundleResult {
  return {
    outputs: new Map(),
    dependencies: new Map(),
    errors: [],
    warnings: [],
  };
}

describe(
  "build/renderer/services/script-bundler",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      if ((globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) return;
      await esbuild.stop();
    });

    describe("bundleScript", () => {
      it("should bundle a simple TypeScript file", async () => {
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        await bundleScript(
          {
            path: "app.ts",
            content: 'export const greeting = "hello";',
            type: "ts",
          },
          { mode: "development", projectDir: "/tmp", external: [] },
          result,
          esbuild,
          fileCache,
        );

        assertEquals(result.outputs.has("app.js"), true);
        const output = result.outputs.get("app.js")!;
        assertExists(output.content);
        assertEquals(output.type, "js");
      });

      it("should minify in production mode", async () => {
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        await bundleScript(
          {
            path: "app.ts",
            content: 'export const greeting = "hello world";',
            type: "ts",
          },
          { mode: "production", projectDir: "/tmp", external: [] },
          result,
          esbuild,
          fileCache,
        );

        const output = result.outputs.get("app.js")!;
        assertExists(output.content);
      });

      it("should track dependencies", async () => {
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        const code = `import React from "react";\nexport const x = 1;`;
        await bundleScript(
          { path: "comp.tsx", content: code, type: "tsx" },
          { mode: "development", projectDir: "/tmp", external: ["react"] },
          result,
          esbuild,
          fileCache,
        );

        assertEquals(result.dependencies.has("comp.tsx"), true);
        const deps = result.dependencies.get("comp.tsx")!;
        assertEquals(deps.includes("react"), true);
      });

      it("should add file to cache", async () => {
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        const code = "export const x = 1;";
        await bundleScript(
          { path: "cached.ts", content: code, type: "ts" },
          { mode: "development", projectDir: "/tmp", external: [] },
          result,
          esbuild,
          fileCache,
        );

        assertEquals(fileCache.get("cached.ts"), code);
      });

      it("should handle build errors gracefully", async () => {
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        await bundleScript(
          {
            path: "bad.ts",
            content: 'import { foo } from "./nonexistent"; export default foo;',
            type: "ts",
          },
          { mode: "development", projectDir: "/tmp/nonexistent-dir-" + Date.now(), external: [] },
          result,
          esbuild,
          fileCache,
        );

        assertEquals(result.errors.length > 0, true);
      });

      it("should use CJS format for node platform", async () => {
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        await bundleScript(
          { path: "server.ts", content: "export const x = 1;", type: "ts" },
          { mode: "development", projectDir: "/tmp", external: [], platform: "node" },
          result,
          esbuild,
          fileCache,
        );

        const output = result.outputs.get("server.js");
        assertExists(output);
      });

      it("should handle JSX files", async () => {
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        const code = `
          import React from "react";
          export default function App() { return <div>Hello</div>; }
        `;
        await bundleScript(
          { path: "app.jsx", content: code, type: "jsx" },
          {
            mode: "development",
            projectDir: "/tmp",
            external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
          },
          result,
          esbuild,
          fileCache,
        );

        assertEquals(result.outputs.has("app.js"), true);
      });
    });
  },
);
