import { logger } from "../../../../utils/index.js";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
} from "../types/index.js";
import { basicMinify } from "../utils.js";

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
