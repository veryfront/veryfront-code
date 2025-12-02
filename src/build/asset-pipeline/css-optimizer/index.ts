/**
 * CSS Optimizer Module
 *
 * Modular CSS optimization with pluggable strategies.
 * This module provides backward-compatible exports while using
 * a clean, modular internal architecture.
 *
 * @module css-optimizer
 */

// Re-export types
export type {
  BrowserTargets,
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
} from "@veryfront/types";

// Re-export service classes
export { CSSOptimizerService } from "./optimizer-service.ts";
export { CacheManager, loadCSSManifest } from "./css-bundle-cache.ts";
export { extractCriticalCSS } from "./critical-css.ts";

// Re-export strategies for advanced users
export { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";

// Re-export utilities for advanced users
export * as CSSUtils from "./utils.ts";

import type { CriticalCSSResult, CSSBundle, CSSOptimizationOptions } from "@veryfront/types";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { cwd } from "../../../platform/compat/process.ts";
import { CSSOptimizerService } from "./optimizer-service.ts";
import { extractCriticalCSS as extractCriticalCSSImpl } from "./critical-css.ts";

/**
 * CSSOptimizer class - Backward compatible wrapper
 *
 * This class maintains the original API while delegating to the new modular service.
 * Note: This wrapper initializes the adapter lazily on first use.
 */
export class CSSOptimizer {
  private service: CSSOptimizerService | null = null;
  private options: CSSOptimizationOptions;
  private adapter: RuntimeAdapter | null = null;
  private baseDir: string;

  constructor(options: CSSOptimizationOptions = {}, baseDir?: string) {
    this.options = options;
    this.baseDir = baseDir ?? cwd();
  }

  private async ensureService(): Promise<CSSOptimizerService> {
    if (!this.service) {
      if (!this.adapter) {
        this.adapter = await getAdapter();
      }
      this.service = new CSSOptimizerService(this.adapter, this.baseDir, this.options);
    }
    return this.service;
  }

  /**
   * Initialize Lightning CSS (optional dependency)
   */
  async init(): Promise<boolean> {
    const service = await this.ensureService();
    return await service.init();
  }

  /**
   * Optimize all CSS files
   */
  async optimize(): Promise<Map<string, CSSBundle>> {
    const service = await this.ensureService();
    return await service.optimize();
  }

  /**
   * Extract critical CSS (above-the-fold styles)
   */
  async extractCriticalCSS(
    cssPath: string,
    htmlContent: string,
  ): Promise<CriticalCSSResult> {
    const service = await this.ensureService();
    // Get options from the service using the public getter
    const options = service.getOptions();
    return await extractCriticalCSSImpl(cssPath, htmlContent, options);
  }

  /**
   * Get optimization statistics
   */
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

/**
 * Create and run CSS optimizer
 * Helper function for one-shot optimization
 */
export async function optimizeCSS(
  options: CSSOptimizationOptions = {},
): Promise<Map<string, CSSBundle>> {
  const optimizer = new CSSOptimizer(options);
  return await optimizer.optimize();
}
