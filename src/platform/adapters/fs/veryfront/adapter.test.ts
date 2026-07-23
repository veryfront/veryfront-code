import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { runWithRequestContext } from "./request-context.ts";
import { buildFileCacheKeyPrefix, buildFileListCacheKey } from "./cache-keys.ts";
import { createAdapter, seedCachedFiles, waitFor } from "./adapter.test-helpers.ts";
import { FS_ADAPTER_KIND, type ResolvedContentContext } from "./types.ts";
import {
  addPendingInvalidation,
  clearAllPendingInvalidations,
  removePendingInvalidation,
} from "./invalidation-state.ts";
import {
  clearReleaseAssetManifestCache,
  getReadyManifestForRender,
} from "#veryfront/release-assets/manifest-cache.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "#veryfront/release-assets/constants.ts";

interface TestManifestClient {
  getReleaseAssetManifest: (releaseId: string) => Promise<{
    state: string;
    manifest: unknown;
  }>;
}

function getManifestClient(adapter: VeryfrontFSAdapter): TestManifestClient {
  return (adapter as unknown as { manifestClient: TestManifestClient }).manifestClient;
}

function stubClientInitialization(client: unknown): void {
  const initializationClient = client as {
    initializeProject: () => Promise<{
      projectId: string;
      project: {
        id: string;
        name: string;
        slug: string;
        provider: string;
        layout: string;
      };
      requestScoped: boolean;
    }>;
  };
  initializationClient.initializeProject = () =>
    Promise.resolve({
      projectId: "project-123",
      project: {
        id: "project-123",
        name: "Project",
        slug: "test-project",
        provider: "veryfront",
        layout: "default",
      },
      requestScoped: false,
    });
}

describe("VeryfrontFSAdapter", () => {
  afterEach(() => {
    clearAllPendingInvalidations();
  });

  describe("class", () => {
    it("should export VeryfrontFSAdapter class", () => {
      assertExists(VeryfrontFSAdapter);
      assertEquals(typeof VeryfrontFSAdapter, "function");
    });
  });

  describe("constructor", () => {
    it("should be instantiable with minimal config", () => {
      const adapter = createAdapter();
      assertExists(adapter);
      assertEquals(adapter[FS_ADAPTER_KIND], "veryfront");
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

    it("snapshots nested direct-constructor configuration and installs defaults", () => {
      const originalInvalidation = () => {};
      const replacementInvalidation = () => {};
      const originalStyle = () => Promise.resolve(undefined);
      const replacementStyle = () => Promise.resolve(undefined);
      const contentSource = { type: "branch" as const, branch: "main" };
      const invalidationCallbacks = { triggerReload: originalInvalidation };
      const styleCallbacks = { pregenerateStyles: originalStyle };

      const adapter = new VeryfrontFSAdapter({
        projectDir: "/tmp/project-before",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource,
          cache: { enabled: false },
        },
        invalidationCallbacks,
        styleCallbacks,
      });

      contentSource.branch = "feature-after";
      invalidationCallbacks.triggerReload = replacementInvalidation;
      styleCallbacks.pregenerateStyles = replacementStyle;

      const internals = adapter as unknown as {
        contentSource: { type: string; branch?: string };
        invalidationCallbacks: {
          triggerReload?: () => void;
          clearModulePathCache?: () => void;
        };
        styleCallbacks: { pregenerateStyles?: typeof originalStyle };
        normalizer: { getProjectDir: () => string | undefined };
      };

      assertEquals(internals.contentSource, { type: "branch", branch: "main" });
      assertEquals(Object.isFrozen(internals.contentSource), true);
      assertStrictEquals(internals.invalidationCallbacks.triggerReload, originalInvalidation);
      assertEquals(typeof internals.invalidationCallbacks.clearModulePathCache, "function");
      assertEquals(Object.isFrozen(internals.invalidationCallbacks), true);
      assertStrictEquals(internals.styleCallbacks.pregenerateStyles, originalStyle);
      assertEquals(Object.isFrozen(internals.styleCallbacks), true);
      assertEquals(internals.normalizer.getProjectDir(), "/tmp/project-before");
    });

    it("reads direct-constructor configuration properties once", () => {
      const reads = new Map<string, number>();
      const values = {
        projectDir: "/tmp/project",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
        invalidationCallbacks: {},
        styleCallbacks: {},
      };
      const config = Object.create(null);
      for (const property of Object.keys(values) as Array<keyof typeof values>) {
        Object.defineProperty(config, property, {
          get() {
            reads.set(property, (reads.get(property) ?? 0) + 1);
            return values[property];
          },
        });
      }

      const adapter = new VeryfrontFSAdapter(config);
      assertExists(adapter);
      assertEquals(Object.fromEntries(reads), {
        projectDir: 1,
        veryfront: 1,
        invalidationCallbacks: 1,
        styleCallbacks: 1,
      });
    });

    it("rejects unreadable direct-constructor configuration safely", () => {
      const secret = "PRIVATE_DIRECT_FS_CONFIG/project-442";
      const config = Object.create(null);
      Object.defineProperty(config, "veryfront", {
        get() {
          throw new Error(secret);
        },
      });

      let thrown: unknown;
      try {
        new VeryfrontFSAdapter(config);
      } catch (error) {
        thrown = error;
      }

      assertStrictEquals(thrown instanceof VeryfrontError, true);
      assertEquals((thrown as VeryfrontError).slug, "config-invalid");
      assertEquals(JSON.stringify(thrown).includes(secret), false);
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
      "refreshSourceSnapshot",
    ] as const;

    for (const method of methods) {
      it(`should have ${method} method`, () => {
        assertEquals(typeof (createAdapter() as any)[method], "function");
      });
    }
  });

  describe("request tokens", () => {
    it("keeps request-scoped tokens out of WebSocket credentials", () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "static-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      const websocketTokens: string[] = [];

      (adapter as unknown as { wsManager: { setApiToken: (token: string) => void } }).wsManager = {
        setApiToken: (token: string) => {
          websocketTokens.push(token);
        },
      };

      adapter.setRequestToken("fresh-request-token");
      adapter.clearRequestToken();
      assertEquals(websocketTokens, []);
    });

    it("resolves concurrent proxy tokens from their matching request contexts", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          projectSlug: "test-project",
          proxyMode: true,
          cache: { enabled: false },
        },
      });

      const [tokenA, tokenB] = await Promise.all([
        runWithRequestContext(
          { projectSlug: "test-project", token: "request-token-a" },
          async () => {
            await Promise.resolve();
            return adapter.getClient().getToken();
          },
        ),
        runWithRequestContext(
          { projectSlug: "test-project", token: "request-token-b" },
          async () => {
            await Promise.resolve();
            return adapter.getClient().getToken();
          },
        ),
      ]);

      assertEquals([tokenA, tokenB], ["request-token-a", "request-token-b"]);
    });

    it("rejects an empty active proxy token instead of using the service credential", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "service-token",
          projectSlug: "test-project",
          proxyMode: true,
          cache: { enabled: false },
        },
      });

      await runWithRequestContext(
        { projectSlug: "test-project", token: "" },
        () => {
          assertThrows(
            () => adapter.getClient().getToken(),
            Error,
            "token must be a non-empty string",
          );
          return Promise.resolve();
        },
      );
    });

    it("rejects an active context for another project instead of using the service credential", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "service-token",
          projectSlug: "test-project",
          proxyMode: true,
          cache: { enabled: false },
        },
      });

      await runWithRequestContext(
        { projectSlug: "other-project", token: "request-token" },
        () => {
          assertThrows(
            () => adapter.getClient().getToken(),
            Error,
            "Unable to resolve the Veryfront API request identity",
          );
          return Promise.resolve();
        },
      );
    });

    it("does not open a WebSocket without a stable configured credential", () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          projectSlug: "test-project",
          proxyMode: true,
          cache: { enabled: false },
        },
      });
      let connections = 0;
      (adapter as unknown as { wsManager: { connect: () => void } }).wsManager = {
        connect: () => {
          connections++;
        },
      };

      (adapter as unknown as { connectWebSocket: (projectId: string) => void }).connectWebSocket(
        "project-id",
      );

      assertEquals(connections, 0);
    });

    it("keeps background manifest requests on the configured credential", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "service-token",
          projectSlug: "test-project",
          proxyMode: true,
          cache: { enabled: false },
        },
      });
      const manifestClient = (adapter as unknown as {
        manifestClient: { getToken: () => string } | null;
      }).manifestClient;

      const token = await runWithRequestContext(
        { projectSlug: "test-project", token: "request-token" },
        () => Promise.resolve(manifestClient?.getToken()),
      );

      assertEquals(token, "service-token");
    });
  });

  describe("content context", () => {
    const originalManifestFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);

    afterEach(() => {
      setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalManifestFlag ?? "");
      clearReleaseAssetManifestCache();
    });

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

    it("pins environment client fallbacks to the resolved release", async () => {
      const adapter = createAdapter();
      const client = adapter.getClient();
      adapter.setContentContext({
        sourceType: "environment",
        projectSlug: "test-project",
        environmentName: "production",
        releaseId: "release-before-redeploy",
      });

      assertEquals(client.getContext(), {
        type: "release",
        version: "release-before-redeploy",
      });

      (client as unknown as {
        getFileById: (entityId: string) => Promise<{ path: string; content: string }>;
      }).getFileById = (entityId) => {
        assertEquals(entityId, "entity-from-old-release");
        assertEquals(client.getContext(), {
          type: "release",
          version: "release-before-redeploy",
        });
        return Promise.resolve({
          path: "pages/old-release.tsx",
          content: "old release",
        });
      };

      assertEquals(await adapter.getFilePathByEntityIdAsync("entity-from-old-release"), {
        path: "pages/old-release.tsx",
        body: "old release",
      });
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

    it("should register a release asset manifest fetcher for environment contexts with release ids", async () => {
      setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
      const releaseId = "release-env-123";
      const contentHash = "a".repeat(64);
      const adapter = createAdapter();
      let fetchCount = 0;

      getManifestClient(adapter).getReleaseAssetManifest = async (requestedReleaseId: string) => {
        fetchCount++;
        assertEquals(requestedReleaseId, releaseId);
        return {
          state: "ready",
          manifest: {
            schemaVersion: 1,
            projectId: "project-123",
            releaseId,
            releaseVersion: 1,
            manifestVersion: 2,
            builderVersion: "0.1.765",
            sourceContentHash: "",
            createdAt: "2026-06-12T00:00:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {
              "pages/index.tsx": {
                contentHash,
                size: 1,
                contentType: "text/javascript",
              },
            },
            css: [],
            routes: { "/": { modules: ["pages/index.tsx"], css: [] } },
            dependencies: {},
            fallback: { mode: "jit", gaps: [] },
          },
        };
      };

      adapter.setContentContext({
        sourceType: "environment",
        projectSlug: "test-project",
        environmentName: "production",
        releaseId,
      });

      assertEquals(getReadyManifestForRender(releaseId), null);
      await waitFor(async () => getReadyManifestForRender(releaseId)?.manifestVersion === 2);
      assertEquals(fetchCount, 1);
    });

    it("should register a release asset manifest fetcher when initialize resolves the release id", async () => {
      setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
      const releaseId = "release-env-initialize";
      const contentHash = "c".repeat(64);
      const files = [{
        path: "pages/index.tsx",
        content: "export default function Page() { return null }",
      }];
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "environment", name: "production" },
          cache: { enabled: false },
        },
      });
      let fetchCount = 0;

      const client = adapter.getClient() as unknown as {
        initialize: () => Promise<void>;
        getProjectSlug: () => string;
        getProjectId: () => string;
        getCachedProject: () => { provider: string; layout: string };
        listEnvironmentFiles: (environmentName: string) => Promise<{
          files: Array<{ path: string; content?: string }>;
          page_info: { has_more: boolean; next: null };
          release_id: string;
        }>;
        listPublishedFiles: (
          projectId?: string,
          releaseId?: string,
        ) => Promise<Array<{ path: string; content?: string }>>;
      };
      stubClientInitialization(client);
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listEnvironmentFiles = (environmentName) => {
        assertEquals(environmentName, "production");
        return Promise.resolve({
          files,
          page_info: { has_more: false, next: null },
          release_id: releaseId,
        });
      };
      client.listPublishedFiles = (projectId, requestedReleaseId) => {
        assertEquals(projectId, undefined);
        assertEquals(requestedReleaseId, releaseId);
        return Promise.resolve(files);
      };
      getManifestClient(adapter).getReleaseAssetManifest = async (requestedReleaseId) => {
        fetchCount++;
        assertEquals(requestedReleaseId, releaseId);
        return {
          state: "ready",
          manifest: {
            schemaVersion: 1,
            projectId: "project-123",
            releaseId,
            releaseVersion: 1,
            manifestVersion: 3,
            builderVersion: "0.1.792",
            sourceContentHash: "",
            createdAt: "2026-06-12T00:00:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {
              "pages/index.tsx": {
                contentHash,
                size: 1,
                contentType: "text/javascript",
              },
            },
            css: [],
            routes: { "/": { modules: ["pages/index.tsx"], css: [] } },
            dependencies: {},
            fallback: { mode: "jit", gaps: [] },
          },
        };
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();

      assertEquals(adapter.getContentContext()?.releaseId, releaseId);
      assertEquals(getReadyManifestForRender(releaseId), null);
      await waitFor(async () => getReadyManifestForRender(releaseId)?.manifestVersion === 3);
      assertEquals(fetchCount, 1);
    });

    it("should clear cached release asset manifests on poke without unregistering the fetcher", async () => {
      setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
      const releaseId = "release-env-poke";
      let contentHash = "a".repeat(64);
      const adapter = createAdapter();
      let fetchCount = 0;

      getManifestClient(adapter).getReleaseAssetManifest = async (requestedReleaseId: string) => {
        fetchCount++;
        assertEquals(requestedReleaseId, releaseId);
        return {
          state: "ready",
          manifest: {
            schemaVersion: 1,
            projectId: "project-123",
            releaseId,
            releaseVersion: 1,
            manifestVersion: 1,
            builderVersion: "0.1.765",
            sourceContentHash: "",
            createdAt: "2026-06-12T00:00:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {
              "pages/index.tsx": {
                contentHash,
                size: 1,
                contentType: "text/javascript",
              },
            },
            css: [],
            routes: { "/": { modules: ["pages/index.tsx"], css: [] } },
            dependencies: {},
            fallback: { mode: "jit", gaps: [] },
          },
        };
      };

      adapter.setContentContext({
        sourceType: "environment",
        projectSlug: "test-project",
        environmentName: "production",
        releaseId,
      });

      assertEquals(getReadyManifestForRender(releaseId), null);
      await waitFor(async () =>
        getReadyManifestForRender(releaseId)?.modules["pages/index.tsx"]?.contentHash ===
          "a".repeat(64)
      );
      assertEquals(fetchCount, 1);

      contentHash = "b".repeat(64);
      (adapter as unknown as {
        wsManager: { deps: { clearMemoryCaches: () => void } };
      }).wsManager.deps.clearMemoryCaches();

      assertEquals(getReadyManifestForRender(releaseId), null);
      await waitFor(async () =>
        getReadyManifestForRender(releaseId)?.modules["pages/index.tsx"]?.contentHash ===
          "b".repeat(64)
      );
      assertEquals(fetchCount, 2);
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

    it("should return cached file list entries after context is set", async () => {
      const adapter = createAdapter({
        projectDir: "/project/root",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      const files = [
        { id: "entity-1", path: "pages/index.tsx", content: "export default () => null;" },
        { id: "entity-2", path: "pages/about.tsx", content: "export default () => null;" },
      ];
      seedCachedFiles(adapter, files);

      assertEquals(await adapter.getAllSourceFiles(), files);
    });
  });

  describe("getEntityIdForPath", () => {
    it("should return undefined when no content context", () => {
      assertEquals(createAdapter().getEntityIdForPath("pages/index.tsx"), undefined);
    });

    it("should resolve entity ids from the cached file list using normalized paths", () => {
      const adapter = createAdapter({
        projectDir: "/project/root",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      seedCachedFiles(adapter, [{ id: "entity-1", path: "pages/index.tsx" }]);

      assertEquals(adapter.getEntityIdForPath("/project/root/pages/index.tsx"), "entity-1");
    });
  });

  describe("getFilePathByEntityId", () => {
    it("should return undefined when no content context", () => {
      assertEquals(createAdapter().getFilePathByEntityId("entity-123"), undefined);
    });

    it("should resolve file paths from the cached file list by entity id", () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      seedCachedFiles(adapter, [{ id: "entity-123", path: "pages/index.tsx" }]);

      assertEquals(adapter.getFilePathByEntityId("entity-123"), "pages/index.tsx");
    });
  });

  describe("getClient", () => {
    it("should return API client instance", () => {
      assertExists(createAdapter().getClient());
    });
  });

  describe("initialize", () => {
    it("uses request-scoped initialization data without reading shared client state", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "service-token",
          projectSlug: "test-project",
          proxyMode: true,
          cache: { enabled: false },
        },
      });
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });
      const client = adapter.getClient() as unknown as {
        initialize: () => Promise<void>;
        initializeProject: () => Promise<{
          projectId: string;
          project: { id: string; name: string; slug: string };
          requestScoped: boolean;
        }>;
        getProjectId: () => string;
        listAllFiles: () => Promise<Array<{ path: string; content: string }>>;
      };
      client.initialize = () => Promise.reject(new Error("legacy initialization used"));
      client.initializeProject = () =>
        Promise.resolve({
          projectId: "project-id",
          project: { id: "project-id", name: "Project", slug: "test-project" },
          requestScoped: true,
        });
      client.getProjectId = () => {
        throw new Error("shared project state read");
      };
      client.listAllFiles = () => Promise.resolve([]);
      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await runWithRequestContext(
        { projectSlug: "test-project", token: "request-token", branch: "main" },
        () => adapter.initialize(),
      );

      assertEquals(adapter.getProjectData()?.id, "project-id");
    });

    it("should throw without causing unhandled rejection when file list fetch fails", async () => {
      // Regression: initialize() used to call fileListReadyReject() in its catch block.
      // Since no lookup() was pending, the rejected promise had no handler, causing
      // "Uncaught (in promise)" that crashed the Deno process.
      const adapter = createAdapter();

      // Stub client methods so initialize() reaches fetchFileListForContext (the inner try/catch)
      const client = (adapter as any).client;
      stubClientInitialization(client);
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

    it("preserves request branch while initializing branch content context", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          getContext: () => { type: string; name?: string; version?: string };
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      stubClientInitialization(client);
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let observedContext: ReturnType<typeof client.getContext> | null = null;
      client.listAllFiles = () => {
        observedContext = client.getContext();
        assertEquals(observedContext, { type: "branch", name: "draft" });
        return Promise.resolve([{
          path: "pages/index.tsx",
          content: "export default function Page() { return null }",
        }]);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      adapter.setRequestBranch("draft");

      await adapter.initialize();

      assertEquals(adapter.getRequestBranch(), "draft");
      assertEquals(observedContext, { type: "branch", name: "draft" });
      assertEquals(adapter.getContentContext(), {
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });
    });

    it("refreshes a stale branch snapshot once when a pushed file is missing", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const staleFiles = [{
        path: "components/GraphViewer.tsx",
        content: "import '../lib/graph-performance';",
      }];
      const refreshedFiles = [
        ...staleFiles,
        {
          path: "lib/graph-performance.ts",
          content: "export const chooseSampleSize = () => 10000;",
        },
      ];
      const secondRefreshFiles = [
        ...refreshedFiles,
        {
          path: "lib/second-pushed-file.ts",
          content: "export const second = true;",
        },
      ];

      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
          getFileContent: (path: string) => Promise<string>;
        };
      }).client;

      stubClientInitialization(client);
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        if (listAllFilesCalls === 1) return Promise.resolve(staleFiles);
        if (listAllFilesCalls === 2) return Promise.resolve(refreshedFiles);
        return Promise.resolve(secondRefreshFiles);
      };
      client.getFileContent = (path: string) => Promise.resolve(`network content for ${path}`);

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();

      const content = await adapter.readTextFile("lib/graph-performance.ts");

      assertEquals(content, "export const chooseSampleSize = () => 10000;");
      assertEquals(listAllFilesCalls, 2);

      const secondContent = await adapter.readTextFile("lib/second-pushed-file.ts");

      assertEquals(secondContent, "export const second = true;");
      assertEquals(listAllFilesCalls, 3);
    });

    it("refreshes a stale branch snapshot when resolveFile returns a cached miss", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const staleFiles = [{
        path: "components/GraphViewer.tsx",
        content: "import '../lib/graph-performance';",
      }];
      const refreshedFiles = [
        ...staleFiles,
        {
          path: "lib/graph-performance.ts",
          content: "export const chooseSampleSize = () => 10000;",
        },
      ];

      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
          searchFiles: (_pattern: string) => Promise<Array<{ path: string }>>;
        };
      }).client;

      stubClientInitialization(client);
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve(listAllFilesCalls === 1 ? staleFiles : refreshedFiles);
      };
      client.searchFiles = () => Promise.resolve([]);

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      assertEquals(
        await adapter.resolveFile("components/GraphViewer"),
        "components/GraphViewer.tsx",
      );

      const branchSourcePrefix = buildFileCacheKeyPrefix(adapter.getContentContext());
      let resolvedPath: string | null;
      try {
        addPendingInvalidation(branchSourcePrefix);
        resolvedPath = await adapter.resolveFile("lib/graph-performance");
      } finally {
        removePendingInvalidation(branchSourcePrefix);
      }

      assertEquals(resolvedPath, "lib/graph-performance.ts");
      assertEquals(listAllFilesCalls, 3);
    });

    it("does not refresh a normal resolveFile miss without pending branch invalidation", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
          searchFiles: (_pattern: string) => Promise<Array<{ path: string }>>;
        };
      }).client;

      stubClientInitialization(client);
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve([{
          path: "pages/index.tsx",
          content: "export default function Page() { return null; }",
        }]);
      };
      client.searchFiles = () => Promise.resolve([]);

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();

      const resolvedPath = await adapter.resolveFile("optional/missing-page");

      assertEquals(resolvedPath, null);
      assertEquals(listAllFilesCalls, 1);
    });

    it("refreshes a stale branch snapshot when readdir sees a new empty directory miss", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const staleFiles = [{
        path: "components/GraphViewer.tsx",
        content: "import '../lib/graph-performance';",
      }];
      const refreshedFiles = [
        ...staleFiles,
        {
          path: "lib/graph-performance.ts",
          content: "export const chooseSampleSize = () => 10000;",
        },
      ];

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

      stubClientInitialization(client);
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve(listAllFilesCalls === 1 ? staleFiles : refreshedFiles);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      assertEquals((await adapter.readdir("components")).map((entry) => entry.path), [
        "components/GraphViewer.tsx",
      ]);

      const branchSourcePrefix = buildFileCacheKeyPrefix(adapter.getContentContext());
      let entries: Array<{ path: string }>;
      try {
        addPendingInvalidation(branchSourcePrefix);
        entries = await adapter.readdir("lib");
      } finally {
        removePendingInvalidation(branchSourcePrefix);
      }

      assertEquals(entries.map((entry) => entry.path), ["lib/graph-performance.ts"]);
      assertEquals(listAllFilesCalls, 3);
    });

    it("does not refresh a normal empty directory listing without pending branch invalidation", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

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

      stubClientInitialization(client);
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve([{
          path: "pages/index.tsx",
          content: "export default function Page() { return null; }",
        }]);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();

      const entries = await adapter.readdir("optional");

      assertEquals(entries, []);
      assertEquals(listAllFilesCalls, 1);
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
          listAllEnvironmentFiles: (
            environmentName: string,
          ) => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      stubClientInitialization(client);
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
          listAllEnvironmentFiles: (
            environmentName: string,
          ) => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      stubClientInitialization(client);
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

    it("uses injected style pregeneration during published initialization", async () => {
      let pregenerationCalls = 0;
      const files = [{
        path: "pages/index.tsx",
        content: "export default function Page() { return <main /> }",
      }];

      const adapter = createAdapter({
        projectDir: "/tmp/test-project",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
        styleCallbacks: {
          pregenerateStyles: async (receivedFiles, context) => {
            pregenerationCalls++;
            assertEquals(receivedFiles, files);
            assertEquals(context.projectSlug, "test-project");
            assertEquals(context.projectDir, "/tmp/test-project");
            assertEquals(context.contentContext?.sourceType, "environment");
            return { hash: "hash-1", assetPath: "/_vf/css/hash-1.css" };
          },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
          listPublishedFiles: (
            projectId?: string,
            releaseId?: string,
          ) => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      stubClientInitialization(client);
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => Promise.resolve(files);
      client.listPublishedFiles = (projectId, releaseId) => {
        assertEquals(projectId, undefined);
        assertEquals(releaseId, "release-123");
        return Promise.resolve(files);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      adapter.setContentContext({
        sourceType: "environment",
        projectSlug: "test-project",
        environmentName: "production",
        releaseId: "release-123",
      });

      await adapter.initialize();

      await waitFor(async () => pregenerationCalls === 1);
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

      stubClientInitialization(client);
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

      stubClientInitialization(client);
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
