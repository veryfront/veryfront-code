import type { FileWatcherMetrics } from "./types.js";
export declare class OptimizedFileWatcher {
    private readonly changeQueue;
    private debounceTimer?;
    private readonly debounceMs;
    private readonly processCallback;
    private readonly metrics;
    constructor(debounceMs: number, processCallback: (changes: string[]) => Promise<void>);
    handleChange(paths: string[]): void;
    private debounceChanges;
    private processChanges;
    cleanup(): void;
    getMetrics(): FileWatcherMetrics;
}
//# sourceMappingURL=file-watcher.d.ts.map