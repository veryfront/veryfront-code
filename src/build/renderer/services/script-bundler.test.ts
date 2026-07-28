import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { bundleScript } from "./script-bundler.ts";
import * as esbuild from "veryfront/extensions/bundler";
import type { BundleResult } from "../types/bundler-types.ts";
import { join } from "#veryfront/compat/path/index.ts";

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
        const result = createBundleResult();
        const fileCache = new Map<string, string>();

        await bundleScript(
          {
            path: "app.ts",
            content: 'export const greeting = "hello world";',
            type: "ts",
          },
          { mode: "production", projectDir: "/tmp", external: [], sources: [] },
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

      it("should bundle a dependency that exists only in the caller cache", async () => {
        const projectDir = await Deno.makeTempDir();
        try {
          const result = createBundleResult();
          const fileCache = new Map<string, string>([[
            join(projectDir, "dependency.ts"),
            "export const dependency = 42;",
          ]]);

          await bundleScript(
            {
              path: "app.ts",
              content: 'import { dependency } from "./dependency.ts"; export default dependency;',
              type: "ts",
            },
            { mode: "development", projectDir, external: [], sources: [] },
            result,
            esbuild,
            fileCache,
          );

          assertEquals(result.errors.length, 0);
          assertEquals(result.outputs.get("app.js")?.content.includes("42"), true);
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("should restore the source cache and preserve outputs after failure", async () => {
        const result = createBundleResult();
        result.outputs.set("bad.js", {
          path: "bad.js",
          content: "previous",
          type: "js",
        });
        const fileCache = new Map<string, string>([["bad.ts", "previous source"]]);

        await bundleScript(
          {
            path: "bad.ts",
            content: 'import missing from "./missing.ts"; export default missing;',
            type: "ts",
          },
          { mode: "development", projectDir: "/tmp", external: [], sources: [] },
          result,
          esbuild,
          fileCache,
        );

        assertEquals(fileCache.get("bad.ts"), "previous source");
        assertEquals(result.outputs.get("bad.js")?.content, "previous");
        assertEquals(result.dependencies.has("bad.ts"), false);
        assertEquals(result.errors.length, 1);
      });

      it("should not publish staged CSS when another dependency fails", async () => {
        const projectDir = await Deno.makeTempDir();
        try {
          await Deno.writeTextFile(join(projectDir, "styles.css"), ".button { color: blue; }");
          const result = createBundleResult();
          const fileCache = new Map<string, string>();

          await bundleScript(
            {
              path: "app.ts",
              content:
                'import "./styles.css"; import missing from "./missing.ts"; export default missing;',
              type: "ts",
            },
            { mode: "development", projectDir, external: [], sources: [] },
            result,
            esbuild,
            fileCache,
          );

          assertEquals(result.outputs.size, 0);
          assertEquals(fileCache.has("app.ts"), false);
          assertEquals(result.errors.length, 1);
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("should reject lexical and symlink dependency escapes", async () => {
        const root = await Deno.makeTempDir();
        try {
          const projectDir = join(root, "project");
          await Deno.mkdir(projectDir);
          const outsidePath = join(root, "outside.ts");
          await Deno.writeTextFile(outsidePath, "export default 1;");

          for (const specifier of ["../outside.ts", "./linked.ts"]) {
            if (specifier === "./linked.ts") {
              if (Deno.build.os === "windows") continue;
              await Deno.symlink(outsidePath, join(projectDir, "linked.ts"));
            }

            const result = createBundleResult();
            await bundleScript(
              {
                path: "app.ts",
                content: `import value from ${JSON.stringify(specifier)}; export default value;`,
                type: "ts",
              },
              { mode: "development", projectDir, external: [], sources: [] },
              result,
              esbuild,
              new Map(),
            );

            assertEquals(result.outputs.size, 0);
            assertEquals(result.errors.length, 1);
          }
        } finally {
          await Deno.remove(root, { recursive: true });
        }
      });
    });
  },
);
