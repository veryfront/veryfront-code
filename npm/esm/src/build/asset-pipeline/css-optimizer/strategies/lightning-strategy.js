import { logger } from "../../../../utils/index.js";
import { parseBrowserTargets } from "../utils.js";
export class LightningCSSStrategy {
    name = "lightning-css";
    priority = 100;
    lightningCSS = null;
    initialized = false;
    async init() {
        if (this.initialized)
            return this.lightningCSS !== null;
        this.initialized = true;
        try {
            this.lightningCSS = await import("lightningcss");
            logger.info("Lightning CSS optimizer loaded successfully");
            return true;
        }
        catch (error) {
            logger.warn("Lightning CSS not available. Install with: npm install lightningcss", {
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }
    canProcess(options) {
        return this.lightningCSS !== null && options.enabled !== false;
    }
    process(content, filename, options) {
        if (!this.lightningCSS)
            return Promise.reject(new Error("Lightning CSS not initialized"));
        try {
            const result = this.lightningCSS.transform({
                filename,
                code: new TextEncoder().encode(content),
                minify: options.minify ?? true,
                sourceMap: options.sourceMap ?? false,
                targets: parseBrowserTargets(options.browsers),
                analyzeDependencies: false,
            });
            const decoder = new TextDecoder();
            return Promise.resolve({
                code: decoder.decode(result.code),
                sourceMap: result.map ? decoder.decode(result.map) : undefined,
            });
        }
        catch (error) {
            logger.warn(`Lightning CSS processing failed for ${filename}`, {
                error: error instanceof Error ? error.message : String(error),
            });
            return Promise.reject(error);
        }
    }
    isAvailable() {
        return this.lightningCSS !== null;
    }
}
