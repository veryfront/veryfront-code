import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { MetricsConfig } from "./types.js";
export declare const DEFAULT_CONFIG: MetricsConfig;
export declare function loadConfig(config: Partial<MetricsConfig>, adapter?: RuntimeAdapter): MetricsConfig;
export declare function getMemoryUsage(): {
    rss: number;
    heapUsed: number;
    heapTotal: number;
} | null;
//# sourceMappingURL=config.d.ts.map