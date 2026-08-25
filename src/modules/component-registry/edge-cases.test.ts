import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry/general.ts";
import { ComponentRegistry } from "./index.ts";

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

      const registry = new ComponentRegistry({ projectDir, adapter });

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

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      assertEquals(registry.has("PrimaryButton"), true);
    });

    it("should propagate operational directory read errors", async () => {
      const adapter = createMockAdapter();
      const failure = new Error("Directory backend unavailable");
      adapter.fs.readDir = () => {
        throw failure;
      };
      const registry = new ComponentRegistry({
        projectDir: "/test/read-dir-error",
        componentDirs: ["components"],
        adapter,
      });

      const error = await assertRejects(() => registry.discover());

      assertEquals(error, failure);
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

      const registry = new ComponentRegistry({ projectDir, adapter });

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

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      assertEquals(registry.has("Button"), true);
      assertEquals(registry.getAll().size, 1);
    });

    it("should skip index files", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/index-files";

      adapter.fs.files.set(
        `${projectDir}/components/Button.tsx`,
        "export default function Button() {}",
      );
      adapter.fs.files.set(
        `${projectDir}/components/index.tsx`,
        "export { Button }",
      );

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      assertEquals(registry.has("Button"), true);
      assertEquals(registry.has("index"), false);
    });

    it("should reject files with the same component name", async () => {
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

      await assertRejects(
        () => registry.discover(),
        Error,
        "Component name 'Button' is already registered",
      );
      assertEquals(registry.getAll().size, 0);
    });

    it("should only match tsx and jsx extensions", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/extensions";

      adapter.fs.files.set(
        `${projectDir}/components/Valid.tsx`,
        "export default function() {}",
      );
      adapter.fs.files.set(
        `${projectDir}/components/AlsoValid.jsx`,
        "export default function() {}",
      );
      adapter.fs.files.set(
        `${projectDir}/components/Invalid.ts`,
        "export default {}",
      );
      adapter.fs.files.set(
        `${projectDir}/components/AlsoInvalid.js`,
        "export default {}",
      );
      adapter.fs.files.set(`${projectDir}/components/NotCode.txt`, "text file");

      const registry = new ComponentRegistry({ projectDir, adapter });

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

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      const component = await registry.loadComponent("Nonexistent");
      assertEquals(component, null);
    });

    it("should propagate operational file read errors", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/read-error";

      adapter.fs.files.set(`${projectDir}/components/Error.tsx`, "content");
      const failure = {
        code: "ENOENT",
        message: "Storage backend unavailable",
      };

      const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
      adapter.fs.readFile = async (path: string) => {
        if (path.includes("Error.tsx")) {
          throw failure;
        }
        return await originalReadFile(path);
      };

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      const error = await assertRejects(() => registry.loadComponent("Error"));
      assertEquals(error, failure);
    });

    it("should cache loaded components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/caching";

      adapter.fs.files.set(
        `${projectDir}/components/Button.tsx`,
        "export default function Button() {}",
      );

      let reads = 0;
      const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
      adapter.fs.readFile = (path: string) => {
        if (path.includes("Button.tsx")) reads++;
        return originalReadFile(path);
      };

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      const component1 = await registry.loadComponent("Button");
      const component2 = await registry.loadComponent("Button");

      assertEquals(component1?.isLoaded, true);
      assertEquals(component2?.isLoaded, true);
      assertEquals(reads, 1, "second load must be served from the cache, not re-read from disk");
      assertStrictEquals(
        component1,
        component2,
        "cached load must return the same component instance",
      );
    });

    it("should handle loading all components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/load-all";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");
      adapter.fs.files.set(`${projectDir}/components/Card.tsx`, "card");
      adapter.fs.files.set(`${projectDir}/components/Input.tsx`, "input");

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();
      await registry.loadAll();

      assertEquals(registry.get("Button")?.isLoaded, true);
      assertEquals(registry.get("Card")?.isLoaded, true);
      assertEquals(registry.get("Input")?.isLoaded, true);
    });

    it("should wait for in-flight discovery before loading all components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/load-all-during-discovery";
      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");
      const registry = new ComponentRegistry({ projectDir, adapter });

      const discovery = registry.discover();
      const loading = registry.loadAll();
      await Promise.all([discovery, loading]);

      assertEquals(registry.get("Button")?.isLoaded, true);
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

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => registry.loadComponent(`Component${i}`)),
      );

      assertEquals(results.every((r) => r !== null), true);
      assertEquals(results.every((r) => r?.isLoaded), true);
    });
  });

  describe("Manual component management", () => {
    it("should add virtual components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/virtual";

      const registry = new ComponentRegistry({ projectDir, adapter });

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

    it("should load path-only manual components from the adapter", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/manual-path";
      const componentPath = `${projectDir}/external/Button.tsx`;
      adapter.fs.files.set(componentPath, "export default function Button() {}");
      const registry = new ComponentRegistry({ projectDir, adapter });

      registry.add("Button", { path: componentPath });

      assertEquals(registry.get("Button")?.isLoaded, false);
      const component = await registry.loadComponent("Button");
      assertEquals(component?.content, "export default function Button() {}");
      assertEquals(component?.isLoaded, true);
    });

    it("should remove components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/remove";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const registry = new ComponentRegistry({ projectDir, adapter });

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

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();
      assertEquals(registry.getAll().size, 2);

      registry.clear();
      assertEquals(registry.getAll().size, 0);
    });

    it("should rediscover after clear", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/rediscover";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();
      assertEquals(registry.getAll().size, 1);

      registry.clear();
      assertEquals(registry.getAll().size, 0);

      await registry.discover();
      assertEquals(registry.getAll().size, 1);
    });

    it("should reconcile discovered files while preserving manual components", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/reconcile";
      const buttonPath = `${projectDir}/components/Button.tsx`;
      adapter.fs.files.set(buttonPath, "button");

      const registry = new ComponentRegistry({ projectDir, adapter });
      registry.add("Manual", { content: "manual" });
      await registry.discover();

      adapter.fs.files.delete(buttonPath);
      adapter.fs.files.set(`${projectDir}/components/Card.tsx`, "card");
      await registry.discover();

      assertEquals(registry.has("Button"), false);
      assertEquals(registry.has("Card"), true);
      assertEquals(registry.has("Manual"), true);
    });

    it("should reload changed component source after discovery", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/reload-discovered";
      const componentPath = `${projectDir}/components/Button.tsx`;
      adapter.fs.files.set(componentPath, "version one");
      const registry = new ComponentRegistry({ projectDir, adapter });
      await registry.discover();
      assertEquals((await registry.loadComponent("Button"))?.content, "version one");

      adapter.fs.files.set(componentPath, "version two");
      await registry.discover();

      assertEquals((await registry.loadComponent("Button"))?.content, "version two");
    });
  });

  describe("Component metadata", () => {
    it("should keep discovered component metadata immutable", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/immutable-metadata";
      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "inside");
      adapter.fs.files.set("/outside/Button.tsx", "outside");
      const registry = new ComponentRegistry({ projectDir, adapter });
      await registry.discover();

      const component = registry.get("Button");
      assertExists(component);
      assertEquals(Reflect.set(component, "path", "/outside/Button.tsx"), false);

      const loaded = await registry.loadComponent("Button");
      assertEquals(loaded?.content, "inside");
    });

    it("should list components with metadata", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/metadata";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button content");

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      const components = await registry.listComponents();

      assertEquals(components.length, 1);
      assertEquals(components[0]?.name, "Button");
      assertEquals(
        components[0]?.path,
        `${projectDir}/components/Button.tsx`,
        "listed path is the discovered component path",
      );
      assertEquals(components[0]?.type, "component");
      assertEquals(components[0]?.size, 14, "size comes from adapter.fs.stat");
      const lastModified = components[0]?.lastModified;
      assertExists(lastModified, "lastModified comes from stat.mtime");
      assertEquals(
        Number.isNaN(Date.parse(lastModified)),
        false,
        "lastModified is an ISO timestamp",
      );
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

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      const components = await registry.listComponents();

      assertEquals(components.length, 1);
      assertEquals(components[0]?.name, "Button");
      assertEquals(components[0]?.size, undefined, "stat failure omits size");
      assertEquals(components[0]?.lastModified, undefined, "stat failure omits lastModified");
    });

    it("should get component names", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/names";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");
      adapter.fs.files.set(`${projectDir}/components/Card.tsx`, "card");

      const registry = new ComponentRegistry({ projectDir, adapter });

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

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      assertEquals(registry.has("My-Component"), true);
      assertEquals(registry.has("My_Component"), true);
    });

    it("should handle components with numbers in name", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/numbers";

      adapter.fs.files.set(
        `${projectDir}/components/Button2.tsx`,
        "export default function() {}",
      );
      adapter.fs.files.set(
        `${projectDir}/components/Card3D.tsx`,
        "export default function() {}",
      );

      const registry = new ComponentRegistry({ projectDir, adapter });

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

      const registry = new ComponentRegistry({ projectDir, adapter });

      await registry.discover();

      assertEquals(registry.has(longName), true);
    });
  });

  describe("Race conditions and timing", () => {
    it("should handle get before discover completes", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/race";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const registry = new ComponentRegistry({ projectDir, adapter });

      const discoverPromise = registry.discover();
      const component = registry.get("Button");
      assertEquals(component, undefined, "get() before discover resolves must return undefined");

      await discoverPromise;

      assertEquals(
        registry.get("Button")?.path,
        `${projectDir}/components/Button.tsx`,
        "get() after discover resolves must return the discovered component",
      );
    });

    it("should handle loadComponent before discover", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/load-before-discover";

      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      const registry = new ComponentRegistry({ projectDir, adapter });

      const componentBefore = await registry.loadComponent("Button");

      await registry.discover();

      const componentAfter = await registry.loadComponent("Button");

      assertEquals(componentBefore, null);
      assertExists(componentAfter);
    });

    it("should not repopulate components when clear() runs during discovery", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/clear-during-discover";
      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      let releaseReadDir = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseReadDir = resolve;
      });
      const originalReadDir = adapter.fs.readDir.bind(adapter.fs);
      adapter.fs.readDir = async function* (path: string) {
        await gate;
        yield* originalReadDir(path);
      };

      const registry = new ComponentRegistry({ projectDir, adapter });
      const discovery = registry.discover();
      registry.clear();
      releaseReadDir();
      await discovery;

      assertEquals(
        registry.getAll().size,
        0,
        "discovery finishing after clear() must not restore cleared components",
      );
    });

    it("should preserve a removal made after discovery collected the component", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/remove-during-discover";
      const componentsDir = `${projectDir}/components`;
      adapter.fs.files.set(`${componentsDir}/Button.tsx`, "button");

      let releaseReadDir = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseReadDir = resolve;
      });
      let componentCollected = () => {};
      const collected = new Promise<void>((resolve) => {
        componentCollected = resolve;
      });
      const originalReadDir = adapter.fs.readDir.bind(adapter.fs);
      adapter.fs.readDir = async function* (path: string) {
        for await (const entry of originalReadDir(path)) {
          yield entry;
          if (path === componentsDir && entry.name === "Button.tsx") {
            componentCollected();
            await gate;
          }
        }
      };

      const registry = new ComponentRegistry({ projectDir, adapter });
      const discovery = registry.discover();
      await collected;
      registry.remove("Button");
      releaseReadDir();
      await discovery;

      assertEquals(
        registry.has("Button"),
        false,
        "discovery must not resurrect a component removed after it was collected",
      );
    });

    it("should not overwrite an entry replaced while its source was being read", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/replace-during-load";
      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "discovered content");

      let releaseRead = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let readStarted = () => {};
      const readFileStarted = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
      adapter.fs.readFile = async (path: string) => {
        readStarted();
        await gate;
        return await originalReadFile(path);
      };

      const registry = new ComponentRegistry({ projectDir, adapter });
      await registry.discover();

      const loading = registry.loadComponent("Button");
      await readFileStarted;
      registry.add("Button", { content: "manual content", exports: { default: () => {} } });
      releaseRead();
      const loaded = await loading;

      assertEquals(
        registry.get("Button")?.content,
        "manual content",
        "a manual entry added during load must not be overwritten by stale file content",
      );
      assertEquals(loaded?.content, "manual content");
    });

    it("should load a replacement entry when the stale source disappears during its read", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/replace-after-stale-read-failure";
      const componentPath = `${projectDir}/components/Button.tsx`;
      adapter.fs.files.set(componentPath, "discovered content");

      let releaseRead = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let readStarted = () => {};
      const readFileStarted = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      adapter.fs.readFile = async () => {
        readStarted();
        await gate;
        throw FILE_NOT_FOUND.create({
          detail: "The stale component source disappeared",
          context: { operation: "readFile" },
        });
      };

      const registry = new ComponentRegistry({ projectDir, adapter });
      await registry.discover();

      const loading = registry.loadComponent("Button");
      await readFileStarted;
      registry.add("Button", { content: "replacement content", exports: { default: () => {} } });
      releaseRead();
      const loaded = await loading;

      assertEquals(loaded?.content, "replacement content");
      assertEquals(registry.get("Button")?.content, "replacement content");
    });

    it("should not restore a component removed while its source was being read", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/remove-during-load";
      adapter.fs.files.set(`${projectDir}/components/Button.tsx`, "button");

      let releaseRead = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let readStarted = () => {};
      const readFileStarted = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
      adapter.fs.readFile = async (path: string) => {
        readStarted();
        await gate;
        return await originalReadFile(path);
      };

      const registry = new ComponentRegistry({ projectDir, adapter });
      await registry.discover();

      const loading = registry.loadComponent("Button");
      await readFileStarted;
      registry.remove("Button");
      releaseRead();
      const loaded = await loading;

      assertEquals(loaded, null, "load finishing after remove() must not return the removed entry");
      assertEquals(
        registry.has("Button"),
        false,
        "load finishing after remove() must not restore the removed entry",
      );
    });

    it("should handle concurrent discover calls", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/concurrent-discover";
      const componentsDir = `${projectDir}/components`;

      adapter.fs.files.set(`${componentsDir}/Button.tsx`, "button");
      const originalReadDir = adapter.fs.readDir.bind(adapter.fs);
      let componentDirectoryReads = 0;
      adapter.fs.readDir = (path: string) => {
        if (path === componentsDir) componentDirectoryReads++;
        return originalReadDir(path);
      };

      const registry = new ComponentRegistry({ projectDir, adapter });

      await Promise.all([registry.discover(), registry.discover(), registry.discover()]);

      assertEquals(registry.has("Button"), true);
      assertEquals(componentDirectoryReads, 1);
    });
  });
});
