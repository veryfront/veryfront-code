import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildStatCacheKeyPrefix,
} from "../cache-keys.ts";
import {
  addPendingInvalidation,
  getPendingInvalidationsCount,
  removePendingInvalidation,
} from "../invalidation-state.ts";
import type { PokeAckType, PokeMetrics, PreviewStyleArtifactInfo, WebSocketDeps } from "./types.ts";
import type { ResolvedContentContext } from "../types.ts";

const logger = getBaseLogger("SERVER", { injectTraceContext: false }).component(
  "web-socket-dispatch",
);

const INVALIDATION_DEBOUNCE_MS = 100;

interface WebSocketDispatchCallbacks {
  getConnectionId: () => string | null;
  sendPokeAck: (
    type: PokeAckType,
    changedPaths: string[] | undefined,
    totalInvalidations: number,
  ) => void;
}

export class WebSocketDispatch {
  private invalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private selectiveInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChangedPaths = new Set<string>();
  private previewInvalidationVersion = 0;
  private activePreviewInvalidationPrefixes = new Set<string>();
  private pokeMetrics: PokeMetrics = {
    received: 0,
    invalidationsTriggered: 0,
    lastPokeTime: 0,
  };

  constructor(
    private readonly deps: WebSocketDeps,
    private readonly callbacks: WebSocketDispatchCallbacks,
  ) {}

  getPokeMetrics(): PokeMetrics {
    return { ...this.pokeMetrics };
  }

  dispose(): void {
    if (this.invalidationTimer) {
      clearTimeout(this.invalidationTimer);
      this.invalidationTimer = null;
    }

    if (this.selectiveInvalidationTimer) {
      clearTimeout(this.selectiveInvalidationTimer);
      this.selectiveInvalidationTimer = null;
    }
  }

  private getPreviewInvalidationPrefixes(
    contentContext: ResolvedContentContext | null,
  ): string[] {
    if (contentContext?.sourceType !== "branch") return [];
    return [buildFileCacheKeyPrefix(contentContext)];
  }

  private beginPreviewInvalidation(contentContext: ResolvedContentContext | null): void {
    const prefixes = this.getPreviewInvalidationPrefixes(contentContext);
    if (prefixes.length === 0) return;

    this.previewInvalidationVersion++;

    for (const prefix of prefixes) {
      if (this.activePreviewInvalidationPrefixes.has(prefix)) continue;
      addPendingInvalidation(prefix);
      this.activePreviewInvalidationPrefixes.add(prefix);
    }
  }

  private completePreviewInvalidation(prefixes: string[], version: number): void {
    if (prefixes.length === 0) return;
    if (version !== this.previewInvalidationVersion) return;

    for (const prefix of prefixes) {
      if (!this.activePreviewInvalidationPrefixes.delete(prefix)) continue;
      removePendingInvalidation(prefix);
    }
  }

  handlePokeMessage(event: MessageEvent): void {
    try {
      const raw: unknown = JSON.parse(event.data as string);
      if (!raw || typeof raw !== "object") return;
      const data = raw as Record<string, unknown>;
      const isPoke = data.type === "poke" || data.type === "entity_updated";
      if (!isPoke) return;

      const payload = (data.data && typeof data.data === "object" ? data.data : {}) as Record<
        string,
        unknown
      >;
      const changedPaths = payload.changedPaths as string[] | undefined;
      const contentContext = this.deps.getContentContext();

      const pokeBranchId = payload.branchId as string | null | undefined;
      const pokeBranchName = payload.branchName as string | null | undefined;

      const normalizedBranchId = typeof pokeBranchId === "string" && pokeBranchId.length > 0
        ? pokeBranchId
        : null;
      const normalizedBranchName = typeof pokeBranchName === "string" && pokeBranchName.length > 0
        ? pokeBranchName
        : null;

      const timeSinceLastPoke = this.pokeMetrics.lastPokeTime > 0
        ? Date.now() - this.pokeMetrics.lastPokeTime
        : null;

      this.pokeMetrics.received++;
      this.pokeMetrics.lastPokeTime = Date.now();

      const isProductionMode = contentContext?.sourceType !== "branch";
      const currentBranch = contentContext?.branch ?? null;
      const hasBranchScope = !!normalizedBranchName || !!normalizedBranchId;
      const isProductionPoke = !hasBranchScope;

      logger.debug("POKE RECEIVED - checking environment scope", {
        type: data.type,
        pokeBranchId: normalizedBranchId,
        pokeBranchName: normalizedBranchName,
        isProductionPoke,
        isProductionMode,
        currentBranch,
        entityId: payload.entityId,
        entityType: payload.entityType,
        action: payload.action,
        connectionId: this.callbacks.getConnectionId(),
        totalPokesReceived: this.pokeMetrics.received,
        timeSinceLastPokeMs: timeSinceLastPoke,
      });

      // In production mode, we accept branch-scoped pokes too.
      // Production renders always fetch published content, so clearing caches
      // on preview edits is safe and avoids stale content after publish.
      if (isProductionMode && !isProductionPoke) {
        logger.debug(
          "[WebSocketManager] POKE ACCEPTED - branch-scoped poke in production mode",
          {
            pokeBranchId: normalizedBranchId,
            pokeBranchName: normalizedBranchName,
            sourceType: contentContext?.sourceType,
          },
        );
      }

      if (!isProductionMode) {
        if (normalizedBranchName && normalizedBranchName !== currentBranch) {
          logger.debug(
            "[WebSocketManager] POKE SKIPPED - different branch name in preview mode",
            {
              pokeBranchName: normalizedBranchName,
              currentBranch,
            },
          );
          return;
        }

        if (!normalizedBranchName && normalizedBranchId) {
          if (currentBranch === null) {
            logger.debug(
              "[WebSocketManager] POKE SKIPPED - branchId-only poke for main preview",
              { pokeBranchId: normalizedBranchId },
            );
            return;
          }

          logger.debug(
            "[WebSocketManager] POKE ACCEPTED - branchId-only fallback in preview mode",
            { pokeBranchId: normalizedBranchId, currentBranch },
          );
        }

        if (
          !normalizedBranchName && !normalizedBranchId && currentBranch !== null &&
          currentBranch !== "main"
        ) {
          // Unscoped pokes (no branchId/branchName) are for main branch edits.
          // Skip only if we're on a named branch (not main).
          logger.debug(
            "[WebSocketManager] POKE SKIPPED - unscoped poke for named branch preview",
            { currentBranch },
          );
          return;
        }
      }

      const pokeReleaseId = payload.releaseId as string | null | undefined;
      const normalizedPokeReleaseId = typeof pokeReleaseId === "string" && pokeReleaseId.length > 0
        ? pokeReleaseId
        : null;

      const isDeploymentPoke = payload.entityType === "deployment";
      const isPublishPoke = isDeploymentPoke || (isProductionMode && !changedPaths?.length);

      const pokeEnvironmentName = payload.environmentName as string | null | undefined;
      const normalizedPokeEnvironment =
        typeof pokeEnvironmentName === "string" && pokeEnvironmentName.length > 0
          ? pokeEnvironmentName
          : contentContext?.environmentName ?? (isProductionMode ? "production" : undefined);

      logger.info("POKE ACCEPTED - triggering cache invalidation", {
        changedPathsCount: changedPaths?.length || 0,
        changedPaths: changedPaths || [],
        projectSlug: this.deps.projectSlug,
        branch: contentContext?.branch,
        isDeploymentPoke,
        isPublishPoke,
        pokeReleaseId: normalizedPokeReleaseId,
        pokeEnvironmentName: normalizedPokeEnvironment,
      });

      this.beginPreviewInvalidation(contentContext);
      this.deps.invalidationCallbacks.clearDomainCache?.();
      this.deps.clearMemoryCaches();
      logger.debug("All in-memory caches cleared immediately on POKE");

      if (isPublishPoke && this.deps.projectSlug) {
        this.clearPersistentCacheForPublish(normalizedPokeReleaseId, normalizedPokeEnvironment);
      }

      if (changedPaths?.length) {
        this.scheduleSelectiveInvalidation(changedPaths);
        return;
      }

      logger.debug("No changedPaths provided - using full invalidation");
      this.scheduleInvalidation();
    } catch (error) {
      logger.debug("WebSocket message parse error", { error });
    }
  }

  private clearPersistentCacheForPublish(
    releaseId: string | null,
    environmentName: string | undefined,
  ): void {
    const deletionPrefixes = new Set<string>();
    const pendingPrefixes = new Set<string>();

    const addPrefixes = (prefixes: string[]): void => {
      for (const prefix of prefixes) {
        deletionPrefixes.add(prefix);
        pendingPrefixes.add(prefix);
      }
    };

    const addContextPrefixes = (ctx: ResolvedContentContext): void => {
      addPrefixes([
        buildFileCacheKeyPrefix(ctx),
        buildStatCacheKeyPrefix(ctx),
        buildDirCacheKeyPrefix(ctx),
        buildFileListCacheKey(ctx),
      ]);
    };

    const addBroadPrefixes = (sourceType: "release" | "environment"): void => {
      const sourceKey = sourceType === "release" ? "release" : "env";
      const base = `${sourceKey}:${this.deps.projectSlug}:`;
      addPrefixes([`file:${base}`, `stat:${base}`, `dir:${base}`, `files:${base}`]);
    };

    if (releaseId) {
      addContextPrefixes({
        sourceType: "release",
        projectSlug: this.deps.projectSlug,
        releaseId,
      });

      if (environmentName) {
        addContextPrefixes({
          sourceType: "environment",
          projectSlug: this.deps.projectSlug,
          environmentName,
          releaseId,
        });
      }
    } else {
      addBroadPrefixes("release");
      addBroadPrefixes("environment");
    }

    for (const prefix of pendingPrefixes) addPendingInvalidation(prefix);

    logger.info("PUBLISH POKE - clearing persistent cache", {
      projectSlug: this.deps.projectSlug,
      releaseId,
      environmentName,
      deletionPrefixes: Array.from(deletionPrefixes),
      pendingPrefixes: Array.from(pendingPrefixes),
      pendingInvalidations: getPendingInvalidationsCount(),
    });

    void (async () => {
      let succeeded = false;
      try {
        const results = await Promise.all(
          Array.from(deletionPrefixes).map((prefix) => this.deps.cache.deleteByPrefixAsync(prefix)),
        );
        const totalDeleted = results.reduce((sum, count) => sum + count, 0);
        succeeded = true;

        logger.info("PUBLISH POKE - persistent cache cleared", {
          projectSlug: this.deps.projectSlug,
          releaseId,
          environmentName,
          totalDeleted,
        });
      } catch (error) {
        logger.error("PUBLISH POKE - failed to clear persistent cache (stale data may be served)", {
          projectSlug: this.deps.projectSlug,
          releaseId,
          environmentName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      } finally {
        if (succeeded) {
          for (const prefix of pendingPrefixes) removePendingInvalidation(prefix);
        } else {
          // Keep pending invalidations active so reads bypass stale cache
          logger.error(
            "PUBLISH POKE - keeping pending invalidations active due to deletion failure",
            {
              projectSlug: this.deps.projectSlug,
              pendingPrefixes: Array.from(pendingPrefixes),
            },
          );
        }

        logger.info("PUBLISH POKE - cache invalidation complete", {
          projectSlug: this.deps.projectSlug,
          succeeded,
          pendingInvalidations: getPendingInvalidationsCount(),
        });
      }
    })();
  }

  private scheduleInvalidation(): void {
    if (this.invalidationTimer) clearTimeout(this.invalidationTimer);

    logger.debug("Scheduling invalidation", {
      debounceMs: INVALIDATION_DEBOUNCE_MS,
    });

    this.invalidationTimer = setTimeout(() => {
      this.invalidationTimer = null;
      this.performInvalidation();
    }, INVALIDATION_DEBOUNCE_MS);
  }

  private scheduleSelectiveInvalidation(changedPaths: string[]): void {
    for (const path of changedPaths) this.pendingChangedPaths.add(path);

    if (this.selectiveInvalidationTimer) clearTimeout(this.selectiveInvalidationTimer);

    logger.debug("Scheduling selective invalidation", {
      newPaths: changedPaths.length,
      totalPending: this.pendingChangedPaths.size,
      debounceMs: INVALIDATION_DEBOUNCE_MS,
    });

    this.selectiveInvalidationTimer = setTimeout(() => {
      this.selectiveInvalidationTimer = null;
      this.performSelectiveInvalidation();
    }, INVALIDATION_DEBOUNCE_MS);
  }

  private async performSelectiveInvalidation(): Promise<void> {
    const startTime = Date.now();
    const changedPaths = Array.from(this.pendingChangedPaths);
    this.pendingChangedPaths.clear();

    const contentContext = this.deps.getContentContext();
    const previewInvalidationPrefixes = this.getPreviewInvalidationPrefixes(contentContext);
    const previewInvalidationVersion = this.previewInvalidationVersion;
    let preparedStyleArtifact: PreviewStyleArtifactInfo | undefined;
    let succeeded = false;

    try {
      logger.debug("Performing selective invalidation", {
        changedPaths,
        count: changedPaths.length,
      });

      const sourceTypes = ["branch:", "release:", "env:"] as const;
      const fileTypes = ["file:", "stat:"] as const;

      const parentDirs = new Set<string>();
      const deletionPromises: Promise<number>[] = [];

      for (const path of changedPaths) {
        const slashIndex = path.lastIndexOf("/");
        parentDirs.add(slashIndex > 0 ? path.substring(0, slashIndex) : "");

        for (const fileType of fileTypes) {
          for (const sourceType of sourceTypes) {
            deletionPromises.push(
              this.deps.cache.deleteByPrefixAndSuffixAsync(fileType + sourceType, path),
            );
          }
        }
      }

      for (const parentDir of parentDirs) {
        for (const sourceType of sourceTypes) {
          deletionPromises.push(
            this.deps.cache.deleteByPrefixAndSuffixAsync("dir:" + sourceType, parentDir),
          );
        }
      }

      await Promise.all(deletionPromises);

      logger.debug("Cache entries deleted for changed paths", {
        changedPaths,
        parentDirs: Array.from(parentDirs),
        prefixes: ["file:", "stat:", "dir:"],
      });

      this.deps.invalidationCallbacks.invalidateModulePaths?.(changedPaths);

      const projectId = this.deps.client.getProjectId();
      logger.debug("Clearing SSR module cache for HMR", {
        changedPaths,
        projectId,
        usePerProject: !!this.deps.invalidationCallbacks.clearSSRModuleCacheForProject,
      });

      if (this.deps.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
        this.deps.invalidationCallbacks.clearSSRModuleCacheForProject(projectId);
      } else {
        this.deps.invalidationCallbacks.clearSSRModuleCache?.();
      }

      if (this.deps.invalidationCallbacks.clearRendererCacheForProject && projectId) {
        await this.deps.invalidationCallbacks.clearRendererCacheForProject(projectId);
      }

      if (this.deps.invalidationCallbacks.clearProjectCSSCache && this.deps.projectSlug) {
        this.deps.invalidationCallbacks.clearProjectCSSCache(this.deps.projectSlug);
      }

      if (contentContext?.sourceType === "branch") {
        await this.deps.cache.deleteByPrefixAsync("files:branch:");
        try {
          const files = await this.deps.client.listAllFiles();
          const cacheKey = buildFileListCacheKey(contentContext);
          await this.deps.setFileListCache(cacheKey, files);
          this.deps.clearFileListIndex();
          preparedStyleArtifact = await this.deps.pregenerateStyles?.(files);

          logger.debug("Fresh files cached (memory + Redis)", {
            cacheKey,
            fileCount: files.length,
            styleAssetPath: preparedStyleArtifact?.assetPath,
          });
        } catch (error) {
          logger.warn("Failed to fetch files during selective invalidation", {
            error,
          });
        }
      }

      this.pokeMetrics.invalidationsTriggered++;

      logger.info(
        "[WebSocketManager] TRIGGERING HMR RELOAD via invalidationCallbacks.triggerReload",
        {
          changedPaths,
          projectSlug: this.deps.projectSlug,
          projectId: this.deps.client.getProjectId(),
          hasTriggerReloadCallback: !!this.deps.invalidationCallbacks.triggerReload,
        },
      );

      const environment: "preview" | "production" = contentContext?.sourceType === "branch"
        ? "preview"
        : "production";
      const projectContext = {
        projectSlug: this.deps.projectSlug,
        projectId: this.deps.client.getProjectId(),
        environment,
        branch: contentContext?.branch ?? null,
        releaseId: contentContext?.releaseId ?? null,
        styleArtifactHash: preparedStyleArtifact?.hash,
        styleAssetPath: preparedStyleArtifact?.assetPath,
      };

      this.deps.invalidationCallbacks.triggerReload?.(changedPaths, projectContext);

      logger.info("Selective invalidation complete - HMR triggered", {
        changedPaths,
        durationMs: Date.now() - startTime,
        totalInvalidations: this.pokeMetrics.invalidationsTriggered,
      });

      this.callbacks.sendPokeAck(
        "selective",
        changedPaths,
        this.pokeMetrics.invalidationsTriggered,
      );
      succeeded = true;
    } finally {
      if (succeeded) {
        this.completePreviewInvalidation(
          previewInvalidationPrefixes,
          previewInvalidationVersion,
        );
        this.deps.invalidationCallbacks.evictCurrentAdapter?.();
      }
    }
  }

  private async performInvalidation(): Promise<void> {
    const startTime = Date.now();
    const contentContext = this.deps.getContentContext();
    const previewInvalidationPrefixes = this.getPreviewInvalidationPrefixes(contentContext);
    const previewInvalidationVersion = this.previewInvalidationVersion;
    let preparedStyleArtifact: PreviewStyleArtifactInfo | undefined;
    let succeeded = false;

    try {
      logger.debug("CACHE INVALIDATION STARTED - clearing all caches");

      const [
        fileBranchCount,
        fileReleaseCount,
        fileEnvCount,
        statBranchCount,
        statReleaseCount,
        statEnvCount,
        dirBranchCount,
        dirReleaseCount,
        dirEnvCount,
        filesBranchCount,
        filesReleaseCount,
        filesEnvCount,
      ] = await Promise.all([
        this.deps.cache.deleteByPrefixAsync("file:branch:"),
        this.deps.cache.deleteByPrefixAsync("file:release:"),
        this.deps.cache.deleteByPrefixAsync("file:env:"),
        this.deps.cache.deleteByPrefixAsync("stat:branch:"),
        this.deps.cache.deleteByPrefixAsync("stat:release:"),
        this.deps.cache.deleteByPrefixAsync("stat:env:"),
        this.deps.cache.deleteByPrefixAsync("dir:branch:"),
        this.deps.cache.deleteByPrefixAsync("dir:release:"),
        this.deps.cache.deleteByPrefixAsync("dir:env:"),
        this.deps.cache.deleteByPrefixAsync("files:branch:"),
        this.deps.cache.deleteByPrefixAsync("files:release:"),
        this.deps.cache.deleteByPrefixAsync("files:env:"),
      ]);

      // These caches are also cleared immediately on POKE receipt (before debounce).
      // These calls are redundant safety nets for the full invalidation flow.
      this.deps.clearMemoryCaches();
      this.deps.invalidationCallbacks.clearDomainCache?.();

      const projectId = this.deps.client.getProjectId();

      if (this.deps.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
        this.deps.invalidationCallbacks.clearSSRModuleCacheForProject(projectId);
      } else {
        this.deps.invalidationCallbacks.clearSSRModuleCache?.();
      }

      if (this.deps.invalidationCallbacks.clearRouterDetectionCacheForProject && projectId) {
        this.deps.invalidationCallbacks.clearRouterDetectionCacheForProject(projectId);
      }

      this.deps.invalidationCallbacks.clearModulePathCache?.();

      if (this.deps.invalidationCallbacks.clearSnippetCacheForProject && this.deps.projectSlug) {
        this.deps.invalidationCallbacks.clearSnippetCacheForProject(this.deps.projectSlug);
      }

      if (this.deps.invalidationCallbacks.clearRendererCacheForProject && projectId) {
        await this.deps.invalidationCallbacks.clearRendererCacheForProject(projectId);
      }

      if (this.deps.invalidationCallbacks.clearProjectCSSCache && this.deps.projectSlug) {
        this.deps.invalidationCallbacks.clearProjectCSSCache(this.deps.projectSlug);
      }

      const totalFileCount = fileBranchCount + fileReleaseCount + fileEnvCount;
      const totalStatCount = statBranchCount + statReleaseCount + statEnvCount;
      const totalDirCount = dirBranchCount + dirReleaseCount + dirEnvCount;
      const totalFilesListCount = filesBranchCount + filesReleaseCount + filesEnvCount;

      logger.debug("CACHES CLEARED (memory + Redis)", {
        fileCacheCleared: totalFileCount,
        statCacheCleared: totalStatCount,
        dirCacheCleared: totalDirCount,
        filesListCacheCleared: totalFilesListCount,
      });

      if (contentContext?.sourceType === "branch") {
        try {
          const files = await this.deps.client.listAllFiles();
          const cacheKey = buildFileListCacheKey(contentContext);
          await this.deps.setFileListCache(cacheKey, files);
          this.deps.clearFileListIndex();
          preparedStyleArtifact = await this.deps.pregenerateStyles?.(files);

          logger.debug("FRESH FILES FETCHED", {
            cacheKey,
            fileCount: files.length,
            styleAssetPath: preparedStyleArtifact?.assetPath,
          });
        } catch (error) {
          logger.warn("Failed to fetch files during invalidation", { error });
        }
      }

      this.pokeMetrics.invalidationsTriggered++;

      logger.info("TRIGGERING FULL BROWSER RELOAD via ReloadNotifier", {
        projectSlug: this.deps.projectSlug,
        projectId: this.deps.client.getProjectId(),
        hasTriggerReloadCallback: !!this.deps.invalidationCallbacks.triggerReload,
      });

      const environment: "preview" | "production" = contentContext?.sourceType === "branch"
        ? "preview"
        : "production";
      const projectContext = {
        projectSlug: this.deps.projectSlug,
        projectId: this.deps.client.getProjectId(),
        environment,
        branch: contentContext?.branch ?? null,
        releaseId: contentContext?.releaseId ?? null,
        styleArtifactHash: preparedStyleArtifact?.hash,
        styleAssetPath: preparedStyleArtifact?.assetPath,
      };

      this.deps.invalidationCallbacks.triggerReload?.(undefined, projectContext);

      logger.debug("CACHE INVALIDATION COMPLETE", {
        fileCacheCleared: totalFileCount,
        statCacheCleared: totalStatCount,
        dirCacheCleared: totalDirCount,
        filesListCacheCleared: totalFilesListCount,
        durationMs: Date.now() - startTime,
        totalInvalidations: this.pokeMetrics.invalidationsTriggered,
      });

      this.callbacks.sendPokeAck("full", undefined, this.pokeMetrics.invalidationsTriggered);
      succeeded = true;
    } finally {
      if (succeeded) {
        this.completePreviewInvalidation(
          previewInvalidationPrefixes,
          previewInvalidationVersion,
        );
        this.deps.invalidationCallbacks.evictCurrentAdapter?.();
      }
    }
  }
}
