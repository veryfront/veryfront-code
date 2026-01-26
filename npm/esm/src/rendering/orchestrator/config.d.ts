import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
export interface ConfigurationOptions {
    projectDir: string;
    mode: "development" | "production";
    adapter: RuntimeAdapter;
    config?: VeryfrontConfig;
}
export declare class ConfigurationManager {
    private projectDir;
    private mode;
    private adapter;
    private config;
    private preloadedConfig?;
    private projectCacheKey;
    private cacheBaseDir;
    private lastEnvCacheValue;
    private lastConfigCacheValue;
    constructor(options: ConfigurationOptions);
    initialize(): Promise<void>;
    getConfig(): VeryfrontConfig;
    getProjectCacheKey(): string | null;
    getCacheBaseDir(): string;
    isDebugMode(): boolean;
    getProjectDir(): string;
    getMode(): "development" | "production";
    getAdapter(): RuntimeAdapter;
}
//# sourceMappingURL=config.d.ts.map