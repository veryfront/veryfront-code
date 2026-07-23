import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RendererLifecycle, type RendererServices } from "./lifecycle.ts";
import { ConfigurationManager } from "./config.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getOwnedRedisCacheNamespaceDescriptors } from "#veryfront/cache/backends/redis-keyspace.ts";
import { RedisCacheStore } from "../cache/stores/redis-store.ts";
import type { RedisClientManager } from "#veryfront/utils/redis-client.ts";

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
    function createMockServices(): RendererServices & { _cleared: string[] } {
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
      } as unknown as RendererServices & { _cleared: string[] };
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

    it("singleflights concurrent initialization and reuses the ready generation", async () => {
      const mockServices = createMockServices();
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const factoryStarted = Promise.withResolvers<void>();
      const releaseFactory = Promise.withResolvers<void>();
      let factoryCalls = 0;
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: async () => {
          factoryCalls++;
          factoryStarted.resolve();
          await releaseFactory.promise;
          return mockServices;
        },
      });

      const first = lifecycle.initialize();
      await factoryStarted.promise;
      const second = lifecycle.initialize();
      releaseFactory.resolve();

      const [firstServices, secondServices] = await Promise.all([first, second]);
      assertEquals(firstServices, mockServices);
      assertEquals(secondServices, mockServices);
      assertEquals(await lifecycle.initialize(), mockServices);
      assertEquals(factoryCalls, 1);
    });

    it("returns to idle when an injected factory fails so initialization can retry", async () => {
      const mockServices = createMockServices();
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      let factoryCalls = 0;
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: () => {
          factoryCalls++;
          if (factoryCalls === 1) throw new Error("factory failed");
          return mockServices;
        },
      });

      await assertRejects(() => lifecycle.initialize(), Error, "factory failed");
      assertEquals(await lifecycle.initialize(), mockServices);
      assertEquals(factoryCalls, 2);
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
      // Track the clearAll promise so we can await it deterministically
      let clearAllResolve: () => void;
      const clearAllDone = new Promise<void>((r) => (clearAllResolve = r));
      mockServices.cacheCoordinator.clearAll = async () => {
        mockServices._cleared.push("cacheCoordinator");
        clearAllResolve();
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
      lifecycle.clearAllCaches();
      // clearAllCaches is fire-and-forget (void return), so await the mock's promise
      await clearAllDone;
      assertEquals(mockServices._cleared.includes("cacheCoordinator"), true);
      // virtualModules.clear() and componentRegistry.clear() are synchronous
      assertEquals(mockServices._cleared.includes("virtualModules"), true);
      assertEquals(mockServices._cleared.includes("componentRegistry"), true);
    });

    it("clearSlugCache delegates to services after init", async () => {
      const mockServices = createMockServices();
      let clearSlugResolve: () => void;
      const clearSlugDone = new Promise<void>((r) => (clearSlugResolve = r));
      mockServices.cacheCoordinator.clearSlug = async (slug: string) => {
        mockServices._cleared.push(`slug:${slug}`);
        clearSlugResolve();
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
      lifecycle.clearSlugCache("test-slug");
      // clearSlugCache is fire-and-forget (void return), so await the mock's promise
      await clearSlugDone;
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

    it("retains failed cleanup for retry without repeating completed phases", async () => {
      let destroyAttempts = 0;
      const mockServices = createMockServices();
      mockServices.cacheCoordinator.destroy = () => {
        destroyAttempts++;
        if (destroyAttempts === 1) return Promise.reject(new Error("disconnect failed"));
        return Promise.resolve();
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
      const firstFailure = await assertRejects(
        () => lifecycle.destroy(),
        AggregateError,
        "cleanup failed",
      );
      assertEquals(typeof (firstFailure as { retryCleanup?: unknown }).retryCleanup, "function");
      assertThrows(() => lifecycle.getServices(), Error);
      await assertRejects(() => lifecycle.initialize(), Error, "require cleanup");

      await (firstFailure as { retryCleanup: () => Promise<void> }).retryCleanup();
      assertEquals(destroyAttempts, 2);
      assertEquals(
        mockServices._cleared.filter((entry) => entry === "componentRegistry").length,
        1,
      );
      assertEquals(
        mockServices._cleared.filter((entry) => entry === "virtualModules").length,
        1,
      );
      assertThrows(() => lifecycle.getServices(), Error);
    });

    it("cancels and cleans a generation when destroy is requested during initialization", async () => {
      const mockServices = createMockServices();
      let destroyCalls = 0;
      mockServices.cacheCoordinator.destroy = () => {
        destroyCalls++;
        return Promise.resolve();
      };
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
      });
      const factoryStarted = Promise.withResolvers<void>();
      const releaseFactory = Promise.withResolvers<void>();
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        servicesFactory: async () => {
          factoryStarted.resolve();
          await releaseFactory.promise;
          return mockServices;
        },
      });

      const initialization = lifecycle.initialize();
      await factoryStarted.promise;
      const destruction = lifecycle.destroy();
      releaseFactory.resolve();

      await assertRejects(() => initialization, Error, "cancelled during shutdown");
      await destruction;
      assertEquals(destroyCalls, 1);
      assertThrows(() => lifecycle.getServices(), Error);
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

  describe("initialize Redis render cache", () => {
    it("propagates configured millisecond TTLs as rounded-up Redis seconds", async () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
        config: {
          cache: {
            render: { type: "redis", ttl: 7_200_001 },
          },
        },
      });
      await configManager.initialize();
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        projectId: "ttl-project",
      });

      try {
        const services = await lifecycle.initialize();
        const cacheStore = (services.cacheCoordinator as unknown as {
          store: RedisCacheStore;
        }).store;
        const setTtls: number[] = [];
        const clientManager: RedisClientManager = {
          getClient: () =>
            Promise.resolve({
              connect: () => Promise.resolve(),
              disconnect: () => Promise.resolve(),
              get: () => Promise.resolve(null),
              mGet: (keys) => Promise.resolve(keys.map(() => null)),
              set: (
                _key: string,
                _value: string,
                options?: { EX?: number },
              ): Promise<string> => {
                if (options?.EX !== undefined) setTtls.push(options.EX);
                return Promise.resolve("OK");
              },
              del: () => Promise.resolve(0),
              scan: () => Promise.resolve({ cursor: 0, keys: [] }),
              expire: () => Promise.resolve(1),
              isOpen: true,
            }),
          disconnect: () => Promise.resolve(),
          isConfigured: () => true,
        };
        (cacheStore as unknown as { clientManager: RedisClientManager }).clientManager =
          clientManager;

        await cacheStore.set("page", {
          result: {
            html: "<p>cached</p>",
            frontmatter: {},
            headings: [],
            stream: null,
          },
          storedAt: Date.now(),
        });

        assertEquals(setTtls, [7_201]);
      } finally {
        await lifecycle.destroy();
      }
    });

    it("normalizes a legacy configured prefix before namespace registration", async () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
        config: {
          cache: {
            render: { type: "redis", redisKeyPrefix: "lifecycle-legacy-prefix" },
          },
        },
      });
      await configManager.initialize();
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
        projectId: "project-x",
        contentSourceId: "preview-main",
      });

      try {
        await lifecycle.initialize();
        const descriptor = getOwnedRedisCacheNamespaceDescriptors()
          .find((candidate) => candidate.prefix === "lifecycle-legacy-prefix:");
        assertEquals(
          descriptor?.matchProjectOwnership?.("project-x:preview-main:digest"),
          { projectId: "project-x", environment: "preview" },
        );
      } finally {
        await lifecycle.destroy();
      }
    });
  });

  describe("initialize filesystem render cache", () => {
    it("rejects a configured cache directory that escapes the project root", async () => {
      const adapter = createMockAdapter();
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: "production",
        adapter,
        config: {
          cache: {
            dir: "../outside",
            render: { type: "filesystem" },
          },
        },
      });
      await configManager.initialize();
      const lifecycle = new RendererLifecycle({
        configManager,
        port: 3000,
      });

      await assertRejects(
        () => lifecycle.initialize(),
        TypeError,
        "inside its owner root",
      );
      assertThrows(() => lifecycle.getServices(), Error);
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
