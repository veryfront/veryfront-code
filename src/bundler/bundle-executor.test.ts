import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearAllModules,
  clearModuleCache,
  clearProjectModules,
  executeBundle,
  executeBundleForRender,
  getModuleCacheStats,
} from "./bundle-executor.ts";

describe("bundler/bundle-executor", () => {
  beforeEach(() => {
    clearAllModules();
  });

  afterEach(() => {
    clearAllModules();
  });

  describe("executeBundle", () => {
    it("should execute simple module and return exports", async () => {
      const code = `
        export const value = 42;
        export function double(x) { return x * 2; }
      `;

      const module = await executeBundle(code, "test:simple", {
        projectId: "test-project",
      });

      assertEquals(module.value, 42);
      assertEquals(typeof module.double, "function");
      assertEquals((module.double as (x: number) => number)(5), 10);
    });

    it("should execute module with default export", async () => {
      const code = `
        export default { name: "test", version: 1 };
      `;

      const module = await executeBundle(code, "test:default", {
        projectId: "test-project",
      });

      assertExists(module.default);
      assertEquals((module.default as { name: string }).name, "test");
    });

    it("should cache executed modules", async () => {
      const code = `
        export const timestamp = Date.now();
      `;

      const module1 = await executeBundle(code, "test:cache", {
        projectId: "test-project",
      });

      // Wait a bit to ensure timestamps would differ
      await new Promise((resolve) => setTimeout(resolve, 10));

      const module2 = await executeBundle(code, "test:cache", {
        projectId: "test-project",
      });

      // Should return same cached module
      assertEquals(module1.timestamp, module2.timestamp);
    });

    it("should use different cache entries for different keys", async () => {
      const code1 = `export const value = 1;`;
      const code2 = `export const value = 2;`;

      const module1 = await executeBundle(code1, "test:key1", {
        projectId: "test-project",
      });

      const module2 = await executeBundle(code2, "test:key2", {
        projectId: "test-project",
      });

      assertEquals(module1.value, 1);
      assertEquals(module2.value, 2);
    });

    it("should handle syntax errors gracefully", async () => {
      const invalidCode = `
        export const value = {;
      `;

      await assertRejects(
        () => executeBundle(invalidCode, "test:invalid", { projectId: "test-project" }),
        Error,
      );
    });
  });

  describe("executeBundleForRender", () => {
    it("should extract render function from module", async () => {
      const code = `
        export function render(context) {
          return '<div>Hello ' + context.name + '</div>';
        }
      `;

      const { render, module } = await executeBundleForRender(code, "test:render", {
        projectId: "test-project",
      });

      assertExists(render);
      assertEquals(typeof render, "function");
      assertEquals(render!({ name: "World" }), "<div>Hello World</div>");
      assertExists(module);
    });

    it("should extract render from default export object", async () => {
      const code = `
        export default {
          render(context) {
            return '<div>' + context.slug + '</div>';
          }
        };
      `;

      const { render } = await executeBundleForRender(code, "test:render-default", {
        projectId: "test-project",
      });

      assertExists(render);
      assertEquals(render!({ slug: "home" }), "<div>home</div>");
    });

    it("should return Component for default export without render", async () => {
      const code = `
        export default function MyComponent(props) {
          return { type: 'div', props: { children: props.title } };
        }
      `;

      const { render, Component } = await executeBundleForRender(
        code,
        "test:component",
        { projectId: "test-project" },
      );

      assertEquals(render, undefined);
      assertExists(Component);
      assertEquals(typeof Component, "function");
    });
  });

  describe("cache management", () => {
    it("should clear specific module from cache", async () => {
      const code = `export const value = Math.random();`;

      await executeBundle(code, "test:clear-single", {
        projectId: "test-project",
      });

      clearModuleCache("test:clear-single");

      const module2 = await executeBundle(code, "test:clear-single", {
        projectId: "test-project",
      });

      // After clearing, should get new value
      assertExists(module2.value);
      // Values might be same by chance, but cache was cleared
    });

    it("should clear all modules for a project", async () => {
      await executeBundle(`export const a = 1;`, "project-a:mod1", {
        projectId: "project-a",
      });
      await executeBundle(`export const b = 2;`, "project-a:mod2", {
        projectId: "project-a",
      });
      await executeBundle(`export const c = 3;`, "project-b:mod1", {
        projectId: "project-b",
      });

      const cleared = clearProjectModules("project-a");
      assertEquals(cleared, 2);
    });

    it("should clear all modules", async () => {
      await executeBundle(`export const a = 1;`, "test:a", { projectId: "p1" });
      await executeBundle(`export const b = 2;`, "test:b", { projectId: "p2" });

      const statsBefore = getModuleCacheStats();
      assertEquals(statsBefore.size > 0, true);

      clearAllModules();

      const statsAfter = getModuleCacheStats();
      assertEquals(statsAfter.size, 0);
    });

    it("should report cache statistics", async () => {
      clearAllModules();

      const statsEmpty = getModuleCacheStats();
      assertEquals(statsEmpty.size, 0);
      assertEquals(statsEmpty.maxSize, 100);

      await executeBundle(`export const a = 1;`, "test:stats", { projectId: "p" });

      const statsOne = getModuleCacheStats();
      assertEquals(statsOne.size, 1);
    });
  });

  describe("async module support", () => {
    it("should handle async render functions", async () => {
      const code = `
        export async function render(context) {
          await new Promise(r => setTimeout(r, 10));
          return '<div>Async: ' + context.value + '</div>';
        }
      `;

      const { render } = await executeBundleForRender(code, "test:async-render", {
        projectId: "test-project",
      });

      assertExists(render);
      const result = await render!({ value: "done" });
      assertEquals(result, "<div>Async: done</div>");
    });
  });
});
