import { logger } from "#veryfront/utils";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
  LightningCSSModule,
} from "../types/index.ts";
import { parseBrowserTargets } from "../utils.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";

export class LightningCSSStrategy implements CSSOptimizationStrategy {
  readonly name = "lightning-css";
  readonly priority = 100;

  private lightningCSS: LightningCSSModule | null = null;
  private initializationPromise: Promise<boolean> | null = null;

  init(): Promise<boolean> {
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = (async () => {
      try {
        this.lightningCSS = await import("npm:lightningcss@1.29.2");
        logger.info("Lightning CSS optimizer loaded successfully");
        return true;
      } catch {
        logger.warn("Lightning CSS is unavailable");
        return false;
      }
    })();
    return this.initializationPromise;
  }

  canProcess(options: CSSOptimizationOptions): boolean {
    return this.lightningCSS !== null && options.enabled !== false;
  }

  async process(
    content: string,
    filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    if (!this.lightningCSS) {
      throw INITIALIZATION_ERROR.create({ detail: "Lightning CSS not initialized" });
    }

    const result = this.lightningCSS.transform({
      filename,
      code: new TextEncoder().encode(content),
      minify: options.minify ?? true,
      sourceMap: options.sourceMap ?? false,
      targets: options.autoprefixer === false ? undefined : parseBrowserTargets(options.browsers),
      analyzeDependencies: false,
      errorRecovery: false,
    });

    const decoder = new TextDecoder();

    return {
      code: decoder.decode(result.code),
      sourceMap: result.map ? decoder.decode(result.map) : undefined,
    };
  }

  isAvailable(): boolean {
    return this.lightningCSS !== null;
  }
}
