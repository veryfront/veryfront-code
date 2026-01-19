import { logger } from "#veryfront/utils";
import type {
  CacheStats,
  ContentSource,
  DirectoryEntry,
  FSAdapter,
  FSAdapterConfig,
  InvalidationCallbacks,
  ResolvedContentContext,
} from "./types.ts";
import { createVeryfrontConfig } from "./types.ts";
import type { FileInfo } from "../../base.ts";
import { VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import type { Project } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import type { FileCacheOptions } from "../cache/types.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import { DirectoryOperations } from "./directory-operations.ts";
import { StatOperations } from "./stat-operations.ts";
import { buildFileListCacheKey } from "./cache-keys.ts";

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
  private projectSlug: string;
  private invalidationCallbacks: InvalidationCallbacks;
  /** Per-request branch override (for branch preview URLs) */
  private requestBranch: string | null = null;
  /** WebSocket connection identity for observability */
  private wsConnectionId: string | null = null;
  /** Poke notification metrics for observability */
  private pokeMetrics = {
    received: 0,
    invalidationsTriggered: 0,
    lastPokeTime: 0,
  };

  /** Content source configuration from config */
  private contentSource: ContentSource;
  /** Resolved content context after initialization (includes resolved releaseId for env/domain) */
  private contentContext: ResolvedContentContext | null = null;

  constructor(config: FSAdapterConfig) {
    // Store invalidation callbacks with no-op defaults
    this.invalidationCallbacks = config.invalidationCallbacks ?? {};
    const veryfrontConfig = createVeryfrontConfig(config);

    this.apiBaseUrl = veryfrontConfig.apiBaseUrl;
    this.apiToken = veryfrontConfig.apiToken;
    this.projectSlug = veryfrontConfig.projectSlug;
    this.contentSource = veryfrontConfig.contentSource;

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

    // Create content context getter for operations (resolved lazily during init)
    const contentContextGetter = {
      isProductionMode: () => this.contentContext?.sourceType !== "branch",
      getReleaseId: () => this.contentContext?.releaseId ?? null,
      getContentContext: () => this.contentContext,
    };

    // Create statOps first so readOps can use its getOriginalApiPath method
    this.statOps = new StatOperations(
      this.client,
      this.cache,
      this.normalizer,
      contentContextGetter,
    );
    this.readOps = new ReadOperations(
      this.client,
      this.cache,
      this.normalizer,
      contentContextGetter,
      // Pass path resolver for normalized paths like "pages/index.mdx" -> "pages/"
      (path) => this.statOps.getOriginalApiPath(path),
      // Pass file list cache getter to avoid redundant API calls when content is already fetched
      // Now async to support Redis cache lookup across pods
      async () => {
        if (!this.contentContext) return undefined;
        const cacheKey = buildFileListCacheKey(this.contentContext);
        return await this.cache.getAsync<Array<{ path: string; content?: string }>>(cacheKey);
      },
    );
    this.dirOps = new DirectoryOperations(
      this.client,
      this.cache,
      this.normalizer,
      contentContextGetter,
    );

    logger.debug("[VeryfrontFSAdapter] Created", {
      apiBaseUrl: veryfrontConfig.apiBaseUrl,
      projectSlug: veryfrontConfig.projectSlug,
      projectDir: config.projectDir,
      contentSource: this.contentSource,
      cacheEnabled: veryfrontConfig.cache.enabled,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.debug("[VeryfrontFSAdapter] Initializing...", { contentSource: this.contentSource });

    await this.client.initialize();

    const projectId = this.client.getProjectId();
    this.projectData = await this.client.getProject(projectId);

    logger.debug("[VeryfrontFSAdapter] Project data fetched", {
      provider: this.projectData.provider,
      layout: this.projectData.layout,
    });

    // Resolve content source to content context (skip if already set by setContentContext)
    if (!this.contentContext) {
      this.contentContext = await this.resolveContentSource();
    }

    logger.debug("[VeryfrontFSAdapter] Content context resolved", {
      sourceType: this.contentContext.sourceType,
      projectSlug: this.contentContext.projectSlug,
      branch: this.contentContext.branch,
      environmentName: this.contentContext.environmentName,
      releaseId: this.contentContext.releaseId,
    });

    // Fetch file list based on content source type
    const cacheKey = buildFileListCacheKey(this.contentContext);
    const files = await this.fetchFileList();
    this.cache.set(cacheKey, files);

    logger.debug("[VeryfrontFSAdapter] Fetched files during initialization", {
      count: files.length,
      cacheKey,
    });

    this.initialized = true;

    // Connect to WebSocket for real-time cache invalidation (branch mode only)
    // Environment/release/domain modes serve immutable published content
    if (this.contentContext.sourceType === "branch") {
      logger.debug("[VeryfrontFSAdapter] Initialized (branch mode)", {
        projectId: this.client.getProjectId(),
        files: files.length,
        branch: this.contentContext.branch,
      });
      this.connectWebSocket(projectId);
    } else {
      logger.debug("[VeryfrontFSAdapter] Initialized (published mode)", {
        projectId: this.client.getProjectId(),
        files: files.length,
        sourceType: this.contentContext.sourceType,
        environmentName: this.contentContext.environmentName,
        releaseId: this.contentContext.releaseId,
      });
    }
  }

  /**
   * Resolve content source config to a concrete content context.
   * For domain/environment types, this may involve API calls.
   */
  private async resolveContentSource(): Promise<ResolvedContentContext> {
    switch (this.contentSource.type) {
      case "branch":
        return {
          sourceType: "branch",
          projectSlug: this.projectSlug,
          branch: this.contentSource.branch ?? "main",
        };

      case "environment": {
        // Fetch from environment to get the deployed release ID
        const envResult = await this.client.listEnvironmentFiles(this.contentSource.name);
        return {
          sourceType: "environment",
          projectSlug: this.projectSlug,
          environmentName: this.contentSource.name,
          releaseId: envResult.release_id,
        };
      }

      case "domain": {
        // Lookup domain to resolve project + environment + release
        const lookup = await this.client.lookupProjectByDomain(this.contentSource.domain);
        if (!lookup) {
          throw new Error(`Domain lookup failed for: ${this.contentSource.domain}`);
        }
        return {
          sourceType: "environment",
          projectSlug: lookup.project_slug,
          environmentName: lookup.environment?.name ?? "production",
          releaseId: lookup.release_id ?? undefined,
        };
      }

      case "release":
        return {
          sourceType: "release",
          projectSlug: this.projectSlug,
          releaseId: this.contentSource.releaseId ?? "latest",
        };
    }
  }

  /**
   * Fetch file list based on current content context.
   */
  private async fetchFileList(): Promise<Array<{ path: string; content?: string }>> {
    if (!this.contentContext) {
      throw new Error("Content context not resolved");
    }

    switch (this.contentContext.sourceType) {
      case "branch":
        return await this.client.listAllFiles();

      case "environment": {
        // Use listAllEnvironmentFiles to paginate through ALL files
        // listEnvironmentFiles only returns a single page (default 100)
        return await this.client.listAllEnvironmentFiles(this.contentContext.environmentName!);
      }

      case "release":
        return await this.client.listPublishedFiles(undefined, this.contentContext.releaseId);
    }
  }

  private connectWebSocket(projectId: string): void {
    // Clean up any existing timers
    this.cleanupWebSocketTimers();

    const wsUrl = this.apiBaseUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:")
      .replace(/\/api$/, "");
    const url = `${wsUrl}/ws/${projectId}/events?token=${this.apiToken}`;

    logger.debug("[VeryfrontFSAdapter] Connecting to WebSocket", {
      url: url.replace(this.apiToken, "***"),
    });

    try {
      this.ws = new WebSocket(url);
      // Generate connection ID for observability
      this.wsConnectionId = crypto.randomUUID().slice(0, 8);

      this.ws.onopen = () => {
        logger.debug("[VeryfrontFSAdapter] WebSocket connected to events channel", {
          projectId,
          connectionId: this.wsConnectionId,
          contentSource: this.contentSource,
          branch: this.contentContext?.branch,
        });
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
          // Handle both legacy "poke" messages and new "entity_updated" messages from API
          const isPoke = data.type === "poke" || data.type === "entity_updated";
          if (isPoke) {
            const timeSinceLastPoke = this.pokeMetrics.lastPokeTime > 0
              ? Date.now() - this.pokeMetrics.lastPokeTime
              : null;
            this.pokeMetrics.received++;
            this.pokeMetrics.lastPokeTime = Date.now();

            logger.debug("[VeryfrontFSAdapter] POKE RECEIVED - triggering cache invalidation", {
              type: data.type,
              source: data.data?.source,
              entityId: data.data?.entityId,
              entityType: data.data?.entityType,
              action: data.data?.action,
              changedPathsCount: changedPaths?.length || 0,
              changedPaths: changedPaths || [],
              connectionId: this.wsConnectionId,
              totalPokesReceived: this.pokeMetrics.received,
              timeSinceLastPokeMs: timeSinceLastPoke,
            });
            // Use selective invalidation if we know which files changed
            if (changedPaths?.length) {
              this.scheduleSelectiveInvalidation(changedPaths);
            } else {
              // Fallback to full invalidation
              logger.debug(
                "[VeryfrontFSAdapter] No changedPaths provided - using full invalidation",
              );
              this.scheduleInvalidation();
            }
          }
        } catch (err) {
          logger.debug("[VeryfrontFSAdapter] WebSocket message parse error", { error: err });
        }
      };

      this.ws.onclose = () => {
        logger.debug("[VeryfrontFSAdapter] WebSocket closed, reconnecting", {
          delayMs: WS_RECONNECT_DELAY_MS,
          connectionId: this.wsConnectionId,
          totalPokesReceived: this.pokeMetrics.received,
        });
        this.wsConnectionId = null;
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
    logger.debug("[VeryfrontFSAdapter] Scheduling invalidation", {
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
    logger.debug("[VeryfrontFSAdapter] Scheduling selective invalidation", {
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

    logger.debug("[VeryfrontFSAdapter] Performing selective invalidation", {
      changedPaths,
      count: changedPaths.length,
    });

    // Invalidate file content, stat, and directory caches for changed files (all source type variants)
    // Cache keys are structured as: {type}:{sourceType}:{projectSlug}:{qualifier}:{path}
    // e.g., file:branch:codersociety:main:components/HeroSection.tsx
    // Await Redis deletions to prevent stale data race conditions
    const deletionPromises: Promise<number>[] = [];
    const parentDirs = new Set<string>();

    for (const path of changedPaths) {
      // Delete file content cache - all source type variants
      deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("file:branch:", path));
      deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("file:release:", path));
      deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("file:env:", path));
      // Delete stat cache - all source type variants
      deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("stat:branch:", path));
      deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("stat:release:", path));
      deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("stat:env:", path));
      // Track parent directories for directory cache invalidation
      // Root-level files (no "/") have empty string as parent dir to match normalized cache keys
      const slashIndex = path.lastIndexOf("/");
      const parentDir = slashIndex > 0 ? path.substring(0, slashIndex) : "";
      parentDirs.add(parentDir);
    }

    // Invalidate parent directory caches (for new/deleted files)
    for (const parentDir of parentDirs) {
      deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("dir:branch:", parentDir));
      deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("dir:release:", parentDir));
      deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("dir:env:", parentDir));
    }

    await Promise.all(deletionPromises);

    logger.debug("[VeryfrontFSAdapter] Cache entries deleted for changed paths", {
      changedPaths,
      parentDirs: Array.from(parentDirs),
      prefixes: ["file:", "stat:", "dir:"],
    });

    // Invalidate only the changed module paths (not all modules)
    this.invalidationCallbacks.invalidateModulePaths?.(changedPaths);

    // Clear SSR module cache to ensure fresh modules are loaded
    // This is critical for HMR - without this, browser refreshes but gets stale JS
    logger.debug("[VeryfrontFSAdapter] Clearing SSR module cache for HMR", {
      changedPaths,
      hasCallback: !!this.invalidationCallbacks.clearSSRModuleCache,
    });
    this.invalidationCallbacks.clearSSRModuleCache?.();

    // Clear file list cache and refetch (only for branch mode)
    if (this.contentContext?.sourceType === "branch") {
      await this.cache.deleteByPrefixAsync("files:branch:");
      try {
        const files = await this.client.listAllFiles();
        const cacheKey = buildFileListCacheKey(this.contentContext);
        // Use setAsync to ensure Redis has fresh data before browser refresh
        // This prevents race conditions where other pods read stale Redis cache
        await this.cache.setAsync(cacheKey, files);
        logger.debug("[VeryfrontFSAdapter] Fresh files cached (memory + Redis)", {
          cacheKey,
          fileCount: files.length,
        });
      } catch (error) {
        logger.warn("[VeryfrontFSAdapter] Failed to fetch files during selective invalidation", {
          error,
        });
      }
    }

    // Notify browser to reload with changed paths for smart HMR
    this.pokeMetrics.invalidationsTriggered++;
    this.invalidationCallbacks.triggerReload?.(changedPaths);

    const durationMs = Date.now() - startTime;
    logger.debug("[VeryfrontFSAdapter] Selective invalidation complete", {
      changedPaths: changedPaths.length,
      durationMs,
      totalInvalidations: this.pokeMetrics.invalidationsTriggered,
    });
  }

  private async performInvalidation(): Promise<void> {
    const startTime = Date.now();

    logger.debug("[VeryfrontFSAdapter] CACHE INVALIDATION STARTED - clearing all caches");

    // Step 1: Clear all caches and indexes (await Redis deletion to prevent stale data race)
    // Use Promise.all to run Redis deletions in parallel for better performance
    // Cache key prefixes must match those in cache-keys.ts: file:{sourceType}:, stat:{sourceType}:, etc.
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
      // File content cache - all source types
      this.cache.deleteByPrefixAsync("file:branch:"),
      this.cache.deleteByPrefixAsync("file:release:"),
      this.cache.deleteByPrefixAsync("file:env:"),
      // Stat cache - all source types
      this.cache.deleteByPrefixAsync("stat:branch:"),
      this.cache.deleteByPrefixAsync("stat:release:"),
      this.cache.deleteByPrefixAsync("stat:env:"),
      // Directory cache - all source types
      this.cache.deleteByPrefixAsync("dir:branch:"),
      this.cache.deleteByPrefixAsync("dir:release:"),
      this.cache.deleteByPrefixAsync("dir:env:"),
      // File list cache - all source types
      this.cache.deleteByPrefixAsync("files:branch:"),
      this.cache.deleteByPrefixAsync("files:release:"),
      this.cache.deleteByPrefixAsync("files:env:"),
    ]);
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    this.invalidationCallbacks.clearSSRModuleCache?.();
    this.invalidationCallbacks.clearRouterDetectionCache?.();
    this.invalidationCallbacks.clearModulePathCache?.();
    this.invalidationCallbacks.clearSnippetCache?.();

    const totalFileCount = fileBranchCount + fileReleaseCount + fileEnvCount;
    const totalStatCount = statBranchCount + statReleaseCount + statEnvCount;
    const totalDirCount = dirBranchCount + dirReleaseCount + dirEnvCount;
    const totalFilesListCount = filesBranchCount + filesReleaseCount + filesEnvCount;

    logger.debug("[VeryfrontFSAdapter] CACHES CLEARED (memory + Redis)", {
      fileCacheCleared: totalFileCount,
      statCacheCleared: totalStatCount,
      dirCacheCleared: totalDirCount,
      filesListCacheCleared: totalFilesListCount,
    });

    // Step 2: Fetch fresh file list from API - this blocks until API has committed changes
    // This guarantees content is ready before we trigger reload (only for branch mode)
    if (this.contentContext?.sourceType === "branch") {
      try {
        const files = await this.client.listAllFiles();
        const cacheKey = buildFileListCacheKey(this.contentContext);
        // Use setAsync to ensure Redis has fresh data before browser refresh
        // This prevents race conditions where other pods read stale Redis cache
        await this.cache.setAsync(cacheKey, files);
        logger.debug("[VeryfrontFSAdapter] FRESH FILES FETCHED", {
          cacheKey,
          fileCount: files.length,
        });
      } catch (error) {
        logger.warn("[VeryfrontFSAdapter] Failed to fetch files during invalidation", { error });
        // Still trigger reload - browser will fetch fresh content
      }
    }

    // Step 3: Trigger reload - content is now guaranteed to be available
    this.pokeMetrics.invalidationsTriggered++;
    logger.debug("[VeryfrontFSAdapter] TRIGGERING BROWSER RELOAD via ReloadNotifier");
    this.invalidationCallbacks.triggerReload?.();

    logger.debug("[VeryfrontFSAdapter] CACHE INVALIDATION COMPLETE", {
      fileCacheCleared: totalFileCount,
      statCacheCleared: totalStatCount,
      dirCacheCleared: totalDirCount,
      filesListCacheCleared: totalFilesListCount,
      durationMs: Date.now() - startTime,
      totalInvalidations: this.pokeMetrics.invalidationsTriggered,
    });
  }

  /**
   * Get poke notification metrics for observability.
   */
  getPokeMetrics(): {
    received: number;
    invalidationsTriggered: number;
    lastPokeTime: number;
    connectionId: string | null;
  } {
    return {
      ...this.pokeMetrics,
      connectionId: this.wsConnectionId,
    };
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
    logger.debug("[VeryfrontFSAdapter] Disposed");
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
    if (!this.contentContext) return undefined;

    const normalizedPath = this.normalizer.normalize(path);
    const cacheKey = buildFileListCacheKey(this.contentContext);
    const cachedFiles = this.cache.get(cacheKey) as
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
    if (!this.contentContext) return undefined;

    const cacheKey = buildFileListCacheKey(this.contentContext);
    const cachedFiles = this.cache.get(cacheKey) as
      | Array<{ id?: string; path: string }>
      | undefined;
    if (cachedFiles) {
      const file = cachedFiles.find((f) => f.id === entityId);
      if (file?.path) return file.path;
    }

    return undefined;
  }

  /**
   * Get the file path and body for a given entity ID (UUID).
   * First checks cache, then falls back to API call for components.
   * Returns the import path (e.g., "components/layout.tsx") and body content.
   */
  async getFilePathByEntityIdAsync(
    entityId: string,
  ): Promise<{ path: string; body?: string } | undefined> {
    // First try sync cache lookup
    const cachedPath = this.getFilePathByEntityId(entityId);
    if (cachedPath) {
      return { path: cachedPath };
    }

    // If not in cache, try fetching file by entity ID from API
    // This is needed for layout UUIDs that may not be in the files list
    logger.debug("[VeryfrontFSAdapter] Fetching file by entity ID from API", { entityId });
    try {
      const file = await this.client.getFileById(entityId);
      if (file) {
        logger.debug("[VeryfrontFSAdapter] File resolved from API", {
          entityId,
          path: file.path,
          contentLength: file.content.length,
        });

        return {
          path: file.path,
          body: file.content,
        };
      }
    } catch (error) {
      logger.warn("[VeryfrontFSAdapter] Failed to fetch file by entity ID", {
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
   * Set content context directly (used by proxy for per-request context switching).
   * Also syncs context to the API client to ensure correct endpoint is used.
   */
  setContentContext(context: ResolvedContentContext): void {
    const oldContext = this.contentContext;

    logger.debug("[VeryfrontFSAdapter] setContentContext called", {
      newSourceType: context.sourceType,
      newProjectSlug: context.projectSlug,
      newBranch: context.branch,
      newReleaseId: context.releaseId,
      newEnvironmentName: context.environmentName,
      oldSourceType: oldContext?.sourceType,
      oldBranch: oldContext?.branch,
      oldReleaseId: oldContext?.releaseId,
      contextWillChange: JSON.stringify(oldContext) !== JSON.stringify(context),
    });

    this.contentContext = context;

    // Sync context to API client to ensure correct endpoint is used
    // This is critical for preview vs production content serving
    switch (context.sourceType) {
      case "branch":
        this.client.setContext({ type: "branch", name: context.branch ?? "main" });
        break;
      case "environment":
        this.client.setContext({
          type: "environment",
          name: context.environmentName ?? "production",
        });
        break;
      case "release":
        this.client.setContext({ type: "release", version: context.releaseId ?? "" });
        break;
    }

    // Clear index when context changes to force re-fetch
    const contextChanged = JSON.stringify(oldContext) !== JSON.stringify(context);
    if (contextChanged) {
      this.statOps.clearIndex();
      this.dirOps.clearTree();
      logger.debug("[VeryfrontFSAdapter] Cleared index and dirTree due to context change", {
        oldContext,
        newContext: context,
      });
    }

    logger.debug("[VeryfrontFSAdapter] Content context set complete", {
      sourceType: context.sourceType,
      projectSlug: context.projectSlug,
    });
  }

  /**
   * Get the current content context.
   */
  getContentContext(): ResolvedContentContext | null {
    // Log when context is accessed for debugging preview issues
    if (!this.contentContext) {
      logger.warn("[VeryfrontFSAdapter] getContentContext returning null", {
        projectSlug: this.projectSlug,
        initialized: this.initialized,
        hasClient: !!this.client,
      });
    }
    return this.contentContext;
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
