import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { VeryfrontError } from "#veryfront/errors";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { buildFileCacheKeyPrefix, buildFileListCacheKey } from "./cache-keys.ts";
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
import { runWithRequestContext } from "./request-context.ts";
import type {
  ProjectStyleArtifactResolution,
  ResolveStyleArtifactInput,
} from "../../veryfront-api-client/index.ts";
import { createStyleArtifactTuple } from "../../veryfront-api-client/index.ts";
import { DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES } from "../../veryfront-api-transport.ts";

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
      "getStyleArtifactAccess",
      "refreshSourceSnapshot",
      "createStyleConfigBinding",
      "installStyleConfig",
      "ensureSourceSnapshotFresh",
      "getSourceSnapshotVersion",
    ] as const;

    it("advertises the fixed upstream whole-response ceiling", () => {
      assertEquals(
        createAdapter().maxWholeFileReadBytes,
        DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES,
      );
      assertEquals("readFileBytesBounded" in createAdapter(), false);
    });

    for (const method of methods) {
      it(`should have ${method} method`, () => {
        assertEquals(typeof (createAdapter() as any)[method], "function");
      });
    }
  });

  describe("bounded byte reads", () => {
    it("delegates to the upstream exact reader after minimal cold initialization", async () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          projectId: "project-id",
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

    it("keeps cold exact misses off file-list initialization and branch recovery", async () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          projectId: "project-id",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
      });
      const client = adapter.getClient();
      let exactCalls = 0;
      let projectCalls = 0;
      let listAllFilesCalls = 0;
      let unboundedContentCalls = 0;
      const clientInternals = client as unknown as {
        getFileContent(path: string): Promise<string>;
        getFileContentBytesWithinLimit(path: string, maximumBytes: number): Promise<Uint8Array>;
        getProject(projectRef?: string): Promise<{
          id: string;
          slug: string;
          provider: string;
          layout: string;
        }>;
        listAllFiles(): Promise<Array<{ path: string; content?: string }>>;
      };
      clientInternals.getProject = () => {
        projectCalls++;
        return Promise.resolve({
          id: "project-id",
          slug: "test-project",
          provider: "veryfront",
          layout: "default",
        });
      };
      clientInternals.listAllFiles = () => {
        listAllFilesCalls++;
        return Promise.reject(new Error("file-list content path must not run"));
      };
      clientInternals.getFileContent = () => {
        unboundedContentCalls++;
        return Promise.reject(new Error("unbounded content path must not run"));
      };
      clientInternals.getFileContentBytesWithinLimit = () => {
        exactCalls++;
        return Promise.reject(new Error("404 Not Found"));
      };

      await assertRejects(
        () => adapter.readFileBytesWithinLimit("manifest.json", 32),
        Error,
        "404 Not Found: manifest.json",
      );
      assertEquals(exactCalls, 1);
      assertEquals(projectCalls, 0);
      assertEquals(listAllFilesCalls, 0);
      assertEquals(unboundedContentCalls, 0);
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

  describe("exists", () => {
    it("propagates operational stat failures instead of reporting absence", async () => {
      const adapter = createAdapter();
      const backendError = new Error("stat backend unavailable");
      const internals = adapter as unknown as {
        initialized: boolean;
        statOps: {
          exists(path: string): Promise<boolean>;
          stat(path: string): Promise<never>;
        };
      };
      internals.initialized = true;
      internals.statOps = {
        exists: () => Promise.reject(backendError),
        stat: () => Promise.reject(backendError),
      };

      const error = await assertRejects(() => adapter.exists("/veryfront.config.ts"));

      assertEquals(error, backendError);
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

    it("retains only project-bound proxy credentials for realtime invalidation", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
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

      const connections: Array<{ projectId: string; token: string }> = [];
      const internals = adapter as unknown as {
        client: { getProjectId: () => string };
        wsManager: {
          ensureConnected: (projectId: string, token: string) => void;
        };
      };
      internals.client.getProjectId = () => "project-1";
      internals.wsManager.ensureConnected = (projectId, token) => {
        connections.push({ projectId, token });
      };

      await runWithRequestContext(
        {
          projectSlug: "test-project",
          projectId: "project-1",
          token: "untrusted-token",
          tokenProvenance: "untrusted",
        },
        async () => adapter.ensureRealtimeConnection(),
      );
      assertEquals(connections, []);

      await runWithRequestContext(
        {
          projectSlug: "test-project",
          projectId: "project-1",
          token: "project-token",
          tokenProvenance: "project-bound",
        },
        async () => adapter.ensureRealtimeConnection(),
      );
      assertEquals(connections, [{ projectId: "project-1", token: "project-token" }]);

      await runWithRequestContext(
        {
          projectSlug: "test-project",
          projectId: "different-project",
          token: "wrong-project-token",
          tokenProvenance: "project-bound",
        },
        async () => adapter.ensureRealtimeConnection(),
      );
      assertEquals(connections, [{ projectId: "project-1", token: "project-token" }]);
      adapter.dispose();
    });
  });

  describe("hosted style configuration bindings", () => {
    function createProxyStyleAdapter(
      calls: Array<{
        files: Array<{ path: string; content?: string }>;
        config: Readonly<object> | undefined;
        releaseId: string | undefined;
      }>,
    ): VeryfrontFSAdapter {
      return createAdapter({
        projectDir: "/tmp/test-project",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          proxyMode: true,
          cache: { enabled: false },
        },
        styleCallbacks: {
          pregenerateStyles: (files, context) => {
            calls.push({
              files,
              config: context.config,
              releaseId: context.contentContext?.releaseId,
            });
            return Promise.resolve({
              hash: "style-hash",
              assetPath: "/_vf/css/style-hash.css",
            });
          },
        },
      });
    }

    function getStyleInternals(adapter: VeryfrontFSAdapter) {
      return adapter as unknown as {
        triggerCSSPregeneration(
          files: Array<{ path: string; content?: string }>,
        ): Promise<{ hash: string; assetPath: string } | undefined>;
        wsManager: {
          deps: {
            pregenerateStyles(
              files: Array<{ path: string; content?: string }>,
            ): Promise<{ hash: string; assetPath: string } | undefined>;
          };
        };
      };
    }

    it("uses captured style primordials after ambient prototypes are poisoned", async () => {
      const calls: Array<{
        files: Array<{ path: string; content?: string }>;
        config: Readonly<object> | undefined;
        releaseId: string | undefined;
      }> = [];
      const adapter = createProxyStyleAdapter(calls);
      const internals = getStyleInternals(adapter);
      const pendingFiles = [{ path: "globals.css", content: "pending" }];
      const exactConfig = { exact: true };
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-a",
      });

      const originalJSONStringify = JSON.stringify;
      const originalArrayMap = Array.prototype.map;
      const originalFreeze = Object.freeze;
      const originalWeakSetAdd = WeakSet.prototype.add;
      const originalWeakSetDelete = WeakSet.prototype.delete;
      const originalWeakSetHas = WeakSet.prototype.has;
      let bindingWasFrozen = false;
      let forgedAccepted = true;
      let exactAccepted = false;
      let replayAccepted = true;
      let staleAccepted = true;

      try {
        JSON.stringify = (() => {
          throw new Error("ambient JSON.stringify must not run");
        }) as typeof JSON.stringify;
        Array.prototype.map = (() => {
          throw new Error("ambient Array.map must not run");
        }) as typeof Array.prototype.map;
        Object.freeze = ((value: object) => value) as typeof Object.freeze;
        WeakSet.prototype.add = (() => {
          throw new Error("ambient WeakSet.add must not run");
        }) as typeof WeakSet.prototype.add;
        WeakSet.prototype.has = (() => true) as typeof WeakSet.prototype.has;
        WeakSet.prototype.delete = (() => {
          throw new Error("ambient WeakSet.delete must not run");
        }) as typeof WeakSet.prototype.delete;

        const binding = adapter.createStyleConfigBinding();
        bindingWasFrozen = Object.isFrozen(binding);
        await internals.triggerCSSPregeneration(pendingFiles);
        const pendingFile = pendingFiles[0];
        if (!pendingFile) throw new Error("pending style file fixture is missing");
        pendingFile.content = "mutated";
        forgedAccepted = adapter.installStyleConfig(
          {
            projectSlug: binding.projectSlug,
            sourceKey: binding.sourceKey,
            sourceRevision: binding.sourceRevision,
          },
          { forged: true },
        );
        exactAccepted = adapter.installStyleConfig(binding, exactConfig);
        replayAccepted = adapter.installStyleConfig(binding, { replay: true });

        const staleBinding = adapter.createStyleConfigBinding();
        adapter.setContentContext({
          sourceType: "release",
          projectSlug: "test-project",
          releaseId: "release-b",
        });
        staleAccepted = adapter.installStyleConfig(staleBinding, { stale: true });
      } finally {
        JSON.stringify = originalJSONStringify;
        Array.prototype.map = originalArrayMap;
        Object.freeze = originalFreeze;
        WeakSet.prototype.add = originalWeakSetAdd;
        WeakSet.prototype.delete = originalWeakSetDelete;
        WeakSet.prototype.has = originalWeakSetHas;
      }

      await waitFor(() => Promise.resolve(calls.length === 1));
      assertEquals(bindingWasFrozen, true);
      assertEquals(forgedAccepted, false);
      assertEquals(exactAccepted, true);
      assertEquals(replayAccepted, false);
      assertEquals(staleAccepted, false);
      assertEquals(calls, [{
        files: [{ path: "globals.css", content: "pending" }],
        config: exactConfig,
        releaseId: "release-a",
      }]);
    });

    it("does not let a late source config flush another source's files", async () => {
      const calls: Array<{
        files: Array<{ path: string; content?: string }>;
        config: Readonly<object> | undefined;
        releaseId: string | undefined;
      }> = [];
      const adapter = createProxyStyleAdapter(calls);
      const internals = getStyleInternals(adapter);
      const sourceAFiles = [{ path: "a.css", content: "source-a" }];
      const sourceBFiles = [{ path: "b.css", content: "source-b" }];
      const sourceAConfig = { styles: { stylesheet: "a.css" } };
      const sourceBConfig = { styles: { stylesheet: "b.css" } };

      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-a",
      });
      await internals.triggerCSSPregeneration(sourceAFiles);
      const sourceABinding = adapter.createStyleConfigBinding();

      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-b",
      });
      await internals.triggerCSSPregeneration(sourceBFiles);

      assertEquals(adapter.installStyleConfig(sourceABinding, sourceAConfig), false);
      assertEquals(calls, []);

      const sourceBBinding = adapter.createStyleConfigBinding();
      assertEquals(adapter.installStyleConfig(sourceBBinding, sourceBConfig), true);
      await waitFor(() => Promise.resolve(calls.length === 1));

      assertEquals(calls, [{
        files: sourceBFiles,
        config: sourceBConfig,
        releaseId: "release-b",
      }]);
      assertEquals(adapter.installStyleConfig(sourceBBinding, sourceBConfig), false);
    });

    it("invalidates an in-flight config binding when the source snapshot advances", async () => {
      const calls: Array<{
        files: Array<{ path: string; content?: string }>;
        config: Readonly<object> | undefined;
        releaseId: string | undefined;
      }> = [];
      const adapter = createProxyStyleAdapter(calls);
      const internals = getStyleInternals(adapter);
      const oldConfig = { styles: { stylesheet: "old.css" } };
      const nextConfig = { styles: { stylesheet: "next.css" } };
      const nextFiles = [{ path: "next.css", content: "next" }];

      adapter.setContentContext({
        sourceType: "environment",
        projectSlug: "test-project",
        environmentName: "production",
        releaseId: "release-1",
      });
      const oldBinding = adapter.createStyleConfigBinding();

      await internals.wsManager.deps.pregenerateStyles(nextFiles);
      assertEquals(adapter.installStyleConfig(oldBinding, oldConfig), false);

      const nextBinding = adapter.createStyleConfigBinding();
      assertEquals(adapter.installStyleConfig(nextBinding, nextConfig), true);
      await waitFor(() => Promise.resolve(calls.length === 1));
      assertEquals(calls[0], {
        files: nextFiles,
        config: nextConfig,
        releaseId: "release-1",
      });
    });

    it("clears pending files and bindings when disposed", async () => {
      const calls: Array<{
        files: Array<{ path: string; content?: string }>;
        config: Readonly<object> | undefined;
        releaseId: string | undefined;
      }> = [];
      const adapter = createProxyStyleAdapter(calls);
      const internals = getStyleInternals(adapter);

      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-a",
      });
      const binding = adapter.createStyleConfigBinding();
      await internals.triggerCSSPregeneration([{
        path: "globals.css",
        content: "pending",
      }]);

      adapter.dispose();

      assertEquals(adapter.installStyleConfig(binding, {}), false);
      assertEquals(calls, []);
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

    it("fails closed when style artifact access has no resolved content context", async () => {
      const error = await assertRejects(() => createAdapter().getStyleArtifactAccess());
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "api-client-error");
      assertEquals(error.status, 502);
      assertEquals(
        error.message.includes("requires a resolved Veryfront content context"),
        true,
      );
    });

    it("returns an immutable registry bound to the captured adapter project", async () => {
      const adapter = createAdapter();
      const mutableContext: ResolvedContentContext = {
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-a",
      };
      adapter.setContentContext(mutableContext);
      const client = adapter.getClient();
      const capturedProjectRefs: Array<string | undefined> = [];
      const recordProjectRef = (input: ResolveStyleArtifactInput, projectRef?: string) => {
        capturedProjectRefs.push(projectRef);
        return Promise.resolve<ProjectStyleArtifactResolution>({
          ...createStyleArtifactTuple(input),
          status: "missing",
        });
      };
      const artifactClient = client as unknown as {
        resolveStyleArtifact: typeof recordProjectRef;
        ensureStyleArtifactBuild: typeof recordProjectRef;
        upsertStyleArtifact: typeof recordProjectRef;
      };
      artifactClient.resolveStyleArtifact = recordProjectRef;
      artifactClient.ensureStyleArtifactBuild = recordProjectRef;
      artifactClient.upsertStyleArtifact = recordProjectRef;

      const access = await adapter.getStyleArtifactAccess();
      mutableContext.releaseId = "release-mutated-after-capture";
      const tuple = createStyleArtifactTuple({
        cssPipelineIdentity: "pipeline@1",
        styleProfileHash: "a".repeat(64),
        releaseId: "release-a",
      });
      const result = await access.registry.resolveStyleArtifact(tuple);
      await access.registry.ensureStyleArtifactBuild(tuple);
      await access.registry.upsertStyleArtifact({
        ...tuple,
        artifactHash: "b".repeat(64),
      });

      assertEquals(Object.isFrozen(access), true);
      assertEquals(Object.isFrozen(access.contentContext), true);
      assertEquals(Object.isFrozen(access.registry), true);
      assertEquals("client" in access, false);
      assertEquals(access.contentContext.releaseId, "release-a");
      assertEquals(capturedProjectRefs, ["test-project", "test-project", "test-project"]);
      assertEquals(result.status, "missing");
    });

    it("fails closed when the content context belongs to another project", async () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "another-project",
        releaseId: "release-a",
      });

      const error = await assertRejects(() => adapter.getStyleArtifactAccess());
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "api-client-error");
      assertEquals(error.status, 502);
      assertEquals(error.message.includes("did not match the Veryfront adapter project"), true);
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

    it("propagates operational entity lookup failures", async () => {
      const adapter = createAdapter();
      const backendFailure = new Error("entity lookup backend unavailable");
      (adapter.getClient() as unknown as {
        getFileById: (entityId: string) => Promise<never>;
      }).getFileById = () => Promise.reject(backendFailure);

      const error = await assertRejects(
        () => adapter.getFilePathByEntityIdAsync("entity-1"),
      );
      assertEquals(error, backendFailure);
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
      assertEquals(
        (await getReadyManifestForRenderAsync(releaseId))?.manifestVersion,
        2,
      );
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
      assertEquals(
        (await getReadyManifestForRenderAsync(releaseId))?.manifestVersion,
        3,
      );
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
      assertEquals(
        (await getReadyManifestForRenderAsync(releaseId))?.modules["pages/index.tsx"]?.contentHash,
        "a".repeat(64),
      );
      assertEquals(fetchCount, 1);

      contentHash = "b".repeat(64);
      (adapter as unknown as {
        wsManager: { deps: { clearMemoryCaches: () => void } };
      }).wsManager.deps.clearMemoryCaches();

      assertEquals(getReadyManifestForRender(releaseId), null);
      assertEquals(
        (await getReadyManifestForRenderAsync(releaseId))?.modules["pages/index.tsx"]?.contentHash,
        "b".repeat(64),
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

    it("reconciles realtime delivery when an initialized adapter changes source type", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });

      let disconnectCalls = 0;
      let connectCalls = 0;
      const internals = adapter as unknown as {
        initialized: boolean;
        wsManager: { disconnect: () => void };
      };
      internals.initialized = true;
      internals.wsManager.disconnect = () => {
        disconnectCalls++;
      };
      adapter.ensureRealtimeConnection = () => {
        connectCalls++;
      };

      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-1",
      });
      assertEquals(disconnectCalls, 1);
      assertEquals(connectCalls, 0);

      adapter.setContentContext({
        sourceType: "environment",
        projectSlug: "test-project",
        environmentName: "production",
        releaseId: "release-2",
      });
      assertEquals(disconnectCalls, 1);
      assertEquals(connectCalls, 1);
      adapter.dispose();
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
    it("coalesces concurrent initialization through one filesystem snapshot", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
        },
      });
      const releaseClientInitialization = Promise.withResolvers<void>();
      let clientInitializationCount = 0;
      let fileListCount = 0;
      let websocketConnections = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content: string }>>;
        };
      }).client;
      client.initialize = () => {
        clientInitializationCount++;
        return releaseClientInitialization.promise;
      };
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        fileListCount++;
        return Promise.resolve([{ path: "pages/index.tsx", content: "home" }]);
      };
      (adapter as unknown as { wsManager: { connect: () => void } }).wsManager.connect = () => {
        websocketConnections++;
      };

      const initializations = [
        adapter.initialize(),
        adapter.initialize(),
        adapter.initialize(),
      ];
      assertEquals(clientInitializationCount, 1);
      releaseClientInitialization.resolve();
      await Promise.all(initializations);

      assertEquals(clientInitializationCount, 1);
      assertEquals(fileListCount, 1);
      assertEquals(websocketConnections, 1);
    });

    it("does not publish a file snapshot or reconnect after disposal", async () => {
      const adapter = createAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: true },
        },
      });
      const releaseFileList = Promise.withResolvers<
        Array<{ path: string; content: string }>
      >();
      let fileListStarted = false;
      let websocketConnections = 0;
      const client = (adapter as unknown as {
        client: {
          initialize: () => Promise<void>;
          getProjectSlug: () => string;
          getProjectId: () => string;
          getCachedProject: () => { provider: string; layout: string };
          listAllFiles: () => Promise<Array<{ path: string; content: string }>>;
        };
      }).client;
      client.initialize = () => Promise.resolve();
      client.getProjectSlug = () => "test-project";
      client.getProjectId = () => "project-123";
      client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
      client.listAllFiles = () => {
        fileListStarted = true;
        return releaseFileList.promise;
      };
      (adapter as unknown as { wsManager: { connect: () => void } }).wsManager.connect = () => {
        websocketConnections++;
      };
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });
      const cacheKey = buildFileListCacheKey(adapter.getContentContext());

      const initialization = adapter.initialize();
      await waitFor(() => Promise.resolve(fileListStarted));
      adapter.dispose();
      releaseFileList.resolve([{ path: "pages/index.tsx", content: "stale" }]);

      await assertRejects(
        () => initialization,
        Error,
        "lifecycle was invalidated",
      );
      const internals = adapter as unknown as {
        initialized: boolean;
        projectData?: unknown;
        cache: { get<T>(key: string): T | undefined };
      };
      assertEquals(internals.initialized, false);
      assertEquals(internals.projectData, undefined);
      assertEquals(internals.cache.get(cacheKey), undefined);
      assertEquals(adapter.getContentContext(), null);
      assertEquals(websocketConnections, 0);
      await assertRejects(
        () => adapter.initialize(),
        Error,
        "filesystem adapter has been disposed",
      );
      await assertRejects(
        () => adapter.getAllSourceFiles(),
        Error,
        "filesystem adapter has been disposed",
      );
    });

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
          listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
        };
      }).client;

      client.initialize = () => Promise.resolve();
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
      assertEquals(routerInvalidations, 0);
      assertEquals(ssrInvalidations, 0);

      (adapter as unknown as { sourceSnapshotCheckedAt: number }).sourceSnapshotCheckedAt = 0;
      await adapter.ensureSourceSnapshotFresh("changed-source-check");

      assertEquals(listAllFilesCalls, 3);
      assertEquals(adapter.getSourceSnapshotVersion() > initialSnapshotVersion, true);
      assertEquals(routerInvalidations, 1);
      assertEquals(ssrInvalidations, 1);
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
