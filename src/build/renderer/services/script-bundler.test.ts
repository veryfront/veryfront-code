import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { bundleScript } from "./script-bundler.ts";
import * as esbuild from "veryfront/extensions/bundler";
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
          { mode: "development", projectDir: "/tmp", external: [], sources: [] },
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
        const source = {
          path: "app.ts",
          content: 'export const greeting = "hello world";',
          type: "ts",
        };
        const productionResult = createBundleResult();
        await bundleScript(
          source,
          { mode: "production", projectDir: "/tmp", external: [], sources: [] },
          productionResult,
          esbuild,
          new Map<string, string>(),
        );
        const developmentResult = createBundleResult();
        await bundleScript(
          source,
          { mode: "development", projectDir: "/tmp", external: [], sources: [] },
          developmentResult,
          esbuild,
          new Map<string, string>(),
        );

        const prod = productionResult.outputs.get("app.js")!.content;
        const dev = developmentResult.outputs.get("app.js")!.content;

        assertEquals(prod.includes(" = "), false, "production bundle is minified");
        assertEquals(
          prod.includes("sourceMappingURL"),
          false,
          "production bundle carries no sourcemap",
        );
        assertStringIncludes(
          dev,
          "//# sourceMappingURL=data:application/json;base64,",
          "development bundle carries an inline sourcemap",
        );
        assertEquals(
          prod.length < dev.length,
          true,
          "production bundle is smaller than the development bundle",
        );
      });

      it("should track dependencies", async () => {
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        const code = `import React from "react";\nexport const x = 1;`;
        await bundleScript(
          { path: "comp.tsx", content: code, type: "tsx" },
          { mode: "development", projectDir: "/tmp", external: ["react"], sources: [] },
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
          { mode: "development", projectDir: "/tmp", external: [], sources: [] },
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
          {
            mode: "development",
            projectDir: "/tmp/nonexistent-dir-" + Date.now(),
            external: [],
            sources: [],
          },
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
          {
            mode: "development",
            projectDir: "/tmp",
            external: [],
            platform: "node",
            sources: [],
          },
          result,
          esbuild,
          fileCache,
        );

        const output = result.outputs.get("server.js");
        assertExists(output);
        assertStringIncludes(
          output.content,
          "module.exports = __toCommonJS(",
          "node platform must emit CommonJS",
        );
        assertEquals(
          output.content.includes("export {"),
          false,
          "node bundles must not ship ESM exports",
        );
      });

      it("should use ESM format for the default browser platform", async () => {
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        await bundleScript(
          { path: "browser.ts", content: "export const x = 1;", type: "ts" },
          { mode: "development", projectDir: "/tmp", external: [], sources: [] },
          result,
          esbuild,
          fileCache,
        );

        const output = result.outputs.get("browser.js");
        assertExists(output);
        assertStringIncludes(output.content, "export {", "browser platform must emit ESM");
        assertEquals(
          output.content.includes("module.exports"),
          false,
          "browser bundles must not emit CommonJS",
        );
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
            sources: [],
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
