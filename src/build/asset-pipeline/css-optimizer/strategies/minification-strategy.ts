import { logger } from "#veryfront/utils";
import type { CSSOptimizationEngine } from "#veryfront/extensions/css/index.ts";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
} from "../types/index.ts";
import {
  acquireConfiguredCSSOptimization,
  createCSSOptimizationSession,
  type CSSOptimizationSession,
} from "../optimization-engine.ts";

export class MinificationStrategy implements CSSOptimizationStrategy {
  readonly name = "basic-minification";
  readonly priority = 10;

  private optimizationSession: CSSOptimizationSession | undefined;

  constructor(engine?: CSSOptimizationEngine) {
    this.optimizationSession = engine === undefined
      ? undefined
      : createCSSOptimizationSession(engine);
  }

  canProcess(options: CSSOptimizationOptions): boolean {
    return options.enabled !== false && options.minify !== false;
  }

  async process(
    content: string,
    filename: string,
    _options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    logger.debug(`Using parser-backed minification for ${filename}`);
    const request = {
      css: content,
      sourcePath: filename,
      minify: true,
      sourceMap: false,
    } as const;
    this.optimizationSession ??= acquireConfiguredCSSOptimization();
    const result = this.optimizationSession.run(request);
    return { code: result.css };
  }
}
