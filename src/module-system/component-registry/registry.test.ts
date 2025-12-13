import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { ComponentRegistry } from "./registry.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { FileSystemAdapter } from "@veryfront/platform/adapters/base.ts";

// Create a mock filesystem adapter for testing
function createMockAdapter(files: Map<string, string> = new Map()): RuntimeAdapter {
  const mockFs: FileSystemAdapter = {
    readFile: async (path: string) => {
      const content = files.get(path);
      if (!content) {
        const error = new Error(`File not found: ${path}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return content;
    },
    readDir: async function* (path: string) {
      const entries: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];

      // Get all files in this directory
      for (const [filePath] of files) {
        if (filePath.startsWith(path + "/")) {
          const relativePath = filePath.substring(path.length + 1);
          const parts = relativePath.split("/");
          const name = parts[0];

          if (!name) continue;

          // Check if this is a direct child
          if (parts.length === 1) {
            entries.push({ name, isFile: true, isDirectory: false });
          } else if (!entries.some(e => e.name === name)) {
            entries.push({ name, isFile: false, isDirectory: true });
          }
        }
      }

      for (const entry of entries) {
        yield entry;
      }
    },
    stat: async (path: string) => {
      const content = files.get(path);
      if (!content) {
        const error = new Error(`File not found: ${path}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return {
        size: content.length,
        mtime: new Date("2024-01-01T00:00:00Z"),
        isFile: () => true,
        isDirectory: () => false,
      };
    },
    exists: async (path: string) => files.has(path),
    writeFile: async () => {},
    mkdir: async () => {},
    remove: async () => {},
    readTextFile: async (path: string) => {
      const content = files.get(path);
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },
  } as unknown as FileSystemAdapter;

  return {
    fs: mockFs,
    platform: "mock",
    id: "mock",
    name: "Mock Adapter",
    capabilities: {},
    features: {},
    version: "1.0.0",
    http: {} as any,
    env: {} as any,
    server: {} as any,
    serve: async () => ({} as any),
  } as unknown as RuntimeAdapter;
}

describe("ComponentRegistry", () => {
  describe("constructor", () => {
    it("should create registry with default component directories", () => {
      const adapter = createMockAdapter();
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      assertExists(registry);
    });

    it("should create registry with custom component directories", () => {
      const adapter = createMockAdapter();
      const registry = new ComponentRegistry({
        projectDir: "/test",
        componentDirs: ["custom/components"],
        adapter,
      });

      assertExists(registry);
    });
  });

  describe("discover", () => {
    it("should discover TSX components in default directories", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
        ["/test/components/Card.tsx", "export default function Card() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();

      assert(registry.has("Button"));
      assert(registry.has("Card"));
      assertEquals(registry.getComponentNames().length, 2);
    });

    it("should discover JSX components", async () => {
      const files = new Map([
        ["/test/components/Legacy.jsx", "export default function Legacy() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();

      assert(registry.has("Legacy"));
    });

    it("should skip node_modules directory", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
        ["/test/components/node_modules/Ignored.tsx", "export default function Ignored() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();

      assert(registry.has("Button"));
      assert(!registry.has("Ignored"));
    });

    it("should skip test files", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
        ["/test/components/Button.test.tsx", "test code"],
        ["/test/components/Card.spec.tsx", "test code"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();

      assert(registry.has("Button"));
      assert(!registry.has("Button.test"));
      assert(!registry.has("Card.spec"));
    });

    it("should skip index files", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
        ["/test/components/index.tsx", "export code"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();

      assert(registry.has("Button"));
      assert(!registry.has("index"));
    });

    it("should handle missing directories gracefully", async () => {
      const adapter = createMockAdapter(new Map());
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();

      assertEquals(registry.getComponentNames().length, 0);
    });

    it("should discover components in nested directories", async () => {
      const files = new Map([
        ["/test/components/forms/Input.tsx", "export default function Input() {}"],
        ["/test/components/layouts/Header.tsx", "export default function Header() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();

      assert(registry.has("Input"));
      assert(registry.has("Header"));
    });
  });

  describe("loadComponent", () => {
    it("should load component content", async () => {
      const content = "export default function Button() { return <button>Click</button>; }";
      const files = new Map([
        ["/test/components/Button.tsx", content],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      const component = await registry.loadComponent("Button");

      assertExists(component);
      assertEquals(component?.content, content);
      assert(component?.isLoaded);
    });

    it("should return null for non-existent component", async () => {
      const adapter = createMockAdapter(new Map());
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      const component = await registry.loadComponent("NonExistent");

      assertEquals(component, null);
    });

    it("should cache loaded components", async () => {
      const content = "export default function Button() {}";
      const files = new Map([
        ["/test/components/Button.tsx", content],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      const component1 = await registry.loadComponent("Button");
      const component2 = await registry.loadComponent("Button");

      assertEquals(component1, component2);
      assert(component1?.isLoaded);
    });
  });

  describe("loadAll", () => {
    it("should load all discovered components", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
        ["/test/components/Card.tsx", "export default function Card() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      await registry.loadAll();

      const button = registry.get("Button");
      const card = registry.get("Card");

      assert(button?.isLoaded);
      assert(card?.isLoaded);
    });
  });

  describe("get and getAll", () => {
    it("should get component by name", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      const component = registry.get("Button");

      assertExists(component);
      assertEquals(component.name, "Button");
    });

    it("should return undefined for non-existent component", async () => {
      const adapter = createMockAdapter(new Map());
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      const component = registry.get("NonExistent");

      assertEquals(component, undefined);
    });

    it("should get all components", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
        ["/test/components/Card.tsx", "export default function Card() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      const all = registry.getAll();

      assertEquals(all.size, 2);
      assert(all.has("Button"));
      assert(all.has("Card"));
    });
  });

  describe("has", () => {
    it("should return true for existing component", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();

      assert(registry.has("Button"));
    });

    it("should return false for non-existent component", async () => {
      const adapter = createMockAdapter(new Map());
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();

      assert(!registry.has("NonExistent"));
    });
  });

  describe("add", () => {
    it("should add component manually", () => {
      const adapter = createMockAdapter(new Map());
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      registry.add("CustomButton", {
        path: "/custom/Button.tsx",
        content: "export default function CustomButton() {}",
      });

      assert(registry.has("CustomButton"));
      const component = registry.get("CustomButton");
      assertEquals(component?.path, "/custom/Button.tsx");
      assert(component?.isLoaded);
    });

    it("should use virtual path if not provided", () => {
      const adapter = createMockAdapter(new Map());
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      registry.add("VirtualButton", {
        content: "export default function VirtualButton() {}",
      });

      const component = registry.get("VirtualButton");
      assertEquals(component?.path, "virtual:VirtualButton");
    });
  });

  describe("remove", () => {
    it("should remove component", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      assert(registry.has("Button"));

      registry.remove("Button");
      assert(!registry.has("Button"));
    });
  });

  describe("clear", () => {
    it("should clear all components", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
        ["/test/components/Card.tsx", "export default function Card() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      assertEquals(registry.getComponentNames().length, 2);

      registry.clear();
      assertEquals(registry.getComponentNames().length, 0);
    });
  });

  describe("getComponentNames", () => {
    it("should return array of component names", async () => {
      const files = new Map([
        ["/test/components/Button.tsx", "export default function Button() {}"],
        ["/test/components/Card.tsx", "export default function Card() {}"],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      const names = registry.getComponentNames();

      assertEquals(names.length, 2);
      assert(names.includes("Button"));
      assert(names.includes("Card"));
    });
  });

  describe("listComponents", () => {
    it("should list components with metadata", async () => {
      const content = "export default function Button() {}";
      const files = new Map([
        ["/test/components/Button.tsx", content],
      ]);

      const adapter = createMockAdapter(files);
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      await registry.discover();
      const list = await registry.listComponents();

      assertEquals(list.length, 1);
      const item = list[0];
      assertExists(item);
      assertEquals(item.name, "Button");
      assertEquals(item.path, "/test/components/Button.tsx");
      assertEquals(item.size, content.length);
      assertEquals(item.type, "component");
      assertExists(item.lastModified);
    });

    it("should handle stat errors gracefully", async () => {
      const adapter = createMockAdapter(new Map());
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      registry.add("VirtualButton", {
        content: "export default function VirtualButton() {}",
      });

      const list = await registry.listComponents();

      assertEquals(list.length, 1);
      const item = list[0];
      assertExists(item);
      assertEquals(item.name, "VirtualButton");
      assertEquals(item.size, undefined);
    });
  });

  describe("getAllAsComponents", () => {
    it("should return components with exports", () => {
      const adapter = createMockAdapter(new Map());
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      const mockComponent = () => null;
      registry.add("Button", {
        exports: { default: mockComponent },
      });

      const components = registry.getAllAsComponents();

      assertExists(components.Button);
      assertEquals(components.Button, mockComponent);
    });

    it("should skip components without default export", () => {
      const adapter = createMockAdapter(new Map());
      const registry = new ComponentRegistry({
        projectDir: "/test",
        adapter,
      });

      registry.add("Button", {
        exports: { named: () => null },
      });

      const components = registry.getAllAsComponents();

      assertEquals(components.Button, undefined);
    });
  });

});
