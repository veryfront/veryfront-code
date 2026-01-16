import { serverLogger as logger } from "@veryfront/utils";
import { handleErrorWithFallback } from "@veryfront/errors/index.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { HMRServer } from "./hmr-server.ts";
import { OptimizedFileWatcher } from "./file-watcher.ts";
import type { RouteDiscovery } from "./route-discovery.ts";
import { ReloadNotifier } from "../reload-notifier.ts";

// Log metrics every N batches (deterministic instead of random sampling)
const METRICS_LOG_INTERVAL = 10;

export class FileWatchSetup {
  private fileWatcher?: { close(): void };
  private watcherController?: AbortController;
  private optimizedWatcher?: OptimizedFileWatcher;
  private batchCount = 0;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private hmrServer: HMRServer,
    private routeDiscovery: RouteDiscovery,
    private debounceMs: number,
    private invalidateHandler: () => void = () => {},
  ) {}

  async setup(): Promise<void> {
    try {
      const potentialPaths = [
        this.projectDir,
        join(this.projectDir, "pages"),
        join(this.projectDir, "components"),
        join(this.projectDir, "styles"),
        join(this.projectDir, "public"),
        join(this.projectDir, "app"),
      ];

      const watchPaths: string[] = [];
      for (const path of potentialPaths) {
        try {
          const exists = await this.adapter.fs.exists(path);
          if (exists) {
            const stat = await this.adapter.fs.stat(path);
            if (stat.isDirectory) {
              watchPaths.push(path);
            }
          }
        } catch (error) {
          logger.debug(`[HMR] Directory not found, skipping: ${path}`, error);
        }
      }

      if (watchPaths.length === 0) {
        logger.warn("[HMR] No directories found to watch");
        return;
      }

      logger.debug(`[HMR] Initializing optimized file watcher with ${this.debounceMs}ms debounce`);

      this.optimizedWatcher = new OptimizedFileWatcher(
        this.debounceMs,
        async (changes: string[]) => {
          await this.handleBatchedFileChanges(changes);
        },
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

  private async processFileWatcher(
    watcher: AsyncIterable<{ kind: string; paths: string[] }>,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      for await (const event of watcher) {
        if (signal.aborted) break;
        try {
          const paths = event.paths;

          if (this.optimizedWatcher) {
            this.optimizedWatcher.handleChange(paths);
          } else {
            await this.handleImmediateFileChange(paths);
          }
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

  private async handleBatchedFileChanges(changes: string[]): Promise<void> {
    const startTime = performance.now();

    await handleErrorWithFallback(
      () => this.routeDiscovery.discoverRoutes(),
      undefined,
      logger,
    );
    this.invalidateHandler();

    const display = changes
      .map((p) => p.replace(this.projectDir, "."))
      .join(", ");

    const duration = (performance.now() - startTime).toFixed(0);
    logger.debug(`[HMR] Batch processed ${changes.length} file changes in ${duration}ms`, {
      files: display,
    });

    this.hmrServer.sendUpdate({ type: "reload", timestamp: Date.now() });

    // Also trigger ReloadNotifier for /_ws WebSocket clients (preview HMR)
    // This enables HMR for proxy mode where browsers connect via /_ws
    ReloadNotifier.triggerReload(changes);

    // Log metrics every METRICS_LOG_INTERVAL batches (deterministic)
    this.batchCount++;
    if (this.optimizedWatcher && this.batchCount % METRICS_LOG_INTERVAL === 0) {
      const metrics = this.optimizedWatcher.getMetrics();
      logger.debug("[HMR] Performance metrics", metrics);
    }
  }

  private async handleImmediateFileChange(paths: string[]): Promise<void> {
    await handleErrorWithFallback(
      () => this.routeDiscovery.discoverRoutes(),
      undefined,
      logger,
    );
    this.invalidateHandler();

    const display = Array.isArray(paths)
      ? paths.map((p) => p.replace(this.projectDir, ".")).join(", ")
      : "(unknown)";
    logger.debug(`[HMR] file change`, { files: display });

    this.hmrServer.sendUpdate({ type: "reload", timestamp: Date.now() });

    // Also trigger ReloadNotifier for /_ws WebSocket clients (preview HMR)
    ReloadNotifier.triggerReload(paths);
  }

  getMetrics() {
    return this.optimizedWatcher?.getMetrics() ?? null;
  }

  cleanup(): void {
    this.watcherController?.abort();

    if (this.optimizedWatcher) {
      this.optimizedWatcher.cleanup();
    }

    if (this.fileWatcher) {
      try {
        this.fileWatcher.close();
      } catch (error) {
        logger.debug("[FileWatchSetup] Error closing file watcher (non-critical)", error);
      }
    }
  }
}
