/**
 * CSS Optimizer Module
 *
 * Modular CSS optimization with pluggable strategies.
 * This module provides backward-compatible exports while using
 * a clean, modular internal architecture.
 *
 * @module css-optimizer
 */
export type { BrowserTargets, CriticalCSSResult, CSSBundle, CSSOptimizationOptions, CSSOptimizationStrategy, CSSOptimizerStats, } from "../../../types/index.js";
export { CSSOptimizerService } from "./optimizer-service.js";
export { CacheManager, loadCSSManifest } from "./css-bundle-cache.js";
export { extractCriticalCSS } from "./critical-css.js";
export { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.js";
export * as CSSUtils from "./utils.js";
import type { CriticalCSSResult, CSSBundle, CSSOptimizationOptions } from "../../../types/index.js";
export declare class CSSOptimizer {
    private options;
    private service;
    private adapter;
    private baseDir;
    constructor(options?: CSSOptimizationOptions, baseDir?: string);
    private ensureService;
    init(): Promise<boolean>;
    optimize(): Promise<Map<string, CSSBundle>>;
    extractCriticalCSS(cssPath: string, htmlContent: string): Promise<CriticalCSSResult>;
    getStats(): Promise<{
        totalFiles: number;
        originalSize: number;
        minifiedSize: number;
        totalSavings: number;
        averageSavings: number;
    }>;
}
export declare function optimizeCSS(options?: CSSOptimizationOptions): Promise<Map<string, CSSBundle>>;
//# sourceMappingURL=index.d.ts.map