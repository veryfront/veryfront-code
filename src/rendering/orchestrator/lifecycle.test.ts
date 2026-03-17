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
      lifecycle.clearAllCaches();
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
      lifecycle.clearSlugCache("test-slug");
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
      await lifecycle.destroy();
    });
  });

  describe("initialize with injected servicesFactory", () => {
    function createMockServices(): any {
      const cleared: string[] = [];
      return {
        componentRegistry: {
          initializeComponents: async () => {},
          loadFromDirectory: async () => {},
          clear: () => cleared.push("componentRegistry"),
        },
        virtualModules: { clear: () => cleared.push("virtualModules") },
        cacheCoordinator: {
          clearAll: async () => {
            cleared.push("cacheCoordinator");
          },
          clearSlug: async (slug: string) => {
            cleared.push(`slug:${slug}`);
          },
          destroy: async () => {},
        },
        mdxCacheAdapter: {},
        layoutCollector: {},
        layoutCompiler: {},
        elementValidator: {},
        ssrRenderer: {},
        pageRenderer: {},
        pageResolver: {},
        compilerService: {
          setCompileMDX: () => {},
          getCompileFunction: () => async () => ({
            compiledCode: "",
            frontmatter: {},
            globals: {},
            headings: [],
            nodeMap: new Map(),
          }),
        },
        _cleared: cleared,
      };
    }

    it("initializes with injected factory", async () => {
      const mockServices = createMockServices();
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: () => mockServices,
      });

      const services = await lifecycle.initialize();
      assertEquals(services, mockServices);
    });

    it("getServices returns services after initialize", async () => {
      const mockServices = createMockServices();
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: () => mockServices,
      });

      await lifecycle.initialize();
      assertEquals(lifecycle.getServices(), mockServices);
    });

    it("clearAllCaches delegates to services after init", async () => {
      const mockServices = createMockServices();
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: () => mockServices,
      });

      await lifecycle.initialize();
      lifecycle.clearAllCaches();
      // Wait for async clearAll
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(mockServices._cleared.includes("cacheCoordinator"), true);
      assertEquals(mockServices._cleared.includes("virtualModules"), true);
      assertEquals(mockServices._cleared.includes("componentRegistry"), true);
    });

    it("clearSlugCache delegates to services after init", async () => {
      const mockServices = createMockServices();
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: () => mockServices,
      });

      await lifecycle.initialize();
      lifecycle.clearSlugCache("test-slug");
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(mockServices._cleared.includes("slug:test-slug"), true);
    });

    it("initializeComponents delegates after init", async () => {
      let called = false;
      const mockServices = createMockServices();
      mockServices.componentRegistry.initializeComponents = async () => {
        called = true;
      };
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: () => mockServices,
      });

      await lifecycle.initialize();
      await lifecycle.initializeComponents();
      assertEquals(called, true);
    });

    it("destroy delegates to cache coordinator", async () => {
      let destroyed = false;
      const mockServices = createMockServices();
      mockServices.cacheCoordinator.destroy = async () => {
        destroyed = true;
      };
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: () => mockServices,
      });

      await lifecycle.initialize();
      await lifecycle.destroy();
      assertEquals(destroyed, true);
    });

    it("updateCompileMDX delegates after init", async () => {
      let updatedFn: unknown = null;
      const mockServices = createMockServices();
      mockServices.compilerService.setCompileMDX = (fn: unknown) => {
        updatedFn = fn;
      };
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: () => mockServices,
      });

      const newCompile = async () => ({
        compiledCode: "new",
        frontmatter: {},
        globals: {},
        headings: [],
        nodeMap: new Map(),
      });

      await lifecycle.initialize();
      lifecycle.updateCompileMDX(newCompile);
      assertEquals(updatedFn, newCompile);
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
        () =>
          lifecycle.updateCompileMDX(async () => ({
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
