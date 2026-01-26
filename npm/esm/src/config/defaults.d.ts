export declare const DEFAULT_PORT = 3000;
export declare const DEFAULT_TIMEOUT_MS = 5000;
export declare const SSR_TIMEOUT_MS = 10000;
export declare const SANDBOX_TIMEOUT_MS = 5000;
/** Timeout for user data fetching functions (getServerData, getStaticData) */
export declare const DATA_FETCH_TIMEOUT_MS = 10000;
export declare const DEFAULT_CACHE_MAX_SIZE = 100;
export declare const DURATION_HISTOGRAM_BOUNDARIES_MS: readonly [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];
export declare const SIZE_HISTOGRAM_BOUNDARIES_KB: readonly [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
export declare const defaultConfig: {
    readonly server: {
        readonly port: 3000;
        readonly hostname: "0.0.0.0";
    };
    readonly timeouts: {
        readonly default: 5000;
        readonly api: 30000;
        readonly ssr: 10000;
        readonly hmr: 30000;
        readonly sandbox: 5000;
    };
    readonly cache: {
        readonly jit: {
            readonly maxSize: 100;
            readonly tempDirPrefix: "vf-bundle-";
        };
    };
    readonly metrics: {
        readonly ssrBoundaries: readonly [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];
    };
};
export declare const DEFAULT_PREFETCH_DELAY_MS = 100;
export declare const DEFAULT_METRICS_COLLECT_INTERVAL_MS = 60000;
export declare const DEFAULT_REDIS_SCAN_COUNT = 100;
export declare const DEFAULT_REDIS_BATCH_DELETE_SIZE = 1000;
export declare const PAGE_TRANSITION_DELAY_MS = 150;
export type DefaultConfig = typeof defaultConfig;
//# sourceMappingURL=defaults.d.ts.map