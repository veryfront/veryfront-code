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
import { clearModulePathCache, invalidateModulePaths } from "../../../build/transforms/mdx/esm-module-loader.ts";
import { ReloadNotifier } from "../../../server/reload-notifier.ts";

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

  constructor(config: FSAdapterConfig) {
    const veryfrontConfig = createVeryfrontConfig(config);

    this.apiBaseUrl = veryfrontConfig.apiBaseUrl;
    this.apiToken = veryfrontConfig.apiToken;

    this.client = new VeryfrontAPIClient({
      apiBaseUrl: veryfrontConfig.apiBaseUrl,
      apiToken: veryfrontConfig.apiToken,
      projectSlug: veryfrontConfig.projectSlug,
      retry: veryfrontConfig.retry,
    });

    this.cache = new FileCache(veryfrontConfig.cache as FileCacheOptions);
    this.normalizer = new PathNormalizer(config.projectDir);
    this.readOps = new ReadOperations(this.client, this.cache, this.normalizer);
    this.dirOps = new DirectoryOperations(this.client, this.cache, this.normalizer);
    this.statOps = new StatOperations(this.client, this.cache, this.normalizer);

    logger.info("[VeryfrontFSAdapter] Created", {
      apiBaseUrl: veryfrontConfig.apiBaseUrl,
      projectSlug: veryfrontConfig.projectSlug,
      cacheEnabled: veryfrontConfig.cache.enabled,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info("[VeryfrontFSAdapter] Initializing...");

    await this.client.initialize();

    const projectId = this.client.getProjectId();
    this.projectData = await this.client.getProject(projectId);

    logger.info("[VeryfrontFSAdapter] Project data fetched", {
      provider: this.projectData.provider,
      layout: this.projectData.layout,
    });

    const cacheKey = "files:all";
    logger.debug("[VeryfrontFSAdapter] Fetching all files from API");
    const files = await this.client.listAllFiles();
    this.cache.set(cacheKey, files);
    logger.debug("[VeryfrontFSAdapter] Fetched files during initialization", {
      count: files.length,
    });

    this.initialized = true;
    logger.info("[VeryfrontFSAdapter] Initialized", {
      projectId: this.client.getProjectId(),
      files: files.length,
    });

    // Connect to WebSocket for real-time cache invalidation
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

    logger.info("[VeryfrontFSAdapter] Connecting to WebSocket", { url: url.replace(this.apiToken, "***") });

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
          logger.info("[VeryfrontFSAdapter] Parsed message:", {
            type: data.type,
            source: data.data?.source,
            changedPaths: changedPaths?.length || 0,
          });
          if (data.type === "poke") {
            // Use selective invalidation if we know which files changed
            if (changedPaths && changedPaths.length > 0) {
              this.scheduleSelectiveInvalidation(changedPaths);
            } else {
              // Fallback to full invalidation
              this.scheduleInvalidation();
            }
          }
        } catch (err) {
          logger.debug("[VeryfrontFSAdapter] WebSocket message parse error", { error: err });
        }
      };

      this.ws.onclose = () => {
        logger.info("[VeryfrontFSAdapter] WebSocket closed, reconnecting", { delayMs: WS_RECONNECT_DELAY_MS });
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
    logger.info("[VeryfrontFSAdapter] Scheduling invalidation", { debounceMs: INVALIDATION_DEBOUNCE_MS });
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

    // Only invalidate file content cache for changed files
    for (const path of changedPaths) {
      this.cache.delete(`file:content:${path}`);
      this.cache.delete(`file:text:${path}`);
      this.cache.delete(`file:stat:${path}`);
    }

    // Invalidate only the changed module paths (not all modules)
    invalidateModulePaths(changedPaths);

    // Fetch fresh file list from API
    try {
      const files = await this.client.listAllFiles();
      this.cache.set("files:all", files);
    } catch (error) {
      logger.warn("[VeryfrontFSAdapter] Failed to fetch files during selective invalidation", { error });
    }

    // Notify browser to reload
    ReloadNotifier.notify();

    const durationMs = Date.now() - startTime;
    logger.info("[VeryfrontFSAdapter] Selective invalidation complete", {
      changedPaths: changedPaths.length,
      durationMs,
    });
  }

  private async performInvalidation(): Promise<void> {
    const startTime = Date.now();

    // Step 1: Clear all caches and indexes
    const textCount = this.cache.deleteByPrefix("file:text:");
    const contentCount = this.cache.deleteByPrefix("file:content:");
    this.cache.deleteByPrefix("file:stat:");
    this.cache.deleteByPrefix("dir:entries:");
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    clearSSRModuleCache();
    clearRouterDetectionCache();
    clearModulePathCache(); // Clear in-memory path cache, disk cache uses content-based hashing

    // Step 2: Fetch fresh file list from API - this blocks until API has committed changes
    // This guarantees content is ready before we trigger reload
    try {
      const files = await this.client.listAllFiles();
      this.cache.set("files:all", files);
    } catch (error) {
      logger.warn("[VeryfrontFSAdapter] Failed to fetch files during invalidation", { error });
      // Still trigger reload - browser will fetch fresh content
    }

    // Step 3: Trigger reload - content is now guaranteed to be available
    ReloadNotifier.triggerReload();

    logger.info("[VeryfrontFSAdapter] Invalidation complete", {
      textCacheCleared: textCount,
      contentCacheCleared: contentCount,
      durationMs: Date.now() - startTime,
    });
  }

  async readFile(path: string): Promise<Uint8Array> {
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

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
