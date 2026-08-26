import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RendererLifecycle, type RendererServices } from "./lifecycle.ts";
import { ConfigurationManager } from "./config.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { join } from "#veryfront/compat/path";
import { validateVeryfrontConfig, type VeryfrontConfigInput } from "#veryfront/config";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { FilesystemCacheStore, KVCacheStore, MemoryCacheStore } from "../cache/stores/index.ts";
import type { CacheStore } from "../cache/types.ts";

function createMockAdapter(envVars: Record<string, string> = {}): RuntimeAdapter {
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
    env: { get: (key: string) => envVars[key] },
  } as unknown as RuntimeAdapter;
}

/**
 * Build the real service graph (no injected servicesFactory) so the wiring
 * between lifecycle options, the render cache store, and the services can be
 * observed.
 */
async function initializeRealServices(
  options: {
    config?: VeryfrontConfigInput;
    envVars?: Record<string, string>;
    projectId?: string;
    contentSourceId?: string;
    moduleServerUrl?: string;
  } = {},
): Promise<{ lifecycle: RendererLifecycle; services: RendererServices }> {
  const configManager = new ConfigurationManager({
    projectDir: "/project",
    mode: "production",
    adapter: createMockAdapter(options.envVars),
    config: validateVeryfrontConfig(options.config ?? {}),
  });
  await configManager.initialize();

  const lifecycle = new RendererLifecycle({
    configManager,
    port: 3000,
    ...(options.moduleServerUrl ? { moduleServerUrl: options.moduleServerUrl } : {}),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.contentSourceId ? { contentSourceId: options.contentSourceId } : {}),
  });

  return { lifecycle, services: await lifecycle.initialize() };
}

/** The coordinator keeps its store private; there is no public accessor. */
function readCacheStore(services: RendererServices): CacheStore {
  return (services.cacheCoordinator as unknown as { store: CacheStore }).store;
}

/** The entry budget is only reachable through the store's private LRU. */
function readMemoryStoreMaxEntries(store: CacheStore): number | undefined {
  return (store as unknown as {
    cache?: { adapter?: { maxEntries?: number } };
  }).cache?.adapter?.maxEntries;
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

    it("should thread optional options into the services it builds", async () => {
      const { lifecycle, services } = await initializeRealServices({
        moduleServerUrl: "http://localhost:3002",
        projectId: "test-project",
        contentSourceId: "main",
      });

      try {
        assertEquals(
          (services.cacheCoordinator as unknown as { cachePrefix: string }).cachePrefix,
          "test-project:main:",
          "render cache entries must be tenant-isolated by projectId and contentSourceId",
        );
        assertEquals(
          (services.componentRegistry as unknown as { moduleServerUrl?: string }).moduleServerUrl,
          "http://localhost:3002",
          "the component registry must load modules from the configured module server",
        );
      } finally {
        await lifecycle.destroy();
      }
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

  describe("initialize builds the configured render cache store", () => {
    it("uses a filesystem store rooted in the configured cache dir", async () => {
      const { lifecycle, services } = await initializeRealServices({
        config: { cache: { dir: "cache-root", render: { type: "filesystem" } } },
        projectId: "test-project",
      });

      try {
        const store = readCacheStore(services);
        assertEquals(
          store instanceof FilesystemCacheStore,
          true,
          "a filesystem render cache must not fall back to a volatile store",
        );
        assertEquals(
          (store as unknown as { baseDir: string }).baseDir,
          join("/project", "cache-root", "render"),
          "the filesystem store writes under the configured cache dir",
        );
      } finally {
        await lifecycle.destroy();
      }
    });

    it("uses a KV store when the render cache type is kv", async () => {
      const { lifecycle, services } = await initializeRealServices({
        config: { cache: { render: { type: "kv" } } },
        projectId: "test-project",
      });

      try {
        assertEquals(
          readCacheStore(services) instanceof KVCacheStore,
          true,
          "a kv render cache must be backed by the KV store",
        );
      } finally {
        await lifecycle.destroy();
      }
    });

    it("defaults to a memory store sized for production", async () => {
      const { lifecycle, services } = await initializeRealServices({
        projectId: "test-project",
      });

      try {
        const store = readCacheStore(services);
        assertEquals(
          store instanceof MemoryCacheStore,
          true,
          "an unconfigured render cache defaults to the memory store",
        );
        assertEquals(
          readMemoryStoreMaxEntries(store),
          500,
          "outside debug mode the memory render cache keeps the production entry budget",
        );
      } finally {
        await lifecycle.destroy();
      }
    });

    it("shrinks the memory store in debug mode", async () => {
      const { lifecycle, services } = await initializeRealServices({
        envVars: { VERYFRONT_DEBUG: "1" },
        projectId: "test-project",
      });

      try {
        assertEquals(
          readMemoryStoreMaxEntries(readCacheStore(services)),
          50,
          "debug mode caps the memory render cache at the smaller entry budget",
        );
      } finally {
        await lifecycle.destroy();
      }
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

    it("logs and swallows a rejected clearAll instead of leaking an unhandled rejection", async () => {
      const mockServices = createMockServices();
      mockServices.cacheCoordinator.clearAll = () => Promise.reject(new Error("clear boom"));

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

      const records: LogEntry[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));

      try {
        lifecycle.clearAllCaches();
        await waitFor(
          () => records.some((entry) => entry.message === "Failed to clear all caches"),
          { message: "a rejected clearAll is reported as a warning" },
        );
      } finally {
        unsubscribe();
      }

      const failure = records.find((entry) => entry.message === "Failed to clear all caches");
      assertEquals(
        failure?.level,
        "warn",
        "a rejected cache clear must be logged, not left as an unhandled rejection",
      );
      assertEquals(
        String(failure?.context?.error),
        "Error: clear boom",
        "the warning carries the underlying clear failure",
      );
      assertEquals(
        mockServices._cleared.includes("virtualModules"),
        true,
        "the synchronous clears still run when the async clear rejects",
      );
      assertEquals(
        mockServices._cleared.includes("componentRegistry"),
        true,
        "the synchronous clears still run when the async clear rejects",
      );
    });

    it("logs and swallows a rejected clearSlug instead of leaking an unhandled rejection", async () => {
      const mockServices = createMockServices();
      mockServices.cacheCoordinator.clearSlug = () => Promise.reject(new Error("slug boom"));

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

      const records: LogEntry[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));

      try {
        lifecycle.clearSlugCache("test-slug");
        await waitFor(
          () => records.some((entry) => entry.message === "Failed to clear slug cache"),
          { message: "a rejected clearSlug is reported as a warning" },
        );
      } finally {
        unsubscribe();
      }

      const failure = records.find((entry) => entry.message === "Failed to clear slug cache");
      assertEquals(
        failure?.level,
        "warn",
        "a rejected slug clear must be logged, not left as an unhandled rejection",
      );
      assertEquals(
        failure?.context?.slug,
        "test-slug",
        "the warning names the slug whose clear failed",
      );
      assertEquals(
        String(failure?.context?.error),
        "Error: slug boom",
        "the warning carries the underlying clear failure",
      );
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
