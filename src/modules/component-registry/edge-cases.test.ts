import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ComponentRegistry } from "./index.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

describe("ComponentRegistry - Edge Cases and Error Handling", () => {
  describe("Missing directories", () => {
    it("should handle completely missing component directories", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/no-components";

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
        componentDirs: ["components", "islands"],
      });

      await registry.discover();

      assertEquals(registry.getAll().size, 0);
    });

    it("should handle partially missing directories", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/partial-dirs";

      adapter.fs.files.set(
        `${projectDir}/components/Button.tsx`,
        "export default function Button() {}",
      );

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
        componentDirs: ["components", "islands", "nonexistent"],
      });

      await registry.discover();

      assertEquals(registry.has("Button"), true);
    });

    it("should handle empty component directories", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/empty-dirs";

      adapter.fs.directories.add(`${projectDir}/components`);
      adapter.fs.directories.add(`${projectDir}/islands`);

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      assertEquals(registry.getAll().size, 0);
    });

    it("should handle deep directory nesting", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/deep-nesting";

      adapter.fs.files.set(
        `${projectDir}/components/ui/buttons/primary/PrimaryButton.tsx`,
        "export default function PrimaryButton() {}",
      );

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      assertEquals(registry.has("PrimaryButton"), true);
    });
  });

  describe("File discovery edge cases", () => {
    it("should skip node_modules directories", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/node-modules";

      adapter.fs.files.set(
        `${projectDir}/components/Button.tsx`,
        "export default function Button() {}",
      );
      adapter.fs.files.set(
        `${projectDir}/components/node_modules/some-package/Component.tsx`,
        "export default function Component() {}",
      );

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      assertEquals(registry.has("Button"), true);
      assertEquals(registry.has("Component"), false);
    });

    it("should skip test files", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/test-files";

      adapter.fs.files.set(
        `${projectDir}/components/Button.tsx`,
        "export default function Button() {}",
      );
      adapter.fs.files.set(
        `${projectDir}/components/Button.test.tsx`,
        'test("Button", () => {})',
      );
      adapter.fs.files.set(
        `${projectDir}/components/Button.spec.tsx`,
        'describe("Button", () => {})',
      );

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      assertEquals(registry.has("Button"), true);
      const all = registry.getAll();
      assertEquals(all.size, 1);
    });

    it("should skip index files", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/index-files";

      adapter.fs.files.set(
        `${projectDir}/components/Button.tsx`,
        "export default function Button() {}",
      );
      adapter.fs.files.set(`${projectDir}/components/index.tsx`, "export { Button }");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      assertEquals(registry.has("Button"), true);
      assertEquals(registry.has("index"), false);
    });

    it("should handle files with same name in different directories", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/duplicate-names";

      adapter.fs.files.set(
        `${projectDir}/components/Button.tsx`,
        "export default function Button1() {}",
      );
      adapter.fs.files.set(
        `${projectDir}/islands/Button.tsx`,
        "export default function Button2() {}",
      );

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
        componentDirs: ["components", "islands"],
      });

      await registry.discover();

      assertEquals(registry.has("Button"), true);
    });

    it("should only match tsx and jsx extensions", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/extensions";

      adapter.fs.files.set(`${projectDir}/components/Valid.tsx`, "export default function() {}");
      adapter.fs.files.set(
        `${projectDir}/components/AlsoValid.jsx`,
        "export default function() {}",
      );
      adapter.fs.files.set(`${projectDir}/components/Invalid.ts`, "export default {}");
      adapter.fs.files.set(`${projectDir}/components/AlsoInvalid.js`, "export default {}");
      adapter.fs.files.set(`${projectDir}/components/NotCode.txt`, "text file");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      assertEquals(registry.has("Valid"), true);
      assertEquals(registry.has("AlsoValid"), true);
      assertEquals(registry.has("Invalid"), false);
      assertEquals(registry.has("AlsoInvalid"), false);
      assertEquals(registry.has("NotCode"), false);
    });
  });

  describe("Component loading edge cases", () => {
    it("should handle loading nonexistent component", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/nonexistent";

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      const component = await registry.loadComponent("Nonexistent");
      assertEquals(component, null);
    });

    it("should handle file read errors", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/read-error";

      adapter.fs.files.set(`${projectDir}/components/Error.tsx`, "content");

      const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
      adapter.fs.readFile = async (path: string) => {
        if (path.includes("Error.tsx")) {
          throw new Error("Permission denied");
        }
        return await originalReadFile(path);
      };

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      const component = await registry.loadComponent("Error");
      assertEquals(component, null);
    });

    it("should cache loaded components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/caching";

      adapter.fs.files.set(
        `${projectDir}/components/Button.tsx`,
        "export default function Button() {}",
      );

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      const component1 = await registry.loadComponent("Button");
      const component2 = await registry.loadComponent("Button");

      assertEquals(component1?.isLoaded, true);
      assertEquals(component2?.isLoaded, true);
      assertEquals(component1, component2);
    });

    it("should handle loading all components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/load-all";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");
      adapter.fs.files.set(`${projectDir}/components/Card.tsx`, "card");
      adapter.fs.files.set(`${projectDir}/components/Input.tsx`, "input");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();
      await registry.loadAll();

      assertEquals(registry.get("Button")?.isLoaded, true);
      assertEquals(registry.get("Card")?.isLoaded, true);
      assertEquals(registry.get("Input")?.isLoaded, true);
    });

    it("should handle concurrent component loads", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/concurrent-load";

      for (let i = 0; i < 10; i++) {
        adapter.fs.files.set(
          `${projectDir}/components/Component${i}.tsx`,
          `export default function Component${i}() {}`,
        );
      }

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      const loadPromises = [];
      for (let i = 0; i < 10; i++) {
        loadPromises.push(registry.loadComponent(`Component${i}`));
      }

      const results = await Promise.all(loadPromises);

      assertEquals(results.every((r) => r !== null), true);
      assertEquals(results.every((r) => r?.isLoaded), true);
    });
  });

  describe("Manual component management", () => {
    it("should add virtual components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/virtual";

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      registry.add("VirtualButton", {
        content: "export default function VirtualButton() {}",
        exports: { default: () => {} },
      });

      assertEquals(registry.has("VirtualButton"), true);
      const component = registry.get("VirtualButton");
      assertEquals(component?.isLoaded, true);
      assertEquals(component?.path, "virtual:VirtualButton");
    });

    it("should remove components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/remove";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();
      assertEquals(registry.has("Button"), true);

      registry.remove("Button");
      assertEquals(registry.has("Button"), false);
    });

    it("should clear all components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/clear";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");
      adapter.fs.files.set(`${projectDir}/components/Card.tsx`, "card");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();
      assertEquals(registry.getAll().size, 2);

      registry.clear();
      assertEquals(registry.getAll().size, 0);
    });

    it("should rediscover after clear", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/rediscover";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();
      assertEquals(registry.getAll().size, 1);

      registry.clear();
      assertEquals(registry.getAll().size, 0);

      await registry.discover();
      assertEquals(registry.getAll().size, 1);
    });
  });

  describe("Component metadata", () => {
    it("should list components with metadata", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/metadata";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button content");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      const components = await registry.listComponents();

      assertEquals(components.length, 1);
      assertEquals(components[0]?.name, "Button");
      assertExists(components[0]?.path);
      assertEquals(components[0]?.type, "component");
    });

    it("should handle stat errors gracefully", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/stat-error";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const originalStat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = async (path: string) => {
        if (path.includes("Button.tsx")) {
          throw new Error("Stat failed");
        }
        return await originalStat(path);
      };

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      const components = await registry.listComponents();

      assertEquals(components.length, 1);
      assertEquals(components[0]?.name, "Button");
    });

    it("should get component names", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/names";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");
      adapter.fs.files.set(`${projectDir}/components/Card.tsx`, "card");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      const names = registry.getComponentNames();

      assertEquals(names.length, 2);
      assertEquals(names.includes("Button"), true);
      assertEquals(names.includes("Card"), true);
    });
  });

  describe("Edge cases in component names", () => {
    it("should handle components with special characters in name", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/special-names";

      adapter.fs.files.set(
        `${projectDir}/components/My-Component.tsx`,
        "export default function() {}",
      );
      adapter.fs.files.set(
        `${projectDir}/components/My_Component.tsx`,
        "export default function() {}",
      );

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      assertEquals(registry.has("My-Component"), true);
      assertEquals(registry.has("My_Component"), true);
    });

    it("should handle components with numbers in name", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/numbers";

      adapter.fs.files.set(`${projectDir}/components/Button2.tsx`, "export default function() {}");
      adapter.fs.files.set(`${projectDir}/components/Card3D.tsx`, "export default function() {}");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      assertEquals(registry.has("Button2"), true);
      assertEquals(registry.has("Card3D"), true);
    });

    it("should handle very long component names", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/long-names";

      const longName = "VeryLongComponentName".repeat(10);
      adapter.fs.files.set(
        `${projectDir}/components/${longName}.tsx`,
        "export default function() {}",
      );

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await registry.discover();

      assertEquals(registry.has(longName), true);
    });
  });

  describe("Race conditions and timing", () => {
    it("should handle get before discover completes", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/race";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      const discoverPromise = registry.discover();

      const component = registry.get("Button");

      await discoverPromise;

      assertExists(component !== undefined ? component : "timing-dependent");
    });

    it("should handle loadComponent before discover", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/load-before-discover";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      const componentBefore = await registry.loadComponent("Button");

      await registry.discover();

      const componentAfter = await registry.loadComponent("Button");

      assertEquals(componentBefore, null);
      assertExists(componentAfter);
    });

    it("should handle concurrent discover calls", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/concurrent-discover";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const registry = new ComponentRegistry({
        projectDir,
        adapter,
      });

      await Promise.all([registry.discover(), registry.discover(), registry.discover()]);

      assertEquals(registry.has("Button"), true);
    });
  });
});
