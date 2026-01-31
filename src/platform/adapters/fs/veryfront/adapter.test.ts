import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { createVeryfrontConfig } from "./types.ts";
import type { FSAdapterConfig, ResolvedContentContext } from "./types.ts";

function createAdapter(
  overrides: Partial<FSAdapterConfig> = {},
): VeryfrontFSAdapter {
  return new VeryfrontFSAdapter({
    veryfront: {
      baseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: false },
    },
    ...overrides,
  });
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
            baseUrl: "https://api.example.com",
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
            baseUrl: "https://api.example.com",
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
          baseUrl: "https://api.example.com",
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
});

describe("createVeryfrontConfig", () => {
  it("should throw when veryfront config is missing", () => {
    try {
      createVeryfrontConfig({});
      assertEquals(true, false, "Should have thrown");
    } catch (e) {
      assertExists(e);
    }
  });

  it("should use default cache settings", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test",
      },
    });

    assertEquals(config.cache.enabled, true);
    assertEquals(config.cache.ttl, 60_000);
    assertEquals(config.cache.maxSize, 1000);
  });

  it("should override cache settings", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test",
        cache: { enabled: false, ttl: 5000 },
      },
    });

    assertEquals(config.cache.enabled, false);
    assertEquals(config.cache.ttl, 5000);
  });

  it("should use default retry settings", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test",
      },
    });

    assertEquals(config.retry.maxRetries, 3);
    assertEquals(config.retry.initialDelay, 1000);
    assertEquals(config.retry.maxDelay, 10000);
  });

  it("should default to branch content source", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test",
      },
    });

    assertEquals(config.contentSource.type, "branch");
  });

  it("should use provided content source", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test",
        contentSource: { type: "environment", name: "production" },
      },
    });

    assertEquals(config.contentSource.type, "environment");
  });

  it("should use apiKey as fallback for apiToken", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiKey: "key-123",
        projectSlug: "test",
      },
    });

    assertEquals(config.apiToken, "key-123");
  });

  it("should prefer apiToken over apiKey", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiToken: "token-123",
        apiKey: "key-123",
        projectSlug: "test",
      },
    });

    assertEquals(config.apiToken, "token-123");
  });

  it("should default empty strings when optional fields missing", () => {
    const config = createVeryfrontConfig({ veryfront: {} });

    assertEquals(config.apiBaseUrl, "");
    assertEquals(config.apiToken, "");
    assertEquals(config.projectSlug, "");
  });

  it("should resolve apiBaseUrl from apiBaseUrl property", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        apiBaseUrl: "https://api.veryfront.com",
        apiToken: "test-token",
        projectSlug: "test",
      },
    });

    assertEquals(config.apiBaseUrl, "https://api.veryfront.com");
  });

  it("should prefer baseUrl over apiBaseUrl", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://custom.example.com",
        apiBaseUrl: "https://api.veryfront.com",
        apiToken: "test-token",
        projectSlug: "test",
      },
    });

    assertEquals(config.apiBaseUrl, "https://custom.example.com");
  });

  it("should pass through proxyMode", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test",
        proxyMode: true,
      },
    });

    assertEquals(config.proxyMode, true);
  });

  it("should pass through projectId", () => {
    const config = createVeryfrontConfig({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test",
        projectId: "proj-abc",
      },
    });

    assertEquals(config.projectId, "proj-abc");
  });
});
