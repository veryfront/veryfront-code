
import { logger } from "@veryfront/utils";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
  LightningCSSModule,
} from "../types/index.ts";
import { parseBrowserTargets } from "../utils.ts";

export class LightningCSSStrategy implements CSSOptimizationStrategy {
  readonly name = "lightning-css";
  readonly priority = 100;

  private lightningCSS: LightningCSSModule | null = null;
  private initialized = false;

  async init(): Promise<boolean> {
    if (this.initialized) {
      return this.lightningCSS !== null;
    }

    try {
      const lightningModule = await import("https://esm.sh/lightningcss@1.22.0");
      this.lightningCSS = lightningModule;
      this.initialized = true;
      logger.info("Lightning CSS optimizer loaded successfully");
      return true;
    } catch (error) {
      this.initialized = true;
      logger.warn("Lightning CSS not available. Install with: npm install lightningcss", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  canProcess(options: CSSOptimizationOptions): boolean {
    return this.lightningCSS !== null && options.enabled !== false;
  }

  process(
    content: string,
    filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    if (!this.lightningCSS) {
      return Promise.reject(new Error("Lightning CSS not initialized"));
    }

    try {
      const result = this.lightningCSS.transform({
        filename,
        code: new TextEncoder().encode(content),
        minify: options.minify ?? true,
        sourceMap: options.sourceMap ?? false,
        targets: parseBrowserTargets(options.browsers),
        analyzeDependencies: false,
      });

      return Promise.resolve({
        code: new TextDecoder().decode(result.code),
        sourceMap: result.map ? new TextDecoder().decode(result.map) : undefined,
      });
    } catch (error) {
      logger.warn(`Lightning CSS processing failed for ${filename}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return Promise.reject(error);
    }
  }

  isAvailable(): boolean {
    return this.lightningCSS !== null;
  }
}
