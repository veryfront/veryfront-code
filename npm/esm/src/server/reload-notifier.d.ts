export interface ReloadProjectInfo {
    projectSlug?: string;
    projectId?: string;
    projectDir?: string;
    environment?: "preview" | "production";
    branch?: string | null;
    releaseId?: string | null;
}
type ReloadListener = (changedPaths?: string[], project?: ReloadProjectInfo) => void;
type InvalidateListener = () => void;
type ReloadProjectInput = ReloadProjectInfo | string | undefined;
declare class ReloadNotifierImpl {
    private listeners;
    private invalidateListeners;
    private debounceTimer;
    private pendingChangedPaths;
    private pendingProject?;
    private metrics;
    subscribe(listener: ReloadListener): () => void;
    subscribeInvalidate(listener: InvalidateListener): () => void;
    triggerReload(changedPaths?: string[], project?: ReloadProjectInput): void;
    private notifyInvalidateListeners;
    private notifyListeners;
    getListenerCount(): number;
    getInvalidateListenerCount(): number;
    getMetrics(): {
        triggerCalls: number;
        broadcastsSent: number;
        lastTriggerTime: number;
        activeReloadListeners: number;
        activeInvalidateListeners: number;
    };
    reset(): void;
}
export declare const ReloadNotifier: ReloadNotifierImpl;
export {};
//# sourceMappingURL=reload-notifier.d.ts.map