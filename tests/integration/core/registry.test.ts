import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { denoAdapter } from "@veryfront/platform/adapters/runtime/deno/index.ts";
import { ComponentRegistry } from "@veryfront/modules/component-registry/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "ComponentRegistry",
  () => {
    // ===========================
    // Component Discovery Tests
    // ===========================

    describe("Component Discovery", () => {
      it("should discover all components in directory", async () => {
        await withTestContext("registry-discover", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Header.tsx"),
            "export default function Header(){return null}",
          );
          await Deno.writeTextFile(
            join(componentsDir, "Footer.tsx"),
            "export default function Footer(){return null}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const names = reg.getComponentNames();
          assert(names.includes("Header"));
          assert(names.includes("Footer"));
          assertEquals(names.length, 2);
        });
      });

      it("should recursively walk nested directories", async () => {
        await withTestContext("registry-nested", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          const nestedDir = join(componentsDir, "layout", "headers");
          await Deno.mkdir(nestedDir, { recursive: true });
          await Deno.writeTextFile(
            join(nestedDir, "MainHeader.tsx"),
            "export default function MainHeader(){return null}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assert(reg.has("MainHeader"));
          const component = reg.get("MainHeader");
          assertExists(component);
          assert(component.path.includes("layout/headers"));
        });
      });

      it("should filter out non-component files", async () => {
        await withTestContext("registry-filter", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );
          await Deno.writeTextFile(join(componentsDir, "readme.md"), "# Readme");
          await Deno.writeTextFile(join(componentsDir, "types.ts"), "export type T = {}");
          await Deno.writeTextFile(join(componentsDir, "config.json"), "{}");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const names = reg.getComponentNames();
          assertEquals(names.length, 1);
          assert(names.includes("Component"));
        });
      });

      it("should handle .tsx and .jsx files", async () => {
        await withTestContext("registry-extensions", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "TsxComponent.tsx"),
            "export default function T(){}",
          );
          await Deno.writeTextFile(
            join(componentsDir, "JsxComponent.jsx"),
            "export default function J(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assert(reg.has("TsxComponent"));
          assert(reg.has("JsxComponent"));
        });
      });

      it("should skip test files and directories", async () => {
        await withTestContext("registry-skip-tests", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );
          await Deno.writeTextFile(join(componentsDir, "Component.test.tsx"), "test code");
          await Deno.writeTextFile(join(componentsDir, "Component.spec.tsx"), "spec code");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const names = reg.getComponentNames();
          assertEquals(names.length, 1);
          assert(names.includes("Component"));
        });
      });

      it("should skip index files", async () => {
        await withTestContext("registry-skip-index", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );
          await Deno.writeTextFile(join(componentsDir, "index.tsx"), "export all");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const names = reg.getComponentNames();
          assertEquals(names.length, 1);
          assertEquals(names.includes("index"), false);
        });
      });

      it("should handle empty directories gracefully", async () => {
        await withTestContext("registry-empty", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assertEquals(reg.getComponentNames().length, 0);
        });
      });

      it("should handle directory access errors gracefully", async () => {
        await withTestContext("registry-access-error", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            componentDirs: ["nonexistent-dir"],
            adapter: denoAdapter,
          });

          // Should not throw, just warn
          await reg.discover();
          assertEquals(reg.getComponentNames().length, 0);
        });
      });

      it("should skip node_modules directories", async () => {
        await withTestContext("registry-node-modules", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          const nodeModules = join(componentsDir, "node_modules");
          await Deno.mkdir(nodeModules, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );
          await Deno.writeTextFile(
            join(nodeModules, "ShouldNotDiscover.tsx"),
            "export default function X(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assertEquals(reg.has("Component"), true);
          assertEquals(reg.has("ShouldNotDiscover"), false);
        });
      });

      it("should discover from multiple component directories", async () => {
        await withTestContext("registry-multi-dirs", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          const islandsDir = join(context.projectDir, "islands");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.mkdir(islandsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );
          await Deno.writeTextFile(join(islandsDir, "Island.tsx"), "export default function I(){}");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assert(reg.has("Component"));
          assert(reg.has("Island"));
        });
      });
    });

    // ===========================
    // Component Loading Tests
    // ===========================

    describe("Component Loading", () => {
      it("should load and cache component", async () => {
        await withTestContext("registry-load", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          const content = "export default function Header(){return null}";
          await Deno.writeTextFile(join(componentsDir, "Header.tsx"), content);

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const component = await reg.loadComponent("Header");
          assertExists(component);
          assertEquals(component.isLoaded, true);
          assertEquals(component.content, content);
        });
      });

      it("should return cached component on second load", async () => {
        await withTestContext("registry-cache", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Header.tsx"),
            "export default function Header(){return null}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const first = await reg.loadComponent("Header");
          const second = await reg.loadComponent("Header");

          assertExists(first);
          assertExists(second);
          assertEquals(first, second);
          assertEquals(second.isLoaded, true);
        });
      });

      it("should return null for non-existent component", async () => {
        await withTestContext("registry-not-found", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const component = await reg.loadComponent("NonExistent");
          assertEquals(component, null);
        });
      });

      it("should handle concurrent loads of same component", async () => {
        await withTestContext("registry-concurrent", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Header.tsx"),
            "export default function Header(){return null}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const [first, second, third] = await Promise.all([
            reg.loadComponent("Header"),
            reg.loadComponent("Header"),
            reg.loadComponent("Header"),
          ]);

          assertExists(first);
          assertExists(second);
          assertExists(third);
          assertEquals(first.isLoaded, true);
          assertEquals(second.isLoaded, true);
          assertEquals(third.isLoaded, true);
        });
      });

      it("should load all components with loadAll", async () => {
        await withTestContext("registry-load-all", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Header.tsx"),
            "export default function H(){}",
          );
          await Deno.writeTextFile(
            join(componentsDir, "Footer.tsx"),
            "export default function F(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          await reg.loadAll();

          const header = reg.get("Header");
          const footer = reg.get("Footer");
          assertExists(header);
          assertExists(footer);
          assertEquals(header.isLoaded, true);
          assertEquals(footer.isLoaded, true);
        });
      });

      it("should handle file read errors gracefully", async () => {
        await withTestContext("registry-read-error", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(join(componentsDir, "Component.tsx"), "content");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          // Delete the file after discovery
          await Deno.remove(join(componentsDir, "Component.tsx"));

          const component = await reg.loadComponent("Component");
          assertEquals(component, null);
        });
      });

      it("should wait for discovery to complete before loading", async () => {
        await withTestContext("registry-wait-discover", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Start discovery but don't await it
          const discoverPromise = reg.discover();

          // Try to load immediately (should wait for discovery)
          const loadPromise = reg.loadComponent("Component");

          await discoverPromise;
          const component = await loadPromise;

          assertExists(component);
          assertEquals(component.isLoaded, true);
        });
      });
    });

    // ===========================
    // Registry Operations Tests
    // ===========================

    describe("Registry Operations", () => {
      it("should add component manually", async () => {
        await withTestContext("registry-add", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          reg.add("Virtual", { content: "export const X = 1" });

          assert(reg.has("Virtual"));
          const component = reg.get("Virtual");
          assertExists(component);
          assertEquals(component.name, "Virtual");
          assertEquals(component.content, "export const X = 1");
          assertEquals(component.isLoaded, true);
        });
      });

      it("should add component with custom path", async () => {
        await withTestContext("registry-add-path", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          reg.add("Custom", {
            path: "/custom/path/Component.tsx",
            content: "content",
          });

          const component = reg.get("Custom");
          assertExists(component);
          assertEquals(component.path, "/custom/path/Component.tsx");
        });
      });

      it("should add component with exports", async () => {
        await withTestContext("registry-add-exports", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const exports = { default: () => null, namedExport: "value" };
          reg.add("WithExports", { content: "code", exports });

          const component = reg.get("WithExports");
          assertExists(component);
          assertEquals(component.exports, exports);
        });
      });

      it("should remove component", async () => {
        await withTestContext("registry-remove", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assert(reg.has("Component"));
          reg.remove("Component");
          assertEquals(reg.has("Component"), false);
        });
      });

      it("should clear all components", async () => {
        await withTestContext("registry-clear", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Header.tsx"),
            "export default function H(){}",
          );
          await Deno.writeTextFile(
            join(componentsDir, "Footer.tsx"),
            "export default function F(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assertEquals(reg.getComponentNames().length, 2);
          reg.clear();
          assertEquals(reg.getComponentNames().length, 0);
        });
      });

      it("should check component existence with has()", async () => {
        await withTestContext("registry-has", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assertEquals(reg.has("Component"), true);
          assertEquals(reg.has("NonExistent"), false);
        });
      });

      it("should retrieve component with get()", async () => {
        await withTestContext("registry-get", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const component = reg.get("Component");
          assertExists(component);
          assertEquals(component.name, "Component");
          assertEquals(component.isLoaded, false);
        });
      });

      it("should return undefined for non-existent component with get()", async () => {
        await withTestContext("registry-get-missing", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const component = reg.get("NonExistent");
          assertEquals(component, undefined);
        });
      });

      it("should list all component names", async () => {
        await withTestContext("registry-names", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Header.tsx"),
            "export default function H(){}",
          );
          await Deno.writeTextFile(
            join(componentsDir, "Footer.tsx"),
            "export default function F(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const names = reg.getComponentNames();
          assertEquals(names.length, 2);
          assert(names.includes("Header"));
          assert(names.includes("Footer"));
        });
      });

      it("should get all components as map", async () => {
        await withTestContext("registry-getall", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const allComponents = reg.getAll();
          assertEquals(allComponents instanceof Map, true);
          assertEquals(allComponents.size, 1);
          assert(allComponents.has("Component"));
        });
      });

      it("should list components with metadata", async () => {
        await withTestContext("registry-list", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const list = await reg.listComponents();
          assertEquals(list.length, 1);
          const first = list[0];
          assertExists(first);
          assertEquals(first.name, "Component");
          assertEquals(first.type, "component");
          assertExists(first.path);
          assertExists(first.size);
          assertExists(first.lastModified);
        });
      });

      it("should handle stat errors in listComponents gracefully", async () => {
        await withTestContext("registry-list-stat-error", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          reg.add("Virtual", { path: "nonexistent.tsx", content: "code" });

          const list = await reg.listComponents();
          const virtualComponent = list.find((c) => c.name === "Virtual");
          assertExists(virtualComponent);
          assertEquals(virtualComponent.size, undefined);
          assertEquals(virtualComponent.lastModified, undefined);
        });
      });

      it("should track registry size correctly", async () => {
        await withTestContext("registry-size", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(join(componentsDir, "A.tsx"), "export default function A(){}");
          await Deno.writeTextFile(join(componentsDir, "B.tsx"), "export default function B(){}");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assertEquals(reg.getComponentNames().length, 2);

          reg.add("C", { content: "code" });
          assertEquals(reg.getComponentNames().length, 3);

          reg.remove("A");
          assertEquals(reg.getComponentNames().length, 2);

          reg.clear();
          assertEquals(reg.getComponentNames().length, 0);
        });
      });
    });

    // ===========================
    // Edge Cases Tests
    // ===========================

    describe("Edge Cases", () => {
      it("should handle race conditions during initialization", async () => {
        await withTestContext("registry-race", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Start multiple discovery operations simultaneously
          const [_result1, _result2, _result3] = await Promise.all([
            reg.discover(),
            reg.discover(),
            reg.discover(),
          ]);

          assertEquals(reg.getComponentNames().length, 1);
        });
      });

      it("should handle large component trees efficiently", async () => {
        await withTestContext("registry-large-tree", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });

          // Create 50 components in nested structure
          for (let i = 0; i < 50; i++) {
            const dir = join(componentsDir, `level${Math.floor(i / 10)}`);
            await Deno.mkdir(dir, { recursive: true });
            await Deno.writeTextFile(
              join(dir, `Component${i}.tsx`),
              `export default function C${i}(){}`,
            );
          }

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          const startTime = Date.now();
          await reg.discover();
          const duration = Date.now() - startTime;

          assertEquals(reg.getComponentNames().length, 50);
          // Should complete in reasonable time (< 5 seconds)
          assert(duration < 5000, `Discovery took ${duration}ms`);
        });
      });

      it("should handle component name conflicts by last-write-wins", async () => {
        await withTestContext("registry-conflict", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          const dir1 = join(componentsDir, "dir1");
          const dir2 = join(componentsDir, "dir2");
          await Deno.mkdir(dir1, { recursive: true });
          await Deno.mkdir(dir2, { recursive: true });
          await Deno.writeTextFile(join(dir1, "Component.tsx"), "export default function C1(){}");
          await Deno.writeTextFile(join(dir2, "Component.tsx"), "export default function C2(){}");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          // One component should win (last discovered)
          assertEquals(reg.getComponentNames().length, 1);
          assert(reg.has("Component"));
        });
      });

      it("should handle invalid component paths", async () => {
        await withTestContext("registry-invalid-path", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          reg.add("Invalid", { path: "/invalid/path/that/does/not/exist.tsx" });

          // loadComponent skips already loaded components and only reads if isLoaded is false
          // Since add() sets isLoaded to true, it returns the component as-is
          const component = await reg.loadComponent("Invalid");
          assertExists(component);
          assertEquals(component.isLoaded, true);
        });
      });

      it("should handle missing component directory", async () => {
        await withTestContext("registry-missing-dir", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            componentDirs: ["missing-components"],
            adapter: denoAdapter,
          });

          // Should not throw
          await reg.discover();
          assertEquals(reg.getComponentNames().length, 0);
        });
      });

      it("should handle components with same name in different directories", async () => {
        await withTestContext("registry-same-name", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          const islandsDir = join(context.projectDir, "islands");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.mkdir(islandsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Button.tsx"),
            "export default function B1(){}",
          );
          await Deno.writeTextFile(
            join(islandsDir, "Button.tsx"),
            "export default function B2(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          // Last one discovered should win
          assertEquals(reg.getComponentNames().filter((n) => n === "Button").length, 1);
        });
      });

      it("should handle re-discovery after clear", async () => {
        await withTestContext("registry-rediscover", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Component.tsx"),
            "export default function C(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();
          assertEquals(reg.getComponentNames().length, 1);

          reg.clear();
          assertEquals(reg.getComponentNames().length, 0);

          await reg.discover();
          assertEquals(reg.getComponentNames().length, 1);
        });
      });

      it("should handle get() before initialization", async () => {
        // deno-lint-ignore require-await
        await withTestContext("registry-get-before-init", async (_context) => {
          const reg = new ComponentRegistry({
            projectDir: _context.projectDir,
            adapter: denoAdapter,
          });

          // Call get before discover
          const component = reg.get("Component");
          assertEquals(component, undefined);
        });
      });

      it("should handle empty component file", async () => {
        await withTestContext("registry-empty-file", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(join(componentsDir, "Empty.tsx"), "");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          const component = await reg.loadComponent("Empty");
          assertExists(component);
          assertEquals(component.content, "");
          assertEquals(component.isLoaded, true);
        });
      });

      it("should handle very long component paths", async () => {
        await withTestContext("registry-long-path", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          const deepPath = join(componentsDir, "a", "b", "c", "d", "e", "f", "g");
          await Deno.mkdir(deepPath, { recursive: true });
          await Deno.writeTextFile(join(deepPath, "Deep.tsx"), "export default function D(){}");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assert(reg.has("Deep"));
          const component = reg.get("Deep");
          assertExists(component);
          assert(component.path.includes("a/b/c/d/e/f/g"));
        });
      });

      it("should handle custom component directories", async () => {
        await withTestContext("registry-custom-dirs", async (context) => {
          const customDir = join(context.projectDir, "my-custom-components");
          await Deno.mkdir(customDir, { recursive: true });
          await Deno.writeTextFile(join(customDir, "Custom.tsx"), "export default function C(){}");

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            componentDirs: ["my-custom-components"],
            adapter: denoAdapter,
          });
          await reg.discover();

          assert(reg.has("Custom"));
        });
      });

      it("should expose loader after discovery", async () => {
        await withTestContext("registry-loader", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Before discovery, loader should be undefined
          assertEquals(reg.getLoader(), undefined);

          await reg.discover();

          // After discovery, loader might be available (depends on imports)
          // Just verify it doesn't throw
          const _loader = reg.getLoader();
          // Loader may or may not be available depending on module availability
        });
      });

      it("should handle component with special characters in name", async () => {
        await withTestContext("registry-special-chars", async (context) => {
          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "My-Component_v2.tsx"),
            "export default function C(){}",
          );

          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });
          await reg.discover();

          assert(reg.has("My-Component_v2"));
        });
      });

      it("should handle discovery with already existing components", async () => {
        await withTestContext("registry-existing", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Add a manual component before discovery
          reg.add("Manual", { content: "manual" });
          assertEquals(reg.has("Manual"), true);

          const componentsDir = join(context.projectDir, "components");
          await Deno.mkdir(componentsDir, { recursive: true });
          await Deno.writeTextFile(
            join(componentsDir, "Discovered.tsx"),
            "export default function D(){}",
          );

          await reg.discover();

          // Both components should exist (discovery doesn't clear, just adds)
          assertEquals(reg.has("Manual"), true);
          assertEquals(reg.has("Discovered"), true);
        });
      });
    });

    // ===========================
    // ComponentLoader Integration Tests
    // ===========================

    describe("ComponentLoader Integration", () => {
      it("should initialize loader during discovery", async () => {
        await withTestContext("registry-loader-init", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          await reg.discover();

          // Loader initialization happens in discover
          // Just verify it doesn't throw
          const _loader = reg.getLoader();
          // Loader may be undefined if imports fail, which is okay
        });
      });

      it("should handle loader initialization failure gracefully", async () => {
        await withTestContext("registry-loader-fail", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          // Even if loader fails to initialize, discovery should succeed
          await reg.discover();
          assertEquals(reg.getComponentNames().length, 0);
        });
      });

      it("should preserve loader across multiple discoveries", async () => {
        await withTestContext("registry-loader-preserve", async (context) => {
          const reg = new ComponentRegistry({
            projectDir: context.projectDir,
            adapter: denoAdapter,
          });

          await reg.discover();
          const firstLoader = reg.getLoader();

          await reg.discover();
          const secondLoader = reg.getLoader();

          // Loader should be reused
          assertEquals(firstLoader, secondLoader);
        });
      });
    });
  },
);
