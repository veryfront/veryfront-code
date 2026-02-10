/**
 * Asset Pipeline - Css Optimizer
 *
 * @module build/asset-pipeline/css-optimizer
 */

export type {
  BrowserTargets,
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
} from "#veryfront/types";

export { CSSOptimizerService } from "./optimizer-service.ts";
export { CacheManager, loadCSSManifest } from "./css-bundle-cache.ts";
export { extractCriticalCSS } from "./critical-css.ts";
export { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";
export * as CSSUtils from "./utils.ts";

import type { CriticalCSSResult, CSSBundle, CSSOptimizationOptions } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { CSSOptimizerService } from "./optimizer-service.ts";
import { extractCriticalCSS as extractCriticalCSSImpl } from "./critical-css.ts";

export class CSSOptimizer {
  private service: CSSOptimizerService | null = null;
  private adapter: RuntimeAdapter | null = null;
  private baseDir: string;

  constructor(private options: CSSOptimizationOptions = {}, baseDir?: string) {
    this.baseDir = baseDir ?? cwd();
  }

  private async ensureService(): Promise<CSSOptimizerService> {
    if (this.service) return this.service;

    this.adapter ??= await runtime.get();
    this.service = new CSSOptimizerService(this.adapter, this.baseDir, this.options);

    return this.service;
  }

  async init(): Promise<boolean> {
    return (await this.ensureService()).init();
  }

  async optimize(): Promise<Map<string, CSSBundle>> {
    return (await this.ensureService()).optimize();
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
    return (await this.ensureService()).getStats();
  }
}

export function optimizeCSS(options: CSSOptimizationOptions = {}): Promise<Map<string, CSSBundle>> {
  return new CSSOptimizer(options).optimize();
}
