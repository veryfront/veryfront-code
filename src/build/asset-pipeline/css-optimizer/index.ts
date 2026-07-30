/**
 * Asset Pipeline - Css Optimizer
 *
 * @module build/asset-pipeline/css-optimizer
 */

export type {
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
  CSSProcessingResult,
  SelectorExtractionResult,
} from "./types/index.ts";

export { CSSOptimizerService } from "./optimizer-service.ts";
export { CacheManager, loadCSSManifest } from "./css-bundle-cache.ts";
export { extractCriticalCSS } from "./critical-css.ts";
export { MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";
export * as CSSUtils from "./utils.ts";

import type {
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizerStats,
} from "./types/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { CSSOptimizationEngine, CSSPurgingEngine } from "#veryfront/extensions/css/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { CSSOptimizerService } from "./optimizer-service.ts";
import { extractCriticalCSS as extractCriticalCSSImpl } from "./critical-css.ts";
import type { CSSOptimizationSession } from "./optimization-engine.ts";
import type { CSSPurgingSession } from "./purging-engine.ts";

export class CSSOptimizer {
  private service: CSSOptimizerService | null = null;
  private serviceInitialization: Promise<CSSOptimizerService> | null = null;
  private adapter: RuntimeAdapter | null = null;
  private readonly baseDir: string;
  private readonly options: CSSOptimizationOptions;
  private readonly optimizationEngine: CSSOptimizationEngine | undefined;
  private readonly optimizationSession: CSSOptimizationSession | undefined;
  private readonly purgingEngine: CSSPurgingEngine | undefined;
  private readonly purgingSession: CSSPurgingSession | undefined;

  constructor(
    options: CSSOptimizationOptions = {},
    baseDir?: string,
    dependencies: {
      optimizationEngine?: CSSOptimizationEngine;
      optimizationSession?: CSSOptimizationSession;
      purgingEngine?: CSSPurgingEngine;
      purgingSession?: CSSPurgingSession;
    } = {},
  ) {
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
        ["purgeContent", options.purgeContent],
        ["purgeSafelist", options.purgeSafelist],
      ] as const
    ) {
      if (value !== undefined && !Array.isArray(value)) {
        throw new TypeError(`CSS ${name} must be an array`);
      }
    }
    if (
      Object.hasOwn(options, "autoprefixer") ||
      Object.hasOwn(options, "browsers")
    ) {
      throw new TypeError(
        "CSS autoprefixer/browsers options moved to the optimization extension; configure extCSSLightning({ browserQueries })",
      );
    }
    this.options = {
      ...options,
      inputFiles: options.inputFiles ? [...options.inputFiles] : undefined,
      purgeContent: options.purgeContent ? [...options.purgeContent] : undefined,
      purgeSafelist: options.purgeSafelist ? [...options.purgeSafelist] : undefined,
    };
    this.baseDir = baseDir ?? options.projectDir ?? cwd();
    this.optimizationEngine = dependencies.optimizationEngine;
    this.optimizationSession = dependencies.optimizationSession;
    this.purgingEngine = dependencies.purgingEngine;
    this.purgingSession = dependencies.purgingSession;
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
        {
          optimizationEngine: this.optimizationEngine,
          optimizationSession: this.optimizationSession,
          purgingEngine: this.purgingEngine,
          purgingSession: this.purgingSession,
        },
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
    await service.init();
    return extractCriticalCSSImpl(
      cssPath,
      htmlContent,
      service.getOptions(),
      service.getOptimizationSession(),
      service.getPurgingSession(),
    );
  }

  async getStats(): Promise<CSSOptimizerStats> {
    return (await this.ensureService()).getStats();
  }
}

export function optimizeCSS(options: CSSOptimizationOptions = {}): Promise<Map<string, CSSBundle>> {
  return new CSSOptimizer(options).optimize();
}
