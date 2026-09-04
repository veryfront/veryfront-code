import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildStatCacheKeyPrefix,
} from "./cache-keys.ts";
import { createAdapter, seedCachedFiles, waitFor } from "./adapter.test-helpers.ts";
import type { ResolvedContentContext } from "./types.ts";
import {
  addPendingInvalidation,
  clearAllPendingInvalidations,
  removePendingInvalidation,
} from "./invalidation-state.ts";
import {
  clearReleaseAssetManifestCache,
  getReadyManifestForRender,
  getReadyManifestForRenderAsync,
} from "#veryfront/release-assets/manifest-cache.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "#veryfront/release-assets/constants.ts";

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
      "readFileBytesWithinLimit",
      "getAllSourceFiles",
      "getEntityIdForPath",
      "getFilePathByEntityId",
      "getPokeMetrics",
      "getClient",
      "refreshSourceSnapshot",
      "ensureSourceSnapshotFresh",
      "getSourceSnapshotVersion",
      "getSourceSnapshotFingerprint",
    ] as const;

    for (const method of methods) {
      it(`should have ${method} method`, () => {
        assertEquals(typeof (createAdapter() as any)[method], "function");
      });
    }
  });

  describe("credential-bearing read dispatch", () => {
    it("does not expose the adapter to a project-mutated recovery hook", async () => {
      const adapter = createAdapter();
      const internals = adapter as unknown as {
        initialized: boolean;
        readOps: { readTextFile(path: string): Promise<string> };
      };
      internals.initialized = true;
      internals.readOps.readTextFile = () => Promise.resolve("safe content");

      const prototype = VeryfrontFSAdapter.prototype as unknown as Record<string, unknown>;
      const previousRecovery = Object.getOwnPropertyDescriptor(
        prototype,
        "withBranchSnapshotRecovery",
      );
      let observedToken: string | undefined;
      Object.defineProperty(prototype, "withBranchSnapshotRecovery", {
        configurable: true,
        writable: true,
        value: async function (
          this: { activeRequestToken?: string },
          _path: string,
          operation: () => Promise<string>,
        ): Promise<string> {
          observedToken = this.activeRequestToken;
          return await operation();
        },
      });

      try {
        assertEquals(await adapter.readTextFile("veryfront.config.ts"), "safe content");
      } finally {
        if (previousRecovery) {
          Object.defineProperty(prototype, "withBranchSnapshotRecovery", previousRecovery);
        } else {
          Reflect.deleteProperty(prototype, "withBranchSnapshotRecovery");
        }
      }

      assertEquals(observedToken, undefined);
    });

    it("keeps initialization independent of project-mutated internal capabilities", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          projectId: "test-project-id",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
      });
      const internals = adapter as unknown as {
        client: {
          initialize(): Promise<void>;
          getProjectSlug(): string;
          getProjectId(): string;
          getCachedProject(): { provider: string; layout: string };
          listAllFiles(): Promise<Array<{ path: string; content: string }>>;
        };
        wsManager: { connect(projectId: string): void };
      };
      internals.client.initialize = () => Promise.resolve();
      internals.client.getProjectSlug = () => "test-project";
      internals.client.getProjectId = () => "test-project-id";
      internals.client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      internals.client.listAllFiles = () => Promise.resolve([]);
      internals.wsManager.connect = () => {};

      const originalNow = Object.getOwnPropertyDescriptor(performance, "now");
      const prototype = VeryfrontFSAdapter.prototype as unknown as Record<string, unknown>;
      const capabilityNames = ["performInitialization", "runSourceSnapshotMutation"];
      const originalCapabilities = capabilityNames.map((name) =>
        [name, Object.getOwnPropertyDescriptor(prototype, name)] as const
      );
      let poisonedCalls = 0;
      Object.defineProperty(performance, "now", {
        configurable: true,
        value: () => {
          poisonedCalls += 1;
          throw new Error("project performance hook must not run");
        },
      });
      for (const name of capabilityNames) {
        Object.defineProperty(prototype, name, {
          configurable: true,
          value: () => {
            poisonedCalls += 1;
            throw new Error(`project ${name} hook must not run`);
          },
        });
      }
      try {
        await adapter.initialize();
      } finally {
        if (originalNow === undefined) Reflect.deleteProperty(performance, "now");
        else Object.defineProperty(performance, "now", originalNow);
        for (const [name, descriptor] of originalCapabilities) {
          if (descriptor === undefined) Reflect.deleteProperty(prototype, name);
          else Object.defineProperty(prototype, name, descriptor);
        }
        adapter.dispose();
      }

      assertEquals(poisonedCalls, 0);
    });
  });

  describe("bounded byte reads", () => {
    it("delegates to the exact reader after bounded context initialization", async () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          projectId: "test-project-id",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
      });
      let exactCall: [string, number] | undefined;
      const internals = adapter as unknown as {
        readOps: {
          readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array>;
        };
      };
      internals.readOps.readFileBytesWithinLimit = (path, byteLimit) => {
        exactCall = [path, byteLimit];
        return Promise.resolve(new Uint8Array([7, 8]));
      };

      assertEquals([...await adapter.readFileBytesWithinLimit("manifest.json", 2)], [7, 8]);
      assertEquals(exactCall, ["manifest.json", 2]);
    });

    it("refreshes and retries a bounded branch read after a not-found miss", async () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          projectId: "test-project-id",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
      });
      const exactCalls: Array<[string, number]> = [];
      let refreshCalls = 0;
      const internals = adapter as unknown as {
        initialized: boolean;
        readOps: {
          readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array>;
        };
        client: {
          listAllFiles(): Promise<Array<{ path: string; content: string }>>;
        };
      };
      internals.initialized = true;
      internals.readOps.readFileBytesWithinLimit = (path, byteLimit) => {
        exactCalls.push([path, byteLimit]);
        return exactCalls.length === 1
          ? Promise.reject(new Error(`404 Not Found: ${path}`))
          : Promise.resolve(new Uint8Array([9, 8]));
      };
      internals.client.listAllFiles = () => {
        refreshCalls++;
        return Promise.resolve([]);
      };

      assertEquals([...await adapter.readFileBytesWithinLimit("manifest.json", 2)], [9, 8]);
      assertEquals(exactCalls, [
        ["manifest.json", 2],
        ["manifest.json", 2],
      ]);
      assertEquals(refreshCalls, 1);
    });

    it("rejects an invalid limit before initialization", async () => {
      const adapter = createAdapter();
      let initializeCalls = 0;
      (adapter as unknown as { initialize(): Promise<void> }).initialize = () => {
        initializeCalls++;
        return Promise.resolve();
      };

      await assertRejects(
        () => adapter.readFileBytesWithinLimit("manifest.json", 0),
        RangeError,
        "positive safe integer",
      );
      assertEquals(initializeCalls, 0);
    });
  });

  describe("request tokens", () => {
    it("syncs request-scoped tokens into the WebSocket manager", () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "static-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      let websocketToken: string | undefined;

      (adapter as unknown as { wsManager: { setApiToken: (token: string) => void } }).wsManager = {
        setApiToken: (token: string) => {
          websocketToken = token;
        },
      };

      adapter.setRequestToken("fresh-request-token");
      assertEquals(websocketToken, "fresh-request-token");

      adapter.clearRequestToken();
      assertEquals(websocketToken, "static-token");
    });

    it("invalidates snapshots and cached file lists across request-authority changes", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "static-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });
      seedCachedFiles(adapter, [{ path: "tenant-a.ts", content: "tenant-a" }]);

      const internals = adapter as unknown as {
        getCachedFileListSync(): Array<{ path: string; content?: string }> | undefined;
        initialized: boolean;
        sourceSnapshotCheckedAt: number;
        sourceSnapshotIdentity: string | undefined;
        sourceSnapshotFiles: Array<{ path: string; content?: string }> | undefined;
        sourceSnapshotRefreshPromise: Promise<void> | null;
      };
      internals.initialized = true;
      internals.sourceSnapshotIdentity = adapter.getSourceSnapshotIdentity();
      internals.sourceSnapshotCheckedAt = Date.now();
      internals.sourceSnapshotFiles = [{ path: "tenant-a.ts", content: "tenant-a" }];
      internals.sourceSnapshotRefreshPromise = new Promise(() => {});
      assertEquals(internals.getCachedFileListSync()?.[0]?.path, "tenant-a.ts");

      const before = adapter.getSourceSnapshotVersion();

      adapter.setRequestToken("tenant-token");
      assertEquals(internals.getCachedFileListSync(), undefined);
      assertEquals(internals.sourceSnapshotRefreshPromise, null);
      adapter.setRequestToken("static-token");

      assertEquals(adapter.getSourceSnapshotVersion() > before, true);
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

      (adapter.getClient() as unknown as {
        getReleaseAssetManifest: (releaseId: string) => Promise<{
          state: string;
          manifest: unknown;
        }>;
      }).getReleaseAssetManifest = async (requestedReleaseId: string) => {
        fetchCount++;
        assertEquals(requestedReleaseId, releaseId);
        return {
          state: "ready",
          manifest_version: 2,
          manifest: {
            schemaVersion: 2,
            projectId: "project-123",
            releaseId,
            releaseVersion: 1,
            manifestVersion: 2,
            builderVersion: "0.1.765",
            sourceContentHash: "a".repeat(64),
            createdAt: "2026-06-12T00:00:00.000Z",
            assetBasePath: "/_vf/assets",
            dependencyMode: "source",
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

    it("should stop awaiting a manifest request when the release context loses ownership", async () => {
      setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
      const releaseId = "release-env-abort";
      const adapter = createAdapter();
      let requestStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        requestStarted = resolve;
      });
      const neverSettles = new Promise<never>(() => {});
      let requestSignal: AbortSignal | undefined;

      (adapter.getClient() as unknown as {
        getReleaseAssetManifest: (
          releaseId: string,
          projectRef?: string,
          signal?: AbortSignal,
        ) => Promise<never>;
      }).getReleaseAssetManifest = (requestedReleaseId, _projectRef, signal) => {
        assertEquals(requestedReleaseId, releaseId);
        requestSignal = signal;
        requestStarted();
        return neverSettles;
      };

      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId,
      });
      const manifest = getReadyManifestForRenderAsync(releaseId);
      await started;

      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-env-next",
      });

      assertEquals(requestSignal?.aborted, true);
      assertEquals(await manifest, null);
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
        getReleaseAssetManifest: (releaseId: string) => Promise<{
          state: string;
          manifest: unknown;
        }>;
      };
      client.initialize = () => Promise.resolve();
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
      client.getReleaseAssetManifest = async (requestedReleaseId) => {
        fetchCount++;
        assertEquals(requestedReleaseId, releaseId);
        return {
          state: "ready",
          manifest_version: 3,
          manifest: {
            schemaVersion: 2,
            projectId: "project-123",
            releaseId,
            releaseVersion: 1,
            manifestVersion: 3,
            builderVersion: "0.1.792",
            sourceContentHash: "a".repeat(64),
            createdAt: "2026-06-12T00:00:00.000Z",
            assetBasePath: "/_vf/assets",
            dependencyMode: "source",
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

      (adapter.getClient() as unknown as {
        getReleaseAssetManifest: (releaseId: string) => Promise<{
          state: string;
          manifest: unknown;
        }>;
      }).getReleaseAssetManifest = async (requestedReleaseId: string) => {
        fetchCount++;
        assertEquals(requestedReleaseId, releaseId);
        return {
          state: "ready",
          manifest_version: 1,
          manifest: {
            schemaVersion: 2,
            projectId: "project-123",
            releaseId,
            releaseVersion: 1,
            manifestVersion: 1,
            builderVersion: "0.1.765",
            sourceContentHash: "a".repeat(64),
            createdAt: "2026-06-12T00:00:00.000Z",
            assetBasePath: "/_vf/assets",
            dependencyMode: "source",
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

      const statOps = (adapter as unknown as { statOps: { clearIndex: () => void } }).statOps;
      const dirOps = (adapter as unknown as { dirOps: { clearTree: () => void } }).dirOps;
      // The read path's file-list index caches file contents keyed only on the
      // listing's length and its first and last path, so two contexts that
      // agree on those would otherwise serve each other's file contents.
      const readOps =
        (adapter as unknown as { readOps: { clearFileListIndex: () => void } }).readOps;
      const originalClearIndex = statOps.clearIndex;
      const originalClearTree = dirOps.clearTree;
      const originalClearFileListIndex = readOps.clearFileListIndex;
      let indexClears = 0;
      let treeClears = 0;
      let fileListIndexClears = 0;
      statOps.clearIndex = () => {
        indexClears++;
        originalClearIndex.call(statOps);
      };
      dirOps.clearTree = () => {
        treeClears++;
        originalClearTree.call(dirOps);
      };
      readOps.clearFileListIndex = () => {
        fileListIndexClears++;
        originalClearFileListIndex.call(readOps);
      };

      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-new",
      });

      assertEquals(adapter.getContentContext()?.releaseId, "release-new");
      assertEquals(indexClears, 1, "a release switch must clear the stat index");
      assertEquals(treeClears, 1, "a release switch must clear the directory tree");
      assertEquals(fileListIndexClears, 1, "a release switch must clear the file list index");

      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-new",
      });

      assertEquals(indexClears, 1, "an unchanged context must not clear the stat index");
      assertEquals(treeClears, 1, "an unchanged context must not clear the directory tree");
      assertEquals(
        fileListIndexClears,
        1,
        "an unchanged context must not clear the file list index",
      );
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

    it("detects a source-context ABA change during an in-flight exact read", async () => {
      const adapter = createAdapter();
      const originalContext: ResolvedContentContext = {
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-a",
      };
      adapter.setContentContext(originalContext);
      const before = adapter.getSourceSnapshotVersion();
      const readStarted = Promise.withResolvers<void>();
      const releaseRead = Promise.withResolvers<void>();
      const internals = adapter as unknown as {
        client: { isInitialized(): boolean };
        readOps: {
          readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array>;
        };
      };
      internals.client.isInitialized = () => true;
      internals.readOps.readFileBytesWithinLimit = async () => {
        readStarted.resolve();
        await releaseRead.promise;
        return new Uint8Array([1]);
      };

      const pendingRead = adapter.readFileBytesWithinLimit("config.json", 1);
      await readStarted.promise;
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-b",
      });
      adapter.setContentContext(originalContext);
      releaseRead.resolve();

      assertEquals([...(await pendingRead)], [1]);
      assertEquals(adapter.getSourceSnapshotVersion() > before, true);
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

    it("retains file-cache tiers when only the request branch changes", () => {
      const adapter = createAdapter();
      const cache = (adapter as unknown as { cache: { clear(): void } }).cache;
      const originalClear = cache.clear.bind(cache);
      let clearCalls = 0;
      cache.clear = () => {
        clearCalls++;
        originalClear();
      };

      adapter.setRequestBranch("feature-branch");
      adapter.clearRequestBranch();
      assertEquals(clearCalls, 0);

      adapter.setRequestToken("replacement-token");
      assertEquals(clearCalls, 1, "credential changes still clear the file cache");
    });

    it("names the snapshot identity after the per-request branch", () => {
      const adapter = createAdapter();
      assertEquals(
        adapter.getSourceSnapshotIdentity(),
        undefined,
        "without a content context there is no identity to name",
      );

      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });
      assertEquals(adapter.getSourceSnapshotIdentity(), "branch:test-project:main");

      // A request-scoped branch override retargets the snapshot, so freshness
      // established for the previous identity must be detectable as stale.
      adapter.setRequestBranch("feature");
      assertEquals(adapter.getSourceSnapshotIdentity(), "branch:test-project:feature");

      adapter.clearRequestBranch();
      assertEquals(adapter.getSourceSnapshotIdentity(), "branch:test-project:main");
    });

    it("reads retained file lists from the per-request branch", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });
      const mainContext: ResolvedContentContext = {
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      };
      const featureContext: ResolvedContentContext = {
        ...mainContext,
        branch: "feature",
      };
      adapter.setContentContext(mainContext);
      const cache = (adapter as unknown as {
        cache: { set(key: string, value: Array<{ path: string; content: string }>): void };
      }).cache;
      cache.set(buildFileListCacheKey(mainContext), [{ path: "main.css", content: "main" }]);
      cache.set(buildFileListCacheKey(featureContext), [{
        path: "feature.css",
        content: "feature",
      }]);

      adapter.setRequestBranch("feature");

      assertEquals(await adapter.getAllSourceFiles(), [{
        path: "feature.css",
        content: "feature",
      }]);
    });
  });

  describe("source snapshot fingerprints", () => {
    it("identifies snapshot contents independently of file-list order", async () => {
      const adapter = createAdapter();
      const internals = adapter as unknown as {
        sourceSnapshotFiles: Array<{
          path: string;
          version_id?: string;
          content?: string;
        }>;
        sourceSnapshotVersion: number;
      };
      internals.sourceSnapshotFiles = [
        { path: "pages/index.tsx", version_id: "version-1", content: "first" },
        { path: "veryfront.config.ts", version_id: "version-2", content: "second" },
      ];
      const first = await adapter.getSourceSnapshotFingerprint();

      internals.sourceSnapshotVersion += 1;
      internals.sourceSnapshotFiles = [...internals.sourceSnapshotFiles].reverse();
      const reordered = await adapter.getSourceSnapshotFingerprint();

      internals.sourceSnapshotVersion += 1;
      internals.sourceSnapshotFiles[0] = {
        ...internals.sourceSnapshotFiles[0],
        path: internals.sourceSnapshotFiles[0]!.path,
        version_id: "version-3",
      };
      const changed = await adapter.getSourceSnapshotFingerprint();

      assertEquals(reordered, first);
      assertNotEquals(changed, first);
    });

    it("does not consult project-mutated Array serialization hooks", async () => {
      const adapter = createAdapter();
      const internals = adapter as unknown as {
        sourceSnapshotFiles: Array<{ path: string; content?: string }>;
        sourceSnapshotVersion: number;
      };
      const previousToJSON = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      let first: string | undefined;
      let changed: string | undefined;

      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value: () => ["constant-fingerprint"],
      });
      try {
        internals.sourceSnapshotFiles = [{ path: "pages/index.tsx", content: "first" }];
        first = await adapter.getSourceSnapshotFingerprint();

        internals.sourceSnapshotVersion += 1;
        internals.sourceSnapshotFiles = [{ path: "pages/index.tsx", content: "second" }];
        changed = await adapter.getSourceSnapshotFingerprint();
      } finally {
        if (previousToJSON) {
          Object.defineProperty(Array.prototype, "toJSON", previousToJSON);
        } else {
          Reflect.deleteProperty(Array.prototype, "toJSON");
        }
      }

      assertNotEquals(changed, first);
    });

    it("does not populate fingerprint records through inherited array setters", async () => {
      const adapter = createAdapter();
      const internals = adapter as unknown as {
        sourceSnapshotFiles: Array<{ path: string; content?: string }>;
        sourceSnapshotVersion: number;
      };
      const previousIndex = Object.getOwnPropertyDescriptor(Array.prototype, "0");
      let setterCalls = 0;
      let firstHash: Promise<string | undefined> | undefined;
      let changedHash: Promise<string | undefined> | undefined;

      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set: () => {
          setterCalls += 1;
        },
      });
      try {
        internals.sourceSnapshotFiles = [{ path: "pages/index.tsx", content: "first" }];
        firstHash = adapter.getSourceSnapshotFingerprint();

        internals.sourceSnapshotVersion += 1;
        internals.sourceSnapshotFiles = [{ path: "pages/index.tsx", content: "second" }];
        changedHash = adapter.getSourceSnapshotFingerprint();
      } finally {
        if (previousIndex) {
          Object.defineProperty(Array.prototype, "0", previousIndex);
        } else {
          Reflect.deleteProperty(Array.prototype, "0");
        }
      }

      if (!firstHash || !changedHash) throw new Error("Fingerprint hashing did not start");
      assertNotEquals(await changedHash, await firstHash);
      assertEquals(setterCalls, 0);
    });

    it("does not iterate through a mutable source-list hook", async () => {
      const adapter = createAdapter();
      const files = [{ path: "pages/index.tsx", content: "source" }];
      Object.defineProperty(files, Symbol.iterator, {
        configurable: true,
        value: () => {
          throw new Error("source-list iterator must not run");
        },
      });
      const internals = adapter as unknown as {
        sourceSnapshotFiles: Array<{ path: string; content?: string }>;
      };
      internals.sourceSnapshotFiles = files;

      assertEquals(typeof await adapter.getSourceSnapshotFingerprint(), "string");
    });

    it("does not read source snapshot fields through inherited accessors", async () => {
      const adapter = createAdapter();
      let inheritedGetterCalls = 0;
      const inheritedFields = {
        get path(): string {
          inheritedGetterCalls += 1;
          return "pages/inherited.tsx";
        },
        get content(): string {
          inheritedGetterCalls += 1;
          return "inherited source";
        },
      };
      const file = Object.create(inheritedFields) as { path: string; content?: string };
      const internals = adapter as unknown as {
        sourceSnapshotFiles: Array<{ path: string; content?: string }>;
      };
      internals.sourceSnapshotFiles = [file];

      assertEquals(await adapter.getSourceSnapshotFingerprint(), undefined);
      assertEquals(inheritedGetterCalls, 0);
    });

    it("fingerprints a snapshot larger than the former aggregate byte cap", async () => {
      const adapter = createAdapter();
      const internals = adapter as unknown as {
        sourceSnapshotFiles: Array<{ path: string; content?: string }>;
      };
      internals.sourceSnapshotFiles = [{
        path: "pages/oversized.tsx",
        content: "x".repeat(32 * 1_024 * 1_024),
      }];

      let timerRan = false;
      const timer = setTimeout(() => {
        timerRan = true;
      }, 0);
      try {
        assertEquals(typeof await adapter.getSourceSnapshotFingerprint(), "string");
        assertEquals(timerRan, true, "large source contents must yield to the task queue");
      } finally {
        clearTimeout(timer);
      }
    });

    it("fingerprints a snapshot larger than the former file-count cap", async () => {
      const adapter = createAdapter();
      const internals = adapter as unknown as {
        sourceSnapshotFiles: Array<{ path: string; content?: string }>;
      };
      internals.sourceSnapshotFiles = Array.from({ length: 10_001 }, (_, index) => ({
        path: `pages/generated-${index}.tsx`,
      }));

      let timerRan = false;
      const timer = setTimeout(() => {
        timerRan = true;
      }, 0);
      try {
        assertEquals(typeof await adapter.getSourceSnapshotFingerprint(), "string");
        assertEquals(timerRan, true, "large fingerprints must yield to the task queue");
      } finally {
        clearTimeout(timer);
      }
    });

    it("makes the fingerprint unavailable when a POKE invalidates the source", async () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });
      const internals = adapter as unknown as {
        sourceSnapshotCheckedAt: number;
        sourceSnapshotFiles: Array<{ path: string; content?: string }> | undefined;
        sourceSnapshotFingerprint: { version: number; value: Promise<string> } | undefined;
        sourceSnapshotIdentity: string | undefined;
        wsManager: { deps: { clearMemoryCaches: () => void } };
      };
      internals.sourceSnapshotFiles = [{ path: "pages/index.tsx", content: "old source" }];
      internals.sourceSnapshotIdentity = adapter.getSourceSnapshotIdentity();
      internals.sourceSnapshotCheckedAt = Date.now();
      assertEquals(typeof await adapter.getSourceSnapshotFingerprint(), "string");

      internals.wsManager.deps.clearMemoryCaches();

      assertEquals(await adapter.getSourceSnapshotFingerprint(), undefined);
      assertEquals(internals.sourceSnapshotFiles, undefined);
      assertEquals(internals.sourceSnapshotIdentity, undefined);
      assertEquals(internals.sourceSnapshotCheckedAt, 0);
      assertEquals(internals.sourceSnapshotFingerprint, undefined);
    });

    it("withholds an in-flight fingerprint invalidated by a POKE", async () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });
      const internals = adapter as unknown as {
        sourceSnapshotFiles: Array<{ path: string; content?: string }> | undefined;
        wsManager: { deps: { clearMemoryCaches: () => void } };
      };
      internals.sourceSnapshotFiles = [{
        path: "pages/index.tsx",
        content: "source being hashed",
      }];

      const pendingFingerprint = adapter.getSourceSnapshotFingerprint();
      internals.wsManager.deps.clearMemoryCaches();

      assertEquals(await pendingFingerprint, undefined);
    });
  });

  describe("dispose", () => {
    it("should clear the cache, bump the snapshot generation and allow re-initialization", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let listAllFilesCalls = 0;
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve([{
          path: "pages/index.tsx",
          version_id: "v1",
          content: "hello",
        }]);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      assertEquals(await adapter.readTextFile("pages/index.tsx"), "hello");

      const versionBeforeDispose = adapter.getSourceSnapshotVersion();
      const internals = adapter as unknown as {
        sourceSnapshotCheckedAt: number;
        sourceSnapshotIdentity: string | undefined;
        sourceSnapshotFiles: Array<{ path: string; content?: string }> | undefined;
        sourceSnapshotFingerprint: { version: number; value: Promise<string> } | undefined;
      };
      internals.sourceSnapshotCheckedAt = Date.now();
      internals.sourceSnapshotIdentity = "branch:test-project:main";
      internals.sourceSnapshotFiles = [{ path: "pages/index.tsx", content: "hello" }];
      await adapter.getSourceSnapshotFingerprint();
      assertEquals(
        adapter.getCacheStats().cache.size > 0,
        true,
        "an initialized read must leave something in the file cache",
      );
      const callsBeforeDispose = listAllFilesCalls;

      adapter.dispose();

      assertEquals(adapter.getCacheStats().cache.size, 0, "dispose clears the file cache");
      assertNotEquals(
        adapter.getSourceSnapshotVersion(),
        versionBeforeDispose,
        "dispose bumps the source snapshot generation",
      );
      assertEquals(internals.sourceSnapshotCheckedAt, 0);
      assertEquals(internals.sourceSnapshotIdentity, undefined);
      assertEquals(internals.sourceSnapshotFiles, undefined);
      assertEquals(internals.sourceSnapshotFingerprint, undefined);

      await adapter.initialize();
      assertEquals(
        listAllFilesCalls > callsBeforeDispose,
        true,
        "dispose resets initialized so a later initialize re-fetches",
      );
    });

    it("should allow calling dispose multiple times", () => {
      const adapter = createAdapter();
      adapter.dispose();
      const versionAfterFirst = adapter.getSourceSnapshotVersion();

      adapter.dispose();

      assertNotEquals(
        adapter.getSourceSnapshotVersion(),
        versionAfterFirst,
        "every dispose bumps the source snapshot generation",
      );
      assertEquals(
        adapter.getCacheStats().cache.size,
        0,
        "the file cache stays cleared after a repeated dispose",
      );
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

    it("keeps a delayed cache miss bound to its original request branch", async () => {
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
      (adapter as unknown as { initialized: boolean }).initialized = true;

      const mainContext = {
        sourceType: "branch" as const,
        projectSlug: "test-project",
        branch: "main",
      };
      const mainCacheKey = buildFileListCacheKey(mainContext);
      const cache = (adapter as unknown as {
        cache: {
          getAsync: <T>(key: string) => Promise<T | undefined>;
        };
      }).cache;
      const originalGetAsync = cache.getAsync.bind(cache);
      let releaseLookup: (() => void) | undefined;
      const lookupBlocked = new Promise<void>((resolve) => {
        releaseLookup = resolve;
      });
      let markLookupStarted: (() => void) | undefined;
      const lookupStarted = new Promise<void>((resolve) => {
        markLookupStarted = resolve;
      });
      let blockNextMainLookup = true;
      cache.getAsync = async <T>(key: string): Promise<T | undefined> => {
        if (blockNextMainLookup && key === mainCacheKey) {
          blockNextMainLookup = false;
          markLookupStarted?.();
          await lookupBlocked;
        }
        return await originalGetAsync<T>(key);
      };

      const requestedBranches: string[] = [];
      const client = (adapter as unknown as {
        client: {
          listAllFiles: (
            params: Record<string, never>,
            source: { type: "branch"; name: string },
          ) => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;
      client.listAllFiles = (_params, source) => {
        requestedBranches.push(source.name);
        return Promise.resolve([{
          path: `${source.name}.ts`,
          content: `export const branch = "${source.name}";`,
        }]);
      };

      const pending = adapter.getAllSourceFiles({ waitForWarmup: true });
      await lookupStarted;
      adapter.setRequestBranch("draft");
      releaseLookup?.();

      assertEquals(await pending, []);
      assertEquals(requestedBranches, ["main"]);
      assertEquals(await originalGetAsync(mainCacheKey), undefined);
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
          listAllFiles: (
            options?: unknown,
            context?: { type: string; name?: string; version?: string },
          ) => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let observedContext: ReturnType<typeof client.getContext> | null = null;
      client.listAllFiles = (_options, context) => {
        observedContext = context ?? client.getContext();
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

    it("discards initialization files when the request branch changes during cache write", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });
      const internals = adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          getContext: () => { type: string; name?: string };
          listAllFiles: () => Promise<Array<{ path: string; content: string }>>;
        };
        cache: {
          setAsync: (key: string, value: unknown) => Promise<void>;
        };
        wsManager: { connect: (_projectId: string) => void };
      };

      internals.client.initialize = () => Promise.resolve();
      internals.client.getProjectSlug = () => "test-project";
      internals.client.getProjectId = () => "project-123";
      internals.client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let listAllFilesCalls = 0;
      internals.client.listAllFiles = () => {
        listAllFilesCalls++;
        const branch = internals.client.getContext().name ?? "main";
        return Promise.resolve([{
          path: "pages/index.tsx",
          content: branch,
        }]);
      };
      internals.wsManager.connect = () => {};

      const setStarted = Promise.withResolvers<void>();
      const releaseSet = Promise.withResolvers<void>();
      const setAsync = internals.cache.setAsync.bind(internals.cache);
      let setCalls = 0;
      internals.cache.setAsync = async (key, value) => {
        setCalls++;
        if (setCalls === 1) {
          setStarted.resolve();
          await releaseSet.promise;
        }
        await setAsync(key, value);
      };

      const initialization = adapter.initialize();
      await setStarted.promise;
      adapter.setRequestBranch("draft");
      releaseSet.resolve();
      await initialization;

      assertEquals(await adapter.readTextFile("pages/index.tsx"), "draft");
      assertEquals(listAllFilesCalls, 2);
    });

    it("does not reuse a freshness lease after the request branch changes", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          getContext: () => { type: string; name?: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let listAllFilesCalls = 0;
      client.listAllFiles = () => {
        listAllFilesCalls++;
        const branch = client.getContext().name ?? "main";
        return Promise.resolve([{
          path: "pages/index.tsx",
          version_id: branch,
          content: branch,
        }]);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      assertEquals(await adapter.readTextFile("pages/index.tsx"), "main");

      adapter.setRequestBranch("draft");
      await adapter.ensureSourceSnapshotFresh("draft-request");

      assertEquals(listAllFilesCalls, 2);
      assertEquals(await adapter.readTextFile("pages/index.tsx"), "draft");

      adapter.clearRequestBranch();
      await adapter.ensureSourceSnapshotFresh("main-request");

      assertEquals(listAllFilesCalls, 3);
      assertEquals(await adapter.readTextFile("pages/index.tsx"), "main");
    });

    it("does not reuse a freshness lease when the draft content changed", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let listAllFilesCalls = 0;
      let draftContent = "v1";
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve([{
          path: "pages/index.tsx",
          version_id: draftContent,
          content: draftContent,
        }]);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      assertEquals(
        await adapter.readTextFile("pages/index.tsx"),
        "v1",
        "initialization must load the draft that existed at startup",
      );

      // The author edits the draft. The branch identity is unchanged, so the
      // lease clock is the only thing between that edit and the next render.
      draftContent = "v2";

      await adapter.ensureSourceSnapshotFresh("preview-ssr-render", { maxAgeMs: 0 });

      assertEquals(
        listAllFilesCalls,
        2,
        "a strict freshness check must consult the source authority instead of reusing the lease",
      );
      assertEquals(
        await adapter.readTextFile("pages/index.tsx"),
        "v2",
        "a strict freshness check must expose the edited draft, not the pre-edit snapshot",
      );
    });

    it("uses cold initialization as the zero-age source snapshot", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let listAllFilesCalls = 0;
      let draftContent = "v1";
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve([{
          path: "pages/index.tsx",
          version_id: draftContent,
          content: draftContent,
        }]);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.ensureSourceSnapshotFresh("preview-ssr-render", { maxAgeMs: 0 });

      assertEquals(
        listAllFilesCalls,
        1,
        "the listing fetched during cold initialization already satisfies this zero-age check",
      );
      assertEquals(await adapter.readTextFile("pages/index.tsx"), "v1");

      draftContent = "v2";
      (adapter as unknown as {
        wsManager: { deps: { clearMemoryCaches: () => void } };
      }).wsManager.deps.clearMemoryCaches();
      await adapter.ensureSourceSnapshotFresh(
        "invalidated-cold-document",
        { maxAgeMs: 0 },
        true,
      );

      assertEquals(
        listAllFilesCalls,
        2,
        "an invalidation must prevent the cold-initialization shortcut from accepting old authority",
      );
      assertEquals(await adapter.readTextFile("pages/index.tsx"), "v2");
    });

    it("singleflights concurrent cold strict initialization", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      const listingStarted = Promise.withResolvers<void>();
      const releaseListing = Promise.withResolvers<void>();
      let listAllFilesCalls = 0;
      let draftContent = "v1";
      client.listAllFiles = async () => {
        listAllFilesCalls++;
        const observedContent = draftContent;
        if (listAllFilesCalls === 1) {
          listingStarted.resolve();
          await releaseListing.promise;
        }
        return [{
          path: "pages/index.tsx",
          version_id: observedContent,
          content: observedContent,
        }];
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      const first = adapter.ensureSourceSnapshotFresh("first-cold-document", { maxAgeMs: 0 });
      const second = adapter.ensureSourceSnapshotFresh("second-cold-document", { maxAgeMs: 0 });
      await listingStarted.promise;
      assertEquals(
        listAllFilesCalls,
        1,
        "concurrent cold documents must join one initialization authority request",
      );

      releaseListing.resolve();
      await Promise.all([first, second]);
      assertEquals(await adapter.readTextFile("pages/index.tsx"), "v1");

      draftContent = "v2";
      await adapter.ensureSourceSnapshotFresh("later-strict-document", { maxAgeMs: 0 });
      assertEquals(listAllFilesCalls, 2, "only joined cold callers may reuse initialization");
      assertEquals(await adapter.readTextFile("pages/index.tsx"), "v2");
    });

    it("reuses a fresh lease when the caller accepts the default snapshot age", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let listAllFilesCalls = 0;
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve([{
          path: "pages/index.tsx",
          version_id: "v1",
          content: "v1",
        }]);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();

      // Sub-resource requests inside one page load must not fan out into a
      // fresh listing each: the default lease still absorbs them.
      await adapter.ensureSourceSnapshotFresh("preview-request-routing");
      await adapter.ensureSourceSnapshotFresh("preview-request-routing");

      assertEquals(
        listAllFilesCalls,
        1,
        "default-strictness callers must reuse the lease rather than re-list the source tree",
      );
    });

    it("refuses the lease under a zero age budget even when the clock steps backward", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let listAllFilesCalls = 0;
      let draftContent = "v1";
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve([{
          path: "pages/index.tsx",
          version_id: draftContent,
          content: draftContent,
        }]);
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();

      // A backward wall-clock step (NTP correction, host suspend) leaves the
      // recorded check in the future, so the measured lease age is negative.
      // A negative age is below every budget, so an age comparison alone would
      // hand a zero-budget caller the lease it refused.
      (adapter as unknown as { sourceSnapshotCheckedAt: number }).sourceSnapshotCheckedAt =
        Date.now() + 60_000;
      draftContent = "v2";

      await adapter.ensureSourceSnapshotFresh("preview-ssr-render", { maxAgeMs: 0 });

      assertEquals(
        listAllFilesCalls,
        2,
        "a zero age budget must bypass the lease unconditionally, not by comparing ages",
      );
      assertEquals(
        await adapter.readTextFile("pages/index.tsx"),
        "v2",
        "a backward clock step must not let a strict caller serve the pre-edit snapshot",
      );
    });

    it("discards an in-flight refresh when the request branch changes", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          getContext: () => { type: string; name?: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });

      let listAllFilesCalls = 0;
      let finishMainRefresh: (() => void) | undefined;
      client.listAllFiles = () => {
        listAllFilesCalls++;
        const branch = client.getContext().name ?? "main";
        const files = [{
          path: "pages/index.tsx",
          version_id: branch,
          content: branch,
        }];

        if (listAllFilesCalls !== 2) return Promise.resolve(files);
        return new Promise((resolve) => {
          finishMainRefresh = () => resolve(files);
        });
      };

      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      (adapter as unknown as { sourceSnapshotCheckedAt: number }).sourceSnapshotCheckedAt = 0;

      const mainRefresh = adapter.ensureSourceSnapshotFresh("main-request");
      await waitFor(async () => finishMainRefresh !== undefined);

      adapter.setRequestBranch("draft");
      const draftRefresh = adapter.ensureSourceSnapshotFresh("draft-request");
      finishMainRefresh?.();

      await Promise.all([mainRefresh, draftRefresh]);

      assertEquals(listAllFilesCalls, 3);
      assertEquals(await adapter.readTextFile("pages/index.tsx"), "draft");
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

      client.initialize = () => Promise.resolve();
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

    it("leases an unchanged branch snapshot without relying on the file-list cache", async () => {
      let routerInvalidations = 0;
      let ssrInvalidations = 0;
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
        invalidationCallbacks: {
          clearRouterDetectionCacheForProject: () => {
            routerInvalidations++;
          },
          clearSSRModuleCacheForProject: () => {
            ssrInvalidations++;
          },
        },
      });

      const firstFiles = [{
        path: "pages/review.tsx",
        version_id: "version-1",
        content: "export default function Review() { return null; }",
      }];
      const changedFiles = [{
        path: "app/review/page.tsx",
        version_id: "version-2",
        content: "export default function Review() { return null; }",
      }];
      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id?: string; content?: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = async () => {
        listAllFilesCalls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return listAllFilesCalls < 3 ? firstFiles : changedFiles;
      };
      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();

      const initialSnapshotVersion = adapter.getSourceSnapshotVersion();
      const initialSnapshotFiles = (adapter as unknown as {
        sourceSnapshotFiles: Array<{ path: string; version_id?: string; content?: string }>;
      }).sourceSnapshotFiles;
      assertEquals(initialSnapshotVersion > 0, true);
      assertEquals(listAllFilesCalls, 1);

      (adapter as unknown as { sourceSnapshotCheckedAt: number }).sourceSnapshotCheckedAt = 0;
      await Promise.all([
        adapter.ensureSourceSnapshotFresh("first-concurrent-check"),
        adapter.ensureSourceSnapshotFresh("second-concurrent-check"),
        adapter.ensureSourceSnapshotFresh("third-concurrent-check"),
      ]);

      assertEquals(listAllFilesCalls, 2);
      assertEquals(adapter.getSourceSnapshotVersion(), initialSnapshotVersion);
      assertStrictEquals(
        (adapter as unknown as { sourceSnapshotFiles: unknown }).sourceSnapshotFiles,
        initialSnapshotFiles,
      );
      assertEquals(typeof await adapter.getSourceSnapshotFingerprint(), "string");
      assertEquals(routerInvalidations, 0);
      assertEquals(ssrInvalidations, 0);

      (adapter as unknown as { sourceSnapshotCheckedAt: number }).sourceSnapshotCheckedAt = 0;
      await adapter.ensureSourceSnapshotFresh("changed-source-check");

      assertEquals(listAllFilesCalls, 3);
      assertEquals(adapter.getSourceSnapshotVersion() > initialSnapshotVersion, true);
      assertEquals(routerInvalidations, 1);
      assertEquals(ssrInvalidations, 1);
    });

    it("treats a repeated path that omits another file as a changed snapshot", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
      });
      const initialFiles = [
        { path: "pages/a.tsx", version_id: "version-a", content: "a" },
        { path: "pages/b.tsx", version_id: "version-b", content: "b" },
      ];
      const repeatedPathFiles = [
        { path: "pages/a.tsx", version_id: "version-a", content: "a" },
        { path: "pages/a.tsx", version_id: "version-a", content: "a" },
      ];
      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;
      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls += 1;
        return Promise.resolve(listAllFilesCalls === 1 ? initialFiles : repeatedPathFiles);
      };
      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      const initialVersion = adapter.getSourceSnapshotVersion();
      const initialFingerprint = await adapter.getSourceSnapshotFingerprint();
      assertEquals(typeof initialFingerprint, "string");
      (adapter as unknown as { sourceSnapshotCheckedAt: number }).sourceSnapshotCheckedAt = 0;

      const prototype = VeryfrontFSAdapter.prototype as unknown as Record<string, unknown>;
      const originalInvalidation = Object.getOwnPropertyDescriptor(
        prototype,
        "invalidateDerivedSourceCaches",
      );
      const originalIdentityLookup = Object.getOwnPropertyDescriptor(
        prototype,
        "getCurrentSourceSnapshotIdentity",
      );
      let poisonedInvalidations = 0;
      let poisonedIdentityLookups = 0;
      Object.defineProperty(prototype, "invalidateDerivedSourceCaches", {
        configurable: true,
        value: () => {
          poisonedInvalidations += 1;
          throw new Error("project invalidation hook must not run");
        },
      });
      Object.defineProperty(prototype, "getCurrentSourceSnapshotIdentity", {
        configurable: true,
        value: () => {
          poisonedIdentityLookups += 1;
          throw new Error("project identity hook must not run");
        },
      });
      try {
        await adapter.ensureSourceSnapshotFresh("duplicate-path-refresh");
      } finally {
        if (originalInvalidation === undefined) {
          Reflect.deleteProperty(prototype, "invalidateDerivedSourceCaches");
        } else {
          Object.defineProperty(
            prototype,
            "invalidateDerivedSourceCaches",
            originalInvalidation,
          );
        }
        if (originalIdentityLookup === undefined) {
          Reflect.deleteProperty(prototype, "getCurrentSourceSnapshotIdentity");
        } else {
          Object.defineProperty(
            prototype,
            "getCurrentSourceSnapshotIdentity",
            originalIdentityLookup,
          );
        }
      }

      assertEquals(listAllFilesCalls, 2);
      assertEquals(poisonedInvalidations, 0);
      assertEquals(poisonedIdentityLookups, 0);
      assertNotEquals(adapter.getSourceSnapshotVersion(), initialVersion);
      assertEquals(await adapter.getSourceSnapshotFingerprint(), undefined);
    });

    it("detects changed branch snapshots when Array.prototype.every is replaced", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
      });
      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve([{
          path: "pages/review.tsx",
          version_id: `version-${listAllFilesCalls}`,
          content: `export const version = ${listAllFilesCalls};`,
        }]);
      };
      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      const initialVersion = adapter.getSourceSnapshotVersion();
      const initialFingerprint = await adapter.getSourceSnapshotFingerprint();
      const previousEvery = Object.getOwnPropertyDescriptor(Array.prototype, "every");
      try {
        Object.defineProperty(Array.prototype, "every", {
          configurable: true,
          writable: true,
          value: () => true,
        });
        (adapter as unknown as { sourceSnapshotCheckedAt: number }).sourceSnapshotCheckedAt = 0;
        await adapter.ensureSourceSnapshotFresh("prototype-sensitive-refresh");
      } finally {
        if (previousEvery) Object.defineProperty(Array.prototype, "every", previousEvery);
      }

      assertNotEquals(adapter.getSourceSnapshotVersion(), initialVersion);
      assertNotEquals(await adapter.getSourceSnapshotFingerprint(), initialFingerprint);
    });

    it("keeps freshness followers attached until SSR invalidation completes", async () => {
      const invalidationStarted = Promise.withResolvers<void>();
      const releaseInvalidation = Promise.withResolvers<void>();
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
        invalidationCallbacks: {
          clearSSRModuleCacheForProject: async () => {
            invalidationStarted.resolve();
            await releaseInvalidation.promise;
          },
        },
      });

      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.resolve([{
          path: "pages/review.tsx",
          version_id: `version-${listAllFilesCalls}`,
          content: `export const version = ${listAllFilesCalls};`,
        }]);
      };
      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      (adapter as unknown as { sourceSnapshotCheckedAt: number }).sourceSnapshotCheckedAt = 0;

      const leader = adapter.ensureSourceSnapshotFresh("leader");
      await invalidationStarted.promise;

      let followerFinished = false;
      const follower = adapter.ensureSourceSnapshotFresh("follower").then(() => {
        followerFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(followerFinished, false);

      releaseInvalidation.resolve();
      await Promise.all([leader, follower]);
      assertEquals(followerFinished, true);
      assertEquals(listAllFilesCalls, 2);
    });

    it("does not let an older refresh overwrite a pushed source snapshot", async () => {
      const refreshStarted = Promise.withResolvers<void>();
      const releaseRefresh = Promise.withResolvers<
        Array<{ path: string; version_id: string; content: string }>
      >();
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const initialFiles = [{
        path: "pages/review.tsx",
        version_id: "version-1",
        content: "export const version = 1;",
      }];
      const pushedFiles = [{
        path: "pages/review.tsx",
        version_id: "version-2",
        content: "export const version = 2;",
      }];
      let listAllFilesCalls = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<
            Array<{ path: string; version_id: string; content: string }>
          >;
        };
      }).client;

      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        listAllFilesCalls++;
        if (listAllFilesCalls === 1) return Promise.resolve(initialFiles);
        refreshStarted.resolve();
        return releaseRefresh.promise;
      };
      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      await adapter.initialize();
      const context = adapter.getContentContext();
      assertExists(context);

      const staleRefresh = adapter.refreshSourceSnapshot("poll");
      await refreshStarted.promise;

      await (adapter as unknown as {
        replaceSourceSnapshot: (
          cacheKey: string,
          files: typeof pushedFiles,
        ) => Promise<void>;
      }).replaceSourceSnapshot(buildFileListCacheKey(context), pushedFiles);
      const pushedVersion = adapter.getSourceSnapshotVersion();

      releaseRefresh.resolve(initialFiles);
      await staleRefresh;

      assertEquals(adapter.getSourceSnapshotVersion(), pushedVersion);
      assertEquals(await adapter.getAllSourceFiles(), pushedFiles);
    });

    it("does not reuse source snapshot generations across adapter instances", async () => {
      async function initializeAdapter(
        projectSlug: string,
        projectId: string,
      ): Promise<VeryfrontFSAdapter> {
        const adapter = createAdapter({
          veryfront: {
            apiBaseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug,
            contentSource: { type: "branch", branch: "main" },
            cache: { enabled: true },
          },
        });
        const client = (adapter as unknown as {
          client: {
            initialize: () => Promise<void>;
            getProjectSlug: () => string;
            getProjectId: () => string;
            getCachedProject: () => { provider: string; layout: string };
            listAllFiles: () => Promise<
              Array<{ path: string; version_id?: string; content?: string }>
            >;
          };
        }).client;

        client.initialize = () => Promise.resolve();
        client.getProjectSlug = () => projectSlug;
        client.getProjectId = () => projectId;
        client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
        client.listAllFiles = () =>
          Promise.resolve([{
            path: "agents/support.ts",
            version_id: "version-1",
            content: "export default {};",
          }]);
        (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
          .connect = () => {};

        await adapter.initialize();
        return adapter;
      }

      const first = await initializeAdapter("first-project", "project-1");
      const second = await initializeAdapter("second-project", "project-2");

      assertEquals(
        first.getSourceSnapshotVersion() === second.getSourceSnapshotVersion(),
        false,
      );

      first.dispose();
      second.dispose();
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

      client.initialize = () => Promise.resolve();
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

      client.initialize = () => Promise.resolve();
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

      client.initialize = () => Promise.resolve();
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

      client.initialize = () => Promise.resolve();
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
      // Simulate the retained listing expiring with the cache entry.
      (adapter as unknown as { clearRetainedFileList: () => void }).clearRetainedFileList();
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

      client.initialize = () => Promise.resolve();
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
      (adapter as unknown as { clearRetainedFileList: () => void }).clearRetainedFileList();
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
      (adapter as unknown as { clearRetainedFileList: () => void }).clearRetainedFileList();

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

    it("evicts persistent derived caches when a warmup observes a changed listing", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: true },
        },
      });

      let files: Array<{ path: string; content?: string }> = [{
        path: "pages/index.tsx",
        content: "export default function Page() { return null }",
      }];

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
      client.listAllFiles = () => Promise.resolve(files);
      (adapter as unknown as { wsManager: { connect: (_projectId: string) => void } }).wsManager
        .connect = () => {};

      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      await adapter.initialize();

      const context = adapter.getContentContext();
      const cacheKey = buildFileListCacheKey(context);
      const statResolveKey = `${buildStatCacheKeyPrefix(context)}:resolve:pages/about`;
      const dirKey = `${buildDirCacheKeyPrefix(context)}:pages`;
      const internals = adapter as unknown as {
        cache: {
          set: (key: string, value: unknown) => void;
          delete: (key: string) => boolean;
          getAsync: <T>(key: string) => Promise<T | undefined>;
          deleteByPrefixAsync: (prefix: string) => Promise<void>;
        };
        sourceSnapshotVersion: number;
        clearRetainedFileList: () => void;
      };
      const cache = internals.cache;

      // Route discovery reads both of these before either in-memory structure
      // is rebuilt, so a warmup that observes an edit must drop them too.
      cache.set(statResolveKey, "__VF_NOT_FOUND__");
      cache.set(dirKey, [{ name: "index.tsx", isFile: true, isDirectory: false }]);

      const versionBeforeWarmup = internals.sourceSnapshotVersion;
      const versionsAtEviction: number[] = [];
      const deleteByPrefixAsync = cache.deleteByPrefixAsync.bind(cache);
      cache.deleteByPrefixAsync = (prefix: string) => {
        versionsAtEviction.push(internals.sourceSnapshotVersion);
        return deleteByPrefixAsync(prefix);
      };

      // The next warmup observes a listing with a file the cached negative
      // resolve entry says is absent.
      files = [
        ...files,
        { path: "pages/about.tsx", content: "export default function About() { return null }" },
      ];
      assertEquals(cache.delete(cacheKey), true);
      internals.clearRetainedFileList();

      await adapter.getAllSourceFiles();

      await waitFor(async () => {
        const cached = await cache.getAsync<Array<{ path: string; content?: string }>>(cacheKey);
        return Array.isArray(cached) && cached.length === 2;
      });

      assertEquals(
        await cache.getAsync(statResolveKey),
        undefined,
        "a changed warmup must evict persistent stat resolve entries",
      );
      assertEquals(
        await cache.getAsync(dirKey),
        undefined,
        "a changed warmup must evict persistent directory listings",
      );
      assertEquals(versionsAtEviction.length, 2, "both derived tiers must be evicted");
      assertEquals(
        versionsAtEviction.every((version) => version === versionBeforeWarmup),
        true,
        "the eviction must complete before the new snapshot generation is published",
      );
    });

    it("warms the branch the cache key was derived from, not a later request branch", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });

      const internals = adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: (
            options?: unknown,
            context?: { type: string; name?: string },
          ) => Promise<Array<{ path: string; content?: string }>>;
        };
        cache: {
          getAsync: <T>(key: string) => Promise<T | undefined>;
          delete: (key: string) => boolean;
        };
        clearRetainedFileList: () => void;
        wsManager: { connect: (_projectId: string) => void };
      };

      const branchListings: Record<string, Array<{ path: string; content: string }>> = {
        main: [{ path: "main.css", content: "main" }],
        feature: [{ path: "feature.css", content: "feature" }],
      };
      const warmedBranches: string[] = [];
      internals.client.initialize = () => Promise.resolve();
      internals.client.getProjectSlug = () => "test-project";
      internals.client.getProjectId = () => "project-123";
      internals.client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      internals.client.listAllFiles = (_options, context) => {
        const branch = context?.name ?? "main";
        warmedBranches.push(branch);
        return Promise.resolve(branchListings[branch] ?? []);
      };
      internals.wsManager.connect = () => {};

      await adapter.initialize();

      const mainContext = adapter.getContentContext();
      const mainCacheKey = buildFileListCacheKey(mainContext);
      internals.cache.delete(mainCacheKey);
      internals.clearRetainedFileList();
      warmedBranches.length = 0;

      // The request branch switches while the awaited file-list cache read for
      // `main` is still open, exactly as a second request would do it.
      const getAsync = internals.cache.getAsync.bind(internals.cache);
      let switched = false;
      internals.cache.getAsync = async <T>(key: string): Promise<T | undefined> => {
        const result = await getAsync<T>(key);
        if (!switched && key === mainCacheKey) {
          switched = true;
          adapter.setRequestBranch("feature");
        }
        return result;
      };

      await adapter.getAllSourceFiles({ waitForWarmup: true });

      assertEquals(
        warmedBranches,
        ["main"],
        "the warmup must fetch the branch its cache key was derived from",
      );
      assertEquals(
        await internals.cache.getAsync<Array<{ path: string }>>(mainCacheKey),
        undefined,
        "a listing must never be published under another branch's file-list key",
      );
    });
  });
});
