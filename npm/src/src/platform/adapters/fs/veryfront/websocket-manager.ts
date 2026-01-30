/**
 * WebSocket manager for real-time poke notifications and cache invalidation.
 *
 * Handles WebSocket connection lifecycle (connect, heartbeat, reconnect),
 * poke message processing with environment scoping, and both full and
 * selective cache invalidation with debouncing.
 */
import * as dntShim from "../../../../../_dnt.shims.js";


import { logger } from "../../../../utils/index.js";
import type { FileCache } from "../cache/file-cache.js";
import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.js";
import type { ContentSource, InvalidationCallbacks, ResolvedContentContext } from "./types.js";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildStatCacheKeyPrefix,
} from "./cache-keys.js";
import {
  addPendingInvalidation,
  getPendingInvalidationsCount,
  removePendingInvalidation,
} from "./invalidation-state.js";

const INVALIDATION_DEBOUNCE_MS = 100;
const WS_RECONNECT_DELAY_MS = 5000;
const WS_HEARTBEAT_INTERVAL_MS = 60000;
const WS_HEARTBEAT_TIMEOUT_MS = 300000;

/**
 * Dependencies injected by the adapter for the WebSocket manager to
 * interact with caches, the API client, and the adapter's internal state.
 */
export interface WebSocketDeps {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  cache: FileCache;
  client: VeryfrontAPIClient;
  invalidationCallbacks: InvalidationCallbacks;

  /** Returns the current content context (may change over lifetime). */
  getContentContext: () => ResolvedContentContext | null;
  /** Returns the static content source configuration. */
  getContentSource: () => ContentSource;
  /** Returns the project directory from the path normalizer. */
  getProjectDir: () => string | undefined;
  /** Clears all in-memory operation caches (file list index, stat index, dir tree). */
  clearMemoryCaches: () => void;
  /** Clears and rebuilds the file list index after cache update. */
  clearFileListIndex: () => void;
  /** Sets a new file list in the async cache. */
  setFileListCache: (
    cacheKey: string,
    files: Array<{ path: string; content?: string }>,
  ) => Promise<void>;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof dntShim.setTimeout> | null = null;
  private wsHeartbeatTimer: ReturnType<typeof dntShim.setInterval> | null = null;
  private wsLastPong = Date.now();
  private invalidationTimer: ReturnType<typeof dntShim.setTimeout> | null = null;
  private selectiveInvalidationTimer: ReturnType<typeof dntShim.setTimeout> | null = null;
  private pendingChangedPaths = new Set<string>();

  /** WebSocket connection identity for observability */
  private wsConnectionId: string | null = null;
  /** Poke notification metrics for observability */
  private pokeMetrics = {
    received: 0,
    invalidationsTriggered: 0,
    lastPokeTime: 0,
  };

  constructor(private readonly deps: WebSocketDeps) {}

  getPokeMetrics(): {
    received: number;
    invalidationsTriggered: number;
    lastPokeTime: number;
    connectionId: string | null;
  } {
    return { ...this.pokeMetrics, connectionId: this.wsConnectionId };
  }

  connect(projectId: string): void {
    this.cleanupTimers();

    const wsUrl = this.deps.apiBaseUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:")
      .replace(/\/api$/, "");
    const url = `${wsUrl}/ws/${projectId}/events?token=${this.deps.apiToken}`;

    logger.debug("[WebSocketManager] Connecting to WebSocket", {
      url: url.replace(this.deps.apiToken, "***"),
    });

    try {
      this.ws = new WebSocket(url);
      this.wsConnectionId = dntShim.crypto.randomUUID().slice(0, 8);

      this.ws.onopen = () => {
        logger.debug("[WebSocketManager] WebSocket connected to events channel", {
          projectId,
          connectionId: this.wsConnectionId,
          contentSource: this.deps.getContentSource(),
          branch: this.deps.getContentContext()?.branch,
        });
        this.wsLastPong = Date.now();
        this.startHeartbeat(projectId);
      };

      this.ws.onmessage = (event) => {
        this.wsLastPong = Date.now();
        logger.debug("[WebSocketManager] WebSocket message received:", { data: event.data });
        this.handlePokeMessage(event);
      };

      this.ws.onclose = () => {
        logger.debug("[WebSocketManager] WebSocket closed, reconnecting", {
          delayMs: WS_RECONNECT_DELAY_MS,
          connectionId: this.wsConnectionId,
          totalPokesReceived: this.pokeMetrics.received,
        });
        this.wsConnectionId = null;
        this.cleanupTimers();
        this.wsReconnectTimer = dntShim.setTimeout(
          () => this.connect(projectId),
          WS_RECONNECT_DELAY_MS,
        );
      };

      this.ws.onerror = (error) => {
        logger.warn("[WebSocketManager] WebSocket error", { error });
      };
    } catch (error) {
      logger.warn("[WebSocketManager] Failed to connect WebSocket", { error });
      this.wsReconnectTimer = dntShim.setTimeout(
        () => this.connect(projectId),
        WS_RECONNECT_DELAY_MS,
      );
    }
  }

  dispose(): void {
    this.cleanupTimers();

    if (this.invalidationTimer) {
      clearTimeout(this.invalidationTimer);
      this.invalidationTimer = null;
    }
    if (this.selectiveInvalidationTimer) {
      clearTimeout(this.selectiveInvalidationTimer);
      this.selectiveInvalidationTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        logger.warn("[WebSocketManager] Error closing WebSocket", { error });
      }
      this.ws = null;
    }
  }

  // ===========================================================================
  // Poke Message Processing
  // ===========================================================================

  private handlePokeMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data as string);
      const changedPaths = data.data?.changedPaths as string[] | undefined;
      const isPoke = data.type === "poke" || data.type === "entity_updated";
      if (!isPoke) return;

      const contentContext = this.deps.getContentContext();

      // Extract branch scope from poke to determine environment matching
      const pokeBranchId = data.data?.branchId as string | null | undefined;
      const pokeBranchName = data.data?.branchName as string | null | undefined;
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

      // Environment-scoped invalidation: only process pokes relevant to our mode
      const isProductionMode = contentContext?.sourceType !== "branch";
      const currentBranch = contentContext?.branch ?? null;
      const hasBranchScope = !!normalizedBranchName || !!normalizedBranchId;
      const isProductionPoke = !hasBranchScope;

      logger.debug("[WebSocketManager] POKE RECEIVED - checking environment scope", {
        type: data.type,
        pokeBranchId: normalizedBranchId,
        pokeBranchName: normalizedBranchName,
        isProductionPoke,
        isProductionMode,
        currentBranch,
        entityId: data.data?.entityId,
        entityType: data.data?.entityType,
        action: data.data?.action,
        connectionId: this.wsConnectionId,
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
        if (normalizedBranchName) {
          if (normalizedBranchName !== currentBranch) {
            logger.debug(
              "[WebSocketManager] POKE SKIPPED - different branch name in preview mode",
              {
                pokeBranchName: normalizedBranchName,
                currentBranch,
              },
            );
            return;
          }
        } else if (normalizedBranchId) {
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
        } else if (currentBranch !== null && currentBranch !== "main") {
          // Unscoped pokes (no branchId/branchName) are for main branch edits.
          // Skip only if we're on a named branch (not main).
          logger.debug(
            "[WebSocketManager] POKE SKIPPED - unscoped poke for named branch preview",
            { currentBranch },
          );
          return;
        }
      }

      // Extract deployment-specific data for targeted cache invalidation
      const pokeReleaseId = data.data?.releaseId as string | null | undefined;
      const normalizedPokeReleaseId = typeof pokeReleaseId === "string" && pokeReleaseId.length > 0
        ? pokeReleaseId
        : null;
      const isDeploymentPoke = data.data?.entityType === "deployment";
      const isPublishPoke = isDeploymentPoke || (isProductionMode && !changedPaths?.length);
      const pokeEnvironmentName = data.data?.environmentName as string | null | undefined;
      const normalizedPokeEnvironment =
        typeof pokeEnvironmentName === "string" && pokeEnvironmentName.length > 0
          ? pokeEnvironmentName
          : contentContext?.environmentName ??
            (isProductionMode ? "production" : undefined);

      logger.info("[WebSocketManager] POKE ACCEPTED - triggering cache invalidation", {
        changedPathsCount: changedPaths?.length || 0,
        changedPaths: changedPaths || [],
        projectSlug: this.deps.projectSlug,
        branch: contentContext?.branch,
        isDeploymentPoke,
        isPublishPoke,
        pokeReleaseId: normalizedPokeReleaseId,
        pokeEnvironmentName: normalizedPokeEnvironment,
      });

      // Clear in-memory caches immediately (before debounce) for fresh data
      this.deps.invalidationCallbacks.clearDomainCache?.();
      this.deps.clearMemoryCaches();
      logger.debug("[WebSocketManager] All in-memory caches cleared immediately on POKE");

      // Clear persistent cache for publish/deployment pokes to prevent stale hits
      if (isPublishPoke && this.deps.projectSlug) {
        this.clearPersistentCacheForPublish(
          normalizedPokeReleaseId,
          normalizedPokeEnvironment,
        );
      }

      if (changedPaths?.length) {
        this.scheduleSelectiveInvalidation(changedPaths);
        return;
      }

      logger.debug("[WebSocketManager] No changedPaths provided - using full invalidation");
      this.scheduleInvalidation();
    } catch (error) {
      logger.debug("[WebSocketManager] WebSocket message parse error", { error });
    }
  }

  // ===========================================================================
  // Persistent Cache Clearing (Publish/Deployment Pokes)
  // ===========================================================================

  private clearPersistentCacheForPublish(
    releaseId: string | null,
    environmentName: string | undefined,
  ): void {
    const deletionPrefixes = new Set<string>();
    const pendingPrefixes = new Set<string>();

    const addContextPrefixes = (ctx: ResolvedContentContext): void => {
      const filePrefix = buildFileCacheKeyPrefix(ctx);
      const statPrefix = buildStatCacheKeyPrefix(ctx);
      const dirPrefix = buildDirCacheKeyPrefix(ctx);
      const filesPrefix = buildFileListCacheKey(ctx);

      deletionPrefixes.add(filePrefix);
      deletionPrefixes.add(statPrefix);
      deletionPrefixes.add(dirPrefix);
      deletionPrefixes.add(filesPrefix);

      pendingPrefixes.add(filePrefix);
      pendingPrefixes.add(statPrefix);
      pendingPrefixes.add(dirPrefix);
      pendingPrefixes.add(filesPrefix);
    };

    const addBroadPrefixes = (sourceType: "release" | "environment"): void => {
      const sourceKey = sourceType === "release" ? "release" : "env";
      const base = `${sourceKey}:${this.deps.projectSlug}:`;

      deletionPrefixes.add(`file:${base}`);
      deletionPrefixes.add(`stat:${base}`);
      deletionPrefixes.add(`dir:${base}`);
      deletionPrefixes.add(`files:${base}`);

      pendingPrefixes.add(`file:${base}`);
      pendingPrefixes.add(`stat:${base}`);
      pendingPrefixes.add(`dir:${base}`);
      pendingPrefixes.add(`files:${base}`);
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

    for (const prefix of pendingPrefixes) {
      addPendingInvalidation(prefix);
    }

    logger.info(
      "[WebSocketManager] PUBLISH POKE - clearing persistent cache",
      {
        projectSlug: this.deps.projectSlug,
        releaseId,
        environmentName,
        deletionPrefixes: Array.from(deletionPrefixes),
        pendingPrefixes: Array.from(pendingPrefixes),
        pendingInvalidations: getPendingInvalidationsCount(),
      },
    );

    void (async () => {
      try {
        const results = await Promise.all(
          Array.from(deletionPrefixes).map((prefix) => this.deps.cache.deleteByPrefixAsync(prefix)),
        );
        const totalDeleted = results.reduce((sum, count) => sum + count, 0);
        logger.info(
          "[WebSocketManager] PUBLISH POKE - persistent cache cleared",
          {
            projectSlug: this.deps.projectSlug,
            releaseId,
            environmentName,
            totalDeleted,
          },
        );
      } catch (error) {
        logger.warn(
          "[WebSocketManager] PUBLISH POKE - failed to clear persistent cache",
          {
            projectSlug: this.deps.projectSlug,
            releaseId,
            environmentName,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      } finally {
        for (const prefix of pendingPrefixes) {
          removePendingInvalidation(prefix);
        }
        logger.debug(
          "[WebSocketManager] PUBLISH POKE - cache invalidation complete",
          {
            projectSlug: this.deps.projectSlug,
            pendingInvalidations: getPendingInvalidationsCount(),
          },
        );
      }
    })();
  }

  // ===========================================================================
  // Invalidation Scheduling
  // ===========================================================================

  private scheduleInvalidation(): void {
    if (this.invalidationTimer) clearTimeout(this.invalidationTimer);

    logger.debug("[WebSocketManager] Scheduling invalidation", {
      debounceMs: INVALIDATION_DEBOUNCE_MS,
    });

    this.invalidationTimer = dntShim.setTimeout(() => {
      this.invalidationTimer = null;
      this.performInvalidation();
    }, INVALIDATION_DEBOUNCE_MS);
  }

  private scheduleSelectiveInvalidation(changedPaths: string[]): void {
    for (const path of changedPaths) this.pendingChangedPaths.add(path);

    if (this.selectiveInvalidationTimer) clearTimeout(this.selectiveInvalidationTimer);

    logger.debug("[WebSocketManager] Scheduling selective invalidation", {
      newPaths: changedPaths.length,
      totalPending: this.pendingChangedPaths.size,
      debounceMs: INVALIDATION_DEBOUNCE_MS,
    });

    this.selectiveInvalidationTimer = dntShim.setTimeout(() => {
      this.selectiveInvalidationTimer = null;
      this.performSelectiveInvalidation();
    }, INVALIDATION_DEBOUNCE_MS);
  }

  // ===========================================================================
  // Invalidation Execution
  // ===========================================================================

  private async performSelectiveInvalidation(): Promise<void> {
    const startTime = Date.now();
    const changedPaths = Array.from(this.pendingChangedPaths);
    this.pendingChangedPaths.clear();
    const contentContext = this.deps.getContentContext();

    logger.debug("[WebSocketManager] Performing selective invalidation", {
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

    logger.debug("[WebSocketManager] Cache entries deleted for changed paths", {
      changedPaths,
      parentDirs: Array.from(parentDirs),
      prefixes: ["file:", "stat:", "dir:"],
    });

    this.deps.invalidationCallbacks.invalidateModulePaths?.(changedPaths);

    const projectId = this.deps.client.getProjectId();
    logger.debug("[WebSocketManager] Clearing SSR module cache for HMR", {
      changedPaths,
      projectId,
      usePerProject: !!this.deps.invalidationCallbacks.clearSSRModuleCacheForProject,
    });

    if (this.deps.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
      this.deps.invalidationCallbacks.clearSSRModuleCacheForProject(projectId);
    } else {
      this.deps.invalidationCallbacks.clearSSRModuleCache?.();
    }

    // Await renderer cache clear to prevent race condition with HMR
    if (this.deps.invalidationCallbacks.clearRendererCacheForProject && projectId) {
      await this.deps.invalidationCallbacks.clearRendererCacheForProject(projectId);
    }
    // No global fallback — clearRendererCache is deprecated due to multi-tenant blast radius.

    // Invalidate project CSS cache when source files change
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

        logger.debug("[WebSocketManager] Fresh files cached (memory + Redis)", {
          cacheKey,
          fileCount: files.length,
        });
      } catch (error) {
        logger.warn("[WebSocketManager] Failed to fetch files during selective invalidation", {
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
    };

    this.deps.invalidationCallbacks.triggerReload?.(changedPaths, projectContext);

    logger.info("[WebSocketManager] Selective invalidation complete - HMR triggered", {
      changedPaths,
      durationMs: Date.now() - startTime,
      totalInvalidations: this.pokeMetrics.invalidationsTriggered,
    });

    this.sendPokeAck("selective", changedPaths);
  }

  private async performInvalidation(): Promise<void> {
    const startTime = Date.now();
    const contentContext = this.deps.getContentContext();

    logger.debug("[WebSocketManager] CACHE INVALIDATION STARTED - clearing all caches");

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
    const projectDir = this.deps.getProjectDir();

    if (this.deps.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
      this.deps.invalidationCallbacks.clearSSRModuleCacheForProject(projectId);
    } else {
      this.deps.invalidationCallbacks.clearSSRModuleCache?.();
    }

    if (this.deps.invalidationCallbacks.clearRouterDetectionCacheForProject && projectDir) {
      this.deps.invalidationCallbacks.clearRouterDetectionCacheForProject(projectDir);
    } else {
      this.deps.invalidationCallbacks.clearRouterDetectionCache?.();
    }

    this.deps.invalidationCallbacks.clearModulePathCache?.();

    if (this.deps.invalidationCallbacks.clearSnippetCacheForProject && this.deps.projectSlug) {
      this.deps.invalidationCallbacks.clearSnippetCacheForProject(this.deps.projectSlug);
    } else {
      this.deps.invalidationCallbacks.clearSnippetCache?.();
    }

    // Await renderer cache clear to prevent race condition with HMR
    if (this.deps.invalidationCallbacks.clearRendererCacheForProject && projectId) {
      await this.deps.invalidationCallbacks.clearRendererCacheForProject(projectId);
    }
    // No global fallback — clearRendererCache is deprecated due to multi-tenant blast radius.

    // Invalidate project CSS cache on full cache clear
    if (this.deps.invalidationCallbacks.clearProjectCSSCache && this.deps.projectSlug) {
      this.deps.invalidationCallbacks.clearProjectCSSCache(this.deps.projectSlug);
    }

    const totalFileCount = fileBranchCount + fileReleaseCount + fileEnvCount;
    const totalStatCount = statBranchCount + statReleaseCount + statEnvCount;
    const totalDirCount = dirBranchCount + dirReleaseCount + dirEnvCount;
    const totalFilesListCount = filesBranchCount + filesReleaseCount + filesEnvCount;

    logger.debug("[WebSocketManager] CACHES CLEARED (memory + Redis)", {
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

        logger.debug("[WebSocketManager] FRESH FILES FETCHED", {
          cacheKey,
          fileCount: files.length,
        });
      } catch (error) {
        logger.warn("[WebSocketManager] Failed to fetch files during invalidation", { error });
      }
    }

    this.pokeMetrics.invalidationsTriggered++;
    logger.info("[WebSocketManager] TRIGGERING FULL BROWSER RELOAD via ReloadNotifier", {
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
    };

    this.deps.invalidationCallbacks.triggerReload?.(undefined, projectContext);

    logger.debug("[WebSocketManager] CACHE INVALIDATION COMPLETE", {
      fileCacheCleared: totalFileCount,
      statCacheCleared: totalStatCount,
      dirCacheCleared: totalDirCount,
      filesListCacheCleared: totalFilesListCount,
      durationMs: Date.now() - startTime,
      totalInvalidations: this.pokeMetrics.invalidationsTriggered,
    });

    this.sendPokeAck("full");
  }

  // ===========================================================================
  // Heartbeat & Timer Management
  // ===========================================================================

  private startHeartbeat(projectId: string): void {
    this.wsHeartbeatTimer = dntShim.setInterval(() => {
      const timeSinceLastPong = Date.now() - this.wsLastPong;
      if (timeSinceLastPong <= WS_HEARTBEAT_TIMEOUT_MS) return;

      logger.warn("[WebSocketManager] WebSocket heartbeat timeout, reconnecting", {
        timeSinceLastPong,
      });

      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // Ignore close errors
        }
      }
      this.cleanupTimers();
      this.connect(projectId);
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private cleanupTimers(): void {
    if (this.wsHeartbeatTimer) {
      clearInterval(this.wsHeartbeatTimer);
      this.wsHeartbeatTimer = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  }

  // ===========================================================================
  // Poke Acknowledgment
  // ===========================================================================

  private sendPokeAck(type: "selective" | "full", changedPaths?: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      this.ws.send(JSON.stringify({
        type: "poke_ack",
        data: {
          invalidationType: type,
          changedPaths: changedPaths ?? [],
          timestamp: Date.now(),
          connectionId: this.wsConnectionId,
          totalInvalidations: this.pokeMetrics.invalidationsTriggered,
        },
      }));
      logger.debug("[WebSocketManager] Poke acknowledgment sent", {
        type,
        changedPathsCount: changedPaths?.length ?? 0,
      });
    } catch (error) {
      logger.warn("[WebSocketManager] Failed to send poke acknowledgment", { error });
    }
  }
}
