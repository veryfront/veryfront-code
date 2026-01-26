import type { CSSBundle, CSSOptimizationOptions, CSSOptimizerStats } from "../../../types/index.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import { PurgeStrategy } from "./strategies/index.js";
import { CacheManager } from "./css-bundle-cache.js";
export declare class CSSOptimizerService {
    private options;
    private strategies;
    private cacheManager;
    private lightningStrategy;
    private minificationStrategy;
    private purgeStrategy;
    private adapter;
    private secureFs;
    private baseDir;
    constructor(adapter: RuntimeAdapter, baseDir: string, options?: CSSOptimizationOptions);
    init(): Promise<boolean>;
    optimize(): Promise<Map<string, CSSBundle>>;
    private optimizeFile;
    private selectStrategy;
    getStats(): CSSOptimizerStats;
    getOptions(): Required<CSSOptimizationOptions>;
    getCacheManager(): CacheManager;
    getPurgeStrategy(): PurgeStrategy;
}
//# sourceMappingURL=optimizer-service.d.ts.map