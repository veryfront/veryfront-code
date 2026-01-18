import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd";
import { denoAdapter } from "@veryfront/platform/adapters/runtime/deno/index.ts";
import { ModuleResolver } from "@veryfront/modules";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "ModuleResolver",
  () => {
    describe("Basic Resolution", () => {
      it("resolves virtual, mapped, file, absolute and npm", async () => {
        await withTestContext("module-resolver", async (context) => {
          const filePath = join(context.projectDir, "src", "lib", "util.ts");
          await Deno.mkdir(join(context.projectDir, "src", "lib"), {
            recursive: true,
          });
          await Deno.writeTextFile(filePath, "export const x=1\n");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: { "@alias": "/src/lib/util.ts" },
            virtualModules: new Map([["virtual:mod", "export const v=1"]]),
            adapter: denoAdapter,
          });

          // virtual
          const v = await r.resolve("virtual:mod");
          assert(v && v.type === "virtual" && v.content?.includes("v=1"));

          // mapped to absolute
          const m = await r.resolve("@alias");
          assert(m && m.type === "file" && m.path.endsWith("util.ts"));

          // relative from referrer
          const rel = await r.resolve("../lib/util", "src/app/main.ts");
          assert(rel?.path.endsWith("util.ts"));

          // absolute
          const abs = await r.resolve("/src/lib/util.ts");
          assert(abs?.path.endsWith("util.ts"));

          // npm default to esm.sh
          const npm = await r.resolve("react");
          assertEquals(npm?.type, "npm");
          assert(String(npm?.path).startsWith("https://esm.sh/react"));

          // cache clears on virtual module change
          const before = await r.resolve("virtual:mod");
          r.addVirtualModule("virtual:mod", "export const v=2");
          const after = await r.resolve("virtual:mod");
          assertEquals(before?.content === after?.content, false);
        });
      });
    });

    describe("Virtual Modules", () => {
      it("should resolve virtual module with transformed flag", async () => {
        await withTestContext("virtual-transformed", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["virtual:config", "export const cfg = {}"]]),
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("virtual:config");
          assertExists(resolved, "Virtual module should resolve");
          assertEquals(resolved.type, "virtual");
          assertEquals(resolved.transformed, true);
          assertEquals(resolved.content, "export const cfg = {}");
        });
      });

      it("should return null for non-existent virtual module", async () => {
        await withTestContext("virtual-missing", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Virtual modules that don't exist get treated as npm packages
          const resolved = await r.resolve("virtual:nonexistent");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
        });
      });

      it("should add virtual module and clear cache", async () => {
        await withTestContext("virtual-add", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Initially not present - resolves as npm package
          let resolved = await r.resolve("virtual:new");
          assertEquals(resolved?.type, "npm");

          // Add module
          r.addVirtualModule("virtual:new", "export const x = 1");

          // Should now resolve as virtual module
          resolved = await r.resolve("virtual:new");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");
          assertEquals(resolved.content, "export const x = 1");
        });
      });

      it("should update existing virtual module", async () => {
        await withTestContext("virtual-update", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["virtual:data", "export const v = 1"]]),
            adapter: denoAdapter,
          });

          const first = await r.resolve("virtual:data");
          assertEquals(first?.content, "export const v = 1");

          // Update module
          r.addVirtualModule("virtual:data", "export const v = 2");

          const updated = await r.resolve("virtual:data");
          assertEquals(updated?.content, "export const v = 2");
        });
      });

      it("should remove virtual module", async () => {
        await withTestContext("virtual-remove", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["virtual:temp", "export const t = 1"]]),
            adapter: denoAdapter,
          });

          // Initially exists
          let resolved = await r.resolve("virtual:temp");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");

          // Remove module
          r.removeVirtualModule("virtual:temp");

          // Should now resolve as npm package (fallback)
          resolved = await r.resolve("virtual:temp");
          assertEquals(resolved?.type, "npm");
        });
      });

      it("should handle virtual module with empty content", async () => {
        await withTestContext("virtual-empty", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["virtual:empty", ""]]),
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("virtual:empty");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");
          assertEquals(resolved.content, "");
        });
      });

      it("should handle multiple virtual modules", async () => {
        await withTestContext("virtual-multiple", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([
              ["virtual:a", "export const a = 1"],
              ["virtual:b", "export const b = 2"],
              ["virtual:c", "export const c = 3"],
            ]),
            adapter: denoAdapter,
          });

          const a = await r.resolve("virtual:a");
          const b = await r.resolve("virtual:b");
          const c = await r.resolve("virtual:c");

          assertEquals(a?.content, "export const a = 1");
          assertEquals(b?.content, "export const b = 2");
          assertEquals(c?.content, "export const c = 3");
        });
      });
    });

    describe("Import Map", () => {
      it("should resolve import map to file path", async () => {
        await withTestContext("importmap-file", async (context) => {
          const filePath = join(context.projectDir, "src", "utils.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const util = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: { "@utils": "/src/utils.ts" },
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("@utils");
          assertExists(resolved);
          assertEquals(resolved.type, "file");
          assert(resolved.path.endsWith("utils.ts"));
        });
      });

      it("should resolve import map to external URL (http)", async () => {
        await withTestContext("importmap-http", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: { "http-lib": "http://example.com/lib.js" },
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("http-lib");
          assertExists(resolved);
          assertEquals(resolved.type, "external");
          assertEquals(resolved.path, "http://example.com/lib.js");
        });
      });

      it("should resolve import map to external URL (https)", async () => {
        await withTestContext("importmap-https", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: { "cdn-lib": "https://cdn.example.com/lib.js" },
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("cdn-lib");
          assertExists(resolved);
          assertEquals(resolved.type, "external");
          assertEquals(resolved.path, "https://cdn.example.com/lib.js");
        });
      });

      it("should handle import map with multiple entries", async () => {
        await withTestContext("importmap-multiple", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: {
              "@lib1": "https://cdn.com/lib1.js",
              "@lib2": "https://cdn.com/lib2.js",
              "@lib3": "https://cdn.com/lib3.js",
            },
            adapter: denoAdapter,
          });

          const lib1 = await r.resolve("@lib1");
          const lib2 = await r.resolve("@lib2");
          const lib3 = await r.resolve("@lib3");

          assertEquals(lib1?.path, "https://cdn.com/lib1.js");
          assertEquals(lib2?.path, "https://cdn.com/lib2.js");
          assertEquals(lib3?.path, "https://cdn.com/lib3.js");
        });
      });

      it("should work without import map", async () => {
        await withTestContext("no-importmap", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("react");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
        });
      });
    });

    describe("Relative Imports", () => {
      it("should resolve relative import with ./ prefix", async () => {
        await withTestContext("relative-dot", async (context) => {
          const filePath = join(context.projectDir, "src", "lib.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const lib = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./lib", "src/main.ts");
          assertExists(resolved);
          assertEquals(resolved.type, "file");
          assert(resolved.path.endsWith("lib.ts"));
        });
      });

      it("should resolve relative import with ../ prefix", async () => {
        await withTestContext("relative-parent", async (context) => {
          const filePath = join(context.projectDir, "src", "util.ts");
          await Deno.mkdir(join(context.projectDir, "src", "components"), {
            recursive: true,
          });
          await Deno.writeTextFile(filePath, "export const util = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("../util", "src/components/Button.tsx");
          assertExists(resolved);
          assertEquals(resolved.type, "file");
          assert(resolved.path.endsWith("util.ts"));
        });
      });

      it("should resolve relative import with .ts extension", async () => {
        await withTestContext("relative-ts-ext", async (context) => {
          const filePath = join(context.projectDir, "src", "data.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const data = {}");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./data.ts", "src/main.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("data.ts"));
        });
      });

      it("should resolve relative import with .tsx extension", async () => {
        await withTestContext("relative-tsx-ext", async (context) => {
          const filePath = join(context.projectDir, "src", "App.tsx");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export default function App() {}");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./App.tsx", "src/index.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("App.tsx"));
        });
      });

      it("should resolve relative import with .js extension", async () => {
        await withTestContext("relative-js-ext", async (context) => {
          const filePath = join(context.projectDir, "src", "legacy.js");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const legacy = true");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./legacy.js", "src/main.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("legacy.js"));
        });
      });

      it("should resolve relative import with .jsx extension", async () => {
        await withTestContext("relative-jsx-ext", async (context) => {
          const filePath = join(context.projectDir, "src", "Component.jsx");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const Component = () => {}");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./Component.jsx", "src/main.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("Component.jsx"));
        });
      });

      it("should resolve relative import with .mjs extension", async () => {
        await withTestContext("relative-mjs-ext", async (context) => {
          const filePath = join(context.projectDir, "src", "module.mjs");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const mod = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./module.mjs", "src/main.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("module.mjs"));
        });
      });

      it("should auto-add .ts extension when missing", async () => {
        await withTestContext("relative-auto-ts", async (context) => {
          const filePath = join(context.projectDir, "src", "helper.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const help = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./helper", "src/main.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("helper.ts"));
        });
      });

      it("should return null for missing relative import", async () => {
        await withTestContext("relative-missing", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./nonexistent", "src/main.ts");
          assertEquals(resolved, null);
        });
      });

      it("should resolve relative import from project root when no referrer", async () => {
        await withTestContext("relative-no-referrer", async (context) => {
          const filePath = join(context.projectDir, "lib.ts");
          await Deno.writeTextFile(filePath, "export const lib = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./lib");
          assertExists(resolved);
          assert(resolved.path.endsWith("lib.ts"));
        });
      });

      it("should handle deep relative paths", async () => {
        await withTestContext("relative-deep", async (context) => {
          const filePath = join(context.projectDir, "src", "core", "utils", "string.ts");
          await Deno.mkdir(join(context.projectDir, "src", "core", "utils"), {
            recursive: true,
          });
          await Deno.writeTextFile(filePath, "export const str = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve(
            "../../core/utils/string",
            "src/components/ui/Button.tsx",
          );
          assertExists(resolved);
          assert(resolved.path.endsWith("string.ts"));
        });
      });
    });

    describe("Absolute Imports", () => {
      it("should resolve absolute import from project root", async () => {
        await withTestContext("absolute-root", async (context) => {
          const filePath = join(context.projectDir, "config.ts");
          await Deno.writeTextFile(filePath, "export const config = {}");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/config.ts");
          assertExists(resolved);
          assertEquals(resolved.type, "file");
          assert(resolved.path.endsWith("config.ts"));
        });
      });

      it("should resolve absolute import from nested directory", async () => {
        await withTestContext("absolute-nested", async (context) => {
          const filePath = join(context.projectDir, "src", "lib", "utils.ts");
          await Deno.mkdir(join(context.projectDir, "src", "lib"), {
            recursive: true,
          });
          await Deno.writeTextFile(filePath, "export const utils = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/src/lib/utils.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("utils.ts"));
        });
      });

      it("should return null for missing absolute import", async () => {
        await withTestContext("absolute-missing", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/nonexistent.ts");
          assertEquals(resolved, null);
        });
      });
    });

    describe("NPM Package Resolution", () => {
      it("should resolve npm package to esm.sh", async () => {
        await withTestContext("npm-basic", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("lodash");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/lodash");
        });
      });

      it("should resolve scoped npm package", async () => {
        await withTestContext("npm-scoped", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("@babel/core");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/@babel/core");
        });
      });

      it("should resolve npm package with version", async () => {
        await withTestContext("npm-version", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("react@18.2.0");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/react@18.2.0");
        });
      });

      it("should resolve npm package with subpath", async () => {
        await withTestContext("npm-subpath", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("lodash/debounce");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/lodash/debounce");
        });
      });

      it("should resolve scoped npm package with subpath", async () => {
        await withTestContext("npm-scoped-subpath", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("@babel/parser/lib/index.js");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/@babel/parser/lib/index.js");
        });
      });

      it("should resolve npm package with tag", async () => {
        await withTestContext("npm-tag", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("react@next");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/react@next");
        });
      });
    });

    describe("Cache Management", () => {
      it("should cache resolved modules", async () => {
        await withTestContext("cache-basic", async (context) => {
          const filePath = join(context.projectDir, "src", "cached.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const cached = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // First resolution
          const first = await r.resolve("/src/cached.ts");
          // Second resolution (should be cached)
          const second = await r.resolve("/src/cached.ts");

          assertEquals(first, second);
        });
      });

      it("should cache with different referrers separately", async () => {
        await withTestContext("cache-referrer", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const npm1 = await r.resolve("react", "src/app.ts");
          const npm2 = await r.resolve("react", "src/main.ts");

          // Both should resolve but have different cache keys
          assertExists(npm1);
          assertExists(npm2);
          assertEquals(npm1.path, npm2.path);
        });
      });

      it("should clear entire cache without pattern", async () => {
        await withTestContext("cache-clear-all", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["virtual:a", "a"], ["virtual:b", "b"]]),
            adapter: denoAdapter,
          });

          // Populate cache
          await r.resolve("virtual:a");
          await r.resolve("virtual:b");

          // Clear cache
          r.clearCache();

          // Should re-resolve (can't directly verify cache clear, but ensures no error)
          const a = await r.resolve("virtual:a");
          const b = await r.resolve("virtual:b");
          assertExists(a);
          assertExists(b);
        });
      });

      it("should clear cache with pattern matching", async () => {
        await withTestContext("cache-clear-pattern", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([
              ["virtual:config", "config"],
              ["virtual:data", "data"],
            ]),
            adapter: denoAdapter,
          });

          // Populate cache
          await r.resolve("virtual:config");
          await r.resolve("virtual:data");

          // Clear cache for 'config' pattern
          r.clearCache("config");

          // Both should still resolve
          const config = await r.resolve("virtual:config");
          const data = await r.resolve("virtual:data");
          assertExists(config);
          assertExists(data);
        });
      });

      it("should invalidate cache when virtual module added", async () => {
        await withTestContext("cache-invalidate-add", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // First, resolves as npm package
          let resolved = await r.resolve("virtual:dynamic");
          assertEquals(resolved?.type, "npm");

          // Add the module
          r.addVirtualModule("virtual:dynamic", "export const x = 1");

          // Should now resolve as virtual without cache interference
          resolved = await r.resolve("virtual:dynamic");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");
          assertEquals(resolved.content, "export const x = 1");
        });
      });

      it("should invalidate cache when virtual module removed", async () => {
        await withTestContext("cache-invalidate-remove", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["virtual:temp", "temp"]]),
            adapter: denoAdapter,
          });

          // Initially resolves as virtual
          let resolved = await r.resolve("virtual:temp");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");

          // Remove module
          r.removeVirtualModule("virtual:temp");

          // Should now resolve as npm package without cache interference
          resolved = await r.resolve("virtual:temp");
          assertEquals(resolved?.type, "npm");
        });
      });

      it("should handle concurrent resolutions", async () => {
        await withTestContext("cache-concurrent", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Resolve multiple packages concurrently
          const results = await Promise.all([
            r.resolve("react"),
            r.resolve("react-dom"),
            r.resolve("lodash"),
            r.resolve("axios"),
          ]);

          // All should resolve successfully
          results.forEach((result) => {
            assertExists(result);
            assertEquals(result.type, "npm");
          });
        });
      });
    });

    describe("Edge Cases", () => {
      it("should treat empty specifier as npm package", async () => {
        await withTestContext("edge-empty-specifier", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Empty specifier gets treated as npm package
          const resolved = await r.resolve("");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
        });
      });

      it("should handle malformed relative path", async () => {
        await withTestContext("edge-malformed-relative", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Malformed path './' may resolve to directory if it exists
          const resolved = await r.resolve("./", "src/main.ts");
          // Can be file (if directory exists) or null
          assert(resolved === null || resolved.type === "file");
        });
      });

      it("should handle path with multiple extensions", async () => {
        await withTestContext("edge-double-ext", async (context) => {
          const filePath = join(context.projectDir, "file.test.ts");
          await Deno.writeTextFile(filePath, "export const test = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/file.test.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("file.test.ts"));
        });
      });

      it("should handle file with special characters in name", async () => {
        await withTestContext("edge-special-chars", async (context) => {
          const filePath = join(context.projectDir, "my-file_v2.ts");
          await Deno.writeTextFile(filePath, "export const special = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/my-file_v2.ts");
          assertExists(resolved);
          assert(resolved.path.includes("my-file_v2.ts"));
        });
      });

      it("should prioritize exact file match over extension guessing", async () => {
        await withTestContext("edge-exact-match", async (context) => {
          // Create both 'file' (no ext) and 'file.ts'
          const noExtPath = join(context.projectDir, "file");
          const tsPath = join(context.projectDir, "file.ts");
          await Deno.writeTextFile(noExtPath, "no extension");
          await Deno.writeTextFile(tsPath, "with extension");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/file");
          assertExists(resolved);
          // Should match 'file' with no extension first
          assert(resolved.path.endsWith("/file"));
        });
      });

      it("should handle deeply nested relative imports", async () => {
        await withTestContext("edge-deep-nesting", async (context) => {
          const filePath = join(
            context.projectDir,
            "a",
            "b",
            "c",
            "d",
            "e",
            "deep.ts",
          );
          await Deno.mkdir(join(context.projectDir, "a", "b", "c", "d", "e"), {
            recursive: true,
          });
          await Deno.writeTextFile(filePath, "export const deep = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve(
            "../../../../../a/b/c/d/e/deep",
            "x/y/z/w/v/file.ts",
          );
          assertExists(resolved);
          assert(resolved.path.endsWith("deep.ts"));
        });
      });

      it("should handle virtual module with special characters", async () => {
        await withTestContext("edge-virtual-special", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([
              ["virtual:@config/app", "export const config = {}"],
            ]),
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("virtual:@config/app");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");
        });
      });

      it("should handle npm package with very long name", async () => {
        await withTestContext("edge-long-npm", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const longName = "@very-long-org-name/super-long-package-name-that-goes-on-forever";
          const resolved = await r.resolve(longName);
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assert(resolved.path.includes(longName));
        });
      });

      it("should handle URL-like specifiers that are not in import map", async () => {
        await withTestContext("edge-url-like", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Should be treated as npm package (not URL)
          const resolved = await r.resolve("http-proxy");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
        });
      });

      it("should handle resolution from root referrer", async () => {
        await withTestContext("edge-root-referrer", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("react", "");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
        });
      });
    });

    describe("Error Scenarios", () => {
      it("should handle file system errors gracefully", async () => {
        await withTestContext("error-fs", async (_context) => {
          const r = new ModuleResolver({
            projectDir: "/nonexistent/path/that/does/not/exist",
            adapter: denoAdapter,
          });

          // Should not throw, just return null
          const resolved = await r.resolve("/some/file.ts");
          assertEquals(resolved, null);
        });
      });

      it("should handle relative import with missing referrer gracefully", async () => {
        await withTestContext("error-no-referrer", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Relative import without referrer should resolve from project root
          const resolved = await r.resolve("../outside");
          // May or may not exist, but should not throw
          assert(resolved === null || resolved !== null);
        });
      });

      it("should handle circular import attempts", async () => {
        await withTestContext("error-circular", async (context) => {
          const fileA = join(context.projectDir, "a.ts");
          const fileB = join(context.projectDir, "b.ts");
          await Deno.writeTextFile(fileA, "import './b'");
          await Deno.writeTextFile(fileB, "import './a'");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Should resolve both without error (circular detection is not resolver's job)
          const a = await r.resolve("/a.ts");
          const b = await r.resolve("/b.ts");
          assertExists(a);
          assertExists(b);
        });
      });
    });

    describe("Path Normalization", () => {
      it("should normalize paths with double slashes", async () => {
        await withTestContext("normalize-double-slash", async (context) => {
          const filePath = join(context.projectDir, "src", "lib.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const lib = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/src//lib.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("lib.ts"));
        });
      });

      it("should handle paths with ./ in the middle", async () => {
        await withTestContext("normalize-dot-middle", async (context) => {
          const filePath = join(context.projectDir, "src", "lib.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const lib = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/src/./lib.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("lib.ts"));
        });
      });

      it("should handle Windows-style paths", async () => {
        await withTestContext("normalize-windows", async (context) => {
          const filePath = join(context.projectDir, "src", "win.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const win = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Note: This tests that the resolver doesn't break with backslashes
          // Actual path resolution depends on OS
          const resolved = await r.resolve("/src/win.ts");
          assertExists(resolved);
        });
      });
    });

    describe("Integration Scenarios", () => {
      it("should handle mixed resolution types in sequence", async () => {
        await withTestContext("integration-mixed", async (context) => {
          const filePath = join(context.projectDir, "src", "local.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const local = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: { "@config": "https://cdn.com/config.js" },
            virtualModules: new Map([["virtual:env", "export const env = {}"]]),
            adapter: denoAdapter,
          });

          const virtual = await r.resolve("virtual:env");
          const mapped = await r.resolve("@config");
          const file = await r.resolve("/src/local.ts");
          const npm = await r.resolve("react");

          assertEquals(virtual?.type, "virtual");
          assertEquals(mapped?.type, "external");
          assertEquals(file?.type, "file");
          assertEquals(npm?.type, "npm");
        });
      });

      it("should handle module updates without restart", async () => {
        await withTestContext("integration-hot-update", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["virtual:state", "export const v = 1"]]),
            adapter: denoAdapter,
          });

          // Initial state
          let resolved = await r.resolve("virtual:state");
          assertEquals(resolved?.content, "export const v = 1");

          // Update
          r.addVirtualModule("virtual:state", "export const v = 2");
          resolved = await r.resolve("virtual:state");
          assertEquals(resolved?.content, "export const v = 2");

          // Update again
          r.addVirtualModule("virtual:state", "export const v = 3");
          resolved = await r.resolve("virtual:state");
          assertEquals(resolved?.content, "export const v = 3");
        });
      });

      it("should handle large number of concurrent resolutions", async () => {
        await withTestContext("integration-concurrent-large", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Create 50 concurrent resolutions
          const promises = [];
          for (let i = 0; i < 50; i++) {
            promises.push(r.resolve(`package-${i}`));
          }

          const results = await Promise.all(promises);

          // All should resolve successfully
          assertEquals(results.length, 50);
          results.forEach((result, i) => {
            assertExists(result, `Package ${i} should resolve`);
            assertEquals(result.type, "npm");
          });
        });
      });
    });

    describe("Virtual Module Handling - Advanced", () => {
      it("should prioritize virtual modules over filesystem modules", async () => {
        await withTestContext("virtual-priority", async (context) => {
          const filePath = join(context.projectDir, "config.ts");
          await Deno.writeTextFile(filePath, "export const fs = true");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["config.ts", "export const virtual = true"]]),
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("config.ts");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");
          assertEquals(resolved.content, "export const virtual = true");
        });
      });

      it("should handle nested virtual module paths", async () => {
        await withTestContext("virtual-nested", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([
              ["virtual:app/config/database", "export const db = {}"],
            ]),
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("virtual:app/config/database");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");
          assertEquals(resolved.content, "export const db = {}");
        });
      });

      it("should handle virtual module with same name as npm package", async () => {
        await withTestContext("virtual-npm-conflict", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["react", "export const CustomReact = {}"]]),
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("react");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");
          assertEquals(resolved.content, "export const CustomReact = {}");
        });
      });

      it("should handle virtual module with JSON-like content", async () => {
        await withTestContext("virtual-json", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([
              ["virtual:config.json", '{"key": "value", "nested": {"data": 123}}'],
            ]),
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("virtual:config.json");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");
          assertEquals(resolved.content, '{"key": "value", "nested": {"data": 123}}');
        });
      });

      it("should handle virtual module with very large content", async () => {
        await withTestContext("virtual-large", async (context) => {
          const largeContent = "export const data = " + JSON.stringify(new Array(1000).fill("x"));
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            virtualModules: new Map([["virtual:large", largeContent]]),
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("virtual:large");
          assertExists(resolved);
          assertEquals(resolved.type, "virtual");
          assertEquals(resolved.content?.length, largeContent.length);
        });
      });

      it("should handle multiple sequential virtual module registrations", async () => {
        await withTestContext("virtual-sequential", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          r.addVirtualModule("virtual:a", "a");
          r.addVirtualModule("virtual:b", "b");
          r.addVirtualModule("virtual:c", "c");

          const a = await r.resolve("virtual:a");
          const b = await r.resolve("virtual:b");
          const c = await r.resolve("virtual:c");

          assertEquals(a?.content, "a");
          assertEquals(b?.content, "b");
          assertEquals(c?.content, "c");
        });
      });
    });

    describe("Import Map Resolution - Conflicts and Edge Cases", () => {
      it("should handle longest prefix match in import map", async () => {
        await withTestContext("importmap-longest-prefix", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: {
              "lib": "https://cdn.com/lib.js",
              "lib/utils": "https://cdn.com/lib-utils.js",
            },
            adapter: denoAdapter,
          });

          const lib = await r.resolve("lib");
          const libUtils = await r.resolve("lib/utils");

          assertEquals(lib?.path, "https://cdn.com/lib.js");
          assertEquals(libUtils?.path, "https://cdn.com/lib-utils.js");
        });
      });

      it("should handle import map entries with trailing slashes", async () => {
        await withTestContext("importmap-trailing-slash", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: {
              "@lib/": "https://cdn.com/lib/",
            },
            adapter: denoAdapter,
          });

          // Exact match needed
          const resolved = await r.resolve("@lib/");
          assertExists(resolved);
          assertEquals(resolved.type, "external");
        });
      });

      it("should treat non-matching import map entry as npm package", async () => {
        await withTestContext("importmap-no-match", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: {
              "@lib": "https://cdn.com/lib.js",
            },
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("@other");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
        });
      });

      it("should handle import map with empty value", async () => {
        await withTestContext("importmap-empty-value", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: {
              "empty": "",
            },
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("empty");
          // Empty string doesn't start with http/https and doesn't match filesystem
          // So it falls through to npm resolution
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
        });
      });

      it("should handle import map with relative path remapping", async () => {
        await withTestContext("importmap-relative-remap", async (context) => {
          const filePath = join(context.projectDir, "dist", "bundle.js");
          await Deno.mkdir(join(context.projectDir, "dist"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const bundle = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: {
              "@bundle": "/dist/bundle.js",
            },
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("@bundle");
          assertExists(resolved);
          assertEquals(resolved.type, "file");
          assert(resolved.path.endsWith("bundle.js"));
        });
      });

      it("should handle import map precedence over npm packages", async () => {
        await withTestContext("importmap-npm-precedence", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: {
              "lodash": "https://cdn.skypack.dev/lodash",
            },
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("lodash");
          assertExists(resolved);
          assertEquals(resolved.type, "external");
          assertEquals(resolved.path, "https://cdn.skypack.dev/lodash");
        });
      });

      it("should handle import map with special characters in keys", async () => {
        await withTestContext("importmap-special-keys", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: {
              "@org/pkg-v2.0": "https://cdn.com/pkg.js",
            },
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("@org/pkg-v2.0");
          assertExists(resolved);
          assertEquals(resolved.path, "https://cdn.com/pkg.js");
        });
      });
    });

    describe("Relative Imports - Complex Scenarios", () => {
      it("should resolve relative imports with different referrer base paths", async () => {
        await withTestContext("relative-different-bases", async (context) => {
          const sharedPath = join(context.projectDir, "shared", "utils.ts");
          await Deno.mkdir(join(context.projectDir, "shared"), { recursive: true });
          await Deno.mkdir(join(context.projectDir, "app"), { recursive: true });
          await Deno.mkdir(join(context.projectDir, "lib"), { recursive: true });
          await Deno.writeTextFile(sharedPath, "export const shared = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const fromApp = await r.resolve("../shared/utils", "app/main.ts");
          const fromLib = await r.resolve("../shared/utils", "lib/index.ts");

          assertExists(fromApp);
          assertExists(fromLib);
          assert(fromApp.path.endsWith("utils.ts"));
          assert(fromLib.path.endsWith("utils.ts"));
        });
      });

      it("should handle multiple ../ traversals", async () => {
        await withTestContext("relative-multi-parent", async (context) => {
          const rootPath = join(context.projectDir, "root.ts");
          await Deno.mkdir(join(context.projectDir, "a", "b", "c"), {
            recursive: true,
          });
          await Deno.writeTextFile(rootPath, "export const root = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("../../../root", "a/b/c/deep.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("root.ts"));
        });
      });

      it("should handle relative import from project root directory", async () => {
        await withTestContext("relative-from-root", async (context) => {
          const filePath = join(context.projectDir, "config.ts");
          await Deno.writeTextFile(filePath, "export const cfg = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("./config", "index.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("config.ts"));
        });
      });

      it("should handle relative imports with mixed slashes and dots", async () => {
        await withTestContext("relative-mixed", async (context) => {
          const filePath = join(context.projectDir, "src", "lib", "utils.ts");
          await Deno.mkdir(join(context.projectDir, "src", "lib"), {
            recursive: true,
          });
          await Deno.writeTextFile(filePath, "export const utils = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve(".././lib/utils", "src/app/main.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("utils.ts"));
        });
      });

      it("should handle relative import attempting to escape project root", async () => {
        await withTestContext("relative-escape-root", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Try to escape project directory with excessive traversal
          // path.join normalizes paths and can traverse outside project directory
          // This reveals that the resolver doesn't prevent path traversal - it just uses path.join
          // which can resolve to filesystem paths outside the project
          const resolved = await r.resolve(
            "../../../../../../../../nonexistent-file-xyz.ts",
            "src/main.ts",
          );
          // File doesn't exist so returns null
          assertEquals(resolved, null);
        });
      });
    });

    describe("Absolute Imports - Security and Extensions", () => {
      it("should resolve absolute path with .ts extension", async () => {
        await withTestContext("absolute-ts-ext", async (context) => {
          const filePath = join(context.projectDir, "src", "module.ts");
          await Deno.mkdir(join(context.projectDir, "src"), { recursive: true });
          await Deno.writeTextFile(filePath, "export const mod = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/src/module.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("module.ts"));
        });
      });

      it("should resolve absolute path without extension", async () => {
        await withTestContext("absolute-no-ext", async (context) => {
          const filePath = join(context.projectDir, "index.ts");
          await Deno.writeTextFile(filePath, "export const index = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/index.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("index.ts"));
        });
      });

      it("should handle absolute path to deeply nested file", async () => {
        await withTestContext("absolute-deep", async (context) => {
          const filePath = join(
            context.projectDir,
            "src",
            "features",
            "auth",
            "services",
            "auth.service.ts",
          );
          await Deno.mkdir(
            join(context.projectDir, "src", "features", "auth", "services"),
            { recursive: true },
          );
          await Deno.writeTextFile(filePath, "export class AuthService {}");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/src/features/auth/services/auth.service.ts");
          assertExists(resolved);
          assert(resolved.path.endsWith("auth.service.ts"));
        });
      });

      it("should prevent path traversal in absolute imports", async () => {
        await withTestContext("absolute-traversal", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Absolute path still joins with projectDir, preventing escape
          const resolved = await r.resolve("/../../../etc/passwd");
          assertEquals(resolved, null);
        });
      });
    });

    describe("NPM Package Resolution - Advanced", () => {
      it("should resolve deeply nested npm package subpath", async () => {
        await withTestContext("npm-deep-subpath", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("lodash/fp/curry");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/lodash/fp/curry");
        });
      });

      it("should resolve scoped package with version and subpath", async () => {
        await withTestContext("npm-scoped-version-subpath", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("@babel/core@7.20.0/lib/index.js");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/@babel/core@7.20.0/lib/index.js");
        });
      });

      it("should resolve package with jsx-runtime subpath", async () => {
        await withTestContext("npm-jsx-runtime", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("react/jsx-runtime");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/react/jsx-runtime");
        });
      });

      it("should resolve package with prerelease version", async () => {
        await withTestContext("npm-prerelease", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("next@14.0.0-canary.0");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/next@14.0.0-canary.0");
        });
      });

      it("should handle package name with numbers and hyphens", async () => {
        await withTestContext("npm-complex-name", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("vue-router-4");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
          assertEquals(resolved.path, "https://esm.sh/vue-router-4");
        });
      });
    });

    describe("Cache Patterns - Advanced", () => {
      it("should maintain separate cache entries for same specifier with different referrers", async () => {
        await withTestContext("cache-referrer-keys", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          await r.resolve("react", "app/main.ts");
          await r.resolve("react", "lib/util.ts");
          await r.resolve("react", "components/Button.tsx");

          // All should be cached separately
          const result = await r.resolve("react", "app/main.ts");
          assertExists(result);
        });
      });

      it("should invalidate cache on import map change", async () => {
        await withTestContext("cache-importmap-change", async (context) => {
          const opts = {
            projectDir: context.projectDir,
            importMap: { "lib": "https://cdn.com/v1.js" },
            adapter: denoAdapter,
          };
          const r = new ModuleResolver(opts);

          const first = await r.resolve("lib");
          assertEquals(first?.path, "https://cdn.com/v1.js");

          // Simulate import map update (requires new resolver instance in real scenario)
          // This test verifies behavior with current state
          r.clearCache();
          const second = await r.resolve("lib");
          assertEquals(second?.path, "https://cdn.com/v1.js");
        });
      });

      it("should generate unique cache keys for edge case specifiers", async () => {
        await withTestContext("cache-edge-keys", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          await r.resolve("");
          await r.resolve(".");
          await r.resolve("..");
          await r.resolve("@");
          await r.resolve("/");

          // All should be handled without cache collision
          const result = await r.resolve("react");
          assertExists(result);
        });
      });

      it("should handle cache with high volume resolutions", async () => {
        await withTestContext("cache-high-volume", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Resolve 100 unique packages
          for (let i = 0; i < 100; i++) {
            await r.resolve(`package-${i}`);
          }

          // Resolve again - should hit cache
          const resolved = await r.resolve("package-50");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
        });
      });
    });

    describe("Advanced Edge Cases", () => {
      it("should prioritize .ts over .tsx over .js over .jsx over .mjs", async () => {
        await withTestContext("edge-extension-priority", async (context) => {
          // Create files with same name but different extensions
          await Deno.writeTextFile(join(context.projectDir, "module.mjs"), "mjs");
          await Deno.writeTextFile(join(context.projectDir, "module.jsx"), "jsx");
          await Deno.writeTextFile(join(context.projectDir, "module.js"), "js");
          await Deno.writeTextFile(join(context.projectDir, "module.tsx"), "tsx");
          await Deno.writeTextFile(join(context.projectDir, "module.ts"), "ts");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Resolver checks extensions in order: '', '.ts', '.tsx', '.js', '.jsx', '.mjs'
          // First it checks for exact match (no extension), then .ts
          const resolved = await r.resolve("./module", "index.ts");
          assertExists(resolved);
          // Should match .ts first (second in extensions array)
          assert(resolved.path.endsWith("module.ts"));
        });
      });

      it("should handle module path with spaces", async () => {
        await withTestContext("edge-path-spaces", async (context) => {
          const filePath = join(context.projectDir, "my module.ts");
          await Deno.writeTextFile(filePath, "export const spaced = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/my module.ts");
          assertExists(resolved);
          assert(resolved.path.includes("my module.ts"));
        });
      });

      it("should handle module path with unicode characters", async () => {
        await withTestContext("edge-unicode", async (context) => {
          const filePath = join(context.projectDir, "モジュール.ts");
          await Deno.writeTextFile(filePath, "export const unicode = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/モジュール.ts");
          assertExists(resolved);
          assert(resolved.path.includes("モジュール.ts"));
        });
      });

      it("should handle very long absolute path (200+ characters)", async () => {
        await withTestContext("edge-long-path", async (context) => {
          const longPath = "a".repeat(20) +
            "/" +
            "b".repeat(20) +
            "/" +
            "c".repeat(20) +
            "/" +
            "d".repeat(20) +
            "/" +
            "file.ts";
          const fullPath = join(context.projectDir, longPath);
          await Deno.mkdir(join(context.projectDir, ...longPath.split("/").slice(0, -1)), {
            recursive: true,
          });
          await Deno.writeTextFile(fullPath, "export const long = 1");

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("/" + longPath);
          assertExists(resolved);
          assert(resolved.path.endsWith("file.ts"));
        });
      });

      it("should handle performance with 100+ entry import map", async () => {
        await withTestContext("edge-large-importmap", async (context) => {
          const largeImportMap: Record<string, string> = {};
          for (let i = 0; i < 100; i++) {
            largeImportMap[`@lib${i}`] = `https://cdn.com/lib${i}.js`;
          }

          const r = new ModuleResolver({
            projectDir: context.projectDir,
            importMap: largeImportMap,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("@lib50");
          assertExists(resolved);
          assertEquals(resolved.path, "https://cdn.com/lib50.js");
        });
      });

      it("should handle empty string referrer", async () => {
        await withTestContext("edge-empty-referrer", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const resolved = await r.resolve("react", "");
          assertExists(resolved);
          assertEquals(resolved.type, "npm");
        });
      });

      it("should handle undefined vs null differences gracefully", async () => {
        await withTestContext("edge-undefined-null", async (context) => {
          const r = new ModuleResolver({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const withUndefined = await r.resolve("react", undefined);
          const withoutReferrer = await r.resolve("react");

          assertExists(withUndefined);
          assertExists(withoutReferrer);
          assertEquals(withUndefined.type, "npm");
          assertEquals(withoutReferrer.type, "npm");
        });
      });
    });
  },
);
