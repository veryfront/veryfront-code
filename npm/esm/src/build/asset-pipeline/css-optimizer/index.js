/**
 * CSS Optimizer Module
 *
 * Modular CSS optimization with pluggable strategies.
 * This module provides backward-compatible exports while using
 * a clean, modular internal architecture.
 *
 * @module css-optimizer
 */
export { CSSOptimizerService } from "./optimizer-service.js";
export { CacheManager, loadCSSManifest } from "./css-bundle-cache.js";
export { extractCriticalCSS } from "./critical-css.js";
export { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.js";
export * as CSSUtils from "./utils.js";
import { runtime } from "../../../platform/adapters/detect.js";
import { cwd } from "../../../platform/compat/process.js";
import { CSSOptimizerService } from "./optimizer-service.js";
import { extractCriticalCSS as extractCriticalCSSImpl } from "./critical-css.js";
export class CSSOptimizer {
    options;
    service = null;
    adapter = null;
    baseDir;
    constructor(options = {}, baseDir) {
        this.options = options;
        this.baseDir = baseDir ?? cwd();
    }
    async ensureService() {
        if (this.service)
            return this.service;
        this.adapter ??= await runtime.get();
        this.service = new CSSOptimizerService(this.adapter, this.baseDir, this.options);
        return this.service;
    }
    async init() {
        const service = await this.ensureService();
        return service.init();
    }
    async optimize() {
        const service = await this.ensureService();
        return service.optimize();
    }
    async extractCriticalCSS(cssPath, htmlContent) {
        const service = await this.ensureService();
        return extractCriticalCSSImpl(cssPath, htmlContent, service.getOptions());
    }
    async getStats() {
        const service = await this.ensureService();
        return service.getStats();
    }
}
export function optimizeCSS(options = {}) {
    const optimizer = new CSSOptimizer(options);
    return optimizer.optimize();
}
