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
  CSSProcessingResult,
  LightningCSSModule,
  LightningCSSTransformOptions,
  LightningCSSTransformResult,
  SelectorExtractionResult,
} from "./types/index.ts";

export { CSSOptimizerService } from "./optimizer-service.ts";
export { CacheManager, loadCSSManifest } from "./css-bundle-cache.ts";
export { extractCriticalCSS } from "./critical-css.ts";
export { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";
export * as CSSUtils from "./utils.ts";

import type {
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizerStats,
} from "./types/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { CSSOptimizerService } from "./optimizer-service.ts";
import { extractCriticalCSS as extractCriticalCSSImpl } from "./critical-css.ts";

export class CSSOptimizer {
  private service: CSSOptimizerService | null = null;
  private serviceInitialization: Promise<CSSOptimizerService> | null = null;
  private adapter: RuntimeAdapter | null = null;
  private readonly baseDir: string;
  private readonly options: CSSOptimizationOptions;

  constructor(options: CSSOptimizationOptions = {}, baseDir?: string) {
    if (
      typeof options !== "object" ||
      options === null ||
      Array.isArray(options)
    ) {
      throw new TypeError("CSS optimization options must be an object");
    }
    for (
      const [name, value] of [
        ["inputFiles", options.inputFiles],
        ["browsers", options.browsers],
        ["purgeContent", options.purgeContent],
        ["purgeSafelist", options.purgeSafelist],
      ] as const
    ) {
      if (value !== undefined && !Array.isArray(value)) {
        throw new TypeError(`CSS ${name} must be an array`);
      }
    }
    this.options = {
      ...options,
      inputFiles: options.inputFiles ? [...options.inputFiles] : undefined,
      browsers: options.browsers ? [...options.browsers] : undefined,
      purgeContent: options.purgeContent ? [...options.purgeContent] : undefined,
      purgeSafelist: options.purgeSafelist ? [...options.purgeSafelist] : undefined,
    };
    this.baseDir = baseDir ?? options.projectDir ?? cwd();
  }

  private async ensureService(): Promise<CSSOptimizerService> {
    if (this.service) return this.service;
    if (this.serviceInitialization) return await this.serviceInitialization;

    this.serviceInitialization = (async () => {
      this.adapter ??= await runtime.get();
      const service = new CSSOptimizerService(
        this.adapter,
        this.baseDir,
        this.options,
      );
      this.service = service;
      return service;
    })();
    try {
      return await this.serviceInitialization;
    } finally {
      this.serviceInitialization = null;
    }
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

  async getStats(): Promise<CSSOptimizerStats> {
    return (await this.ensureService()).getStats();
  }
}

export function optimizeCSS(options: CSSOptimizationOptions = {}): Promise<Map<string, CSSBundle>> {
  return new CSSOptimizer(options).optimize();
}
