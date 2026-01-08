import { logger } from "@veryfront/utils";
import type { DirectoryEntry, FSAdapter, FSAdapterConfig } from "./types.ts";
import type { FileInfo } from "../base.ts";
import { VeryfrontAPIClient } from "../veryfront-api-client.ts";
import type { Project } from "../veryfront-api-client.ts";
import { FileCache } from "../file-cache/file-cache.ts";
import type { FileCacheOptions } from "../file-cache/types.ts";
import { type CacheStats, createVeryfrontConfig } from "./types.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import { DirectoryOperations } from "./directory-operations.ts";
import { StatOperations } from "./stat-operations.ts";
import { clearSSRModuleCache } from "@veryfront/modules/react-loader/index.ts";
import { clearRouterDetectionCache } from "../../../rendering/router-detection.ts";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "../../../build/transforms/mdx/esm-module-loader.ts";
import { ReloadNotifier } from "../../../server/reload-notifier.ts";
import { clearSnippetCache } from "../../../rendering/snippet-renderer.ts";

const INVALIDATION_DEBOUNCE_MS = 100;
const WS_RECONNECT_DELAY_MS = 5000;
const WS_HEARTBEAT_INTERVAL_MS = 60000;
const WS_HEARTBEAT_TIMEOUT_MS = 300000;

export class VeryfrontFSAdapter implements FSAdapter {
  private client: VeryfrontAPIClient;
  private cache: FileCache;
  private normalizer: PathNormalizer;
  private readOps: ReadOperations;
  private dirOps: DirectoryOperations;
  private statOps: StatOperations;
  private initialized = false;
  private projectData?: Project;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wsLastPong: number = Date.now();
  private invalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private selectiveInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChangedPaths: Set<string> = new Set();
  private apiBaseUrl: string;
  private apiToken: string;
  private requestBranch: string | null = null;
  private productionMode = false;
  private releaseId: string | null = null;

  constructor(config: FSAdapterConfig) {
    const veryfrontConfig = createVeryfrontConfig(config);

    this.apiBaseUrl = veryfrontConfig.apiBaseUrl;
    this.apiToken = veryfrontConfig.apiToken;
    this.productionMode = veryfrontConfig.productionMode ?? false;
    this.releaseId = veryfrontConfig.releaseId ?? null;

    this.client = new VeryfrontAPIClient({
      apiBaseUrl: veryfrontConfig.apiBaseUrl,
      apiToken: veryfrontConfig.apiToken,
      projectSlug: veryfrontConfig.projectSlug,
      projectId: veryfrontConfig.projectId,
      proxyMode: veryfrontConfig.proxyMode,
      retry: veryfrontConfig.retry,
    });

    this.cache = new FileCache(veryfrontConfig.cache as FileCacheOptions);
    this.normalizer = new PathNormalizer(config.projectDir);
    const productionContext = {
      isProductionMode: () => this.productionMode,
      getReleaseId: () => this.releaseId,
    };
    // Create statOps first so readOps can use its getOriginalApiPath method
    this.statOps = new StatOperations(this.client, this.cache, this.normalizer, productionContext);
    this.readOps = new ReadOperations(
      this.client,
      this.cache,
      this.normalizer,
      productionContext,
      // Pass path resolver for normalized paths like "pages/index.mdx" -> "pages/"
      (path) => this.statOps.getOriginalApiPath(path),
    );
    this.dirOps = new DirectoryOperations(
      this.client,
      this.cache,
      this.normalizer,
      productionContext,
    );

    logger.info("[VeryfrontFSAdapter] Created", {
      apiBaseUrl: veryfrontConfig.apiBaseUrl,
      projectSlug: veryfrontConfig.projectSlug,
      projectDir: config.projectDir,
      cacheEnabled: veryfrontConfig.cache.enabled,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.debug("[VeryfrontFSAdapter] Initializing...");

    await this.client.initialize();

    const projectId = this.client.getProjectId();
    this.projectData = await this.client.getProject(projectId);

    logger.info("[VeryfrontFSAdapter] Project data fetched", {
      provider: this.projectData.provider,
      layout: this.projectData.layout,
    });

    // In production mode, skip draft file fetching and WebSocket connection
    // Published content is immutable and doesn't need real-time updates
    if (this.productionMode) {
      logger.debug("[VeryfrontFSAdapter] Production mode - skipping WebSocket and draft files");
      const cacheKey = `files:published:${this.releaseId ?? "latest"}`;
      const files = await this.client.listPublishedFiles(undefined, this.releaseId ?? undefined);
      this.cache.set(cacheKey, files);
      logger.debug("[VeryfrontFSAdapter] Fetched published files", {
        count: files.length,
        releaseId: this.releaseId ?? "latest",
      });

      this.initialized = true;
      logger.info("[VeryfrontFSAdapter] Initialized (production mode)", {
        projectId: this.client.getProjectId(),
        files: files.length,
        releaseId: this.releaseId ?? "latest",
      });
      return;
    }

    // Preview/development mode: fetch draft files and connect WebSocket
    const branch = this.requestBranch || "main";
    const cacheKey = `files:all:${branch}`;
    logger.debug("[VeryfrontFSAdapter] Fetching all files from API", { branch });
    const files = await this.client.listAllFiles();
    this.cache.set(cacheKey, files);
    logger.debug("[VeryfrontFSAdapter] Fetched files during initialization", {
      count: files.length,
      branch,
    });

    this.initialized = true;
    logger.info("[VeryfrontFSAdapter] Initialized", {
      projectId: this.client.getProjectId(),
      files: files.length,
    });

    // Connect to WebSocket for real-time cache invalidation (preview mode only)
    this.connectWebSocket(projectId);
  }

  private connectWebSocket(projectId: string): void {
    // Clean up any existing timers
    this.cleanupWebSocketTimers();

    const wsUrl = this.apiBaseUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:")
      .replace(/\/api$/, "");
    const url = `${wsUrl}/ws/${projectId}/events?token=${this.apiToken}`;

    logger.info("[VeryfrontFSAdapter] Connecting to WebSocket", {
      url: url.replace(this.apiToken, "***"),
    });

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        logger.info("[VeryfrontFSAdapter] WebSocket connected");
        this.wsLastPong = Date.now();
        this.startHeartbeat(projectId);
      };

      this.ws.onmessage = (event) => {
        // Update last pong time on any message (acts as implicit pong)
        this.wsLastPong = Date.now();
        logger.debug("[VeryfrontFSAdapter] WebSocket message received:", { data: event.data });
        try {
          const data = JSON.parse(event.data as string);
          const changedPaths = data.data?.changedPaths as string[] | undefined;
          // Only log poke messages at info level, ping/pong are debug
          if (data.type === "poke") {
            logger.info("[VeryfrontFSAdapter] 🔄 POKE RECEIVED - triggering cache invalidation", {
              source: data.data?.source,
              entityId: data.data?.entityId,
              entityType: data.data?.entityType,
              changedPathsCount: changedPaths?.length || 0,
              changedPaths: changedPaths || [],
            });
            // Use selective invalidation if we know which files changed
            if (changedPaths && changedPaths.length > 0) {
              this.scheduleSelectiveInvalidation(changedPaths);
            } else {
              // Fallback to full invalidation
              logger.info(
                "[VeryfrontFSAdapter] 🔄 No changedPaths provided - using full invalidation",
              );
              this.scheduleInvalidation();
            }
          }
        } catch (err) {
          logger.debug("[VeryfrontFSAdapter] WebSocket message parse error", { error: err });
        }
      };

      this.ws.onclose = () => {
        logger.info("[VeryfrontFSAdapter] WebSocket closed, reconnecting", {
          delayMs: WS_RECONNECT_DELAY_MS,
        });
        this.cleanupWebSocketTimers();
        this.wsReconnectTimer = setTimeout(() => {
          this.connectWebSocket(projectId);
        }, WS_RECONNECT_DELAY_MS);
      };

      this.ws.onerror = (error) => {
        logger.warn("[VeryfrontFSAdapter] WebSocket error", { error });
      };
    } catch (error) {
      logger.warn("[VeryfrontFSAdapter] Failed to connect WebSocket", { error });
      // Retry connection after delay
      this.wsReconnectTimer = setTimeout(() => {
        this.connectWebSocket(projectId);
      }, WS_RECONNECT_DELAY_MS);
    }
  }

  private startHeartbeat(projectId: string): void {
    this.wsHeartbeatTimer = setInterval(() => {
      const timeSinceLastPong = Date.now() - this.wsLastPong;
      if (timeSinceLastPong > WS_HEARTBEAT_TIMEOUT_MS) {
        logger.warn("[VeryfrontFSAdapter] WebSocket heartbeat timeout, reconnecting", {
          timeSinceLastPong,
        });
        // Force close and reconnect
        if (this.ws) {
          try {
            this.ws.close();
          } catch (_) {
            // Ignore close errors
          }
        }
        this.cleanupWebSocketTimers();
        this.connectWebSocket(projectId);
      }
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private cleanupWebSocketTimers(): void {
    if (this.wsHeartbeatTimer) {
      clearInterval(this.wsHeartbeatTimer);
      this.wsHeartbeatTimer = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  }

  private scheduleInvalidation(): void {
    // Debounce: reset timer on each poke to batch rapid changes
    if (this.invalidationTimer) {
      clearTimeout(this.invalidationTimer);
    }
    logger.info("[VeryfrontFSAdapter] Scheduling invalidation", {
      debounceMs: INVALIDATION_DEBOUNCE_MS,
    });
    this.invalidationTimer = setTimeout(() => {
      this.invalidationTimer = null;
      this.performInvalidation();
    }, INVALIDATION_DEBOUNCE_MS);
  }

  private scheduleSelectiveInvalidation(changedPaths: string[]): void {
    // Accumulate changed paths for batching
    for (const path of changedPaths) {
      this.pendingChangedPaths.add(path);
    }

    // Debounce: reset timer on each poke to batch rapid changes
    if (this.selectiveInvalidationTimer) {
      clearTimeout(this.selectiveInvalidationTimer);
    }
    logger.info("[VeryfrontFSAdapter] Scheduling selective invalidation", {
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

    logger.info("[VeryfrontFSAdapter] Performing selective invalidation", {
      changedPaths,
      count: changedPaths.length,
    });

    // Only invalidate file content cache for changed files (all branch variants)
    for (const path of changedPaths) {
      // Delete all branch variants by matching prefix and path suffix
      this.cache.deleteByPrefixAndSuffix("file:content:", path);
      this.cache.deleteByPrefixAndSuffix("file:text:", path);
      this.cache.deleteByPrefixAndSuffix("file:stat:", path);
    }

    // Invalidate only the changed module paths (not all modules)
    invalidateModulePaths(changedPaths);

    // Clear all files:all caches since file list may have changed
    this.cache.deleteByPrefix("files:all:");

    // Fetch fresh file list from API for current branch
    const branch = this.requestBranch || "main";
    try {
      const files = await this.client.listAllFiles();
      this.cache.set(`files:all:${branch}`, files);
    } catch (error) {
      logger.warn("[VeryfrontFSAdapter] Failed to fetch files during selective invalidation", {
        error,
      });
    }

    // Notify browser to reload with changed paths for smart HMR
    ReloadNotifier.triggerReload(changedPaths);

    const durationMs = Date.now() - startTime;
    logger.info("[VeryfrontFSAdapter] Selective invalidation complete", {
      changedPaths: changedPaths.length,
      durationMs,
    });
  }

  private async performInvalidation(): Promise<void> {
    const startTime = Date.now();

    logger.info("[VeryfrontFSAdapter] ✅ CACHE INVALIDATION STARTED - clearing all caches");

    // Step 1: Clear all caches and indexes
    const textCount = this.cache.deleteByPrefix("file:text:");
    const contentCount = this.cache.deleteByPrefix("file:content:");
    const statCount = this.cache.deleteByPrefix("file:stat:");
    const dirCount = this.cache.deleteByPrefix("dir:entries:");
    const filesAllCount = this.cache.deleteByPrefix("files:all:");
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    clearSSRModuleCache();
    clearRouterDetectionCache();
    clearModulePathCache();
    clearSnippetCache();

    logger.info("[VeryfrontFSAdapter] ✅ CACHES CLEARED", {
      textCacheCleared: textCount,
      contentCacheCleared: contentCount,
      statCacheCleared: statCount,
      dirCacheCleared: dirCount,
      filesAllCacheCleared: filesAllCount,
    });

    // Step 2: Fetch fresh file list from API - this blocks until API has committed changes
    // This guarantees content is ready before we trigger reload
    const branch = this.requestBranch || "main";
    try {
      const files = await this.client.listAllFiles();
      this.cache.set(`files:all:${branch}`, files);
      logger.info("[VeryfrontFSAdapter] ✅ FRESH FILES FETCHED", {
        branch,
        fileCount: files.length,
      });
    } catch (error) {
      logger.warn("[VeryfrontFSAdapter] Failed to fetch files during invalidation", { error });
      // Still trigger reload - browser will fetch fresh content
    }

    // Step 3: Trigger reload - content is now guaranteed to be available
    logger.info("[VeryfrontFSAdapter] ✅ TRIGGERING BROWSER RELOAD via ReloadNotifier");
    ReloadNotifier.triggerReload();

    logger.info("[VeryfrontFSAdapter] ✅ CACHE INVALIDATION COMPLETE", {
      textCacheCleared: textCount,
      contentCacheCleared: contentCount,
      durationMs: Date.now() - startTime,
    });
  }

  async readFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.readOps.readTextFile(path);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    return this.readOps.readFile(path);
  }

  async readTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.readOps.readTextFile(path);
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    await this.ensureInitialized();
    return this.dirOps.readdir(path);
  }

  async stat(path: string): Promise<FileInfo> {
    await this.ensureInitialized();
    return this.statOps.stat(path);
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.statOps.exists(path);
  }

  async resolveFile(basePath: string): Promise<string | null> {
    await this.ensureInitialized();
    return this.statOps.resolveFile(basePath);
  }

  dispose(): void {
    // Clean up WebSocket and timers
    this.cleanupWebSocketTimers();
    if (this.invalidationTimer) {
      clearTimeout(this.invalidationTimer);
      this.invalidationTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        logger.warn("[VeryfrontFSAdapter] Error closing WebSocket", { error: err });
      }
      this.ws = null;
    }
    this.cache.clear();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    this.initialized = false;
    logger.info("[VeryfrontFSAdapter] Disposed");
  }

  getCacheStats(): CacheStats {
    return {
      cache: this.cache.stats(),
    };
  }

  getProjectData(): Project | undefined {
    return this.projectData;
  }

  /**
   * Get the entity ID (UUID) for a given file path.
   * This is used by the Studio bridge to send the correct page ID.
   * Returns undefined if the entity ID is not available.
   */
  getEntityIdForPath(path: string): string | undefined {
    const normalizedPath = this.normalizer.normalize(path);
    const branch = this.requestBranch || "main";
    const cachedFiles = this.cache.get(`files:all:${branch}`) as
      | Array<{ id?: string; path: string }>
      | undefined;
    if (!cachedFiles) return undefined;

    const file = cachedFiles.find((f) => f.path === normalizedPath);
    return file?.id;
  }

  /**
   * Get the file path for a given entity ID (UUID).
   * This is used to resolve component UUIDs to their file paths.
   * Returns undefined if no file matches the entity ID.
   * Synchronous version - only checks cache.
   */
  getFilePathByEntityId(entityId: string): string | undefined {
    // In production mode, check published files cache
    if (this.productionMode) {
      const cacheKey = `files:published:${this.releaseId ?? "latest"}`;
      const publishedFiles = this.cache.get(cacheKey) as
        | Array<{ id?: string; path: string }>
        | undefined;
      if (publishedFiles) {
        const file = publishedFiles.find((f) => f.id === entityId);
        if (file?.path) return file.path;
      }
    }

    // Check draft files cache (development mode or fallback)
    const branch = this.requestBranch || "main";
    const cachedFiles = this.cache.get(`files:all:${branch}`) as
      | Array<{ id?: string; path: string }>
      | undefined;
    if (cachedFiles) {
      const file = cachedFiles.find((f) => f.id === entityId);
      if (file?.path) return file.path;
    }

    return undefined;
  }

  /**
   * Get the file path for a given entity ID (UUID) with API fallback.
   * First checks cache, then tries components API.
   * Returns path and optionally body content if available from components API.
   */
  async getFilePathByEntityIdAsync(
    entityId: string,
  ): Promise<{ path: string; body?: string } | undefined> {
    // First try synchronous cache lookup
    const cachedPath = this.getFilePathByEntityId(entityId);
    if (cachedPath) {
      return { path: cachedPath };
    }

    // Try components API (uses project slug)
    try {
      const component = await this.client.getComponentByEntityId(entityId);
      if (component?.path) {
        logger.info("[VeryfrontFSAdapter] Resolved entity via components API", {
          entityId,
          path: component.path,
          hasBody: !!component.body,
        });
        return {
          path: component.path,
          body: component.body,
        };
      }
    } catch (error) {
      logger.debug("[VeryfrontFSAdapter] Components API lookup failed", {
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return undefined;
  }

  /**
   * Set a per-request token from proxy headers.
   * This token takes priority over the config token for API calls.
   * Used when running behind the Deno proxy with OAuth tokens.
   */
  setRequestToken(token: string): void {
    this.client.setRequestToken(token);
    // Update stored token for WebSocket reconnection
    this.apiToken = token;
  }

  /**
   * Clear the per-request token, reverting to config token.
   */
  clearRequestToken(): void {
    this.client.clearRequestToken();
  }

  /**
   * Set a per-request branch from URL parsing.
   * When set, file content will be fetched from this branch instead of main.
   * Used for branch preview URLs like slug--branch.preview.lvh.me
   */
  setRequestBranch(branch: string | null): void {
    this.requestBranch = branch;
    this.client.setRequestBranch(branch);
  }

  /**
   * Get the current per-request branch.
   */
  getRequestBranch(): string | null {
    return this.requestBranch;
  }

  /**
   * Clear the per-request branch, reverting to main branch.
   */
  clearRequestBranch(): void {
    this.requestBranch = null;
    this.client.clearRequestBranch();
  }

  /**
   * Enable production mode for JIT rendering.
   * In production mode, files are fetched from published releases instead of drafts.
   */
  setProductionMode(enabled: boolean, releaseId?: string | null): void {
    const oldProductionMode = this.productionMode;
    const oldReleaseId = this.releaseId;
    const newReleaseId = releaseId ?? null;

    this.productionMode = enabled;
    this.releaseId = newReleaseId;

    // Clear index when productionMode or releaseId changes to force re-fetch
    // This is critical for JIT rendering where the same adapter may be used for
    // both preview (draft) and production (published) requests
    const modeChanged = oldProductionMode !== enabled;
    const releaseChanged = oldReleaseId !== newReleaseId;

    if (modeChanged || releaseChanged) {
      this.statOps.clearIndex();
      this.dirOps.clearTree();
      logger.info("[VeryfrontFSAdapter] Cleared index and dirTree due to mode change", {
        oldProductionMode,
        newProductionMode: enabled,
        oldReleaseId: oldReleaseId ?? "null",
        newReleaseId: newReleaseId ?? "null",
        modeChanged,
        releaseChanged,
      });
    }

    logger.info("[VeryfrontFSAdapter] Production mode set", {
      enabled,
      releaseId: newReleaseId ?? "latest",
    });
  }

  /**
   * Check if production mode is enabled.
   */
  isProductionMode(): boolean {
    return this.productionMode;
  }

  /**
   * Get the release ID used in production mode.
   */
  getReleaseId(): string | null {
    return this.releaseId;
  }

  /**
   * Clear production mode, reverting to draft content.
   */
  clearProductionMode(): void {
    this.productionMode = false;
    this.releaseId = null;
  }

  /**
   * Get the underlying API client (for advanced use cases).
   */
  getClient(): VeryfrontAPIClient {
    return this.client;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
