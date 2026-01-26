import { serverLogger as logger } from "../../utils/index.js";
import { handleErrorWithFallback } from "../../errors/index.js";
import { join } from "../../platform/compat/path/index.js";
import { OptimizedFileWatcher } from "./file-watcher.js";
import { ReloadNotifier } from "../reload-notifier.js";
const METRICS_LOG_INTERVAL = 10;
export class FileWatchSetup {
    projectDir;
    adapter;
    hmrServer;
    routeDiscovery;
    debounceMs;
    invalidateHandler;
    fileWatcher;
    watcherController;
    optimizedWatcher;
    batchCount = 0;
    constructor(projectDir, adapter, hmrServer, routeDiscovery, debounceMs, invalidateHandler = () => { }) {
        this.projectDir = projectDir;
        this.adapter = adapter;
        this.hmrServer = hmrServer;
        this.routeDiscovery = routeDiscovery;
        this.debounceMs = debounceMs;
        this.invalidateHandler = invalidateHandler;
    }
    async setup() {
        try {
            const potentialPaths = [
                this.projectDir,
                join(this.projectDir, "pages"),
                join(this.projectDir, "components"),
                join(this.projectDir, "styles"),
                join(this.projectDir, "public"),
                join(this.projectDir, "app"),
            ];
            const watchPaths = [];
            for (const path of potentialPaths) {
                try {
                    if (!(await this.adapter.fs.exists(path)))
                        continue;
                    const stat = await this.adapter.fs.stat(path);
                    if (stat.isDirectory)
                        watchPaths.push(path);
                }
                catch (error) {
                    logger.debug(`[HMR] Directory not found, skipping: ${path}`, error);
                }
            }
            if (watchPaths.length === 0) {
                logger.warn("[HMR] No directories found to watch");
                return;
            }
            logger.debug(`[HMR] Initializing optimized file watcher with ${this.debounceMs}ms debounce`);
            this.optimizedWatcher = new OptimizedFileWatcher(this.debounceMs, (changes) => this.handleBatchedFileChanges(changes));
            this.watcherController = new AbortController();
            const watcher = this.adapter.fs.watch(watchPaths, {
                recursive: true,
                signal: this.watcherController.signal,
            });
            this.fileWatcher = watcher;
            this.processFileWatcher(watcher, this.watcherController.signal);
        }
        catch (error) {
            logger.warn("[HMR] Failed to setup file watcher", error);
        }
    }
    async processFileWatcher(watcher, signal) {
        try {
            for await (const event of watcher) {
                if (signal.aborted)
                    break;
                try {
                    const { paths } = event;
                    if (this.optimizedWatcher) {
                        this.optimizedWatcher.handleChange(paths);
                        continue;
                    }
                    await this.handleImmediateFileChange(paths);
                }
                catch (error) {
                    logger.error("[HMR] Failed to handle file change", error);
                }
            }
        }
        catch (error) {
            if (!signal.aborted) {
                logger.error("[HMR] File watcher task failed unexpectedly", error);
            }
        }
    }
    async refreshAndReload(paths, logMessage) {
        await handleErrorWithFallback(() => this.routeDiscovery.discoverRoutes(), undefined, logger);
        this.invalidateHandler();
        const display = paths.map((p) => p.replace(this.projectDir, ".")).join(", ");
        logger.debug(logMessage, { files: display });
        this.hmrServer.sendUpdate({ type: "reload", timestamp: Date.now() });
        // Also trigger ReloadNotifier for /_ws WebSocket clients (preview HMR)
        // This enables HMR for proxy mode where browsers connect via /_ws
        ReloadNotifier.triggerReload(paths);
    }
    async handleBatchedFileChanges(changes) {
        const startTime = performance.now();
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
    async handleImmediateFileChange(paths) {
        await this.refreshAndReload(paths, "[HMR] file change");
    }
    getMetrics() {
        return this.optimizedWatcher?.getMetrics() ?? null;
    }
    cleanup() {
        this.watcherController?.abort();
        this.optimizedWatcher?.cleanup();
        if (!this.fileWatcher)
            return;
        try {
            this.fileWatcher.close();
        }
        catch (error) {
            logger.debug("[FileWatchSetup] Error closing file watcher (non-critical)", error);
        }
    }
}
