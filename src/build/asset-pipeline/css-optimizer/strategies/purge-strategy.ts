import { logger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
} from "../types/index.ts";
import { extractSelectors, globFiles, shouldKeepSelector } from "../utils.ts";

const fs = createFileSystem();

export class PurgeStrategy implements CSSOptimizationStrategy {
  readonly name = "purge-css";
  readonly priority = 50; // Medium priority - runs after Lightning CSS but before basic minification

  private usedSelectors = new Set<string>();

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
          const { selectors } = extractSelectors(content);

          for (const selector of selectors) {
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

  async process(
    content: string,
    _filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    if (this.usedSelectors.size === 0 && options.purgeContent?.length) {
      await this.analyzeContent(options.purgeContent);
    }

    return { code: this.purgeUnusedCSS(content), sourceMap: undefined };
  }

  private purgeUnusedCSS(css: string): string {
    const lines = css.split("\n");
    const kept: string[] = [];
    let currentRule = "";
    let keepRule = false;

    for (const line of lines) {
      currentRule += `${line}\n`;

      const selector = line.match(/^([^{]+)\s*\{/)?.[1]?.trim();
      if (selector) {
        keepRule = shouldKeepSelector(selector, this.usedSelectors);
      }

      if (!line.includes("}")) continue;

      if (keepRule) kept.push(currentRule);
      currentRule = "";
      keepRule = false;
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
