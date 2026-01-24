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

function isSourceFile(path: string): boolean {
  return (
    path.endsWith(".tsx") ||
    path.endsWith(".jsx") ||
    path.endsWith(".mdx") ||
    path.endsWith(".ts") ||
    path.endsWith(".js")
  );
}

export class VeryfrontFSAdapter implements FSAdapter {
  private client: VeryfrontAPIClient;
  private cache: FileCache;
  private normalizer: PathNormalizer;
  private readOps: ReadOperations;
  private dirOps: DirectoryOperations;
  private statOps: StatOperations;
  private initialized = false;

  /** Resolves when file list initialization is complete (for coordinating reads) */
  private fileListReadyResolve: (() => void) | null = null;
  /** Rejects when file list initialization fails */
  private fileListReadyReject: ((error: Error) => void) | null = null;

  private projectData?: Project;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wsLastPong = Date.now();
  private invalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private selectiveInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChangedPaths = new Set<string>();
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
  /** Whether running in proxy mode (shared adapter with per-request OAuth tokens) */
  private proxyMode: boolean;

  constructor(config: FSAdapterConfig) {
    this.invalidationCallbacks = config.invalidationCallbacks ?? {};
    const veryfrontConfig = createVeryfrontConfig(config);

    this.apiBaseUrl = veryfrontConfig.apiBaseUrl;
    this.apiToken = veryfrontConfig.apiToken;
    this.projectSlug = veryfrontConfig.projectSlug;
    this.contentSource = veryfrontConfig.contentSource;
    this.proxyMode = veryfrontConfig.proxyMode ?? false;

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

    const contentContextGetter = {
      isProductionMode: () => this.contentContext?.sourceType !== "branch",
      getReleaseId: () => this.contentContext?.releaseId ?? null,
      getContentContext: () => this.contentContext,
      getFileList: async () => {
        if (!this.contentContext) {
          logger.debug("[VeryfrontFSAdapter] getFileList: no contentContext");
          return undefined;
        }
        const cacheKey = buildFileListCacheKey(this.contentContext);
        const result = await this.cache.getAsync<
          Array<{
            id?: string;
            path: string;
            content?: string;
            type?: string;
            size?: number;
            updated_at?: string;
          }>
        >(cacheKey);
        logger.debug("[VeryfrontFSAdapter] getFileList lookup", {
          cacheKey,
          hasResult: !!result,
          resultSize: result?.length ?? 0,
        });
        return result;
      },
    };

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
      (path) => this.statOps.getOriginalApiPath(path),
      async () => {
        if (!this.contentContext) {
          logger.debug("[VeryfrontFSAdapter] getFileListCache: no contentContext");
          return undefined;
        }
        const cacheKey = buildFileListCacheKey(this.contentContext);
        const result = await this.cache.getAsync<Array<{ path: string; content?: string }>>(
          cacheKey,
        );
        logger.info("[VeryfrontFSAdapter] getFileListCache lookup", {
          cacheKey,
          hasResult: !!result,
          resultSize: result?.length ?? 0,
          hasContent: result?.filter((f) => f.content)?.length ?? 0,
        });
        return result;
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
    const initStartTime = performance.now();
    const projectSlug = this.client.getProjectSlug();

    logger.debug("[VeryfrontFSAdapter] initialize START", {
      projectSlug,
      contentSource: this.contentSource,
      alreadyInitialized: this.initialized,
    });

    if (this.initialized) {
      logger.debug("[VeryfrontFSAdapter] Already initialized, skipping", { projectSlug });
      return;
    }

    const fileListReadyPromise = new Promise<void>((resolve, reject) => {
      this.fileListReadyResolve = resolve;
      this.fileListReadyReject = reject;
    });
    this.readOps.setFileListReadyPromise(fileListReadyPromise);

    logger.debug("[VeryfrontFSAdapter] Step 1: client.initialize START", { projectSlug });
    const step1Start = performance.now();
    await this.client.initialize();
    logger.debug("[VeryfrontFSAdapter] Step 1: client.initialize DONE", {
      projectSlug,
      duration: `${(performance.now() - step1Start).toFixed(2)}ms`,
    });

    const projectId = this.client.getProjectId();
    logger.debug("[VeryfrontFSAdapter] Step 2: getProject START", { projectSlug, projectId });
    const step2Start = performance.now();

    const cachedProject = this.client.getCachedProject();
    if (cachedProject) {
      this.projectData = cachedProject;
      logger.debug("[VeryfrontFSAdapter] Step 2: getProject DONE (from cache)", {
        projectSlug,
        provider: this.projectData.provider,
        layout: this.projectData.layout,
        duration: `${(performance.now() - step2Start).toFixed(2)}ms`,
      });
    } else {
      this.projectData = await this.client.getProject(projectId);
      logger.debug("[VeryfrontFSAdapter] Step 2: getProject DONE (from API)", {
        projectSlug,
        provider: this.projectData.provider,
        layout: this.projectData.layout,
        duration: `${(performance.now() - step2Start).toFixed(2)}ms`,
      });
    }

    if (!this.contentContext) {
      logger.debug("[VeryfrontFSAdapter] Step 3: resolveContentSource START", { projectSlug });
      const step3Start = performance.now();
      this.contentContext = await this.resolveContentSource();
      logger.debug("[VeryfrontFSAdapter] Step 3: resolveContentSource DONE", {
        projectSlug,
        sourceType: this.contentContext.sourceType,
        duration: `${(performance.now() - step3Start).toFixed(2)}ms`,
      });
    } else {
      logger.debug("[VeryfrontFSAdapter] Step 3: Content context already set", {
        projectSlug,
        sourceType: this.contentContext.sourceType,
      });
    }

    logger.debug("[VeryfrontFSAdapter] Content context resolved", {
      sourceType: this.contentContext.sourceType,
      projectSlug: this.contentContext.projectSlug,
      branch: this.contentContext.branch,
      environmentName: this.contentContext.environmentName,
      releaseId: this.contentContext.releaseId,
    });

    const cacheKey = buildFileListCacheKey(this.contentContext);
    logger.debug("[VeryfrontFSAdapter] Step 4: fetchFileList START", { projectSlug, cacheKey });

    try {
      const files = await this.fetchFileList();

      const filesWithContent = files.filter((f) => f.content);
      const sourceFiles = files.filter((f) => isSourceFile(f.path));
      const sourceFilesWithContent = sourceFiles.filter((f) => f.content);

      await this.cache.setAsync(cacheKey, files);

      this.fileListReadyResolve?.();
      this.fileListReadyResolve = null;
      this.fileListReadyReject = null;

      logger.debug("[VeryfrontFSAdapter] Fetched files during initialization", {
        cacheKey,
        totalFiles: files.length,
        filesWithContent: filesWithContent.length,
        sourceFiles: sourceFiles.length,
        sourceFilesWithContent: sourceFilesWithContent.length,
      });

      this.initialized = true;

      logger.debug("[VeryfrontFSAdapter] initialize COMPLETE", {
        projectSlug,
        fileCount: files.length,
        totalDuration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
      });

      if (this.contentContext.sourceType === "branch") {
        logger.debug("[VeryfrontFSAdapter] Initialized (branch mode)", {
          projectId: this.client.getProjectId(),
          files: files.length,
          branch: this.contentContext.branch,
          proxyMode: this.proxyMode,
        });
        this.connectWebSocket(projectId);
        return;
      }

      logger.debug("[VeryfrontFSAdapter] Initialized (published mode)", {
        projectId: this.client.getProjectId(),
        files: files.length,
        sourceType: this.contentContext.sourceType,
        environmentName: this.contentContext.environmentName,
        releaseId: this.contentContext.releaseId,
      });
    } catch (error) {
      this.fileListReadyReject?.(error instanceof Error ? error : new Error(String(error)));
      this.fileListReadyResolve = null;
      this.fileListReadyReject = null;
      throw error;
    }
  }

  private async resolveContentSource(): Promise<ResolvedContentContext> {
    switch (this.contentSource.type) {
      case "branch":
        return {
          sourceType: "branch",
          projectSlug: this.projectSlug,
          branch: this.contentSource.branch ?? "main",
        };

      case "environment": {
        const envResult = await this.client.listEnvironmentFiles(this.contentSource.name);
        return {
          sourceType: "environment",
          projectSlug: this.projectSlug,
          environmentName: this.contentSource.name,
          releaseId: envResult.release_id,
        };
      }

      case "domain": {
        const lookup = await this.client.lookupProjectByDomain(this.contentSource.domain);
        if (!lookup) throw new Error(`Domain lookup failed for: ${this.contentSource.domain}`);
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

  private fetchFileList(): Promise<Array<{ path: string; content?: string }>> {
    if (!this.contentContext) throw new Error("Content context not resolved");

    switch (this.contentContext.sourceType) {
      case "branch":
        return this.client.listAllFiles();

      case "environment":
        return this.client.listAllEnvironmentFiles(this.contentContext.environmentName!);

      case "release":
        return this.client.listPublishedFiles(undefined, this.contentContext.releaseId);
    }
  }

  private connectWebSocket(projectId: string): void {
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
        this.wsLastPong = Date.now();
        logger.debug("[VeryfrontFSAdapter] WebSocket message received:", { data: event.data });

        try {
          const data = JSON.parse(event.data as string);
          const changedPaths = data.data?.changedPaths as string[] | undefined;
          const isPoke = data.type === "poke" || data.type === "entity_updated";
          if (!isPoke) return;

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

          if (changedPaths?.length) {
            this.scheduleSelectiveInvalidation(changedPaths);
            return;
          }

          logger.debug("[VeryfrontFSAdapter] No changedPaths provided - using full invalidation");
          this.scheduleInvalidation();
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
        this.wsReconnectTimer = setTimeout(
          () => this.connectWebSocket(projectId),
          WS_RECONNECT_DELAY_MS,
        );
      };

      this.ws.onerror = (error) => {
        logger.warn("[VeryfrontFSAdapter] WebSocket error", { error });
      };
    } catch (error) {
      logger.warn("[VeryfrontFSAdapter] Failed to connect WebSocket", { error });
      this.wsReconnectTimer = setTimeout(
        () => this.connectWebSocket(projectId),
        WS_RECONNECT_DELAY_MS,
      );
    }
  }

  private startHeartbeat(projectId: string): void {
    this.wsHeartbeatTimer = setInterval(() => {
      const timeSinceLastPong = Date.now() - this.wsLastPong;
      if (timeSinceLastPong <= WS_HEARTBEAT_TIMEOUT_MS) return;

      logger.warn("[VeryfrontFSAdapter] WebSocket heartbeat timeout, reconnecting", {
        timeSinceLastPong,
      });

      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // Ignore close errors
        }
      }
      this.cleanupWebSocketTimers();
      this.connectWebSocket(projectId);
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
    if (this.invalidationTimer) clearTimeout(this.invalidationTimer);

    logger.debug("[VeryfrontFSAdapter] Scheduling invalidation", {
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
            this.cache.deleteByPrefixAndSuffixAsync(fileType + sourceType, path),
          );
        }
      }
    }

    for (const parentDir of parentDirs) {
      for (const sourceType of sourceTypes) {
        deletionPromises.push(
          this.cache.deleteByPrefixAndSuffixAsync("dir:" + sourceType, parentDir),
        );
      }
    }

    await Promise.all(deletionPromises);

    logger.debug("[VeryfrontFSAdapter] Cache entries deleted for changed paths", {
      changedPaths,
      parentDirs: Array.from(parentDirs),
      prefixes: ["file:", "stat:", "dir:"],
    });

    this.invalidationCallbacks.invalidateModulePaths?.(changedPaths);

    const projectId = this.client.getProjectId();
    logger.debug("[VeryfrontFSAdapter] Clearing SSR module cache for HMR", {
      changedPaths,
      projectId,
      usePerProject: !!this.invalidationCallbacks.clearSSRModuleCacheForProject,
    });

    if (this.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
      this.invalidationCallbacks.clearSSRModuleCacheForProject(projectId);
    } else {
      this.invalidationCallbacks.clearSSRModuleCache?.();
    }

    if (this.invalidationCallbacks.clearRendererCacheForProject && projectId) {
      this.invalidationCallbacks.clearRendererCacheForProject(projectId);
    } else {
      this.invalidationCallbacks.clearRendererCache?.();
    }

    if (this.contentContext?.sourceType === "branch") {
      await this.cache.deleteByPrefixAsync("files:branch:");
      try {
        const files = await this.client.listAllFiles();
        const cacheKey = buildFileListCacheKey(this.contentContext);
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

    this.pokeMetrics.invalidationsTriggered++;
    this.invalidationCallbacks.triggerReload?.(changedPaths, {
      projectSlug: this.projectSlug,
      projectId: this.client.getProjectId(),
    });

    logger.debug("[VeryfrontFSAdapter] Selective invalidation complete", {
      changedPaths: changedPaths.length,
      durationMs: Date.now() - startTime,
      totalInvalidations: this.pokeMetrics.invalidationsTriggered,
    });
  }

  private async performInvalidation(): Promise<void> {
    const startTime = Date.now();

    logger.debug("[VeryfrontFSAdapter] CACHE INVALIDATION STARTED - clearing all caches");

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
      this.cache.deleteByPrefixAsync("file:branch:"),
      this.cache.deleteByPrefixAsync("file:release:"),
      this.cache.deleteByPrefixAsync("file:env:"),
      this.cache.deleteByPrefixAsync("stat:branch:"),
      this.cache.deleteByPrefixAsync("stat:release:"),
      this.cache.deleteByPrefixAsync("stat:env:"),
      this.cache.deleteByPrefixAsync("dir:branch:"),
      this.cache.deleteByPrefixAsync("dir:release:"),
      this.cache.deleteByPrefixAsync("dir:env:"),
      this.cache.deleteByPrefixAsync("files:branch:"),
      this.cache.deleteByPrefixAsync("files:release:"),
      this.cache.deleteByPrefixAsync("files:env:"),
    ]);

    this.statOps.clearIndex();
    this.dirOps.clearTree();

    const projectId = this.client.getProjectId();
    const projectDir = this.normalizer.getProjectDir();

    if (this.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
      this.invalidationCallbacks.clearSSRModuleCacheForProject(projectId);
    } else {
      this.invalidationCallbacks.clearSSRModuleCache?.();
    }

    if (this.invalidationCallbacks.clearRouterDetectionCacheForProject && projectDir) {
      this.invalidationCallbacks.clearRouterDetectionCacheForProject(projectDir);
    } else {
      this.invalidationCallbacks.clearRouterDetectionCache?.();
    }

    this.invalidationCallbacks.clearModulePathCache?.();

    if (this.invalidationCallbacks.clearSnippetCacheForProject && this.projectSlug) {
      this.invalidationCallbacks.clearSnippetCacheForProject(this.projectSlug);
    } else {
      this.invalidationCallbacks.clearSnippetCache?.();
    }

    if (this.invalidationCallbacks.clearRendererCacheForProject && projectId) {
      this.invalidationCallbacks.clearRendererCacheForProject(projectId);
    } else {
      this.invalidationCallbacks.clearRendererCache?.();
    }

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

    if (this.contentContext?.sourceType === "branch") {
      try {
        const files = await this.client.listAllFiles();
        const cacheKey = buildFileListCacheKey(this.contentContext);
        await this.cache.setAsync(cacheKey, files);

        logger.debug("[VeryfrontFSAdapter] FRESH FILES FETCHED", {
          cacheKey,
          fileCount: files.length,
        });
      } catch (error) {
        logger.warn("[VeryfrontFSAdapter] Failed to fetch files during invalidation", { error });
      }
    }

    this.pokeMetrics.invalidationsTriggered++;
    logger.debug("[VeryfrontFSAdapter] TRIGGERING BROWSER RELOAD via ReloadNotifier");
    this.invalidationCallbacks.triggerReload?.(undefined, {
      projectSlug: this.projectSlug,
      projectId: this.client.getProjectId(),
    });

    logger.debug("[VeryfrontFSAdapter] CACHE INVALIDATION COMPLETE", {
      fileCacheCleared: totalFileCount,
      statCacheCleared: totalStatCount,
      dirCacheCleared: totalDirCount,
      filesListCacheCleared: totalFilesListCount,
      durationMs: Date.now() - startTime,
      totalInvalidations: this.pokeMetrics.invalidationsTriggered,
    });
  }

  getPokeMetrics(): {
    received: number;
    invalidationsTriggered: number;
    lastPokeTime: number;
    connectionId: string | null;
  } {
    return { ...this.pokeMetrics, connectionId: this.wsConnectionId };
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
    return { cache: this.cache.stats(), poke: this.getPokeMetrics() };
  }

  getProjectData(): Project | undefined {
    return this.projectData;
  }

  async getAllSourceFiles(): Promise<Array<{ path: string; content?: string }>> {
    if (!this.contentContext) {
      logger.warn("[VeryfrontFSAdapter] getAllSourceFiles called without contentContext", {
        initialized: this.initialized,
        projectSlug: this.projectSlug,
      });
      return [];
    }

    const cacheKey = buildFileListCacheKey(this.contentContext);
    const files = await this.cache.getAsync<Array<{ path: string; content?: string }>>(cacheKey);

    if (!files?.length) {
      logger.warn("[VeryfrontFSAdapter] getAllSourceFiles cache miss or empty", {
        cacheKey,
        initialized: this.initialized,
        hasFiles: !!files,
        fileCount: files?.length ?? 0,
      });
      return [];
    }

    const filesWithContent = files.filter((f) => f.content);
    const sourceFiles = files.filter((f) => isSourceFile(f.path));
    const sourceFilesWithContent = sourceFiles.filter((f) => f.content);

    logger.debug("[VeryfrontFSAdapter] getAllSourceFiles returning", {
      cacheKey,
      totalFiles: files.length,
      filesWithContent: filesWithContent.length,
      sourceFiles: sourceFiles.length,
      sourceFilesWithContent: sourceFilesWithContent.length,
    });

    return files;
  }

  getEntityIdForPath(path: string): string | undefined {
    if (!this.contentContext) return undefined;

    const normalizedPath = this.normalizer.normalize(path);
    const cacheKey = buildFileListCacheKey(this.contentContext);
    const cachedFiles = this.cache.get(cacheKey) as
      | Array<{ id?: string; path: string }>
      | undefined;
    const file = cachedFiles?.find((f) => f.path === normalizedPath);
    return file?.id;
  }

  getFilePathByEntityId(entityId: string): string | undefined {
    if (!this.contentContext) return undefined;

    const cacheKey = buildFileListCacheKey(this.contentContext);
    const cachedFiles = this.cache.get(cacheKey) as
      | Array<{ id?: string; path: string }>
      | undefined;
    return cachedFiles?.find((f) => f.id === entityId)?.path;
  }

  async getFilePathByEntityIdAsync(
    entityId: string,
  ): Promise<{ path: string; body?: string } | undefined> {
    const cachedPath = this.getFilePathByEntityId(entityId);
    if (cachedPath) return { path: cachedPath };

    logger.debug("[VeryfrontFSAdapter] Fetching file by entity ID from API", { entityId });
    try {
      const file = await this.client.getFileById(entityId);
      if (!file) return undefined;

      logger.debug("[VeryfrontFSAdapter] File resolved from API", {
        entityId,
        path: file.path,
        contentLength: file.content.length,
      });

      return { path: file.path, body: file.content };
    } catch (error) {
      logger.warn("[VeryfrontFSAdapter] Failed to fetch file by entity ID", {
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  setRequestToken(token: string): void {
    this.client.setRequestToken(token);
  }

  clearRequestToken(): void {
    this.client.clearRequestToken();
  }

  setRequestBranch(branch: string | null): void {
    this.requestBranch = branch;
    this.client.setRequestBranch(branch);
  }

  getRequestBranch(): string | null {
    return this.requestBranch;
  }

  clearRequestBranch(): void {
    this.requestBranch = null;
    this.client.clearRequestBranch();
  }

  setContentContext(context: ResolvedContentContext): void {
    const oldContext = this.contentContext;
    const contextChanged = JSON.stringify(oldContext) !== JSON.stringify(context);

    logger.debug("[VeryfrontFSAdapter] setContentContext called", {
      newSourceType: context.sourceType,
      newProjectSlug: context.projectSlug,
      newBranch: context.branch,
      newReleaseId: context.releaseId,
      newEnvironmentName: context.environmentName,
      oldSourceType: oldContext?.sourceType,
      oldBranch: oldContext?.branch,
      oldReleaseId: oldContext?.releaseId,
      contextWillChange: contextChanged,
    });

    this.contentContext = context;

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

  getContentContext(): ResolvedContentContext | null {
    if (!this.contentContext) {
      logger.warn("[VeryfrontFSAdapter] getContentContext returning null", {
        projectSlug: this.projectSlug,
        initialized: this.initialized,
        hasClient: !!this.client,
      });
    }
    return this.contentContext;
  }

  getClient(): VeryfrontAPIClient {
    return this.client;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.initialize();
  }
}
