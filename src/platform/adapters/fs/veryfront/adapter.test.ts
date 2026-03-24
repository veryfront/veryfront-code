import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { buildFileListCacheKey } from "./cache-keys.ts";
import type { FSAdapterConfig, ResolvedContentContext } from "./types.ts";

function createAdapter(
  overrides: Partial<FSAdapterConfig> = {},
): VeryfrontFSAdapter {
  return new VeryfrontFSAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: false },
    },
    ...overrides,
  });
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for condition");
}

describe("VeryfrontFSAdapter", () => {
  describe("class", () => {
    it("should export VeryfrontFSAdapter class", () => {
      assertExists(VeryfrontFSAdapter);
      assertEquals(typeof VeryfrontFSAdapter, "function");
    });
  });

  describe("constructor", () => {
    it("should be instantiable with minimal config", () => {
      assertExists(createAdapter());
    });

    it("should accept proxyMode in config", () => {
      assertExists(
        createAdapter({
          veryfront: {
            apiBaseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            proxyMode: true,
            cache: { enabled: false },
          },
        }),
      );
    });

    it("should accept projectDir in config", () => {
      assertExists(createAdapter({ projectDir: "/tmp/my-project" }));
    });

    it("should accept contentSource in config", () => {
      assertExists(
        createAdapter({
          veryfront: {
            apiBaseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            contentSource: { type: "environment", name: "production" },
            cache: { enabled: false },
          },
        }),
      );
    });

    it("should accept invalidationCallbacks in config", () => {
      let clearCalled = false;

      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
        invalidationCallbacks: {
          clearSSRModuleCache: () => {
            clearCalled = true;
          },
        },
      });

      assertExists(adapter);
      assertEquals(clearCalled, false);
    });
  });

  describe("instance methods", () => {
    const methods = [
      "readFile",
      "readTextFile",
      "readdir",
      "stat",
      "exists",
      "initialize",
      "dispose",
      "getCacheStats",
      "setRequestToken",
      "setContentContext",
      "resolveFile",
      "readFileBytes",
      "getAllSourceFiles",
      "getEntityIdForPath",
      "getFilePathByEntityId",
      "getPokeMetrics",
      "getClient",
    ] as const;

    for (const method of methods) {
      it(`should have ${method} method`, () => {
        assertEquals(typeof (createAdapter() as any)[method], "function");
      });
    }
  });

  describe("content context", () => {
    it("should default to null before initialize", () => {
      assertEquals(createAdapter().getContentContext(), null);
    });

    it("should set branch context", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      const ctx = adapter.getContentContext();
      assertEquals(ctx?.sourceType, "branch");
      assertEquals(ctx?.branch, "main");
      assertEquals(ctx?.projectSlug, "test-project");
    });

    it("should set environment context", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "environment",
        projectSlug: "test-project",
        environmentName: "production",
      });

      const ctx = adapter.getContentContext();
      assertEquals(ctx?.sourceType, "environment");
      assertEquals(ctx?.environmentName, "production");
    });

    it("should set release context", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-123",
      });

      const ctx = adapter.getContentContext();
      assertEquals(ctx?.sourceType, "release");
      assertEquals(ctx?.releaseId, "release-123");
    });

    it("should preserve context set before initialize", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "my-project",
        releaseId: "release-uuid-123",
      });

      const ctx = adapter.getContentContext();
      assertEquals(ctx?.sourceType, "release");
      assertEquals(ctx?.releaseId, "release-uuid-123");
    });

    it("should clear caches when context changes", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-old",
      });
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-new",
      });

      assertEquals(adapter.getContentContext()?.releaseId, "release-new");
    });

    it("should not clear caches when context is identical", () => {
      const adapter = createAdapter();
      const ctx: ResolvedContentContext = {
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      };

      adapter.setContentContext(ctx);
      adapter.setContentContext(ctx);

      assertEquals(adapter.getContentContext()?.branch, "main");
    });

    it("should detect context change between different source types", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "rel-1",
      });

      assertEquals(adapter.getContentContext()?.sourceType, "release");
    });
  });

  describe("request branch", () => {
    it("should default to null request branch", () => {
      assertEquals(createAdapter().getRequestBranch(), null);
    });

    it("should set request branch", () => {
      const adapter = createAdapter();
      adapter.setRequestBranch("feature-branch");
      assertEquals(adapter.getRequestBranch(), "feature-branch");
    });

    it("should clear request branch", () => {
      const adapter = createAdapter();
      adapter.setRequestBranch("feature-branch");
      adapter.clearRequestBranch();
      assertEquals(adapter.getRequestBranch(), null);
    });

    it("should set null request branch", () => {
      const adapter = createAdapter();
      adapter.setRequestBranch("feature-branch");
      adapter.setRequestBranch(null);
      assertEquals(adapter.getRequestBranch(), null);
    });
  });

  describe("dispose", () => {
    it("should dispose without error", () => {
      createAdapter().dispose();
    });

    it("should allow calling dispose multiple times", () => {
      const adapter = createAdapter();
      adapter.dispose();
      adapter.dispose();
    });
  });

  describe("getCacheStats", () => {
    it("should return stats object with cache and poke properties", () => {
      const stats = createAdapter().getCacheStats();
      assertExists(stats);
      assertExists(stats.cache);
      assertExists(stats.poke);
      assertEquals(typeof stats.cache.size, "number");
      assertEquals(typeof stats.cache.hits, "number");
      assertEquals(typeof stats.cache.misses, "number");
    });
  });

  describe("getPokeMetrics", () => {
    it("should return metrics object", () => {
      const metrics = createAdapter().getPokeMetrics();
      assertExists(metrics);
      assertEquals(metrics.received, 0);
      assertEquals(metrics.invalidationsTriggered, 0);
      assertEquals(metrics.lastPokeTime, 0);
      assertEquals(metrics.connectionId, null);
    });
  });

  describe("getProjectData", () => {
    it("should return undefined before initialization", () => {
      assertEquals(createAdapter().getProjectData(), undefined);
    });
  });

  describe("getAllSourceFiles", () => {
    it("should return empty array when no content context", async () => {
      assertEquals(await createAdapter().getAllSourceFiles(), []);
    });
  });

  describe("getEntityIdForPath", () => {
    it("should return undefined when no content context", () => {
      assertEquals(createAdapter().getEntityIdForPath("pages/index.tsx"), undefined);
    });
  });

  describe("getFilePathByEntityId", () => {
    it("should return undefined when no content context", () => {
      assertEquals(createAdapter().getFilePathByEntityId("entity-123"), undefined);
    });
  });

  describe("getClient", () => {
    it("should return API client instance", () => {
      assertExists(createAdapter().getClient());
    });
  });

  describe("initialize", () => {
    it("should throw without causing unhandled rejection when file list fetch fails", async () => {
      // Regression: initialize() used to call fileListReadyReject() in its catch block.
      // Since no lookup() was pending, the rejected promise had no handler, causing
      // "Uncaught (in promise)" that crashed the Deno process.
      const adapter = createAdapter();

      // Stub client methods so initialize() reaches fetchFileListForContext (the inner try/catch)
      const client = (adapter as any).client;
      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      // This is what fetchFileListForContext calls — simulate 404
      client.listAllFiles = () => Promise.reject(new Error("API request failed: 404 Not Found"));

      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      let unhandledRejection: unknown = null;
      const hasEventTargetHandlers = typeof globalThis.addEventListener === "function" &&
        typeof globalThis.removeEventListener === "function";

      const browserStyleHandler = (e: PromiseRejectionEvent) => {
        unhandledRejection = e;
        e.preventDefault();
      };

      const processRef = (globalThis as {
        process?: {
          on?: (event: string, listener: (reason: unknown) => void) => void;
          off?: (event: string, listener: (reason: unknown) => void) => void;
        };
      }).process;

      const nodeStyleHandler = (reason: unknown) => {
        unhandledRejection = reason;
      };

      if (hasEventTargetHandlers) {
        globalThis.addEventListener("unhandledrejection", browserStyleHandler);
      } else if (typeof processRef?.on === "function") {
        processRef.on("unhandledRejection", nodeStyleHandler);
      }

      let threw = false;
      try {
        try {
          await adapter.initialize();
        } catch {
          threw = true;
        }

        // Let microtasks flush so any unhandled rejection would fire
        await new Promise((r) => setTimeout(r, 50));

        assertEquals(threw, true, "initialize() should throw");
        assertEquals(unhandledRejection, null, "should not cause unhandled rejection");
      } finally {
        if (hasEventTargetHandlers) {
          globalThis.removeEventListener("unhandledrejection", browserStyleHandler);
        } else if (typeof processRef?.off === "function") {
          processRef.off("unhandledRejection", nodeStyleHandler);
        }
      }
    });

    it("should rehydrate a missing file list cache in the background", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });

      const files = [{
        path: "pages/index.tsx",
        content: "export default function Page() { return null }",
      }];

      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve(files);
      };
      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      await adapter.initialize();
      assertEquals(listAllFilesCalls, 1);

      const cacheKey = buildFileListCacheKey(adapter.getContentContext());
      const cache = (adapter as unknown as {
        cache: {
          delete: (key: string) => boolean;
          getAsync: <T>(key: string) => Promise<T | undefined>;
        };
      }).cache;

      assertEquals(cache.delete(cacheKey), true);
      assertEquals(await adapter.getAllSourceFiles(), []);

      await waitFor(async () => {
        const cached = await cache.getAsync<Array<{ path: string; content?: string }>>(cacheKey);
        return Array.isArray(cached) && cached.length === 1;
      });

      const cached = await cache.getAsync<Array<{ path: string; content?: string }>>(cacheKey);
      assertEquals(listAllFilesCalls, 2);
      assertEquals(cached?.[0]?.path, "pages/index.tsx");
    });

    it("does not pregenerate CSS during branch initialization", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () =>
        Promise.resolve([{
          path: "pages/index.tsx",
          content: "export default function Page() {}",
        }]);

      let pregenerationCalls = 0;
      (
        adapter as unknown as {
          triggerCSSPregeneration: (
            files: Array<{ path: string; content?: string }>,
          ) => Promise<void>;
        }
      ).triggerCSSPregeneration = async () => {
        pregenerationCalls++;
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      await adapter.initialize();

      assertEquals(pregenerationCalls, 0);
    });

    it("does not pregenerate CSS during branch cache warmup", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });

      const files = [{
        path: "pages/index.tsx",
        content: "export default function Page() { return null }",
      }];

      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve(files);
      };

      let pregenerationCalls = 0;
      (
        adapter as unknown as {
          triggerCSSPregeneration: (
            files: Array<{ path: string; content?: string }>,
          ) => Promise<void>;
        }
      ).triggerCSSPregeneration = async () => {
        pregenerationCalls++;
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      await adapter.initialize();
      assertEquals(listAllFilesCalls, 1);
      assertEquals(pregenerationCalls, 0);

      const cacheKey = buildFileListCacheKey(adapter.getContentContext());
      const cache = (adapter as unknown as {
        cache: {
          delete: (key: string) => boolean;
          getAsync: <T>(key: string) => Promise<T | undefined>;
        };
      }).cache;

      assertEquals(cache.delete(cacheKey), true);
      assertEquals(await adapter.getAllSourceFiles(), []);

      await waitFor(async () => {
        const cached = await cache.getAsync<Array<{ path: string; content?: string }>>(cacheKey);
        return Array.isArray(cached) && cached.length === 1;
      });

      assertEquals(listAllFilesCalls, 2);
      assertEquals(pregenerationCalls, 0);
    });

    it("should deduplicate concurrent background file list warmups", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });

      const files = [{
        path: "pages/index.tsx",
        content: "export default function Page() { return null }",
      }];

      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = async () => {
        listAllFilesCalls++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return files;
      };
      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      await adapter.initialize();
      assertEquals(listAllFilesCalls, 1);

      const cacheKey = buildFileListCacheKey(adapter.getContentContext());
      const cache = (adapter as unknown as {
        cache: {
          delete: (key: string) => boolean;
          getAsync: <T>(key: string) => Promise<T | undefined>;
        };
      }).cache;

      assertEquals(cache.delete(cacheKey), true);

      await Promise.all([
        adapter.getAllSourceFiles(),
        adapter.getAllSourceFiles(),
        adapter.getAllSourceFiles(),
      ]);

      await waitFor(async () => {
        const cached = await cache.getAsync<Array<{ path: string; content?: string }>>(cacheKey);
        return Array.isArray(cached) && cached.length === 1;
      });

      assertEquals(listAllFilesCalls, 2);
    });
  });
});
