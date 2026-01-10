/**
 * CSS Purging Strategy
 *
 * Removes unused CSS rules based on content analysis.
 * Inspired by PurgeCSS but simplified for Veryfront's needs.
 *
 * Features:
 * - Analyzes content files for used selectors
 * - Removes unused CSS rules
 * - Preserves universal and pseudo-element rules
 */

import { logger } from "@veryfront/utils";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
} from "../types/index.ts";
import { extractSelectors, globFiles, shouldKeepSelector } from "../utils.ts";
import { createFileSystem } from "../../../../platform/compat/fs.ts";

const fs = createFileSystem();

export class PurgeStrategy implements CSSOptimizationStrategy {
  readonly name = "purge-css";
  readonly priority = 50; // Medium priority - runs after Lightning CSS but before basic minification

  private usedSelectors: Set<string> = new Set();

  /**
   * Check if this strategy can process the CSS.
   * Requires both optimization to be enabled and purge mode to be explicitly requested.
   */
  canProcess(options: CSSOptimizationOptions): boolean {
    const isEnabled = options.enabled !== false;
    const purgeRequested = options.purge === true;
    return isEnabled && purgeRequested;
  }

  /**
   * Analyze content files to extract used selectors
   */
  async analyzeContent(purgeContent: string[]): Promise<void> {
    logger.debug("Analyzing content for CSS purging");

    this.usedSelectors.clear();

    for (const pattern of purgeContent) {
      const files = await globFiles(pattern);

      for (const file of files) {
        try {
          const content = await fs.readTextFile(file);
          const result = extractSelectors(content);

          // Add all extracted selectors to the used set
          for (const selector of result.selectors) {
            this.usedSelectors.add(selector);
          }
        } catch (error) {
          logger.warn(`Failed to analyze ${file}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    logger.debug(`Found ${this.usedSelectors.size} used selectors`);
  }

  /**
   * Process CSS by removing unused rules
   */
  async process(
    content: string,
    _filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    // Analyze content if we haven't done so yet
    if (this.usedSelectors.size === 0 && options.purgeContent && options.purgeContent.length > 0) {
      await this.analyzeContent(options.purgeContent);
    }

    const purgedCSS = this.purgeUnusedCSS(content);

    return {
      code: purgedCSS,
      sourceMap: undefined,
    };
  }

  /**
   * Remove unused CSS rules
   */
  private purgeUnusedCSS(css: string): string {
    // Simple purging: keep rules that match used selectors
    // This is a basic implementation - full PurgeCSS would be more sophisticated

    const lines = css.split("\n");
    const kept: string[] = [];
    let currentRule = "";
    let keepRule = false;

    for (const line of lines) {
      currentRule += line + "\n";

      // Check if line contains a selector
      const selectorMatch = line.match(/^([^{]+)\s*\{/);
      if (selectorMatch && selectorMatch[1]) {
        const selector = selectorMatch[1].trim();
        keepRule = shouldKeepSelector(selector, this.usedSelectors);
      }

      // If rule ends, decide whether to keep it
      if (line.includes("}")) {
        if (keepRule) {
          kept.push(currentRule);
        }
        currentRule = "";
        keepRule = false;
      }
    }

    return kept.join("");
  }

  /**
   * Get the set of used selectors (for debugging/testing)
   */
  getUsedSelectors(): Set<string> {
    return this.usedSelectors;
  }

  /**
   * Clear the cached selectors
   */
  clearCache(): void {
    this.usedSelectors.clear();
  }
}
