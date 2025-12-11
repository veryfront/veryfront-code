
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
  readonly priority = 50;

  private usedSelectors: Set<string> = new Set();

  canProcess(options: CSSOptimizationOptions): boolean {
    return options.enabled !== false && options.purge === true;
  }

  async analyzeContent(purgeContent: string[]): Promise<void> {
    logger.debug("Analyzing content for CSS purging");

    this.usedSelectors.clear();

    for (const pattern of purgeContent) {
      const files = await globFiles(pattern);

      for (const file of files) {
        try {
          const content = await fs.readTextFile(file);
          const result = extractSelectors(content);

          result.selectors.forEach((selector: string) => this.usedSelectors.add(selector));
        } catch (error) {
          logger.warn(`Failed to analyze ${file}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    logger.debug(`Found ${this.usedSelectors.size} used selectors`);
  }

  async process(
    content: string,
    _filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    if (this.usedSelectors.size === 0 && options.purgeContent && options.purgeContent.length > 0) {
      await this.analyzeContent(options.purgeContent);
    }

    const purgedCSS = this.purgeUnusedCSS(content);

    return {
      code: purgedCSS,
      sourceMap: undefined,
    };
  }

  private purgeUnusedCSS(css: string): string {

    const lines = css.split("\n");
    const kept: string[] = [];
    let currentRule = "";
    let keepRule = false;

    for (const line of lines) {
      currentRule += line + "\n";

      const selectorMatch = line.match(/^([^{]+)\s*\{/);
      if (selectorMatch && selectorMatch[1]) {
        const selector = selectorMatch[1].trim();
        keepRule = shouldKeepSelector(selector, this.usedSelectors);
      }

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

  getUsedSelectors(): Set<string> {
    return this.usedSelectors;
  }

  clearCache(): void {
    this.usedSelectors.clear();
  }
}
