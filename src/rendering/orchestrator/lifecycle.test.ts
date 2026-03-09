import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RendererLifecycle } from "./lifecycle.ts";
import { ConfigurationManager } from "./config.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    fs: {
      readFile: async () => "",
      exists: async () => false,
      readDir: async function* () {},
      writeFile: async () => {},
      mkdir: async () => {},
      stat: async () => ({ isFile: false, isDirectory: false, size: 0 }),
      remove: async () => {},
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

describe("rendering/orchestrator/lifecycle", () => {
  describe("RendererLifecycle constructor", () => {
    it("should create lifecycle with required options", () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
      });
      assertEquals(lifecycle instanceof RendererLifecycle, true);
    });

    it("should accept optional options", () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "development",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        moduleServerUrl: "http://localhost:3002",
        projectId: "test-project",
        contentSourceId: "main",
      });
      assertEquals(lifecycle instanceof RendererLifecycle, true);
    });
  });

  describe("getServices before initialization", () => {
    it("should throw when services not initialized", () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
      });
      assertThrows(() => lifecycle.getServices(), Error);
    });
  });

  describe("clearAllCaches before initialization", () => {
    it("should not throw when services not initialized", () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
      });
      lifecycle.clearAllCaches(); // Should not throw
    });
  });

  describe("clearSlugCache before initialization", () => {
    it("should not throw when services not initialized", () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
      });
      lifecycle.clearSlugCache("test-slug"); // Should not throw
    });
  });

  describe("destroy before initialization", () => {
    it("should not throw when services not initialized", async () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
      });
      await lifecycle.destroy(); // Should not throw
    });
  });

  describe("updateCompileMDX before initialization", () => {
    it("should throw when services not initialized", () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
      });
      assertThrows(
        () => lifecycle.updateCompileMDX(async () => ({
          compiledCode: "",
          frontmatter: {},
          globals: {},
          headings: [],
          nodeMap: new Map(),
        })),
        Error,
      );
    });
  });
});
