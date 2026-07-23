import { logger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
} from "../types/index.ts";
import { extractSelectors, globFiles } from "../utils.ts";
import { purgeCSSRules } from "../css-rule-parser.ts";

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
    let analyzedFiles = 0;

    for (const pattern of purgeContent) {
      const files = await globFiles(pattern);

      for (const file of files) {
        analyzedFiles++;
        const content = await fs.readTextFile(file);
        const { selectors } = extractSelectors(content);

        for (const selector of selectors) {
          this.usedSelectors.add(selector);
        }
      }
    }

    if (analyzedFiles === 0) {
      throw new TypeError("purgeContent did not match any source files");
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
    return purgeCSSRules(css, this.usedSelectors);
  }

  getUsedSelectors(): Set<string> {
    return this.usedSelectors;
  }

  clearCache(): void {
    this.usedSelectors.clear();
  }
}
