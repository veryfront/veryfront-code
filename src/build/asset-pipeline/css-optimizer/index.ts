
export type {
  BrowserTargets,
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
} from "@veryfront/types";

export { CSSOptimizerService } from "./optimizer-service.ts";
export { CacheManager, loadCSSManifest } from "./css-bundle-cache.ts";
export { extractCriticalCSS } from "./critical-css.ts";

export { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";

export * as CSSUtils from "./utils.ts";

import type { CriticalCSSResult, CSSBundle, CSSOptimizationOptions } from "@veryfront/types";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { cwd } from "../../../platform/compat/process.ts";
import { CSSOptimizerService } from "./optimizer-service.ts";
import { extractCriticalCSS as extractCriticalCSSImpl } from "./critical-css.ts";

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

  async init(): Promise<boolean> {
    const service = await this.ensureService();
    return await service.init();
  }

  async optimize(): Promise<Map<string, CSSBundle>> {
    const service = await this.ensureService();
    return await service.optimize();
  }

  async extractCriticalCSS(
    cssPath: string,
    htmlContent: string,
  ): Promise<CriticalCSSResult> {
    const service = await this.ensureService();
    const options = service.getOptions();
    return await extractCriticalCSSImpl(cssPath, htmlContent, options);
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

export async function optimizeCSS(
  options: CSSOptimizationOptions = {},
): Promise<Map<string, CSSBundle>> {
  const optimizer = new CSSOptimizer(options);
  return await optimizer.optimize();
}
