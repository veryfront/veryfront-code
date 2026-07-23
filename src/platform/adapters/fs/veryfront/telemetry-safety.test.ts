import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { resolveContentContext } from "./adapter-content-context.ts";
import {
  endRequestMetrics,
  logContentMetric,
  resetContentMetrics,
  startRequestMetrics,
} from "./content-metrics.ts";
import {
  addPendingInvalidation,
  clearAllPendingInvalidations,
  isPrefixBeingInvalidated,
  removePendingInvalidation,
} from "./invalidation-state.ts";
import { MultiProjectFSAdapter, setRequestScopedFile } from "./multi-project-adapter.ts";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";
import {
  assertFilesystemTelemetryOmits,
  captureFilesystemTelemetry,
} from "./telemetry-safety.test-helpers.ts";
import type { CacheStats, ResolvedContentContext } from "./types.ts";

describe("Veryfront filesystem telemetry safety", () => {
  it("omits customer identifiers and source content across adapter operations", async () => {
    const canaries = {
      apiHost: "private-api-host-canary.example",
      apiPath: "PRIVATE_API_PATH_CANARY",
      branch: "PRIVATE_BRANCH_CANARY",
      content: "PRIVATE_SOURCE_CONTENT_CANARY",
      cssHash: "PRIVATE_STYLE_HASH_CANARY",
      domain: "private-domain-canary.example",
      entity: "PRIVATE_ENTITY_CANARY",
      environment: "PRIVATE_ENVIRONMENT_CANARY",
      errorClass: "PRIVATE_ERROR_CLASS_CANARY",
      errorMessage: "PRIVATE_ERROR_MESSAGE_CANARY",
      filePath: "pages/PRIVATE_FILE_PATH_CANARY.tsx",
      missingPath: "pages/PRIVATE_MISSING_PATH_CANARY.tsx",
      optionalFailurePath: "styles/PRIVATE_OPTIONAL_FAILURE_PATH_CANARY.css",
      optionalPath: "styles/PRIVATE_OPTIONAL_PATH_CANARY.css",
      projectDir: "PRIVATE_PROJECT_DIR_CANARY",
      projectId: "PRIVATE_PROJECT_ID_CANARY",
      projectSlug: "PRIVATE_PROJECT_SLUG_CANARY",
      refreshReason: "PRIVATE_REFRESH_REASON_CANARY",
      release: "PRIVATE_RELEASE_CANARY",
      token: "PRIVATE_TOKEN_CANARY",
    } as const;
    const adapter = new VeryfrontFSAdapter({
      projectDir: `/tmp/${canaries.projectDir}`,
      veryfront: {
        apiBaseUrl: `https://${canaries.apiHost}/${canaries.apiPath}`,
        apiToken: canaries.token,
        projectSlug: canaries.projectSlug,
        contentSource: { type: "domain", domain: canaries.domain },
        cache: { enabled: true },
      },
      styleCallbacks: {
        pregenerateStyles: () =>
          Promise.resolve({
            hash: canaries.cssHash,
            assetPath: `/_vf/css/${canaries.cssHash}.css`,
          }),
      },
    });
    const client = adapter.getClient() as VeryfrontApiClient & Record<string, unknown>;
    const projectFiles = [{
      id: "PRIVATE_CACHED_ENTITY_CANARY",
      path: canaries.filePath,
      content: canaries.content,
      type: "component",
      size: canaries.content.length,
      updated_at: "2026-01-01T00:00:00.000Z",
    }];
    Object.assign(client, {
      initialize: () => Promise.resolve(),
      initializeProject: () =>
        Promise.resolve({
          projectId: canaries.projectId,
          project: {
            id: canaries.projectId,
            name: "Private project",
            slug: canaries.projectSlug,
            provider: "github",
            layout: "pages",
          },
          requestScoped: false,
        }),
      getProjectId: () => canaries.projectId,
      getCachedProject: () => ({ provider: "github", layout: "pages" }),
      listAllFiles: () => Promise.resolve(projectFiles),
      getOptionalFileContent: (path: string) => {
        if (path !== canaries.optionalFailurePath) return Promise.resolve(canaries.content);
        const error = new Error(canaries.errorMessage);
        error.name = canaries.errorClass;
        return Promise.reject(error);
      },
      getFileById: (entityId: string) => {
        if (entityId === canaries.entity) {
          return Promise.resolve({ path: canaries.filePath, content: canaries.content });
        }
        const error = new Error(canaries.errorMessage);
        error.name = canaries.errorClass;
        return Promise.reject(error);
      },
    });
    (adapter as unknown as {
      wsManager: {
        connect(): void;
        dispose(): void;
        getPokeMetrics(): {
          received: number;
          invalidationsTriggered: number;
          lastPokeTime: number;
          connectionId: string | null;
        };
      };
    }).wsManager = {
      connect() {},
      dispose() {},
      getPokeMetrics: () => ({
        received: 0,
        invalidationsTriggered: 0,
        lastPokeTime: 0,
        connectionId: null,
      }),
    };

    const { capture } = await captureFilesystemTelemetry(async (activeCapture) => {
      try {
        await resolveContentContext(
          { lookupProjectByDomain: () => Promise.resolve(null) } as never,
          { type: "domain", domain: canaries.domain },
          canaries.projectSlug,
        );
      } catch (error) {
        activeCapture.recordPublicError(error);
      }
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: canaries.projectSlug,
        branch: canaries.branch,
      });
      await adapter.initialize();
      assertEquals(await adapter.readTextFile(canaries.filePath), canaries.content);
      assertEquals(await adapter.readOptionalTextFile(canaries.optionalPath), canaries.content);
      try {
        await adapter.readOptionalTextFile(canaries.optionalFailurePath);
      } catch (error) {
        activeCapture.recordPublicError(error);
      }
      assertEquals((await adapter.stat(canaries.filePath)).isFile, true);
      assertEquals((await adapter.readdir("pages")).length, 1);

      try {
        await adapter.readTextFile(canaries.missingPath);
      } catch (error) {
        activeCapture.recordPublicError(error);
      }

      await adapter.refreshSourceSnapshot(canaries.refreshReason);
      (adapter as unknown as { cache: { clear(): void } }).cache.clear();
      await adapter.getAllSourceFiles();
      await (adapter as unknown as { fileListWarmupPromise: Promise<void> | null })
        .fileListWarmupPromise;

      assertEquals(
        (await adapter.getFilePathByEntityIdAsync(canaries.entity))?.path,
        canaries.filePath,
      );
      assertEquals(
        await adapter.getFilePathByEntityIdAsync("PRIVATE_FAILED_ENTITY_CANARY"),
        undefined,
      );
      assertExists(
        await (adapter as unknown as {
          triggerCSSPregeneration(
            files: typeof projectFiles,
          ): Promise<{ hash: string; assetPath: string } | undefined>;
        }).triggerCSSPregeneration(projectFiles),
      );

      adapter.setContentContext({
        sourceType: "environment",
        projectSlug: canaries.projectSlug,
        environmentName: canaries.environment,
        releaseId: canaries.release,
      });
    });

    adapter.dispose();
    assertFilesystemTelemetryOmits(capture, [
      ...Object.values(canaries),
      "PRIVATE_CACHED_ENTITY_CANARY",
      "PRIVATE_FAILED_ENTITY_CANARY",
    ]);
  });

  it("omits request and cache identifiers from metrics and invalidation telemetry", async () => {
    const canaries = [
      "PRIVATE_REQUEST_ID_CANARY",
      "PRIVATE_REQUEST_PATH_CANARY",
      "PRIVATE_METRIC_PATH_CANARY",
      "PRIVATE_METRIC_SOURCE_CANARY",
      "PRIVATE_INVALIDATION_PROJECT_CANARY",
      "PRIVATE_INVALIDATION_RELEASE_CANARY",
      "PRIVATE_INVALIDATION_PATH_CANARY",
    ] as const;
    const invalidationPrefix = `file:release:${canaries[4]}:${canaries[5]}:${canaries[6]}`;

    const { capture } = await captureFilesystemTelemetry(() => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("NETWORK_FETCH", {
        path: canaries[2],
        source: canaries[3],
        isPreviewMode: true,
      });
      endRequestMetrics({
        requestId: canaries[0],
        pathname: canaries[1],
        mode: "preview",
      });

      clearAllPendingInvalidations();
      addPendingInvalidation(invalidationPrefix);
      assertEquals(isPrefixBeingInvalidated(`${invalidationPrefix}:child`), true);
      removePendingInvalidation(invalidationPrefix);
      clearAllPendingInvalidations();
    });

    assertFilesystemTelemetryOmits(capture, canaries);
  });

  it("omits tenant context and authorization-scoped keys in multi-project flows", async () => {
    const canaries = {
      branch: "PRIVATE_MULTI_BRANCH_CANARY",
      entity: "PRIVATE_MULTI_ENTITY_CANARY",
      environment: "PRIVATE_MULTI_ENVIRONMENT_CANARY",
      errorClass: "PRIVATE_MULTI_ERROR_CLASS_CANARY",
      errorMessage: "PRIVATE_MULTI_ERROR_MESSAGE_CANARY",
      filePath: "PRIVATE_MULTI_FILE_PATH_CANARY.tsx",
      projectId: "PRIVATE_MULTI_PROJECT_ID_CANARY",
      projectSlug: "PRIVATE_MULTI_PROJECT_SLUG_CANARY",
      reason: "PRIVATE_MULTI_REASON_CANARY",
      release: "PRIVATE_MULTI_RELEASE_CANARY",
      token: "PRIVATE_MULTI_TOKEN_CANARY",
    } as const;
    const adapter = new MultiProjectFSAdapter({
      veryfront: {
        apiBaseUrl: "https://api.example.com",
        apiToken: "stable-token",
        projectSlug: "default-project",
        cache: { enabled: false },
      },
    });
    const originalManager = (adapter as unknown as { manager: ProxyFSAdapterManager }).manager;
    originalManager.dispose();
    const caughtError = () => {
      const error = new Error(canaries.errorMessage);
      error.name = canaries.errorClass;
      return error;
    };
    const projectAdapter = {
      readOptionalTextFile: () => Promise.resolve("optional"),
      refreshSourceSnapshot: () => Promise.resolve(),
      getProjectData: () => {
        throw caughtError();
      },
      getFilePathByEntityId: () => {
        throw caughtError();
      },
      getAllSourceFiles: () => Promise.reject(caughtError()),
    };
    (adapter as unknown as { manager: unknown }).manager = {
      getAdapter: () => Promise.resolve(projectAdapter),
      getStats: () => ({ adapters: 1, stats: {} }),
      dispose() {},
    };

    const scopedManager = new ProxyFSAdapterManager({
      baseConfig: {
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "stable-token",
          projectSlug: "default-project",
          cache: { enabled: false },
        },
      },
      adapterFactory: () => {
        let context: ResolvedContentContext | null = null;
        return {
          setContentContext(nextContext: ResolvedContentContext) {
            context = nextContext;
          },
          getContentContext: () => context,
          initialize: () => Promise.resolve(),
          dispose() {},
          getCacheStats: (): CacheStats => ({
            cache: {
              size: 0,
              memoryUsed: 0,
              hits: 0,
              misses: 0,
              hitRate: 0,
            },
            poke: {
              received: 0,
              invalidationsTriggered: 0,
              lastPokeTime: 0,
              connectionId: null,
            },
          }),
        } as unknown as VeryfrontFSAdapter;
      },
    });
    const failingManager = new ProxyFSAdapterManager({
      baseConfig: {
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "stable-token",
          projectSlug: "default-project",
          cache: { enabled: false },
        },
      },
      adapterFactory: (config) => {
        const failingAdapter = new VeryfrontFSAdapter(config);
        failingAdapter.initialize = () => Promise.reject(caughtError());
        return failingAdapter;
      },
    });

    const { capture } = await captureFilesystemTelemetry(async (activeCapture) => {
      await adapter.runWithContext(
        canaries.projectSlug,
        canaries.token,
        async () => {
          setRequestScopedFile(canaries.filePath, "private-content");
          await adapter.readOptionalTextFile(canaries.filePath);
          await adapter.refreshSourceSnapshot(canaries.reason);
          assertEquals(await adapter.getProjectData(), undefined);
          assertEquals(await adapter.getFilePathByEntityId(canaries.entity), undefined);
          assertEquals(await adapter.getAllSourceFiles(), []);
        },
        canaries.projectId,
        { branch: canaries.branch },
      );
      await adapter.runWithContext(
        canaries.projectSlug,
        canaries.token,
        () => Promise.resolve(),
        canaries.projectId,
        {
          productionMode: true,
          releaseId: canaries.release,
          environmentName: canaries.environment,
        },
      );

      await scopedManager.getAdapter(
        canaries.projectSlug,
        canaries.token,
        canaries.projectId,
        false,
        null,
        null,
        canaries.branch,
      );
      try {
        scopedManager.hasAdapter(
          canaries.projectSlug,
          true,
          null,
          null,
          canaries.environment,
        );
      } catch (error) {
        activeCapture.recordPublicError(error);
      }
      try {
        (scopedManager as unknown as {
          assertContextMatches(
            cacheKey: string,
            current: ResolvedContentContext,
            expected: {
              productionMode: boolean;
              releaseId: string | null;
              environmentName: string | null;
              branch: string | null;
            },
          ): void;
        }).assertContextMatches(
          `PRIVATE_CACHE_KEY_CANARY:authorization:${canaries.token}`,
          {
            sourceType: "branch",
            projectSlug: canaries.projectSlug,
            branch: canaries.branch,
          },
          {
            productionMode: true,
            releaseId: canaries.release,
            environmentName: canaries.environment,
            branch: null,
          },
        );
      } catch (error) {
        activeCapture.recordPublicError(error);
      }
      try {
        await failingManager.getAdapter(
          canaries.projectSlug,
          canaries.token,
          canaries.projectId,
          false,
          null,
          null,
          canaries.branch,
        );
      } catch (error) {
        activeCapture.recordPublicError(error);
      }
    });

    failingManager.dispose();
    scopedManager.dispose();
    adapter.dispose();
    assertFilesystemTelemetryOmits(capture, [
      ...Object.values(canaries),
      "PRIVATE_CACHE_KEY_CANARY",
      ":authorization:",
    ]);
  });
});
