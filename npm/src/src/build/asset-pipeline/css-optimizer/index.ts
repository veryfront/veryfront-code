/**
 * CSS Optimizer Module
 *
 * Modular CSS optimization with pluggable strategies.
 * This module provides backward-compatible exports while using
 * a clean, modular internal architecture.
 *
 * @module css-optimizer
 */

export type {
  BrowserTargets,
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
} from "../../../types/index.js";

export { CSSOptimizerService } from "./optimizer-service.js";
export { CacheManager, loadCSSManifest } from "./css-bundle-cache.js";
export { extractCriticalCSS } from "./critical-css.js";

export { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.js";

export * as CSSUtils from "./utils.js";

import type { CriticalCSSResult, CSSBundle, CSSOptimizationOptions } from "../../../types/index.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import { runtime } from "../../../platform/adapters/detect.js";
import { cwd } from "../../../platform/compat/process.js";
import { CSSOptimizerService } from "./optimizer-service.js";
import { extractCriticalCSS as extractCriticalCSSImpl } from "./critical-css.js";

export class CSSOptimizer {
  private service: CSSOptimizerService | null = null;
  private adapter: RuntimeAdapter | null = null;
  private baseDir: string;

  constructor(
    private options: CSSOptimizationOptions = {},
    baseDir?: string,
  ) {
    this.baseDir = baseDir ?? cwd();
  }

  private async ensureService(): Promise<CSSOptimizerService> {
    if (this.service) return this.service;

    this.adapter ??= await runtime.get();
    this.service = new CSSOptimizerService(this.adapter, this.baseDir, this.options);

    return this.service;
  }

  async init(): Promise<boolean> {
    const service = await this.ensureService();
    return service.init();
  }

  async optimize(): Promise<Map<string, CSSBundle>> {
    const service = await this.ensureService();
    return service.optimize();
  }

  async extractCriticalCSS(cssPath: string, htmlContent: string): Promise<CriticalCSSResult> {
    const service = await this.ensureService();
    return extractCriticalCSSImpl(cssPath, htmlContent, service.getOptions());
  }

  async getStats(): Promise<{
    totalFiles: number;
    originalSize: number;
    minifiedSize: number;
    totalSavings: number;
    averageSavings: number;
  }> {
    const service = await this.ensureService();
    return service.getStats();
  }
}

export function optimizeCSS(
  options: CSSOptimizationOptions = {},
): Promise<Map<string, CSSBundle>> {
  const optimizer = new CSSOptimizer(options);
  return optimizer.optimize();
}
