import { logger } from "#veryfront/utils";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
} from "../types/index.ts";
import { basicMinify } from "../utils.ts";

export class MinificationStrategy implements CSSOptimizationStrategy {
  readonly name = "basic-minification";
  readonly priority = 10;

  canProcess(options: CSSOptimizationOptions): boolean {
    return options.enabled !== false && options.minify !== false;
  }

  process(
    content: string,
    filename: string,
    _options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    logger.debug(`Using basic minification for ${filename}`);

    return Promise.resolve({
      code: basicMinify(content),
      sourceMap: undefined,
    });
  }
}
