/**
 * Basic CSS Minification Strategy
 *
 * Fallback strategy for CSS minification when Lightning CSS is not available.
 * Provides basic minification including:
 * - Comment removal
 * - Whitespace reduction
 * - Character optimization
 */

import { logger } from "#veryfront/utils";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
} from "../types/index.ts";
import { basicMinify } from "../utils.ts";

export class MinificationStrategy implements CSSOptimizationStrategy {
  readonly name = "basic-minification";
  readonly priority = 10; // Low priority - used as fallback

  /**
   * Check if this strategy can process the CSS.
   * This is always available as a fallback when minification is not explicitly disabled.
   */
  canProcess(options: CSSOptimizationOptions): boolean {
    const isEnabled = options.enabled !== false;
    const minifyEnabled = options.minify !== false;
    return isEnabled && minifyEnabled;
  }

  /**
   * Process CSS with basic minification
   */
  process(
    content: string,
    filename: string,
    _options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    logger.debug(`Using basic minification for ${filename}`);

    const minified = basicMinify(content);

    return Promise.resolve({
      code: minified,
      sourceMap: undefined, // Basic minification doesn't generate source maps
    });
  }
}
