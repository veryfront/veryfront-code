import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { HMRServer } from "./hmr-server.js";
import type { RouteDiscovery } from "./route-discovery.js";
export declare class FileWatchSetup {
    private projectDir;
    private adapter;
    private hmrServer;
    private routeDiscovery;
    private debounceMs;
    private invalidateHandler;
    private fileWatcher?;
    private watcherController?;
    private optimizedWatcher?;
    private batchCount;
    constructor(projectDir: string, adapter: RuntimeAdapter, hmrServer: HMRServer, routeDiscovery: RouteDiscovery, debounceMs: number, invalidateHandler?: () => void);
    setup(): Promise<void>;
    private processFileWatcher;
    private refreshAndReload;
    private handleBatchedFileChanges;
    private handleImmediateFileChange;
    getMetrics(): import("./types.js").FileWatcherMetrics | null;
    cleanup(): void;
}
//# sourceMappingURL=file-watch-setup.d.ts.map