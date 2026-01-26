import { logger } from "../../../../utils/index.js";
import { createFileSystem } from "../../../../platform/compat/fs.js";
import { extractSelectors, globFiles, shouldKeepSelector } from "../utils.js";
const fs = createFileSystem();
export class PurgeStrategy {
    name = "purge-css";
    priority = 50; // Medium priority - runs after Lightning CSS but before basic minification
    usedSelectors = new Set();
    canProcess(options) {
        return options.enabled !== false && options.purge === true;
    }
    async analyzeContent(purgeContent) {
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
                }
                catch (error) {
                    logger.warn(`Failed to analyze ${file}`, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        logger.debug(`Found ${this.usedSelectors.size} used selectors`);
    }
    async process(content, _filename, options) {
        if (this.usedSelectors.size === 0 && options.purgeContent?.length) {
            await this.analyzeContent(options.purgeContent);
        }
        return {
            code: this.purgeUnusedCSS(content),
            sourceMap: undefined,
        };
    }
    purgeUnusedCSS(css) {
        const lines = css.split("\n");
        const kept = [];
        let currentRule = "";
        let keepRule = false;
        for (const line of lines) {
            currentRule += `${line}\n`;
            const selectorMatch = line.match(/^([^{]+)\s*\{/);
            if (selectorMatch?.[1]) {
                keepRule = shouldKeepSelector(selectorMatch[1].trim(), this.usedSelectors);
            }
            if (line.includes("}")) {
                if (keepRule)
                    kept.push(currentRule);
                currentRule = "";
                keepRule = false;
            }
        }
        return kept.join("");
    }
    getUsedSelectors() {
        return this.usedSelectors;
    }
    clearCache() {
        this.usedSelectors.clear();
    }
}
