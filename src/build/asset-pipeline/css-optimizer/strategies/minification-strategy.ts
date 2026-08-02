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
} from "../optimization-engine.ts";

export class MinificationStrategy implements CSSOptimizationStrategy {
  readonly name = "basic-minification";
  readonly priority = 10;

  readonly #engine: CSSOptimizationEngine | undefined;

  constructor(engine?: CSSOptimizationEngine) {
    this.#engine = engine;
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

    const session = this.#engine === undefined
      ? acquireConfiguredCSSOptimization()
      : createCSSOptimizationSession(this.#engine);
    return {
      code: session.run({
        css: content,
        sourcePath: filename,
        minify: true,
        sourceMap: false,
      }).css,
    };
  }
}
