import { serverLogger as logger } from "#veryfront/utils";
import { handleErrorWithFallback } from "#veryfront/errors/index.ts";
import { join, relative, sep } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HMRServer } from "./hmr-server.ts";
import { OptimizedFileWatcher } from "./file-watcher.ts";
import type { RouteDiscovery } from "./route-discovery.ts";
import { ReloadNotifier } from "../reload-notifier.ts";
import type { DevServer } from "./server.ts";

const METRICS_LOG_INTERVAL = 10;

/** Default AI primitive directories (used when no custom paths configured) */
const DEFAULT_AI_DIRS = ["tools", "agents", "workflows", "prompts", "resources"];

/**
 * Patterns for paths that should NOT trigger HMR updates.
 * These are generated/cached files that change during normal operation
 * but don't represent actual source code changes.
 */
const IGNORED_PATH_PATTERNS = [
  ".cache/",
  ".cache\\",
  "node_modules/",
  "node_modules\\",
  ".git/",
  ".git\\",
  ".veryfront/",
  ".veryfront\\",
];

/**
 * Check if a path should be ignored for HMR purposes.
 */
function shouldIgnorePath(path: string): boolean {
  return IGNORED_PATH_PATTERNS.some((pattern) => path.includes(pattern));
}

export class FileWatchSetup {
  private fileWatcher?: { close(): void };
  private watcherController?: AbortController;
  private optimizedWatcher?: OptimizedFileWatcher;
  private batchCount = 0;
  private aiDirs: Set<string>;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private hmrServer: HMRServer,
    private routeDiscovery: RouteDiscovery,
    private debounceMs: number,
    private invalidateHandler: () => void = () => {},
    private devServer?: DevServer,
    aiDirNames?: string[],
  ) {
    this.aiDirs = new Set(aiDirNames ?? DEFAULT_AI_DIRS);
  }

  async setup(): Promise<void> {
    try {
      const watchPaths = await this.getWatchPaths();
      if (watchPaths.length === 0) {
        logger.warn("[HMR] No directories found to watch");
        return;
      }

      logger.debug(
        `[HMR] Initializing optimized file watcher with ${this.debounceMs}ms debounce`,
      );

      this.optimizedWatcher = new OptimizedFileWatcher(
        this.debounceMs,
        (changes) => this.handleBatchedFileChanges(changes),
      );

      this.watcherController = new AbortController();
      const watcher = this.adapter.fs.watch(watchPaths, {
        recursive: true,
        signal: this.watcherController.signal,
      });

      this.fileWatcher = watcher;
      this.processFileWatcher(watcher, this.watcherController.signal);
    } catch (error) {
      logger.warn("[HMR] Failed to setup file watcher", error);
    }
  }

  private async getWatchPaths(): Promise<string[]> {
    const potentialPaths = [
      this.projectDir,
      join(this.projectDir, "pages"),
      join(this.projectDir, "components"),
      join(this.projectDir, "styles"),
      join(this.projectDir, "public"),
      join(this.projectDir, "app"),
      // AI primitive directories (from config or defaults)
      ...Array.from(this.aiDirs).map((dir) => join(this.projectDir, dir)),
    ];

    const watchPaths: string[] = [];
    for (const path of potentialPaths) {
      try {
        if (!(await this.adapter.fs.exists(path))) continue;

        const stat = await this.adapter.fs.stat(path);
        if (stat.isDirectory) watchPaths.push(path);
      } catch (error) {
        logger.debug(`[HMR] Directory not found, skipping: ${path}`, error);
      }
    }

    return watchPaths;
  }

  private async processFileWatcher(
    watcher: AsyncIterable<{ kind: string; paths: string[] }>,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      for await (const { paths } of watcher) {
        if (signal.aborted) break;

        try {
          // Filter out paths that shouldn't trigger HMR (cache, node_modules, etc.)
          const relevantPaths = paths.filter((p) => !shouldIgnorePath(p));
          if (relevantPaths.length === 0) continue;

          if (this.optimizedWatcher) {
            this.optimizedWatcher.handleChange(relevantPaths);
            continue;
          }

          await this.handleImmediateFileChange(relevantPaths);
        } catch (error) {
          logger.error("[HMR] Failed to handle file change", error);
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        logger.error("[HMR] File watcher task failed unexpectedly", error);
      }
    }
  }

  private async refreshAndReload(paths: string[], logMessage: string): Promise<void> {
    await handleErrorWithFallback(() => this.routeDiscovery.discoverRoutes(), undefined, logger);
    this.invalidateHandler();

    const display = paths.map((p) => p.replace(this.projectDir, ".")).join(", ");
    logger.debug(logMessage, { files: display });

    this.hmrServer.sendUpdate({ type: "reload", timestamp: Date.now() });

    // Also trigger ReloadNotifier for /_ws WebSocket clients (preview HMR)
    // This enables HMR for proxy mode where browsers connect via /_ws
    ReloadNotifier.triggerReload(paths);
  }

  /**
   * Check if a path is inside an AI primitive directory (tools/, agents/, etc.)
   * Uses path segment matching to avoid false positives from substrings.
   */
  private isAIPath(fullPath: string): boolean {
    const rel = relative(this.projectDir, fullPath);
    const firstSegment = rel.split(sep)[0] ?? "";
    return this.aiDirs.has(firstSegment);
  }

  private async handleBatchedFileChanges(changes: string[]): Promise<void> {
    const startTime = performance.now();

    // Check for AI file changes and trigger re-discovery
    const hasAIChanges = changes.some((p) => this.isAIPath(p));
    if (hasAIChanges && this.devServer) {
      await this.devServer.rediscoverAI();
    }

    await this.refreshAndReload(changes, "");

    const duration = (performance.now() - startTime).toFixed(0);
    logger.debug(`[HMR] Batch processed ${changes.length} file changes in ${duration}ms`, {
      files: changes.map((p) => p.replace(this.projectDir, ".")).join(", "),
    });

    this.batchCount++;
    if (this.optimizedWatcher && this.batchCount % METRICS_LOG_INTERVAL === 0) {
      logger.debug("[HMR] Performance metrics", this.optimizedWatcher.getMetrics());
    }
  }

  private async handleImmediateFileChange(paths: string[]): Promise<void> {
    await this.refreshAndReload(paths, "[HMR] file change");
  }

  getMetrics() {
    return this.optimizedWatcher?.getMetrics() ?? null;
  }

  cleanup(): void {
    this.watcherController?.abort();
    this.optimizedWatcher?.cleanup();

    if (!this.fileWatcher) return;

    try {
      this.fileWatcher.close();
    } catch (error) {
      logger.debug("[FileWatchSetup] Error closing file watcher (non-critical)", error);
    }
  }
}
