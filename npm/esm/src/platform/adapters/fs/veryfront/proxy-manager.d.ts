import { VeryfrontFSAdapter } from "./index.js";
import type { CacheStats, FSAdapterConfig } from "./types.js";
interface ProxyFSAdapterManagerConfig {
    baseConfig: FSAdapterConfig;
    maxAdapters?: number;
    cleanupIntervalMs?: number;
    maxIdleMs?: number;
}
export declare class ProxyFSAdapterManager {
    private adapters;
    private pendingAdapters;
    private baseConfig;
    private maxAdapters;
    private maxIdleMs;
    private cleanupTimer?;
    constructor(config: ProxyFSAdapterManagerConfig);
    getAdapter(projectSlug: string, token: string, projectId?: string, productionMode?: boolean, releaseId?: string | null, environmentName?: string | null, branch?: string | null): Promise<VeryfrontFSAdapter>;
    private assertContextMatches;
    private getContextMismatchReason;
    private createAdapter;
    private evictLeastRecentlyUsed;
    private cleanupIdleAdapters;
    hasAdapter(projectSlug: string, productionMode?: boolean, releaseId?: string | null, branch?: string | null): boolean;
    getStats(): {
        adapters: number;
        stats: Record<string, CacheStats>;
    };
    dispose(): void;
}
export {};
//# sourceMappingURL=proxy-manager.d.ts.map