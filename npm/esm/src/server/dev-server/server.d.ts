import type { DevServerOptions } from "./types.js";
export declare class DevServer {
    private options;
    private router;
    private componentRegistry;
    private hmrServer?;
    private fileWatchSetup?;
    private pipeline;
    private adapter;
    private server?;
    private appConfig;
    private requestHandler?;
    readonly ready: Promise<void>;
    private _resolveReady;
    private _isReady;
    private reloadUnsubscribe?;
    private invalidateUnsubscribe?;
    constructor(options: DevServerOptions);
    private isDebug;
    private logRSCStatus;
    start(): Promise<void>;
    private setupFileWatchers;
    getFileWatcherMetrics(): import("./types.js").FileWatcherMetrics | null;
    stop(): Promise<void>;
}
//# sourceMappingURL=server.d.ts.map